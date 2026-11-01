"""Tests de scripts/ajouter_lot.py.

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
import ajouter_lot  # noqa: E402


class AjouterLotTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.site = self.root / "site"
        self.site.mkdir()
        (self.site / "lots.json").write_text("[]\n")
        self.photo = self.root / "Avant.JPG"
        self.photo.write_bytes(b"fake-jpeg")

    def run_script(self, *args):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            ajouter_lot.main([*args, "--site", str(self.site)])
        return json.loads((self.site / "lots.json").read_text())

    def assert_refuse(self, *args):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            ajouter_lot.main([*args, "--site", str(self.site)])
        self.assertEqual(json.loads((self.site / "lots.json").read_text()), [])

    def test_ajoute_un_lot_et_copie_les_photos(self):
        catalogue = self.run_script(
            "--reference", "MY-001", "--marque", "Peugeot", "--modele", "3008",
            "--statut", "open", "--fin", "2099-01-01T18:00", "--prix", "85000", "--km", "54000",
            str(self.photo),
        )
        self.assertEqual(len(catalogue), 1)
        lot = catalogue[0]
        self.assertEqual(lot["photos"], [{"url": "photos/MY-001-1.jpg", "authorized": True}])
        self.assertEqual((self.site / "photos" / "MY-001-1.jpg").read_bytes(), b"fake-jpeg")
        self.assertEqual(lot["mileageKm"], 54000)
        self.assertTrue(lot["endsAt"].startswith("2099-01-01T18:00:00"))
        self.assertNotIn("sourceUrl", lot)

    def test_lot_a_venir_sans_photo(self):
        catalogue = self.run_script("--reference", "MY-002", "--marque", "Audi", "--modele", "A3")
        self.assertEqual(catalogue[0]["status"], "upcoming")
        self.assertEqual(catalogue[0]["photos"], [])

    def test_mise_a_prix_et_caracteristiques(self):
        catalogue = self.run_script(
            "--reference", "MY-005", "--marque", "Jeep", "--modele", "Wrangler", "--mise-a-prix", "150000",
            "--detail", "Transmission=4x4 Rock-Trac", "--detail", "Puissance = 380 ch",
        )
        self.assertEqual(catalogue[0]["startingPriceTnd"], 150000)
        self.assertEqual(catalogue[0]["specs"], [["Transmission", "4x4 Rock-Trac"], ["Puissance", "380 ch"]])

    def test_refuse_les_saisies_invalides(self):
        base = ["--reference", "MY-003", "--marque", "Audi", "--modele", "A3"]
        cas = {
            "en vente sans fin": [*base, "--statut", "open"],
            "fin passée": [*base, "--statut", "open", "--fin", "2000-01-01"],
            "source http": [*base, "--source", "http://fournisseur.example"],
            "photo absente": [*base, str(self.root / "absente.jpg")],
            "détail sans valeur": [*base, "--detail", "Transmission"],
            "réserve sous la mise à prix": [*base, "--mise-a-prix", "150000", "--reserve", "100000"],
            "achat immédiat sous la réserve": [*base, "--reserve", "195000", "--achat-immediat", "180000"],
        }
        for nom, args in cas.items():
            with self.subTest(nom):
                self.assert_refuse(*args)

    def test_refuse_une_reference_deja_utilisee(self):
        self.run_script("--reference", "MY-004", "--marque", "Audi", "--modele", "A3")
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            self.run_script("--reference", "MY-004", "--marque", "BMW", "--modele", "X1")
        self.assertEqual(len(json.loads((self.site / "lots.json").read_text())), 1)


if __name__ == "__main__":
    unittest.main()
