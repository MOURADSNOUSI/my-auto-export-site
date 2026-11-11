"""Tests de bout en bout des enchères en direct (Worker + D1 local + navigateur).

Lancement : WRANGLER=/chemin/vers/wrangler python3 -m unittest tests.test_encheres
Ignorés si la variable WRANGLER n'est pas définie.
"""
import hashlib
import hmac
import json
import os
import subprocess
import tempfile
import threading
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


@unittest.skipUnless(WRANGLER, "définir WRANGLER pour lancer les tests du Worker")
class EncheresTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.persist = cls.tmp.name
        cls.config = config_de_test(cls.tmp.name)
        subprocess.run([WRANGLER, "d1", "migrations", "apply", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config],
                       cwd=PROJET, check=True, capture_output=True)
        port = port_libre()
        cls.base = f"http://localhost:{port}"
        cls.serveur = subprocess.Popen([WRANGLER, "dev", "--local", "--port", str(port), "--persist-to", cls.persist, "-c", cls.config,
                                        "--var", "STRIPE_WEBHOOK_SECRET:whsec_test", "--var", "BANK_IBAN:TN59TEST", "--var", "BANK_BENEFICIARY:Test SARL"],
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
            assert cls.requete("/api/register", {"name": email.split("@")[0].title() + " Test", "email": email, "password": MOT_DE_PASSE}, "POST")[0] == 201
        subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config,
                        "--command", "UPDATE users SET role = 'admin' WHERE email = 'admin@ex.com'"], cwd=PROJET, check=True, capture_output=True)
        subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", cls.persist, "-c", cls.config,
                        "--command", "UPDATE users SET deposit_tnd = 1000000 WHERE email IN ('alice@ex.com', 'bob@ex.com')"], cwd=PROJET, check=True, capture_output=True)
        cls.cookies = {email: cls.connexion(email) for email in ("admin@ex.com", "alice@ex.com", "bob@ex.com")}
        for email in ("alice@ex.com", "bob@ex.com"):
            assert cls.requete("/api/terms", {"version": CGV_VERSION}, "POST", cls.cookies[email])[0] == 200

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.serveur.terminate()
        cls.serveur.wait(timeout=20)
        cls.tmp.cleanup()

    @classmethod
    def requete(cls, chemin, data=None, method=None, cookie=None):
        headers = {"Origin": cls.base}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        requete = urllib.request.Request(cls.base + chemin, data=None if data is None else json.dumps(data).encode(), method=method, headers=headers)
        try:
            with urllib.request.urlopen(requete) as reponse:
                return reponse.status, json.loads(reponse.read() or b"null"), reponse.headers.get("Set-Cookie")
        except urllib.error.HTTPError as erreur:
            with erreur:
                return erreur.code, json.loads(erreur.read() or b"null"), None

    @classmethod
    def connexion(cls, email):
        return cls.requete("/api/login", {"email": email, "password": MOT_DE_PASSE}, "POST")[2].split(";")[0]

    def creer_lot(self, reference, **champs):
        corps = {"make": "BMW", "model": "X5", "status": "open", "endsAt": dans(days=2), "startingPriceTnd": 100000, **champs}
        statut, data, _ = self.requete(f"/api/admin/vehicles/{reference}", corps, "PUT", self.cookies["admin@ex.com"])
        self.assertEqual(statut, 200, data)

    def encherir(self, email, reference, montant):
        return self.requete("/api/offers", {"reference": reference, "amount": montant}, "POST", self.cookies[f"{email}@ex.com"])

    def enchere(self, reference):
        return self.requete(f"/api/auctions/{reference}", cookie=self.cookies["alice@ex.com"])[1]

    def test_retrait_d_une_enchere_avant_12_heures_de_la_fin(self):
        self.creer_lot("RETRAIT-1", endsAt=dans(hours=30))
        self.assertEqual(self.encherir("alice", "RETRAIT-1", 100000)[0], 201)
        statut, data, _ = self.encherir("bob", "RETRAIT-1", 101000)
        self.assertEqual(statut, 201, data)
        offre_bob = data["offer"]["id"]
        mes_offres = self.requete("/api/me", cookie=self.cookies["bob@ex.com"])[1]["offers"]
        self.assertTrue(next(o for o in mes_offres if o["id"] == offre_bob)["canWithdraw"])
        # Une autre personne ne peut pas retirer l'offre.
        self.assertEqual(self.requete(f"/api/offers/{offre_bob}", method="DELETE", cookie=self.cookies["alice@ex.com"])[0], 404)
        statut, data, _ = self.requete(f"/api/offers/{offre_bob}", method="DELETE", cookie=self.cookies["bob@ex.com"])
        self.assertEqual((statut, data["status"]), (200, "withdrawn"), data)
        self.assertEqual(data["auction"]["currentBidTnd"], 100000)
        self.assertEqual(data["auction"]["bidCount"], 1)
        mes_offres = self.requete("/api/me", cookie=self.cookies["bob@ex.com"])[1]["offers"]
        retiree = next(o for o in mes_offres if o["id"] == offre_bob)
        self.assertEqual((retiree["status"], retiree["canWithdraw"]), ("withdrawn", False))
        self.assertEqual(self.requete(f"/api/offers/{offre_bob}", method="DELETE", cookie=self.cookies["bob@ex.com"])[0], 409)
        # Le prix minimum suivant revient au niveau de l'offre précédente.
        self.assertEqual(self.encherir("bob", "RETRAIT-1", 101000)[0], 201)

    def test_retrait_refuse_a_moins_de_12_heures_de_la_fin(self):
        self.creer_lot("RETRAIT-2", endsAt=dans(hours=11))
        statut, data, _ = self.encherir("alice", "RETRAIT-2", 100000)
        self.assertEqual(statut, 201, data)
        offre = data["offer"]["id"]
        mes_offres = self.requete("/api/me", cookie=self.cookies["alice@ex.com"])[1]["offers"]
        self.assertFalse(next(o for o in mes_offres if o["id"] == offre)["canWithdraw"])
        statut, data, _ = self.requete(f"/api/offers/{offre}", method="DELETE", cookie=self.cookies["alice@ex.com"])
        self.assertEqual(statut, 403, data)
        self.assertEqual(self.enchere("RETRAIT-2")["auction"]["currentBidTnd"], 100000)

    def test_retrait_impossible_pour_une_offre_deja_acceptee(self):
        self.creer_lot("RETRAIT-3", endsAt=dans(hours=30), buyNowPriceTnd=150000)
        statut, data, _ = self.requete("/api/offers", {"reference": "RETRAIT-3", "kind": "buy_now"}, "POST", self.cookies["alice@ex.com"])
        self.assertEqual(statut, 201, data)
        self.assertEqual(self.requete(f"/api/offers/{data['offer']['id']}", method="DELETE", cookie=self.cookies["alice@ex.com"])[0], 400)

    def test_regles_du_montant_minimum(self):
        self.creer_lot("ENC-1")
        statut, data, _ = self.encherir("alice", "ENC-1", 99000)
        self.assertEqual((statut, data["error"]), (400, "L'enchère minimale est de 100000 TND."))
        self.assertEqual(self.encherir("alice", "ENC-1", 100000)[0], 201)
        etat = self.enchere("ENC-1")["auction"]
        self.assertEqual((etat["currentBidTnd"], etat["incrementTnd"], etat["minNextBidTnd"], etat["bidCount"]), (100000, 1000, 101000, 1))
        self.assertEqual(self.encherir("bob", "ENC-1", 100500)[0], 400, "sous le pas minimum")
        self.assertEqual(self.encherir("bob", "ENC-1", 101000)[0], 201)
        self.assertEqual(self.encherir("alice", "ENC-1", 101000.5)[0], 400, "montant non entier")

    def test_historique_anonyme_et_statuts_acheteurs(self):
        self.creer_lot("ENC-2", reservePriceTnd=105000)
        self.encherir("alice", "ENC-2", 100000)
        self.encherir("bob", "ENC-2", 102000)
        detail = self.enchere("ENC-2")
        self.assertEqual([(b["amountTnd"], b["bidder"], b["you"]) for b in detail["bids"]],
                         [(102000, "Enchérisseur 2", False), (100000, "Enchérisseur 1", True)])
        self.assertNotIn("email", json.dumps(detail))
        self.assertIs(detail["auction"]["reserveMet"], False)
        alice = self.requete("/api/me", cookie=self.cookies["alice@ex.com"])[1]
        self.assertEqual([o["status"] for o in alice["offers"] if o["reference"] == "ENC-2"], ["outbid"])
        bob = self.requete("/api/me", cookie=self.cookies["bob@ex.com"])[1]
        self.assertEqual([o["status"] for o in bob["offers"] if o["reference"] == "ENC-2"], ["leading"])
        admin = self.requete("/api/admin/auctions/ENC-2", cookie=self.cookies["admin@ex.com"])[1]
        self.assertEqual(admin["bids"][0]["email"], "bob@ex.com")
        self.assertEqual(self.requete("/api/admin/auctions/ENC-2", cookie=self.cookies["bob@ex.com"])[0], 403)

    def test_prolongation_anti_derniere_seconde(self):
        self.creer_lot("ENC-3", endsAt=dans(seconds=30))
        self.assertEqual(self.encherir("alice", "ENC-3", 100000)[0], 201)
        etat = self.enchere("ENC-3")["auction"]
        self.assertTrue(etat["extended"])
        restant = datetime.fromisoformat(etat["endsAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)
        self.assertGreater(restant, timedelta(seconds=100))

    def test_vente_terminee_et_lot_a_venir_refuses(self):
        self.creer_lot("ENC-4", endsAt=dans(seconds=3))
        time.sleep(4)
        statut, data, _ = self.encherir("alice", "ENC-4", 100000)
        self.assertEqual((statut, data["error"]), (400, "La vente de ce lot est terminée."))
        self.creer_lot("ENC-5", status="upcoming", endsAt=None)
        self.assertEqual(self.encherir("alice", "ENC-5", 100000)[1]["error"], "Les enchères de ce lot ne sont pas encore ouvertes.")
        self.creer_lot("ENC-6", status="stock", endsAt=None)
        self.assertEqual(self.encherir("alice", "ENC-6", 100000)[0], 400)

    def test_gagnant_et_reserve_apres_la_fin(self):
        self.creer_lot("ENC-7", endsAt=dans(seconds=3), reservePriceTnd=100000)
        self.encherir("alice", "ENC-7", 100000)
        # L'enchère a prolongé la vente de 2 minutes : on ramène la fin dans le passé directement en base.
        subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", self.persist, "-c", self.config, "--command",
                        "UPDATE offers SET created_at = '2000-01-01T00:00:00.000Z' WHERE reference = 'ENC-7'"], cwd=PROJET, check=True, capture_output=True)
        time.sleep(3)
        alice = self.requete("/api/me", cookie=self.cookies["alice@ex.com"])[1]
        self.assertEqual([o["status"] for o in alice["offers"] if o["reference"] == "ENC-7"], ["won"])

    def test_deux_encheres_simultanees_une_seule_acceptee(self):
        self.creer_lot("ENC-8")
        resultats = []
        fils = [threading.Thread(target=lambda e=e: resultats.append(self.encherir(e, "ENC-8", 100000)[0])) for e in ("alice", "bob")]
        for fil in fils:
            fil.start()
        for fil in fils:
            fil.join()
        # Selon l'ordre d'arrivée, la seconde est refusée par la vérification préalable (400) ou par la base (409).
        self.assertEqual(resultats.count(201), 1, resultats)
        self.assertIn(min(set(resultats) - {201}), (400, 409))
        self.assertEqual(self.enchere("ENC-8")["auction"]["bidCount"], 1)

    def sql(self, commande):
        subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", self.persist, "-c", self.config, "--command", commande],
                       cwd=PROJET, check=True, capture_output=True)

    def webhook(self, evenement, secret="whsec_test"):
        corps = json.dumps(evenement).encode()
        t = str(int(time.time()))
        signature = hmac.new(secret.encode(), t.encode() + b"." + corps, hashlib.sha256).hexdigest()
        requete = urllib.request.Request(self.base + "/api/stripe/webhook", data=corps, method="POST",
                                         headers={"Stripe-Signature": f"t={t},v1={signature}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(requete) as reponse:
                return reponse.status
        except urllib.error.HTTPError as erreur:
            erreur.close()
            return erreur.code

    def nouvel_acheteur(self, email):
        self.assertEqual(self.requete("/api/register", {"name": "Test", "email": email, "password": MOT_DE_PASSE}, "POST")[0], 201)
        cookie = self.connexion(email)
        self.assertEqual(self.requete("/api/terms", {"version": CGV_VERSION}, "POST", cookie)[0], 200)
        return cookie, self.requete("/api/me", cookie=cookie)[1]["user"]["id"]

    def test_bareme_caution(self):
        from_js = {29_000: 500, 30_000: 500, 30_001: 1000, 50_000: 1000, 60_000: 1500, 90_000: 2000, 100_000: 2000, 150_000: 2500, 199_999: 2500, 200_000: 3000}
        for valeur, attendu in from_js.items():
            self.creer_lot(f"BAR-{valeur}", startingPriceTnd=valeur)
            self.assertEqual(self.requete(f"/api/auctions/BAR-{valeur}", cookie=self.cookies["alice@ex.com"])[1]["auction"]["depositRequiredTnd"], attendu, valeur)
        self.creer_lot("BAR-R", startingPriceTnd=20000, reservePriceTnd=250000)
        self.assertEqual(self.requete("/api/auctions/BAR-R", cookie=self.cookies["alice@ex.com"])[1]["auction"]["depositRequiredTnd"], 3000, "la réserve prime")

    def test_caution_par_virement_validee_par_l_admin(self):
        self.creer_lot("ENC-V")
        cookie, user_id = self.nouvel_acheteur("virement@ex.com")
        self.assertEqual(self.requete("/api/offers", {"reference": "ENC-V", "amount": 100000}, "POST", cookie)[0], 403)
        statut, data, _ = self.requete("/api/deposit/transfer", {"reference": "ENC-V"}, "POST", cookie)
        self.assertEqual((statut, data["transfer"]["amountTnd"], data["transfer"]["reference"]), (201, 2000, f"CAUTION-{data['transfer']['id']}"), "barème : 100 000 TND → 2 000")
        self.assertEqual(self.requete("/api/offers", {"reference": "ENC-V", "amount": 100000}, "POST", cookie)[0], 403, "pas avant validation")
        admin = self.cookies["admin@ex.com"]
        attente = self.requete("/api/admin/deposits", cookie=admin)[1]["transfers"]
        depot = next(t for t in attente if t["userId"] == user_id)
        self.assertEqual(self.requete(f"/api/admin/deposits/{depot['id']}/confirm", {"amountTnd": 2000}, "POST", cookie)[0], 403, "réservé à l'admin")
        self.assertEqual(self.requete(f"/api/admin/deposits/{depot['id']}/confirm", {"amountTnd": 2000}, "POST", admin)[0], 200)
        self.assertEqual(self.requete(f"/api/admin/deposits/{depot['id']}/confirm", {"amountTnd": 2000}, "POST", admin)[0], 404, "pas de double crédit")
        self.assertEqual(self.requete("/api/me", cookie=cookie)[1]["user"]["depositTnd"], 2000)
        self.assertEqual(self.requete("/api/offers", {"reference": "ENC-V", "amount": 100000}, "POST", cookie)[0], 201)
        self.creer_lot("ENC-V2", reservePriceTnd=300000)
        self.assertEqual(self.requete("/api/offers", {"reference": "ENC-V2", "amount": 100000}, "POST", cookie)[0], 403, "lot plus cher : caution insuffisante")
        statut, data, _ = self.requete("/api/deposit/transfer", {"reference": "ENC-V2"}, "POST", cookie)
        self.assertEqual((statut, data["transfer"]["amountTnd"]), (201, 1000), "réserve 300 000 → 3 000, seul le complément est demandé")
        self.assertEqual(self.requete("/api/deposit/transfer", {"reference": "ENC-INCONNU"}, "POST", cookie)[0], 404)

    def test_caution_par_carte_webhook_stripe(self):
        cookie, user_id = self.nouvel_acheteur("carte@ex.com")
        self.assertEqual(self.requete("/api/deposit/card", {"reference": "ENC-10"}, "POST", cookie)[0], 503, "Stripe non configuré")
        self.sql(f"INSERT INTO deposits (id, user_id, method, amount_tnd, charge_amount, charge_currency, stripe_session_id) VALUES (9001, {user_id}, 'card', 500, 14706, 'eur', 'cs_test_1')")
        session = {"id": "cs_test_1", "object": "checkout.session", "payment_status": "paid", "amount_total": 14706, "currency": "eur"}
        evenement = {"type": "checkout.session.completed", "data": {"object": session}}
        self.assertEqual(self.webhook(evenement, "mauvais-secret"), 400)
        self.assertEqual(self.requete("/api/me", cookie=cookie)[1]["user"]["depositTnd"], 0)
        self.assertEqual(self.webhook(evenement), 200)
        self.assertEqual(self.webhook(evenement), 200)
        user = self.requete("/api/me", cookie=cookie)[1]["user"]
        self.assertEqual(user["depositTnd"], 500, "crédité une seule fois")

    def test_conditions_obligatoires_avant_d_encherir(self):
        self.creer_lot("ENC-10")
        self.assertEqual(self.requete("/api/register", {"name": "Carla Test", "email": "carla@ex.com", "password": MOT_DE_PASSE}, "POST")[0], 201)
        cookie = self.connexion("carla@ex.com")
        self.assertFalse(self.requete("/api/me", cookie=cookie)[1]["user"]["termsAccepted"])
        statut, data, _ = self.requete("/api/offers", {"reference": "ENC-10", "amount": 100000}, "POST", cookie)
        self.assertEqual(statut, 428, data)
        self.assertEqual(self.requete("/api/terms", {"version": "2020-01-01"}, "POST", cookie)[0], 409, "ancienne version refusée")
        self.assertEqual(self.requete("/api/terms", {"version": CGV_VERSION}, "POST", cookie)[0], 200)
        self.assertTrue(self.requete("/api/me", cookie=cookie)[1]["user"]["termsAccepted"])
        statut, data, _ = self.requete("/api/offers", {"reference": "ENC-10", "amount": 100000}, "POST", cookie)
        self.assertEqual(statut, 403, data)
        user_id = self.requete("/api/me", cookie=cookie)[1]["user"]["id"]
        admin = self.cookies["admin@ex.com"]
        self.assertEqual(self.requete(f"/api/admin/users/{user_id}/deposit", {"amountTnd": 1999, "reason": "Test"}, "POST", admin)[0], 200)
        self.assertEqual(self.requete("/api/offers", {"reference": "ENC-10", "amount": 100000}, "POST", cookie)[0], 403)
        self.assertEqual(self.requete(f"/api/admin/users/{user_id}/deposit", {"amountTnd": -1, "reason": "Test"}, "POST", admin)[0], 400)
        self.assertEqual(self.requete(f"/api/admin/users/{user_id}/deposit", {"amountTnd": 2000, "reason": "Test"}, "POST", cookie)[0], 403)
        self.assertEqual(self.requete(f"/api/admin/users/{user_id}/deposit", {"amountTnd": 2000, "reason": "Test"}, "POST", admin)[0], 200)
        self.assertEqual(self.requete("/api/offers", {"reference": "ENC-10", "amount": 100000}, "POST", cookie)[0], 201)
        self.assertEqual(self.requete("/api/terms", {"version": CGV_VERSION}, "POST")[0], 401)

    def test_case_conditions_dans_le_navigateur(self):
        self.creer_lot("ENC-11", make="Volvo", model="XC90")
        self.assertEqual(self.requete("/api/register", {"name": "Dora Test", "email": "dora@ex.com", "password": MOT_DE_PASSE}, "POST")[0], 201)
        subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", self.persist, "-c", self.config,
                        "--command", "UPDATE users SET deposit_tnd = 1000000 WHERE email = 'dora@ex.com'"], cwd=PROJET, check=True, capture_output=True)
        context = self.browser.new_context(bypass_csp=True, viewport={"width": 390, "height": 844})
        self.addCleanup(context.close)
        page = context.new_page()
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(self.base + "/")
        page.wait_for_function("catalogueEtat === 'ready' && compte.disponible")
        page.click("#compte-identifier")
        page.fill("#login-email", "dora@ex.com")
        page.fill("#login-password", MOT_DE_PASSE)
        page.click("#login-form [type=submit]")
        page.wait_for_selector("#account-dialog[open]")
        page.keyboard.press("Escape")
        page.locator(".lot-card", has_text="ENC-11").get_by_text("Voir la fiche").click()
        page.wait_for_selector("#auction-panel .terms-check")
        self.assertEqual(page.get_attribute(".terms-check a", "href"), "/conditions")
        page.click("#auction-panel [type=submit]")
        self.assertTrue(page.evaluate("!document.querySelector('.terms-check input').checkValidity()"), "case obligatoire")
        self.assertEqual(self.enchere("ENC-11")["auction"]["bidCount"], 0)
        page.check(".terms-check input")
        page.click("#auction-panel [type=submit]")
        page.wait_for_function("document.querySelector('#auction-panel .current-box strong')?.textContent.includes('100')"
                               " && !document.querySelector('#auction-panel .terms-check')")
        self.assertEqual(self.enchere("ENC-11")["auction"]["bidCount"], 1)

    def test_page_des_conditions(self):
        with urllib.request.urlopen(self.base + "/conditions") as reponse:
            page = reponse.read().decode()
        self.assertIn(CGV_VERSION, page)
        for texte in ("loi n° 2000-83", "loi organique n° 2004-63", "Code des obligations et des contrats", "droit tunisien"):
            self.assertIn(texte, page)

    def terminer(self, reference):
        """Ramène la dernière enchère dans le passé puis attend que la vente soit terminée (endsAt dans quelques secondes)."""
        subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", self.persist, "-c", self.config, "--command",
                        f"UPDATE offers SET created_at = '2000-01-01T00:00:00.000Z' WHERE reference = '{reference}' AND kind = 'bid'"],
                       cwd=PROJET, check=True, capture_output=True)
        # Attente sur l'état réel plutôt qu'une durée fixe : sous charge, une pause fixe peut finir avant endsAt.
        for _ in range(30):
            if self.offres(reference)[1]["lots"][reference]["auction"]["status"] == "ended":
                return
            time.sleep(0.5)
        self.fail(f"la vente {reference} ne s'est pas terminée")

    def offres(self, reference, email="admin@ex.com"):
        return self.requete(f"/api/admin/offers?reference={reference}", cookie=self.cookies[email])

    def decider(self, offre_id, action, corps=None, email="admin@ex.com"):
        return self.requete(f"/api/admin/offers/{offre_id}/{action}", corps or {}, "POST", self.cookies[email])

    def test_accepter_la_meilleure_enchere_apres_la_fin(self):
        self.creer_lot("ACC-1", endsAt=dans(seconds=4), reservePriceTnd=105000)
        self.encherir("alice", "ACC-1", 100000)
        self.encherir("bob", "ACC-1", 101000)
        statut, data, _ = self.offres("ACC-1")
        meilleure = next(o for o in data["offers"] if o["best"])
        self.assertEqual((statut, meilleure["email"]), (200, "bob@ex.com"))
        self.assertEqual(self.decider(meilleure["id"], "accept")[0], 409, "vente encore en cours")

        self.terminer("ACC-1")
        self.assertIs(self.offres("ACC-1")[1]["lots"]["ACC-1"]["auction"]["reserveMet"], False)
        statut, data, _ = self.decider(meilleure["id"], "accept", {"removeFromSite": True})
        self.assertEqual((statut, data["status"]), (200, "accepted"), "acceptation possible sous la réserve (CGV 6.3)")
        statuts = {o["email"]: o["status"] for o in self.offres("ACC-1")[1]["offers"]}
        self.assertEqual(statuts, {"bob@ex.com": "accepted", "alice@ex.com": "refused"})

        bob = self.requete("/api/me", cookie=self.cookies["bob@ex.com"])[1]
        self.assertEqual([o["status"] for o in bob["offers"] if o["reference"] == "ACC-1"], ["accepted"])
        self.assertIn("ACC-1", [v["reference"] for v in bob["vehicles"]])
        alice = self.requete("/api/me", cookie=self.cookies["alice@ex.com"])[1]
        self.assertEqual([o["status"] for o in alice["offers"] if o["reference"] == "ACC-1"], ["refused"])
        self.assertNotIn("ACC-1", [v["reference"] for v in alice["vehicles"]])
        self.assertNotIn("ACC-1", [lot["reference"] for lot in self.requete("/api/catalogue")[1]], "retiré du site")
        self.assertEqual(self.decider(meilleure["id"], "accept")[0], 409, "déjà traitée")

    def test_enchere_perdante_ne_peut_pas_etre_acceptee(self):
        self.creer_lot("ACC-5", make="Skoda", model="Kodiaq", endsAt=dans(seconds=4))
        self.encherir("alice", "ACC-5", 100000)
        self.encherir("bob", "ACC-5", 101000)
        self.terminer("ACC-5")
        offres = {o["email"]: o for o in self.offres("ACC-5")[1]["offers"]}
        self.assertFalse(offres["alice@ex.com"]["best"])
        statut, data, _ = self.decider(offres["alice@ex.com"]["id"], "accept")
        self.assertEqual((statut, data["error"]), (409, "Seule la meilleure enchère peut être acceptée."))
        statuts = {o["email"]: o["status"] for o in self.offres("ACC-5")[1]["offers"]}
        self.assertEqual(statuts, {"alice@ex.com": "pending", "bob@ex.com": "pending"}, "rien n'a changé")
        alice = self.requete("/api/me", cookie=self.cookies["alice@ex.com"])[1]
        self.assertNotIn("ACC-5", [v["reference"] for v in alice["vehicles"]])
        self.assertIn("ACC-5", [lot["reference"] for lot in self.requete("/api/catalogue")[1]], "toujours en ligne")

        # Dans la page : l'enchère perdante peut être refusée, pas acceptée.
        context = self.browser.new_context(bypass_csp=True, viewport={"width": 390, "height": 844})
        self.addCleanup(context.close)
        page = context.new_page()
        page.goto(self.base + "/admin.html")
        page.fill("#login-email", "admin@ex.com")
        page.fill("#login-password", MOT_DE_PASSE)
        page.click("#login-form [type=submit]")
        page.wait_for_selector("#todo:not(.hidden)")
        page.locator("#todo-list li", has_text="ACC-5").get_by_text("Décider").click()
        page.wait_for_selector("#bids-dialog[open] [data-accept]")
        self.assertEqual(page.locator("#bids-body [data-accept]").count(), 1)
        self.assertEqual(page.locator("#bids-body li.best [data-accept]").count(), 1)
        perdante = page.locator("#bids-body li:not(.best)")
        self.assertEqual((perdante.locator("[data-accept]").count(), perdante.locator("[data-refuse]").count()), (0, 1))

    def test_deux_acceptations_simultanees_une_seule_vente(self):
        self.creer_lot("ACC-6", status="stock", endsAt=None, buyNowPriceTnd=95000)
        for email in ("alice", "bob"):
            self.assertEqual(self.requete("/api/offers", {"reference": "ACC-6", "kind": "buy_now"}, "POST", self.cookies[f"{email}@ex.com"])[0], 201)
        offres = {o["email"]: o["id"] for o in self.offres("ACC-6")[1]["offers"]}
        depart = threading.Barrier(2)
        resultats = {}

        def accepter(email):
            depart.wait()
            resultats[email] = self.decider(offres[email], "accept")[0]

        fils = [threading.Thread(target=accepter, args=(email,)) for email in offres]
        for fil in fils:
            fil.start()
        for fil in fils:
            fil.join()
        self.assertEqual(sorted(resultats.values()), [200, 409], resultats)
        gagnant = next(email for email, statut in resultats.items() if statut == 200)
        perdant = next(email for email in resultats if email != gagnant)
        statuts = {o["email"]: o["status"] for o in self.offres("ACC-6")[1]["offers"]}
        self.assertEqual(statuts, {gagnant: "accepted", perdant: "refused"})
        for email, attendu in ((gagnant, True), (perdant, False)):
            moi = self.requete("/api/me", cookie=self.cookies[email])[1]
            self.assertEqual("ACC-6" in [v["reference"] for v in moi["vehicles"]], attendu, email)
        # Même la même offre envoyée deux fois de suite (double clic) n'est acceptée qu'une fois.
        self.assertEqual(self.decider(offres[gagnant], "accept")[0], 409)
        # La base refuse elle-même une seconde offre acceptée pour la même référence.
        with self.assertRaises(subprocess.CalledProcessError):
            subprocess.run([WRANGLER, "d1", "execute", "DB", "--local", "--persist-to", self.persist, "-c", self.config, "--command",
                            f"UPDATE offers SET status = 'accepted' WHERE id = {offres[perdant]}"], cwd=PROJET, check=True, capture_output=True)

    def test_achat_immediat_refuse_puis_accepte_sans_retirer(self):
        self.creer_lot("ACC-2", status="stock", endsAt=None, indicativePriceTnd=90000, buyNowPriceTnd=95000)
        for email in ("alice", "bob"):
            statut, _, _ = self.requete("/api/offers", {"reference": "ACC-2", "kind": "buy_now"}, "POST", self.cookies[f"{email}@ex.com"])
            self.assertEqual(statut, 201)
        offres = {o["email"]: o for o in self.offres("ACC-2")[1]["offers"]}
        self.assertEqual(self.decider(offres["alice@ex.com"]["id"], "refuse")[0], 200)
        self.assertEqual(self.decider(offres["bob@ex.com"]["id"], "accept", {"removeFromSite": False})[0], 200)
        self.assertIn("ACC-2", [lot["reference"] for lot in self.requete("/api/catalogue")[1]], "laissé en ligne")
        statuts = {o["email"]: o["status"] for o in self.offres("ACC-2")[1]["offers"]}
        self.assertEqual(statuts, {"alice@ex.com": "refused", "bob@ex.com": "accepted"})

    def test_reserve_aux_administrateurs(self):
        self.creer_lot("ACC-3")
        self.encherir("alice", "ACC-3", 100000)
        offre_id = self.offres("ACC-3")[1]["offers"][0]["id"]
        self.assertEqual(self.offres("ACC-3", "alice@ex.com")[0], 403)
        self.assertEqual(self.decider(offre_id, "accept", email="alice@ex.com")[0], 403)
        self.assertEqual(self.decider(offre_id, "refuse", email="bob@ex.com")[0], 403)

    def test_decision_dans_la_page_admin(self):
        self.creer_lot("ACC-4", make="Kia", model="Sorento", endsAt=dans(seconds=4))
        self.encherir("alice", "ACC-4", 100000)
        self.encherir("bob", "ACC-4", 101000)
        self.terminer("ACC-4")
        context = self.browser.new_context(bypass_csp=True, viewport={"width": 390, "height": 844})
        self.addCleanup(context.close)
        page = context.new_page()
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(self.base + "/admin.html")
        page.fill("#login-email", "admin@ex.com")
        page.fill("#login-password", MOT_DE_PASSE)
        page.click("#login-form [type=submit]")
        page.wait_for_selector("#todo:not(.hidden)")
        ligne = page.locator("#todo-list li", has_text="ACC-4")
        self.assertIn("Vente terminée · meilleure enchère 101", ligne.text_content())
        ligne.get_by_text("Décider").click()
        page.wait_for_selector("#bids-dialog[open] [data-accept]")
        page.locator("#bids-body li.best [data-accept]").click()
        page.wait_for_selector("#decision-ok:not(.hidden)")
        lien = page.get_attribute("#bids-body a.button[href^='mailto:']", "href")
        self.assertTrue(lien.startswith("mailto:bob%40ex.com?subject="), lien)
        self.assertIn("ACC-4", urllib.request.unquote(lien))
        self.assertEqual(page.locator("#bids-body [data-accept]").count(), 0)
        page.keyboard.press("Escape")
        self.assertEqual(page.locator("#todo-list li", has_text="ACC-4").count(), 0)
        # Retiré du site à l'acceptation (case cochée par défaut) : visible avec le filtre « Retirés ».
        page.select_option("#show", "removed")
        self.assertEqual(page.locator(".vehicle", has_text="ACC-4").locator(".badge.sold").count(), 1)

    def test_parcours_dans_le_navigateur(self):
        self.creer_lot("ENC-9", make="Audi", model="Q7", reservePriceTnd=101000)
        context = self.browser.new_context(bypass_csp=True, viewport={"width": 390, "height": 844})
        self.addCleanup(context.close)
        page = context.new_page()
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(self.base + "/")
        page.wait_for_function("catalogueEtat === 'ready' && compte.disponible")
        carte = page.locator(".lot-card", has_text="ENC-9")
        self.assertIn("Fin dans", carte.locator(".auction-line").text_content())
        self.assertIn("minimum 100", carte.locator(".bid-now").text_content())
        carte.locator(".bid-now").click()
        page.wait_for_selector("#auction-panel .min-row")
        page.click("[data-offer-login]")
        page.fill("#login-email", "alice@ex.com")
        page.fill("#login-password", MOT_DE_PASSE)
        page.click("#login-form [type=submit]")
        page.wait_for_selector("#auction-panel .bid-form")
        self.assertEqual(page.input_value("#offer-amount"), "100000")
        page.click("[data-step='1000']")
        self.assertEqual(page.input_value("#offer-amount"), "101000")
        self.assertIn("101", page.text_content("#bid-total"))
        page.click("#auction-panel [type=submit]")
        page.wait_for_function("document.querySelector('#auction-panel .current-box strong')?.textContent.includes('101')")
        self.assertIn("Vous êtes le meilleur enchérisseur", page.text_content("#auction-panel"))
        self.assertIn("Réserve atteinte", page.text_content("#auction-panel"))
        self.assertIn("Enchérisseur 1 (vous)", page.text_content(".bid-history"))
        # Bob surenchérit : le panneau d'Alice se met à jour tout seul.
        self.assertEqual(self.encherir("bob", "ENC-9", 102000)[0], 201)
        page.wait_for_function("document.querySelector('#auction-panel .current-box strong')?.textContent.includes('102')", timeout=15000)
        self.assertNotIn("Vous êtes le meilleur enchérisseur", page.text_content("#auction-panel"))
        self.assertEqual(page.input_value("#offer-amount"), "103000")
        # Alice retire sa propre enchère depuis la fiche : le bouton disparaît.
        self.assertIn("Retirer mon enchère de", page.text_content("#auction-panel .withdraw-bid"))
        page.click("#auction-panel .withdraw-bid")
        page.wait_for_selector("#auction-panel .withdraw-bid", state="detached", timeout=15000)
        statut = next(o for o in self.requete("/api/me", cookie=self.cookies["alice@ex.com"])[1]["offers"] if o["reference"] == "ENC-9")
        self.assertEqual(statut["status"], "withdrawn")


if __name__ == "__main__":
    unittest.main()
