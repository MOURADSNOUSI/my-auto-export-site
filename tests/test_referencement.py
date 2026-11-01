"""Tests du référencement : robots.txt, sitemap.xml et balises des pages publiques.

Lancement : python3 -m unittest tests.test_referencement
"""
import json
import re
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "my-auto-export"
DOMAINE = "https://www.myautoexport.com"


class ReferencementTest(unittest.TestCase):
    def test_robots_annonce_le_sitemap_sans_bloquer_le_site(self):
        robots = (SITE / "robots.txt").read_text()
        self.assertIn(f"Sitemap: {DOMAINE}/sitemap.xml", robots)
        interdits = re.findall(r"^Disallow:\s*(\S*)", robots, re.M)
        self.assertEqual(sorted(interdits), ["/api/", "/mcp", "/oauth/"])

    def test_sitemap_liste_des_pages_existantes(self):
        racine = ET.parse(SITE / "sitemap.xml").getroot()
        adresses = [loc.text for loc in racine.iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
        self.assertEqual(adresses, [f"{DOMAINE}/", f"{DOMAINE}/conditions.html"])
        for adresse in adresses:
            fichier = SITE / (adresse.removeprefix(DOMAINE + "/") or "index.html")
            self.assertTrue(fichier.exists(), adresse)
            self.assertNotIn("noindex", fichier.read_text(), adresse)

    def test_balises_de_l_accueil(self):
        page = (SITE / "index.html").read_text()
        self.assertIn(f'<link rel="canonical" href="{DOMAINE}/">', page)
        self.assertIn(f'<meta property="og:image" content="{DOMAINE}/logo.png">', page)
        donnees = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page, re.S).group(1))
        self.assertEqual((donnees["@type"], donnees["url"], donnees["email"]), ("AutoDealer", f"{DOMAINE}/", "contact@myautoexport.com"))

    def test_administration_non_indexee(self):
        self.assertIn('<meta name="robots" content="noindex, nofollow">', (SITE / "admin.html").read_text())
        self.assertIn(f'<link rel="canonical" href="{DOMAINE}/conditions.html">', (SITE / "conditions.html").read_text())


if __name__ == "__main__":
    unittest.main()
