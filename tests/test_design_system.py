"""Tests de la page du design system (/design-systeme) : affichage mobile et bureau sans défilement horizontal, polices
hébergées chargées (latin et arabe), cibles tactiles, focus visible, page non indexée.

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_design_system
Ignorés si la variable WRANGLER n'est pas définie. Captures dans DESIGN_CAPTURES si la variable est définie.
"""
import os
import subprocess
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

try:
    from test_administration import config_de_test, port_libre
except ImportError:
    from tests.test_administration import config_de_test, port_libre

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
CAPTURES = os.environ.get("DESIGN_CAPTURES")


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class DesignSystemTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.config = config_de_test(cls.tmp.name)
        subprocess.run([WRANGLER, "d1", "migrations", "apply", "DB", "--local", "--persist-to", cls.tmp.name, "-c", cls.config],
                       cwd=PROJET, check=True, capture_output=True)
        port = port_libre()
        cls.base = f"http://localhost:{port}"
        cls.serveur = subprocess.Popen([WRANGLER, "dev", "--local", "--port", str(port), "--persist-to", cls.tmp.name, "-c", cls.config],
                                       cwd=PROJET, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(120):
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

    def test_page_non_indexee_et_ressources_servies(self):
        with urllib.request.urlopen(self.base + "/design-systeme") as reponse:
            self.assertIn('<meta name="robots" content="noindex, nofollow">', reponse.read().decode())
        for chemin, type_attendu in (("/design/tokens.css", "text/css"), ("/design/composants.css", "text/css"),
                                     ("/polices/noto-sans-latin.woff2", "font/woff2"), ("/polices/noto-sans-arabic.woff2", "font/woff2")):
            with urllib.request.urlopen(self.base + chemin) as reponse:
                self.assertEqual(reponse.status, 200, chemin)
                self.assertIn(type_attendu, reponse.headers.get("Content-Type", ""), chemin)

    def test_affichage_mobile_et_bureau(self):
        for largeur in (360, 390, 1440):
            page = self.browser.new_page(viewport={"width": largeur, "height": 900})
            erreurs = []
            page.on("pageerror", lambda e: erreurs.append(str(e)))
            page.on("console", lambda m: erreurs.append(m.text) if m.type == "error" else None)
            page.goto(self.base + "/design-systeme")
            page.evaluate("document.fonts.ready.then(() => true)")
            largeurs = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
            self.assertLessEqual(largeurs[0], largeurs[1], largeur)
            polices = page.evaluate("""[document.fonts.check('16px "Noto Sans"'),
                [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, ''))]""")
            self.assertTrue(polices[0], largeur)
            self.assertIn("Noto Sans", polices[1], largeur)
            self.assertIn("Noto Sans Arabic", polices[1], "police arabe chargée pour le bloc en arabe")
            # Cibles tactiles : 44 px pour les boutons normaux, 36 px pour les petits.
            hauteurs = page.evaluate("[...document.querySelectorAll('main .my-bouton')].map(b => [b.classList.contains('my-bouton--petit'), b.getBoundingClientRect().height])")
            for petit, hauteur in hauteurs:
                self.assertGreaterEqual(hauteur, 36 if petit else 44)
            # Navigation remplacée par le bouton de menu sur téléphone.
            self.assertEqual(page.is_visible(".my-nav"), largeur > 860, largeur)
            self.assertEqual(page.is_visible(".my-burger"), largeur <= 860, largeur)
            self.assertEqual(erreurs, [], largeur)
            if CAPTURES:
                page.screenshot(path=str(Path(CAPTURES) / f"design-{largeur}.png"), full_page=True)
            page.close()

    def test_focus_visible_et_rtl(self):
        page = self.browser.new_page(viewport={"width": 390, "height": 900})
        page.goto(self.base + "/design-systeme")
        page.keyboard.press("Tab")
        ombre = page.evaluate("getComputedStyle(document.activeElement).boxShadow")
        self.assertNotEqual(ombre, "none", "anneau de focus visible au clavier")
        direction = page.evaluate("getComputedStyle(document.querySelector('[dir=rtl]')).direction")
        self.assertEqual(direction, "rtl")
        page.close()


if __name__ == "__main__":
    unittest.main()
