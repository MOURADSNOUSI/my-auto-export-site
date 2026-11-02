"""Tests de bout en bout de l'administration (/admin.html, Worker + D1 + R2 locaux).

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_administration
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
LOGO = PROJET / "my-auto-export" / "logo.png"
MOT_DE_PASSE = "motdepasse-solide"


def config_de_test(dossier):
    """wrangler.jsonc avec chemins absolus et un stockage R2 local, pour tester l'envoi de photos."""
    texte = "\n".join(ligne for ligne in (PROJET / "wrangler.jsonc").read_text().splitlines() if not ligne.strip().startswith("//"))
    config = json.loads(texte)
    config["main"] = str(PROJET / config["main"])
    config["assets"]["directory"] = str(PROJET / config["assets"]["directory"])
    for base in config["d1_databases"]:
        base["migrations_dir"] = str(PROJET / base["migrations_dir"])
    config["r2_buckets"] = [{"binding": "PHOTOS", "bucket_name": "my-auto-export-photos"}]
    chemin = Path(dossier) / "wrangler.test.json"
    chemin.write_text(json.dumps(config))
    return str(chemin)


def port_libre():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class AdministrationTest(unittest.TestCase):
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
        cls.creer_compte("admin@example.com")
        cls.creer_compte("acheteur@example.com")
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'")

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, commande):
        subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--command", commande],
                       cwd=PROJET, check=True, capture_output=True)

    @classmethod
    def requete(cls, chemin, data=None, method=None, cookie=None, origine=None):
        headers = {"Origin": origine or cls.base}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        requete = urllib.request.Request(cls.base + chemin, data=None if data is None else json.dumps(data).encode(),
                                         method=method, headers=headers)
        try:
            with urllib.request.urlopen(requete) as reponse:
                return reponse.status, json.loads(reponse.read() or b"null"), reponse.headers.get("Set-Cookie")
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, json.loads(erreur.read() or b"null"), None

    @classmethod
    def creer_compte(cls, email):
        statut, _, _ = cls.requete("/api/register", {"name": "Compte Test", "email": email, "password": MOT_DE_PASSE}, "POST")
        assert statut == 201, statut

    @classmethod
    def cookie(cls, email):
        _, _, set_cookie = cls.requete("/api/login", {"email": email, "password": MOT_DE_PASSE}, "POST")
        return set_cookie.split(";")[0]

    def page_admin(self, email="admin@example.com"):
        context = self.browser.new_context(bypass_csp=True, viewport={"width": 390, "height": 844})
        self.addCleanup(context.close)
        page = context.new_page()
        page.goto(self.base + "/admin.html")
        page.wait_for_selector("#login-view:not(.hidden)")
        page.fill("#login-email", email)
        page.fill("#login-password", MOT_DE_PASSE)
        page.click("#login-form [type=submit]")
        return page

    def catalogue_public(self):
        return {lot["reference"]: lot for lot in self.requete("/api/catalogue")[1]}

    def test_acheteur_n_a_pas_acces(self):
        page = self.page_admin("acheteur@example.com")
        page.wait_for_selector("#denied-view:not(.hidden)")
        statut, data, _ = self.requete("/api/admin/vehicles", cookie=self.cookie("acheteur@example.com"))
        self.assertEqual(statut, 403)
        self.assertEqual(self.requete("/api/admin/vehicles")[0], 401)

    def test_ajout_d_un_vehicule_avec_photo_depuis_le_telephone(self):
        page = self.page_admin()
        page.wait_for_selector("#list-view:not(.hidden)")
        page.click("#add-vehicle")
        page.fill("#f-reference", "MY-ADM-1")
        page.fill("#f-make", "Toyota")
        page.fill("#f-model", "Land Cruiser")
        page.fill("#f-year", "2021")
        page.fill("#f-mileageKm", "64000")
        page.fill("#f-indicativePriceTnd", "185000")
        page.fill("#f-pickupLocation", "Tunis")
        page.fill("#f-specs", "Transmission : Automatique\nligne sans deux-points")
        page.set_input_files("#photo-input", [str(LOGO), str(LOGO)])
        page.wait_for_function("document.querySelectorAll('#photo-grid .photo:not(.pending)').length === 2 && etat.envois === 0")
        page.click("#photo-grid [data-move='1'][data-index='0']")
        page.click("#save")
        page.wait_for_selector("#flash:not(.hidden)")

        lot = self.catalogue_public()["MY-ADM-1"]
        self.assertEqual((lot["make"], lot["status"], lot["indicativePriceTnd"], lot["pickupLocation"]), ("Toyota", "stock", 185000, "Tunis"))
        self.assertEqual(lot["specs"], [["Transmission", "Automatique"]])
        self.assertEqual(len(lot["photos"]), 2)
        self.assertTrue(all(p["url"].startswith("/media/vehicules/MY-ADM-1/") and p["authorized"] for p in lot["photos"]))

        site = self.browser.new_page(bypass_csp=True)
        self.addCleanup(site.close)
        site.goto(self.base + "/")
        site.wait_for_function("catalogueEtat === 'ready'")
        carte = site.locator(".lot-card", has_text="MY-ADM-1")
        carte.scroll_into_view_if_needed()
        site.wait_for_function("[...document.querySelectorAll('.lot-card img')].some(i => i.src.includes('/media/') && i.complete && i.naturalWidth > 0)")
        self.assertIn("185", carte.locator(".lot-price").text_content())

    def test_modifier_retirer_et_remettre_un_vehicule_de_lots_json(self):
        page = self.page_admin()
        page.wait_for_selector("#list-view:not(.hidden)")
        page.fill("#search", "MY-0001")
        page.click("[data-edit='MY-0001']")
        self.assertTrue(page.is_disabled("#f-reference") or page.get_attribute("#f-reference", "readonly") is not None)
        page.fill("#f-reservePriceTnd", "199000")
        page.fill("#f-seller", "M&Y AUTO EXPORT")
        page.click("#save")
        page.wait_for_selector("#flash:not(.hidden)")
        jeep = self.catalogue_public()["MY-0001"]
        self.assertEqual((jeep["reservePriceTnd"], jeep["seller"]), (199000, "M&Y AUTO EXPORT"))
        self.assertEqual(len(jeep["photos"]), 20, "les photos du fichier doivent être conservées")

        page.on("dialog", lambda dialog: dialog.accept())
        page.click("[data-remove='MY-0001']")
        page.wait_for_selector("#flash:not(.hidden)")
        self.assertNotIn("MY-0001", self.catalogue_public())
        page.select_option("#show", "removed")
        page.click("[data-restore='MY-0001']")
        page.wait_for_function("document.getElementById('flash').textContent.includes('remis en ligne')")
        self.assertEqual(self.catalogue_public()["MY-0001"]["reservePriceTnd"], 199000)

    def test_offre_sur_un_vehicule_ajoute_par_l_administration(self):
        cookie = self.cookie("admin@example.com")
        statut, _, _ = self.requete("/api/admin/vehicles/MY-ADM-2", {
            "make": "BMW", "model": "X5", "status": "open", "endsAt": "2099-01-01T12:00:00Z", "startingPriceTnd": 100000
        }, "PUT", cookie)
        self.assertEqual(statut, 200)
        acheteur = self.cookie("acheteur@example.com")
        self.assertEqual(self.requete("/api/terms", {"version": "2026-11-01"}, "POST", acheteur)[0], 200)
        self.sql("UPDATE users SET deposit_tnd = 1000000 WHERE email = 'acheteur@example.com'")
        statut, data, _ = self.requete("/api/offers", {"reference": "MY-ADM-2", "amount": 120000}, "POST", acheteur)
        self.assertEqual(statut, 201, data)

    def test_donnees_invalides_refusees(self):
        cookie = self.cookie("admin@example.com")
        cas = {
            "enchère sans date": ("MY-BAD", {"make": "A", "model": "B", "status": "open"}),
            "statut inconnu": ("MY-BAD", {"make": "A", "model": "B", "status": "vendu"}),
            "sans marque": ("MY-BAD", {"model": "B", "status": "stock"}),
            "photo javascript": ("MY-BAD", {"make": "A", "model": "B", "status": "stock", "photos": ["javascript:alert(1)"]}),
            "lien http": ("MY-BAD", {"make": "A", "model": "B", "status": "stock", "sourceUrl": "http://x.example"}),
            "prix négatif": ("MY-BAD", {"make": "A", "model": "B", "status": "stock", "indicativePriceTnd": -5}),
            "référence invalide": ("MY BAD", {"make": "A", "model": "B", "status": "stock"}),
        }
        for nom, (reference, corps) in cas.items():
            with self.subTest(nom):
                statut, _, _ = self.requete(f"/api/admin/vehicles/{urllib.request.quote(reference)}", corps, "PUT", cookie)
                self.assertEqual(statut, 400)
        self.assertNotIn("MY-BAD", self.catalogue_public())
        statut, _, _ = self.requete("/api/admin/vehicles/MY-CSRF", {"make": "A", "model": "B", "status": "stock"}, "PUT", cookie,
                                    origine="https://pirate.example")
        self.assertEqual(statut, 403)

    def test_script_creer_admin(self):
        import sys
        from unittest import mock
        sys.path.insert(0, str(PROJET / "scripts"))
        import creer_admin
        arguments = ["--email", "Patron@Example.com", "--nom", "Patron", "--wrangler", WRANGLER,
                     "--wrangler-args", f"--local --persist-to {self.persist} -c {self.config}"]
        with mock.patch("getpass.getpass", side_effect=["admin", "admin"]), self.assertRaises(SystemExit):
            creer_admin.main(arguments)
        with mock.patch("getpass.getpass", side_effect=["un-vrai-mot-de-passe", "un-vrai-mot-de-passe"]):
            self.assertEqual(creer_admin.main(arguments), 0)
        statut, data, set_cookie = self.requete("/api/login", {"email": "patron@example.com", "password": "un-vrai-mot-de-passe"}, "POST")
        self.assertEqual((statut, data["user"]["role"]), (200, "admin"))
        self.assertEqual(self.requete("/api/admin/vehicles", cookie=set_cookie.split(";")[0])[0], 200)
        # Relancer le script sur un compte existant change son mot de passe et garde le rôle admin.
        with mock.patch("getpass.getpass", side_effect=["nouveau-mot-de-passe", "nouveau-mot-de-passe"]):
            self.assertEqual(creer_admin.main(arguments), 0)
        self.assertEqual(self.requete("/api/login", {"email": "patron@example.com", "password": "un-vrai-mot-de-passe"}, "POST")[0], 401)
        self.assertEqual(self.requete("/api/login", {"email": "patron@example.com", "password": "nouveau-mot-de-passe"}, "POST")[0], 200)

    def test_facture_pdf_desactivee_sans_stockage_documents(self):
        # wrangler.jsonc ne déclare pas de binding DOCUMENTS : le PDF est annoncé indisponible, jamais servi.
        self.sql("INSERT INTO invoices (user_id, invoice_number, issued_at, total_tnd, document_key) "
                 "SELECT id, 'F-2026-001', '2026-11-01', 95000, 'factures/F-2026-001.pdf' FROM users WHERE email = 'acheteur@example.com'")
        cookie = self.cookie("acheteur@example.com")
        facture = self.requete("/api/me", cookie=cookie)[1]["invoices"][0]
        self.assertEqual((facture["invoiceNumber"], facture["documentAvailable"]), ("F-2026-001", False))
        statut, data, _ = self.requete(f"/api/invoices/{facture['id']}/document", cookie=cookie)
        self.assertEqual((statut, data["error"]), (503, "Le stockage sécurisé des factures n'est pas configuré."))
        self.assertEqual(self.requete(f"/api/invoices/{facture['id']}/document", cookie=self.cookie("admin@example.com"))[0], 404,
                         "facture d'un autre compte")

    def test_photo_inexistante_ou_chemin_force(self):
        self.assertEqual(self._statut(self.base + "/media/vehicules/X/" + "0" * 32 + ".jpg"), 404)
        self.assertEqual(self._statut(self.base + "/media/vehicules/X/..%2F..%2Fsecret.jpg"), 404)

    def _statut(self, url):
        try:
            with urllib.request.urlopen(url) as reponse:
                return reponse.status
        except urllib.error.HTTPError as erreur:
            erreur.close()
            return erreur.code


if __name__ == "__main__":
    unittest.main()
