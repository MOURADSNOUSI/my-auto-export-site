"""Tests de bout en bout du serveur MCP (/mcp) et de sa connexion OAuth (Worker + D1 local + navigateur).

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_mcp
Ignorés si la variable WRANGLER n'est pas définie.
"""
import base64
import hashlib
import http.server
import json
import os
import secrets
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
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
RETOUR = "http://127.0.0.1:33418/callback"
RETOUR_CLAUDE = "https://claude.ai/api/mcp/auth_callback"


class SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


SANS_REDIRECTION = urllib.request.build_opener(SansRedirection)


def pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class McpTest(unittest.TestCase):
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
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()
        for email in ("admin@ex.com", "alice@ex.com", "bob@ex.com"):
            assert cls.api("/api/register", {"name": email.split("@")[0].title() + " Test", "email": email, "password": MOT_DE_PASSE})[0] == 201
        cls.sql("UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'")
        cls.sql("UPDATE users SET deposit_tnd = 1000000 WHERE email IN ('alice@ex.com', 'bob@ex.com')")
        cls.cookies = {email: cls.api("/api/login", {"email": email, "password": MOT_DE_PASSE})[2].split(";")[0] for email in ("alice@ex.com", "bob@ex.com")}
        for cookie in cls.cookies.values():
            assert cls.api("/api/terms", {"version": CGV_VERSION}, cookie=cookie)[0] == 200
        cls.jetons = cls.connecter()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, commande):
        subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config, "--command", commande],
                       cwd=PROJET, check=True, capture_output=True)

    @classmethod
    def envoyer(cls, chemin, data=None, headers=None, method=None):
        requete = urllib.request.Request(cls.base + chemin, data=data, headers=headers or {}, method=method)
        try:
            with SANS_REDIRECTION.open(requete) as reponse:
                return reponse.status, reponse.read(), reponse.headers
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, erreur.read(), erreur.headers

    @classmethod
    def api(cls, chemin, data, cookie=None):
        headers = {"Origin": cls.base, "Content-Type": "application/json", **({"Cookie": cookie} if cookie else {})}
        statut, corps, entetes = cls.envoyer(chemin, json.dumps(data).encode(), headers, "POST")
        return statut, json.loads(corps or b"null"), entetes.get("Set-Cookie")

    @classmethod
    def formulaire(cls, chemin, champs, origine=True):
        headers = {"Content-Type": "application/x-www-form-urlencoded", **({"Origin": cls.base} if origine else {})}
        return cls.envoyer(chemin, urllib.parse.urlencode(champs).encode(), headers, "POST")

    @classmethod
    def enregistrer(cls, redirect_uris=(RETOUR,), nom="Claude"):
        statut, corps, _ = cls.envoyer("/oauth/register", json.dumps({"client_name": nom, "redirect_uris": list(redirect_uris)}).encode(),
                                       {"Content-Type": "application/json"}, "POST")
        return statut, json.loads(corps)

    @classmethod
    def autoriser(cls, client_id, challenge, email="admin@ex.com", mot_de_passe=MOT_DE_PASSE, decision="autoriser", **extra):
        champs = {"response_type": "code", "client_id": client_id, "redirect_uri": RETOUR, "code_challenge": challenge,
                  "code_challenge_method": "S256", "state": "etat-123", "resource": cls.base + "/mcp",
                  "email": email, "password": mot_de_passe, "decision": decision, **extra}
        return cls.formulaire("/oauth/authorize", champs)

    @classmethod
    def jeton(cls, champs):
        statut, corps, _ = cls.formulaire("/oauth/token", champs, origine=False)
        return statut, json.loads(corps)

    @classmethod
    def connecter(cls):
        """Parcours complet d'un client MCP : enregistrement, autorisation, échange du code."""
        client = cls.enregistrer()[1]
        verifier, challenge = pkce()
        statut, _, entetes = cls.autoriser(client["client_id"], challenge)
        assert statut == 302, statut
        retour = urllib.parse.urlparse(entetes["Location"])
        params = urllib.parse.parse_qs(retour.query)
        assert retour._replace(query="").geturl() == RETOUR and params["state"] == ["etat-123"], entetes["Location"]
        statut, jetons = cls.jeton({"grant_type": "authorization_code", "code": params["code"][0], "redirect_uri": RETOUR,
                                    "client_id": client["client_id"], "code_verifier": verifier})
        assert statut == 200, jetons
        return {**jetons, "client_id": client["client_id"]}

    def rpc(self, methode, params=None, jeton=None, identifiant=1):
        message = {"jsonrpc": "2.0", "method": methode, **({"id": identifiant} if identifiant is not None else {}), **({"params": params} if params is not None else {})}
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                   "Authorization": f"Bearer {jeton or self.jetons['access_token']}"}
        statut, corps, entetes = self.envoyer("/mcp", json.dumps(message).encode(), headers, "POST")
        return statut, json.loads(corps) if corps else None, entetes

    def outil(self, nom, **arguments):
        statut, reponse, _ = self.rpc("tools/call", {"name": nom, "arguments": arguments})
        self.assertEqual(statut, 200, reponse)
        resultat = reponse["result"]
        texte = resultat["content"][0]["text"]
        return (texte, True) if resultat.get("isError") else (json.loads(texte), False)

    def test_decouverte_oauth(self):
        statut, corps, entetes = self.rpc("initialize", jeton="0" * 64)
        self.assertEqual(statut, 401)
        self.assertIn(f'resource_metadata="{self.base}/.well-known/oauth-protected-resource"', entetes["WWW-Authenticate"])
        ressource = json.loads(self.envoyer("/.well-known/oauth-protected-resource")[1])
        self.assertEqual((ressource["resource"], ressource["authorization_servers"]), (self.base + "/mcp", [self.base]))
        serveur = json.loads(self.envoyer("/.well-known/oauth-authorization-server")[1])
        self.assertEqual(serveur["code_challenge_methods_supported"], ["S256"])
        self.assertEqual(serveur["registration_endpoint"], self.base + "/oauth/register")
        self.assertEqual(self.envoyer("/mcp", method="OPTIONS")[2]["Access-Control-Allow-Origin"], "*")

    def test_initialisation_et_liste_des_outils(self):
        statut, reponse, _ = self.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}})
        self.assertEqual(statut, 200)
        self.assertEqual((reponse["result"]["protocolVersion"], reponse["result"]["serverInfo"]["name"]), ("2025-06-18", "my-auto-export"))
        self.assertEqual(self.rpc("notifications/initialized", identifiant=None)[0], 202)
        self.assertEqual(self.rpc("ping")[1]["result"], {})
        outils = {outil["name"]: outil for outil in self.rpc("tools/list")[1]["result"]["tools"]}
        self.assertEqual(set(outils), {"rechercher_vehicules", "detail_vehicule", "ventes_a_traiter", "lister_offres",
                                       "enregistrer_vehicule", "retirer_vehicule", "accepter_offre", "refuser_offre"})
        self.assertTrue(outils["rechercher_vehicules"]["annotations"]["readOnlyHint"])
        self.assertTrue(outils["accepter_offre"]["annotations"]["destructiveHint"])
        self.assertNotIn("executer", outils["accepter_offre"])
        self.assertEqual(self.rpc("methode/inconnue")[1]["error"]["code"], -32601)
        self.assertEqual(self.rpc("tools/call", {"name": "inconnu", "arguments": {}})[1]["error"]["code"], -32602)

    def test_catalogue_ajout_modification_et_retrait(self):
        resultat, erreur = self.outil("rechercher_vehicules", texte="MY-0001")
        self.assertFalse(erreur)
        self.assertEqual([v["reference"] for v in resultat["vehicules"]], ["MY-0001"])

        resultat, erreur = self.outil("enregistrer_vehicule", reference="MCP-1",
                                      champs={"make": "Toyota", "model": "RAV4", "status": "stock", "indicativePriceTnd": 120000})
        self.assertEqual((erreur, resultat["created"]), (False, True))
        # Modification partielle : seuls les champs donnés changent, null efface.
        resultat, _ = self.outil("enregistrer_vehicule", reference="MCP-1", champs={"mileageKm": 42000, "indicativePriceTnd": None})
        detail, _ = self.outil("detail_vehicule", reference="MCP-1")
        self.assertEqual((detail["lot"]["make"], detail["lot"]["mileageKm"]), ("Toyota", 42000))
        self.assertNotIn("indicativePriceTnd", detail["lot"])

        self.assertEqual(self.outil("retirer_vehicule", reference="MCP-1")[0], {"reference": "MCP-1", "removed": True})
        public = [lot["reference"] for lot in json.loads(self.envoyer("/api/catalogue")[1])]
        self.assertNotIn("MCP-1", public)
        self.assertNotIn("MCP-1", [v["reference"] for v in self.outil("rechercher_vehicules", texte="MCP-1")[0]["vehicules"]])
        self.assertTrue(self.outil("rechercher_vehicules", texte="MCP-1", inclure_retires=True)[0]["vehicules"][0]["removed"])

        message, erreur = self.outil("enregistrer_vehicule", reference="MCP-2", champs={"make": "A", "model": "B", "status": "open"})
        self.assertEqual((erreur, message), (True, "Date de fin de vente obligatoire pour un lot en vente."))
        message, erreur = self.outil("detail_vehicule", reference="INCONNU")
        self.assertTrue(erreur)

    def test_vente_a_traiter_puis_acceptation(self):
        fin = (datetime.now(timezone.utc) + timedelta(seconds=4)).isoformat()
        self.outil("enregistrer_vehicule", reference="MCP-ENC", champs={"make": "BMW", "model": "X3", "status": "open", "endsAt": fin, "startingPriceTnd": 90000})
        for email, montant in (("alice@ex.com", 90000), ("bob@ex.com", 91000)):
            statut, data, _ = self.api("/api/offers", {"reference": "MCP-ENC", "amount": montant}, self.cookies[email])
            self.assertEqual(statut, 201, data)
        self.sql("UPDATE offers SET created_at = '2000-01-01T00:00:00.000Z' WHERE reference = 'MCP-ENC'")
        for _ in range(30):
            if any(v["reference"] == "MCP-ENC" for v in self.outil("ventes_a_traiter")[0]["aTraiter"]):
                break
            time.sleep(0.5)
        vente = next(v for v in self.outil("ventes_a_traiter")[0]["aTraiter"] if v["reference"] == "MCP-ENC")
        self.assertEqual((vente["bestBid"]["email"], vente["bestBid"]["amountTnd"]), ("bob@ex.com", 91000))

        offres = {o["email"]: o["id"] for o in self.outil("lister_offres", reference="MCP-ENC")[0]["offers"]}
        message, erreur = self.outil("accepter_offre", offre_id=offres["alice@ex.com"])
        self.assertEqual((erreur, message), (True, "Seule la meilleure enchère peut être acceptée."))
        resultat, erreur = self.outil("accepter_offre", offre_id=offres["bob@ex.com"])
        self.assertEqual((erreur, resultat["status"], resultat["removedFromSite"]), (False, "accepted", True))
        self.assertTrue(self.outil("accepter_offre", offre_id=offres["bob@ex.com"])[1], "déjà traitée")
        self.assertNotIn("MCP-ENC", [v["reference"] for v in self.outil("ventes_a_traiter")[0]["aTraiter"]])
        statuts = {o["email"]: o["status"] for o in self.outil("lister_offres", reference="MCP-ENC")[0]["offers"]}
        self.assertEqual(statuts, {"alice@ex.com": "refused", "bob@ex.com": "accepted"})
        self.assertEqual(self.outil("accepter_offre", offre_id="12")[1], True, "numéro non entier refusé")

    def test_refuser_une_offre(self):
        self.outil("enregistrer_vehicule", reference="MCP-BUY", champs={"make": "Kia", "model": "Niro", "status": "stock", "buyNowPriceTnd": 80000})
        self.assertEqual(self.api("/api/offers", {"reference": "MCP-BUY", "kind": "buy_now"}, self.cookies["alice@ex.com"])[0], 201)
        offre = self.outil("lister_offres", reference="MCP-BUY")[0]["offers"][0]
        self.assertEqual(self.outil("refuser_offre", offre_id=offre["id"])[0], {"id": offre["id"], "status": "refused"})

    def test_page_d_autorisation_dans_le_navigateur(self):
        # Petit serveur local qui reçoit le retour, comme celui qu'ouvre Claude Code pendant la connexion.
        retours = []

        class Retour(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                retours.append(self.path)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ok")

            def log_message(self, *args):
                pass

        serveur = http.server.HTTPServer(("127.0.0.1", 0), Retour)
        self.addCleanup(serveur.server_close)
        threading.Thread(target=serveur.serve_forever, daemon=True).start()
        self.addCleanup(serveur.shutdown)
        retour = f"http://127.0.0.1:{serveur.server_port}/callback"
        client = self.enregistrer([retour], nom="Claude <script>")[1]
        verifier, challenge = pkce()
        context = self.browser.new_context(viewport={"width": 390, "height": 844})
        self.addCleanup(context.close)
        page = context.new_page()
        params = urllib.parse.urlencode({"response_type": "code", "client_id": client["client_id"], "redirect_uri": retour,
                                         "code_challenge": challenge, "code_challenge_method": "S256", "state": "xyz"})
        page.goto(f"{self.base}/oauth/authorize?{params}")
        self.assertIn("Connecter « Claude <script> »", page.text_content("h1"), "nom affiché comme texte, pas comme HTML")
        self.assertIn(f"127.0.0.1:{serveur.server_port}", page.text_content("main"))
        page.fill("[name=email]", "admin@ex.com")
        page.fill("[name=password]", "mauvais-mot-de-passe")
        page.click("[value=autoriser]")
        page.wait_for_selector(".erreur")
        self.assertIn("incorrect", page.text_content(".erreur"))
        self.assertEqual(page.input_value("[name=email]"), "admin@ex.com")
        page.fill("[name=password]", MOT_DE_PASSE)
        page.click("[value=autoriser]")
        page.wait_for_function("document.body.textContent === 'ok'")
        params = urllib.parse.parse_qs(urllib.parse.urlparse(retours[-1]).query)
        self.assertEqual(params["state"], ["xyz"])
        statut, jetons = self.jeton({"grant_type": "authorization_code", "code": params["code"][0], "redirect_uri": retour,
                                     "client_id": client["client_id"], "code_verifier": verifier})
        self.assertEqual(statut, 200, jetons)
        self.assertEqual(self.rpc("ping", jeton=jetons["access_token"])[0], 200)

    def test_refus_et_comptes_non_administrateurs(self):
        client = self.enregistrer()[1]
        _, challenge = pkce()
        statut, _, entetes = self.autoriser(client["client_id"], challenge, decision="refuser")
        self.assertEqual(statut, 302)
        self.assertIn("error=access_denied", entetes["Location"])
        self.assertIn("state=etat-123", entetes["Location"])
        statut, corps, _ = self.autoriser(client["client_id"], challenge, email="alice@ex.com")
        self.assertEqual(statut, 403)
        self.assertIn("n&#39;a pas accès à l&#39;administration", corps.decode())
        statut, _, _ = self.formulaire("/oauth/authorize", {"client_id": client["client_id"], "redirect_uri": RETOUR, "response_type": "code",
                                                            "code_challenge": challenge, "code_challenge_method": "S256",
                                                            "email": "admin@ex.com", "password": MOT_DE_PASSE, "decision": "autoriser"}, origine=False)
        self.assertEqual(statut, 403, "formulaire envoyé depuis un autre site")

    def test_adresses_de_retour_et_demandes_invalides(self):
        self.assertEqual(self.enregistrer([RETOUR_CLAUDE])[0], 201)
        self.assertEqual(self.enregistrer(["http://localhost:6274/oauth/callback"])[0], 201)
        for uri in ("https://pirate.example/callback", "https://claude.ai.pirate.example/api/mcp/auth_callback",
                    "https://claude.ai/autre", "javascript:alert(1)", "http://pirate.example/callback"):
            with self.subTest(uri):
                statut, data = self.enregistrer([uri])
                self.assertEqual((statut, data["error"]), (400, "invalid_redirect_uri"))
        client = self.enregistrer()[1]
        _, challenge = pkce()
        # Adresse de retour non enregistrée : page d'erreur, jamais de redirection.
        statut, _, entetes = self.envoyer("/oauth/authorize?" + urllib.parse.urlencode({
            "response_type": "code", "client_id": client["client_id"], "redirect_uri": "http://127.0.0.1:9/autre",
            "code_challenge": challenge, "code_challenge_method": "S256"}))
        self.assertEqual(statut, 400)
        self.assertNotIn("Location", entetes)
        # Sans PKCE S256 : erreur renvoyée à l'application.
        statut, _, entetes = self.envoyer("/oauth/authorize?" + urllib.parse.urlencode({
            "response_type": "code", "client_id": client["client_id"], "redirect_uri": RETOUR, "code_challenge": challenge,
            "code_challenge_method": "plain"}))
        self.assertEqual(statut, 302)
        self.assertIn("error=invalid_request", entetes["Location"])

    def test_code_a_usage_unique_et_verification_pkce(self):
        client = self.enregistrer()[1]
        verifier, challenge = pkce()
        code = urllib.parse.parse_qs(urllib.parse.urlparse(self.autoriser(client["client_id"], challenge)[2]["Location"]).query)["code"][0]
        echange = {"grant_type": "authorization_code", "code": code, "redirect_uri": RETOUR, "client_id": client["client_id"]}
        self.assertEqual(self.jeton({**echange, "code_verifier": pkce()[0]})[1]["error"], "invalid_grant", "mauvais code_verifier")
        self.assertEqual(self.jeton({**echange, "code_verifier": verifier})[0], 400, "un code présenté avec un mauvais verifier est brûlé")
        self.assertEqual(self.jeton({**echange, "client_id": self.enregistrer()[1]["client_id"], "code_verifier": verifier})[0], 400)

        code = urllib.parse.parse_qs(urllib.parse.urlparse(self.autoriser(client["client_id"], challenge)[2]["Location"]).query)["code"][0]
        echange["code"] = code
        self.assertEqual(self.jeton({**echange, "code_verifier": verifier})[0], 200)
        statut, data = self.jeton({**echange, "code_verifier": verifier})
        self.assertEqual((statut, data["error"]), (400, "invalid_grant"), "code déjà utilisé")
        self.assertEqual(self.jeton({"grant_type": "password", "client_id": client["client_id"]})[1]["error"], "unsupported_grant_type")

    def test_renouvellement_et_perte_du_role_admin(self):
        jetons = self.connecter()
        statut, nouveaux = self.jeton({"grant_type": "refresh_token", "refresh_token": jetons["refresh_token"], "client_id": jetons["client_id"]})
        self.assertEqual(statut, 200, nouveaux)
        self.assertNotEqual(nouveaux["access_token"], jetons["access_token"])
        statut, data = self.jeton({"grant_type": "refresh_token", "refresh_token": jetons["refresh_token"], "client_id": jetons["client_id"]})
        self.assertEqual((statut, data["error"]), (400, "invalid_grant"), "jeton de renouvellement à usage unique")
        self.assertEqual(self.rpc("ping", jeton=nouveaux["access_token"])[0], 200)

        self.sql("INSERT INTO users (email, name, password_hash, password_salt, role) SELECT 'ex-admin@ex.com', 'Ex', password_hash, password_salt, 'admin' FROM users WHERE email = 'admin@ex.com'")
        client = self.enregistrer()[1]
        verifier, challenge = pkce()
        code = urllib.parse.parse_qs(urllib.parse.urlparse(self.autoriser(client["client_id"], challenge, email="ex-admin@ex.com")[2]["Location"]).query)["code"][0]
        ex = self.jeton({"grant_type": "authorization_code", "code": code, "redirect_uri": RETOUR, "client_id": client["client_id"], "code_verifier": verifier})[1]
        self.assertEqual(self.rpc("ping", jeton=ex["access_token"])[0], 200)
        self.sql("UPDATE users SET role = 'buyer' WHERE email = 'ex-admin@ex.com'")
        self.assertEqual(self.rpc("ping", jeton=ex["access_token"])[0], 401, "l'accès s'arrête avec le rôle")
        self.assertEqual(self.jeton({"grant_type": "refresh_token", "refresh_token": ex["refresh_token"], "client_id": client["client_id"]})[0], 400)


if __name__ == "__main__":
    unittest.main()
