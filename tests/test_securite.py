"""Tests de sécurité : enchères refusées, limites d'essais par IP, en-têtes de sécurité.

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_securite
Les tests du Worker sont ignorés si la variable WRANGLER n'est pas définie ; la cohérence de _headers est toujours vérifiée.
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
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

try:
    from test_administration import config_de_test, port_libre
except ImportError:
    from tests.test_administration import config_de_test, port_libre

PROJET = Path(__file__).resolve().parent.parent
WRANGLER = os.environ.get("WRANGLER")
MOT_DE_PASSE = "motdepasse-solide"
CGV_VERSION = "2026-11-01"


def dans(**delta):
    return (datetime.now(timezone.utc) + timedelta(**delta)).isoformat()


def entetes_worker():
    """ENTETES_SECURITE de worker/index.js."""
    source = (PROJET / "worker" / "index.js").read_text()
    bloc = re.search(r"export const ENTETES_SECURITE = \{(.*?)\n\};", source, re.S).group(1)
    entetes = {}
    for cle, valeurs in re.findall(r'"([A-Za-z-]+)": ((?:"[^"]*"(?:\s*\+\s*)?)+)', bloc):
        entetes[cle] = "".join(re.findall(r'"([^"]*)"', valeurs))
    return entetes


def entetes_fichier():
    """En-têtes de la règle /* de my-auto-export/_headers."""
    lignes = (PROJET / "my-auto-export" / "_headers").read_text().splitlines()
    return dict(ligne.strip().split(": ", 1) for ligne in lignes if ligne.startswith("  "))


class EntetesStatiquesTest(unittest.TestCase):
    def test_headers_identique_au_worker(self):
        self.assertEqual(entetes_fichier(), entetes_worker())
        self.assertIn("frame-ancestors 'none'", entetes_worker()["Content-Security-Policy"])


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class SecuriteTest(unittest.TestCase):
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
        for email in ("admin@ex.com", "alice@ex.com", "bob@ex.com"):
            corps = {"name": email.split("@")[0].title() + " Test", "email": email, "password": MOT_DE_PASSE}
            assert cls.requete("/api/register", corps, "POST", ip="10.0.0.1")[0] == 201
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'")
        cls.sql("UPDATE users SET deposit_tnd = 1000000 WHERE email IN ('alice@ex.com', 'bob@ex.com')")
        cls.cookies = {email: cls.connexion(email) for email in ("admin@ex.com", "alice@ex.com", "bob@ex.com")}
        for email in ("alice@ex.com", "bob@ex.com"):
            assert cls.requete("/api/terms", {"version": CGV_VERSION}, "POST", cls.cookies[email])[0] == 200

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
    def requete(cls, chemin, data=None, method=None, cookie=None, ip="10.0.0.1"):
        headers = {"Origin": cls.base, "CF-Connecting-IP": ip}
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

    @classmethod
    def connexion(cls, email, ip="10.0.0.1"):
        return cls.requete("/api/login", {"email": email, "password": MOT_DE_PASSE}, "POST", ip=ip)[2]["Set-Cookie"].split(";")[0]

    def encherir(self, nom, reference, montant):
        return self.requete("/api/offers", {"reference": reference, "amount": montant}, "POST", self.cookies[f"{nom}@ex.com"])

    def offres(self, reference):
        return {o["email"]: o for o in self.requete(f"/api/admin/offers?reference={reference}", cookie=self.cookies["admin@ex.com"])[1]["offers"]}

    def decider(self, offre_id, action):
        return self.requete(f"/api/admin/offers/{offre_id}/{action}", {}, "POST", self.cookies["admin@ex.com"])

    def test_enchere_refusee_ne_bloque_pas_la_vente(self):
        corps = {"make": "BMW", "model": "X5", "status": "open", "endsAt": dans(seconds=5), "startingPriceTnd": 100000}
        self.assertEqual(self.requete("/api/admin/vehicles/SEC-1", corps, "PUT", self.cookies["admin@ex.com"])[0], 200)
        self.assertEqual(self.encherir("alice", "SEC-1", 100000)[0], 201)
        self.assertEqual(self.encherir("bob", "SEC-1", 10_000_000)[0], 201)  # enchère fantaisiste
        self.assertEqual(self.decider(self.offres("SEC-1")["bob@ex.com"]["id"], "refuse")[0], 200)

        detail = self.requete("/api/auctions/SEC-1")[1]
        self.assertEqual((detail["auction"]["currentBidTnd"], detail["auction"]["minNextBidTnd"]), (100000, 101000))
        self.assertEqual([bid["amountTnd"] for bid in detail["bids"]], [100000], "l'enchère refusée sort de l'historique public")
        self.assertTrue(self.offres("SEC-1")["alice@ex.com"]["best"])
        self.assertEqual(self.encherir("bob", "SEC-1", 101000)[0], 201, "la vente continue au prix réel")

        self.sql("UPDATE offers SET created_at = '2000-01-01T00:00:00.000Z' WHERE reference = 'SEC-1'")
        time.sleep(5)
        offres = self.offres("SEC-1")
        gagnante = max((o for o in offres.values() if o["status"] == "pending"), key=lambda o: o["amountTnd"])
        self.assertEqual(self.decider(gagnante["id"], "accept")[0], 200)

    def test_faux_mots_de_passe_ne_bloquent_pas_le_titulaire(self):
        for _ in range(5):
            self.assertEqual(self.requete("/api/login", {"email": "alice@ex.com", "password": "mauvais"}, "POST", ip="10.0.1.1")[0], 401)
        self.assertEqual(self.requete("/api/login", {"email": "alice@ex.com", "password": MOT_DE_PASSE}, "POST", ip="10.0.1.1")[0], 429)
        self.assertEqual(self.requete("/api/login", {"email": "alice@ex.com", "password": MOT_DE_PASSE}, "POST", ip="10.0.1.2")[0], 200)

    def test_limite_par_ip_toutes_adresses_confondues(self):
        for i in range(30):
            self.requete("/api/login", {"email": f"inconnu{i}@ex.com", "password": "mauvais"}, "POST", ip="10.0.2.1")
        self.assertEqual(self.requete("/api/login", {"email": "bob@ex.com", "password": MOT_DE_PASSE}, "POST", ip="10.0.2.1")[0], 429)
        self.assertEqual(self.requete("/api/login", {"email": "bob@ex.com", "password": MOT_DE_PASSE}, "POST", ip="10.0.2.2")[0], 200)

    def test_inscriptions_limitees_par_ip(self):
        for i in range(10):
            corps = {"name": "Masse Test", "email": f"masse{i}@ex.com", "password": MOT_DE_PASSE}
            self.assertEqual(self.requete("/api/register", corps, "POST", ip="10.0.3.1")[0], 201)
        corps = {"name": "Masse Test", "email": "masse10@ex.com", "password": MOT_DE_PASSE}
        self.assertEqual(self.requete("/api/register", corps, "POST", ip="10.0.3.1")[0], 429)
        self.assertEqual(self.requete("/api/register", corps, "POST", ip="10.0.3.2")[0], 201)

    def test_refus_d_une_enchere_de_derniere_minute_garde_la_prolongation(self):
        # Sinon refuser l'enchère fantaisiste d'un complice fermerait la vente au prix « gelé » juste avant.
        corps = {"make": "Audi", "model": "Q5", "status": "open", "endsAt": dans(seconds=30), "startingPriceTnd": 100000}
        self.assertEqual(self.requete("/api/admin/vehicles/SEC-2", corps, "PUT", self.cookies["admin@ex.com"])[0], 200)
        self.assertEqual(self.encherir("alice", "SEC-2", 100000)[0], 201)
        self.assertEqual(self.encherir("bob", "SEC-2", 10_000_000)[0], 201)
        avant = self.requete("/api/auctions/SEC-2")[1]["auction"]
        self.assertTrue(avant["extended"])
        self.assertEqual(self.decider(self.offres("SEC-2")["bob@ex.com"]["id"], "refuse")[0], 200, "refus possible pendant la vente")
        apres = self.requete("/api/auctions/SEC-2")[1]["auction"]
        self.assertEqual((apres["status"], apres["endsAt"], apres["minNextBidTnd"]), ("live", avant["endsAt"], 101000))

    def test_rotation_d_adresses_ipv6_dans_un_meme_bloc(self):
        for i in range(5):
            self.requete("/api/login", {"email": "alice@ex.com", "password": "mauvais"}, "POST", ip=f"2001:db8:1:1::{i + 1:x}")
        connexion = {"email": "alice@ex.com", "password": MOT_DE_PASSE}
        self.assertEqual(self.requete("/api/login", connexion, "POST", ip="2001:0db8:0001:0001:ffff::9")[0], 429, "même /64")
        self.assertEqual(self.requete("/api/login", connexion, "POST", ip="2001:db8:1:2::1")[0], 200, "autre /64")

    def test_attaque_repartie_ne_bloque_pas_une_adresse_connue(self):
        # 100 échecs répartis sur 20 adresses : la limite du compte s'applique, sauf d'où le titulaire s'est déjà connecté.
        self.assertEqual(self.requete("/api/login", {"email": "bob@ex.com", "password": MOT_DE_PASSE}, "POST", ip="10.0.4.1")[0], 200)
        for i in range(100):
            self.requete("/api/login", {"email": "bob@ex.com", "password": "mauvais"}, "POST", ip=f"10.0.5.{i // 5}")
        connexion = {"email": "bob@ex.com", "password": MOT_DE_PASSE}
        self.assertEqual(self.requete("/api/login", connexion, "POST", ip="10.0.6.1")[0], 429)
        self.assertEqual(self.requete("/api/login", connexion, "POST", ip="10.0.4.1")[0], 200)

    def test_inscriptions_simultanees_limitees(self):
        from concurrent.futures import ThreadPoolExecutor
        corps = lambda i: {"name": "Rafale Test", "email": f"rafale{i}@ex.com", "password": MOT_DE_PASSE}
        with ThreadPoolExecutor(40) as pool:
            statuts = list(pool.map(lambda i: self.requete("/api/register", corps(i), "POST", ip="10.0.7.1")[0], range(40)))
        self.assertEqual(statuts.count(201), 10, statuts)

    def test_essais_d_adresses_existantes_comptes(self):
        corps = {"name": "Alice Test", "email": "alice@ex.com", "password": MOT_DE_PASSE}
        statuts = [self.requete("/api/register", corps, "POST", ip="10.0.8.1")[0] for _ in range(11)]
        self.assertEqual(statuts, [409] * 10 + [429])

    def test_enregistrement_oauth_limite_par_ip(self):
        def enregistrer(ip):
            requete = urllib.request.Request(self.base + "/oauth/register", method="POST", headers={"Content-Type": "application/json", "CF-Connecting-IP": ip},
                                             data=json.dumps({"client_name": "Test", "redirect_uris": ["http://localhost:3000/cb"]}).encode())
            try:
                with urllib.request.urlopen(requete) as reponse:
                    return reponse.status
            except urllib.error.HTTPError as erreur:
                with erreur:
                    return erreur.code
        self.assertEqual([enregistrer("10.0.9.1") for _ in range(6)], [201] * 5 + [429])
        self.assertEqual(enregistrer("10.0.9.2"), 201, "une autre adresse n'est pas bloquée")

    def entetes(self, chemin):
        """En-têtes de la réponse, même en cas d'erreur HTTP."""
        try:
            with urllib.request.urlopen(self.base + chemin) as reponse:
                return reponse.headers
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.headers

    def test_entetes_de_securite(self):
        # Fichiers servis directement (_headers) et réponses du Worker (API, photos, erreurs).
        for chemin in ("/", "/admin.html", "/lots.json", "/api/catalogue", "/api/me", "/media/vehicules/X/absente.jpg"):
            entetes = self.entetes(chemin)
            for cle, valeur in entetes_worker().items():
                self.assertEqual(entetes.get(cle), valeur, f"{chemin} : {cle}")
        self.assertEqual(self.requete("/_headers")[0], 404, "le fichier de configuration n'est pas servi")

    def test_pages_sans_violation_de_la_csp(self):
        # Les autres tests navigateur ouvrent les pages avec bypass_csp=True, car Playwright (wait_for_function) évalue
        # du code ; celui-ci garde la CSP et échoue au moindre script, style ou image refusé.
        with sync_playwright() as playwright:
            navigateur = playwright.chromium.launch()
            try:
                page = navigateur.new_page()
                refus = []
                page.on("console", lambda message: refus.append(message.text) if "Content Security Policy" in message.text else None)
                page.goto(self.base + "/")
                page.locator(".lot-card .detail-link").first.click()
                page.wait_for_selector("#lot-dialog-body .dialog-head")
                page.goto(self.base + "/admin.html")
                page.fill("#login-email", "admin@ex.com")
                page.fill("#login-password", MOT_DE_PASSE)
                page.click("#login-form [type=submit]")
                page.wait_for_selector("#vehicle-list", state="attached")
                page.wait_for_timeout(1000)
                page.goto(self.base + "/conditions.html")
                page.wait_for_timeout(500)
                self.assertEqual(refus, [])
            finally:
                navigateur.close()

    def test_page_d_autorisation_mcp_garde_sa_politique(self):
        # Sa CSP n'a pas de form-action : elle doit pouvoir rediriger vers Claude après l'envoi du formulaire.
        entetes = self.entetes("/oauth/authorize?client_id=inconnu")
        self.assertNotIn("form-action", entetes["Content-Security-Policy"])
        self.assertEqual(entetes["X-Frame-Options"], "DENY")


if __name__ == "__main__":
    unittest.main()
