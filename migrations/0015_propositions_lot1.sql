-- Lot 1 : réutilisation de vehicle_offers. Aucun minimum privé n'est rendu public.
-- Reconstruction additive en données : identifiants, acteurs, montants et historiques conservés.
PRAGMA defer_foreign_keys=ON;
-- Une ancienne proposition doit conserver une référence, même si son véhicule a été supprimé manuellement.
INSERT OR IGNORE INTO vehicles(reference,data,removed,updated_at,updated_by)
 SELECT 'SV-'||s.id,COALESCE(s.public_data,json_object('reference','SV-'||s.id)),1,s.updated_at,s.user_id
 FROM seller_submissions s WHERE EXISTS(SELECT 1 FROM vehicle_offers o WHERE o.submission_id=s.id);
CREATE TABLE vehicle_offers_lot1(
 id TEXT PRIMARY KEY,
 vehicle_id TEXT NOT NULL REFERENCES vehicles(reference),
 submission_id TEXT REFERENCES seller_submissions(id),
 buyer_id INTEGER NOT NULL REFERENCES users(id),seller_id INTEGER NOT NULL REFERENCES users(id),
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0 AND amount_minor<=100000000000),
 currency TEXT NOT NULL CHECK(currency IN ('TND','EUR')),
 reserve_price_at_submission INTEGER,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','cancelled','expired')),
 buyer_message TEXT NOT NULL DEFAULT '' CHECK(length(buyer_message)<=2000),
 historical_status TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,
 expires_at TEXT NOT NULL,rules_version TEXT NOT NULL,rules_snapshot TEXT NOT NULL,
 intention_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 actor_id INTEGER REFERENCES users(id),reason TEXT NOT NULL DEFAULT '',
 CHECK(buyer_id<>seller_id),
 CHECK((historical_status<>'' AND reserve_price_at_submission IS NULL) OR
  (typeof(reserve_price_at_submission)='integer' AND reserve_price_at_submission>0 AND amount_minor>=reserve_price_at_submission))
);
INSERT INTO vehicle_offers_lot1(id,vehicle_id,submission_id,buyer_id,seller_id,amount_minor,currency,status,historical_status,revision,expires_at,rules_version,rules_snapshot,intention_at,created_at,updated_at,actor_id,reason)
 SELECT id,'SV-'||submission_id,submission_id,buyer_id,seller_id,amount_minor,currency,
 CASE status WHEN 'submitted' THEN 'pending' WHEN 'accepted_by_seller' THEN 'accepted' WHEN 'awaiting_contract_confirmation' THEN 'accepted' WHEN 'contract_confirmed' THEN 'accepted' WHEN 'withdrawn' THEN 'cancelled' ELSE status END,
 status,revision,expires_at,rules_version,rules_snapshot,intention_at,created_at,updated_at,actor_id,reason FROM vehicle_offers;
DROP TABLE vehicle_offers;
ALTER TABLE vehicle_offers_lot1 RENAME TO vehicle_offers;
CREATE INDEX vehicle_offers_buyer ON vehicle_offers(buyer_id,created_at);
CREATE INDEX vehicle_offers_seller ON vehicle_offers(seller_id,status,created_at);
CREATE INDEX vehicle_offers_expiry ON vehicle_offers(status,expires_at);
CREATE INDEX vehicle_offers_vehicle ON vehicle_offers(vehicle_id,created_at);
CREATE UNIQUE INDEX marketplace_one_reservation ON vehicle_offers(vehicle_id) WHERE status='accepted';
CREATE UNIQUE INDEX marketplace_one_pending_buyer ON vehicle_offers(vehicle_id,buyer_id) WHERE status='pending';
CREATE TABLE vehicle_offer_owners(vehicle_id TEXT PRIMARY KEY REFERENCES vehicles(reference),seller_id INTEGER NOT NULL REFERENCES users(id),assigned_by INTEGER NOT NULL REFERENCES users(id),assigned_at TEXT NOT NULL);
CREATE INDEX vehicle_offer_owners_seller ON vehicle_offer_owners(seller_id);
-- Les anciens événements et transactions restent des preuves historiques ; pas de nouvel effet contractuel.
INSERT INTO offer_events(offer_id,from_status,to_status,reason,at)
 SELECT id,historical_status,status,'migration_lot1',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM vehicle_offers WHERE historical_status<>status;
UPDATE marketplace_policy SET contract_enabled=0,version='lot1-draft-1';
CREATE TRIGGER marketplace_offer_immutable BEFORE UPDATE OF vehicle_id,submission_id,buyer_id,seller_id,amount_minor,currency,reserve_price_at_submission,buyer_message,historical_status,rules_version,rules_snapshot ON vehicle_offers BEGIN SELECT RAISE(ABORT,'immutable_offer'); END;
CREATE TRIGGER marketplace_new_offer BEFORE INSERT ON vehicle_offers WHEN NEW.historical_status<>'' OR NEW.reserve_price_at_submission IS NULL BEGIN SELECT RAISE(ABORT,'reserve_required'); END;
CREATE TRIGGER marketplace_offer_created AFTER INSERT ON vehicle_offers BEGIN
 INSERT INTO offer_events(offer_id,actor_id,from_status,to_status,at) VALUES(NEW.id,NEW.buyer_id,'','pending',NEW.created_at);
 INSERT INTO notifications(user_id,event_code,resource_id,at) VALUES(NEW.seller_id,'offer.pending',NEW.id,NEW.created_at);
 INSERT INTO user_consents(user_id,purpose,version,resource_id,at) VALUES(NEW.buyer_id,'offer_intention',NEW.rules_version,NEW.id,NEW.intention_at);
 INSERT INTO audit_logs(actor_id,action,resource_id,at) VALUES(NEW.buyer_id,'offer.pending',NEW.id,NEW.created_at);
END;
CREATE TRIGGER marketplace_offer_changed AFTER UPDATE OF status ON vehicle_offers WHEN NEW.status<>OLD.status BEGIN
 INSERT INTO offer_events(offer_id,actor_id,from_status,to_status,reason,at) VALUES(NEW.id,NEW.actor_id,OLD.status,NEW.status,NEW.reason,NEW.updated_at);
 INSERT INTO notifications(user_id,event_code,resource_id,at) VALUES(NEW.buyer_id,'offer.'||NEW.status,NEW.id,NEW.updated_at);
 INSERT INTO notifications(user_id,event_code,resource_id,at) VALUES(NEW.seller_id,'offer.'||NEW.status,NEW.id,NEW.updated_at);
 INSERT INTO audit_logs(actor_id,action,resource_id,at) VALUES(NEW.actor_id,'offer.'||NEW.status,NEW.id,NEW.updated_at);
 UPDATE transactions SET status='cancelled',updated_at=NEW.updated_at WHERE offer_id=NEW.id AND NEW.status IN ('cancelled','expired');
END;
PRAGMA defer_foreign_keys=OFF;
