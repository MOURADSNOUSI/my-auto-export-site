"""Offres libres : réserve facultative et réception par M&Y sans vendeur."""
import json
import uuid

from playwright.sync_api import expect, sync_playwright

try:
    import test_vendeur as fixtures
except ImportError:
    from tests import test_vendeur as fixtures


class OffresLibresTest(fixtures.SellerFixture):
    ENV_VARS = {"FREE_OFFERS_ENABLED": "true"}

    def vehicle(self, reserve=None, assign=False):
        ref = "FREE-" + uuid.uuid4().hex[:12]
        data = {"make": "Peugeot", "model": "208", "status": "stock"}
        if reserve is not None:
            data["reservePriceTnd"] = reserve
        code, result, _ = self.call("PUT", "/api/admin/vehicles/" + ref, data, "admin")
        self.assertEqual(code, 200, result)
        if assign:
            code, result, _ = self.call("POST", "/api/marketplace/offer-ownership",
                                       {"vehicleId": ref, "sellerId": 1}, "admin")
            self.assertEqual(code, 200, result)
        return ref

    def propose(self, ref, amount=1000, who="other", **extra):
        return self.call("POST", "/api/marketplace/offers", {
            "reference": ref, "amountMinor": amount, "currency": "TND",
            "confirmIntent": True, "rulesVersion": "lot1-draft-1", **extra
        }, who)

    def test_below_reserve_and_seller_acceptance(self):
        ref = self.vehicle(50000, assign=True)
        code, result, _ = self.propose(ref, 1)
        self.assertEqual(code, 201, result)
        code, result, _ = self.call("POST", f"/api/marketplace/offers/{result['id']}/decision",
                                    {"decision": "accept", "revision": 0})
        self.assertEqual(code, 200, result)

    def test_no_reserve_admin_receipt_and_decision(self):
        ref = self.vehicle()
        info = self.call("GET", "/api/marketplace/proposal-vehicles/" + ref, who=None)[1]
        self.assertTrue(info["vehicle"]["active"])
        self.assertTrue(info["rules"]["freeSubmission"])
        code, result, _ = self.propose(ref)
        self.assertEqual(code, 201, result)
        offer_id = result["id"]
        details = self.call("GET", "/api/marketplace/offers/" + offer_id, who="other")[1]["offer"]
        self.assertIsNone(details["seller_id"])
        self.assertIsNone(details["reserve_price_at_submission"])
        self.assertEqual(details["free_submission"], 1)
        notifications = self.call("GET", "/api/marketplace/notifications", who="admin")[1]
        self.assertIn(offer_id, json.dumps(notifications))
        denied = self.call("POST", f"/api/marketplace/offers/{offer_id}/decision",
                           {"decision": "accept", "revision": 0}, "outsider")
        self.assertIn(denied[0], (403, 404))
        code, result, _ = self.call("POST", f"/api/marketplace/offers/{offer_id}/decision",
                                    {"decision": "accept", "revision": 0}, "admin")
        self.assertEqual(code, 200, result)

    def test_validation_authentication_and_legacy_routes_closed(self):
        ref = self.vehicle()
        self.assertEqual(self.propose(ref, who=None)[0], 401)
        for value in (0, -1, 0.5, True, "1000"):
            self.assertEqual(self.propose(ref, value)[0], 400)
        self.assertEqual(self.propose(ref, currency="EUR")[0], 400)
        self.assertEqual(self.call("POST", "/api/offers",
                                  {"reference": ref, "amount": 1000}, "other")[0], 410)

    def test_static_listing_without_owner_or_reserve(self):
        catalogue = self.call("GET", "/api/catalogue", who=None)[1]
        lot = next(item for item in catalogue if not item["reference"].startswith("SV-"))
        code, result, _ = self.propose(lot["reference"])
        self.assertEqual(code, 201, result)
        detail = self.call("GET", "/api/marketplace/offers/" + result["id"], who="other")[1]["offer"]
        self.assertIsNone(detail["seller_id"])

    def test_owner_self_offer_removed_and_suspended_buyer_rejected(self):
        owned = self.vehicle(assign=True)
        self.assertEqual(self.propose(owned, who="seller")[0], 403)
        removed = self.vehicle()
        self.assertEqual(self.call("DELETE", "/api/admin/vehicles/" + removed, who="admin")[0], 200)
        self.assertEqual(self.propose(removed)[0], 409)
        ref = self.vehicle()
        self.sql("INSERT INTO marketplace_suspensions(user_id,reason,at,actor_id) VALUES(4,'test','2026',3)")
        try:
            self.assertIn(self.propose(ref, who="outsider")[0], (403, 409))
        finally:
            self.sql("DELETE FROM marketplace_suspensions WHERE user_id=4")

    def test_admin_cannot_accept_own_offer(self):
        ref = self.vehicle()
        code, result, _ = self.propose(ref, who="admin")
        self.assertEqual(code, 201, result)
        code, result, _ = self.call("POST", f"/api/marketplace/offers/{result['id']}/decision",
                                    {"decision": "accept", "revision": 0}, "admin")
        self.assertEqual(code, 403, result)

    def test_mobile_submission_then_admin_rejection(self):
        ref = self.vehicle(50000)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(viewport={"width": 390, "height": 844})
            context.add_cookies([{"name": "my_session", "value": self.tokens["other"], "url": self.base}])
            page = context.new_page()
            page.goto(self.base + "/")
            page.locator(f'[data-proposal-ref="{ref}"]').first.click()
            page.wait_for_selector("#proposal-form")
            page.locator("#proposal-amount").fill("1")
            page.locator('[name="intention"]').check()
            page.locator("#proposal-send").click()
            page.wait_for_selector(".proposal-success")
            self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 390)
            offers = self.call("GET", "/api/marketplace/offers?side=admin", who="admin")[1]["offers"]
            offer = next(o for o in offers if o["vehicle_id"] == ref)
            context.clear_cookies()
            context.add_cookies([{"name": "my_session", "value": self.tokens["admin"], "url": self.base}])
            page.goto(self.base + "/vendeur/offres?administration=1")
            page.locator(f'[data-id="{offer["id"]}"][data-decision="reject"]').click()
            page.locator('[name="reason"]').fill("Proposition trop basse.")
            page.locator("#offer-action button").click()
            expect(page.locator("#status")).to_contain_text("refusée")
            browser.close()
