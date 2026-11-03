"""Lot 1 : seuil officiel D1, annonces importées, droits, statuts et fenêtre responsive."""
import json
import uuid
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
import test_vendeur as fixtures

ERROR='Votre offre doit être supérieure ou égale au prix de réserve de ce véhicule.'

class Lot1PropositionsTest(fixtures.SellerFixture):
    def vehicle(self,reserve=50000,**extra):
        ref='LOT1-'+uuid.uuid4().hex[:12]
        data={'make':'Peugeot','model':'208','status':'stock','reservePriceTnd':reserve,'indicativePriceTnd':65000,'year':2021,'mileageKm':50000,'fuel':'Essence','photos':[],**extra}
        code,p,_=self.call('PUT','/api/admin/vehicles/'+ref,data,'admin');self.assertEqual(code,200,p);saved=p['vehicle']
        code,p,_=self.call('POST','/api/marketplace/offer-ownership',{'vehicleId':ref,'sellerId':1},'admin');self.assertEqual(code,200,p)
        return ref,saved

    def propose(self,ref,amount=50000000,who='other',**extra):
        return self.call('POST','/api/marketplace/offers',{'reference':ref,'amountMinor':amount,'currency':'TND','rulesVersion':'lot1-draft-1','confirmIntent':True,**extra},who)

    def test_equal_above_and_reserve_snapshot_are_exact(self):
        ref,_=self.vehicle();message='Bonjour, disponible samedi ? <img src=x onerror=alert(1)>'
        code,p,_=self.propose(ref,buyerMessage=message,reservePriceMinor=1,sellerId=999)
        self.assertEqual(code,201,p);detail=self.call('GET','/api/marketplace/offers/'+p['id'],who='other')[1]['offer']
        self.assertEqual(detail['reserve_price_at_submission'],50000000);self.assertEqual(detail['amount_minor'],50000000);self.assertEqual(detail['seller_id'],1);self.assertEqual(detail['buyer_message'],message);self.assertEqual(detail['status'],'pending')
        self.assertEqual(self.propose(ref,50000001,'outsider')[0],201)
        public=json.dumps(self.call('GET','/api/catalogue',who=None)[1]);self.assertNotIn(message,public);self.assertNotIn('buyer_message',public)

    def test_below_floor_rejected_even_with_fake_client_reserve(self):
        ref,_=self.vehicle();code,p,_=self.propose(ref,49999999,reservePriceTnd=1,reservePriceAtSubmission=1)
        self.assertEqual(code,400,p);self.assertEqual(p['error'],ERROR)
        for value in [None,0,-1,'not numeric',True,50000000.5]:
            with self.subTest(value=value):self.assertEqual(self.propose(ref,value)[0],400)
        self.assertEqual(self.propose(ref,currency='EUR')[0],400)
        self.assertFalse(any(o['vehicle_id']==ref for o in self.call('GET','/api/marketplace/offers',who='other')[1]['offers']))

    def test_authentication_inactive_and_other_sellers(self):
        ref,_=self.vehicle();self.assertEqual(self.propose(ref,who=None)[0],401)
        self.assertEqual(self.propose(ref,who='seller')[0],403)
        code,p,_=self.propose(ref);self.assertEqual(code,201,p);oid=p['id']
        self.assertEqual(self.call('GET','/api/marketplace/offers/'+oid,who='outsider')[0],404)
        self.assertEqual(self.call('POST','/api/marketplace/offers/'+oid+'/decision',{'decision':'accept','revision':0},'outsider')[0],404)
        self.assertNotIn(oid,[o['id'] for o in self.call('GET','/api/marketplace/offers?side=seller',who='other')[1]['offers']])
        self.assertEqual(self.call('POST','/api/marketplace/offer-ownership',{'vehicleId':ref,'sellerId':2},'other')[0],403)
        self.call('DELETE','/api/admin/vehicles/'+ref,who='admin');self.assertEqual(self.propose(ref,who='outsider')[0],409)

    def test_manual_decisions_notifications_and_no_automatic_sale(self):
        ref,_=self.vehicle();code,p,_=self.propose(ref);self.assertEqual(code,201,p);oid=p['id'];path='/api/marketplace/offers/'+oid
        self.assertTrue(any(n['resource_id']==oid and n['event_code']=='offer.pending' for n in self.call('GET','/api/marketplace/notifications')[1]['notifications']))
        self.assertEqual(self.call('POST',path+'/decision',{'decision':'accept','revision':0})[0],200)
        self.assertEqual(self.call('GET',path)[1]['offer']['status'],'accepted')
        self.assertTrue(any(n['resource_id']==oid and n['event_code']=='offer.accepted' for n in self.call('GET','/api/marketplace/notifications',who='other')[1]['notifications']))
        self.assertEqual([e['to_status'] for e in self.call('GET',path)[1]['events']],['pending','accepted'])
        self.assertIn(ref,[v['reference'] for v in self.call('GET','/api/catalogue',who=None)[1]])
        self.assertFalse(self.call('GET','/api/me',who='other')[1]['vehicles']);self.assertFalse(self.call('GET','/api/me',who='other')[1]['invoices'])
        self.assertEqual(self.call('POST',path+'/cancel',{},'other')[0],409)
        other,_=self.vehicle();_,p,_=self.propose(other);path='/api/marketplace/offers/'+p['id']
        self.assertEqual(self.call('POST',path+'/decision',{'decision':'reject','reason':'Proposition non retenue','revision':0})[0],200)
        self.assertEqual(self.call('GET',path)[1]['offer']['status'],'rejected')
        self.assertTrue(any(n['resource_id']==p['id'] and n['event_code']=='offer.rejected' for n in self.call('GET','/api/marketplace/notifications',who='other')[1]['notifications']))

    def test_cancel_expire_and_updated_official_reserve(self):
        ref,data=self.vehicle();_,p,_=self.propose(ref);oid=p['id'];path='/api/marketplace/offers/'+oid
        self.call('PUT','/api/admin/vehicles/'+ref,{**data,'reservePriceTnd':60000},'admin')
        self.assertEqual(self.call('GET',path,who='other')[1]['offer']['reserve_price_at_submission'],50000000)
        self.assertEqual(self.call('POST',path+'/decision',{'decision':'accept','revision':0})[0],409)
        self.assertEqual(self.call('POST',path+'/cancel',{},'other')[0],200)
        self.assertEqual(self.call('GET',path,who='other')[1]['offer']['status'],'cancelled')
        code,p,_=self.propose(ref,60000000);self.assertEqual(code,201,p)
        self.sql(f"UPDATE vehicle_offers SET expires_at='2000-01-01T00:00:00Z' WHERE id='{p['id']}'")
        detail=self.call('GET','/api/marketplace/offers/'+p['id'],who='other')[1]
        self.assertEqual(detail['offer']['status'],'expired');self.assertEqual(detail['events'][-1]['to_status'],'expired')

    def test_private_minimum_is_not_the_public_reserve(self):
        s=self.published();ref='SV-'+s['id'];lot=next(l for l in self.call('GET','/api/catalogue',who=None)[1] if l['reference']==ref)
        self.assertEqual(lot['reservePriceMinor'],60000000);self.assertNotIn('minimum',json.dumps(lot))
        self.assertEqual(s['data']['minimumAmount'],'55000.000')
        code,p,_=self.propose(ref,59000000);self.assertEqual(code,400);self.assertEqual(p['error'],ERROR)
        self.assertEqual(self.propose(ref,60000000)[0],201)

    def test_eur_reserve_and_offer_use_cents_without_conversion(self):
        s=self.draft(True);d={**s['data'],'priceCurrency':'EUR','priceAmount':'20000.00','publicReserveAmount':'12345.67','minimumAmount':'12000.01'}
        code,p,_=self.call('PUT','/api/seller/submissions/'+s['id'],{'revision':s['revision'],'data':d});self.assertEqual(code,200,p)
        code,p,_=self.review(self.submit(p['submission']));self.assertEqual(code,200,p);ref='SV-'+s['id']
        code,p,_=self.propose(ref,1234566,currency='EUR');self.assertEqual(code,400);self.assertEqual(p['error'],ERROR)
        code,p,_=self.propose(ref,1234567,currency='EUR');self.assertEqual(code,201,p)
        detail=self.call('GET','/api/marketplace/offers/'+p['id'],who='other')[1]['offer'];self.assertEqual(detail['currency'],'EUR');self.assertEqual(detail['reserve_price_at_submission'],1234567)
        self.assertEqual(self.propose(ref,1234567,'outsider',currency='TND')[0],400)

    def test_repetitive_submissions_are_limited(self):
        ref,_=self.vehicle();self.assertEqual(self.propose(ref)[0],201)
        for _ in range(9):self.assertEqual(self.propose(ref)[0],409)
        self.assertEqual(self.propose(ref)[0],429)

    def test_auctions_disabled_and_existing_vehicle_data_preserved(self):
        ref,data=self.vehicle(status='open',endsAt='2000-01-01T00:00:00Z',bodyType='SUV',photos=[{'url':'https://example.test/photo.jpg','authorized':False}])
        lot=next(l for l in self.call('GET','/api/catalogue',who=None)[1] if l['reference']==ref)
        self.assertTrue(lot['proposalMode']);self.assertNotIn('auction',lot);self.assertNotIn('endsAt',lot);self.assertEqual(lot['bodyType'],'SUV');self.assertEqual(lot['photos'],data['photos']);self.assertEqual(lot['reservePriceTnd'],50000)
        self.assertEqual(self.call('POST','/api/offers',{'reference':ref,'kind':'bid','amount':90000},'other')[0],410)
        self.assertEqual(self.call('GET','/api/auctions/'+ref,who=None)[0],410)
        self.assertEqual(self.call('GET','/api/admin/auctions/'+ref,who='admin')[0],410)
        self.assertEqual(self.call('POST','/api/admin/offers/1/accept',{},'admin')[0],410)
        self.assertEqual(self.propose(ref)[0],201)
        old='OLD-'+uuid.uuid4().hex[:12]
        self.call('PUT','/api/admin/vehicles/'+old,{'make':'BMW','model':'320','status':'open','endsAt':'2000-01-01T00:00:00Z','reservePriceTnd':10000,'photos':[]},'admin')
        self.assertNotIn(old,[l['reference'] for l in self.call('GET','/api/catalogue',who=None)[1]])
        empty,_=self.vehicle(reserve=None)
        lookup=self.call('GET','/api/marketplace/proposal-vehicles/'+empty,who=None)[1]['vehicle']
        self.assertEqual(lookup['currency'],'TND');self.assertFalse(lookup['active']);self.assertNotIn('reserveMinor',lookup)
        self.assertEqual(self.propose(empty,65000000)[0],409)

    def test_popup_desktop_tablet_mobile_and_below_floor_feedback(self):
        with sync_playwright() as pw,pw.chromium.launch(headless=True) as browser:
            for width,height in [(1440,900),(820,1100),(390,844)]:
                ref,_=self.vehicle()
                with self.subTest(width=width),browser.new_context(viewport={'width':width,'height':height}) as context:
                    context.add_cookies([{'name':'my_session','value':self.tokens['other'],'url':self.base}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                    page.goto(self.base+'/vehicules/'+ref);page.get_by_role('button',name='Proposer une offre',exact=True).click();popup=page.locator('#proposal-dialog');expect(popup).to_contain_text(ref);expect(popup).to_contain_text('Prix de réserve')
                    popup.locator('[name=amount]').fill('49999.999');popup.locator('[name=intention]').check();popup.get_by_role('button',name='Envoyer ma proposition').click();expect(popup.locator('.proposal-error')).to_have_text(ERROR)
                    self.assertLessEqual(popup.bounding_box()['width'],width-16);self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),width)
                    popup.locator('[name=amount]').fill('50000.000');popup.locator('[name=message]').fill('Visite possible samedi.');popup.get_by_role('button',name='Envoyer ma proposition').click();expect(popup).to_contain_text('Votre proposition a été envoyée')
                    self.assertFalse(errors,errors)

    def test_button_in_card_and_existing_detail_window(self):
        ref,_=self.vehicle()
        with sync_playwright() as pw,pw.chromium.launch(headless=True) as browser:
            page=browser.new_page();page.goto(self.base+'/');card=page.locator('.lot-card').filter(has_text=ref);expect(card.get_by_role('button',name='Proposer une offre')).to_be_visible()
            self.assertEqual(page.locator('[data-nav=auction]').get_attribute('aria-disabled'),'true');self.assertEqual(page.locator('[data-bid-open]').count(),0)
            card.get_by_role('button',name='Voir la fiche',exact=True).click();detail=page.locator('#lot-dialog');expect(detail.get_by_role('button',name='Proposer une offre')).to_be_visible();detail.get_by_role('button',name='Proposer une offre').click();expect(page.locator('#proposal-dialog')).to_contain_text('Connectez-vous')

    def test_missing_reserve_keeps_amount_and_message_editable_in_nested_dialog(self):
        ref,_=self.vehicle(reserve=None)
        with sync_playwright() as pw,pw.chromium.launch(headless=True) as browser:
            for width,height in [(1440,1100),(390,844)]:
                with self.subTest(width=width),browser.new_context(viewport={'width':width,'height':height}) as context:
                    context.add_cookies([{'name':'my_session','value':self.tokens['other'],'url':self.base}]);page=context.new_page();sent=[]
                    page.on('request',lambda r:sent.append(r.url) if r.method=='POST' and r.url.endswith('/api/marketplace/offers') else None)
                    page.goto(self.base+'/');card=page.locator('.lot-card').filter(has_text=ref);card.get_by_role('button',name='Voir la fiche',exact=True).click()
                    page.locator('#lot-dialog').get_by_role('button',name='Proposer une offre',exact=True).click();popup=page.locator('#proposal-dialog')
                    field=popup.locator('[name=amount]');message=popup.locator('[name=message]');expect(field).to_be_editable();expect(message).to_be_editable()
                    field.click();field.press_sequentially('50000.000');message.click();message.press_sequentially('Bonjour, visite possible samedi ?')
                    expect(field).to_have_value('50000.000');expect(message).to_have_value('Bonjour, visite possible samedi ?')
                    expect(popup.locator('.proposal-unavailable')).to_contain_text('Vous pouvez renseigner votre montant et votre message')
                    expect(popup.locator('#proposal-send')).to_be_disabled()
                    popup.locator('[name=intention]').check()
                    # Une soumission forcée côté navigateur reste refusée sans appel API.
                    popup.locator('#proposal-form').evaluate("f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
                    expect(popup.locator('.proposal-error')).to_contain_text('L’envoi reste indisponible')
                    self.assertFalse(sent);self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),width)
        self.assertEqual(self.propose(ref,50000000)[0],409)

    def test_typing_before_login_preserves_amount_and_message(self):
        ref,_=self.vehicle(reserve=None);email=uuid.uuid4().hex+'@example.test';password='LocalFormTest42!'
        self.assertEqual(self.call('POST','/api/register',{'name':'Test saisie','email':email,'phone':'12345678','password':password},who=None)[0],201)
        with sync_playwright() as pw,pw.chromium.launch(headless=True) as browser:
            page=browser.new_page();page.goto(self.base+'/vehicules/'+ref);page.get_by_role('button',name='Proposer une offre',exact=True).click();popup=page.locator('#proposal-dialog')
            popup.locator('[name=amount]').fill('52000.125');popup.locator('[name=message]').fill('Je souhaite des précisions.')
            login=popup.locator('#proposal-login');login.locator('[name=email]').fill(email);login.locator('[name=password]').fill(password);login.get_by_role('button',name='Se connecter',exact=True).click()
            expect(popup.locator('#proposal-auth')).to_be_hidden()
            expect(popup.locator('[name=amount]')).to_have_value('52000.125');expect(popup.locator('[name=message]')).to_have_value('Je souhaite des précisions.')
            expect(popup.locator('#proposal-send')).to_be_disabled()
