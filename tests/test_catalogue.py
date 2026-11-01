"""Tests du chargement du catalogue (lots.json) dans my-auto-export/index.html.

Lancement : python3 -m unittest discover tests
Prérequis : pip install playwright && playwright install chromium
"""
import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

SITE_DIR = Path(__file__).resolve().parent.parent / "my-auto-export"
ORIGIN = "http://site.test"


def iso(delta):
    return (datetime.now(timezone.utc) + delta).isoformat()


def lot(**overrides):
    base = {
        "reference": "MY-001",
        "make": "Peugeot",
        "model": "3008",
        "status": "open",
        "endsAt": iso(timedelta(days=3)),
        "sourceUrl": "https://fournisseur.example/lot/1",
        "photos": [],
        "bodyType": "SUV",
        "indicativePriceTnd": 85000,
    }
    base.update(overrides)
    return base


class CatalogueTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def open_site(self, body, status=200):
        """Ouvre la page avec un lots.json simulé et attend la fin du chargement."""
        page = self.browser.new_page()
        self.addCleanup(page.close)

        def serve(route):
            path = route.request.url.removeprefix(ORIGIN).split("?")[0]
            if path == "/lots.json":
                payload = body if isinstance(body, str) else json.dumps(body)
                route.fulfill(status=status, body=payload, content_type="application/json")
            elif (SITE_DIR / path.lstrip("/")).is_file():
                route.fulfill(path=SITE_DIR / path.lstrip("/"))
            else:
                route.fulfill(path=SITE_DIR / "index.html")

        page.route(f"{ORIGIN}/**", serve)
        page.goto(f"{ORIGIN}/index.html")
        page.wait_for_function("catalogueEtat !== 'loading'")
        return page

    def test_catalogue_vide_affiche_aucun_lot_valide(self):
        page = self.open_site([])
        self.assertEqual(page.text_content("#empty-title"), "Aucun lot validé pour le moment")
        self.assertTrue(page.is_hidden("#lot-grid"))

    def test_lots_valides_sont_affiches_et_comptes(self):
        page = self.open_site([
            lot(reference="MY-001", make="Peugeot"),
            lot(reference="MY-002", make="Audi", status="upcoming", endsAt=None),
        ])
        self.assertEqual(page.locator(".lot-card").count(), 2)
        self.assertEqual(page.text_content("#open-count"), "1")
        self.assertEqual(page.text_content("#upcoming-count"), "1")
        self.assertEqual(page.text_content("#result-count"), "2 lots")
        makes = page.eval_on_selector_all("#make option", "opts => opts.map(o => o.value)")
        self.assertEqual(makes, ["", "Audi", "Peugeot"])

    def test_lot_en_vente_expire_est_masque(self):
        page = self.open_site([
            lot(reference="MY-ACTIF"),
            lot(reference="MY-EXPIRE", endsAt=iso(timedelta(hours=-1))),
        ])
        self.assertEqual(page.locator(".lot-card").count(), 1)
        self.assertIn("MY-ACTIF", page.text_content("#lot-grid"))
        self.assertNotIn("MY-EXPIRE", page.text_content("#lot-grid"))

    def test_un_lot_invalide_rejette_tout_le_catalogue(self):
        invalides = {
            "source http": lot(sourceUrl="http://fournisseur.example/lot/1"),
            "statut inconnu": lot(status="sold"),
            "sans date de fin": lot(endsAt=None),
            "date illisible": lot(endsAt="bientôt"),
            "sans photos": {k: v for k, v in lot().items() if k != "photos"},
            "sans modèle": lot(model=""),
        }
        for cas, lot_invalide in invalides.items():
            with self.subTest(cas):
                page = self.open_site([lot(reference="MY-OK"), lot_invalide])
                self.assertEqual(page.evaluate("catalogueEtat"), "error")
                self.assertEqual(page.text_content("#empty-title"), "Catalogue momentanément indisponible")
                self.assertEqual(page.locator(".lot-card").count(), 0)

    def test_erreur_reseau_ou_json_invalide_affiche_indisponible(self):
        for cas, (body, status) in {"http 500": ([], 500), "json cassé": ("{oops", 200), "objet": ({}, 200)}.items():
            with self.subTest(cas):
                page = self.open_site(body, status)
                self.assertEqual(page.text_content("#empty-title"), "Catalogue momentanément indisponible")

    def test_seules_les_photos_autorisees_sont_affichees(self):
        page = self.open_site([
            lot(reference="MY-001", photos=[{"url": "https://cdn.example/non.jpg", "authorized": False}]),
            lot(reference="MY-002", photos=[{"url": "https://cdn.example/oui.jpg", "authorized": True}]),
        ])
        sources = page.eval_on_selector_all(".lot-photo img", "imgs => imgs.map(i => i.getAttribute('src'))")
        self.assertEqual(sources, ["https://cdn.example/oui.jpg"])
        self.assertEqual(page.locator(".photo-missing").count(), 1)

    def test_lot_manuel_avec_photo_locale_et_sans_fournisseur(self):
        manuel = lot(reference="MY-LOCAL", photos=[{"url": "photos/MY-LOCAL-1.jpg", "authorized": True}])
        del manuel["sourceUrl"]
        page = self.open_site([manuel])
        self.assertEqual(page.get_attribute(".lot-photo img", "src"), "photos/MY-LOCAL-1.jpg")
        self.assertEqual(page.locator("a.source-link").count(), 0)
        page.click("text=Se renseigner")
        self.assertTrue(page.is_visible("#contact-dialog"))
        self.assertEqual(page.input_value("#request-reference"), "MY-LOCAL")

    def test_photo_hors_du_dossier_photos_est_ignoree(self):
        page = self.open_site([lot(photos=[{"url": "../secret.jpg", "authorized": True}])])
        self.assertEqual(page.locator(".lot-photo img").count(), 0)

    def test_donnees_du_catalogue_sont_echappees(self):
        page = self.open_site([lot(make='<img src=x onerror="window.pwned=1">')])
        self.assertIsNone(page.evaluate("window.pwned"))
        self.assertIn("<img src=x", page.text_content(".lot-title"))


if __name__ == "__main__":
    unittest.main()
