"""Tests de l'accueil et des fiches (chantier 3) : cartes rendues par le Worker, choix du public (cookie « public » et
lien ?public=), badges d'éligibilité, règles d'affichage des prix estimés, WhatsApp, réglages de la rubrique « Site »,
formulations interdites et affichage mobile.

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_accueil
Ignorés si la variable WRANGLER n'est pas définie. Captures dans ACCUEIL_CAPTURES si la variable est définie.
"""
import json
import os
import re
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

from playwright.sync_api import sync_playwright

try:
    from test_administration import config_de_test, port_libre
except ImportError:
    from tests.test_administration import config_de_test, port_libre

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
CAPTURES = os.environ.get("ACCUEIL_CAPTURES")
MOT_DE_PASSE = "motdepasse-solide"
ANNEE = date.today().year
# Âges calculés par calculerPrix : 1 an (résident et FCR), 4 ans (FCR seul), 11 ans (aucun).
VEHICULES = {
    "ACC-JEUNE": {"make": "Peugeot", "model": "208", "status": "stock", "year": ANNEE - 1, "mileageKm": 20000, "fuel": "Essence",
                  "engineCc": 1200, "prixEur": 15000},
    "ACC-FCR": {"make": "Renault", "model": "Captur", "status": "stock", "year": ANNEE - 4, "mileageKm": 50000, "fuel": "Diesel",
                "engineCc": 1500, "prixEur": 12000},
    "ACC-VIEUX": {"make": "Fiat", "model": "Panda", "status": "stock", "year": ANNEE - 11, "mileageKm": 140000, "fuel": "Essence",
                  "engineCc": 1100, "prixEur": 3000},
    "ACC-SANS": {"make": "Kia", "model": "Ceed", "status": "stock", "year": ANNEE - 1, "mileageKm": 10000, "fuel": "Essence"},
    "ACC-RETIRE": {"make": "Seat", "model": "Ibiza", "status": "stock", "year": ANNEE - 2, "mileageKm": 30000},
}
INTERDITES = ("meilleur prix", "au meilleur prix", "tout compris", "prix tout compris")


class SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OUVREUR = urllib.request.build_opener(SansRedirection)


def montant_regex(n):
    """Montant entier tel que l'affiche Intl fr-FR (séparateur de milliers espace fine, insécable ou absent)."""
    chiffres = f"{int(n):,}".split(",")
    return re.compile(r"(?<!\d)" + r"[\s  ]?".join(chiffres) + r"(?![\d,])")


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class AccueilTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        # Mode de production (wrangler.jsonc) : propositions seules, enchères désactivées.
        config = json.loads(Path(cls.config).read_text())
        config["vars"]["LEGACY_AUCTIONS_ENABLED"] = "false"
        Path(cls.config).write_text(json.dumps(config))
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
        assert cls.api("/api/register", {"name": "Admin Test", "email": "admin@ex.com", "password": MOT_DE_PASSE}, "POST")[0] == 201
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'")
        cls.cookie = cls.api("/api/login", {"email": "admin@ex.com", "password": MOT_DE_PASSE}, "POST")[2]["Set-Cookie"].split(";")[0]
        assert cls.api("/api/admin/prix/taux-manuel", {"valeur": 3.4, "actif": True}, "PUT", cls.cookie)[0] == 200
        for reference, vehicule in VEHICULES.items():
            statut, data, _ = cls.api(f"/api/admin/vehicles/{reference}", vehicule, "PUT", cls.cookie)
            assert statut == 200, (reference, statut, data)
        assert cls.api("/api/admin/vehicles/ACC-RETIRE", None, "DELETE", cls.cookie)[0] == 200
        # Montants attendus, calculés par la même fonction (simulation /admin-prix).
        cls.estimations = {}
        for reference in ("ACC-JEUNE", "ACC-FCR", "ACC-VIEUX"):
            v = VEHICULES[reference]
            statut, data, _ = cls.api("/api/admin/prix/simulation", {k: v[k] for k in ("prixEur", "year", "engineCc", "fuel")}, "POST", cls.cookie)
            assert statut == 200, data
            cls.estimations[reference] = data
        _, catalogue, _ = cls.api("/api/catalogue")
        cls.fiches = {lot["reference"]: lot["url"] for lot in catalogue}
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
        headers = {"Origin": cls.base, "CF-Connecting-IP": "10.0.0.3"}
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

    def page(self, chemin, public=None):
        """(statut, html, en-têtes) sans suivre les redirections. public : valeur brute du cookie « public »."""
        headers = {"Accept": "text/html"}
        if public is not None:
            headers["Cookie"] = f"public={public}"
        try:
            with OUVREUR.open(urllib.request.Request(self.base + chemin, headers=headers)) as reponse:
                return reponse.status, reponse.read().decode(), reponse.headers
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, erreur.read().decode(), erreur.headers

    def regler(self, cle, valeur):
        statut, data, _ = self.api(f"/api/admin/site/{cle}", {"valeur": valeur}, "PUT", self.cookie)
        self.assertEqual(statut, 200, data)

    def pages(self):
        return ["/", "/vehicules", *(self.fiches[r] for r in ("ACC-JEUNE", "ACC-FCR", "ACC-VIEUX", "ACC-SANS"))]

    def carte(self, html, reference):
        """HTML de la carte d'un véhicule (accueil ou /vehicules)."""
        chemin = self.fiches[reference]
        cartes = [c for c in html.split('<li class="carte-vehicule">')[1:] if f'href="{chemin}"' in c]
        self.assertEqual(len(cartes), 1, reference)
        fin = cartes[0].index("</li>", cartes[0].index('class="carte-fiche"'))
        return cartes[0][:fin]

    def montants_estimes(self):
        """Tous les montants calculés (EUR et TND), pour vérifier qu'aucun n'apparaît quand les prix sont masqués."""
        montants = []
        for e in self.estimations.values():
            montants += [e["prixTreEur"], e["prixResidentTnd"], e["dedouanementFcrEstimeTnd"]]
            montants += [l["montant"] for l in e["detail"] if l["montant"] >= 10000]
        return [m for m in montants if m]

    # --- Cartes sans JavaScript ---

    def test_accueil_et_liste_montrent_les_cartes_sans_javascript(self):
        for chemin in ("/", "/vehicules"):
            statut, html, entetes = self.page(chemin)
            self.assertEqual(statut, 200, chemin)
            self.assertIn("Cookie", entetes.get("Vary", ""), chemin)
            carte = self.carte(html, "ACC-JEUNE")
            self.assertIn("Peugeot 208", carte)
            self.assertIn(f"{ANNEE - 1} · 20 000 km · Essence", carte.replace("\xa0", " "))
            self.assertIn('loading="lazy"' if "<img" in carte else "carte-sans-photo", carte)
            self.assertNotIn("acc-retire", html, chemin)
        _, html, _ = self.page("/")
        self.assertIn('<section class="block" id="tous-vehicules" aria-labelledby="tous-vehicules-title">', html)
        self.assertRegex(html.replace("&#39;", "'"), r'<h1 id="page-title"[^>]*>Votre voiture d\'Europe, livrée en Tunisie\.</h1>')
        self.assertIn("Prix estimé, détail complet.", html)
        self.assertIn("Achat sur mandat", html)
        self.assertNotIn("Enchères ou achat direct", html)
        self.assertNotIn("Prix en dinars tunisiens", html)
        self.assertNotIn("Comment acheter", html)
        self.assertNotIn("Questions sur le dépôt de garantie", html)
        self.assertNotIn("retirable à chaque enchère", html)
        for ancre in ("tous-vehicules", "comment-ca-marche", "nos-prix", "questions"):
            self.assertIn(f'href="#{ancre}"', html)
            self.assertIn(f'id="{ancre}"', html)
        self.assertEqual(html.count('<details class="faq">'), 5)
        self.assertIn('<section class="block" id="temoignages" aria-labelledby="temoignages-titre" hidden></section>', html)

    def test_donnees_echappees(self):
        statut, data, _ = self.api("/api/admin/vehicles/ACC-XSS", {**VEHICULES["ACC-SANS"], "model": "<script>alert(1)</script>"}, "PUT", self.cookie)
        self.assertEqual(statut, 200, data)
        self.addCleanup(self.api, "/api/admin/vehicles/ACC-XSS", None, "DELETE", self.cookie)
        for chemin in ("/", "/vehicules"):
            _, html, _ = self.page(chemin)
            self.assertNotIn("<script>alert(1)</script>", html)
            self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)

    # --- Choix du public ---

    def test_lien_public_pose_le_cookie_et_redirige(self):
        statut, _, entetes = self.page("/?public=resident")
        self.assertEqual((statut, entetes.get("Location")), (303, "/"))
        self.assertEqual(entetes.get("Set-Cookie"), "public=resident; Path=/; Max-Age=31536000; SameSite=Lax; Secure")
        statut, _, entetes = self.page("/vehicules?public=tre")
        self.assertEqual((statut, entetes.get("Location")), (303, "/vehicules"))
        self.assertEqual(entetes.get("Set-Cookie"), "public=tre; Path=/; Max-Age=31536000; SameSite=Lax; Secure")
        statut, _, entetes = self.page(f"{self.fiches['ACC-JEUNE']}?public=resident")
        self.assertEqual((statut, entetes.get("Location")), (303, self.fiches["ACC-JEUNE"]))
        for invalide in ("admin", "RESIDENT", "tre;x=1", ""):
            statut, _, entetes = self.page(f"/?public={urllib.request.quote(invalide)}")
            self.assertEqual((statut, entetes.get("Location"), entetes.get("Set-Cookie")), (303, "/", None), invalide)

    def test_cookie_bascule_l_affichage(self):
        for chemin in ("/", "/vehicules", self.fiches["ACC-JEUNE"]):
            _, html, _ = self.page(chemin, "resident")
            self.assertIn('data-public="resident" aria-pressed="true"', html, chemin)
            self.assertIn('data-public="tre" aria-pressed="false"', html, chemin)
            self.assertIn("Prix résident sur devis", html, chemin)
            self.assertIn("régime en attente de textes d&#39;application", html, chemin)
            _, html, _ = self.page(chemin, "tre")
            self.assertIn('data-public="tre" aria-pressed="true"', html, chemin)
            self.assertNotIn("Prix résident sur devis", html, chemin)
            self.assertIn("Estimation sur demande", html, chemin)

    def test_cookie_invalide_ignore(self):
        for valeur in ("admin", "TRE", "resident2", "<b>"):
            _, html, _ = self.page("/", valeur)
            self.assertIn('data-public="tre" aria-pressed="true"', html, valeur)
            self.assertNotIn("Prix résident sur devis", html, valeur)

    def test_public_par_defaut(self):
        self.regler("public_par_defaut", "resident")
        self.addCleanup(self.regler, "public_par_defaut", "tre")
        _, html, _ = self.page("/")
        self.assertIn('data-public="resident" aria-pressed="true"', html)
        _, html, _ = self.page("/", "tre")
        self.assertIn('data-public="tre" aria-pressed="true"', html, "le cookie l'emporte sur le réglage")

    # --- Badges ---

    def test_badges_suivent_l_eligibilite(self):
        attendus = {"ACC-JEUNE": (True, True), "ACC-FCR": (False, True), "ACC-VIEUX": (False, False), "ACC-SANS": (False, False)}
        # Badge résident masqué tant que prix_resident_actif est faux (règles résident non vérifiées).
        for resident_actif in (False, True):
            self.regler("prix_resident_actif", resident_actif)
            _, accueil, _ = self.page("/")
            for reference, (resident, fcr) in attendus.items():
                e = self.estimations.get(reference)
                if e:
                    self.assertEqual((e["motifNonEligibleResident"] is None, e["motifNonEligibleFcr"] is None), (resident, fcr), reference)
                _, fiche, _ = self.page(self.fiches[reference])
                for html in (self.carte(accueil, reference), fiche):
                    self.assertEqual("Importable par un résident" in html, resident and resident_actif, reference)
                    self.assertEqual("Tunisiens à l&#39;étranger (FCR)" in html, fcr, reference)
        self.regler("prix_resident_actif", False)

    # --- Prix ---

    def test_prix_masques_aucun_montant_estime(self):
        for public in ("tre", "resident"):
            for chemin in self.pages():
                _, html, _ = self.page(chemin, public)
                for montant in self.montants_estimes():
                    self.assertIsNone(montant_regex(montant).search(html), (public, chemin, montant))
                self.assertNotIn("Prix estimé ·", html)
                self.assertNotIn('class="prix-detail"', html)
                for bloc in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
                    self.assertNotIn("prixTre", bloc)
                    for montant in self.montants_estimes():
                        self.assertIsNone(montant_regex(montant).search(bloc), (public, chemin, montant))
        _, html, _ = self.page("/", "tre")
        self.assertIn("Estimation sur demande", self.carte(html, "ACC-JEUNE"))
        self.assertIn("mailto:contact@myautoexport.com", self.carte(html, "ACC-JEUNE"))

    def test_prix_publics_tre_en_euros_et_resident_sur_devis(self):
        self.regler("prix_publics_actifs", True)
        self.addCleanup(self.regler, "prix_publics_actifs", False)
        jeune = self.estimations["ACC-JEUNE"]
        _, html, _ = self.page("/", "tre")
        carte = self.carte(html, "ACC-JEUNE")
        self.assertIsNotNone(montant_regex(jeune["prixTreEur"]).search(carte))
        self.assertIn("€", carte)
        self.assertIn(f"Prix estimé · taux du {date.today():%d/%m/%Y} · Devis définitif après vérification par notre transitaire", carte)
        self.assertIn('<details class="prix-detail"><summary>Détail du calcul</summary>', carte)
        self.assertIn("TRE : transport", carte)
        self.assertNotIn("Résident :", carte, "pas de ligne résident en mode TRE")
        _, fiche, _ = self.page(self.fiches["ACC-JEUNE"], "tre")
        self.assertIsNotNone(montant_regex(jeune["prixTreEur"]).search(fiche))
        self.assertIn('data-proposal-ref="ACC-JEUNE"', fiche, "bouton « Proposer une offre » conservé")
        offre = json.loads(re.findall(r'<script type="application/ld\+json">(.*?)</script>', fiche, re.S)[0]).get("offers")
        self.assertTrue(offre is None or offre["price"] != jeune["prixTreEur"], "pas de prix estimé dans le JSON-LD")
        for chemin in self.pages():
            _, html, _ = self.page(chemin, "resident")
            self.assertNotIn("Prix estimé ·", html, chemin)
            for e in self.estimations.values():
                for montant in (e["prixResidentTnd"], e["prixTreEur"]):
                    if montant:
                        self.assertIsNone(montant_regex(montant).search(html), (chemin, montant))
        _, html, _ = self.page("/", "resident")
        self.assertIn("Prix résident sur devis", self.carte(html, "ACC-JEUNE"))
        self.assertIn("Réservé aux Tunisiens résidant à l&#39;étranger", self.carte(html, "ACC-FCR"))
        self.assertIn("Prix résident sur devis", self.carte(html, "ACC-SANS"), "éligibilité inconnue sans prix d'achat")
        _, html, _ = self.page("/", "tre")
        self.assertIn("Estimation sur demande", self.carte(html, "ACC-SANS"))

    def test_prix_resident_visible_seulement_avec_les_deux_reglages(self):
        self.regler("prix_resident_actif", True)
        self.addCleanup(self.regler, "prix_resident_actif", False)
        _, html, _ = self.page("/", "resident")
        self.assertIn("Prix résident sur devis", self.carte(html, "ACC-JEUNE"), "prix_publics_actifs encore faux")
        self.regler("prix_publics_actifs", True)
        self.addCleanup(self.regler, "prix_publics_actifs", False)
        _, html, _ = self.page("/", "resident")
        carte = self.carte(html, "ACC-JEUNE")
        self.assertIsNotNone(montant_regex(self.estimations["ACC-JEUNE"]["prixResidentTnd"]).search(carte))
        self.assertIn("TND", carte)

    # --- WhatsApp et réglages ---

    def test_whatsapp_absent_sans_numero_present_avec(self):
        _, html, _ = self.page("/")
        self.assertNotIn("wa.me", html)
        for invalide in ("abc", "+216 12", "+2161234567890123", "0033<script>", 21612345678):
            statut, data, _ = self.api("/api/admin/site/whatsapp_numero", {"valeur": invalide}, "PUT", self.cookie)
            self.assertEqual(statut, 400, (invalide, data))
        self.regler("whatsapp_numero", "+216 12 345 678")
        self.addCleanup(self.regler, "whatsapp_numero", "")
        for chemin in ("/", "/vehicules", self.fiches["ACC-JEUNE"]):
            _, html, _ = self.page(chemin)
            self.assertIn('<a class="bouton-whatsapp" href="https://wa.me/21612345678" target="_blank" rel="noopener"', html, chemin)
        _, html, _ = self.page("/")
        self.assertIn("https://wa.me/21612345678?text=", self.carte(html, "ACC-JEUNE"))

    def test_api_reglages_site(self):
        statut, data, _ = self.api("/api/admin/site", cookie=self.cookie)
        self.assertEqual(statut, 200)
        self.assertEqual({r["cle"]: r["valeur"] for r in data["reglages"]}, {
            "whatsapp_numero": "", "public_par_defaut": "tre", "prix_publics_actifs": False, "prix_resident_actif": False, "temoignages": []})
        self.assertEqual(self.api("/api/admin/site/automations_actives", {"valeur": True}, "PUT", self.cookie)[0], 404)
        self.assertEqual(self.api("/api/admin/site/public_par_defaut", {"valeur": "admin"}, "PUT", self.cookie)[0], 400)
        self.assertEqual(self.api("/api/admin/site/prix_publics_actifs", {"valeur": "true"}, "PUT", self.cookie)[0], 400)
        self.assertEqual(self.api("/api/admin/site/temoignages", {"valeur": [{"nom": ""}]}, "PUT", self.cookie)[0], 400)
        self.assertEqual(self.api("/api/admin/site/prix_publics_actifs", {"valeur": True}, "PUT")[0], 401)
        # Chaque modification est journalisée (chantier 1).
        self.regler("public_par_defaut", "tre")
        self.assertTrue(self.sql("SELECT id FROM audit_logs WHERE action = 'PUT /api/admin/site/public_par_defaut' AND resultat = 'ok'"))

    def test_temoignages_masques_si_vides(self):
        _, html, _ = self.page("/")
        self.assertNotIn("Ils ont reçu leur voiture", html)
        self.regler("temoignages", [{"nom": "Sami <b>", "texte": "Voiture reçue.", "vehicule": "Peugeot 208"}])
        self.addCleanup(self.regler, "temoignages", [])
        _, html, _ = self.page("/")
        self.assertIn('<section class="block" id="temoignages" aria-labelledby="temoignages-titre">', html)
        self.assertIn("Ils ont reçu leur voiture", html)
        self.assertIn("Sami &lt;b&gt;", html)

    def test_validation_des_nouveaux_champs_vehicule(self):
        for champs in ({"prixEur": "abc"}, {"prixEur": -5}, {"premiereImmatriculation": "2024-13-45"}, {"premiereImmatriculation": "hier"}, {"engineCc": 0}):
            statut, _, _ = self.api("/api/admin/vehicles/ACC-INVALIDE", {**VEHICULES["ACC-SANS"], **champs}, "PUT", self.cookie)
            self.assertEqual(statut, 400, champs)
        statut, data, _ = self.api("/api/admin/vehicles/ACC-DATE", {**VEHICULES["ACC-JEUNE"], "premiereImmatriculation": f"{ANNEE - 1}-01-15"}, "PUT", self.cookie)
        self.addCleanup(self.api, "/api/admin/vehicles/ACC-DATE", None, "DELETE", self.cookie)
        self.assertEqual((statut, data["vehicle"]["premiereImmatriculation"], data["vehicle"]["prixEur"]), (200, f"{ANNEE - 1}-01-15", 15000))

    # --- Formulations et fiche ---

    def test_formulations_interdites_absentes(self):
        for public in ("tre", "resident"):
            for chemin in self.pages():
                _, html, _ = self.page(chemin, public)
                for interdite in INTERDITES:
                    self.assertNotIn(interdite, html.lower(), (public, chemin))

    def test_fiche_garde_sa_structure_et_ses_codes(self):
        chemin = self.fiches["ACC-JEUNE"]
        self.assertEqual(chemin, f"/vehicules/peugeot-208-{ANNEE - 1}-acc-jeune")
        statut, html, _ = self.page(chemin)
        self.assertEqual(statut, 200)
        self.assertIn(f'<link rel="canonical" href="https://www.myautoexport.com{chemin}">', html)
        self.assertNotIn('name="robots"', html)
        self.assertEqual(len(re.findall(r"<h1[ >]", html)), 1)
        types = [json.loads(b)["@type"] for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)]
        self.assertEqual(types, ["Car", "BreadcrumbList"])
        self.assertIn("Proposer une offre", html)
        statut, _, entetes = self.page("/vehicules/ancien-titre-acc-jeune")
        self.assertEqual((statut, entetes.get("Location")), (301, f"{self.base}{chemin}"))
        statut, html, _ = self.page(f"/vehicules/seat-ibiza-{ANNEE - 2}-acc-retire")
        self.assertEqual(statut, 410)
        self.assertIn('<meta name="robots" content="noindex">', html)

    # --- Navigateur ---

    def test_mobile_390_choix_du_public_et_connexion(self):
        context = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        self.addCleanup(context.close)
        page = context.new_page()
        erreurs = []
        page.on("pageerror", lambda e: erreurs.append(str(e)))
        page.goto(self.base + "/")
        page.wait_for_function("typeof catalogueEtat !== 'undefined' && catalogueEtat !== 'loading'")
        for largeur in (360, 390):
            page.set_viewport_size({"width": largeur, "height": 844})
            largeurs = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
            self.assertLessEqual(largeurs[0], largeurs[1], largeur)
        page.set_viewport_size({"width": 390, "height": 844})
        if CAPTURES:
            page.screenshot(path=str(Path(CAPTURES) / "accueil-390.png"), full_page=True)
            page.screenshot(path=str(Path(CAPTURES) / "accueil-390-haut.png"))
            page.locator("#tous-vehicules").screenshot(path=str(Path(CAPTURES) / "accueil-390-cartes.png"))
        self.assertEqual(page.get_attribute("[data-public='tre']", "aria-pressed"), "true")
        page.focus("[data-public='resident']")
        with page.expect_navigation():
            page.keyboard.press("Enter")
        self.assertEqual(page.get_attribute("[data-public='resident']", "aria-pressed"), "true")
        self.assertIn({"name": "public", "value": "resident"}, [{"name": c["name"], "value": c["value"]} for c in context.cookies()])
        self.assertIn("Prix résident sur devis", page.text_content("#liste-vehicules"))
        with page.expect_navigation():
            page.click("[data-public='tre']")
        self.assertEqual(page.get_attribute("[data-public='tre']", "aria-pressed"), "true")
        page.wait_for_function("typeof catalogueEtat !== 'undefined' && catalogueEtat !== 'loading'")
        page.click("#account-button")
        page.wait_for_selector("#auth-dialog[open]")
        self.assertIn("Mon compte", page.text_content("#account-label"))
        self.assertEqual(erreurs, [])
        for chemin in ("/vehicules", self.fiches["ACC-JEUNE"]):
            page.goto(self.base + chemin)
            largeurs = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
            self.assertLessEqual(largeurs[0], largeurs[1], chemin)
        self.assertEqual(erreurs, [])

    def test_sans_javascript_le_choix_fonctionne_par_lien(self):
        context = self.browser.new_context(java_script_enabled=False, viewport={"width": 390, "height": 844})
        self.addCleanup(context.close)
        page = context.new_page()
        page.goto(self.base + "/")
        self.assertTrue(page.is_visible("#liste-vehicules .carte-vehicule"))
        page.click("[data-public='resident']")
        page.wait_for_url(self.base + "/")
        self.assertEqual(page.get_attribute("[data-public='resident']", "aria-pressed"), "true")

    def test_capture_bureau(self):
        context = self.browser.new_context(viewport={"width": 1440, "height": 900})
        self.addCleanup(context.close)
        page = context.new_page()
        erreurs = []
        page.on("pageerror", lambda e: erreurs.append(str(e)))
        page.goto(self.base + "/")
        page.wait_for_function("typeof catalogueEtat !== 'undefined' && catalogueEtat !== 'loading'")
        largeurs = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
        self.assertLessEqual(largeurs[0], largeurs[1])
        if CAPTURES:
            page.screenshot(path=str(Path(CAPTURES) / "accueil-1440.png"), full_page=True)
            page.screenshot(path=str(Path(CAPTURES) / "accueil-1440-haut.png"))
            page.locator("#comment-ca-marche").scroll_into_view_if_needed()
            page.screenshot(path=str(Path(CAPTURES) / "accueil-1440-sections.png"))
        self.assertEqual(erreurs, [])


if __name__ == "__main__":
    unittest.main()
