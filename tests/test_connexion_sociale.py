"""Tests de la connexion avec Apple et Facebook (worker/connexion-sociale.js), contre de faux fournisseurs locaux :
aucun appel réel. Google est couvert par test_google.py ; les contrôles d'identité et la signature du secret Apple
par tests/connexion-sociale.test.js.

Apple : retour par formulaire POST venu d'appleid.apple.com (cookie d'état SameSite=None), nom transmis à la première
autorisation, liaison d'un compte existant par e-mail vérifié. Facebook : appsecret_proof, e-mail déjà inscrit non
relié automatiquement. Les deux : état lié au navigateur et à usage unique, annulation, boutons affichés sur les pages.

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_connexion_sociale
Ignorés si la variable WRANGLER n'est pas définie.
"""
import base64
import hashlib
import hmac
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
APPLE_CLIENT_ID = "com.myautoexport.web"
FACEBOOK_APP_ID = "123456789"
FACEBOOK_SECRET = "secret-facebook-de-test"
MOT_DE_PASSE = "motdepasse-solide"


def b64(donnees):
    return base64.urlsafe_b64encode(json.dumps(donnees).encode()).rstrip(b"=").decode()


class FauxFournisseurs(http.server.BaseHTTPRequestHandler):
    """Apple : POST /apple/token. Facebook : GET /facebook/token puis GET /facebook/me. Le code désigne l'identité
    préparée par le test."""
    apple = {}
    facebook = {}
    requetes = []

    def repondre(self, statut, corps=None):
        self.send_response(statut)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if corps is not None:
            self.wfile.write(json.dumps(corps).encode())

    def do_POST(self):
        corps = {k: v[0] for k, v in urllib.parse.parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode()).items()}
        FauxFournisseurs.requetes.append(("apple", corps))
        identite = FauxFournisseurs.apple.get(corps.get("code"))
        if self.path != "/apple/token" or identite is None:
            return self.repondre(400)
        self.repondre(200, {"id_token": f"{b64({'alg': 'RS256'})}.{b64(identite)}.signature", "access_token": "x"})

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        params = dict(urllib.parse.parse_qsl(url.query))
        FauxFournisseurs.requetes.append((url.path, params))
        if url.path == "/facebook/token":
            if params.get("client_secret") != FACEBOOK_SECRET or params.get("code") not in FauxFournisseurs.facebook:
                return self.repondre(400)
            return self.repondre(200, {"access_token": "jeton-" + params["code"], "token_type": "bearer"})
        if url.path == "/facebook/me":
            jeton = params.get("access_token", "")
            preuve = hmac.new(FACEBOOK_SECRET.encode(), jeton.encode(), hashlib.sha256).hexdigest()
            identite = FauxFournisseurs.facebook.get(jeton.removeprefix("jeton-"))
            if params.get("appsecret_proof") != preuve or identite is None or params.get("fields") != "id,name,email":
                return self.repondre(400)
            return self.repondre(200, identite)
        self.repondre(404)

    def log_message(self, *args):
        pass


class SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OUVREUR = urllib.request.build_opener(SansRedirection)


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class ConnexionSocialeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.faux = http.server.HTTPServer(("127.0.0.1", 0), FauxFournisseurs)
        threading.Thread(target=cls.faux.serve_forever, daemon=True).start()
        faux = f"http://127.0.0.1:{cls.faux.server_port}"
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        cle = subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256"],
                             check=True, capture_output=True, text=True).stdout
        config = json.loads(Path(cls.config).read_text())
        config["vars"].update({
            "APPLE_CLIENT_ID": APPLE_CLIENT_ID, "APPLE_TEAM_ID": "TEAM123456", "APPLE_KEY_ID": "KEY1234567", "APPLE_PRIVATE_KEY": cle,
            "APPLE_URL_AUTH": "https://apple.example.test/auth", "APPLE_URL_TOKEN": f"{faux}/apple/token",
            "FACEBOOK_APP_ID": FACEBOOK_APP_ID, "FACEBOOK_APP_SECRET": FACEBOOK_SECRET,
            "FACEBOOK_URL_AUTH": "https://facebook.example.test/dialog/oauth",
            "FACEBOOK_URL_TOKEN": f"{faux}/facebook/token", "FACEBOOK_URL_PROFIL": f"{faux}/facebook/me"
        })
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

    @classmethod
    def tearDownClass(cls):
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.faux.shutdown()
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, commande):
        sortie = subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--json",
                                 "--command", commande], cwd=PROJET, check=True, capture_output=True, text=True).stdout
        return json.loads(sortie)[0]["results"]

    def envoyer(self, chemin, cookie=None, formulaire=None, origine=None):
        """(statut, en-têtes) sans suivre les redirections ; formulaire : POST application/x-www-form-urlencoded."""
        headers = {}
        if cookie:
            headers["Cookie"] = cookie
        if origine:
            headers["Origin"] = origine
        donnees = None
        if formulaire is not None:
            donnees = urllib.parse.urlencode(formulaire).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        try:
            with OUVREUR.open(urllib.request.Request(self.base + chemin, data=donnees, headers=headers)) as reponse:
                return reponse.status, reponse.headers
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, erreur.headers

    def api(self, chemin, data=None, method=None, cookie=None):
        headers = {"Origin": self.base, "CF-Connecting-IP": "10.0.0.9"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        requete = urllib.request.Request(self.base + chemin, data=None if data is None else json.dumps(data).encode(), method=method, headers=headers)
        try:
            with urllib.request.urlopen(requete) as reponse:
                return reponse.status, json.loads(reponse.read() or b"null")
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, json.loads(erreur.read() or b"null")

    @staticmethod
    def cookies(entetes):
        return {c.split("=", 1)[0]: c.split(";")[0].split("=", 1)[1] for c in entetes.get_all("Set-Cookie") or []}

    @staticmethod
    def entete_cookie(entetes, nom):
        return next(c for c in entetes.get_all("Set-Cookie") or [] if c.startswith(nom + "="))

    def demarrer(self, fournisseur, retour="/vendre"):
        """Début de connexion : (paramètres envoyés au fournisseur, cookie d'état, en-tête Set-Cookie)."""
        statut, entetes = self.envoyer(f"/api/auth/{fournisseur}?retour={urllib.parse.quote(retour)}")
        self.assertEqual(statut, 303)
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(entetes["Location"]).query))
        self.assertEqual(params["redirect_uri"], f"{self.base}/api/auth/{fournisseur}/retour")
        nom = f"{fournisseur}_etat"
        return params, f"{nom}={self.cookies(entetes)[nom]}", self.entete_cookie(entetes, nom)

    # --- Apple ---

    def identite_apple(self, code, **champs):
        FauxFournisseurs.apple[code] = {"iss": "https://appleid.apple.com", "aud": APPLE_CLIENT_ID, "exp": int(time.time()) + 600,
                                        "sub": "001234.abcdef0123456789.0123", "email": "nouveau@privaterelay.appleid.com",
                                        "email_verified": "true", **champs}

    def retour_apple(self, etat, cookie, **champs):
        return self.envoyer("/api/auth/apple/retour", cookie, {"state": etat, **champs}, origine="https://appleid.apple.com")

    def test_apple_creation_puis_reconnexion(self):
        self.identite_apple("apple-creation", sub="000111.aaa.0001", email="Sami@PrivateRelay.AppleId.com")
        params, cookie, entete = self.demarrer("apple", "/vendre")
        self.assertEqual((params["client_id"], params["response_type"], params["scope"], params["response_mode"]),
                         (APPLE_CLIENT_ID, "code", "name email", "form_post"))
        self.assertIn("SameSite=None", entete, "le cookie d'état doit suivre le formulaire POST d'Apple")
        self.assertIn("Secure", entete)
        statut, entetes = self.retour_apple(params["state"], cookie, code="apple-creation",
                                            user=json.dumps({"name": {"firstName": "Sami", "lastName": "Ben Ali"}, "email": "x"}))
        self.assertEqual((statut, entetes["Location"]), (303, "/vendre"))
        session = self.cookies(entetes)["my_session"]
        corps = next(c for f, c in reversed(FauxFournisseurs.requetes) if f == "apple")
        self.assertEqual((corps["client_id"], corps["grant_type"], corps["code"]), (APPLE_CLIENT_ID, "authorization_code", "apple-creation"))
        self.assertEqual(corps["client_secret"].count("."), 2, "secret client : JWT signé")
        _, data = self.api("/api/me", cookie=f"my_session={session}")
        self.assertEqual((data["user"]["email"], data["user"]["name"]), ("sami@privaterelay.appleid.com", "Sami Ben Ali"))
        # Connexions suivantes : Apple n'envoie plus le nom ; le compte est retrouvé par son identifiant.
        self.identite_apple("apple-retour", sub="000111.aaa.0001", email="sami@privaterelay.appleid.com")
        params, cookie, _ = self.demarrer("apple", "/")
        statut, entetes = self.retour_apple(params["state"], cookie, code="apple-retour")
        self.assertIn("my_session", self.cookies(entetes))
        self.assertEqual(len(self.sql("SELECT id FROM users WHERE apple_id = '000111.aaa.0001'")), 1)
        self.assertTrue(self.sql("SELECT id FROM audit_logs WHERE action = 'auth.apple' AND details LIKE '%creation%'"))

    def test_apple_liaison_et_refus(self):
        self.assertEqual(self.api("/api/register", {"name": "Client Apple", "email": "existant@icloud.com", "password": MOT_DE_PASSE}, "POST")[0], 201)
        self.identite_apple("apple-liaison", sub="000222.bbb.0002", email="existant@icloud.com")
        params, cookie, _ = self.demarrer("apple", "/mes-mandats")
        statut, entetes = self.retour_apple(params["state"], cookie, code="apple-liaison")
        self.assertEqual((statut, entetes["Location"]), (303, "/mes-mandats"))
        self.assertEqual(self.sql("SELECT apple_id FROM users WHERE email = 'existant@icloud.com'")[0]["apple_id"], "000222.bbb.0002")
        self.assertEqual(self.api("/api/login", {"email": "existant@icloud.com", "password": MOT_DE_PASSE}, "POST")[0], 200, "mot de passe toujours valable")
        for code, champs in {"apple-non-verifie": {"email_verified": "false", "email": "nv@icloud.com", "sub": "000333.c.3"},
                             "apple-autre-appli": {"aud": "com.autre.app", "email": "aa@icloud.com", "sub": "000444.d.4"},
                             "apple-emetteur": {"iss": "https://accounts.google.com", "email": "em@icloud.com", "sub": "000555.e.5"}}.items():
            self.identite_apple(code, **champs)
            params, cookie, _ = self.demarrer("apple", "/vendre")
            statut, entetes = self.retour_apple(params["state"], cookie, code=code)
            self.assertEqual(entetes["Location"], "/vendre?connexion=refusee", code)
            self.assertNotIn("my_session", self.cookies(entetes), code)
        # Annulation chez Apple : renvoyée aussi par formulaire POST.
        params, cookie, _ = self.demarrer("apple", "/vendre")
        self.assertEqual(self.retour_apple(params["state"], cookie, error="user_cancelled_authorize")[1]["Location"], "/vendre?connexion=annulee")

    def test_apple_etat_lie_au_navigateur_et_a_usage_unique(self):
        self.identite_apple("apple-etat", sub="000666.f.6", email="etat@icloud.com")
        params, cookie, _ = self.demarrer("apple", "/vendre")
        self.assertEqual(self.retour_apple(params["state"], None, code="apple-etat")[1]["Location"], "/?connexion=refusee")
        self.assertEqual(self.retour_apple("falsifie", cookie, code="apple-etat")[1]["Location"], "/?connexion=refusee")
        # Un état Facebook ne sert pas pour Apple.
        params_fb, cookie_fb, _ = self.demarrer("facebook", "/vendre")
        self.assertEqual(self.retour_apple(params_fb["state"], cookie_fb.replace("facebook_etat", "apple_etat"), code="apple-etat")[1]["Location"],
                         "/?connexion=refusee")
        statut, entetes = self.retour_apple(params["state"], cookie, code="apple-etat")
        self.assertIn("my_session", self.cookies(entetes))
        self.assertEqual(self.retour_apple(params["state"], cookie, code="apple-etat")[1]["Location"], "/?connexion=refusee", "rejeu")

    # --- Facebook ---

    def identite_facebook(self, code, **champs):
        FauxFournisseurs.facebook[code] = {"id": "10001", "name": "Fatma Client", "email": "fatma@example.com", **champs}

    def retour_facebook(self, etat, cookie, **champs):
        return self.envoyer("/api/auth/facebook/retour?" + urllib.parse.urlencode({"state": etat, **champs}), cookie)

    def test_facebook_creation_puis_reconnexion(self):
        self.identite_facebook("fb-creation", id="20001", email="Fatma@Example.com")
        params, cookie, entete = self.demarrer("facebook", "/vendre")
        self.assertEqual((params["client_id"], params["response_type"], params["scope"]), (FACEBOOK_APP_ID, "code", "email,public_profile"))
        self.assertIn("SameSite=Lax", entete)
        statut, entetes = self.retour_facebook(params["state"], cookie, code="fb-creation")
        self.assertEqual((statut, entetes["Location"]), (303, "/vendre"))
        _, data = self.api("/api/me", cookie=f"my_session={self.cookies(entetes)['my_session']}")
        self.assertEqual((data["user"]["email"], data["user"]["name"]), ("fatma@example.com", "Fatma Client"))
        self.assertEqual(self.api("/api/login", {"email": "fatma@example.com", "password": "un-mot-de-passe-au-hasard"}, "POST")[0], 401)
        self.identite_facebook("fb-retour", id="20001", email="autre@example.com")
        params, cookie, _ = self.demarrer("facebook", "/")
        statut, entetes = self.retour_facebook(params["state"], cookie, code="fb-retour")
        _, data = self.api("/api/me", cookie=f"my_session={self.cookies(entetes)['my_session']}")
        self.assertEqual(data["user"]["email"], "fatma@example.com", "compte retrouvé par l'identifiant Facebook")

    def test_facebook_email_existant_non_relie(self):
        self.assertEqual(self.api("/api/register", {"name": "Client FB", "email": "deja@example.com", "password": MOT_DE_PASSE}, "POST")[0], 201)
        self.identite_facebook("fb-existant", id="30001", email="deja@example.com")
        params, cookie, _ = self.demarrer("facebook", "/vendre")
        statut, entetes = self.retour_facebook(params["state"], cookie, code="fb-existant")
        self.assertEqual((statut, entetes["Location"]), (303, "/vendre?connexion=existant"))
        self.assertNotIn("my_session", self.cookies(entetes))
        self.assertIsNone(self.sql("SELECT facebook_id FROM users WHERE email = 'deja@example.com'")[0]["facebook_id"])
        # Sans e-mail (compte Facebook ouvert avec un téléphone) : refus.
        self.identite_facebook("fb-sans-email", id="30002", email=None)
        params, cookie, _ = self.demarrer("facebook", "/vendre")
        self.assertEqual(self.retour_facebook(params["state"], cookie, code="fb-sans-email")[1]["Location"], "/vendre?connexion=refusee")
        # Annulation et code refusé.
        params, cookie, _ = self.demarrer("facebook", "/vendre")
        self.assertEqual(self.retour_facebook(params["state"], cookie, error="access_denied")[1]["Location"], "/vendre?connexion=annulee")
        params, cookie, _ = self.demarrer("facebook", "/vendre")
        self.assertEqual(self.retour_facebook(params["state"], cookie, code="inconnu")[1]["Location"], "/vendre?connexion=refusee")

    # --- Pages ---

    def test_fournisseurs_et_boutons(self):
        self.assertEqual(self.api("/api/auth/fournisseurs")[1], {"google": False, "apple": True, "facebook": True})
        statut, entetes = self.envoyer("/api/auth/google?retour=/vendre")
        self.assertEqual(entetes["Location"], "/vendre?connexion=indisponible", "Google non configuré ici")
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            navigateur = p.chromium.launch()
            page = navigateur.new_page(viewport={"width": 390, "height": 844})
            page.goto(self.base + "/")
            page.wait_for_function("typeof catalogueEtat !== 'undefined' && catalogueEtat !== 'loading'")
            page.click("#compte-identifier")
            page.wait_for_selector("#auth-dialog[open] .bouton-connexion")
            boutons = page.locator("#auth-dialog .bouton-connexion")
            self.assertEqual(boutons.all_inner_texts(), ["Continuer avec Apple", "Continuer avec Facebook"])
            self.assertTrue(page.is_visible("#auth-dialog .connexion-ou"))
            page.goto(self.base + "/vendre?connexion=existant")
            self.assertIn("Un compte existe déjà", page.text_content("#message"))
            page.get_by_role("button", name="Créer un compte").first.click()
            self.assertEqual(page.locator("#auth-register .bouton-connexion:visible").count(), 2)
            self.assertEqual(page.locator("#auth-register a[data-fournisseur=apple]").get_attribute("href"), "/api/auth/apple?retour=%2Fvendre")
            navigateur.close()


if __name__ == "__main__":
    unittest.main()
