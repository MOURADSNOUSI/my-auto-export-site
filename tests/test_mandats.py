"""Tests de l'achat sur mandat (chantier 4) : ouverture par le réglage mandats_actifs, demande du client, suivi et
annulation, passages de statut par l'administration, outils MCP lister_mandats et mettre_a_jour_mandat, formulaire mobile.

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_mandats
Ignorés si la variable WRANGLER n'est pas définie. Captures dans MANDATS_CAPTURES si la variable est définie.
"""
import json
import os
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

try:
    from test_administration import config_de_test, port_libre
except ImportError:
    from tests.test_administration import config_de_test, port_libre

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
CAPTURES = os.environ.get("MANDATS_CAPTURES")
MOT_DE_PASSE = "motdepasse-solide"
JETON_AGENT = "jeton-agent-de-test-" + "m" * 32
ANNEE = date.today().year
VEHICULES = {
    "MDT-JEUNE": {"make": "Peugeot", "model": "308", "status": "stock", "year": ANNEE - 1, "mileageKm": 20000, "fuel": "Essence", "engineCc": 1200, "prixEur": 15000},
    "MDT-VIEUX": {"make": "Fiat", "model": "Punto", "status": "stock", "year": ANNEE - 11, "mileageKm": 150000, "fuel": "Essence", "engineCc": 1200, "prixEur": 2500},
    "MDT-AUTRE": {"make": "Kia", "model": "Rio", "status": "stock", "year": ANNEE - 2, "mileageKm": 30000},
}


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class MandatsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        # Mode de production (wrangler.jsonc) : propositions seules, enchères désactivées.
        config = json.loads(Path(cls.config).read_text())
        config["vars"]["LEGACY_AUCTIONS_ENABLED"] = "false"
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
        cls.cookie = cls.compte("admin@ex.com", "Admin Test")
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'")
        cls.client = cls.compte("client@ex.com", "Client Test")
        cls.autre = cls.compte("autre@ex.com", "Autre Client")
        assert cls.api("/api/admin/prix/taux-manuel", {"valeur": 3.4, "actif": True}, "PUT", cls.cookie)[0] == 200
        for reference, vehicule in VEHICULES.items():
            statut, data, _ = cls.api(f"/api/admin/vehicles/{reference}", vehicule, "PUT", cls.cookie)
            assert statut == 200, (reference, statut, data)
        cls.fiches = {lot["reference"]: lot["url"] for lot in cls.api("/api/catalogue")[1]}
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    @classmethod
    def compte(cls, email, nom):
        assert cls.api("/api/register", {"name": nom, "email": email, "password": MOT_DE_PASSE}, "POST")[0] == 201
        return cls.api("/api/login", {"email": email, "password": MOT_DE_PASSE}, "POST")[2]["Set-Cookie"].split(";")[0]

    @classmethod
    def sql(cls, commande):
        sortie = subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--json",
                                 "--command", commande], cwd=PROJET, check=True, capture_output=True, text=True).stdout
        return json.loads(sortie)[0]["results"]

    @classmethod
    def api(cls, chemin, data=None, method=None, cookie=None):
        headers = {"Origin": cls.base, "CF-Connecting-IP": "10.0.0.4", "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        requete = urllib.request.Request(cls.base + chemin, data=None if data is None else json.dumps(data).encode(), method=method, headers=headers)
        try:
            with urllib.request.urlopen(requete) as reponse:
                corps = reponse.read()
                return reponse.status, json.loads(corps) if "json" in reponse.headers.get("Content-Type", "") else corps.decode(), reponse.headers
        except urllib.error.HTTPError as erreur:
            with erreur:
                corps = erreur.read()
                return erreur.code, json.loads(corps) if "json" in erreur.headers.get("Content-Type", "") else corps.decode(), erreur.headers

    @classmethod
    def outil(cls, nom, arguments=None):
        """Appel MCP tools/call avec le jeton de l'agent local : résultat JSON-RPC."""
        corps = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": nom, "arguments": arguments or {}}}
        requete = urllib.request.Request(cls.base + "/mcp", data=json.dumps(corps).encode(), method="POST",
                                         headers={"Authorization": f"Bearer {JETON_AGENT}", "Content-Type": "application/json"})
        with urllib.request.urlopen(requete) as reponse:
            return json.loads(reponse.read())["result"]

    def regler(self, cle, valeur, route="site"):
        statut, data, _ = self.api(f"/api/admin/{route}/{cle}", {"valeur": valeur}, "PUT", self.cookie)
        self.assertEqual(statut, 200, data)

    def fiche(self, reference):
        requete = urllib.request.Request(self.base + self.fiches[reference], headers={"Accept": "text/html"})
        with urllib.request.urlopen(requete) as reponse:
            return reponse.read().decode()

    def demande(self, cookie=None, **champs):
        corps = {"reference": "MDT-JEUNE", "public": "resident", "prixMax": 60000, "telephone": "+216 12 345 678", "accepte": True, **champs}
        return self.api("/api/mandats", corps, "POST", cookie or self.client)

    def admin(self, mandat_id, **corps):
        return self.api(f"/api/admin/mandats/{mandat_id}", corps, "PUT", self.cookie)

    def mandat_admin(self, mandat_id):
        return next(m for m in self.api("/api/admin/mandats", cookie=self.cookie)[1]["mandats"] if m["id"] == mandat_id)

    def setUp(self):
        self.regler("mandats_actifs", True)
        self.regler("prix_resident_actif", False)
        self.regler("automations_actives", True, "reglages")
        self.regler("agent_ecriture_autorisee", False, "reglages")
        # Chaque test part sans demande en cours (lignes de test uniquement, base locale jetable).
        self.sql("UPDATE mandats SET statut = 'annule' WHERE statut NOT IN ('non_obtenu', 'livre', 'annule')")

    # --- Ouverture au public ---

    def test_mandats_fermes_par_defaut_gardent_les_offres(self):
        self.regler("mandats_actifs", False)
        html = self.fiche("MDT-JEUNE")
        self.assertIn('data-proposal-ref="MDT-JEUNE"', html)
        self.assertNotIn("data-mandat-ref", html)
        self.assertFalse(next(l for l in self.api("/api/catalogue")[1] if l["reference"] == "MDT-JEUNE")["mandat"])
        self.assertEqual(self.api("/api/mandats/formulaire/MDT-JEUNE")[0], 404)
        self.assertEqual(self.demande()[0], 404)

    def test_mandats_ouverts_remplacent_la_proposition(self):
        html = self.fiche("MDT-JEUNE")
        self.assertIn('data-mandat-ref="MDT-JEUNE"', html)
        self.assertIn("Je confie le mandat", html)
        self.assertNotIn('data-proposal-ref="MDT-JEUNE"', html)
        self.assertTrue(next(l for l in self.api("/api/catalogue")[1] if l["reference"] == "MDT-JEUNE")["mandat"])
        statut, data, _ = self.api("/api/mandats/formulaire/MDT-JEUNE")
        self.assertEqual(statut, 200)
        self.assertEqual(data["vehicule"], {"reference": "MDT-JEUNE", "titre": "Peugeot 308"})
        for cle in ("mandat", "cgv", "acompte"):
            self.assertIn("À FAIRE RELIRE PAR UN JURISTE", data["textes"][cle])
        self.assertEqual(data["libelles"]["mandat_bouton"], "Je confie le mandat")
        self.assertEqual(self.api("/api/mandats/formulaire/INCONNU")[0], 404)

    # --- Demande du client ---

    def test_demande_controlee(self):
        self.assertEqual(self.api("/api/mandats", {"reference": "MDT-JEUNE"}, "POST")[0], 401)
        self.assertEqual(self.demande(accepte=False)[0], 400)
        self.assertEqual(self.demande(prixMax="60000")[0], 400)
        self.assertEqual(self.demande(public="tre")[0], 400, "pays et réponse FCR obligatoires")
        statut, data, _ = self.demande()
        self.assertEqual(statut, 201, data)
        self.assertEqual(self.demande()[0], 409, "une seule demande en cours par véhicule")
        ligne = self.sql(f"SELECT devise, prix_max, telephone, textes_acceptes, statut FROM mandats WHERE id = {data['id']}")[0]
        self.assertEqual((ligne["devise"], ligne["prix_max"], ligne["telephone"], ligne["statut"]), ("TND", 60000, "+21612345678", "demande"))
        self.assertIn("À FAIRE RELIRE PAR UN JURISTE", json.loads(ligne["textes_acceptes"])["mandat"])

    def test_suivi_client_sans_donnees_internes(self):
        _, data, _ = self.demande(public="tre", paysResidence="France", fcrDejaUtilise=False, prixMax=18000)
        statut, suivi, _ = self.api("/api/mandats", cookie=self.client)
        self.assertEqual(statut, 200)
        mandat = next(m for m in suivi["mandats"] if m["id"] == data["id"])
        self.assertEqual((mandat["devise"], mandat["prixMax"], mandat["statut"], mandat["annulable"]), ("EUR", 18000, "demande", True))
        for cle in ("telephone", "noteAdmin", "client", "reponses", "eligibiliteAuto"):
            self.assertNotIn(cle, mandat)
        # Un autre client ne voit ni n'annule la demande.
        self.assertNotIn(data["id"], [m["id"] for m in self.api("/api/mandats", cookie=self.autre)[1]["mandats"]])
        self.assertEqual(self.api(f"/api/mandats/{data['id']}/annuler", {}, "POST", self.autre)[0], 404)

    def test_eligibilite_resident(self):
        # Règles résident non publiées : la demande passe, le motif est transmis à l'administration.
        statut, data, _ = self.demande(reference="MDT-VIEUX")
        self.assertEqual(statut, 201, data)
        self.assertIn("ans", self.mandat_admin(data["id"])["eligibiliteAuto"])
        self.api(f"/api/mandats/{data['id']}/annuler", {}, "POST", self.client)
        # Règles publiées (prix_resident_actif) : un véhicule non éligible est refusé.
        self.regler("prix_resident_actif", True)
        statut, data, _ = self.demande(reference="MDT-VIEUX")
        self.assertEqual(statut, 400)
        self.assertIn("Réservé aux Tunisiens résidant à l'étranger", data["error"])
        self.assertEqual(self.demande(reference="MDT-JEUNE")[0], 201)

    # --- Administration ---

    def test_parcours_admin_et_annulation(self):
        _, data, _ = self.demande()
        mandat_id = data["id"]
        statut, data, _ = self.admin(mandat_id, statut="acompte_recu")
        self.assertEqual(statut, 409, "saut d'étape refusé")
        # Acompte par défaut (1 000 TND, migration 0021) appliqué au passage à « éligibilité vérifiée ».
        statut, data, _ = self.admin(mandat_id, statut="eligibilite_verifiee")
        self.assertEqual((statut, data["acompte"]), (200, 1000), data)
        self.assertEqual(self.admin(mandat_id, acompte=1500)[1]["acompte"], 1500)
        self.assertEqual(self.admin(mandat_id, statut="acompte_recu", note="Virement reçu")[0], 200)
        self.assertEqual(self.admin(mandat_id, acompte=2000)[0], 409, "acompte figé une fois reçu")
        self.assertEqual(self.api(f"/api/mandats/{mandat_id}/annuler", {}, "POST", self.client)[0], 409, "annulation client impossible après l'acompte")
        mandat = self.mandat_admin(mandat_id)
        self.assertEqual((mandat["statut"], mandat["noteAdmin"], mandat["suivants"]), ("acompte_recu", "Virement reçu", ["achat_en_cours", "annule"]))
        self.assertEqual([(e["de"], e["vers"], e["acteur"]) for e in mandat["evenements"]],
                         [("", "demande", "client"), ("demande", "eligibilite_verifiee", "admin"), ("eligibilite_verifiee", "acompte_recu", "admin")])
        self.assertTrue(self.sql(f"SELECT id FROM audit_logs WHERE action = 'PUT /api/admin/mandats/{mandat_id}' AND acteur = 'admin' AND resultat = 'ok'"))
        self.assertEqual(self.api("/api/admin/mandats", cookie=self.client)[0], 403)
        self.assertEqual(self.api("/api/admin/mandats?statut=inconnu", cookie=self.cookie)[0], 400)
        # Le client annule lui-même une demande pas encore réglée.
        _, autre, _ = self.demande(reference="MDT-AUTRE")
        self.assertEqual(self.api(f"/api/mandats/{autre['id']}/annuler", {}, "POST", self.client)[1]["statut"], "annule")
        self.assertEqual(self.admin(autre["id"], statut="demande")[0], 409, "annulation définitive")

    # --- MCP ---

    def test_outils_mcp(self):
        _, data, _ = self.demande()
        mandat_id = data["id"]
        liste = json.loads(self.outil("lister_mandats", {"statut": "demande"})["content"][0]["text"])
        self.assertIn(mandat_id, [m["id"] for m in liste])
        self.assertTrue(self.outil("lister_mandats", {"statut": "inconnu"})["isError"])
        # Écriture refusée tant que l'agent est en lecture seule, puis sans confirmation.
        resultat = self.outil("mettre_a_jour_mandat", {"mandat_id": mandat_id, "statut": "eligibilite_verifiee", "confirmer": True})
        self.assertTrue(resultat["isError"])
        self.regler("agent_ecriture_autorisee", True, "reglages")
        resultat = self.outil("mettre_a_jour_mandat", {"mandat_id": mandat_id, "statut": "eligibilite_verifiee"})
        self.assertIn("confirmer", resultat["content"][0]["text"])
        resultat = self.outil("mettre_a_jour_mandat", {"mandat_id": mandat_id, "statut": "eligibilite_verifiee", "acompte": 800, "confirmer": True})
        self.assertNotIn("isError", resultat, resultat)
        self.assertEqual(json.loads(resultat["content"][0]["text"]), {"id": mandat_id, "statut": "eligibilite_verifiee", "acompte": 800})
        self.assertEqual(self.mandat_admin(mandat_id)["evenements"][-1]["acteur"], "agent")
        journal = self.sql(f"SELECT acteur, resultat FROM audit_logs WHERE action = 'mcp.mettre_a_jour_mandat' AND resource_id = 'mandat-{mandat_id}' ORDER BY id")
        self.assertEqual([(l["acteur"], l["resultat"]) for l in journal], [("agent", "refuse"), ("agent", "erreur"), ("agent", "ok")])

    # --- Formulaire mobile ---

    def test_formulaire_mobile(self):
        contexte = self.browser.new_context(viewport={"width": 390, "height": 844}, base_url=self.base)
        nom, valeur = self.client.split("=", 1)
        contexte.add_cookies([{"name": nom, "value": valeur, "url": self.base}])
        page = contexte.new_page()
        erreurs = []
        page.on("pageerror", lambda e: erreurs.append(str(e)))
        page.goto(self.fiches["MDT-AUTRE"])
        page.get_by_role("button", name="Je confie le mandat").click()
        dialogue = page.locator("#mandat-dialog")
        expect(dialogue).to_contain_text("Demande d'achat sur mandat")
        expect(dialogue.locator("#mandat-auth")).to_be_hidden()
        self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 390)
        dialogue.get_by_label("À l'étranger").check()
        dialogue.get_by_label("Pays de résidence").fill("Allemagne")
        dialogue.get_by_label("Non", exact=True).check()
        dialogue.get_by_label("Prix maximum accepté (€)").fill("14 000")
        dialogue.get_by_label("Téléphone ou WhatsApp").fill("+49 151 2345678")
        dialogue.get_by_label("J'ai lu et j'accepte").check()
        if CAPTURES:
            page.screenshot(path=f"{CAPTURES}/formulaire-390.png", full_page=True)
        dialogue.get_by_role("button", name="Envoyer ma demande").click()
        expect(dialogue).to_contain_text("Demande envoyée")
        ligne = self.sql("SELECT devise, prix_max, reponses FROM mandats WHERE reference = 'MDT-AUTRE' ORDER BY id DESC LIMIT 1")[0]
        self.assertEqual((ligne["devise"], ligne["prix_max"], json.loads(ligne["reponses"])), ("EUR", 14000, {"paysResidence": "Allemagne", "fcrDejaUtilise": False}))
        page.goto("/mes-mandats")
        expect(page.locator(".mandat").first).to_contain_text("Kia Rio")
        expect(page.locator(".etapes .actuel").first).to_have_text("Demande reçue")
        self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 390)
        if CAPTURES:
            page.screenshot(path=f"{CAPTURES}/mes-mandats-390.png", full_page=True)
            admin = self.browser.new_page(viewport={"width": 390, "height": 844})
            nom, valeur = self.cookie.split("=", 1)
            admin.context.add_cookies([{"name": nom, "value": valeur, "url": self.base}])
            admin.goto(self.base + "/admin-mandats")
            expect(admin.locator(".mandat").first).to_be_visible()
            admin.screenshot(path=f"{CAPTURES}/admin-mandats-390.png", full_page=True)
            admin.close()
        self.assertEqual(erreurs, [])
        contexte.close()


if __name__ == "__main__":
    unittest.main()
