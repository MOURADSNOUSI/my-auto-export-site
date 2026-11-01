"""Tests de bout en bout du référencement servi par le Worker (worker/seo.js) : pages véhicules, sitemap dynamique,
liste indexable de l'accueil, page 404, contrôle SEO quotidien et après publication, affichage mobile.

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_pages_vehicules
Ignorés si la variable WRANGLER n'est pas définie.
"""
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

PROJET = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJET / "scripts"))
import controle_seo  # noqa: E402

WRANGLER = os.environ.get("WRANGLER")
DOMAINE = "https://www.myautoexport.com"
NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
MOT_DE_PASSE = "motdepasse-solide"


def config_de_test(dossier):
    """wrangler.jsonc avec chemins absolus et un stockage R2 local."""
    texte = "\n".join(ligne for ligne in (PROJET / "wrangler.jsonc").read_text().splitlines() if not ligne.strip().startswith("//"))
    config = json.loads(texte)
    config["main"] = str(PROJET / config["main"])
    config["assets"]["directory"] = str(PROJET / config["assets"]["directory"])
    for base in config["d1_databases"]:
        base["migrations_dir"] = str(PROJET / base["migrations_dir"])
    chemin = Path(dossier) / "wrangler.test.json"
    chemin.write_text(json.dumps(config))
    return str(chemin)


def port_libre():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OUVREUR = urllib.request.build_opener(SansRedirection)

VEHICULES = {
    "SEO-STOCK": {
        "make": "Peugeot", "model": "3008", "trim": "GT Hybrid", "status": "stock", "year": 2023, "mileageKm": 42000,
        "fuel": "Hybride", "country": "France", "indicativePriceTnd": 98000, "photos": ["photos/MY-0001-1.jpg"],
        "specs": [["Transmission", "Automatique"], ["Mise en circulation", "03/2023"]]
    },
    "SEO-LIVE": {"make": "Audi", "model": "Q5", "status": "open", "year": 2021, "mileageKm": 80000, "startingPriceTnd": 70000},
    "SEO-FIN": {"make": "Volvo", "model": "XC60", "status": "open", "year": 2020, "mileageKm": 95000},
    "SEO-RETIRE": {"make": "Fiat", "model": "500", "status": "stock", "year": 2019, "mileageKm": 60000},
    "SEO-MODIF": {"make": "Renault", "model": "Clio", "status": "stock", "year": 2022, "mileageKm": 30000},
}


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class PagesVehiculesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        subprocess.run([WRANGLER, "d1", "migrations", "apply", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config],
                       cwd=PROJET, check=True, capture_output=True)
        port = port_libre()
        cls.base = f"http://localhost:{port}"
        cls.serveur = subprocess.Popen(
            [WRANGLER, "dev", "--local", "--port", str(port), "--persist-to", cls.persist, "-c", cls.config, "--test-scheduled"],
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

        cls.requete("/api/register", {"name": "Admin Test", "email": "admin@example.com", "password": MOT_DE_PASSE}, "POST")
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'")
        _, _, entetes = cls.requete("/api/login", {"email": "admin@example.com", "password": MOT_DE_PASSE}, "POST")
        cls.cookie = entetes.get("Set-Cookie").split(";")[0]
        maintenant = datetime.now(timezone.utc)
        VEHICULES["SEO-LIVE"]["endsAt"] = (maintenant + timedelta(days=3)).isoformat()
        VEHICULES["SEO-FIN"]["endsAt"] = (maintenant - timedelta(hours=1)).isoformat()
        for reference, vehicule in VEHICULES.items():
            statut, _, _ = cls.requete(f"/api/admin/vehicles/{reference}", vehicule, "PUT", cls.cookie)
            assert statut == 200, (reference, statut)
        statut, _, _ = cls.requete("/api/admin/vehicles/SEO-RETIRE", None, "DELETE", cls.cookie)
        assert statut == 200, statut

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, commande):
        resultat = subprocess.run(
            [WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--json", "--command", commande],
            cwd=PROJET, check=True, capture_output=True, text=True)
        return json.loads(resultat.stdout)[0]["results"]

    @classmethod
    def requete(cls, chemin, data=None, method=None, cookie=None):
        headers = {"Origin": cls.base, "Accept": "text/html,application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        requete = urllib.request.Request(cls.base + chemin, data=None if data is None else json.dumps(data).encode(),
                                         method=method, headers=headers)
        try:
            with OUVREUR.open(requete) as reponse:
                return reponse.status, reponse.read().decode(), reponse.headers
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, erreur.read().decode(), erreur.headers

    def page(self, chemin):
        statut, html, entetes = self.requete(chemin)
        return statut, html, entetes

    def json_ld(self, html):
        return [json.loads(bloc) for bloc in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)]

    def sitemap(self):
        statut, xml, entetes = self.requete("/sitemap.xml")
        self.assertEqual(statut, 200)
        self.assertIn("application/xml", entetes.get("Content-Type"))
        return [(url.find(f"{NS}loc").text, getattr(url.find(f"{NS}lastmod"), "text", None)) for url in ET.fromstring(xml).iter(f"{NS}url")]

    def chemin(self, reference):
        _, corps, _ = self.requete("/api/catalogue")
        return next(lot["url"] for lot in json.loads(corps) if lot["reference"] == reference)

    # --- Pages véhicules ---

    def test_adresse_lisible_et_permanente(self):
        self.assertEqual(self.chemin("SEO-STOCK"), "/vehicules/peugeot-3008-2023-seo-stock")

    def test_page_vehicule_indexable(self):
        statut, html, _ = self.page("/vehicules/peugeot-3008-2023-seo-stock")
        self.assertEqual(statut, 200)
        self.assertIn(f'<link rel="canonical" href="{DOMAINE}/vehicules/peugeot-3008-2023-seo-stock">', html)
        self.assertNotIn('name="robots"', html)
        self.assertIn("<title>Peugeot 3008 GT Hybrid 2023 · 42 000 km · Réf. SEO-STOCK | M&amp;Y AUTO EXPORT</title>", html.replace(" ", " "))
        self.assertEqual(len(re.findall(r"<h1[ >]", html)), 1)
        # Caractéristiques dans le HTML servi, sans JavaScript.
        for texte in ("<dt>Kilométrage</dt>", "<dd>Automatique</dd>", "<dd>France</dd>", "Prix indicatif export"):
            self.assertIn(texte, html)
        vehicule, ariane = self.json_ld(html)
        self.assertEqual(vehicule["@type"], ["Product", "Car"])
        self.assertEqual(vehicule["mileageFromOdometer"], {"@type": "QuantitativeValue", "value": 42000, "unitCode": "KMT"})
        self.assertEqual(vehicule["dateVehicleFirstRegistered"], "2023-03")
        self.assertEqual(vehicule["vehicleTransmission"], "Automatique")
        self.assertEqual(vehicule["image"], [f"{DOMAINE}/photos/MY-0001-1.jpg"])
        self.assertEqual((vehicule["offers"]["price"], vehicule["offers"]["priceCurrency"]), (98000, "TND"))
        self.assertIn("ne sont pas compris", vehicule["offers"]["description"])
        self.assertEqual(ariane["@type"], "BreadcrumbList")
        self.assertEqual(ariane["itemListElement"][-1]["item"], f"{DOMAINE}/vehicules/peugeot-3008-2023-seo-stock")

    def test_images_optimisees(self):
        _, html, _ = self.page("/vehicules/peugeot-3008-2023-seo-stock")
        self.assertIn('<source srcset="/photos/web/MY-0001-1.webp" type="image/webp">', html)
        image = re.search(r'<img src="/photos/MY-0001-1.jpg"[^>]*>', html).group(0)
        self.assertIn('alt="Peugeot 3008 GT Hybrid — photo 1 sur 1"', image)
        self.assertIn('fetchpriority="high"', image)
        for img in re.findall(r"<img [^>]*>", html):
            self.assertIn("alt=", img)

    def test_enchere_sans_prix_de_vente_annonce(self):
        statut, html, _ = self.page(self.chemin("SEO-LIVE"))
        self.assertEqual(statut, 200)
        vehicule = self.json_ld(html)[0]
        self.assertEqual(vehicule["@type"], "Car")
        self.assertNotIn("offers", vehicule)
        self.assertIn("Mise à prix", html)
        self.assertIn('href="/?lot=SEO-LIVE"', html)

    def test_vente_terminee_hors_index(self):
        statut, html, _ = self.page("/vehicules/volvo-xc60-2020-seo-fin")
        self.assertEqual(statut, 200)
        self.assertIn('<meta name="robots" content="noindex">', html)
        self.assertIn("Vente terminée", html)
        self.assertNotIn('href="/?lot=SEO-FIN"', html)

    def test_vehicule_retire_repond_410(self):
        statut, html, _ = self.page("/vehicules/fiat-500-2019-seo-retire")
        self.assertEqual(statut, 410)
        self.assertIn('<meta name="robots" content="noindex">', html)

    def test_redirections_et_404(self):
        statut, _, entetes = self.page("/vehicules/ancien-titre-seo-stock")
        self.assertEqual((statut, entetes.get("Location")), (301, f"{self.base}/vehicules/peugeot-3008-2023-seo-stock"))
        statut, _, entetes = self.page("/vehicules/peugeot-3008-2023-seo-stock/")
        self.assertEqual((statut, entetes.get("Location")), (301, f"{self.base}/vehicules/peugeot-3008-2023-seo-stock"))
        statut, _, entetes = self.page("/vehicules/")
        self.assertEqual((statut, entetes.get("Location")), (301, f"{self.base}/vehicules"))
        for chemin in ("/vehicules/inconnu-0000", "/page-inexistante"):
            statut, html, _ = self.page(chemin)
            self.assertEqual(statut, 404, chemin)
            self.assertIn('<meta name="robots" content="noindex">', html)

    def test_modification_redirige_l_ancienne_adresse(self):
        modifie = {**VEHICULES["SEO-MODIF"], "year": 2021}
        statut, _, _ = self.requete("/api/admin/vehicles/SEO-MODIF", modifie, "PUT", self.cookie)
        self.assertEqual(statut, 200)
        adresses = [loc for loc, _ in self.sitemap()]
        self.assertIn(f"{DOMAINE}/vehicules/renault-clio-2021-seo-modif", adresses)
        self.assertNotIn(f"{DOMAINE}/vehicules/renault-clio-2022-seo-modif", adresses)
        statut, _, entetes = self.page("/vehicules/renault-clio-2022-seo-modif")
        self.assertEqual((statut, entetes.get("Location")), (301, f"{self.base}/vehicules/renault-clio-2021-seo-modif"))

    # --- Sitemap, accueil, liste ---

    def test_sitemap_ne_liste_que_les_pages_indexables(self):
        entrees = self.sitemap()
        adresses = [loc for loc, _ in entrees]
        self.assertEqual(len(adresses), len(set(adresses)))
        for page in ("/", "/vehicules", "/conditions"):
            self.assertIn(DOMAINE + page, adresses)
        self.assertIn(f"{DOMAINE}/vehicules/peugeot-3008-2023-seo-stock", adresses)
        self.assertIn(f"{DOMAINE}/vehicules/audi-q5-2021-seo-live", adresses)
        for exclue in ("volvo-xc60-2020-seo-fin", "fiat-500-2019-seo-retire"):
            self.assertNotIn(f"{DOMAINE}/vehicules/{exclue}", adresses)
        self.assertNotIn(f"{DOMAINE}/importer-un-vehicule-en-tunisie", adresses, "brouillon non validé")
        for loc, lastmod in entrees:
            if "/vehicules/" in loc:
                self.assertRegex(lastmod or "", r"^\d{4}-\d{2}-\d{2}$", loc)

    def test_controle_seo_du_site_local(self):
        resultat = controle_seo.controler(self.base)
        self.assertEqual(resultat["erreurs"], [])
        self.assertGreater(resultat["pages"], 5)

    def test_accueil_liste_les_vehicules_sans_javascript(self):
        statut, html, _ = self.page("/")
        self.assertEqual(statut, 200)
        self.assertIn('<section class="block" id="tous-vehicules" aria-labelledby="tous-vehicules-title">', html)
        self.assertIn('href="/vehicules/peugeot-3008-2023-seo-stock"', html)
        self.assertNotIn("seo-fin", html)
        self.assertNotIn("seo-retire", html)

    def test_page_liste_des_vehicules(self):
        statut, html, _ = self.page("/vehicules")
        self.assertEqual(statut, 200)
        self.assertIn(f'<link rel="canonical" href="{DOMAINE}/vehicules">', html)
        liste = self.json_ld(html)[0]
        self.assertEqual(liste["@type"], "ItemList")
        self.assertIn(f"{DOMAINE}/vehicules/peugeot-3008-2023-seo-stock", [item["url"] for item in liste["itemListElement"]])

    def test_administration_non_indexee(self):
        for chemin in ("/admin", "/admin.html"):
            statut, _, entetes = self.page(chemin)
            if statut == 200:
                self.assertEqual(entetes.get("X-Robots-Tag"), "noindex, nofollow", chemin)

    def test_guide_en_brouillon_non_indexe(self):
        statut, html, _ = self.page("/importer-un-vehicule-en-tunisie")
        self.assertEqual(statut, 200)
        self.assertIn('<meta name="robots" content="noindex, follow">', html)
        self.assertEqual(self.json_ld(html)[0]["@type"], "FAQPage")

    # --- Navigateur ---

    def test_lien_profond_ouvre_la_fiche(self):
        context = self.browser.new_context()
        self.addCleanup(context.close)
        page = context.new_page()
        page.goto(self.base + "/?lot=SEO-STOCK")
        page.wait_for_selector("#lot-dialog[open]")
        self.assertIn("Peugeot 3008 GT Hybrid", page.inner_text("#lot-dialog-title"))
        self.assertEqual(page.get_attribute(".lot-card .lot-title a[href='/vehicules/peugeot-3008-2023-seo-stock']", "href"),
                         "/vehicules/peugeot-3008-2023-seo-stock")

    def test_affichage_mobile_sans_defilement_horizontal(self):
        context = self.browser.new_context(viewport={"width": 360, "height": 740}, device_scale_factor=2, is_mobile=True, has_touch=True)
        self.addCleanup(context.close)
        page = context.new_page()
        for chemin in ("/vehicules/peugeot-3008-2023-seo-stock", "/vehicules", "/importer-un-vehicule-en-tunisie", "/page-inexistante"):
            page.goto(self.base + chemin)
            largeurs = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
            self.assertLessEqual(largeurs[0], largeurs[1], chemin)
            taille = page.evaluate("parseFloat(getComputedStyle(document.body).fontSize)")
            self.assertGreaterEqual(taille, 16, chemin)
        page.goto(self.base + "/vehicules/peugeot-3008-2023-seo-stock")
        for hauteur in page.eval_on_selector_all(".bouton", "els => els.map((el) => el.getBoundingClientRect().height)"):
            self.assertGreaterEqual(hauteur, 44, "zone tactile")

    # --- Contrôle SEO et journal ---

    def declencher(self, heure_utc):
        instant = datetime(2026, 11, 2, heure_utc, tzinfo=timezone.utc)
        with urllib.request.urlopen(f"{self.base}/cdn-cgi/handler/scheduled?cron=0+{heure_utc}+*+*+*&time={int(instant.timestamp() * 1000)}") as reponse:
            self.assertEqual(reponse.status, 200)

    def test_controle_quotidien_a_7h_heure_de_paris(self):
        avant = len(self.sql("SELECT id FROM seo_journal WHERE declencheur = 'quotidien'"))
        self.declencher(5)  # 06:00 à Paris le 2 novembre (heure d'hiver) : ignoré
        self.assertEqual(len(self.sql("SELECT id FROM seo_journal WHERE declencheur = 'quotidien'")), avant)
        self.declencher(6)  # 07:00 à Paris
        lignes = self.sql("SELECT resume FROM seo_journal WHERE declencheur = 'quotidien' ORDER BY id DESC")
        self.assertEqual(len(lignes), avant + 1)
        resume = json.loads(lignes[0]["resume"])
        self.assertTrue(any(a.get("reference") == "SEO-FIN" and "vente terminée" in a["probleme"] for a in resume["avertissements"]))
        self.assertNotIn("SEO-STOCK", [e.get("reference") for e in resume["erreurs"]])

    def test_publication_journalisee_et_consultable(self):
        statut, corps, _ = self.requete("/api/admin/seo", cookie=self.cookie)
        self.assertEqual(statut, 200)
        controles = json.loads(corps)["controles"]
        publications = [c for c in controles if c["declencheur"] == "publication"]
        self.assertGreaterEqual(len(publications), len(VEHICULES))
        self.assertTrue(all(c["vehicules"] <= 1 for c in publications))
        statut, _, _ = self.requete("/api/admin/seo")
        self.assertEqual(statut, 401)


if __name__ == "__main__":
    unittest.main()
