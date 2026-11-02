"""Tests des filtres de la page d'accueil et du catalogue (my-auto-export/index.html).

Lancement : python3 -m unittest tests.test_filtres
Prérequis : pip install playwright && playwright install chromium
"""
import json
import unittest
from datetime import timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

from tests.test_catalogue import ORIGIN, SITE_DIR, iso, lot

PARC = [
    lot(reference="A", make="Audi", model="A3", year=2019, fuel="Diesel", transmission="Manuelle", condition="used", mileageKm=90000,
        indicativePriceTnd=60000, country="Belgique", powerHp=116, color="Noir", engineCc=1600, bodyType="Berline", doors=5, seats=5, status="stock", endsAt=None),
    lot(reference="B", make="Audi", model="Q5", year=2022, fuel="Essence", transmission="Automatique", condition="new", mileageKm=5000,
        indicativePriceTnd=180000, country="Allemagne", powerHp=265, color="Blanc", engineCc=1984, bodyType="SUV", doors=5, seats=5,
        status="stock", endsAt=None, buyNowPriceTnd=175000),
    lot(reference="C", make="BMW", model="X1", year=2021, fuel="Hybride (essence / électrique)", transmission="Automatique", condition="accident",
        mileageKm=40000, indicativePriceTnd=120000, country="Belgique", color="Noir", bodyType="SUV", doors=5, seats=7),
    lot(reference="D", make="BMW", model="Serie 1", status="upcoming", endsAt=None, startingPriceTnd=40000, indicativePriceTnd=None),
    lot(reference="E", make="Renault", model="Clio", year=2018, fuel="Essence", indicativePriceTnd=25000, mileageKm=150000, status="stock", endsAt=None,
        specs=[["Puissance", "100 kW"]]),
]


# Contrôles du bandeau qui dépassent de l'écran ou de leur formulaire (le défilement horizontal du reste de la page est hors sujet).
DEBORDE = """[...document.querySelectorAll('#hero-search, #hero-search [data-filtre], #hero-search button')]
  .filter(e => e.getBoundingClientRect().right > innerWidth + 0.5 || e.getBoundingClientRect().left < -0.5).map(e => e.id || e.tagName)"""


class FiltresTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def ouvrir(self, lots=PARC, largeur=1280, hauteur=900, avances=True):
        page = self.browser.new_page(bypass_csp=True, viewport={"width": largeur, "height": hauteur})
        self.addCleanup(page.close)
        page.set_default_timeout(5000)

        def servir(route):
            chemin = route.request.url.removeprefix(ORIGIN).split("?")[0]
            if chemin == "/lots.json":
                route.fulfill(body=json.dumps(lots), content_type="application/json")
            elif (SITE_DIR / chemin.lstrip("/")).is_file():
                route.fulfill(path=SITE_DIR / chemin.lstrip("/"))
            else:
                route.fulfill(path=SITE_DIR / "index.html")

        page.route(f"{ORIGIN}/**", servir)
        page.goto(f"{ORIGIN}/index.html")
        page.wait_for_function("catalogueEtat !== 'loading'")
        if avances:
            page.evaluate("document.querySelectorAll('[data-avances]').forEach(d => { d.open = true; })")
        return page

    def references(self, page):
        return sorted(page.eval_on_selector_all(".lot-card", "cartes => cartes.map(c => c.textContent.match(/Réf\\.?\\s*([A-Z0-9-]+)/)?.[1] || c.dataset.reference)"))

    def nombre(self, page):
        return page.locator(".lot-card").count()

    def test_bandeau_six_filtres_principaux_et_avances_repliables(self):
        page = self.ouvrir(avances=False)
        principaux = page.eval_on_selector_all("#hero-principaux [data-filtre]", "e => e.map(x => x.id)")
        self.assertEqual(principaux, ["hero-make", "hero-model", "hero-fuel", "hero-year-min", "hero-year-max", "hero-gearbox", "hero-condition"])
        self.assertFalse(page.eval_on_selector("#hero-avances", "d => d.open"))
        self.assertFalse(page.is_visible("#hero-country"))
        page.click("#hero-avances summary")
        for identifiant in ("hero-mileage-min", "hero-price-max", "hero-country", "hero-power-min", "hero-color", "hero-displacement-min",
                            "hero-body-type", "hero-doors", "hero-seats", "hero-auction", "hero-buy-now"):
            self.assertTrue(page.is_visible(f"#{identifiant}"), identifiant)
        colonnes = page.eval_on_selector("#hero-principaux", "e => getComputedStyle(e).gridTemplateColumns.split(' ').length")
        self.assertEqual(colonnes, 2)

    def test_listes_issues_des_annonces_reelles(self):
        page = self.ouvrir()
        valeurs = lambda s: page.eval_on_selector_all(f"{s} option", "o => o.map(x => x.value)")
        self.assertEqual(valeurs("#make"), ["", "Audi", "BMW", "Renault"])
        self.assertEqual(valeurs("#fuel"), ["", "Diesel", "Essence", "Hybride"])
        self.assertEqual(valeurs("#gearbox"), ["", "Automatique", "Manuelle"])
        self.assertEqual(valeurs("#condition"), ["", "new", "used", "accident"])  # « endommagé » : aucune annonce
        self.assertEqual(valeurs("#country"), ["", "Allemagne", "Belgique"])
        self.assertEqual(valeurs("#seats"), ["", "5", "7"])
        self.assertEqual(valeurs("#year-min"), ["", "2022", "2021", "2019", "2018"])

    def test_modele_depend_de_la_marque(self):
        page = self.ouvrir()
        valeurs = lambda s: page.eval_on_selector_all(f"{s} option", "o => o.map(x => x.value)")
        self.assertEqual(valeurs("#hero-model"), ["", "A3", "Clio", "Q5", "Serie 1", "X1"])
        page.select_option("#hero-make", "BMW")
        self.assertEqual(valeurs("#hero-model"), ["", "Serie 1", "X1"])
        self.assertEqual(valeurs("#model"), ["", "Serie 1", "X1"])
        page.select_option("#hero-model", "X1")
        page.select_option("#hero-make", "Audi")
        self.assertEqual(page.input_value("#hero-model"), "")  # le modèle n'existe pas chez Audi
        self.assertEqual(self.nombre(page), 2)

    def test_chaque_filtre_individuellement(self):
        cas = [
            ("#fuel", "select", "Essence", 2),
            ("#gearbox", "select", "Automatique", 2),
            ("#condition", "select", "used", 1),
            ("#country", "select", "Belgique", 2),
            ("#color", "select", "Noir", 2),
            ("#body-type", "select", "SUV", 4),
            ("#seats", "select", "7", 1),
            ("#doors", "select", "5", 3),
            ("#auction", "select", "upcoming", 1),
            ("#auction", "select", "buynow", 1),
        ]
        for selecteur, _, valeur, attendu in cas:
            with self.subTest(selecteur=selecteur, valeur=valeur):
                page = self.ouvrir()
                page.select_option(selecteur, valeur)
                self.assertEqual(self.nombre(page), attendu)

    def test_plages_min_max(self):
        page = self.ouvrir()
        page.select_option("#year-min", "2019")
        page.select_option("#year-max", "2021")
        self.assertEqual(self.nombre(page), 2)  # A (2019) et C (2021)
        page.click("#clear-filters")
        page.fill("#mileage-min", "10000")
        page.fill("#mileage-max", "100000")
        self.assertEqual(self.nombre(page), 2)  # A et C ; B trop peu, E trop de km, D sans kilométrage
        page.click("#clear-filters")
        page.fill("#price-min", "100000")
        self.assertEqual(self.nombre(page), 2)
        page.fill("#price-max", "150000")
        self.assertEqual(self.nombre(page), 1)
        page.click("#clear-filters")
        page.fill("#displacement-min", "1800")
        self.assertEqual(self.nombre(page), 1)

    def test_puissance_en_ch_et_en_kw(self):
        page = self.ouvrir()
        page.fill("#power-min", "200")
        self.assertEqual(self.nombre(page), 1)  # B : 265 ch
        page.select_option("#power-unit", "kW")
        page.fill("#power-min", "90")
        page.fill("#power-max", "110")
        # A : 116 ch = 85 kW (hors plage) ; E : « 100 kW » lu dans les caractéristiques
        self.assertEqual(self.nombre(page), 1)
        self.assertIn("Clio", page.text_content("#lot-grid"))

    def test_valeur_absente_ecartee_et_filtre_vide_sans_effet(self):
        page = self.ouvrir()
        self.assertEqual(self.nombre(page), 5)
        page.fill("#mileage-min", "0")
        self.assertEqual(self.nombre(page), 4)  # D n'a pas de kilométrage : on n'invente rien
        page.fill("#mileage-min", "")
        self.assertEqual(self.nombre(page), 5)

    def test_combinaison_et_achat_immediat(self):
        page = self.ouvrir()
        page.select_option("#make", "Audi")
        page.select_option("#fuel", "Essence")
        self.assertEqual(self.nombre(page), 1)
        page.select_option("#fuel", "")
        page.check("#buy-now")
        self.assertEqual(self.nombre(page), 1)
        page.select_option("#make", "BMW")
        self.assertEqual(self.nombre(page), 0)
        self.assertEqual(page.text_content("#empty-title"), "Aucun véhicule ne correspond à ces critères")

    def test_compteur_dynamique_du_bandeau(self):
        page = self.ouvrir()
        self.assertEqual(page.text_content("#hero-submit"), "Afficher 5 véhicules")
        page.select_option("#hero-make", "BMW")
        self.assertEqual(page.text_content("#hero-submit"), "Afficher 2 véhicules")
        page.select_option("#hero-fuel", "Hybride")
        self.assertEqual(page.text_content("#hero-submit"), "Afficher 1 véhicule")
        page.select_option("#hero-make", "Renault")
        self.assertEqual(page.text_content("#hero-submit"), "Afficher 0 véhicule")

    def test_synchronisation_bandeau_et_catalogue(self):
        page = self.ouvrir()
        page.select_option("#hero-make", "Audi")
        self.assertEqual(page.input_value("#make"), "Audi")
        page.select_option("#year-min", "2022")
        self.assertEqual(page.input_value("#hero-year-min"), "2022")
        page.fill("#price-max", "200000")
        self.assertEqual(page.input_value("#hero-price-max"), "200000")
        self.assertTrue(page.eval_on_selector("#hero-avances", "d => d.open"))  # un filtre avancé actif ouvre la section
        page.click("#hero-submit")
        self.assertEqual(self.nombre(page), 1)

    def test_reinitialisation_depuis_les_deux_panneaux(self):
        page = self.ouvrir()
        for bouton in ("#hero-reset", "#clear-filters"):
            page.select_option("#make", "Audi")
            page.fill("#price-max", "70000")
            self.assertEqual(self.nombre(page), 1)
            page.click(bouton)
            self.assertEqual(self.nombre(page), 5)
            self.assertEqual(page.input_value("#hero-make"), "")
            self.assertEqual(page.input_value("#price-max"), "")
            self.assertEqual(page.input_value("#hero-price-max"), "")

    def test_caracteristique_jamais_renseignee_est_grisee(self):
        page = self.ouvrir([lot(reference="Z", make="Audi", model="A1")])
        for identifiant in ("#gearbox", "#condition", "#country", "#color", "#displacement-min", "#doors"):
            self.assertTrue(page.is_disabled(identifiant), identifiant)
        self.assertTrue(page.is_enabled("#make"))
        self.assertTrue(page.is_enabled("#auction"))

    def test_clavier_et_libelles(self):
        page = self.ouvrir(avances=False)
        page.focus("#hero-make")
        page.keyboard.press("Tab")
        self.assertEqual(page.evaluate("document.activeElement.id"), "hero-model")
        page.focus("#hero-avances summary")
        page.keyboard.press("Enter")
        self.assertTrue(page.eval_on_selector("#hero-avances", "d => d.open"))
        sans_nom = page.eval_on_selector_all(
            "[data-filtre]", "els => els.filter(e => !(e.labels?.length || e.getAttribute('aria-label'))).map(e => e.id)")
        self.assertEqual(sans_nom, [])

    def test_mobile_une_colonne_sans_debordement(self):
        page = self.ouvrir(largeur=375, hauteur=800, avances=False)
        colonnes = page.eval_on_selector("#hero-principaux", "e => getComputedStyle(e).gridTemplateColumns.split(' ').length")
        self.assertEqual(colonnes, 1)
        self.assertEqual(page.evaluate(DEBORDE), [])
        page.click("#hero-avances summary")
        self.assertEqual(page.evaluate(DEBORDE), [])
        page.select_option("#hero-make", "Audi")
        page.click("#hero-submit")
        self.assertEqual(self.nombre(page), 2)

    def test_filtres_sur_une_annonce_future_avec_nouveaux_champs(self):
        futur = lot(reference="NEW", make="Kia", model="Ceed", year=2023, transmission="Boîte automatique", condition="damaged", color="Rouge",
                    engineCc=1500, doors=5, seats=5, powerHp=140, status="stock", endsAt=None)
        page = self.ouvrir([futur])
        page.select_option("#gearbox", "Automatique")
        page.select_option("#condition", "damaged")
        page.fill("#displacement-min", "1400")
        page.fill("#power-min", "130")
        self.assertEqual(self.nombre(page), 1)


if __name__ == "__main__":
    unittest.main()
