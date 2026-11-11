"""Tests de la connexion avec Google (worker/google.js), contre un faux Google local : aucun appel réel.

Couvre la création de compte, la liaison à un compte existant (le mot de passe reste valable), l'e-mail non vérifié,
un état falsifié ou rejoué, l'annulation, un jeton destiné à une autre application, la redirection limitée au site,
le PKCE et le bouton masqué sans configuration.

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_google
Ignorés si la variable WRANGLER n'est pas définie.
"""
import base64
import hashlib
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
CLIENT_ID = "client-test.apps.googleusercontent.com"
MOT_DE_PASSE = "motdepasse-solide"


def b64(donnees):
    return base64.urlsafe_b64encode(json.dumps(donnees).encode()).rstrip(b"=").decode()


class FauxGoogle(http.server.BaseHTTPRequestHandler):
    """Point de terminaison des jetons : le code désigne l'identité préparée par le test (FauxGoogle.identites)."""
    identites = {}
    requetes = []

    def do_POST(self):
        corps = urllib.parse.parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode())
        FauxGoogle.requetes.append({k: v[0] for k, v in corps.items()})
        identite = FauxGoogle.identites.get(corps["code"][0])
        if identite is None:
            self.send_response(400)
            self.end_headers()
            return
        jeton = f"{b64({'alg': 'RS256'})}.{b64(identite)}.signature"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"id_token": jeton, "access_token": "x"}).encode())

    def log_message(self, *args):
        pass


class SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OUVREUR = urllib.request.build_opener(SansRedirection)


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class GoogleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.google = http.server.HTTPServer(("127.0.0.1", 0), FauxGoogle)
        threading.Thread(target=cls.google.serve_forever, daemon=True).start()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        config = json.loads(Path(cls.config).read_text())
        config["vars"].update({
            "GOOGLE_CLIENT_ID": CLIENT_ID, "GOOGLE_CLIENT_SECRET": "secret-de-test",
            "GOOGLE_URL_AUTH": "https://accounts.example.test/auth", "GOOGLE_URL_TOKEN": f"http://127.0.0.1:{cls.google.server_port}/token"
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
        cls.google.shutdown()
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, commande):
        sortie = subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--json",
                                 "--command", commande], cwd=PROJET, check=True, capture_output=True, text=True).stdout
        return json.loads(sortie)[0]["results"]

    def get(self, chemin, cookie=None):
        """(statut, en-têtes) sans suivre les redirections."""
        headers = {"Cookie": cookie} if cookie else {}
        try:
            with OUVREUR.open(urllib.request.Request(self.base + chemin, headers=headers)) as reponse:
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
                return reponse.status, json.loads(reponse.read() or b"null"), reponse.headers
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, json.loads(erreur.read() or b"null"), erreur.headers

    @staticmethod
    def cookies(entetes):
        return {c.split("=", 1)[0]: c.split(";")[0].split("=", 1)[1] for c in entetes.get_all("Set-Cookie") or []}

    def demarrer(self, retour="/vendre"):
        """Début de connexion : (state, code_challenge, cookie d'état)."""
        statut, entetes = self.get(f"/api/auth/google?retour={urllib.parse.quote(retour)}")
        self.assertEqual(statut, 303)
        cible = urllib.parse.urlparse(entetes["Location"])
        self.assertEqual(f"{cible.scheme}://{cible.netloc}{cible.path}", "https://accounts.example.test/auth")
        params = dict(urllib.parse.parse_qsl(cible.query))
        self.assertEqual((params["client_id"], params["response_type"], params["scope"], params["code_challenge_method"]),
                         (CLIENT_ID, "code", "openid email profile", "S256"))
        self.assertEqual(params["redirect_uri"], f"{self.base}/api/auth/google/retour")
        return params["state"], params["code_challenge"], f"google_etat={self.cookies(entetes)['google_etat']}"

    def identite(self, code, **champs):
        FauxGoogle.identites[code] = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "exp": int(time.time()) + 600,
                                      "sub": "1234567890", "email": "nouveau@gmail.com", "email_verified": True, "name": "Nouveau Client", **champs}

    def retour(self, code, etat, cookie):
        return self.get(f"/api/auth/google/retour?code={code}&state={etat}", cookie)

    def test_creation_de_compte_puis_reconnexion(self):
        self.identite("code-creation", sub="111", email="Nouveau@Gmail.com")
        etat, defi, cookie = self.demarrer("/vendre")
        statut, entetes = self.retour("code-creation", etat, cookie)
        self.assertEqual((statut, entetes["Location"]), (303, "/vendre"))
        session = self.cookies(entetes)["my_session"]
        self.assertEqual(self.cookies(entetes)["google_etat"], "", "cookie d'état effacé")
        # PKCE : le vérificateur envoyé à Google correspond au défi de l'aller.
        verificateur = FauxGoogle.requetes[-1]["code_verifier"]
        self.assertEqual(base64.urlsafe_b64encode(hashlib.sha256(verificateur.encode()).digest()).rstrip(b"=").decode(), defi)
        self.assertEqual(FauxGoogle.requetes[-1]["client_secret"], "secret-de-test")
        statut, data, _ = self.api("/api/me", cookie=f"my_session={session}")
        self.assertEqual((statut, data["user"]["email"], data["user"]["name"]), (200, "nouveau@gmail.com", "Nouveau Client"))
        # Pas de mot de passe utilisable pour un compte créé avec Google.
        self.assertEqual(self.api("/api/login", {"email": "nouveau@gmail.com", "password": "un-mot-de-passe-au-hasard"}, "POST")[0], 401)
        # Le même identifiant Google retrouve le compte, même si l'e-mail Google change.
        self.identite("code-retour", sub="111", email="autre-adresse@gmail.com")
        etat, _, cookie = self.demarrer("/")
        statut, entetes = self.retour("code-retour", etat, cookie)
        self.assertEqual(statut, 303)
        self.assertEqual(self.api("/api/me", cookie=f"my_session={self.cookies(entetes)['my_session']}")[1]["user"]["email"], "nouveau@gmail.com")
        self.assertEqual(len(self.sql("SELECT id FROM users WHERE google_id = '111'")), 1)
        self.assertTrue(self.sql("SELECT id FROM audit_logs WHERE action = 'auth.google' AND resultat = 'ok' AND details LIKE '%creation%'"))

    def test_liaison_a_un_compte_existant(self):
        self.assertEqual(self.api("/api/register", {"name": "Client Existant", "email": "existant@gmail.com", "password": MOT_DE_PASSE}, "POST")[0], 201)
        self.identite("code-liaison", sub="222", email="existant@gmail.com", name="Autre Nom")
        etat, _, cookie = self.demarrer("/mes-mandats")
        statut, entetes = self.retour("code-liaison", etat, cookie)
        self.assertEqual((statut, entetes["Location"]), (303, "/mes-mandats"))
        ligne = self.sql("SELECT name, google_id FROM users WHERE email = 'existant@gmail.com'")[0]
        self.assertEqual((ligne["name"], ligne["google_id"]), ("Client Existant", "222"), "nom conservé, compte relié")
        self.assertEqual(self.api("/api/login", {"email": "existant@gmail.com", "password": MOT_DE_PASSE}, "POST")[0], 200, "mot de passe toujours valable")
        # Un second compte Google avec la même adresse ne prend pas le compte.
        self.identite("code-autre", sub="333", email="existant@gmail.com")
        etat, _, cookie = self.demarrer("/vendre")
        statut, entetes = self.retour("code-autre", etat, cookie)
        self.assertEqual((statut, entetes["Location"]), (303, "/vendre?connexion=refusee"))
        self.assertNotIn("my_session", self.cookies(entetes))

    def test_refus(self):
        cas = {
            "code-non-verifie": {"email": "nonverifie@gmail.com", "sub": "444", "email_verified": False},
            "code-autre-appli": {"email": "autreappli@gmail.com", "sub": "555", "aud": "autre-client.apps.googleusercontent.com"},
            "code-expire": {"email": "expire@gmail.com", "sub": "666", "exp": int(time.time()) - 10},
            "code-emetteur": {"email": "emetteur@gmail.com", "sub": "777", "iss": "https://faux.example"},
        }
        for code, champs in cas.items():
            self.identite(code, **champs)
            etat, _, cookie = self.demarrer("/vendre")
            statut, entetes = self.retour(code, etat, cookie)
            self.assertEqual((statut, entetes["Location"]), (303, "/vendre?connexion=refusee"), code)
            self.assertNotIn("my_session", self.cookies(entetes), code)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM users WHERE email IN ('nonverifie@gmail.com', 'autreappli@gmail.com', 'expire@gmail.com', 'emetteur@gmail.com')")[0]["n"], 0)
        # Code refusé par Google.
        etat, _, cookie = self.demarrer("/vendre")
        self.assertEqual(self.retour("code-inconnu", etat, cookie)[1]["Location"], "/vendre?connexion=refusee")

    def test_etat_lie_au_navigateur_et_a_usage_unique(self):
        self.identite("code-etat", sub="888", email="etat@gmail.com")
        etat, _, cookie = self.demarrer("/vendre")
        # Sans le cookie du navigateur qui a commencé, ou avec un autre état : refus (et l'état reste inutilisé).
        self.assertEqual(self.retour("code-etat", etat, None)[1]["Location"], "/?connexion=refusee")
        self.assertEqual(self.retour("code-etat", "falsifie", cookie)[1]["Location"], "/?connexion=refusee")
        statut, entetes = self.retour("code-etat", etat, cookie)
        self.assertIn("my_session", self.cookies(entetes))
        # Rejeu du même état : refusé.
        self.assertEqual(self.retour("code-etat", etat, cookie)[1]["Location"], "/?connexion=refusee")

    def test_annulation_et_redirection_limitee_au_site(self):
        etat, _, cookie = self.demarrer("/vendre")
        statut, entetes = self.get(f"/api/auth/google/retour?error=access_denied&state={etat}", cookie)
        self.assertEqual((statut, entetes["Location"]), (303, "/vendre?connexion=annulee"))
        for dangereux in ("//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)"):
            self.identite("code-retour-" + str(len(dangereux)), sub="999", email="retour@gmail.com")
            etat, _, cookie = self.demarrer(dangereux)
            statut, entetes = self.retour("code-retour-" + str(len(dangereux)), etat, cookie)
            self.assertEqual(entetes["Location"], "/", dangereux)

    def test_etat_public_et_pages(self):
        self.assertEqual(self.api("/api/auth/google/etat")[1], {"actif": True})
        with urllib.request.urlopen(self.base + "/vendre") as reponse:
            self.assertIn("Continuer avec Google", reponse.read().decode())


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class GoogleInactifTest(unittest.TestCase):
    """Sans GOOGLE_CLIENT_ID ni secret (configuration par défaut) : routes fermées, bouton masqué par les pages."""

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
        for _ in range(90):
            try:
                urllib.request.urlopen(cls.base + "/", timeout=2)
                break
            except OSError:
                time.sleep(1)

    @classmethod
    def tearDownClass(cls):
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    def test_routes_fermees(self):
        with urllib.request.urlopen(self.base + "/api/auth/google/etat") as reponse:
            self.assertEqual(json.loads(reponse.read()), {"actif": False})
        # Lien suivi malgré tout : retour sur la page de départ avec un message, jamais vers un autre site.
        for chemin, attendu in (("/api/auth/google?retour=/vendre", "/vendre?connexion=indisponible"),
                                ("/api/auth/google?retour=//evil.example", "/?connexion=indisponible"),
                                ("/api/auth/google/retour?code=x&state=y", "/?connexion=indisponible")):
            with self.assertRaises(urllib.error.HTTPError) as erreur:
                OUVREUR.open(self.base + chemin)
            self.assertEqual((erreur.exception.code, erreur.exception.headers["Location"]), (303, attendu), chemin)
        # Bouton présent mais masqué sur l'accueil, /vendre et le formulaire de mandat (bug : display:flex l'emportait).
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            navigateur = p.chromium.launch()
            page = navigateur.new_page(viewport={"width": 390, "height": 844})
            page.goto(self.base + "/")
            page.wait_for_function("typeof catalogueEtat !== 'undefined' && catalogueEtat !== 'loading'")
            page.click("#compte-identifier")
            page.wait_for_selector("#auth-dialog[open]")
            self.assertFalse(page.is_visible("#google-accueil"))
            page.goto(self.base + "/vendre")
            page.get_by_role("button", name="Me connecter").click()
            self.assertEqual(page.locator(".bouton-google:visible").count(), 0)
            page.goto(self.base + "/vendre?connexion=indisponible")
            self.assertIn("pas encore disponible", page.text_content("#message"))
            navigateur.close()


if __name__ == "__main__":
    unittest.main()
