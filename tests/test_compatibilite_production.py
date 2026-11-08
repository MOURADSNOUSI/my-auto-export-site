"""Préservation locale des URLs, réserves, protections et dépôts déjà en production."""
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
import uuid
from playwright.sync_api import sync_playwright, expect
try:
    import test_vendeur as fixtures
except ImportError:
    import tests.test_vendeur as fixtures


class ProductionCompatibilityTest(fixtures.SellerFixture):
    ENV_VARS = {'STRIPE_WEBHOOK_SECRET': 'whsec_test_fixture_only'}

    def vehicle(self, **extra):
        ref = 'DEPLOY-' + uuid.uuid4().hex[:12]
        data = {'make': 'Citroën', 'model': 'C5', 'year': 2021, 'status': 'stock',
                'indicativePriceTnd': 65000, 'reservePriceTnd': 50000, 'photos': [], **extra}
        code, payload, _ = self.call('PUT', '/api/admin/vehicles/' + ref, data, 'admin')
        self.assertEqual(code, 200, payload)
        return ref, '/vehicule/citroen-c5-2021-' + ref.lower()

    def test_canonical_pages_and_home_links_keep_the_offer_form(self):
        ref, path = self.vehicle()
        code, html, _ = self.call('GET', path, who=None)
        self.assertEqual(code, 200)
        self.assertIn(('https://www.myautoexport.com'+path).encode(), html)
        self.assertIn(b'data-proposal-ref="'+ref.encode(), html)
        self.assertIn(b'Prix de r\xc3\xa9serve', html)
        # Liens vers les fiches lisibles sans JavaScript sur /vehicules (l'accueil n'a plus de liste).
        self.assertIn(path.encode(), self.call('GET', '/vehicules', who=None)[1])
        self.assertIn(path.encode(), self.call('GET', '/sitemap.xml', who=None)[1])
        self.assertEqual(self.call('GET', '/vehicule/ancienne-adresse-'+ref.lower(), who=None)[0], 200)
        for width in [1440, 390]:
            with self.subTest(width=width), sync_playwright() as pw, pw.chromium.launch() as browser:
                page = browser.new_page(viewport={'width': width, 'height': 1000})
                errors=[]
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(self.base+path)
                page.get_by_role('button', name='Proposer une offre', exact=True).click()
                popup=page.locator('#proposal-dialog')
                expect(popup.locator('[name=amount]')).to_be_editable()
                expect(popup.locator('[name=message]')).to_be_editable()
                self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),width)
                self.assertFalse(errors,errors)
        self.call('DELETE', '/api/admin/vehicles/'+ref, who='admin')
        self.assertEqual(self.call('GET',path,who=None)[0],410)
        self.assertNotIn(path.encode(),self.call('GET','/sitemap.xml',who=None)[1])

    def test_eur_seller_price_diagnostic_and_private_minimum(self):
        s=self.draft(True)
        data={**s['data'],'priceCurrency':'EUR','priceAmount':'20000.00','publicReserveAmount':'12345.67','minimumAmount':'12000.01'}
        s=self.call('PUT','/api/seller/submissions/'+s['id'],{'revision':s['revision'],'data':data})[1]['submission']
        code,payload,_=self.review(self.submit(s));self.assertEqual(code,200,payload);s=payload['submission']
        html=self.call('GET','/vehicule/SV-'+s['id'],who=None)[1].decode()
        self.assertIn('20\u202f000,00',html)
        self.assertIn('12\u202f345,67',html)
        self.assertNotIn('12\u202f000,01',html)
        self.assertIn('Diagnostic vérifié par M&amp;Y AUTO EXPORT',html)
        self.assertIn('"priceCurrency":"EUR"',html)
        self.assertIn('/seller-media/',html)

    def webhook(self, event, valid=True):
        body=json.dumps(event).encode();timestamp=str(int(time.time()))
        digest=hmac.new(self.ENV_VARS['STRIPE_WEBHOOK_SECRET'].encode(),timestamp.encode()+b'.'+body,hashlib.sha256).hexdigest()
        req=urllib.request.Request(self.base+'/api/stripe/webhook',data=body,headers={
            'Content-Type':'application/json','Stripe-Signature':f't={timestamp},v1={digest if valid else "0"*64}'},method='POST')
        try: response=urllib.request.urlopen(req)
        except urllib.error.HTTPError as e: response=e
        with response: return response.status,json.loads(response.read())

    def test_legacy_webhook_keeps_balance_and_is_idempotent_without_new_payments(self):
        session='cs_test_'+uuid.uuid4().hex
        self.sql("UPDATE users SET deposit_tnd=1500 WHERE id=2; INSERT INTO deposits(user_id,method,amount_tnd,status,stripe_session_id,charge_amount,charge_currency) VALUES(2,'card',500,'pending','"+session+"',14706,'eur')")
        event={'type':'checkout.session.completed','data':{'object':{'object':'checkout.session','id':session,'payment_status':'paid','amount_total':14706,'currency':'eur'}}}
        self.assertEqual(self.webhook(event,valid=False)[0],400)
        self.assertEqual(self.call('GET','/api/me',who='other')[1]['user']['depositTnd'],1500)
        mismatch=json.loads(json.dumps(event));mismatch['data']['object']['amount_total']=1
        self.assertEqual(self.webhook(mismatch)[0],200)
        self.assertEqual(self.call('GET','/api/me',who='other')[1]['user']['depositTnd'],1500)
        self.assertEqual(self.webhook(event)[0],200)
        self.assertEqual(self.webhook(event)[0],200)
        self.assertEqual(self.call('GET','/api/me',who='other')[1]['user']['depositTnd'],2000)
        for path in ['/api/deposit/card','/api/deposit/transfer']:
            self.assertEqual(self.call('POST',path,{},'other')[0],410)
        with sync_playwright() as pw, pw.chromium.launch() as browser:
            context=browser.new_context();context.add_cookies([{'name':'my_session','value':self.tokens['other'],'url':self.base}])
            page=context.new_page();page.goto(self.base+'/');page.locator('#account-button').click()
            expect(page.locator('.deposit-history')).to_contain_text('2\u202f000')
            self.assertEqual(page.locator('[data-deposit-card]').count(),0)

    def test_withdrawn_historical_offer_remains_withdrawn(self):
        self.sql("INSERT INTO offers(user_id,reference,amount_tnd,kind,status,withdrawn_at) VALUES(2,'OLD-REF',10000,'bid','refused','2026-01-01T00:00:00Z')")
        me=self.call('GET','/api/me',who='other')[1]
        self.assertEqual(next(o for o in me['offers'] if o['reference']=='OLD-REF')['status'],'withdrawn')
