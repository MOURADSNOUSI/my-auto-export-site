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
class VendeurTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.config = Path(cls.tmp.name) / 'wrangler.json'
        cls.config.write_text(json.dumps({
            'name':'seller-test','compatibility_date':'2026-10-01',
            'main':str(ROOT/'worker/main.js'),
            'assets':{'directory':str(ROOT/'my-auto-export'),'binding':'ASSETS'},
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
        for i, name in enumerate(['seller','other','admin'],1):
            token = hashlib.sha256(name.encode()).hexdigest(); cls.tokens[name]=token
            cls.sql(f"INSERT INTO users(id,email,name,phone,password_hash,password_salt,role) VALUES({i},'{name}@example.test','{name}','12345678','unused','00','{'admin' if name=='admin' else 'buyer'}'); INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('{hashlib.sha256(token.encode()).hexdigest()}',{i},'2099-01-01T00:00:00Z')")
        cls.garage = cls.call('POST','/api/admin/seller/garages',{'name':'Garage partenaire','address':'Tunis','contact':'contact@example.test','professionalNumber':'GAR-001','validUntil':'2099-12-31'},'admin')[1]['garage']['id']
        for name in ['seller','other']:
            cls.call('PUT','/api/seller/profile',{'name':name,'phone':'12345678','address':'Adresse privée Tunis'},name)

    def setUp(self):
        self.sql('DELETE FROM seller_upload_attempts')

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
            self.sql('DELETE FROM seller_upload_attempts')
            data={'make':'Peugeot','model':'208','year':2021,'mileageKm':50000,'fuel':'Essence','vin':'VF3CAHMRPKS123456','location':'Tunis','originCountry':'FR','licensePlate':'AA-123-BB','firstRegistrationDate':'2021-04-18','priceTnd':65000,'saleType':sale_type,'garageId':self.garage,'diagnosticDate':datetime.now(timezone.utc).date().isoformat(),'observations':{k:'Contrôlé sans anomalie' for k in ['engine','transmission','brakes','suspension','steering','electronics','battery','body','tyres','defects']}}
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

    def test_authentication_owner_admin_and_csrf(self):
        self.assertEqual(self.call('GET','/api/seller/submissions',who=None)[0],401)
        self.assertEqual(self.call('GET','/api/admin/seller/submissions')[0],403)
        self.assertEqual(self.call('POST','/api/seller/submissions',{},origin='https://evil.example')[0],403)
        s=self.draft()
        self.assertEqual(self.call('GET',f"/api/seller/submissions/{s['id']}",who='other')[0],404)
        self.assertEqual(self.call('PUT',f"/api/seller/submissions/{s['id']}",{'revision':0,'data':{}},'other')[0],404)

    def test_missing_documents_and_forged_badge_cannot_publish(self):
        s=self.draft()
        code,p,_=self.call('POST',f"/api/seller/submissions/{s['id']}/submit",{'revision':s['revision']})
        self.assertEqual(code,400); self.assertGreater(len(p['missing']),10)
        self.assertEqual(self.review(s)[0],409)
        code,p,_=self.call('PUT',f"/api/seller/submissions/{s['id']}",{'revision':s['revision'],'data':{'diagnosticVerified':True,'status':'approved','public_data':'malicious'}})
        self.assertEqual(code,200); self.assertNotIn('diagnosticVerified',p['submission']['data'])
        self.assertFalse(any(x['reference']=='SV-'+s['id'] for x in self.call('GET','/api/catalogue',who=None)[1]))

    def test_approval_publication_and_private_documents(self):
        s=self.draft(True); file=s['files'][0]; doc=next(f for f in s['files'] if f['kind']=='registration')
        self.assertEqual(self.call('GET','/seller-media/'+file['id'],who=None)[0],404)
        for who,expected in [(None,401),('other',404),('seller',200),('admin',200)]:
            code,_,headers=self.call('GET','/api/'+('admin/seller/' if who=='admin' else 'seller/')+'files/'+doc['id'],who=who)
            self.assertEqual(code,expected)
            if code==200:self.assertEqual(headers['Cache-Control'],'private, no-store')
        s=self.submit(s)
        self.assertEqual(self.call('PUT',f"/api/seller/submissions/{s['id']}",{'revision':s['revision'],'data':{}})[0],409)
        self.assertEqual(self.call('POST',f"/api/seller/submissions/{s['id']}/files?kind=diagnostic",PDF)[0],409)
        self.assertEqual(self.review(s,diagnosticAuthentic=False)[0],400)
        self.assertEqual(self.review(s,documentsChecked=False)[0],400)
        self.assertEqual(self.review(s)[0],200)
        catalogue=self.call('GET','/api/catalogue',who=None)[1]
        lot=next(x for x in catalogue if x['reference']=='SV-'+s['id'])
        self.assertIs(lot['diagnosticVerified'],True);self.assertEqual(lot['status'],'stock')
        for key in ['vin','licensePlate','firstRegistrationDate','location','originCountry','observations','seller_email','address','garageId','diagnosticDate']:
            self.assertNotIn(key,lot)
        self.assertNotIn(doc['id'],json.dumps(lot))
        self.assertEqual(self.call('GET','/seller-media/'+file['id'],who=None)[0],200)
        self.assertEqual(self.call('GET','/seller-media/'+doc['id'],who=None)[0],404)
        self.assertEqual(self.review(s)[0],409)
        self.assertEqual(self.call('DELETE','/api/seller/files/'+doc['id'],{'revision':s['revision']})[0],409)
        # La programmation et les prix n'altèrent pas le diagnostic technique.
        self.sql(f"UPDATE vehicles SET data=json_set(data,'$.indicativePriceTnd',66000) WHERE reference='SV-{s['id']}'")
        lot=next(x for x in self.call('GET','/api/catalogue',who=None)[1] if x['reference']=='SV-'+s['id'])
        self.assertTrue(lot['diagnosticVerified'])
        # Une modification administrative ne conserve pas une attestation portant sur un autre état.
        self.sql(f"UPDATE vehicles SET data=json_set(data,'$.model','Modifié') WHERE reference='SV-{s['id']}'")
        lot=next(x for x in self.call('GET','/api/catalogue',who=None)[1] if x['reference']=='SV-'+s['id'])
        self.assertNotIn('diagnosticVerified',lot)

    def test_corrections_rejection_and_resubmission(self):
        for decision in ['corrections','rejected']:
            s=self.submit(self.draft(True))
            self.assertEqual(self.review(s,decision,feedback='')[0],400)
            code,p,_=self.review(s,decision,feedback='Rapport à compléter')
            self.assertEqual(code,200);s=p['submission'];self.assertEqual(s['feedback'],'Rapport à compléter')
            s=self.submit(s); self.assertEqual(s['status'],'submitted')
            self.assertFalse(any(x['reference']=='SV-'+s['id'] for x in self.call('GET','/api/catalogue',who=None)[1]))

    def test_upload_formats_removal_and_stale_revision(self):
        s=self.draft()
        path=f"/api/seller/submissions/{s['id']}/files?kind="
        self.assertEqual(self.call('POST',path+'diagnostic',PNG,content_type='image/png')[0],415)
        self.assertEqual(self.call('POST',path+'diagnostic',b'<script>bad</script>')[0],415)
        self.assertEqual(self.call('POST',path+'exterior',PDF)[0],415)
        self.assertEqual(self.call('POST',path+'registration',b'x'*(10*1024*1024+1))[0],413)
        code,p,_=self.call('POST',path+'diagnostic',PDF);self.assertEqual(code,201)
        f=p['submission']['files'][0]; updated=p['submission']
        self.assertEqual(self.call('DELETE','/api/seller/files/'+f['id'],{'revision':s['revision']})[0],409)
        self.assertEqual(self.call('DELETE','/api/seller/files/'+f['id'],{'revision':updated['revision']})[0],200)
        self.assertEqual(self.call('GET','/api/seller/files/'+f['id'])[0],404)
        self.assertEqual(self.call('PUT',f"/api/seller/submissions/{s['id']}",{'revision':s['revision'],'data':{}})[0],409)

    def test_garage_and_report_validation_on_submission_and_approval(self):
        s=self.draft(True)
        data=s['data'].copy();data['diagnosticDate']='2099-01-01';data['vin']='INVALID'
        code,p,_=self.call('PUT',f"/api/seller/submissions/{s['id']}",{'revision':s['revision'],'data':data});s=p['submission']
        self.assertEqual(self.call('POST',f"/api/seller/submissions/{s['id']}/submit",{'revision':s['revision']})[0],400)
        s=self.submit(self.draft(True))
        try:
            self.call('PUT',f'/api/admin/seller/garages/{self.garage}',{'active':False},'admin')
            self.assertEqual(self.review(s)[0],400)
            self.assertEqual(self.call('GET','/api/seller/garages')[1]['garages'],[])
        finally:self.call('PUT',f'/api/admin/seller/garages/{self.garage}',{'active':True},'admin')

    def test_concurrent_reviews_and_auction_upcoming(self):
        s=self.submit(self.draft(True,'auction'))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _: self.review(s)[0],range(2)))
        self.assertEqual(sorted(results),[200,409])
        lot=next(x for x in self.call('GET','/api/catalogue',who=None)[1] if x['reference']=='SV-'+s['id'])
        self.assertEqual(lot['status'],'upcoming');self.assertTrue(lot['diagnosticVerified']);self.assertEqual(lot['startingPriceTnd'],65000)

    def identify_in_browser(self,page):
        from playwright.sync_api import expect
        expect(page.locator('#continue-identification')).to_be_disabled()
        page.locator('[name=vin]').fill('VF3'+uuid.uuid4().hex[:14].upper())
        page.locator('[name=licensePlate]').fill('AA-123-BB')
        page.locator('[name=firstRegistrationDate]').fill('2021-04-18')
        page.locator('[name=location]').select_option('Tunis')
        page.locator('[name=originCountry]').select_option('FR')
        expect(page.locator('#continue-identification')).to_be_enabled()
        page.locator('#continue-identification').click()
        expect(page.locator('#model-step')).to_be_visible()

    def test_browser_draft_and_submission_blocking(self):
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser=p.chromium.launch()
            context=browser.new_context(viewport={'width':390,'height':844})
            context.add_cookies([{'name':'my_session','value':self.tokens['seller'],'url':self.base}])
            page=context.new_page();page.goto(self.base+'/vendre')
            page.get_by_role('button',name='Ajouter un véhicule',exact=True).click()
            page.wait_for_selector('#vehicle-form')
            page.locator('[name=make]').fill('Renault')
            self.identify_in_browser(page)
            self.assertTrue(page.locator('#submit-dossier').is_disabled())
            page.get_by_role('button',name='Enregistrer le brouillon',exact=True).click()
            page.wait_for_function("document.getElementById('message').textContent === 'Brouillon enregistré.'")
            self.assertEqual(page.locator('[name=make]').input_value(),'Renault')
            self.assertTrue(page.locator('#submit-dossier').is_disabled())
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),390)
            # Vérifier le badge réel et l'absence de documents dans le DOM public.
            s=self.submit(self.draft(True));self.assertEqual(self.review(s)[0],200)
            page.goto(self.base+'/');page.wait_for_function("typeof catalogueEtat !== 'undefined' && catalogueEtat !== 'loading'")
            self.assertGreater(page.get_by_text('Diagnostic vérifié par M&Y AUTO EXPORT',exact=True).count(),0)
            self.assertEqual(page.locator('a[href*="/seller/files/"]').count(),0)


    def test_seller_listing_states_use_accepted_offers_and_removal(self):
        draft=self.draft()
        active=self.submit(self.draft(True))
        sold=self.submit(self.draft(True))
        archived=self.submit(self.draft(True))
        for submission in [active,sold,archived]:
            self.assertEqual(self.review(submission)[0],200)
        self.sql(f"UPDATE vehicles SET removed=1 WHERE reference IN ('SV-{sold['id']}','SV-{archived['id']}'); INSERT INTO offers(user_id,reference,amount_tnd,kind,status) VALUES(2,'SV-{sold['id']}',65000,'buy_now','accepted')")
        code,p,_=self.call('GET','/api/seller/submissions')
        self.assertEqual(code,200)
        states={s['id']:s['listingState'] for s in p['submissions']}
        for s,state in [(draft,'active'),(active,'active'),(sold,'sold'),(archived,'archived')]:
            self.assertEqual(states[s['id']],state)
        other=self.call('GET','/api/seller/submissions',who='other')[1]['submissions']
        self.assertFalse({draft['id'],active['id'],sold['id'],archived['id']} & {s['id'] for s in other})
        self.assertNotIn('amount_tnd',json.dumps(p))

    def test_browser_seller_filters_counts_empty_states_and_mobile(self):
        from playwright.sync_api import sync_playwright, expect
        samples=[{'id':f'{i:032x}','data':{'make':'Marque','model':f'Modèle {i}'},'status':status,'listingState':'active','files':[]} for i,status in enumerate(['draft','submitted','corrections','rejected','approved','approved'],1)]
        samples.append({'id':f'{7:032x}','data':{'make':'Véhicule','model':'Vendu'},'status':'approved','listingState':'sold','files':[]})
        with sync_playwright() as p:
            browser=p.chromium.launch()
            context=browser.new_context(viewport={'width':1200,'height':900})
            context.add_cookies([{'name':'my_session','value':self.tokens['seller'],'url':self.base}])
            page=context.new_page()
            page.route('**/api/seller/submissions',lambda route:route.fulfill(json={'submissions':samples}))
            page.goto(self.base+'/vendre')
            for key,count in [('all',7),('active',6),('sold',1),('archived',0)]:
                expect(page.locator(f'[data-vehicle-count={key}]')).to_have_text(str(count))
            expect(page.locator('#submissions article')).to_have_count(7)
            page.locator('[data-vehicle-filter=active]').click()
            expect(page.locator('#submissions article')).to_have_count(6)
            self.assertEqual(page.locator('[data-vehicle-filter=active]').get_attribute('aria-pressed'),'true')
            page.locator('[data-vehicle-filter=sold]').click()
            expect(page.locator('#submissions article')).to_have_count(1)
            expect(page.locator('#submissions .status')).to_have_text('Vendu')
            page.locator('[data-vehicle-filter=archived]').click()
            expect(page.locator('#submissions')).to_have_text('Aucun véhicule archivé.')
            samples.append({'id':f'{8:032x}','data':{'make':'Véhicule','model':'Archivé'},'status':'approved','listingState':'archived','files':[]})
            page.reload()
            expect(page.locator('[data-vehicle-count=all]')).to_have_text('8')
            expect(page.locator('[data-vehicle-count=archived]')).to_have_text('1')
            page.locator('[data-vehicle-filter=archived]').click()
            expect(page.locator('#submissions article')).to_have_count(1)
            expect(page.locator('#submissions .status')).to_have_text('Archivé')
            page.set_viewport_size({'width':390,'height':844})
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),390)
            page.locator('[data-vehicle-filter=all]').click()
            expect(page.locator('#submissions article')).to_have_count(8)
            browser.close()

    def test_identification_fields_persist_and_are_checked_on_submit(self):
        s=self.draft(True)
        path=f"/api/seller/submissions/{s['id']}"
        self.assertEqual(s['data']['licensePlate'],'AA-123-BB')
        self.assertEqual(s['data']['firstRegistrationDate'],'2021-04-18')
        self.assertEqual(s['data']['location'],'Tunis')
        self.assertEqual(s['data']['originCountry'],'FR')
        valid=s['data'].copy()
        for updates in [{'location':''},{'originCountry':''},{'originCountry':'XX'},{'firstRegistrationDate':'2099-01-01'},{'firstRegistrationDate':'2021-02-31'}]:
            code,p,_=self.call('PUT',path,{'revision':s['revision'],'data':{**valid,**updates}})
            self.assertEqual(code,200);s=p['submission']
            self.assertEqual(self.call('POST',path+'/submit',{'revision':s['revision']})[0],400)
        # Les deux champs sans astérisque restent facultatifs.
        code,p,_=self.call('PUT',path,{'revision':s['revision'],'data':{**valid,'licensePlate':'','firstRegistrationDate':''}})
        self.assertEqual(code,200)
        self.assertEqual(self.submit(p['submission'])['status'],'submitted')

    def test_browser_identification_continue_back_and_cancel(self):
        from playwright.sync_api import sync_playwright,expect
        with sync_playwright() as p:
            browser=p.chromium.launch()
            context=browser.new_context(viewport={'width':390,'height':844})
            context.add_cookies([{'name':'my_session','value':self.tokens['seller'],'url':self.base}])
            page=context.new_page();page.goto(self.base+'/vendre')
            page.get_by_role('button',name='Ajouter un véhicule',exact=True).click()
            expect(page.locator('#identification-step')).to_be_visible()
            expect(page.locator('#model-step')).to_be_hidden()
            expect(page.locator('#diagnostic-step')).to_be_hidden()
            expect(page.locator('#continue-identification')).to_be_disabled()
            page.locator('[name=vin]').fill('INVALID')
            page.locator('[name=location]').select_option('other')
            page.locator('[name=locationOther]').fill('Munich, Allemagne')
            page.locator('[name=originCountry]').select_option('DE')
            expect(page.locator('#continue-identification')).to_be_disabled()
            page.locator('[name=vin]').fill('VF3'+uuid.uuid4().hex[:14].upper())
            page.locator('[name=firstRegistrationDate]').fill('2099-01-01')
            expect(page.locator('#continue-identification')).to_be_disabled()
            page.locator('[name=firstRegistrationDate]').fill('2020-06-12')
            page.locator('[name=licensePlate]').fill('M-AB-123')
            expect(page.locator('#continue-identification')).to_be_enabled()
            page.locator('#continue-identification').click()
            expect(page.locator('#model-step')).to_be_visible()
            expect(page.locator('#diagnostic-step')).to_be_hidden()
            page.locator('#previous-step').click()
            expect(page.locator('[name=licensePlate]')).to_have_value('M-AB-123')
            page.locator('#cancel-identification').click()
            expect(page.locator('#editor')).to_be_hidden()
            expect(page.locator('#message')).to_have_text('Brouillon conservé dans vos dossiers.')
            drafts=self.call('GET','/api/seller/submissions')[1]['submissions']
            saved=next(s for s in drafts if s['data'].get('licensePlate')=='M-AB-123')
            self.assertEqual(saved['status'],'draft')
            self.assertEqual(saved['data']['location'],'Munich, Allemagne')
            page.locator(f'[data-open="{saved["id"]}"]').click()
            expect(page.locator('#identification-step')).to_be_visible()
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),390)
            browser.close()

    def test_browser_complete_seller_and_admin_journey(self):
        from playwright.sync_api import sync_playwright,expect
        with sync_playwright() as p:
            browser=p.chromium.launch()
            page=browser.new_page(viewport={'width':390,'height':844})
            page.goto(self.base+'/vendre');page.locator('summary').click()
            form=page.locator('#register-form')
            for key,value in {'name':'Vendeur navigateur','email':f'{uuid.uuid4().hex}@example.test','phone':'12345678','password':'motdepasse-solide'}.items():form.locator(f'[name={key}]').fill(value)
            form.get_by_role('button',name='Créer mon compte',exact=True).click()
            expect(page.locator('#profile-section')).to_be_visible()
            page.locator('#profile-form [name=address]').fill('Adresse privée de test Tunis')
            page.get_by_role('button',name='Enregistrer mes coordonnées',exact=True).click()
            expect(page.locator('#message')).to_have_text('Coordonnées enregistrées.')
            page.get_by_role('button',name='Ajouter un véhicule',exact=True).click()
            expect(page.locator('#vehicle-form')).to_be_visible()
            for key,value in {'make':'Toyota','model':'Yaris E2E','year':'2022','mileageKm':'35000'}.items():page.locator(f'[name={key}]').fill(value)
            self.identify_in_browser(page)
            page.locator('[name=fuel]').select_option('Hybride')
            page.locator('[data-step="2"]').click();expect(page.locator('#equipment-step')).to_be_visible()
            page.locator('#equipment-search').fill('CarPlay');page.get_by_label('Apple CarPlay',exact=True).check()
            page.locator('[data-step="4"]').click();expect(page.locator('#photos-step')).to_be_visible()
            for index,kind in enumerate(PHOTO_KINDS,1):
                page.locator(f'[data-upload={kind}]').set_input_files({'name':'photo.png','mimeType':'image/png','buffer':PNG})
                expect(page.locator('[data-photo]')).to_have_count(index)
                expect(page.locator('[data-step="5"]')).to_be_enabled()
            page.locator('[data-photo-main]').last.click()
            expect(page.locator('.seller-photo p').filter(has_text='Principale')).to_have_count(1)
            page.locator('[data-step="5"]').click();expect(page.locator('#damage-step')).to_be_visible()
            page.locator('button[data-zone=hood]').click();page.locator('#damage-description').fill('Petite rayure sur le capot')
            page.locator('[data-damage-photo]').first.check();page.locator('#save-damage').click()
            expect(page.locator('#damages-list')).to_contain_text('Petite rayure')
            page.locator('[data-step="6"]').click();expect(page.locator('#diagnostic-step')).to_be_visible()
            page.locator('[name=garageId]').select_option(str(self.garage))
            page.locator('[name=diagnosticDate]').fill(datetime.now(timezone.utc).date().isoformat())
            page.locator('[name=diagnosticReference]').fill('RAPPORT-E2E');page.locator('[name=diagnosticMileageKm]').fill('35000')
            page.locator('[name=diagnosticVin]').fill(page.locator('[name=vin]').input_value())
            for key in ['engine','transmission','brakes','suspension','steering','electronics','battery','body','tyres','defects']:page.locator(f'[name=obs-{key}]').fill('Contrôlé : voir rapport')
            for kind in ['registration','ownership','diagnostic']:
                before=page.locator('#diagnostic-step li').count()
                page.locator(f'[data-upload={kind}]').set_input_files({'name':'rapport.pdf','mimeType':'application/pdf','buffer':PDF})
                expect(page.locator('#diagnostic-step li')).to_have_count(before+1)
                expect(page.locator('[data-step="7"]')).to_be_enabled()
            page.locator('[data-step="7"]').click();expect(page.locator('#sale-step')).to_be_visible()
            page.locator('[name=saleType]').select_option('sale');page.locator('[name=priceAmount]').fill('85000')
            page.get_by_role('button',name='Enregistrer le brouillon',exact=True).click()
            expect(page.locator('#message')).to_have_text('Brouillon enregistré.')
            expect(page.locator('#submit-dossier')).to_be_enabled()
            submission_id=page.locator('#editor').get_attribute('data-submission-id')
            page.locator('#submit-dossier').click();expect(page.locator('#editor .status')).to_have_text('Soumis')
            reviewer_context=browser.new_context();reviewer_context.add_cookies([{'name':'my_session','value':self.tokens['admin'],'url':self.base}])
            reviewer=reviewer_context.new_page();reviewer.goto(self.base+'/admin-vendeurs')
            reviewer.locator(f'[data-open="{submission_id}"]').click();reviewer.locator('#begin-review').click()
            expect(reviewer.locator('#editor .status')).to_have_text('En cours de vérification')
            for key in ['diagnosticAuthentic','documentsChecked','vinChecked']:reviewer.locator(f'[name={key}]').check()
            reviewer.locator('[name=publicSummary]').fill('Diagnostic vérifié par le garage, rayure capot déclarée.')
            reviewer.locator('[name=decision]').select_option('approved')
            reviewer.get_by_role('button',name='Enregistrer la décision',exact=True).click()
            expect(reviewer.locator('#editor .status')).to_have_text('Approuvé — publication à autoriser')
            self.assertFalse(any(x['reference']=='SV-'+submission_id for x in self.call('GET','/api/catalogue',who=None)[1]))
            reviewer.locator('#publish-submission').click();expect(reviewer.locator('#editor .status')).to_have_text('Publié')
            page.goto(self.base+'/');card=page.locator('.lot-card').filter(has_text='Yaris E2E')
            expect(card).to_contain_text('Diagnostic vérifié par M&Y AUTO EXPORT')
            card.get_by_role('button',name='Voir la fiche').click()
            expect(page.locator('#lot-dialog-body')).to_contain_text('Petite rayure sur le capot')
            self.assertEqual(page.locator('a[href*="/seller/files/"]').count(),0)
            browser.close()

    def test_workflow_approval_is_not_publication_and_audit_is_preserved(self):
        s=self.submit(self.draft(True));path=f"/api/admin/seller/submissions/{s['id']}"
        self.assertEqual(self.call('POST',path+'/publish',{'revision':s['revision']},'admin')[0],409)
        self.assertEqual(self.call('POST',path+'/review',{'revision':s['revision'],'decision':'approved','diagnosticAuthentic':True,'documentsChecked':True,'vinChecked':True},'admin')[0],409)
        code,p,_=self.review(s,publish=False);self.assertEqual(code,200,p);approved=p['submission']
        self.assertEqual(approved['status'],'approved')
        self.assertFalse(any(x['reference']=='SV-'+s['id'] for x in self.call('GET','/api/catalogue',who=None)[1]))
        self.assertEqual(self.call('POST',f"/api/seller/submissions/{s['id']}/publish",{'revision':approved['revision']})[0],405)
        self.assertEqual(self.call('POST',path+'/publish',{'revision':s['revision']},'admin')[0],409)
        code,p,_=self.call('POST',path+'/publish',{'revision':approved['revision']},'admin');self.assertEqual(code,200,p)
        events=p['submission']['events'];self.assertEqual([e['to_stage'] for e in events],['draft','submitted','reviewing','approved','published'])
        self.assertEqual(events[-1]['actor_id'],3)

    def test_diagnostic_vin_eight_photos_and_expired_garage(self):
        s=self.draft(True);path=f"/api/seller/submissions/{s['id']}"
        data={**s['data'],'diagnosticVin':'VF3AAAAAAAAAAAAAA'}
        code,p,_=self.call('PUT',path,{'revision':s['revision'],'data':data});self.assertEqual(code,200);s=p['submission']
        self.assertEqual(self.call('POST',path+'/submit',{'revision':s['revision']})[0],400)
        data['diagnosticVin']=data['vin'];s=self.call('PUT',path,{'revision':s['revision'],'data':data})[1]['submission']
        # Diagnostic absent : même une galerie complète ne suffit pas.
        diagnostic=next(f for f in s['files'] if f['kind']=='diagnostic')
        self.assertEqual(self.call('DELETE','/api/seller/files/'+diagnostic['id'],{'revision':s['revision']})[0],200)
        s=self.call('GET',path)[1]['submission'];self.assertEqual(self.call('POST',path+'/submit',{'revision':s['revision']})[0],400)
        s=self.call('POST',path+'/files?kind=diagnostic',PDF)[1]['submission']
        # Une catégorie obligatoire absente est bloquante, même avec huit autres photos.
        front=next(f for f in s['files'] if f['kind']=='front')
        self.call('DELETE','/api/seller/files/'+front['id'],{'revision':s['revision']})
        s=self.call('GET',path)[1]['submission'];self.assertEqual(self.call('POST',path+'/submit',{'revision':s['revision']})[0],400)
        s=self.call('POST',path+'/files?kind=front',PNG,content_type='image/png')[1]['submission']
        try:
            self.call('PUT',f'/api/admin/seller/garages/{self.garage}',{'active':True,'validUntil':'2020-01-01'},'admin')
            self.assertEqual(self.call('POST',path+'/submit',{'revision':s['revision']})[0],400)
        finally:self.call('PUT',f'/api/admin/seller/garages/{self.garage}',{'active':True,'validUntil':'2099-12-31'},'admin')

    def test_duplicate_vin_and_photo_damage_ownership(self):
        first=self.draft(True);other=self.draft();path=f"/api/seller/submissions/{other['id']}"
        self.assertEqual(self.call('PUT',path,{'revision':other['revision'],'data':first['data']})[0],409)
        d={**first['data'],'vin':'VF3'+uuid.uuid4().hex[:14].upper()}
        self.assertEqual(self.call('PUT',path,{'revision':other['revision'],'data':d})[0],200)
        d=first['data'];d['damages']=[{'zone':'hood','type':'rayure','severity':'léger','description':'Rayure','photoIds':[uuid.uuid4().hex]}]
        code,p,_=self.call('PUT',f"/api/seller/submissions/{first['id']}",{'revision':first['revision'],'data':d});self.assertEqual(code,200)
        self.assertEqual(self.call('POST',f"/api/seller/submissions/{first['id']}/submit",{'revision':p['submission']['revision']})[0],400)
        d['damages'][0]['zone']='unknown'
        self.assertEqual(self.call('PUT',f"/api/seller/submissions/{first['id']}",{'revision':p['submission']['revision'],'data':d})[0],400)

    def test_temporary_document_access_expiration_and_pdf_rejection(self):
        s=self.draft(True);f=next(f for f in s['files'] if f['kind']=='registration')
        code,p,_=self.call('POST','/api/seller/files/'+f['id']+'/access',{});self.assertEqual(code,200)
        self.assertEqual(self.call('GET',p['url'])[0],200)
        self.assertEqual(self.call('GET',p['url'],who='other')[0],404)
        self.assertEqual(self.call('GET',p['url'],who=None)[0],401)
        self.sql("UPDATE seller_file_access SET expires_at='2000-01-01T00:00:00Z'")
        self.assertEqual(self.call('GET',p['url'])[0],404)
        for body in [b'%PDF-1.7 /JavaScript (bad)',b'%PDF-1.7 /J#61vaScript (bad)',b'%PDF-1.7 /Encrypt 3 0 R']:
            self.assertEqual(self.call('POST',f"/api/seller/submissions/{s['id']}/files?kind=diagnostic",body)[0],415)

    def test_upload_rate_limit_is_server_enforced(self):
        s=self.draft();path=f"/api/seller/submissions/{s['id']}/files?kind=diagnostic"
        for _ in range(20):self.assertEqual(self.call('POST',path,b'not a PDF')[0],415)
        self.assertEqual(self.call('POST',path,PDF)[0],429)

    def test_professional_document_requirements_and_retention(self):
        self.assertEqual(self.call('PUT','/api/seller/profile',{'name':'Pro','phone':'1234','address':'Tunis','sellerType':'professional'})[0],400)
        try:
            self.assertEqual(self.call('PUT','/api/seller/profile',{'name':'Pro','phone':'1234','address':'Tunis','sellerType':'professional','professionalNumber':'PRO-1'})[0],200)
            s=self.draft(True);path=f"/api/seller/submissions/{s['id']}"
            self.assertEqual(self.call('POST',path+'/submit',{'revision':s['revision']})[0],400)
            s=self.call('POST',path+'/files?kind=invoice',PDF)[1]['submission']
            s=self.submit(s);code,p,_=self.review(s,'rejected',feedback='Dossier incomplet');self.assertEqual(code,200)
            s=p['submission'];self.assertEqual(self.call('POST',path+'/archive',{'revision':s['revision']})[0],200)
            file_id=s['files'][0]['id'];self.sql(f"UPDATE seller_submissions SET updated_at='2020-01-01T00:00:00Z' WHERE id='{s['id']}'")
            self.assertEqual(self.call('POST','/api/admin/seller/cleanup',{},'admin')[0],200)
            self.assertEqual(self.call('GET','/api/seller/files/'+file_id)[0],404)
            redacted=self.call('GET',path)[1]['submission'];self.assertEqual(redacted['data'],{});self.assertIsNotNone(redacted['purged_at'])
            self.assertFalse(any(x['id']==s['id'] for x in self.call('GET','/api/seller/submissions')[1]['submissions']))
        finally:self.call('PUT','/api/seller/profile',{'name':'seller','phone':'12345678','address':'Adresse privée Tunis','sellerType':'individual'})

    def test_eur_publication_requires_validated_tnd_price_and_direct_offers(self):
        s=self.draft(True);d={**s['data'],'priceCurrency':'EUR','priceAmount':20000,'allowOffers':True}
        s=self.call('PUT',f"/api/seller/submissions/{s['id']}",{'revision':s['revision'],'data':d})[1]['submission']
        s=self.submit(s);code,p,_=self.review(s,publish=False);self.assertEqual(code,200);s=p['submission']
        path=f"/api/admin/seller/submissions/{s['id']}/publish"
        self.assertEqual(self.call('POST',path,{'revision':s['revision']},'admin')[0],400)
        self.assertEqual(self.call('POST',path,{'revision':s['revision'],'priceTnd':68000},'admin')[0],200)
        ref='SV-'+s['id'];body={'reference':ref,'amountTnd':65000}
        self.sql("UPDATE users SET terms_version=NULL WHERE id=2")
        self.assertEqual(self.call('POST','/api/seller/offers',body,'other')[0],409)
        self.sql("UPDATE users SET terms_version='2026-11-01' WHERE id IN (1,2)")
        self.assertEqual(self.call('POST','/api/seller/offers',body)[0],403)
        self.assertEqual(self.call('POST','/api/seller/offers',body,'other')[0],201)
        self.assertEqual(self.call('POST','/api/seller/offers',body,'other')[0],409)

    def test_document_rules_are_country_and_seller_specific(self):
        rule={'countryCode':'FR','sellerType':'individual','kind':'invoice','required':True}
        self.assertEqual(self.call('POST','/api/seller/document-rules',rule)[0],405)
        self.assertEqual(self.call('POST','/api/admin/seller/document-rules',rule,'admin')[0],200)
        try:
            s=self.draft(True);path=f"/api/seller/submissions/{s['id']}"
            code,p,_=self.call('POST',path+'/submit',{'revision':s['revision']});self.assertEqual(code,400)
            self.assertTrue(any('Facture' in m for m in p['missing']))
            s=self.call('POST',path+'/files?kind=invoice',PDF)[1]['submission']
            self.assertEqual(self.submit(s)['status'],'submitted')
        finally:self.call('POST','/api/admin/seller/document-rules',{**rule,'required':False},'admin')

    def test_photo_order_and_damage_details_are_published_without_private_data(self):
        s=self.draft(True);photos=[f for f in s['files'] if f['kind'] in PHOTO_KINDS]
        ids=[f['id'] for f in photos][::-1];path=f"/api/seller/submissions/{s['id']}"
        self.assertEqual(self.call('PUT',path+'/photos',{'revision':s['revision'],'order':ids,'main':uuid.uuid4().hex})[0],400)
        code,p,_=self.call('PUT',path+'/photos',{'revision':s['revision'],'order':ids,'main':ids[0]});self.assertEqual(code,200);s=p['submission']
        d={**s['data'],'powerKw':88,'equipment':['Apple CarPlay'],'damages':[{'zone':'hood','type':'rayure','severity':'léger','description':'Rayure constatée','photoIds':[ids[0]]}]}
        s=self.call('PUT',path,{'revision':s['revision'],'data':d})[1]['submission'];s=self.submit(s)
        self.assertEqual(self.review(s)[0],200)
        lot=next(x for x in self.call('GET','/api/catalogue',who=None)[1] if x['reference']=='SV-'+s['id'])
        self.assertEqual(lot['photos'][0]['url'],'/seller-media/'+ids[0])
        self.assertEqual(lot['damages'][0]['description'],'Rayure constatée')
        self.assertEqual(lot['equipment'],['Apple CarPlay']);self.assertEqual(lot['diagnostic']['garage'],'Garage partenaire')
        self.assertEqual(lot['diagnostic']['date'],s['data']['diagnosticDate'])
        for secret in [s['data']['vin'],s['data']['licensePlate'],s['data']['diagnosticReference']]:self.assertNotIn(secret,json.dumps(lot))

    def test_large_json_is_rejected_before_mutation(self):
        s=self.draft();path=f"/api/seller/submissions/{s['id']}"
        self.assertEqual(self.call('PUT',path,{'revision':s['revision'],'data':{'description':'x'*300000}})[0],413)
        after=self.call('GET',path)[1]['submission'];self.assertEqual(after['revision'],s['revision']);self.assertEqual(after['data'],{})

    def test_private_identifiers_in_free_text_block_publication(self):
        s=self.draft(True);d={**s['data'],'description':'Identifiant du véhicule : '+s['data']['vin'].lower()}
        path=f"/api/seller/submissions/{s['id']}"
        s=self.call('PUT',path,{'revision':s['revision'],'data':d})[1]['submission'];s=self.submit(s)
        self.assertEqual(self.review(s)[0],400)
        self.assertFalse(any(x['reference']=='SV-'+s['id'] for x in self.call('GET','/api/catalogue',who=None)[1]))

    def test_browser_partial_upload_failure_preserves_successful_photos(self):
        import re
        from playwright.sync_api import sync_playwright,expect
        with sync_playwright() as p:
            browser=p.chromium.launch();context=browser.new_context()
            context.add_cookies([{'name':'my_session','value':self.tokens['seller'],'url':self.base}])
            page=context.new_page();page.goto(self.base+'/vendre')
            page.get_by_role('button',name='Ajouter un véhicule',exact=True).click();self.identify_in_browser(page)
            page.locator('[data-step="4"]').click();expect(page.locator('#photos-step')).to_be_visible()
            attempts=[]
            def intercept(route):
                attempts.append(1)
                if len(attempts)==2:route.fulfill(status=429,json={'error':'Limite simulée : réessayez plus tard.'})
                else:route.continue_()
            page.route(re.compile(r'/api/seller/submissions/[a-f0-9]{32}/files\?kind=front$'),intercept)
            page.locator('[data-upload=front]').set_input_files([{'name':f'photo-{i}.png','mimeType':'image/png','buffer':PNG} for i in range(2)])
            expect(page.locator('#message')).to_have_text('Limite simulée : réessayez plus tard.')
            expect(page.locator('[data-photo]')).to_have_count(1)
            expect(page.locator('[data-upload=front]')).to_be_enabled()
            self.assertEqual(len(attempts),2)
            browser.close()

    def test_catalogue_edit_preserves_verified_metadata_and_blocks_offers_on_auction(self):
        s=self.draft(True);d={**s['data'],'allowOffers':True}
        s=self.call('PUT',f"/api/seller/submissions/{s['id']}",{'revision':s['revision'],'data':d})[1]['submission']
        s=self.submit(s);self.assertEqual(self.review(s)[0],200);ref='SV-'+s['id']
        lot=next(x for x in self.call('GET','/api/catalogue',who=None)[1] if x['reference']==ref)
        code,p,_=self.call('PUT','/api/admin/vehicles/'+ref,{**lot,'indicativePriceTnd':67000},'admin');self.assertEqual(code,200,p)
        updated=next(x for x in self.call('GET','/api/catalogue',who=None)[1] if x['reference']==ref)
        self.assertTrue(updated['diagnosticVerified']);self.assertTrue(updated['allowSellerOffers']);self.assertEqual(updated['diagnostic'],lot['diagnostic'])
        # Un changement du mode de vente par l'administration est immédiatement pris en compte.
        self.assertEqual(self.call('PUT','/api/admin/vehicles/'+ref,{**updated,'status':'open','endsAt':(datetime.now(timezone.utc)+timedelta(days=2)).isoformat()},'admin')[0],200)
        self.sql("UPDATE users SET terms_version='2026-11-01' WHERE id=2")
        self.assertEqual(self.call('POST','/api/seller/offers',{'reference':ref,'amountTnd':60000},'other')[0],409)

    def test_generic_admin_cannot_bypass_seller_validation(self):
        s=self.draft(True);ref='SV-'+s['id'];payload={'make':'Peugeot','model':'208','year':2021,'mileageKm':50000,'fuel':'Essence','status':'stock','photos':[]}
        self.assertEqual(self.call('PUT','/api/admin/vehicles/'+ref,payload,'admin')[0],409)
        s=self.submit(s);self.assertEqual(self.review(s)[0],200)
        lot=next(x for x in self.call('GET','/api/catalogue',who=None)[1] if x['reference']==ref)
        self.assertEqual(self.call('PUT','/api/admin/vehicles/'+ref,{**lot,'mileageKm':1},'admin')[0],409)
        self.assertEqual(self.call('PUT','/api/admin/vehicles/'+ref,{**lot,'photos':[]},'admin')[0],409)
