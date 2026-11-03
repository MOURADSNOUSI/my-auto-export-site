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
            self.assertEqual(json.loads(run('execute','DB','--command','PRAGMA foreign_key_check','--json'))[0]['results'],[])
