"""Parcours vendeur contre Worker, D1 et R2 locaux, sans données de production.
WRANGLER=/chemin/vers/wrangler python -m unittest discover -s tests -p test_vendeur.py
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
WRANGLER = os.environ.get('WRANGLER')
PDF = b'%PDF-1.4\nRapport de test\n%%EOF'
PNG = (ROOT / 'my-auto-export/logo.png').read_bytes()
PHOTO_KINDS = ['front','rear','left','right','interior','dashboard','engine','trunk','defects']
KINDS = PHOTO_KINDS + ['registration','ownership','diagnostic']


@unittest.skipUnless(WRANGLER, 'définir WRANGLER pour les tests Worker locaux')
class SellerFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.config = Path(cls.tmp.name) / 'wrangler.json'
        cls.config.write_text(json.dumps({
            'name':'seller-test','compatibility_date':'2026-10-01','vars':{'LEGACY_AUCTIONS_ENABLED':'false',**getattr(cls,'ENV_VARS',{})},
            'main':str(ROOT/'worker/main.js'),
            'assets':{'directory':str(ROOT/'my-auto-export'),'binding':'ASSETS','run_worker_first':True},
            'd1_databases':[{'binding':'DB','database_name':'seller-test','database_id':str(uuid.uuid4()),'migrations_dir':str(ROOT/'migrations')}],
            'r2_buckets':[{'binding':'SELLER_DOCUMENTS','bucket_name':'seller-private-test'}],
        }))
        cls.persist = str(Path(cls.tmp.name)/'state')
        cls.sql_command('migrations','apply','DB','--local')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
        cls.base = f'http://localhost:{port}'
        cls.log = open(Path(cls.tmp.name)/'worker.log','w+')
        cls.addClassCleanup(cls.log.close)
        cls.server = subprocess.Popen([WRANGLER,'dev','--local','--port',str(port),'--persist-to',cls.persist,'-c',str(cls.config)],cwd=ROOT,stdout=cls.log,stderr=cls.log)
        cls.addClassCleanup(cls.stop)
        for _ in range(90):
            try:
                urllib.request.urlopen(cls.base+'/vendre.html',timeout=1); break
            except OSError:
                if cls.server.poll() is not None: break
                time.sleep(.5)
        else:
            raise RuntimeError('Worker non démarré')
        if cls.server.poll() is not None:
            cls.log.seek(0); raise RuntimeError(cls.log.read())
        cls.tokens = {}
        # Sessions déterministes de test : les routes vérifient réellement les cookies et les rôles en base.
        for i, name in enumerate(['seller','other','admin','outsider'],1):
            token = hashlib.sha256(name.encode()).hexdigest(); cls.tokens[name]=token
            cls.sql(f"INSERT INTO users(id,email,name,phone,password_hash,password_salt,role) VALUES({i},'{name}@example.test','{name}','12345678','unused','00','{'admin' if name=='admin' else 'buyer'}'); INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('{hashlib.sha256(token.encode()).hexdigest()}',{i},'2099-01-01T00:00:00Z')")
        cls.garage = cls.call('POST','/api/admin/seller/garages',{'name':'Garage partenaire','address':'Tunis','contact':'contact@example.test','professionalNumber':'GAR-001','validUntil':'2099-12-31'},'admin')[1]['garage']['id']
        for name in ['seller','other']:
            cls.call('PUT','/api/seller/profile',{'name':name,'phone':'12345678','address':'Adresse privée Tunis'},name)

    def setUp(self):
        for purpose in ['seller_terms','privacy_notice']:
            self.call('POST','/api/marketplace/consents',{'purpose':purpose,'version':'lot1-draft-1','confirmed':True})
        self.sql('DELETE FROM seller_upload_attempts; DELETE FROM marketplace_api_attempts')

    @classmethod
    def stop(cls):
        cls.server.terminate()
        try: cls.server.wait(timeout=15)
        except subprocess.TimeoutExpired: cls.server.kill(); cls.server.wait()

    @classmethod
    def sql_command(cls,*args):
        p=subprocess.run([WRANGLER,'d1',*args,'--persist-to',cls.persist,'-c',str(cls.config)],cwd=ROOT,capture_output=True,text=True)
        if p.returncode: raise RuntimeError(p.stdout+p.stderr)
        return p.stdout

    @classmethod
    def sql(cls,command):
        return cls.sql_command('execute','DB','--local','--command',command)

    @classmethod
    def call(cls,method,path,data=None,who='seller',content_type=None,origin=None):
        headers={}
        if who: headers['Cookie']='my_session='+cls.tokens[who]
        if method not in ['GET','HEAD']: headers['Origin']=origin or cls.base
        if data is not None:
            if isinstance(data,bytes): body=data; headers['Content-Type']=content_type or 'application/pdf'
            else: body=json.dumps(data).encode(); headers['Content-Type']='application/json'
        else: body=None
        req=urllib.request.Request(cls.base+path,data=body,method=method,headers=headers)
        try: response=urllib.request.urlopen(req,timeout=20)
        except urllib.error.HTTPError as e: response=e
        raw=response.read(); ct=response.headers.get('Content-Type',''); response.close()
        payload=json.loads(raw) if 'application/json' in ct else raw
        return response.status,payload,response.headers

    def draft(self,complete=False,sale_type='sale'):
        code,p,_=self.call('POST','/api/seller/submissions',{})
        self.assertEqual(code,201,p); s=p['submission']
        if complete:
            self.sql('DELETE FROM seller_upload_attempts; DELETE FROM marketplace_api_attempts')
            data={'make':'Peugeot','model':'208','year':2021,'mileageKm':50000,'fuel':'Essence','vin':'VF3CAHMRPKS123456','location':'Tunis','originCountry':'FR','licensePlate':'AA-123-BB','firstRegistrationDate':'2021-04-18','priceAmount':'65000.000','priceCurrency':'TND','minimumAmount':'55000.000','publicReserveAmount':'60000.000','allowOffers':True,'diagnosticValidUntil':'2099-01-01','saleType':sale_type,'garageId':self.garage,'diagnosticDate':datetime.now(timezone.utc).date().isoformat(),'observations':{k:'Contrôlé sans anomalie' for k in ['engine','transmission','brakes','suspension','steering','electronics','battery','body','tyres','defects']}}
            data['vin']='VF3'+uuid.uuid4().hex[:14].upper()
            data.update(diagnosticReference='R-'+s['id'],diagnosticVin=data['vin'],diagnosticMileageKm=50000)
            if sale_type=='auction': data.update(auctionStart=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat(),auctionEnd=(datetime.now(timezone.utc)+timedelta(days=3)).isoformat())
            s=self.call('PUT',f"/api/seller/submissions/{s['id']}",{'revision':s['revision'],'data':data})[1]['submission']
            for kind in KINDS:
                code,p,_=self.call('POST',f"/api/seller/submissions/{s['id']}/files?kind={kind}",PDF if kind=='diagnostic' else PNG,content_type='application/pdf' if kind=='diagnostic' else 'image/png')
                self.assertEqual(code,201,p);s=p['submission']
        return s

    def submit(self,s):
        code,p,_=self.call('POST',f"/api/seller/submissions/{s['id']}/submit",{'revision':s['revision']})
        self.assertEqual(code,200,p);return p['submission']

    def review(self,s,decision='approved',publish=True,**kw):
        path=f"/api/admin/seller/submissions/{s['id']}"
        fresh=self.call('GET',path,who='admin')[1]['submission']
        if decision=='approved' and fresh['status']=='submitted':
            code,p,headers=self.call('POST',path+'/review',{'revision':fresh['revision'],'decision':'reviewing'},'admin')
            if code!=200:return code,p,headers
            fresh=p['submission']
        revision=fresh['revision'] if fresh['status']=='reviewing' else s['revision']
        response=self.call('POST',path+'/review',{'revision':revision,'decision':decision,'diagnosticAuthentic':True,'documentsChecked':True,'vinChecked':True,'publicSummary':'Rapport vérifié, état conforme aux observations.',**kw},'admin')
        if decision=='approved' and publish and response[0]==200:
            response=self.call('POST',path+'/publish',{'revision':response[1]['submission']['revision']},'admin')
        return response

    def published(self):
        code,p,_=self.review(self.submit(self.draft(True)))
        self.assertEqual(code,200,p)
        return p['submission']

    def offer(self,s,who='other',amount=60000000):
        code,p,_=self.call('POST','/api/marketplace/offers',{'reference':'SV-'+s['id'],'amountMinor':amount,'currency':'TND','confirmIntent':True,'rulesVersion':'lot1-draft-1'},who)
        self.assertEqual(code,201,p)
        return p['id']



class VendeurTest(SellerFixture):
    def test_01_registration_profile_and_incomplete_draft(self):
        self.assertEqual(self.call('POST','/api/register',{'email':uuid.uuid4().hex+'@example.test','name':'Vendeur neuf','phone':'12345678','password':'VendeurTest42!'},who=None)[0],201)
        s=self.draft();code,p,_=self.call('POST',f"/api/seller/submissions/{s['id']}/submit",{'revision':s['revision']})
        self.assertEqual(code,400,p);self.assertGreater(len(p['missing']),10);self.assertEqual(self.review(s)[0],409)

    def test_02_publication_is_separate_and_documents_private(self):
        s=self.submit(self.draft(True));code,p,_=self.review(s,publish=False);self.assertEqual(code,200,p);s=p['submission'];ref='SV-'+s['id']
        self.assertFalse(any(l['reference']==ref for l in self.call('GET','/api/catalogue',who=None)[1]))
        code,p,_=self.call('POST',f"/api/admin/seller/submissions/{s['id']}/publish",{'revision':s['revision']},'admin');self.assertEqual(code,200,p)
        lot=next(l for l in self.call('GET','/api/catalogue',who=None)[1] if l['reference']==ref)
        self.assertTrue(lot['diagnosticVerified']);self.assertEqual(lot['priceMinor'],65000000);self.assertEqual(lot['currency'],'TND')
        public=json.dumps(lot);self.assertNotIn(s['data']['vin'],public);self.assertNotIn('minimum',public);self.assertNotIn('priceTnd',public)
        private=next(f for f in s['files'] if f['kind']=='registration')
        self.assertEqual(self.call('GET','/seller-media/'+private['id'],who=None)[0],404)
        self.assertEqual(self.call('GET',lot['photos'][0]['url'],who=None)[0],200);self.assertEqual(self.call('GET',lot['url'],who=None)[0],200)

    def test_03_owner_idor_temporary_access_and_audit(self):
        s=self.draft(True);f=next(f for f in s['files'] if f['kind']=='registration');path='/api/seller/files/'+f['id']
        self.assertEqual(self.call('GET',path,who='other')[0],404);self.assertEqual(self.call('GET',path,who=None)[0],401)
        code,p,_=self.call('POST',path+'/access',{});self.assertEqual(code,200,p)
        self.assertEqual(self.call('GET',p['url'])[0],200);self.assertEqual(self.call('GET',p['url'],who='other')[0],404)
        self.sql("UPDATE seller_file_access SET expires_at='2000-01-01'");self.assertEqual(self.call('GET',p['url'])[0],404)
        self.assertEqual(self.call('GET','/api/admin/seller/files/'+f['id'],who='admin')[0],200)
        self.assertTrue(any(x['action']=='document.read' and x['resource_id']==f['id'] for x in self.call('GET','/api/marketplace/dashboard',who='admin')[1]['audit_logs']))

    def test_04_offer_authentication_intention_currency_and_self_offer(self):
        s=self.published();body={'reference':'SV-'+s['id'],'amountMinor':60000000,'currency':'TND','confirmIntent':True,'rulesVersion':'lot1-draft-1'}
        self.assertEqual(self.call('POST','/api/marketplace/offers',body,who=None)[0],401);self.assertEqual(self.call('POST','/api/marketplace/offers',body)[0],403)
        for patch,expected in [({'confirmIntent':False},428),({'currency':'EUR'},400),({'amountMinor':60.5},400),({'amountMinor':'60000000'},400)]:
            self.assertEqual(self.call('POST','/api/marketplace/offers',{**body,**patch},'other')[0],expected)
        oid=self.offer(s);self.assertEqual(self.call('GET','/api/marketplace/offers/'+oid,who='other')[1]['offer']['status'],'pending')
        self.assertEqual(self.call('POST','/api/offers',{'reference':body['reference'],'kind':'buy_now'},'other')[0],410)

    def test_05_manual_acceptance_is_not_contract_and_money_immutable(self):
        s=self.published();oid=self.offer(s);p='/api/marketplace/offers/'+oid
        self.assertEqual(self.call('POST',p+'/decision',{'decision':'accept','revision':0},'other')[0],403)
        self.assertEqual(self.call('POST',p+'/decision',{'decision':'accept','revision':0,'amountMinor':1})[0],400)
        self.assertEqual(self.call('POST',p+'/decision',{'decision':'accept','revision':0})[0],200)
        d=self.call('GET',p)[1];self.assertEqual(d['offer']['status'],'accepted');self.assertIsNone(d['transaction']);self.assertNotIn('counterparty',d['offer'])
        self.assertEqual(self.call('POST',p+'/contract',{})[0],410)
        self.assertEqual(self.call('POST',p+'/decision',{'decision':'accept','revision':0})[0],409)
        self.assertTrue(any(n['event_code']=='offer.pending' for n in self.call('GET','/api/marketplace/notifications')[1]['notifications']))

    def test_06_concurrent_incompatible_acceptances(self):
        s=self.published();a=self.offer(s);b=self.offer(s,'admin',61000000)
        def accept(oid):return self.call('POST','/api/marketplace/offers/'+oid+'/decision',{'decision':'accept','revision':0})[0]
        with concurrent.futures.ThreadPoolExecutor() as pool:codes=list(pool.map(accept,[a,b]))
        self.assertEqual(sorted(codes),[200,409])
        offers=self.call('GET','/api/marketplace/offers?side=seller')[1]['offers'];self.assertEqual(sum(o['status']=='accepted' and o['submission_id']==s['id'] for o in offers),1)

    def test_07_expiry_withdrawal_rejection_and_cancellation(self):
        s=self.published();a=self.offer(s);p='/api/marketplace/offers/'+a
        self.assertEqual(self.call('POST',p+'/withdraw',{},'other')[0],200)
        b=self.offer(s);self.sql(f"UPDATE vehicle_offers SET expires_at='2000-01-01' WHERE id='{b}'")
        self.assertEqual(self.call('GET','/api/marketplace/offers/'+b,who='other')[1]['offer']['status'],'expired')
        c=self.offer(s);p='/api/marketplace/offers/'+c
        self.assertEqual(self.call('POST',p+'/decision',{'decision':'reject','revision':0,'reason':''})[0],400)
        self.assertEqual(self.call('POST',p+'/decision',{'decision':'reject','revision':0,'reason':'Prix non retenu'})[0],200)
        d=self.offer(s);p='/api/marketplace/offers/'+d;self.call('POST',p+'/decision',{'decision':'accept','revision':0})
        self.assertEqual(self.call('POST',p+'/cancel',{'reason':'Accord suspendu'})[0],403)

    def test_08_acceptance_creates_no_contract_sale_or_payment(self):
        s=self.published();oid=self.offer(s);p='/api/marketplace/offers/'+oid
        self.assertEqual(self.call('POST',p+'/decision',{'decision':'accept','revision':0})[0],200)
        self.assertEqual(self.call('GET',p)[1]['offer']['status'],'accepted')
        self.assertIsNone(self.call('GET',p)[1]['transaction'])
        self.assertEqual(self.call('POST',p+'/contract',{})[0],410)
        self.assertEqual(self.call('POST',p+'/confirm',{'confirmContract':True,'rulesVersion':'lot1-draft-1'},'other')[0],410)
        self.assertFalse(self.call('GET','/api/marketplace/rules',who=None)[1]['contractEnabled'])
        account=self.call('GET','/api/me',who='other')[1];self.assertFalse(account['vehicles']);self.assertFalse(account['invoices'])
        self.assertEqual(self.call('POST','/api/marketplace/reports',{'category':'dispute','offerId':oid,'reason':'Désaccord signalé'},'other')[0],201)

    def test_09_revalidation_hides_and_cancels_pending_offers(self):
        s=self.published();oid=self.offer(s);p='/api/marketplace/listings/'+s['id']+'/revalidate'
        self.assertEqual(self.call('POST',p,{'revision':s['revision']},'other')[0],404);self.assertEqual(self.call('POST',p,{'revision':s['revision']})[0],200)
        self.assertFalse(any(l['reference']=='SV-'+s['id'] for l in self.call('GET','/api/catalogue',who=None)[1]))
        self.assertEqual(self.call('GET','/api/marketplace/offers/'+oid,who='other')[1]['offer']['status'],'cancelled')
        s=self.call('GET','/api/seller/submissions/'+s['id'])[1]['submission'];self.assertEqual(s['status'],'draft')
        self.assertEqual(self.call('PUT','/api/seller/submissions/'+s['id'],{'revision':s['revision'],'data':{**s['data'],'mileageKm':51000}})[0],200)

    def test_10_expired_diagnostic_removes_public_vehicle_and_photos(self):
        s=self.published();ref='SV-'+s['id'];lot=next(l for l in self.call('GET','/api/catalogue',who=None)[1] if l['reference']==ref)
        self.sql(f"UPDATE seller_diagnostics SET valid_until='2000-01-01' WHERE submission_id='{s['id']}'")
        self.assertFalse(any(l['reference']==ref for l in self.call('GET','/api/catalogue',who=None)[1]))
        self.assertEqual(self.call('GET',lot['photos'][0]['url'],who=None)[0],404);self.assertEqual(self.call('GET',lot['url'],who=None)[0],404)

    def test_11_moderator_and_assigned_partner_permissions(self):
        s=self.draft(True)
        self.assertEqual(self.call('PUT','/api/marketplace/roles',{'userId':2,'role':'garage','enabled':True})[0],403)
        self.call('PUT','/api/marketplace/roles',{'userId':2,'role':'garage','enabled':True},'admin')
        self.assertEqual(self.call('POST','/api/marketplace/diagnostics/'+s['id'],PDF,'other')[0],404)
        self.assertEqual(self.call('POST','/api/marketplace/assignments',{'submissionId':s['id'],'userId':2,'garageId':self.garage},'admin')[0],200)
        a=next(x for x in self.call('GET','/api/marketplace/assignments',who='other')[1]['assignments'] if x['submissionId']==s['id']);self.assertNotIn('minimum',json.dumps(a));self.assertNotIn('email',json.dumps(a))
        self.assertEqual(self.call('PUT','/api/marketplace/diagnostics/'+s['id'],{'reportReference':'GAR-REPORT','inspectionDate':datetime.now(timezone.utc).date().isoformat(),'validUntil':'2099-01-01','mileageKm':50100,'observations':'Contrôles effectués','reservations':'Aucune'},'other')[0],200)
        self.assertEqual(self.call('POST','/api/marketplace/diagnostics/'+s['id'],PDF,'other')[0],201)
        self.call('PUT','/api/marketplace/roles',{'userId':2,'role':'moderator','enabled':True},'admin')
        try:
            self.assertEqual(self.call('GET','/api/admin/seller/submissions',who='other')[0],200)
            self.assertEqual(self.call('POST','/api/admin/seller/submissions/'+s['id']+'/publish',{'revision':0},'other')[0],403)
            self.assertEqual(self.call('PUT','/api/marketplace/suspensions',{'userId':1,'suspended':True,'reason':'Test'},'other')[0],403)
        finally:
            for role in ['garage','moderator']:self.call('PUT','/api/marketplace/roles',{'userId':2,'role':role,'enabled':False},'admin')

    def test_12_csrf_sql_xss_and_generic_admin_bypass(self):
        self.assertEqual(self.call('POST','/api/seller/submissions',{},origin='https://evil.example')[0],403)
        self.assertEqual(self.call('GET','/api/seller/submissions/abc%27%20OR%201=1--')[0],404)
        s=self.draft(True);payload='<img src=x onerror=alert(1)>'
        code,p,_=self.call('PUT','/api/seller/submissions/'+s['id'],{'revision':s['revision'],'data':{**s['data'],'description':payload}});self.assertEqual(code,200,p)
        code,p,_=self.review(self.submit(p['submission']));self.assertEqual(code,200,p)
        html=self.call('GET','/vehicule/SV-'+s['id'],who=None)[1].decode();self.assertNotIn(payload,html);self.assertIn('&lt;img',html)
        self.assertEqual(self.call('PUT','/api/admin/vehicles/SV-'+s['id'],{'make':'Fake','model':'Fake','status':'stock','photos':[]},'admin')[0],409)

    def test_13_upload_content_exif_and_stale_revision(self):
        s=self.draft();p='/api/seller/submissions/'+s['id']
        self.assertEqual(self.call('POST',p+'/files?kind=front',b'<svg/>',content_type='image/png')[0],415)
        self.assertEqual(self.call('POST',p+'/files?kind=diagnostic',b'%PDF-1.4\n/JavaScript x\n%%EOF')[0],415)
        import struct,zlib
        payload=b'PrivateGPS\x00never-publish';chunk=b'tEXt'+payload;chunk=struct.pack('>I',len(payload))+chunk+struct.pack('>I',zlib.crc32(chunk))
        code,b,_=self.call('POST',p+'/files?kind=front',PNG[:33]+chunk+PNG[33:],content_type='image/png');self.assertEqual(code,201,b)
        fid=b['submission']['files'][0]['id'];self.assertNotIn(b'PrivateGPS',self.call('GET','/api/seller/files/'+fid)[1])
        self.assertEqual(self.call('PUT',p,{'revision':s['revision'],'data':{}})[0],409)
        self.assertEqual(self.call('POST',p+'/files?kind=identity',PNG,content_type='image/png')[0],409)

    def test_14_suspension_privacy_and_environment_isolation(self):
        self.assertEqual(self.call('POST','/api/marketplace/privacy',{'kind':'deletion','reason':'Supprimer mes données'})[0],201)
        self.assertEqual(self.call('GET','/api/marketplace/privacy')[1]['requests'][0]['status'],'open');self.assertEqual(self.call('GET','/api/marketplace/dashboard')[0],403)
        self.call('PUT','/api/marketplace/suspensions',{'userId':2,'suspended':True,'reason':'Test local'},'admin')
        try:self.assertEqual(self.call('GET','/api/marketplace/offers',who='other')[0],403)
        finally:self.call('PUT','/api/marketplace/suspensions',{'userId':2,'suspended':False,'reason':'Fin du test'},'admin')
        config=json.loads(self.config.read_text());self.assertNotEqual(config['d1_databases'][0]['database_id'],'9481f2d4-698c-4f6f-90e2-9532f9e44bcf');self.assertIn(self.tmp.name,self.persist)
        self.assertEqual(self.call('GET','/mes-offres')[2]['Cache-Control'],'private, no-store')

    def test_15_eur_exact_values_and_auction_exclusion(self):
        s=self.draft(True);d={**s['data'],'priceCurrency':'EUR','priceAmount':'12345.67','minimumAmount':'12000.01','publicReserveAmount':'12000.00'}
        code,p,_=self.call('PUT','/api/seller/submissions/'+s['id'],{'revision':s['revision'],'data':d});self.assertEqual(code,200,p)
        code,p,_=self.review(self.submit(p['submission']));self.assertEqual(code,200,p)
        lot=next(l for l in self.call('GET','/api/catalogue',who=None)[1] if l['reference']=='SV-'+s['id']);self.assertEqual(lot['priceMinor'],1234567);self.assertEqual(lot['currency'],'EUR');self.assertNotIn('indicativePriceTnd',lot)
        s=self.draft();self.assertEqual(self.call('PUT','/api/seller/submissions/'+s['id'],{'revision':s['revision'],'data':{'saleType':'auction'}})[0],400)

    def test_16_browser_mobile_draft_and_mandatory_diagnostic(self):
        from playwright.sync_api import sync_playwright, expect
        with sync_playwright() as pw, pw.chromium.launch(headless=True) as browser:
            context=browser.new_context(viewport={'width':390,'height':844})
            context.add_cookies([{'name':'my_session','value':self.tokens['seller'],'url':self.base}])
            page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(self.base+'/mes-vehicules');page.locator('#new-submission').click()
            page.locator('#vehicle-form').wait_for();page.locator('[name=vin]').fill('VF3'+uuid.uuid4().hex[:14].upper())
            page.locator('[name=location]').select_option(label='Tunis');page.locator('[name=originCountry]').select_option('FR')
            # Mise en vente en 4 étapes : véhicule, photos, inspection et documents, prix.
            self.assertEqual(page.locator('[data-step]').count(),4)
            for absent in ['licensePlate','productionDate','obs-engine','equipment','minimumAmount','deliveryTerms']:self.assertEqual(page.locator(f'[name={absent}]').count(),0,absent)
            page.locator('#continue-identification').click();page.locator('#photos-step').wait_for(state='visible')
            page.locator('[data-step="3"]').click();page.locator('[name=priceAmount]').fill('12345.678')
            self.assertEqual(page.locator('[name=saleType]').input_value(),'sale');self.assertTrue(page.locator('#submit-dossier').is_disabled())
            self.assertEqual(page.locator('[name=auctionEnd]').count(),0)
            page.locator('#save-draft').click();expect(page.locator('#message')).to_contain_text('enregistr')
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),390)
            self.assertFalse(errors,errors)
            context.close()

    def test_17_browser_private_offer_seller_decision_and_history(self):
        from playwright.sync_api import sync_playwright,expect
        s=self.published()
        with sync_playwright() as pw,pw.chromium.launch(headless=True) as browser:
            buyer=browser.new_context();buyer.add_cookies([{'name':'my_session','value':self.tokens['other'],'url':self.base}]);page=buyer.new_page()
            page.goto(self.base+'/vehicule/SV-'+s['id']);page.get_by_role('button',name='Proposer une offre',exact=True).click()
            popup=page.locator('#proposal-dialog');popup.locator('[name=amount]').fill('60000.001');popup.locator('[name=intention]').check();popup.get_by_role('button',name='Envoyer ma proposition').click()
            expect(popup).to_contain_text('Votre proposition a été envoyée')
            page.goto(self.base+'/mes-offres');expect(page.get_by_text('En attente',exact=True).first).to_be_visible()
            seller=browser.new_context();seller.add_cookies([{'name':'my_session','value':self.tokens['seller'],'url':self.base}]);review=seller.new_page();review.goto(self.base+'/vendeur/offres')
            article=review.locator('article',has=review.locator('a[href="/vehicule/SV-'+s['id']+'"]'))
            article.get_by_role('button',name='Accepter l’offre',exact=True).click();expect(article).to_contain_text('Acceptée par le vendeur')
            article.get_by_role('button',name='Historique',exact=True).click();expect(article.locator('ol')).to_contain_text('Acceptée par le vendeur')
            self.assertEqual(article.locator('[data-action=contract]').count(),0);buyer.close();seller.close()

    def test_18_sale_completion_is_manual_and_revalidation_respects_acceptance(self):
        s=self.published();oid=self.offer(s);p='/api/marketplace/listings/'+s['id']
        self.assertEqual(self.call('POST',p+'/availability',{'availability':'sold'})[0],428)
        self.call('POST','/api/marketplace/offers/'+oid+'/decision',{'decision':'accept','revision':0})
        self.assertEqual(self.call('POST',p+'/revalidate',{'revision':s['revision']})[0],409)
        self.assertEqual(self.call('POST',p+'/availability',{'availability':'sold','confirmExternalCompletion':True})[0],200)
        listing=next(x for x in self.call('GET','/api/seller/submissions')[1]['submissions'] if x['id']==s['id']);self.assertEqual(listing['listingState'],'sold')

    def test_19_versioned_policy_and_identity_procedure(self):
        original=self.call('GET','/api/marketplace/policy',who='admin')[1]['policy']
        b={'version':'test-policy','offerHours':24,'confirmationHours':48,'withdrawalAllowed':False,'contractEnabled':True,'legalReviewReference':'','confirmLegalReview':False,'minPhotos':7,'retentionDays':30,'identityRequired':False,'identityProcedure':''}
        self.assertEqual(self.call('PUT','/api/marketplace/policy',b)[0],403)
        self.assertEqual(self.call('PUT','/api/marketplace/policy',b,'admin')[0],409)
        try:
            self.assertEqual(self.call('PUT','/api/marketplace/policy',{**b,'contractEnabled':False},'admin')[0],200)
            self.assertFalse(self.call('GET','/api/marketplace/rules',who=None)[1]['withdrawalAllowed'])
        finally:
            self.sql("UPDATE marketplace_policy SET version='lot1-draft-1',offer_hours=72,confirmation_hours=168,withdrawal_allowed=1,contract_enabled=0,legal_review_reference='',min_photos=8,retention_days=180,identity_required=0,identity_procedure=''")

    def test_20_retention_preserves_evidence_and_purges_only_inactive_drafts(self):
        d=self.draft(True);p=self.published();oid=self.offer(p)
        self.call('POST','/api/marketplace/offers/'+oid+'/withdraw',{},'other')
        self.call('POST','/api/admin/seller/submissions/'+p['id']+'/archive',{'revision':p['revision']},'admin')
        self.sql(f"UPDATE seller_submissions SET updated_at='2000-01-01' WHERE id IN ('{d['id']}','{p['id']}')")
        self.assertEqual(self.call('POST','/api/admin/seller/cleanup',{},'admin')[0],200)
        draft=self.call('GET','/api/seller/submissions/'+d['id'])[1]['submission'];self.assertIsNotNone(draft['purged_at']);self.assertFalse(draft['files'])
        proof=self.call('GET','/api/seller/submissions/'+p['id'])[1]['submission'];self.assertIsNone(proof['purged_at']);self.assertTrue(proof['files'])

    def test_21_rejection_corrections_and_duplicate_vin(self):
        s=self.submit(self.draft(True));code,p,_=self.review(s,'corrections',False,feedback='Corriger les observations');self.assertEqual(code,200,p)
        s=p['submission'];self.assertEqual(s['status'],'corrections');self.assertEqual(s['diagnostic']['diagnostic_status'],'rejected')
        other=self.draft();self.assertEqual(self.call('PUT','/api/seller/submissions/'+other['id'],{'revision':other['revision'],'data':{'vin':s['data']['vin']}})[0],409)
        self.assertEqual(self.call('PUT','/api/seller/submissions/'+s['id'],{'revision':s['revision'],'data':s['data']})[0],200)

    def test_22_api_abuse_limit_and_file_size(self):
        s=self.draft()
        self.assertEqual(self.call('POST','/api/seller/submissions/'+s['id']+'/files?kind=front',PNG+b'0'*(10*1024*1024),content_type='image/png')[0],413)
        self.sql("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<120) INSERT INTO marketplace_api_attempts(user_id,at) SELECT 2,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM n")
        try:self.assertEqual(self.call('POST','/api/marketplace/privacy',{'kind':'access','reason':'Test de limite'},'other')[0],429)
        finally:self.sql('DELETE FROM marketplace_api_attempts WHERE user_id=2')

    def test_23_inspection_page_lists_validated_partners_only(self):
        # Page publique « Inspection auto » : garages validés dans /admin-vendeurs, sans leur contact.
        code,html,_=self.call('GET','/services/inspection-auto',who=None);html=html.decode()
        self.assertEqual(code,200)
        self.assertIn('une <strong>inspection officielle et détaillée</strong> est obligatoire',html)
        self.assertIn('<strong>Garage partenaire</strong>',html);self.assertIn('Tunis',html)
        self.assertNotIn('contact@example.test',html)
        autre=self.call('POST','/api/admin/seller/garages',{'name':'Garage Desactive','address':'Sfax','contact':'cache@example.test','professionalNumber':'GAR-002','validUntil':'2099-12-31'},'admin')[1]['garage']['id']
        self.assertIn('Garage Desactive',self.call('GET','/services/inspection-auto',who=None)[1].decode())
        self.assertEqual(self.call('PUT',f'/api/admin/seller/garages/{autre}',{'active':False},'admin')[0],200)
        self.assertNotIn('Garage Desactive',self.call('GET','/services/inspection-auto',who=None)[1].decode(),'garage désactivé retiré de la page')

    def test_24_simplified_listing_without_observations_and_known_defects(self):
        # Mise en vente simplifiée : les 10 observations du diagnostic ne sont plus exigées ; défauts connus publiés.
        s=self.draft(True)
        data={**s['data'],'observations':{},'knownDefects':'Rayure légère sur le pare-chocs arrière'}
        s=self.call('PUT',f"/api/seller/submissions/{s['id']}",{'revision':s['revision'],'data':data})[1]['submission']
        detail=self.call('GET',f"/api/seller/submissions/{s['id']}")[1]
        self.assertFalse([m for m in detail['missing'] if m.startswith('Diagnostic :')],detail['missing'])
        code,p,_=self.review(self.submit(s));self.assertEqual(code,200,p)
        lot=next(l for l in self.call('GET','/api/catalogue',who=None)[1] if l['reference']=='SV-'+s['id'])
        self.assertIn(['Défauts connus déclarés par le vendeur','Rayure légère sur le pare-chocs arrière'],lot['specs'])
