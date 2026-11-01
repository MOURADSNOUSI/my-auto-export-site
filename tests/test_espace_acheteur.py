"""Tests de bout en bout de l'espace acheteur (Worker + D1 locale + navigateur).

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_espace_acheteur
Ignorés si la variable WRANGLER n'est pas définie.
"""
import json
import os
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")


def port_libre():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class EspaceAcheteurTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        persist = cls.tmp.name
        subprocess.run([WRANGLER, "d1", "migrations", "apply", "DB", "--local", "--persist-to", persist],
                       cwd=PROJET, check=True, capture_output=True)
        port = port_libre()
        cls.base = f"http://localhost:{port}"
        cls.serveur = subprocess.Popen([WRANGLER, "dev", "--local", "--port", str(port), "--persist-to", persist],
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

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    def nouvelle_page(self):
        context = self.browser.new_context()
        self.addCleanup(context.close)
        page = context.new_page()
        page.goto(self.base + "/")
        page.wait_for_function("catalogueEtat !== 'loading' && compte.disponible")
        return page

    def inscrire(self, page, email, nom="Amine Test"):
        page.click(".account-chip")
        page.click("[data-auth='register']")
        page.fill("#register-name", nom)
        page.fill("#register-email", email)
        page.fill("#register-password", "motdepasse-solide")
        page.click("#register-form [type=submit]")
        page.wait_for_function("compte.user !== null")
        # Inscription lancée depuis le bouton du compte : la page personnelle s'ouvre ensuite.
        page.wait_for_selector("#account-dialog[open]")
        page.keyboard.press("Escape")

    def post(self, chemin, data, origine=None):
        requete = urllib.request.Request(self.base + chemin, data=json.dumps(data).encode(), method="POST",
                                         headers={"Content-Type": "application/json", "Origin": origine or self.base})
        try:
            with urllib.request.urlopen(requete) as reponse:
                return reponse.status
        except urllib.error.HTTPError as erreur:
            return erreur.code

    def test_inscription_connexion_et_page_personnelle(self):
        page = self.nouvelle_page()
        self.assertIn("Se connecter", page.text_content("#account-label"))
        self.inscrire(page, "amine@example.com")
        self.assertIn("Amine #", page.text_content("#account-label"))
        page.click(".account-chip")
        self.assertIn("amine@example.com", page.text_content("#account-body"))
        self.assertIn("Mes véhicules", page.text_content("#account-body"))
        self.assertIn("Mes offres", page.text_content("#account-body"))
        self.assertIn("Mes favoris", page.text_content("#account-body"))
        self.assertIn("Factures", page.text_content("#account-body"))
        self.assertIn("Aucune facture associée à ce compte", page.text_content("#account-body"))
        self.assertEqual(page.evaluate("[compte.vehicles.length, compte.invoices.length]"), [0, 0])
        page.click("[data-logout]")
        page.wait_for_function("compte.user === null")
        self.assertIn("Se connecter", page.text_content("#account-label"))
        page.reload()
        page.wait_for_function("catalogueEtat !== 'loading' && compte.disponible")
        self.assertIsNone(page.evaluate("compte.user"), "la session doit être fermée côté serveur")

        page.click(".account-chip")
        page.fill("#login-email", "amine@example.com")
        page.fill("#login-password", "mauvais")
        page.click("#login-form [type=submit]")
        page.wait_for_selector("#login-form .form-error:not([hidden])")
        self.assertIn("incorrect", page.text_content("#login-form .form-error"))
        page.fill("#login-password", "motdepasse-solide")
        page.click("#login-form [type=submit]")
        page.wait_for_function("compte.user !== null")
        page.wait_for_selector("#account-dialog[open]")
        document_status = page.evaluate("async () => (await fetch('/api/invoices/1/document')).status")
        self.assertEqual(document_status, 404)

    def test_documents_facture_refuses_sans_session(self):
        for path in ("/api/me", "/api/invoices/1/document"):
            request = urllib.request.Request(self.base + path, method="GET")
            with self.assertRaises(urllib.error.HTTPError) as response:
                urllib.request.urlopen(request)
            self.assertEqual(response.exception.code, 401)

    def test_email_deja_utilise(self):
        page = self.nouvelle_page()
        self.inscrire(page, "double@example.com")
        autre = self.nouvelle_page()
        autre.click(".account-chip")
        autre.click("[data-auth='register']")
        autre.fill("#register-name", "Autre")
        autre.fill("#register-email", "double@example.com")
        autre.fill("#register-password", "motdepasse-solide")
        autre.click("#register-form [type=submit]")
        autre.wait_for_selector("#register-form .form-error:not([hidden])")
        self.assertIn("existe déjà", autre.text_content("#register-form .form-error"))

    def test_favoris_conserves_par_le_compte(self):
        page = self.nouvelle_page()
        self.inscrire(page, "favoris@example.com")
        page.locator(".lot-card", has_text="MY-0001").locator("[data-watch]").click()
        page.wait_for_timeout(500)
        autre = self.nouvelle_page()
        autre.click(".account-chip")
        autre.fill("#login-email", "favoris@example.com")
        autre.fill("#login-password", "motdepasse-solide")
        autre.click("#login-form [type=submit]")
        autre.wait_for_function("compte.user !== null")
        self.assertEqual(autre.evaluate("[...watchlist]"), ["MY-0001"])
        self.assertIn("Jeep", autre.text_content("#account-body"))
        self.assertEqual(autre.text_content("#nav-favorites-count"), "1")

    def test_enchere_a_venir_pas_encore_ouverte(self):
        # Le parcours d'enchère complet est testé dans test_encheres.py.
        page = self.nouvelle_page()
        page.locator(".lot-card", has_text="MY-0001").get_by_text("Voir la fiche").click()
        page.wait_for_selector("#auction-panel")
        self.assertIn("pas encore ouvertes", page.text_content("#auction-panel"))
        self.assertEqual(page.locator("#auction-panel .bid-form").count(), 0)

    def test_pas_d_offre_sur_un_vehicule_en_stock(self):
        page = self.nouvelle_page()
        page.locator(".lot-card", has_text="7753628").get_by_text("Voir la fiche").click()
        self.assertEqual(page.locator("#lot-dialog .offer-form").count(), 0)

    def test_api_refuse_les_requetes_d_un_autre_site(self):
        self.assertEqual(self.post("/api/register", {"name": "X Y", "email": "csrf@example.com", "password": "motdepasse-solide"},
                                   origine="https://pirate.example"), 403)

    def test_limite_les_essais_de_mot_de_passe(self):
        codes = [self.post("/api/login", {"email": "inconnu@example.com", "password": "faux"}) for _ in range(6)]
        self.assertEqual(codes, [401] * 5 + [429])


if __name__ == "__main__":
    unittest.main()
