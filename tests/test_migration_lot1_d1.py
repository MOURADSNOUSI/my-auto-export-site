"""Migration d'une D1 locale peuplée avant le Lot 1, sans Worker ni données distantes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid

ROOT=Path(__file__).resolve().parents[1]
WRANGLER=os.environ.get('WRANGLER')

@unittest.skipUnless(WRANGLER,'définir WRANGLER pour vérifier la migration D1 locale')
class Lot1MigrationD1Test(unittest.TestCase):
    def test_migration_with_existing_offer_and_transaction(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);migrations=root/'migrations';migrations.mkdir()
            for source in (ROOT/'migrations').glob('*.sql'):
                if source.name<'0015':shutil.copyfile(source,migrations/source.name)
            config=root/'wrangler.json';config.write_text(json.dumps({'name':'lot1-migration-local','compatibility_date':'2026-10-01','main':str(ROOT/'worker/main.js'),'d1_databases':[{'binding':'DB','database_name':'lot1-local','database_id':str(uuid.uuid4()),'migrations_dir':str(migrations)}]}))
            def run(*args):
                p=subprocess.run([WRANGLER,'d1',*args,'--local','--persist-to',str(root/'state'),'--config',str(config)],cwd=ROOT,capture_output=True,text=True)
                self.assertEqual(p.returncode,0,p.stdout+p.stderr);return p.stdout
            run('migrations','apply','DB')
            run('execute','DB','--command',"INSERT INTO users(id,email,name,password_hash,password_salt) VALUES(1,'seller@example.test','Seller','unused','00'),(2,'buyer@example.test','Buyer','unused','00'); INSERT INTO seller_submissions(id,user_id,created_at,updated_at) VALUES('s',1,'2026','2026'); INSERT INTO vehicle_offers(id,submission_id,buyer_id,seller_id,amount_minor,currency,status,expires_at,rules_version,rules_snapshot,intention_at,created_at,updated_at) VALUES('old','s',2,1,50000,'TND','contract_confirmed','2099','old','{}','2026','2026','2026'); INSERT INTO transactions(id,offer_id,amount_minor,currency,status,created_at,updated_at) VALUES('tx','old',50000,'TND','contract_confirmed','2026','2026');")
            shutil.copyfile(ROOT/'migrations/0015_propositions_lot1.sql',migrations/'0015_propositions_lot1.sql')
            run('migrations','apply','DB')
            result=json.loads(run('execute','DB','--command',"SELECT o.id,o.status,o.historical_status,o.reserve_price_at_submission,t.id AS tx,t.status AS tx_status FROM vehicle_offers o JOIN transactions t ON t.offer_id=o.id",'--json'))[0]['results'][0]
            self.assertEqual(result,{'id':'old','status':'accepted','historical_status':'contract_confirmed','reserve_price_at_submission':None,'tx':'tx','tx_status':'contract_confirmed'})
            shutil.copyfile(ROOT/'migrations/0017_offres_libres.sql',migrations/'0017_offres_libres.sql')
            run('migrations','apply','DB')
            result=json.loads(run('execute','DB','--command',"SELECT o.id,o.status,o.historical_status,o.free_submission,t.id AS tx,t.status AS tx_status FROM vehicle_offers o JOIN transactions t ON t.offer_id=o.id",'--json'))[0]['results'][0]
            self.assertEqual(result,{'id':'old','status':'accepted','historical_status':'contract_confirmed','free_submission':0,'tx':'tx','tx_status':'contract_confirmed'})
            shutil.copyfile(ROOT/'migrations/0018_profils_acheteur_vendeur.sql',migrations/'0018_profils_acheteur_vendeur.sql')
            run('migrations','apply','DB')
            profiles=json.loads(run('execute','DB','--command',"SELECT id,buyer_enabled,seller_enabled FROM users ORDER BY id",'--json'))[0]['results']
            self.assertEqual(profiles,[{'id':1,'buyer_enabled':1,'seller_enabled':1},{'id':2,'buyer_enabled':1,'seller_enabled':0}])
            self.assertEqual(json.loads(run('execute','DB','--command','PRAGMA foreign_key_check','--json'))[0]['results'],[])

    def test_production_registry_with_paid_deposit_then_lot1_migrations(self):
        production_names={
            '0008_depot_garantie.sql','0009_paiements_caution.sql','0010_caution_devise_carte.sql',
            '0011_journal_seo.sql','0012_limites_par_ip.sql','0013_retrait_offre.sql',
        }
        production=[p for p in (ROOT/'migrations').glob('*.sql') if p.name<'0008' or p.name in production_names]
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);migrations=root/'migrations';migrations.mkdir()
            for source in production:shutil.copyfile(source,migrations/source.name)
            config=root/'wrangler.json';config.write_text(json.dumps({'name':'prod-schema-rehearsal','compatibility_date':'2026-10-01','main':str(ROOT/'worker/main.js'),'d1_databases':[{'binding':'DB','database_name':'prod-schema-local','database_id':str(uuid.uuid4()),'migrations_dir':str(migrations)}]}))
            def run(*args):
                p=subprocess.run([WRANGLER,'d1',*args,'--local','--persist-to',str(root/'state'),'--config',str(config)],cwd=ROOT,capture_output=True,text=True)
                self.assertEqual(p.returncode,0,p.stdout+p.stderr);return p.stdout
            run('migrations','apply','DB')
            run('execute','DB','--command',"INSERT INTO users(id,email,name,password_hash,password_salt,deposit_tnd,role) VALUES(1,'fixture@example.test','Local admin','unchanged-hash','unchanged-salt',2000,'admin'); INSERT INTO deposits(user_id,method,amount_tnd,status,stripe_session_id,charge_amount,charge_currency) VALUES(1,'card',2000,'paid','cs_test_legacy',58824,'eur'); INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('test-session-hash',1,'2099-01-01'); INSERT INTO login_known_ips(email,ip,at) VALUES('fixture@example.test','127.0.0.1','2026-11-01');")
            for source in (ROOT/'migrations').glob('*.sql'):shutil.copyfile(source,migrations/source.name)
            run('migrations','apply','DB')
            row=json.loads(run('execute','DB','--command',"SELECT u.id,u.role,u.password_hash,u.deposit_tnd,d.status,d.charge_amount,s.token_hash FROM users u JOIN deposits d ON d.user_id=u.id JOIN sessions s ON s.user_id=u.id",'--json'))[0]['results'][0]
            self.assertEqual(row,{'id':1,'role':'admin','password_hash':'unchanged-hash','deposit_tnd':2000,'status':'paid','charge_amount':58824,'token_hash':'test-session-hash'})
            row=json.loads(run('execute','DB','--command',"SELECT COUNT(*) AS n FROM d1_migrations",'--json'))[0]['results'][0]
            self.assertEqual(row['n'],23)  # 0001–0020 (0020 : prix estimés), dont les migrations historiques aux préfixes partagés.
            self.assertEqual(json.loads(run('execute','DB','--command','PRAGMA foreign_key_check','--json'))[0]['results'],[])
