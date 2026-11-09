"""Tests de l'import OpenLane (worker/import-openlane.js), contre un faux TheCarApi local : aucun appel réel.

Couvre la recherche réservée à l'administration, l'import en brouillon (invisible du public), le doublon, la remise en
ligne depuis /admin (source conservée), l'outil MCP avec confirmation, la limite d'annonces suivies et le retrait
automatique à la fin de l'enchère (cron 30 2 * * *, coupé par automations_actives).

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_import_openlane
Ignorés si la variable WRANGLER n'est pas définie.
"""
import http.server
import json
import os
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from test_administration import config_de_test, port_libre
except ImportError:
    from tests.test_administration import config_de_test, port_libre

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
MOT_DE_PASSE = "motdepasse-solide"
JETON_AGENT = "jeton-agent-de-test-" + "o" * 32


def annonce(numero, fin="2099-01-01T12:00:00Z", **champs):
    """Annonce à la forme réelle de TheCarApi (contrat 2026-10-05) ; engine_cc (absent chez TheCarApi) pour le repli."""
    return {"auction_id_str": numero, "site_name": "openlane", "clean_make": "Peugeot", "clean_model": "3008", "registration_year": 2023, "is_buy_now": True,
            "date_first_registration": "2021-03-15T00:00:00", "mileage": 64000, "fuel_group": "Diesel", "gearbox_group": "Manual", "hp": 130,
            "buy_now_price": 14500, "public_price_eur": 19600, "engine_cc": 1499, "original_url": f"https://www.openlane.eu/en/car/info?auctionId={numero}",
            "auction_end_at": fin, "thumbnail_url": f"/image-vault/{numero}.webp?k=1&exp=1&sig=s",
            "images": [{"url": f"https://images.openlane.eu/carimgs/{numero}/general/1.jpg", "served_url": f"/image-vault/{numero}.webp"}], **champs}


class FauxTheCarApi(http.server.BaseHTTPRequestHandler):
    resultats = []
    requetes = []

    def do_GET(self):
        FauxTheCarApi.requetes.append({"params": dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query)), "cle": self.headers.get("X-API-Key")})
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"total": len(FauxTheCarApi.resultats), "results": FauxTheCarApi.resultats}).encode())

    def log_message(self, *args):
        pass


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class ImportOpenlaneTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api_faux = http.server.HTTPServer(("127.0.0.1", 0), FauxTheCarApi)
        threading.Thread(target=cls.api_faux.serve_forever, daemon=True).start()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        config = json.loads(Path(cls.config).read_text())
        config["vars"].update({
            "LEGACY_AUCTIONS_ENABLED": "false", "THECARAPI_KEY": "cle-de-test", "AGENT_TOKEN": JETON_AGENT,
            "THECARAPI_URL": f"http://127.0.0.1:{cls.api_faux.server_port}/search",
            # Taux du cron de 06:00 : jamais d'appel réel (le passage de 02:30 testé ici ne les appelle pas).
            "PRIX_URL_BCT": f"http://127.0.0.1:{cls.api_faux.server_port}/bct", "PRIX_URL_SECOURS": f"http://127.0.0.1:{cls.api_faux.server_port}/er"
        })
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
        cls.cookie = cls.compte("admin@ex.com")
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'")
        cls.client = cls.compte("client@ex.com")

    @classmethod
    def tearDownClass(cls):
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.api_faux.shutdown()
        cls.tmp.cleanup()

    @classmethod
    def compte(cls, email):
        assert cls.api("/api/register", {"name": "Test", "email": email, "password": MOT_DE_PASSE}, "POST")[0] == 201
        return cls.api("/api/login", {"email": email, "password": MOT_DE_PASSE}, "POST")[2]["Set-Cookie"].split(";")[0]

    @classmethod
    def sql(cls, commande):
        sortie = subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--json",
                                 "--command", commande], cwd=PROJET, check=True, capture_output=True, text=True).stdout
        return json.loads(sortie)[0]["results"]

    @classmethod
    def api(cls, chemin, data=None, method=None, cookie=None):
        headers = {"Origin": cls.base, "CF-Connecting-IP": "10.0.0.7", "Accept": "application/json"}
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
                corps = erreur.read()
                try:
                    return erreur.code, json.loads(corps or b"null"), erreur.headers
                except ValueError:
                    return erreur.code, corps.decode(), erreur.headers

    def outil(self, nom, arguments):
        corps = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": nom, "arguments": arguments}}
        requete = urllib.request.Request(self.base + "/mcp", data=json.dumps(corps).encode(), method="POST",
                                         headers={"Authorization": f"Bearer {JETON_AGENT}", "Content-Type": "application/json"})
        with urllib.request.urlopen(requete) as reponse:
            return json.loads(reponse.read())["result"]

    def rechercher(self, **filtres):
        statut, data, _ = self.api("/api/admin/import/recherche?" + urllib.parse.urlencode(filtres), cookie=self.cookie)
        self.assertEqual(statut, 200, data)
        return data

    def importer(self, numero):
        a = next(x for x in self.rechercher()["annonces"] if x["numero"] == numero)
        return self.api("/api/admin/import", {"annonce": a}, "POST", self.cookie)

    def regler_filtres(self, **filtres):
        statut, data, _ = self.api("/api/admin/import/filtres", {"filtres": filtres}, "PUT", self.cookie)
        self.assertEqual(statut, 200, data)
        return data["filtres"]

    def catalogue_public(self):
        return {lot["reference"] for lot in self.api("/api/catalogue")[1]}

    def setUp(self):
        self.regler_filtres()
        self.api("/api/admin/reglages/automations_actives", {"valeur": True}, "PUT", self.cookie)
        self.api("/api/admin/reglages/agent_ecriture_autorisee", {"valeur": False}, "PUT", self.cookie)

    def test_recherche_reservee_a_l_administration(self):
        FauxTheCarApi.resultats = [annonce("1001")]
        self.assertEqual(self.api("/api/admin/import/recherche")[0], 401)
        self.assertEqual(self.api("/api/admin/import/recherche", cookie=self.client)[0], 403)
        data = self.rechercher(brand="Peugeot", price_to=50000)
        self.assertEqual(data["annonces"][0]["reference"], "OL-1001")
        self.assertFalse(data["annonces"][0]["dejaImporte"])
        envoi = FauxTheCarApi.requetes[-1]
        self.assertEqual((envoi["cle"], envoi["params"]["site"], envoi["params"]["brand"], envoi["params"]["price_to"]), ("cle-de-test", "openlane", "Peugeot", "41100"),
                         "préfiltre M&Y appliqué, plafond de 30 000 € élargi au prix tout compris de TheCarApi")
        self.assertEqual((envoi["params"]["buy_now"], envoi["params"]["year_from"]), ("true", "2022"), "achat immédiat, 2022 ou après")
        self.rechercher(year_from=2024)
        self.assertEqual(FauxTheCarApi.requetes[-1]["params"]["year_from"], "2024", "un filtre plus strict reste possible")
        # Contrôle sur chaque annonce : sans achat immédiat ou avant 2022, elle n'est pas proposée ni importable.
        FauxTheCarApi.resultats = [annonce("1002", is_buy_now=False), annonce("1003", registration_year=2021), annonce("1004")]
        self.assertEqual([a["numero"] for a in self.rechercher()["annonces"]], ["1004"])
        for numero, champs in (("1002", {"achatImmediat": False}), ("1003", {"annee": 2021})):
            a = {**next(x for x in self.rechercher()["annonces"] if x["numero"] == "1004"), "numero": numero, **champs}
            self.assertEqual(self.api("/api/admin/import", {"annonce": a}, "POST", self.cookie)[0], 400, numero)
        self.assertEqual(self.api("/api/admin/import/recherche?brand=%3Cscript%3E", cookie=self.cookie)[0], 400)
        # Prix d'achat immédiat : obligatoire, plafond exact appliqué à ce prix (pas au prix tout compris de TheCarApi).
        FauxTheCarApi.resultats = [annonce("1005", buy_now_price=None), annonce("1006", buy_now_price=29000, public_price_eur=38000),
                                   annonce("1007", buy_now_price=31000, public_price_eur=40000)]
        trouvees = self.rechercher()["annonces"]
        self.assertEqual([(a["numero"], a["prixEur"]) for a in trouvees], [("1006", 29000)])
        self.assertEqual([a["numero"] for a in self.rechercher(price_to=25000)["annonces"]], [], "prix de la recherche appliqué exactement")
        sans_prix = {**trouvees[0], "numero": "1005", "prixAchatImmediatEur": None}
        self.assertEqual(self.api("/api/admin/import", {"annonce": sans_prix}, "POST", self.cookie)[0], 400, "sans prix d'achat immédiat")

    def test_import_en_brouillon_puis_remise_en_ligne(self):
        FauxTheCarApi.resultats = [annonce("2002")]
        statut, data, _ = self.importer("2002")
        self.assertEqual((statut, data["reference"], data["brouillon"]), (201, "OL-2002", True), data)
        self.assertNotIn("OL-2002", self.catalogue_public(), "brouillon invisible du public")
        self.assertEqual(self.importer("2002")[0], 409, "pas de doublon")
        self.assertTrue(self.rechercher()["annonces"][0]["dejaImporte"])
        vehicule = next(v for v in self.api("/api/admin/vehicles", cookie=self.cookie)[1]["vehicles"] if v["lot"]["reference"] == "OL-2002")
        self.assertTrue(vehicule["removed"])
        lot = vehicule["lot"]
        self.assertEqual(lot["year"], 2023)
        self.assertEqual((lot["make"], lot["model"], lot["prixEur"], lot["engineCc"], lot["powerHp"], lot["premiereImmatriculation"], lot["sourceUrl"]),
                         ("Peugeot", "3008", 14500, 1499, 130, "2021-03-15", "https://www.openlane.eu/en/car/info?auctionId=2002"))
        self.assertEqual(lot["photos"], [{"url": "https://images.openlane.eu/carimgs/2002/general/1.jpg", "authorized": True}])
        # « Remettre en ligne » depuis /admin : publié, source conservée.
        self.assertEqual(self.api("/api/admin/vehicles/OL-2002", lot, "PUT", self.cookie)[0], 200)
        self.assertIn("OL-2002", self.catalogue_public())
        source = json.loads(self.sql("SELECT json_extract(data, '$.importSource') AS s FROM vehicles WHERE reference = 'OL-2002'")[0]["s"])
        self.assertEqual((source["site"], source["id"], source["termine"]), ("openlane", "2002", False))
        self.assertTrue(self.sql("SELECT id FROM audit_logs WHERE action = 'POST /api/admin/import' AND acteur = 'admin' AND resultat = 'ok'"))

    def test_prefiltre_regle_par_l_administration(self):
        statut, data, _ = self.api("/api/admin/import/filtres", cookie=self.cookie)
        self.assertEqual((statut, data["filtres"]["anneeMin"], data["filtres"]["achatImmediat"]), (200, 2022, True))
        self.assertEqual(self.api("/api/admin/import/filtres", cookie=self.client)[0], 403)
        self.assertEqual(self.api("/api/admin/import/filtres", {"filtres": {}}, "PUT", self.client)[0], 403)
        for mauvais in ({"anneeMin": 1980}, {"prixMaxEur": "50000"}, {"carburant": "Gasoil"}, {"anneeMin": 2024, "anneeMax": 2023}):
            self.assertEqual(self.api("/api/admin/import/filtres", {"filtres": mauvais}, "PUT", self.cookie)[0], 400, mauvais)
        # Préfiltre élargi : prix et kilométrage relevés, toutes ventes, diesel automatique de 2023 à 2025.
        self.regler_filtres(anneeMin=2023, anneeMax=2025, kmMax=80000, prixMaxEur=50000, achatImmediat=False, carburant="Diesel", boite="Automatic")
        FauxTheCarApi.resultats = [annonce("7001", is_buy_now=False, registration_year=2024, public_price_eur=42000), annonce("7002", registration_year=2026)]
        data = self.rechercher(price_to=60000)
        envoi = FauxTheCarApi.requetes[-1]["params"]
        self.assertEqual({k: envoi.get(k) for k in ("year_from", "year_to", "kilometers_to", "price_to", "fuel", "gearbox", "buy_now")},
                         {"year_from": "2023", "year_to": "2025", "kilometers_to": "80000", "price_to": "50000", "fuel": "Diesel", "gearbox": "Automatic", "buy_now": None})
        self.assertEqual([a["numero"] for a in data["annonces"]], ["7001"], "2026 écarté par l'année maximum")
        self.assertEqual(self.importer("7001")[0], 201, "enchère sans achat immédiat importable quand le préfiltre l'autorise")
        self.assertTrue(self.sql("SELECT id FROM audit_logs WHERE action = 'PUT /api/admin/import/filtres' AND acteur = 'admin' AND resultat = 'ok'"))
        # Retour au préfiltre par défaut : une annonce sans achat immédiat est refusée à l'import.
        self.regler_filtres()
        FauxTheCarApi.resultats = [annonce("7004")]
        a = {**self.rechercher()["annonces"][0], "numero": "7003", "achatImmediat": False}
        statut, data, _ = self.api("/api/admin/import", {"annonce": a}, "POST", self.cookie)
        self.assertEqual(statut, 400)
        self.assertIn("achat immédiat", data["error"])

    def test_annonce_incomplete_refusee(self):
        FauxTheCarApi.resultats = [annonce("3003", clean_make=None, brand=None, make=None)]
        statut, data, _ = self.importer("3003")
        self.assertEqual(statut, 400)
        self.assertIn("Marque et modèle", data["error"])

    def test_outil_mcp_avec_confirmation(self):
        FauxTheCarApi.resultats = [annonce("4004")]
        resultat = self.outil("rechercher_openlane", {"brand": "Peugeot"})
        a = json.loads(resultat["content"][0]["text"])["annonces"][0]
        self.assertTrue(self.outil("importer_annonce_openlane", {"annonce": a, "confirmer": True})["isError"], "agent en lecture seule")
        self.api("/api/admin/reglages/agent_ecriture_autorisee", {"valeur": True}, "PUT", self.cookie)
        self.assertIn("confirmer", self.outil("importer_annonce_openlane", {"annonce": a})["content"][0]["text"])
        resultat = self.outil("importer_annonce_openlane", {"annonce": a, "confirmer": True})
        self.assertNotIn("isError", resultat, resultat)
        self.assertEqual(self.sql("SELECT removed FROM vehicles WHERE reference = 'OL-4004'"), [{"removed": 1}])
        journal = self.sql("SELECT acteur, resultat FROM audit_logs WHERE action = 'mcp.importer_annonce_openlane' AND resource_id = 'OL-4004' ORDER BY id")
        self.assertEqual([(l["acteur"], l["resultat"]) for l in journal], [("agent", "refuse"), ("agent", "erreur"), ("agent", "ok")])

    def test_retrait_automatique_a_la_fin_de_l_enchere(self):
        FauxTheCarApi.resultats = [annonce("5005", fin="2020-01-01T00:00:00Z"), annonce("5006")]
        for numero in ("5005", "5006"):
            self.assertEqual(self.importer(numero)[0], 201)
            lot = next(v for v in self.api("/api/admin/vehicles", cookie=self.cookie)[1]["vehicles"] if v["lot"]["reference"] == f"OL-{numero}")["lot"]
            self.assertEqual(self.api(f"/api/admin/vehicles/OL-{numero}", lot, "PUT", self.cookie)[0], 200)
        # Interrupteur coupé : rien n'est retiré.
        self.api("/api/admin/reglages/automations_actives", {"valeur": False}, "PUT", self.cookie)
        urllib.request.urlopen(self.base + "/__scheduled?cron=30+2+*+*+*").read()
        self.assertIn("OL-5005", self.catalogue_public())
        self.api("/api/admin/reglages/automations_actives", {"valeur": True}, "PUT", self.cookie)
        urllib.request.urlopen(self.base + "/__scheduled?cron=30+2+*+*+*").read()
        publics = self.catalogue_public()
        self.assertNotIn("OL-5005", publics, "enchère terminée : retirée")
        self.assertIn("OL-5006", publics, "enchère en cours : gardée")
        self.assertTrue(self.sql("SELECT id FROM audit_logs WHERE action = 'import.openlane.termine' AND resource_id = 'OL-5005' AND acteur = 'systeme'"))

    def test_limite_d_annonces_suivies(self):
        self.sql("""WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
                    INSERT INTO vehicles (reference, data, removed, updated_at) SELECT 'OL-LIM' || i,
                    json_object('reference', 'OL-LIM' || i, 'make', 'X', 'model', 'Y', 'status', 'stock', 'photos', json('[]'),
                    'importSource', json_object('site', 'openlane', 'id', 'LIM' || i, 'termine', json('false'))), 1, '2026-01-01T00:00:00Z' FROM n""")
        self.addCleanup(self.sql, "DELETE FROM vehicles WHERE reference LIKE 'OL-LIM%'")
        FauxTheCarApi.resultats = [annonce("6006")]
        statut, data, _ = self.importer("6006")
        self.assertEqual(statut, 429, data)
        self.assertIn("100 annonces", data["error"])


if __name__ == "__main__":
    unittest.main()
