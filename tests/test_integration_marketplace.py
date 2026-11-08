"""Intégration de la marketplace avec la configuration de production (master).

- la configuration livrée désactive les enchères et active les propositions libres ;
- /vehicule/<slug> reste la page SEO, /vehicule/<référence> redirige en 301 vers elle ;
- les routes de proposition /api/marketplace/… répondent ;
- les pages de la marketplace portent les en-têtes de sécurité.

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_integration_marketplace
Le Worker tourne avec les variables de wrangler.jsonc telles quelles (aucune n'est forcée par le test).
"""
import json
import os
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from test_administration import port_libre
    from test_securite import entetes_worker
except ImportError:
    from tests.test_administration import port_libre
    from tests.test_securite import entetes_worker

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
MOT_DE_PASSE = "motdepasse-solide"
CGV_VERSION = "2026-11-01"


def config_livree():
    """wrangler.jsonc sans commentaires."""
    texte = "\n".join(ligne for ligne in (PROJET / "wrangler.jsonc").read_text().splitlines() if not ligne.strip().startswith("//"))
    return json.loads(texte)


def config_de_test(dossier):
    """wrangler.jsonc avec chemins absolus ; les variables (LEGACY_AUCTIONS_ENABLED…) restent celles livrées."""
    config = config_livree()
    config["main"] = str(PROJET / config["main"])
    config["assets"]["directory"] = str(PROJET / config["assets"]["directory"])
    for base in config["d1_databases"]:
        base["migrations_dir"] = str(PROJET / base["migrations_dir"])
    config.pop("triggers", None)
    chemin = Path(dossier) / "wrangler.test.json"
    chemin.write_text(json.dumps(config))
    return str(chemin)


class SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


# Migrations déjà appliquées en production, par nom : aucune ne doit être renommée, supprimée ou ajoutée en double.
MIGRATIONS_PRODUCTION = [
    "0001_espace_acheteur.sql", "0002_acheteur_vehicules_factures.sql", "0003_administration.sql", "0004_encheres.sql",
    "0005_conditions.sql", "0006_offre_acceptee_unique.sql", "0007_mcp_oauth.sql", "0008_depot_garantie.sql",
    "0009_paiements_caution.sql", "0010_caution_devise_carte.sql", "0011_dossiers_vendeurs.sql", "0011_journal_seo.sql",
    "0012_limites_par_ip.sql", "0012_marketplace_vendeurs.sql", "0013_regles_documents_vendeurs.sql", "0013_retrait_offre.sql",
    "0014_marketplace_phase1.sql", "0015_propositions_lot1.sql", "0016_journal_caution.sql",
]


class ConfigLivreeTest(unittest.TestCase):
    def test_migrations_de_production_inchangees(self):
        # Un nouveau besoin de schéma va dans 0017 ou au-delà.
        existantes = sorted(p.name for p in (PROJET / "migrations").glob("*.sql") if p.name < "0017")
        self.assertEqual(existantes, MIGRATIONS_PRODUCTION)

    def test_offres_libres_sans_encheres_par_defaut(self):
        config = config_livree()
        self.assertEqual(config["vars"]["LEGACY_AUCTIONS_ENABLED"], "false")
        self.assertEqual(config["vars"]["FREE_OFFERS_ENABLED"], "true")
        self.assertIn('data-proposal-only="false"', (PROJET / "my-auto-export" / "index.html").read_text())
        self.assertEqual(sorted(config["triggers"]["crons"]), sorted(["30 2 * * *", "0 5 * * *", "0 6 * * *"]))
        self.assertEqual({b["binding"] for b in config["r2_buckets"]}, {"PHOTOS", "SELLER_DOCUMENTS"})


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class IntegrationMarketplaceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
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
        for email in ("admin@ex.com", "alice@ex.com"):
            corps = {"name": email.split("@")[0].title() + " Test", "email": email, "password": MOT_DE_PASSE}
            assert cls.requete("/api/register", corps, "POST")[0] == 201
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'")
        cls.sql("UPDATE users SET deposit_tnd = 1000000 WHERE email = 'alice@ex.com'")
        cls.cookies = {email: cls.connexion(email) for email in ("admin@ex.com", "alice@ex.com")}
        assert cls.requete("/api/terms", {"version": CGV_VERSION}, "POST", cls.cookies["alice@ex.com"])[0] == 200
        stock = {"make": "Peugeot", "model": "208", "year": 2022, "status": "stock", "indicativePriceTnd": 60000}
        assert cls.requete("/api/admin/vehicles/INT-SEO", stock, "PUT", cls.cookies["admin@ex.com"])[0] == 200

    @classmethod
    def tearDownClass(cls):
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, commande):
        subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--command", commande],
                       cwd=PROJET, check=True, capture_output=True)

    @classmethod
    def requete(cls, chemin, data=None, method=None, cookie=None, suivre=True):
        headers = {"Origin": cls.base, "CF-Connecting-IP": "10.0.9.1"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        requete = urllib.request.Request(cls.base + chemin, data=None if data is None else json.dumps(data).encode(), method=method, headers=headers)
        ouvrir = urllib.request.urlopen if suivre else urllib.request.build_opener(SansRedirection).open
        try:
            with ouvrir(requete) as reponse:
                corps, entetes, statut = reponse.read(), reponse.headers, reponse.status
        except urllib.error.HTTPError as erreur:
            with erreur:
                corps, entetes, statut = erreur.read(), erreur.headers, erreur.code
        if "application/json" in (entetes.get("Content-Type") or ""):
            return statut, json.loads(corps or b"null"), entetes
        return statut, corps.decode(errors="replace"), entetes

    @classmethod
    def connexion(cls, email):
        return cls.requete("/api/login", {"email": email, "password": MOT_DE_PASSE}, "POST")[2]["Set-Cookie"].split(";")[0]

    def test_enchere_refusee_avec_la_config_livree(self):
        fin = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        lot = {"make": "BMW", "model": "X3", "year": 2021, "status": "open", "endsAt": fin, "startingPriceTnd": 100000}
        self.assertEqual(self.requete("/api/admin/vehicles/INT-ENC", lot, "PUT", self.cookies["admin@ex.com"])[0], 200)
        statut, corps, _ = self.requete("/api/offers", {"reference": "INT-ENC", "amount": 100000}, "POST", self.cookies["alice@ex.com"])
        self.assertEqual(statut, 410, corps)
        statut, detail, _ = self.requete("/api/auctions/INT-ENC")
        self.assertEqual(statut, 410)
        statut, html, _ = self.requete("/")
        self.assertEqual(statut, 200)
        self.assertIn('data-proposal-only="true"', html)

    def test_page_seo_et_reference_nue(self):
        canonique = "/vehicule/peugeot-208-2022-int-seo"
        statut, html, _ = self.requete(canonique, suivre=False)
        self.assertEqual(statut, 200)
        self.assertIn(f'<link rel="canonical" href="https://www.myautoexport.com{canonique}">', html)
        self.assertIn('data-proposal-ref="INT-SEO"', html)
        for nue in ("/vehicule/INT-SEO", "/vehicule/int-seo"):
            statut, _, entetes = self.requete(nue, suivre=False)
            self.assertEqual((statut, entetes.get("Location")), (301, self.base + canonique), nue)
        self.assertEqual(self.requete("/vehicule/inconnu-0000", suivre=False)[0], 404)

    def test_route_de_proposition(self):
        statut, corps, _ = self.requete("/api/marketplace/proposal-vehicles/INT-SEO")
        self.assertEqual(statut, 200, corps)
        self.assertEqual(corps["vehicle"]["reference"], "INT-SEO")
        self.assertTrue(corps["vehicle"]["active"], "M&Y reçoit les propositions sans vendeur affecté ni réserve")
        self.assertTrue(corps["rules"]["freeSubmission"])
        self.assertIn("version", corps["rules"])
        self.assertEqual(self.requete("/api/marketplace/proposal-vehicles/INCONNU")[0], 404)
        self.assertEqual(self.requete("/api/marketplace/offers", {"reference": "INT-SEO"}, "POST")[0], 401)
        statut, corps, _ = self.requete("/api/marketplace/offers?side=buyer", cookie=self.cookies["alice@ex.com"])
        self.assertEqual((statut, corps["offers"]), (200, []))

    def test_entetes_de_securite_des_pages_marketplace(self):
        attendus = entetes_worker()
        pages = ["/mes-offres", "/vendeur/offres", "/garages", "/admin/marketplace", "/confidentialite", "/conditions-marketplace",
                 "/droits-donnees", "/vendre", "/mes-vehicules", "/admin-vendeurs", "/api/marketplace/rules"]
        for chemin in pages:
            with self.subTest(chemin=chemin):
                statut, _, entetes = self.requete(chemin)
                self.assertLess(statut, 500)
                for cle, valeur in attendus.items():
                    if cle == "Content-Security-Policy":
                        self.assertIn("frame-ancestors 'none'", entetes.get(cle, ""))
                        self.assertIn("object-src 'none'", entetes.get(cle, ""))
                    else:
                        self.assertEqual(entetes.get(cle), valeur, cle)
                if chemin not in ("/confidentialite", "/conditions-marketplace", "/droits-donnees"):
                    self.assertEqual(entetes.get("Cache-Control"), "private, no-store")
        # Pages rendues par worker/marketplace-pages.js : leur CSP plus stricte (aucun script en ligne) est conservée.
        csp = self.requete("/mes-offres")[2]["Content-Security-Policy"]
        self.assertIn("script-src 'self';", csp)
        self.assertNotIn("unsafe-inline", csp.split("script-src", 1)[1].split(";")[0])
        self.assertEqual(self.requete("/mes-offres")[2]["X-Robots-Tag"], "noindex, nofollow")


if __name__ == "__main__":
    unittest.main()
