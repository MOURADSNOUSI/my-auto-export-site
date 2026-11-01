"""Tests du référencement statique : robots.txt, balises des pages, photos optimisées.
Le sitemap et les pages véhicules sont servis par le Worker : voir tests/test_pages_vehicules.py.

Lancement : python3 -m unittest tests.test_referencement
"""
import json
import re
import unittest
from pathlib import Path

PROJET = Path(__file__).resolve().parent.parent
SITE = PROJET / "my-auto-export"
DOMAINE = "https://www.myautoexport.com"


def pages_statiques():
    """PAGES_STATIQUES de worker/seo.js : pages listées dans le sitemap."""
    source = (PROJET / "worker" / "seo.js").read_text()
    return json.loads(re.search(r"export const PAGES_STATIQUES = (\[.*?\]);", source).group(1))


class ReferencementTest(unittest.TestCase):
    def test_robots_annonce_le_sitemap_sans_bloquer_le_site(self):
        robots = (SITE / "robots.txt").read_text()
        self.assertIn(f"Sitemap: {DOMAINE}/sitemap.xml", robots)
        interdits = re.findall(r"^Disallow:\s*(\S*)", robots, re.M)
        self.assertEqual(sorted(interdits), ["/api/", "/mcp", "/oauth/"])

    def test_sitemap_genere_par_le_worker(self):
        # Un fichier statique serait servi à la place du sitemap dynamique.
        self.assertFalse((SITE / "sitemap.xml").exists())

    def test_pages_du_sitemap_indexables(self):
        for chemin in pages_statiques():
            if chemin == "/vehicules":
                continue  # page rendue par le Worker
            fichier = SITE / ((chemin.strip("/") or "index") + ".html")
            self.assertTrue(fichier.exists(), chemin)
            page = fichier.read_text()
            self.assertNotIn("noindex", page, chemin)
            self.assertIn(f'<link rel="canonical" href="{DOMAINE}{chemin}">', page)

    def test_balises_de_l_accueil(self):
        page = (SITE / "index.html").read_text()
        self.assertIn(f'<link rel="canonical" href="{DOMAINE}/">', page)
        self.assertIn(f'<meta property="og:image" content="{DOMAINE}/logo.png">', page)
        self.assertIn('<meta name="viewport" content="width=device-width, initial-scale=1">', page)
        self.assertEqual(len(re.findall(r"<h1[ >]", page)), 1)
        donnees = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page, re.S).group(1))
        self.assertEqual((donnees["@type"], donnees["url"], donnees["email"]), ("AutoDealer", f"{DOMAINE}/", "contact@myautoexport.com"))
        self.assertIn('id="liste-vehicules"', page, "emplacement de la liste insérée par le Worker")

    def test_administration_non_indexee(self):
        self.assertIn('<meta name="robots" content="noindex, nofollow">', (SITE / "admin.html").read_text())
        self.assertIn(f'<link rel="canonical" href="{DOMAINE}/conditions">', (SITE / "conditions.html").read_text())

    def test_liens_internes_sans_redirection(self):
        for page in ("index.html", "conditions.html", "importer-un-vehicule-en-tunisie.html"):
            self.assertNotRegex((SITE / page).read_text(), r'href="/[a-z]+\.html', page)

    def test_guide_en_brouillon(self):
        # Contenu à valider avant publication : il reste hors index et hors sitemap jusque-là.
        self.assertIn('<meta name="robots" content="noindex, follow">', (SITE / "importer-un-vehicule-en-tunisie.html").read_text())
        self.assertNotIn("/importer-un-vehicule-en-tunisie", pages_statiques())

    def test_chaque_photo_locale_a_sa_version_webp(self):
        for photo in (SITE / "photos").iterdir():
            if photo.suffix.lower() in (".jpg", ".jpeg", ".png"):
                self.assertTrue((SITE / "photos" / "web" / f"{photo.stem}.webp").exists(),
                                f"{photo.name} : lancer python3 scripts/optimiser_photos.py")


if __name__ == "__main__":
    unittest.main()
