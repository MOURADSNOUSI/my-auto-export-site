"""Tests du catalogue filtrable (/vehicules, worker/catalogue.js) : filtres et compteurs des options, total, tri et
pagination par curseur, annonces masquées exclues, pages filtrées non indexées, compteurs recalculés après une écriture
(au plus une fois par heure) et chaque nuit, panneau de filtres mobile et nombre « Voir les N véhicules ».

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_catalogue_filtre
Ignorés si la variable WRANGLER n'est pas définie. Captures dans CATALOGUE_CAPTURES si la variable est définie.
"""
import json
import os
import re
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

try:
    from test_administration import config_de_test, port_libre
except ImportError:
    from tests.test_administration import config_de_test, port_libre

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
CAPTURES = os.environ.get("CATALOGUE_CAPTURES")
MOT_DE_PASSE = "motdepasse-solide"


def vehicule(marque, modele, annee, km, energie, boite, pays, prix, carrosserie="SUV"):
    return {"make": marque, "model": modele, "year": annee, "mileageKm": km, "fuel": energie, "transmission": boite, "country": pays,
            "prixEur": prix, "bodyType": carrosserie, "status": "stock"}


# 30 annonces : assez pour deux pages de 24.
VEHICULES = {f"CAT-{i:02d}": vehicule(*v) for i, v in enumerate(
    [("Peugeot", "3008", 2023, 40000, "Diesel", "Automatique", "Allemagne", 21000 + i * 100) for i in range(14)]
    + [("Peugeot", "208", 2022, 60000, "Essence", "Manuelle", "France", 12000 + i * 100, "Citadine") for i in range(6)]
    + [("Renault", "Captur", 2024, 20000, "Hybride", "Automatique", "Italie", 23000 + i * 100) for i in range(8)]
    + [("Kia", "Niro", 2021, 90000, "Électrique", "Automatique", "Belgique", 18000), ("Ford", "Puma", 2025, 50, "Essence", "Manuelle", "Allemagne", 24900)]
)}


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class CatalogueFiltreTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        config = json.loads(Path(cls.config).read_text())
        config["vars"]["LEGACY_AUCTIONS_ENABLED"] = "false"
        Path(cls.config).write_text(json.dumps(config))
        subprocess.run([WRANGLER, "d1", "migrations", "apply", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config],
                       cwd=PROJET, check=True, capture_output=True)
        port = port_libre()
        cls.base = f"http://localhost:{port}"
        cls.serveur = subprocess.Popen([WRANGLER, "dev", "--local", "--test-scheduled", "--port", str(port), "--persist-to", cls.persist, "-c", cls.config],
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
        assert cls.api("/api/register", {"name": "Admin", "email": "admin@ex.com", "password": MOT_DE_PASSE}, "POST")[0] == 201
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'")
        cls.cookie = cls.api("/api/login", {"email": "admin@ex.com", "password": MOT_DE_PASSE}, "POST")[2]["Set-Cookie"].split(";")[0]
        for reference, v in VEHICULES.items():
            statut, data, _ = cls.api(f"/api/admin/vehicles/{reference}", v, "PUT", cls.cookie)
            assert statut == 200, (reference, data)
        # Une annonce retirée : jamais visible ni comptée.
        assert cls.api("/api/admin/vehicles/CAT-RETIRE", vehicule("Peugeot", "3008", 2023, 1, "Diesel", "Automatique", "Allemagne", 1), "PUT", cls.cookie)[0] == 200
        assert cls.api("/api/admin/vehicles/CAT-RETIRE", None, "DELETE", cls.cookie)[0] == 200
        cls.sql("DELETE FROM catalogue_compteurs")
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
    def sql(cls, commande):
        sortie = subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--json",
                                 "--command", commande], cwd=PROJET, check=True, capture_output=True, text=True).stdout
        return json.loads(sortie)[0]["results"]

    @classmethod
    def api(cls, chemin, data=None, method=None, cookie=None):
        headers = {"Origin": cls.base, "CF-Connecting-IP": "10.0.0.8", "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        requete = urllib.request.Request(cls.base + chemin, data=None if data is None else json.dumps(data).encode(), method=method, headers=headers)
        try:
            with urllib.request.urlopen(requete) as reponse:
                return reponse.status, json.loads(reponse.read() or b"null"), reponse.headers
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, json.loads(erreur.read() or b"null"), erreur.headers

    def page(self, chemin):
        class SansRedirection(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        try:
            with urllib.request.build_opener(SansRedirection).open(urllib.request.Request(self.base + chemin, headers={"Accept": "text/html"})) as reponse:
                return reponse.status, reponse.read().decode(), reponse.headers
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, erreur.read().decode(), erreur.headers

    def references(self, html):
        """Références des cartes, dans l'ordre (chaque carte a trois liens vers sa fiche)."""
        return list(dict.fromkeys(re.findall(r'href="/vehicules/[^"]*-(cat-\d\d)"', html)))

    def test_compteurs_des_options_et_total(self):
        _, html, _ = self.page("/vehicules")
        self.assertIn("30 véhicules", html)
        for option in ("Peugeot (20)", "Renault (8)", "Kia (1)", "Diesel (14)", "Essence (7)", "Allemagne (15)", "Citadine (6)", "Automatique (23)"):
            self.assertIn(f">{option}</option>", html, option)
        self.assertNotIn("CAT-RETIRE", html.upper())
        # Modèle : proposé seulement une fois la marque choisie, avec ses propres comptes.
        self.assertRegex(html, r'<select name="modele" disabled>')
        _, html, _ = self.page("/vehicules?marque=Peugeot")
        self.assertIn(">3008 (14)</option>", html)
        self.assertIn(">208 (6)</option>", html)
        self.assertNotIn(">Captur", html)

    def test_filtres_combines(self):
        cas = {
            "marque=Peugeot&modele=208": 6, "energie=Diesel&pays=Allemagne": 14, "boite=Manuelle": 7, "carrosserie=Citadine": 6,
            "annee_min=2024": 9, "annee_max=2021": 1, "km_max=30000": 9, "prix_max=12300": 4, "marque=Renault&energie=Diesel": 0
        }
        for requete, attendu in cas.items():
            statut, data, _ = self.api(f"/api/catalogue/compte?{requete}")
            self.assertEqual((statut, data["total"]), (200, attendu), requete)
        _, html, _ = self.page("/vehicules?marque=Renault&energie=Diesel")
        self.assertIn("Aucun véhicule ne correspond à votre recherche.", html)
        self.assertEqual(self.api("/api/catalogue/compte?marque=%3Cb%3E")[0], 400)
        statut, _, entetes = self.page("/vehicules?prix_max=abc")
        self.assertEqual((statut, urllib.parse.urlparse(entetes["Location"]).path), (302, "/vehicules"))

    def test_tri_et_pagination_par_curseur(self):
        _, html, _ = self.page("/vehicules?tri=prix_asc")
        premiere = self.references(html)
        self.assertEqual(len(premiere), 24)
        self.assertEqual(premiere[0], "cat-14", "12 000 € : la moins chère")
        suivant = re.search(r'href="(/vehicules\?[^"]*apres=[^"]+)" rel="next"', html).group(1).replace("&amp;", "&")
        self.assertIn("tri=prix_asc", suivant)
        _, html2, _ = self.page(suivant)
        seconde = self.references(html2)
        self.assertEqual(len(seconde), 6)
        self.assertEqual(set(premiere) & set(seconde), set(), "aucune annonce en double entre les pages")
        self.assertEqual(len(set(premiere) | set(seconde)), 30)
        self.assertNotIn('rel="next"', html2)
        # Prix croissants sur l'ensemble.
        prix = {r: VEHICULES[r.upper()]["prixEur"] for r in premiere + seconde}
        self.assertEqual([prix[r] for r in premiere + seconde], sorted(prix.values()))
        self.assertEqual(self.page("/vehicules?apres=falsifie")[0], 302)
        _, data, _ = self.api("/api/catalogue/recherche?marque=Peugeot&tri=prix_desc")
        self.assertEqual(len(data["vehicules"]), 20)
        self.assertIsNone(data["suivant"])
        self.assertEqual(data["vehicules"][0]["titre"], "Peugeot 3008 2023")

    def test_indexation(self):
        _, html, _ = self.page("/vehicules")
        self.assertNotIn('content="noindex', html)
        self.assertIn('<link rel="canonical" href="https://www.myautoexport.com/vehicules">', html)
        for chemin in ("/vehicules?marque=Peugeot", "/vehicules?tri=prix_asc"):
            self.assertIn('<meta name="robots" content="noindex, follow">', self.page(chemin)[1], chemin)

    def test_cartes(self):
        self.api("/api/admin/site/delais_livraison", {"valeur": {"Allemagne": "4 à 6 semaines"}}, "PUT", self.cookie)
        self.addCleanup(self.api, "/api/admin/site/delais_livraison", {"valeur": {}}, "PUT", self.cookie)
        _, html, _ = self.page("/vehicules?marque=Ford")
        carte = html[html.index('<li class="carte-vehicule">'):]
        self.assertIn(">Ford Puma 2025</a>", carte)
        self.assertIn("50 km · Essence · Manuelle", carte.replace(" ", " ").replace("\xa0", " "))
        self.assertIn('<span class="my-badge my-badge--info">Allemagne</span>', carte)
        self.assertIn("Livraison estimée : 4 à 6 semaines", carte)
        self.assertEqual(self.api("/api/admin/site/delais_livraison", {"valeur": {"Allemagne": ""}}, "PUT", self.cookie)[0], 400)

    def test_compteurs_recalcules(self):
        self.page("/vehicules")
        avant = {r["filtre"]: r for r in self.sql("SELECT filtre, perime, calcule_le FROM catalogue_compteurs")}
        self.assertEqual(len(avant), 6)
        self.assertTrue(all(r["perime"] == 0 for r in avant.values()))
        # Nouvelle annonce : compteurs marqués périmés, pas recalculés avant une heure.
        self.assertEqual(self.api("/api/admin/vehicles/CAT-NOUVEAU", vehicule("Dacia", "Duster", 2024, 10, "Diesel", "Manuelle", "Roumanie", 15000), "PUT", self.cookie)[0], 200)
        self.addCleanup(self.api, "/api/admin/vehicles/CAT-NOUVEAU", None, "DELETE", self.cookie)
        time.sleep(1)
        self.assertTrue(all(r["perime"] == 1 for r in self.sql("SELECT perime FROM catalogue_compteurs")))
        _, html, _ = self.page("/vehicules")
        self.assertNotIn(">Dacia (1)</option>", html, "compteurs pas encore recalculés")
        # Passé une heure, la lecture suivante relance le calcul.
        self.sql("UPDATE catalogue_compteurs SET calcule_le = '2020-01-01T00:00:00Z'")
        self.page("/vehicules")
        time.sleep(1)
        self.assertIn(">Dacia (1)</option>", self.page("/vehicules")[1])
        # Le cron de la nuit recalcule aussi.
        self.sql("DELETE FROM catalogue_compteurs WHERE filtre = 'pays'")
        urllib.request.urlopen(self.base + "/__scheduled?cron=30+2+*+*+*").read()
        self.assertEqual(len(self.sql("SELECT filtre FROM catalogue_compteurs")), 6)

    def test_panneau_mobile_et_nombre_en_direct(self):
        contexte = self.browser.new_context(viewport={"width": 390, "height": 844})
        self.addCleanup(contexte.close)
        page = contexte.new_page()
        erreurs = []
        page.on("pageerror", lambda e: erreurs.append(str(e)))
        page.goto(self.base + "/vehicules")
        self.assertFalse(page.is_visible("#filtres"), "panneau fermé sur téléphone")
        page.click("a.ouvrir-filtres")
        expect(page.locator("#filtres")).to_be_visible()
        boite = page.locator("#filtres").bounding_box()
        self.assertEqual((boite["width"], boite["height"]), (390, 844), "plein écran")
        bouton = page.locator("#filtres [data-voir]")
        expect(bouton).to_have_text("Voir les 30 véhicules")
        page.select_option("#filtres [name=marque]", "Peugeot")
        expect(bouton).to_have_text("Voir les 20 véhicules")
        # Modèles de la marque proposés aussitôt, avec leurs comptes.
        expect(page.locator("#filtres [name=modele]")).to_be_enabled()
        self.assertEqual(page.locator("#filtres [name=modele] option").all_text_contents(), ["Tous", "3008 (14)", "208 (6)"])
        page.select_option("#filtres [name=energie]", "Diesel")
        expect(bouton).to_have_text("Voir les 14 véhicules")
        if CAPTURES:
            page.screenshot(path=str(Path(CAPTURES) / "filtres-390.png"))
        bouton.click()
        page.wait_for_url(re.compile(r"marque=Peugeot"))
        expect(page.locator("#resultats-titre")).to_have_text("14 véhicules")
        self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 390)
        if CAPTURES:
            page.screenshot(path=str(Path(CAPTURES) / "catalogue-390.png"), full_page=True)
            bureau = self.browser.new_page(viewport={"width": 1440, "height": 900})
            bureau.goto(self.base + "/vehicules")
            bureau.screenshot(path=str(Path(CAPTURES) / "catalogue-1440.png"))
            bureau.close()
        self.assertEqual(erreurs, [])


if __name__ == "__main__":
    unittest.main()
