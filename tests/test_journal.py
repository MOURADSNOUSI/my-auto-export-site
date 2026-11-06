"""Tests du journal des actions et des interrupteurs : agent local (AGENT_TOKEN), automations_actives, journal admin et MCP.

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_journal
Ignorés si la variable WRANGLER n'est pas définie.
"""
import hashlib
import json
import os
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

try:
    from test_administration import config_de_test, port_libre
except ImportError:
    from tests.test_administration import config_de_test, port_libre

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
MOT_DE_PASSE = "motdepasse-solide"
JETON_AGENT = "jeton-agent-de-test-" + "a" * 32
JETON_MCP = "b" * 64


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class JournalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        config = json.loads(Path(cls.config).read_text())
        config["vars"]["AGENT_TOKEN"] = JETON_AGENT
        Path(cls.config).write_text(json.dumps(config))
        subprocess.run([WRANGLER, "d1", "migrations", "apply", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config],
                       cwd=PROJET, check=True, capture_output=True)
        port = port_libre()
        cls.base = f"http://localhost:{port}"
        cls.serveur = subprocess.Popen([WRANGLER, "dev", "--local", "--port", str(port), "--persist-to", cls.persist, "-c", cls.config],
                                       cwd=PROJET, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(90):
            try:
                urllib.request.urlopen(cls.base + "/", timeout=2)
                break
            except OSError:
                time.sleep(1)
        else:
            cls.serveur.terminate()
            raise RuntimeError("wrangler dev n'a pas démarré")
        corps = {"name": "Admin Test", "email": "admin@ex.com", "password": MOT_DE_PASSE}
        assert cls.requete("/api/register", corps, "POST")[0] == 201
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'")
        cls.cookie = cls.requete("/api/login", {"email": "admin@ex.com", "password": MOT_DE_PASSE}, "POST")[2]["Set-Cookie"].split(";")[0]
        # Jeton OAuth d'administrateur inséré directement : le parcours d'autorisation est couvert par tests/test_mcp.py.
        cls.sql("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES ('client-test', 'Test', '[]', '2026-01-01T00:00:00Z')")
        cls.sql(f"INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, expires_at) SELECT '{hashlib.sha256(JETON_MCP.encode()).hexdigest()}', "
                "'access', 'client-test', id, '2999-01-01T00:00:00Z' FROM users WHERE email = 'admin@ex.com'")

    @classmethod
    def tearDownClass(cls):
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, commande):
        sortie = subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--json",
                                 "--command", commande], cwd=PROJET, check=True, capture_output=True, text=True).stdout
        return json.loads(sortie)[0]["results"]

    @classmethod
    def requete(cls, chemin, data=None, method=None, cookie=None):
        headers = {"Origin": cls.base, "CF-Connecting-IP": "10.0.0.1"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        requete = urllib.request.Request(cls.base + chemin, data=None if data is None else json.dumps(data).encode(), method=method, headers=headers)
        try:
            with urllib.request.urlopen(requete) as reponse:
                return reponse.status, json.loads(reponse.read() or b"null"), reponse.headers
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, json.loads(erreur.read() or b"null"), erreur.headers

    @classmethod
    def outil(cls, jeton, nom, arguments=None):
        """Appel MCP tools/call : (statut HTTP, résultat JSON-RPC)."""
        corps = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": nom, "arguments": arguments or {}}}
        requete = urllib.request.Request(cls.base + "/mcp", data=json.dumps(corps).encode(), method="POST",
                                         headers={"Authorization": f"Bearer {jeton}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(requete) as reponse:
                return reponse.status, json.loads(reponse.read())
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, None

    def regler(self, cle, valeur):
        statut, data, _ = self.requete(f"/api/admin/reglages/{cle}", {"valeur": valeur}, "PUT", self.cookie)
        self.assertEqual(statut, 200, data)

    def journal(self, action):
        return self.sql(f"SELECT acteur, actor_id, action, resource_id, resultat, details FROM audit_logs WHERE action = '{action}' ORDER BY id")

    def setUp(self):
        self.regler("automations_actives", True)
        self.regler("agent_ecriture_autorisee", False)

    def test_agent_en_lecture_seule_par_defaut(self):
        statut, rpc = self.outil(JETON_AGENT, "rechercher_vehicules")
        self.assertEqual(statut, 200)
        self.assertNotIn("isError", rpc["result"])
        statut, rpc = self.outil(JETON_AGENT, "enregistrer_vehicule", {"reference": "JNL-1", "champs": {"make": "BMW", "model": "X1", "status": "stock"}})
        self.assertTrue(rpc["result"]["isError"])
        self.assertIn("lecture", rpc["result"]["content"][0]["text"])
        lignes = [l for l in self.journal("mcp.enregistrer_vehicule") if l["resource_id"] == "JNL-1"]
        self.assertEqual([(l["acteur"], l["actor_id"], l["resultat"]) for l in lignes], [("agent", None, "refuse")])
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM vehicles WHERE reference = 'JNL-1'")[0]["n"], 0)

    def test_agent_avec_ecriture_autorisee(self):
        self.regler("agent_ecriture_autorisee", True)
        statut, rpc = self.outil(JETON_AGENT, "enregistrer_vehicule", {"reference": "JNL-2", "champs": {"make": "Audi", "model": "A3", "status": "stock"}})
        self.assertNotIn("isError", rpc["result"], rpc)
        self.assertEqual([(l["acteur"], l["resultat"]) for l in self.journal("mcp.enregistrer_vehicule") if l["resource_id"] == "JNL-2"], [("agent", "ok")])
        self.assertEqual(self.sql("SELECT updated_by FROM vehicles WHERE reference = 'JNL-2'"), [{"updated_by": None}])

    def test_interrupteur_coupe_toutes_les_ecritures(self):
        self.regler("agent_ecriture_autorisee", True)
        self.regler("automations_actives", False)
        for jeton, acteur in ((JETON_AGENT, "agent"), (JETON_MCP, "mcp")):
            statut, rpc = self.outil(jeton, "retirer_vehicule", {"reference": "MY-0001"})
            self.assertTrue(rpc["result"]["isError"])
            self.assertIn("désactivées", rpc["result"]["content"][0]["text"])
            self.assertIn((acteur, "refuse"), [(l["acteur"], l["resultat"]) for l in self.journal("mcp.retirer_vehicule")])
        # Les lectures restent disponibles.
        self.assertNotIn("isError", self.outil(JETON_MCP, "rechercher_vehicules")[1]["result"])

    def test_administrateur_mcp_journalise(self):
        statut, rpc = self.outil(JETON_MCP, "enregistrer_vehicule", {"reference": "JNL-3", "champs": {"make": "Kia", "model": "Niro", "status": "stock"}})
        self.assertNotIn("isError", rpc["result"], rpc)
        lignes = [l for l in self.journal("mcp.enregistrer_vehicule") if l["resource_id"] == "JNL-3"]
        admin = self.sql("SELECT id FROM users WHERE email = 'admin@ex.com'")[0]["id"]
        self.assertEqual([(l["acteur"], l["actor_id"], l["resultat"]) for l in lignes], [("mcp", admin, "ok")])

    def test_erreur_metier_journalisee(self):
        self.regler("agent_ecriture_autorisee", True)
        statut, rpc = self.outil(JETON_AGENT, "retirer_vehicule", {"reference": "INCONNU-9"})
        self.assertTrue(rpc["result"]["isError"])
        lignes = [l for l in self.journal("mcp.retirer_vehicule") if l["resource_id"] == "INCONNU-9"]
        self.assertEqual([(l["acteur"], l["resultat"]) for l in lignes], [("agent", "erreur")])
        self.assertIn("introuvable", json.loads(lignes[0]["details"])["message"])

    def test_mauvais_jeton_refuse(self):
        for jeton in ("jeton-agent-de-test-" + "z" * 32, JETON_AGENT[:-1], ""):
            self.assertEqual(self.outil(jeton, "rechercher_vehicules")[0], 401, jeton)

    def test_ecriture_admin_journalisee_sans_donnees_du_formulaire(self):
        corps = {"make": "Toyota", "model": "Yaris", "status": "stock", "sourceUrl": "https://exemple.com/fiche"}
        statut, data, _ = self.requete("/api/admin/vehicles/JNL-4", corps, "PUT", self.cookie)
        self.assertEqual(statut, 200, data)
        lignes = self.journal("PUT /api/admin/vehicles/JNL-4")
        self.assertEqual([(l["acteur"], l["resource_id"], l["resultat"]) for l in lignes], [("admin", "JNL-4", "ok")])
        self.assertEqual(json.loads(lignes[0]["details"]), {"status": 200})
        # Une requête sans connexion n'écrit rien dans le journal.
        self.assertEqual(self.requete("/api/admin/vehicles/JNL-5", corps, "PUT")[0], 401)
        self.assertEqual(self.journal("PUT /api/admin/vehicles/JNL-5"), [])

    def test_reglages_limites_aux_cles_connues(self):
        statut, data, _ = self.requete("/api/admin/reglages", cookie=self.cookie)
        self.assertEqual({r["cle"]: r["valeur"] for r in data["reglages"]}, {"automations_actives": True, "agent_ecriture_autorisee": False})
        self.assertEqual(self.requete("/api/admin/reglages/numero_whatsapp", {"valeur": True}, "PUT", self.cookie)[0], 404)
        self.assertEqual(self.requete("/api/admin/reglages/automations_actives", {"valeur": "false"}, "PUT", self.cookie)[0], 400)
        self.assertEqual(self.requete("/api/admin/reglages/automations_actives", {"valeur": False}, "PUT")[0], 401)


if __name__ == "__main__":
    unittest.main()
