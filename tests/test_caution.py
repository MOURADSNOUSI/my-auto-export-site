"""Tests du dépôt de garantie : virement à montant figé, carte sans taux de change, ajustements manuels journalisés.

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_caution
Ignorés si la variable WRANGLER n'est pas définie. Aucun appel à Stripe : la clé est factice et le taux absent,
la requête carte s'arrête avant (503).
"""
import json
import os
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from test_administration import config_de_test, port_libre
except ImportError:
    from tests.test_administration import config_de_test, port_libre

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
MOT_DE_PASSE = "motdepasse-solide"
CGV_VERSION = "2026-11-01"
# Valeurs factices, dans la config de test seulement (jamais dans wrangler.jsonc). Pas de TND_PER_EUR.
VARIABLES = {"STRIPE_SECRET_KEY": "sk_test_factice", "BANK_IBAN": "TN59TEST", "BANK_BENEFICIARY": "Test SARL"}


def dans(**delta):
    return (datetime.now(timezone.utc) + timedelta(**delta)).isoformat()


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class CautionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        config = json.loads(Path(cls.config).read_text())
        config["vars"] = VARIABLES
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
        assert cls.requete("/api/register", {"name": "Admin Test", "email": "admin@ex.com", "password": MOT_DE_PASSE}, "POST")[0] == 201
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'")
        cls.admin = cls.connexion("admin@ex.com")
        cls.admin_id = cls.requete("/api/me", cookie=cls.admin)[1]["user"]["id"]
        for reference, prix in (("CAU-500", 20000), ("CAU-2000", 100000), ("CAU-3000", 250000)):
            corps = {"make": "BMW", "model": "X5", "status": "open", "endsAt": dans(days=2), "startingPriceTnd": prix}
            assert cls.requete(f"/api/admin/vehicles/{reference}", corps, "PUT", cls.admin)[0] == 200

    @classmethod
    def tearDownClass(cls):
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, commande):
        sortie = subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--json", "--command", commande],
                                cwd=PROJET, check=True, capture_output=True, text=True).stdout
        return json.loads(sortie)[0]["results"]

    @classmethod
    def requete(cls, chemin, data=None, method=None, cookie=None, ip="10.0.0.1"):
        headers = {"Origin": cls.base, "CF-Connecting-IP": ip}
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
    def connexion(cls, email):
        return cls.requete("/api/login", {"email": email, "password": MOT_DE_PASSE}, "POST")[2]["Set-Cookie"].split(";")[0]

    def nouvel_acheteur(self, email):
        self.assertEqual(self.requete("/api/register", {"name": "Test", "email": email, "password": MOT_DE_PASSE}, "POST")[0], 201)
        cookie = self.connexion(email)
        self.assertEqual(self.requete("/api/terms", {"version": CGV_VERSION}, "POST", cookie)[0], 200)
        return cookie, self.requete("/api/me", cookie=cookie)[1]["user"]["id"]

    def virement(self, cookie, reference):
        statut, data, _ = self.requete("/api/deposit/transfer", {"reference": reference}, "POST", cookie)
        self.assertEqual(statut, 201, data)
        return data["transfer"]

    def confirmer(self, depot_id, montant):
        return self.requete(f"/api/admin/deposits/{depot_id}/confirm", {"amountTnd": montant}, "POST", self.admin)

    def solde(self, cookie):
        return self.requete("/api/me", cookie=cookie)[1]["user"]["depositTnd"]

    def test_virement_montant_fige_et_reference_par_demande(self):
        cookie, user_id = self.nouvel_acheteur("fige@ex.com")
        petit = self.virement(cookie, "CAU-500")
        self.assertEqual((petit["amountTnd"], petit["reference"]), (500, f"CAUTION-{petit['id']}"))
        self.assertEqual(self.virement(cookie, "CAU-500"), petit, "même montant : la demande en attente est reprise")
        grand = self.virement(cookie, "CAU-3000")
        self.assertEqual(grand["amountTnd"], 3000)
        self.assertNotEqual(grand["id"], petit["id"], "autre montant : nouvelle demande")
        self.assertEqual(grand["reference"], f"CAUTION-{grand['id']}")
        lignes = {l["id"]: l for l in self.sql(f"SELECT id, amount_tnd, status FROM deposits WHERE user_id = {user_id}")}
        self.assertEqual(lignes[petit["id"]], {"id": petit["id"], "amount_tnd": 500, "status": "cancelled"}, "montant jamais modifié")
        self.assertEqual(lignes[grand["id"]]["status"], "pending")
        # L'administration voit la référence propre à la demande, et seulement la demande en attente.
        attente = [t for t in self.requete("/api/admin/deposits", cookie=self.admin)[1]["transfers"] if t["userId"] == user_id]
        self.assertEqual([(t["id"], t["amountTnd"], t["reference"]) for t in attente], [(grand["id"], 3000, grand["reference"])])
        # L'ancienne demande (500 virés sur CAUTION-<petit>) ne peut plus être validée, encore moins pour 3 000.
        self.assertEqual(self.confirmer(petit["id"], 500)[0], 404)
        self.assertEqual(self.confirmer(petit["id"], 3000)[0], 404)
        self.assertEqual(self.solde(cookie), 0)

    def test_confirmation_exige_le_montant_recu(self):
        cookie, user_id = self.nouvel_acheteur("recu@ex.com")
        depot = self.virement(cookie, "CAU-2000")
        self.assertEqual(self.requete(f"/api/admin/deposits/{depot['id']}/confirm", {}, "POST", self.admin)[0], 400, "montant reçu obligatoire")
        self.assertEqual(self.confirmer(depot["id"], 1999.5)[0], 400, "nombre entier attendu")
        statut, data, _ = self.confirmer(depot["id"], 500)
        self.assertEqual(statut, 409, data)
        self.assertIn("différent", data["error"])
        self.assertEqual(self.solde(cookie), 0, "rien n'est crédité si le montant diffère")
        self.assertEqual(self.sql(f"SELECT status FROM deposits WHERE id = {depot['id']}"), [{"status": "pending"}])
        self.assertEqual(self.confirmer(depot["id"], 2000)[0], 200)
        self.assertEqual(self.confirmer(depot["id"], 2000)[0], 404, "pas de double crédit")
        self.assertEqual(self.solde(cookie), 2000)
        # Après crédit, une nouvelle demande ne porte que sur le complément et a sa propre référence.
        complement = self.virement(cookie, "CAU-3000")
        self.assertEqual(complement["amountTnd"], 1000)
        self.assertNotEqual(complement["reference"], depot["reference"])

    def test_carte_sans_taux_de_change(self):
        cookie, user_id = self.nouvel_acheteur("carte@ex.com")
        statut, data, _ = self.requete("/api/deposit/card", {"reference": "CAU-500"}, "POST", cookie)
        self.assertEqual(statut, 503, data)
        self.assertIn("taux de change non configuré", data["error"])
        self.assertEqual(self.sql(f"SELECT id FROM deposits WHERE user_id = {user_id}"), [], "aucune demande créée")

    def test_ajustement_manuel_journalise(self):
        cookie, user_id = self.nouvel_acheteur("ajuste@ex.com")
        chemin = f"/api/admin/users/{user_id}/deposit"
        self.assertEqual(self.requete(chemin, {"amountTnd": 1500}, "POST", self.admin)[0], 400, "motif obligatoire")
        self.assertEqual(self.requete(chemin, {"amountTnd": 1500, "reason": "   "}, "POST", self.admin)[0], 400, "motif vide")
        self.assertEqual(self.requete(chemin, {"amountTnd": 1500, "reason": "x" * 2001}, "POST", self.admin)[0], 400, "motif trop long")
        self.assertEqual(self.requete(chemin, {"amountTnd": 1500, "reason": "Test"}, "POST", cookie)[0], 403)
        self.assertEqual(self.solde(cookie), 0)
        self.assertEqual(self.sql(f"SELECT id FROM deposit_adjustments WHERE user_id = {user_id}"), [], "rien journalisé sans ajustement")
        statut, data, _ = self.requete(chemin, {"amountTnd": 1500, "reason": "  Virement reçu hors plateforme  "}, "POST", self.admin)
        self.assertEqual((statut, data), (200, {"userId": user_id, "depositTnd": 1500}))
        motif = "x" * 2000
        self.assertEqual(self.requete(chemin, {"amountTnd": 500, "reason": motif}, "POST", self.admin)[0], 200)
        journal = self.sql(f"SELECT previous_tnd, new_tnd, reason, actor_id, at FROM deposit_adjustments WHERE user_id = {user_id} ORDER BY id")
        self.assertEqual([(j["previous_tnd"], j["new_tnd"], j["reason"], j["actor_id"]) for j in journal],
                         [(0, 1500, "Virement reçu hors plateforme", self.admin_id), (1500, 500, motif, self.admin_id)])
        self.assertTrue(all(j["at"] for j in journal))
        self.assertEqual(self.solde(cookie), 500)
        self.assertEqual(self.requete("/api/admin/users/999999/deposit", {"amountTnd": 1, "reason": "Test"}, "POST", self.admin)[0], 404)
        self.assertEqual(self.sql("SELECT id FROM deposit_adjustments WHERE user_id = 999999"), [])


if __name__ == "__main__":
    unittest.main()
