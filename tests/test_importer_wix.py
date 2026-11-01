"""Tests de scripts/importer_wix.py.

Lancement : python3 -m unittest discover tests
"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import importer_wix  # noqa: E402

CARS = [
    {"id": 7753628, "title": "Citroën C5 Aircross Hybrid 225", "date": "01/2022", "km": 85659, "fuel": "Hybride",
     "eur": 11600, "photos": ["https://ecarstrade.com/p/1.jpg", "https://ecarstrade.com/p/2.jpg"]},
    {"id": 7754225, "title": "Mercedes-Benz GLC Coupé 63 S E Performance", "date": "07/2025", "km": 6463,
     "fuel": "Essence", "eur": None, "photos": []},
    {"id": 7750872, "title": "Porsche Cayenne 3.0 E-Hybrid", "date": "08/2024", "km": 21632, "fuel": "Hybride",
     "eur": None, "photos": ["https://ecarstrade.com/p/porsche.jpg"]},
]
HTML = f"<html><script>const cars={json.dumps(CARS)};function show(id){{}}</script></html>"


class ImporterWixTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.site = root / "site"
        self.site.mkdir()
        self.existant = {"reference": "7750872", "make": "Porsche", "model": "Cayenne", "status": "open",
                         "endsAt": "2026-11-01T15:00:00Z", "mileageKm": 21632, "photos": []}
        (self.site / "lots.json").write_text(json.dumps([self.existant]))
        self.html = root / "page.html"
        self.html.write_text(HTML)

    def importer(self, *args):
        with contextlib.redirect_stdout(io.StringIO()) as sortie:
            importer_wix.main(["--html", str(self.html), "--site", str(self.site), *args])
        return json.loads((self.site / "lots.json").read_text()), sortie.getvalue()

    def test_prix_selon_la_formule(self):
        # (11 600 + 3 000) × 3,5 + 30 000
        self.assertEqual(importer_wix.prix_tnd(11600), 81100)
        self.assertIsNone(importer_wix.prix_tnd(None))

    def test_decoupage_des_marques(self):
        self.assertEqual(importer_wix.decouper_titre("Mercedes-Benz GLC Coupé 63 S E Performance"),
                         ("Mercedes-Benz", "GLC", "Coupé 63 S E Performance"))
        self.assertEqual(importer_wix.decouper_titre("Range Rover Sport P440e HSE Dynamic"),
                         ("Land Rover", "Range Rover", "Sport P440e HSE Dynamic"))
        self.assertEqual(importer_wix.decouper_titre("Renault Captur TCe 90"), ("Renault", "Captur", "TCe 90"))

    def test_import_ajoute_en_stock(self):
        catalogue, _ = self.importer()
        citroen = next(lot for lot in catalogue if lot["reference"] == "7753628")
        self.assertEqual(citroen["status"], "stock")
        self.assertEqual(citroen["indicativePriceTnd"], 81100)
        self.assertEqual(citroen["year"], 2022)
        self.assertEqual(len(citroen["photos"]), 2)
        self.assertTrue(all(photo["authorized"] is False for photo in citroen["photos"]), "pas d'autorisation présumée")
        mercedes = next(lot for lot in catalogue if lot["reference"] == "7754225")
        self.assertNotIn("indicativePriceTnd", mercedes)

    def test_lot_existant_complete_sans_ecraser(self):
        catalogue, sortie = self.importer()
        porsche = [lot for lot in catalogue if lot["reference"] == "7750872"]
        self.assertEqual(len(porsche), 1)
        self.assertEqual(porsche[0]["status"], "open")
        self.assertEqual(porsche[0]["endsAt"], "2026-11-01T15:00:00Z")
        self.assertEqual(porsche[0]["photos"], [{"url": "https://ecarstrade.com/p/porsche.jpg", "authorized": False}])
        self.assertIn("7750872 complété", sortie)

    def test_photos_autorisees_sur_confirmation_explicite(self):
        catalogue, _ = self.importer("--photos-autorisees")
        citroen = next(lot for lot in catalogue if lot["reference"] == "7753628")
        self.assertEqual([photo["authorized"] for photo in citroen["photos"]], [True, True])

    def test_essai_n_ecrit_rien(self):
        catalogue, sortie = self.importer("--essai")
        self.assertEqual(catalogue, [self.existant])
        self.assertIn("2 ajoutés", sortie)

    def test_reimport_ne_duplique_pas(self):
        self.importer()
        catalogue, sortie = self.importer()
        self.assertEqual(len(catalogue), 3)
        self.assertIn("0 ajoutés", sortie)


if __name__ == "__main__":
    unittest.main()
