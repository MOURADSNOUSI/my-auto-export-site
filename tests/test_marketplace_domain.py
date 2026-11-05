"""Contraintes de migrations et valeurs monétaires, sans dépendance réseau."""
import json
from pathlib import Path
import sqlite3
import subprocess
import unittest

ROOT=Path(__file__).resolve().parents[1]

class MarketplaceDomainTest(unittest.TestCase):
    def test_exact_minor_units(self):
        script="""import {toMinor,decimal} from './worker/marketplace-domain.js';
        const cases=[['0.001','TND',1],['12345.67','EUR',1234567],['90000,123','TND',90000123]];
        for(const [s,c,n] of cases){if(toMinor(s,c)!==n)throw Error(s);if(toMinor(decimal(n,c),c)!==n)throw Error('roundtrip');}
        for(const [s,c] of [['1.001','EUR'],['1e3','TND'],['-1','TND'],['1000000000000','TND'],['1','USD'],[1.01,'EUR']]){let failed=false;try{toMinor(s,c);}catch{failed=true;}if(!failed)throw Error('accepted '+s);}
        """
        subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,check=True,capture_output=True,text=True)

    def test_migrations_preserve_legacy_data_and_enforce_integrity(self):
        db=sqlite3.connect(':memory:');self.addCleanup(db.close);db.execute('PRAGMA foreign_keys=ON')
        paths=sorted((ROOT/'migrations').glob('*.sql'))
        for p in paths:
            if p.name>='0011':break
            db.executescript(p.read_text())
        db.execute("INSERT INTO users(id,email,name,password_hash,password_salt) VALUES(1,'a@test','A','h','s'),(2,'b@test','B','h','s')")
        db.execute("INSERT INTO offers(user_id,reference,amount_tnd,kind) VALUES(1,'LEGACY',1234,'buy_now')")
        for p in paths:
            if p.name>='0011':db.executescript(p.read_text())
        self.assertEqual(db.execute('SELECT amount_tnd FROM offers').fetchone()[0],1234)
        self.assertFalse(db.execute('PRAGMA foreign_key_check').fetchall())
        self.assertEqual(db.execute('SELECT contract_enabled FROM marketplace_policy').fetchone()[0],0)
        db.execute("INSERT INTO seller_submissions(id,user_id,created_at,updated_at) VALUES('s',1,'2026-01-01','2026-01-01')")
        db.execute("INSERT INTO vehicles(reference,data) VALUES('SV-s','{}')")
        insert="INSERT INTO vehicle_offers(id,vehicle_id,submission_id,buyer_id,seller_id,amount_minor,currency,reserve_price_at_submission,status,expires_at,rules_version,rules_snapshot,intention_at,created_at,updated_at) VALUES(?,'SV-s','s',2,1,100000,'TND',100000,?,'2099','v','{}','2026','2026','2026')"
        db.execute(insert,('a','accepted'))
        with self.assertRaises(sqlite3.IntegrityError):db.execute(insert,('b','accepted'))
        with self.assertRaises(sqlite3.IntegrityError):db.execute("UPDATE vehicle_offers SET amount_minor=1 WHERE id='a'")
        self.assertEqual(db.execute('SELECT COUNT(*) FROM notifications').fetchone()[0],1)

    def test_image_metadata_parsers(self):
        script="""import {stripMetadata} from './worker/upload.js';
        const jpeg=Uint8Array.from([255,216,255,225,0,6,69,88,73,70,255,218,0,2,255,217]);
        const result=stripMetadata(jpeg,'image/jpeg');if(result.length!==8)throw Error('JPEG EXIF');
        const webp=new Uint8Array(12+10+12);webp.set(new TextEncoder().encode('RIFF'),0);webp.set(new TextEncoder().encode('WEBP'),8);webp.set(new TextEncoder().encode('VP8 '),12);new DataView(webp.buffer).setUint32(16,2,true);webp.set(new TextEncoder().encode('EXIF'),22);new DataView(webp.buffer).setUint32(26,4,true);
        const stripped=stripMetadata(webp,'image/webp');if(stripped.length!==22||new DataView(stripped.buffer).getUint32(4,true)!==14)throw Error('WEBP EXIF');
        for(const type of ['image/png','image/jpeg','image/webp']){let failed=false;try{stripMetadata(new Uint8Array([1,2,3]),type);}catch{failed=true;}if(!failed)throw Error(type);}
        """
        subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,check=True,capture_output=True,text=True)

    def test_lot1_migration_preserves_previous_offers_events_and_transactions(self):
        db=sqlite3.connect(':memory:');self.addCleanup(db.close);db.execute('PRAGMA foreign_keys=ON')
        for p in sorted((ROOT/'migrations').glob('*.sql')):
            if p.name<'0015':db.executescript(p.read_text())
        db.execute("INSERT INTO users(id,email,name,password_hash,password_salt) VALUES(1,'a@test','A','h','s'),(2,'b@test','B','h','s')")
        db.execute("INSERT INTO seller_submissions(id,user_id,created_at,updated_at) VALUES('s',1,'2026','2026')")
        db.execute("INSERT INTO seller_financials(submission_id,currency,asking_minor,minimum_minor) VALUES('s','TND',100000,90000)")
        db.execute("INSERT INTO vehicle_offers(id,submission_id,buyer_id,seller_id,amount_minor,currency,status,expires_at,rules_version,rules_snapshot,intention_at,created_at,updated_at) VALUES('old','s',2,1,50000,'TND','contract_confirmed','2099','old','{}','2026','2026','2026')")
        db.execute("INSERT INTO transactions(id,offer_id,amount_minor,currency,status,buyer_confirmed_at,seller_confirmed_at,created_at,updated_at) VALUES('tx','old',50000,'TND','contract_confirmed','2026','2026','2026','2026')")
        before=db.execute('SELECT COUNT(*) FROM offer_events').fetchone()[0];db.commit()
        db.executescript('BEGIN;'+(ROOT/'migrations/0015_propositions_lot1.sql').read_text()+'COMMIT;')
        self.assertEqual(db.execute("SELECT status,historical_status,reserve_price_at_submission FROM vehicle_offers WHERE id='old'").fetchone(),('accepted','contract_confirmed',None))
        self.assertEqual(db.execute("SELECT offer_id,status FROM transactions WHERE id='tx'").fetchone(),('old','contract_confirmed'))
        self.assertEqual(db.execute('SELECT COUNT(*) FROM offer_events').fetchone()[0],before+1)
        self.assertEqual(db.execute("SELECT minimum_minor FROM seller_financials WHERE submission_id='s'").fetchone()[0],90000)
        self.assertEqual(db.execute("SELECT removed FROM vehicles WHERE reference='SV-s'").fetchone()[0],1)
        self.assertFalse(db.execute('PRAGMA foreign_key_check').fetchall())
