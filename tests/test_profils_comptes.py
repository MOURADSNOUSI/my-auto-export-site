"""Connexion commune et habilitations Acheteur/Vendeur indépendantes."""
import uuid

from playwright.sync_api import expect, sync_playwright

try:
    import test_vendeur as fixtures
except ImportError:
    from tests import test_vendeur as fixtures


class ProfilsComptesTest(fixtures.SellerFixture):
    ENV_VARS = {"FREE_OFFERS_ENABLED": "true"}

    def setUp(self):
        super().setUp()
        self.sql("DELETE FROM registrations")

    def account(self, kind):
        body = {"name": "Profil Test", "email": uuid.uuid4().hex + "@example.test",
                "password": "ProfilTest42!", "accountType": kind}
        code, result, headers = self.call("POST", "/api/register", body, who=None)
        self.assertEqual(code, 201, result)
        label = "account-" + uuid.uuid4().hex
        self.tokens[label] = headers["Set-Cookie"].split(";", 1)[0].split("=", 1)[1]
        return label, result["user"], body

    def test_registration_choices_login_and_unique_identity(self):
        for kind, expected in (("buyer", {"buyer": True, "seller": False}),
                               ("seller", {"buyer": False, "seller": True}),
                               ("both", {"buyer": True, "seller": True})):
            who, user, credentials = self.account(kind)
            self.assertEqual(user["profiles"], expected)
            self.assertEqual(self.call("GET", "/api/me", who=who)[1]["user"]["profiles"], expected)
            code, result, _ = self.call("POST", "/api/login", credentials, who=None)
            self.assertEqual(code, 200, result)
            self.assertEqual(result["user"]["id"], user["id"])
            self.assertEqual(result["user"]["profiles"], expected)
            credentials["accountType"] = "both"
            self.assertEqual(self.call("POST", "/api/register", credentials, who=None)[0], 409)

    def test_activation_keeps_identity_and_other_profile(self):
        who, user, _ = self.account("seller")
        for _ in range(2):
            code, result, _ = self.call("POST", "/api/account/profiles",
                                       {"profile": "buyer", "userId": 4, "role": "admin"}, who)
            self.assertEqual(code, 200, result)
            self.assertEqual(result["user"]["id"], user["id"])
            self.assertEqual(result["user"]["profiles"], {"buyer": True, "seller": True})
            self.assertEqual(result["user"]["role"], "buyer")
        self.assertEqual(self.call("POST", "/api/account/profiles", {"profile": "admin"}, who)[0], 400)
        self.assertEqual(self.call("POST", "/api/account/profiles", {"profile": "buyer"}, None)[0], 401)

    def test_buyer_cannot_access_seller_workspace_until_activation(self):
        who, user, _ = self.account("buyer")
        self.assertEqual(self.call("GET", "/api/seller/submissions", who=who)[0], 403)
        self.assertEqual(self.call("GET", "/api/marketplace/offers?side=seller", who=who)[0], 403)
        code, result, _ = self.call("POST", "/api/account/profiles", {"profile": "seller"}, who)
        self.assertEqual(code, 200, result)
        self.assertEqual(result["user"]["id"], user["id"])
        self.assertTrue(result["user"]["profiles"]["buyer"])
        self.assertEqual(self.call("GET", "/api/seller/submissions", who=who)[1]["submissions"], [])
        self.assertEqual(self.call("POST", "/api/seller/submissions", {}, who)[0], 400,
                         "L'activation ne remplace pas le profil vendeur complet.")

    def test_seller_cannot_buy_until_buyer_activation(self):
        who, _, _ = self.account("seller")
        self.assertEqual(self.call("GET", "/api/marketplace/offers?side=buyer", who=who)[0], 403)
        self.assertEqual(self.call("POST", "/api/marketplace/offers", {}, who)[0], 403)
        self.assertEqual(self.call("PUT", "/api/favorites/MY-0001", {}, who)[0], 403)
        self.assertEqual(self.call("POST", "/api/account/profiles", {"profile": "buyer"}, who)[0], 200)
        self.assertEqual(self.call("GET", "/api/marketplace/offers?side=buyer", who=who)[0], 200)
        self.assertEqual(self.call("POST", "/api/marketplace/offers", {}, who)[0], 400)

    def test_identity_common_but_seller_details_do_not_overwrite_it(self):
        code, user, _ = self.call("GET", "/api/me")
        self.assertEqual(code, 200)
        before = user["user"]
        details = {"name": "Société Vendeur", "phone": "99999999", "address": "Adresse vendeur",
                   "sellerType": "professional", "professionalNumber": "PRO-42"}
        self.assertEqual(self.call("PUT", "/api/seller/profile", details)[0], 200)
        after = self.call("GET", "/api/me")[1]["user"]
        for key in ("id", "email", "name", "phone"):
            self.assertEqual(after[key], before[key])
        seller = self.call("GET", "/api/seller/profile")[1]["profile"]
        self.assertEqual(seller["name"], details["name"])
        self.assertTrue(after["profiles"]["buyer"])
        self.assertTrue(after["profiles"]["seller"])

    def test_mobile_activation_and_separate_workspaces(self):
        who, _, _ = self.account("buyer")
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                context = browser.new_context(viewport={"width": 390, "height": 844})
                context.add_cookies([{"name": "my_session", "value": self.tokens[who], "url": self.base}])
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(self.base + "/?espace=acheteur")
                page.locator('#account-body [data-enable-profile="seller"]').click()
                page.wait_for_url("**/mes-vehicules")
                expect(page.locator("#profile-section")).to_be_visible()
                expect(page.locator("#workspace")).to_be_visible()
                expect(page.locator("#activate-seller")).to_be_hidden()
                page.get_by_role("link", name="Espace Acheteur", exact=True).first.click()
                expect(page.locator("#account-body")).to_contain_text("Mes propositions d'achat")
                expect(page.locator('#account-body a[href="/mes-vehicules"]')).to_be_visible()
                self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 390)
                self.assertEqual(errors, [])
            finally:
                browser.close()

    def test_seller_offer_popup_requires_explicit_buyer_activation(self):
        who, _, _ = self.account("seller")
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                context = browser.new_context(viewport={"width": 390, "height": 844})
                context.add_cookies([{"name": "my_session", "value": self.tokens[who], "url": self.base}])
                page = context.new_page()
                page.goto(self.base + "/")
                page.locator("[data-proposal-ref]").first.click()
                expect(page.locator("#proposal-send")).to_be_disabled()
                page.locator("#proposal-enable-buyer").click()
                expect(page.locator("#proposal-send")).to_be_enabled()
                expect(page.locator("#proposal-enable-buyer")).to_have_count(0)
                expect(page.locator("#account-label")).to_contain_text("Acheteur · Vendeur")
                user = self.call("GET", "/api/me", who=who)[1]["user"]
                self.assertEqual(user["profiles"], {"buyer": True, "seller": True})
            finally:
                browser.close()

    def test_registration_profile_choices_on_both_entry_points(self):
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page(viewport={"width": 390, "height": 844})
                page.goto(self.base + "/")
                page.locator("#account-button").click()
                page.locator('[data-auth="register"]').click()
                expect(page.locator("#register-account-type")).to_have_value("buyer")
                page.locator("#register-account-type").select_option("both")
                expect(page.locator("#register-account-type")).to_have_value("both")
                page.goto(self.base + "/vendre")
                expect(page.locator('#register-form [name="accountType"]')).to_have_value("seller")
                self.assertEqual(page.locator('#register-form [name="accountType"] option').count(), 3)
                # Connexion en étapes : « Bonjour ! », puis connexion ou inscription.
                expect(page.locator("#auth-accueil")).to_contain_text("Connectez-vous ou créez un compte pour déposer votre annonce.")
                expect(page.locator("#login-form")).to_be_hidden()
                page.get_by_role("button", name="Me connecter").click()
                expect(page.locator("#login-form")).to_be_visible()
                expect(page.locator("#auth-accueil")).to_be_hidden()
                page.locator("#auth-login").get_by_role("button", name="Créer un compte").click()
                expect(page.locator("#register-form")).to_be_visible()
                page.get_by_role("button", name="J'ai déjà un compte").click()
                expect(page.locator("#login-form")).to_be_visible()
                self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 390)
                page.goto(self.base + "/vendre?etape=register")
                expect(page.locator("#register-form")).to_be_visible()
            finally:
                browser.close()
