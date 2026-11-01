"""Tests de bout en bout des enchères en direct (Worker + D1 local + navigateur).

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_encheres
Ignorés si la variable WRANGLER n'est pas définie.
"""
import json
import os
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

try:
    from test_administration import config_de_test, port_libre
except ImportError:
    from tests.test_administration import config_de_test, port_libre

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
MOT_DE_PASSE = "motdepasse-solide"


def dans(**delta):
    return (datetime.now(timezone.utc) + timedelta(**delta)).isoformat()


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class EncheresTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
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
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()
        for email in ("admin@ex.com", "alice@ex.com", "bob@ex.com"):
            assert cls.requete("/api/register", {"name": email.split("@")[0].title() + " Test", "email": email, "password": MOT_DE_PASSE}, "POST")[0] == 201
        subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config,
                        "--command", "UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'"], cwd=PROJET, check=True, capture_output=True)
        cls.cookies = {email: cls.connexion(email) for email in ("admin@ex.com", "alice@ex.com", "bob@ex.com")}

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    @classmethod
    def requete(cls, chemin, data=None, method=None, cookie=None):
        headers = {"Origin": cls.base}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        requete = urllib.request.Request(cls.base + chemin, data=None if data is None else json.dumps(data).encode(), method=method, headers=headers)
        try:
            with urllib.request.urlopen(requete) as reponse:
                return reponse.status, json.loads(reponse.read() or b"null"), reponse.headers.get("Set-Cookie")
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, json.loads(erreur.read() or b"null"), None

    @classmethod
    def connexion(cls, email):
        return cls.requete("/api/login", {"email": email, "password": MOT_DE_PASSE}, "POST")[2].split(";")[0]

    def creer_lot(self, reference, **champs):
        corps = {"make": "BMW", "model": "X5", "status": "open", "endsAt": dans(days=2), "startingPriceTnd": 100000, **champs}
        statut, data, _ = self.requete(f"/api/admin/vehicles/{reference}", corps, "PUT", self.cookies["admin@ex.com"])
        self.assertEqual(statut, 200, data)

    def encherir(self, email, reference, montant):
        return self.requete("/api/offers", {"reference": reference, "amount": montant}, "POST", self.cookies[f"{email}@ex.com"])

    def enchere(self, reference):
        return self.requete(f"/api/auctions/{reference}", cookie=self.cookies["alice@ex.com"])[1]

    def test_regles_du_montant_minimum(self):
        self.creer_lot("ENC-1")
        statut, data, _ = self.encherir("alice", "ENC-1", 99000)
        self.assertEqual((statut, data["error"]), (400, "L'enchère minimale est de 100000 TND."))
        self.assertEqual(self.encherir("alice", "ENC-1", 100000)[0], 201)
        etat = self.enchere("ENC-1")["auction"]
        self.assertEqual((etat["currentBidTnd"], etat["incrementTnd"], etat["minNextBidTnd"], etat["bidCount"]), (100000, 1000, 101000, 1))
        self.assertEqual(self.encherir("bob", "ENC-1", 100500)[0], 400, "sous le pas minimum")
        self.assertEqual(self.encherir("bob", "ENC-1", 101000)[0], 201)
        self.assertEqual(self.encherir("alice", "ENC-1", 101000.5)[0], 400, "montant non entier")

    def test_historique_anonyme_et_statuts_acheteurs(self):
        self.creer_lot("ENC-2", reservePriceTnd=105000)
        self.encherir("alice", "ENC-2", 100000)
        self.encherir("bob", "ENC-2", 102000)
        detail = self.enchere("ENC-2")
        self.assertEqual([(b["amountTnd"], b["bidder"], b["you"]) for b in detail["bids"]],
                         [(102000, "Enchérisseur 2", False), (100000, "Enchérisseur 1", True)])
        self.assertNotIn("email", json.dumps(detail))
        self.assertIs(detail["auction"]["reserveMet"], False)
        alice = self.requete("/api/me", cookie=self.cookies["alice@ex.com"])[1]
        self.assertEqual([o["status"] for o in alice["offers"] if o["reference"] == "ENC-2"], ["outbid"])
        bob = self.requete("/api/me", cookie=self.cookies["bob@ex.com"])[1]
        self.assertEqual([o["status"] for o in bob["offers"] if o["reference"] == "ENC-2"], ["leading"])
        admin = self.requete("/api/admin/auctions/ENC-2", cookie=self.cookies["admin@ex.com"])[1]
        self.assertEqual(admin["bids"][0]["email"], "bob@ex.com")
        self.assertEqual(self.requete("/api/admin/auctions/ENC-2", cookie=self.cookies["bob@ex.com"])[0], 403)

    def test_prolongation_anti_derniere_seconde(self):
        self.creer_lot("ENC-3", endsAt=dans(seconds=30))
        self.assertEqual(self.encherir("alice", "ENC-3", 100000)[0], 201)
        etat = self.enchere("ENC-3")["auction"]
        self.assertTrue(etat["extended"])
        restant = datetime.fromisoformat(etat["endsAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)
        self.assertGreater(restant, timedelta(seconds=100))

    def test_vente_terminee_et_lot_a_venir_refuses(self):
        self.creer_lot("ENC-4", endsAt=dans(seconds=3))
        time.sleep(4)
        statut, data, _ = self.encherir("alice", "ENC-4", 100000)
        self.assertEqual((statut, data["error"]), (400, "La vente de ce lot est terminée."))
        self.creer_lot("ENC-5", status="upcoming", endsAt=None)
        self.assertEqual(self.encherir("alice", "ENC-5", 100000)[1]["error"], "Les enchères de ce lot ne sont pas encore ouvertes.")
        self.creer_lot("ENC-6", status="stock", endsAt=None)
        self.assertEqual(self.encherir("alice", "ENC-6", 100000)[0], 400)

    def test_gagnant_et_reserve_apres_la_fin(self):
        self.creer_lot("ENC-7", endsAt=dans(seconds=3), reservePriceTnd=100000)
        self.encherir("alice", "ENC-7", 100000)
        # L'enchère a prolongé la vente de 2 minutes : on ramène la fin dans le passé directement en base.
        subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", self.persist, "-c", self.config, "--command",
                        "UPDATE offers SET created_at = '2000-01-01T00:00:00.000Z' WHERE reference = 'ENC-7'"], cwd=PROJET, check=True, capture_output=True)
        time.sleep(3)
        alice = self.requete("/api/me", cookie=self.cookies["alice@ex.com"])[1]
        self.assertEqual([o["status"] for o in alice["offers"] if o["reference"] == "ENC-7"], ["won"])

    def test_deux_encheres_simultanees_une_seule_acceptee(self):
        self.creer_lot("ENC-8")
        resultats = []
        fils = [threading.Thread(target=lambda e=e: resultats.append(self.encherir(e, "ENC-8", 100000)[0])) for e in ("alice", "bob")]
        for fil in fils:
            fil.start()
        for fil in fils:
            fil.join()
        # Selon l'ordre d'arrivée, la seconde est refusée par la vérification préalable (400) ou par la base (409).
        self.assertEqual(resultats.count(201), 1, resultats)
        self.assertIn(min(set(resultats) - {201}), (400, 409))
        self.assertEqual(self.enchere("ENC-8")["auction"]["bidCount"], 1)

    def test_parcours_dans_le_navigateur(self):
        self.creer_lot("ENC-9", make="Audi", model="Q7", reservePriceTnd=101000)
        context = self.browser.new_context(viewport={"width": 390, "height": 844})
        self.addCleanup(context.close)
        page = context.new_page()
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(self.base + "/")
        page.wait_for_function("catalogueEtat === 'ready' && compte.disponible")
        carte = page.locator(".lot-card", has_text="ENC-9")
        self.assertIn("Fin dans", carte.locator(".auction-line").text_content())
        carte.get_by_text("Voir la fiche").click()
        page.click("[data-offer-login]")
        page.fill("#login-email", "alice@ex.com")
        page.fill("#login-password", MOT_DE_PASSE)
        page.click("#login-form [type=submit]")
        page.wait_for_selector("#auction-panel .bid-form")
        self.assertEqual(page.input_value("#offer-amount"), "100000")
        page.click("[data-quick='101000']")
        page.click("#auction-panel [type=submit]")
        page.wait_for_function("document.querySelector('#auction-panel .auction-head strong')?.textContent.includes('101')")
        self.assertIn("Vous êtes le meilleur enchérisseur", page.text_content("#auction-panel"))
        self.assertIn("Réserve atteinte", page.text_content("#auction-panel"))
        self.assertIn("Enchérisseur 1 (vous)", page.text_content(".bid-history"))
        # Bob surenchérit : le panneau d'Alice se met à jour tout seul.
        self.assertEqual(self.encherir("bob", "ENC-9", 102000)[0], 201)
        page.wait_for_function("document.querySelector('#auction-panel .auction-head strong')?.textContent.includes('102')", timeout=15000)
        self.assertNotIn("Vous êtes le meilleur enchérisseur", page.text_content("#auction-panel"))
        self.assertEqual(page.input_value("#offer-amount"), "103000")


if __name__ == "__main__":
    unittest.main()
