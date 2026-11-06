"""Tests des prix estimés : routes /api/admin/prix, simulation, page /admin-prix et taux quotidien (cron 0 6 * * *).

Le taux quotidien est testé avec un faux serveur BCT local (PRIX_URL_BCT) : aucune requête vers la BCT ni ExchangeRate-API.
Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_prix
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
import urllib.request
from pathlib import Path

try:
    from test_administration import config_de_test, port_libre
except ImportError:
    from tests.test_administration import config_de_test, port_libre

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
MOT_DE_PASSE = "motdepasse-solide"
# Page BCT d'exemple, encodée en ISO-8859-1 comme la vraie.
PAGE_BCT = "<html><body><h1>Cours moyens des devises cotées en dinar tunisien</h1><table>" \
           "<tr><td>DOLLAR DES USA</td><td>USD</td><td>1</td><td>2,9512</td></tr>" \
           "<tr><td>EURO</td><td>EUR</td><td>1</td><td>3,3834</td></tr></table></body></html>"


class FausseBct(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/cours.jsp":
            corps = PAGE_BCT.encode("iso-8859-1")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=ISO-8859-1")
        else:
            corps = b"{}"
            self.send_response(500)
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def log_message(self, *args):
        pass


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class PrixTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bct = http.server.HTTPServer(("127.0.0.1", 0), FausseBct)
        threading.Thread(target=cls.bct.serve_forever, daemon=True).start()
        adresse_bct = f"http://127.0.0.1:{cls.bct.server_address[1]}"
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        config = json.loads(Path(cls.config).read_text())
        config["vars"]["PRIX_URL_BCT"] = adresse_bct + "/cours.jsp"
        config["vars"]["PRIX_URL_SECOURS"] = adresse_bct + "/secours"
        Path(cls.config).write_text(json.dumps(config))
        subprocess.run([WRANGLER, "d1", "migrations", "apply", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config],
                       cwd=PROJET, check=True, capture_output=True)
        port = port_libre()
        cls.base = f"http://localhost:{port}"
        cls.serveur = subprocess.Popen([WRANGLER, "dev", "--local", "--test-scheduled", "--port", str(port), "--persist-to", cls.persist, "-c", cls.config],
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
        for email in ("admin@ex.com", "acheteur@ex.com"):
            assert cls.requete("/api/register", {"name": "Test", "email": email, "password": MOT_DE_PASSE}, "POST")[0] == 201
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'")
        cls.cookie = cls.connexion("admin@ex.com")
        cls.cookie_acheteur = cls.connexion("acheteur@ex.com")

    @classmethod
    def tearDownClass(cls):
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.bct.shutdown()
        cls.tmp.cleanup()

    @classmethod
    def connexion(cls, email):
        return cls.requete("/api/login", {"email": email, "password": MOT_DE_PASSE}, "POST")[2]["Set-Cookie"].split(";")[0]

    @classmethod
    def sql(cls, commande):
        sortie = subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--json",
                                 "--command", commande], cwd=PROJET, check=True, capture_output=True, text=True).stdout
        return json.loads(sortie)[0]["results"]

    @classmethod
    def requete(cls, chemin, data=None, method=None, cookie=None):
        headers = {"Origin": cls.base, "CF-Connecting-IP": "10.0.0.2"}
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

    def journal(self, action):
        return self.sql(f"SELECT acteur, resultat, details FROM audit_logs WHERE action = '{action}' ORDER BY id")

    def taux_manuel(self, valeur, actif):
        statut, data, _ = self.requete("/api/admin/prix/taux-manuel", {"valeur": valeur, "actif": actif}, "PUT", self.cookie)
        self.assertEqual(statut, 200, data)
        return data

    def test_lecture_valeurs_initiales(self):
        statut, data, _ = self.requete("/api/admin/prix", cookie=self.cookie)
        self.assertEqual(statut, 200, data)
        self.assertFalse(data["prixPublicsActifs"])
        self.assertTrue(data["aVerifier"])
        self.assertEqual({r["code"] for r in data["regimes"]},
                         {"resident_droit_commun", "resident_phev_lf2026", "resident_hev_lf2026", "resident_electrique_lf2026", "fcr_classique"})
        self.assertTrue(all(r["statut_verification"] == "a_verifier" for r in data["regimes"]))
        # Chaque ligne de grille et chaque paramètre réglable porte la mention À VÉRIFIER ou À REMPLACER.
        self.assertTrue(all("À VÉRIFIER" in l["note"] or "À REMPLACER" in l["note"] for l in data["grille"]))
        self.assertTrue(all("http" in l["note"] or "exemple" in l["note"] for l in data["grille"]))
        reglables = [p for p in data["parametres"] if not p["cle"].startswith("taux_")]
        self.assertEqual(len(reglables), 10)
        self.assertTrue(all("À REMPLACER" in p["note"] or "À VÉRIFIER" in p["note"] for p in reglables))
        # Électriques à 0 % de droit de douane ; PHEV voiture particulière au droit commun (art. 47 LF 2026, JORT 148).
        phev = next(l for l in data["grille"] if l["regime"] == "resident_phev_lf2026")
        self.assertEqual((phev["droits_douane_pct"], phev["droit_consommation_pct"], phev["tva_pct"]), (20, 0, 7))
        self.assertIn("Ex 87.02 et Ex 87.04", phev["note"])
        self.assertIn("https://lake.jort.tn/journal-officiel/fr/2025/148.pdf", phev["note"])
        self.assertEqual(sorted({l["part_payee_pct"] for l in data["grille"] if l["regime"] == "fcr_classique"}), [25, 30])
        self.assertEqual(data["eligibilite"]["fcr"]["age_max_ans"], 5)
        self.assertEqual(data["sourcesTaux"]["principale"], "https://www.bct.gov.tn/bct/siteprod/cours.jsp")

    def test_acces_refuse_sans_admin(self):
        self.assertEqual(self.requete("/api/admin/prix")[0], 401)
        self.assertEqual(self.requete("/api/admin/prix", cookie=self.cookie_acheteur)[0], 403)
        self.assertEqual(self.requete("/api/admin/prix/parametres/frais_port_tnd", {"valeur": 1}, "PUT", self.cookie_acheteur)[0], 403)
        self.assertEqual(self.requete("/api/admin/prix/simulation", {"prixEur": 1000, "fuel": "Essence"}, "POST")[0], 401)
        self.assertEqual(self.sql("SELECT valeur FROM parametres_prix WHERE cle = 'frais_port_tnd'"), [{"valeur": "600"}])

    def test_modification_et_journal(self):
        statut, data, _ = self.requete("/api/admin/prix/parametres/frais_port_tnd", {"valeur": 650}, "PUT", self.cookie)
        self.assertEqual(statut, 200, data)
        self.assertEqual(next(p for p in data["parametres"] if p["cle"] == "frais_port_tnd")["valeur"], "650")
        self.assertIn(("admin", "ok"), [(l["acteur"], l["resultat"]) for l in self.journal("PUT /api/admin/prix/parametres/frais_port_tnd")])
        self.requete("/api/admin/prix/parametres/frais_port_tnd", {"valeur": 600}, "PUT", self.cookie)

        ligne = self.sql("SELECT * FROM grille_droits WHERE regime = 'resident_droit_commun' AND carburant = 'diesel' AND cylindree_min = 0")[0]
        corps = {k: ligne[k] for k in ("cylindree_min", "cylindree_max", "droits_douane_pct", "droit_consommation_pct", "tva_pct",
                                       "reduction_immatriculation_pct", "part_payee_pct", "note")}
        statut, data, _ = self.requete(f"/api/admin/prix/grille/{ligne['id']}", {**corps, "droit_consommation_pct": 31}, "PUT", self.cookie)
        self.assertEqual(statut, 200, data)
        self.assertEqual(next(l for l in data["grille"] if l["id"] == ligne["id"])["droit_consommation_pct"], 31)

        statut, data, _ = self.requete("/api/admin/prix/regimes/resident_hev_lf2026", {"actif": False}, "PUT", self.cookie)
        self.assertEqual(statut, 200, data)
        self.assertFalse(next(r for r in data["regimes"] if r["code"] == "resident_hev_lf2026")["actif"])
        self.requete("/api/admin/prix/regimes/resident_hev_lf2026", {"actif": True}, "PUT", self.cookie)

        regles = {"age_max_ans": 4, "cylindree_max_cc": None, "carburants_admis": ["essence", "diesel"], "note": "Test À VÉRIFIER"}
        statut, data, _ = self.requete("/api/admin/prix/eligibilite/resident", regles, "PUT", self.cookie)
        self.assertEqual(statut, 200, data)
        self.assertEqual(data["eligibilite"]["resident"], regles)
        initiales = {"age_max_ans": 3, "cylindree_max_cc": 2500, "carburants_admis": ["essence", "diesel", "hybride", "hybride_rechargeable", "electrique"],
                     "note": "Exemple À REMPLACER par le transitaire."}
        self.assertEqual(self.requete("/api/admin/prix/eligibilite/resident", initiales, "PUT", self.cookie)[0], 200)

    def test_validation(self):
        cas = [
            ("/api/admin/prix/parametres/commission_pct", {"valeur": 150}, 400),
            ("/api/admin/prix/parametres/commission_pct", {"valeur": "5"}, 400),
            ("/api/admin/prix/parametres/taux_auto", {"valeur": 3.4}, 404),
            ("/api/admin/prix/parametres/inconnu", {"valeur": 1}, 404),
            ("/api/admin/prix/taux-manuel", {"valeur": 33.8, "actif": True}, 400),
            ("/api/admin/prix/taux-manuel", {"valeur": None, "actif": True}, 400),
            ("/api/admin/prix/regimes/resident_droit_commun", {"statut_verification": "officiel"}, 400),
            ("/api/admin/prix/regimes/inconnu", {"actif": True}, 404),
            ("/api/admin/prix/eligibilite/fcr", {"age_max_ans": 5, "cylindree_max_cc": None, "carburants_admis": ["gpl"], "note": "x"}, 400),
            ("/api/admin/prix/grille/1", {"cylindree_min": 0, "cylindree_max": None, "droits_douane_pct": -1, "droit_consommation_pct": 0,
                                          "tva_pct": 19, "reduction_immatriculation_pct": 0, "part_payee_pct": 100, "note": "x"}, 400),
            ("/api/admin/prix/grille/1", {"cylindree_min": 0, "cylindree_max": None, "droits_douane_pct": 1, "droit_consommation_pct": 0,
                                          "tva_pct": 19, "reduction_immatriculation_pct": 0, "part_payee_pct": 100, "note": " "}, 400),
            ("/api/admin/prix/grille/99999", {"cylindree_min": 0, "cylindree_max": None, "droits_douane_pct": 1, "droit_consommation_pct": 0,
                                              "tva_pct": 19, "reduction_immatriculation_pct": 0, "part_payee_pct": 100, "note": "x"}, 404),
        ]
        for chemin, corps, attendu in cas:
            with self.subTest(chemin=chemin, corps=corps):
                self.assertEqual(self.requete(chemin, corps, "PUT", self.cookie)[0], attendu)
        self.assertEqual(self.requete("/api/admin/prix/simulation", {"prixEur": -5, "fuel": "Essence"}, "POST", self.cookie)[0], 400)
        self.assertIn(("admin", "refuse"), [(l["acteur"], l["resultat"]) for l in self.journal("PUT /api/admin/prix/parametres/commission_pct")])
        self.assertEqual(self.sql("SELECT valeur FROM parametres_prix WHERE cle = 'commission_pct'"), [{"valeur": "5"}])

    def test_simulation(self):
        vehicule = {"prixEur": 10000, "year": 2025, "engineCc": 1400, "fuel": "Essence"}
        self.taux_manuel(None, False)
        self.sql("UPDATE parametres_prix SET valeur = '' WHERE cle = 'taux_auto'")
        statut, data, _ = self.requete("/api/admin/prix/simulation", vehicule, "POST", self.cookie)
        self.assertEqual(statut, 200, data)
        self.assertIsNone(data["prixResidentTnd"])
        self.assertIn("Aucun taux", data["motifNonEligibleResident"])
        self.taux_manuel(3.4, True)
        statut, data, _ = self.requete("/api/admin/prix/simulation", vehicule, "POST", self.cookie)
        # Valeurs de la migration : marge 2 % → 3,468 ; CAF (10 000 + 1 200) × 1,01 × 3,468 = 39 230,4 → 39 230
        # DD 20 % → 7 846 ; DC 47 076 × 38 % → 17 889 ; TVA 64 965 × 19 % → 12 343 ; redevance 38 078 × 3 % → 1 142 ;
        # transitaire 1 000 ; port 600 ; immatriculation 700 ; commission 10 000 × 5 % × 3,468 + 1 000 = 2 734 → 83 484
        self.assertEqual(data["prixResidentTnd"], 83484, data)
        self.assertEqual(data["regimeResident"], "resident_droit_commun")
        self.assertTrue(data["taux"]["manuel"])
        self.assertTrue(any("À VÉRIFIER par le transitaire" in a for a in data["avertissements"]))
        self.taux_manuel(None, False)

    def test_page_admin_prix(self):
        with urllib.request.urlopen(self.base + "/admin-prix") as reponse:
            page = reponse.read().decode()
            self.assertEqual(reponse.status, 200)
            self.assertIn("noindex", reponse.headers["X-Robots-Tag"])
            self.assertIn("no-store", reponse.headers["Cache-Control"])
        self.assertIn("Valeurs à vérifier par le transitaire", page)
        self.assertIn('src="/admin-prix.js"', page)
        self.assertEqual(page.count("<script"), 1)  # un seul script, externe : aucune ressource hors 'self'
        self.assertNotIn("https://cdn", page)
        with urllib.request.urlopen(self.base + "/admin") as reponse:
            self.assertIn('href="/admin-prix"', reponse.read().decode())

    def test_taux_quotidien(self):
        urllib.request.urlopen(self.base + "/__scheduled?cron=0+6+*+*+*").read()
        for _ in range(20):
            lignes = self.journal("prix.taux_auto")
            if lignes:
                break
            time.sleep(0.5)
        self.assertEqual([(l["acteur"], l["resultat"]) for l in lignes], [("systeme", "ok")])
        self.assertEqual(json.loads(lignes[0]["details"]), {"source": "BCT", "valeur": "3.3834", "echecs": []})
        valeurs = {r["cle"]: r["valeur"] for r in self.sql("SELECT cle, valeur FROM parametres_prix WHERE cle LIKE 'taux_auto%'")}
        self.assertEqual((valeurs["taux_auto"], valeurs["taux_auto_source"]), ("3.3834", "BCT"))
        self.assertTrue(valeurs["taux_auto_date"])


if __name__ == "__main__":
    unittest.main()
