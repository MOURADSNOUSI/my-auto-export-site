-- Phase 1. Aucun montant historique n'est converti, aucune table existante de comptes n'est reconstruite.
CREATE TABLE marketplace_roles(user_id INTEGER NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('garage','moderator')),PRIMARY KEY(user_id,role));
CREATE TABLE marketplace_suspensions(user_id INTEGER PRIMARY KEY REFERENCES users(id),reason TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES users(id),at TEXT NOT NULL);
CREATE TABLE marketplace_policy(id INTEGER PRIMARY KEY CHECK(id=1),version TEXT NOT NULL,offer_hours INTEGER NOT NULL CHECK(offer_hours BETWEEN 1 AND 720),confirmation_hours INTEGER NOT NULL CHECK(confirmation_hours BETWEEN 1 AND 720),withdrawal_allowed INTEGER NOT NULL CHECK(withdrawal_allowed IN (0,1)),contract_enabled INTEGER NOT NULL DEFAULT 0 CHECK(contract_enabled IN (0,1)),legal_review_reference TEXT NOT NULL DEFAULT '',min_photos INTEGER NOT NULL DEFAULT 8 CHECK(min_photos BETWEEN 7 AND 20),retention_days INTEGER NOT NULL DEFAULT 180 CHECK(retention_days BETWEEN 30 AND 3650),identity_required INTEGER NOT NULL DEFAULT 0 CHECK(identity_required IN (0,1)),identity_procedure TEXT NOT NULL DEFAULT '');
INSERT INTO marketplace_policy VALUES(1,'phase1-draft-1',72,168,1,0,'',8,180,0,'');
ALTER TABLE seller_files ADD COLUMN document_type TEXT NOT NULL DEFAULT '';
CREATE TABLE seller_financials(submission_id TEXT PRIMARY KEY REFERENCES seller_submissions(id),currency TEXT NOT NULL CHECK(currency IN ('TND','EUR')),asking_minor INTEGER NOT NULL CHECK(typeof(asking_minor)='integer' AND asking_minor>0 AND asking_minor<=100000000000),minimum_minor INTEGER CHECK(minimum_minor IS NULL OR (typeof(minimum_minor)='integer' AND minimum_minor>=0 AND minimum_minor<=asking_minor)),available_from TEXT NOT NULL DEFAULT '',availability TEXT NOT NULL DEFAULT 'available' CHECK(availability IN ('available','unavailable','sold')),delivery_terms TEXT NOT NULL DEFAULT '');
ALTER TABLE partner_garages ADD COLUMN source_type TEXT NOT NULL DEFAULT 'partner' CHECK(source_type IN ('partner','mandated','authorized'));
ALTER TABLE partner_garages ADD COLUMN authorization_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE seller_diagnostics ADD COLUMN diagnostic_status TEXT NOT NULL DEFAULT 'missing' CHECK(diagnostic_status IN ('missing','submitted','under_review','approved','rejected','expired'));
ALTER TABLE seller_diagnostics ADD COLUMN valid_until TEXT;
ALTER TABLE seller_diagnostics ADD COLUMN reservations TEXT NOT NULL DEFAULT '';
CREATE TABLE garage_assignments(submission_id TEXT PRIMARY KEY REFERENCES seller_submissions(id),garage_id INTEGER NOT NULL REFERENCES partner_garages(id),user_id INTEGER NOT NULL REFERENCES users(id),assigned_by INTEGER NOT NULL REFERENCES users(id),at TEXT NOT NULL);
CREATE INDEX garage_assignments_user ON garage_assignments(user_id);
CREATE TABLE vehicle_offers(id TEXT PRIMARY KEY,submission_id TEXT NOT NULL REFERENCES seller_submissions(id),buyer_id INTEGER NOT NULL REFERENCES users(id),seller_id INTEGER NOT NULL REFERENCES users(id),amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0 AND amount_minor<=100000000000),currency TEXT NOT NULL CHECK(currency IN ('TND','EUR')),status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','accepted_by_seller','rejected','expired','withdrawn','awaiting_contract_confirmation','contract_confirmed','cancelled')),revision INTEGER NOT NULL DEFAULT 0,expires_at TEXT NOT NULL,rules_version TEXT NOT NULL,rules_snapshot TEXT NOT NULL,intention_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),reason TEXT NOT NULL DEFAULT '',CHECK(buyer_id<>seller_id));
CREATE INDEX vehicle_offers_buyer ON vehicle_offers(buyer_id,created_at);
CREATE INDEX vehicle_offers_seller ON vehicle_offers(seller_id,status);
CREATE UNIQUE INDEX marketplace_one_reservation ON vehicle_offers(submission_id) WHERE status IN ('accepted_by_seller','awaiting_contract_confirmation','contract_confirmed');
CREATE UNIQUE INDEX marketplace_one_pending_buyer ON vehicle_offers(submission_id,buyer_id) WHERE status='submitted';
CREATE TABLE transactions(id TEXT PRIMARY KEY,offer_id TEXT NOT NULL UNIQUE REFERENCES vehicle_offers(id),amount_minor INTEGER NOT NULL,currency TEXT NOT NULL CHECK(currency IN ('TND','EUR')),status TEXT NOT NULL DEFAULT 'awaiting_contract_confirmation' CHECK(status IN ('awaiting_contract_confirmation','contract_confirmed','cancelled','disputed','closed')),buyer_confirmed_at TEXT,seller_confirmed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE offer_events(id INTEGER PRIMARY KEY AUTOINCREMENT,offer_id TEXT NOT NULL REFERENCES vehicle_offers(id),actor_id INTEGER REFERENCES users(id),from_status TEXT NOT NULL,to_status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',at TEXT NOT NULL);
CREATE INDEX offer_events_offer ON offer_events(offer_id,id);
CREATE TABLE notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),event_code TEXT NOT NULL,resource_id TEXT NOT NULL,read_at TEXT,at TEXT NOT NULL);
CREATE INDEX notifications_user ON notifications(user_id,id);
CREATE TABLE audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id INTEGER REFERENCES users(id),action TEXT NOT NULL,resource_id TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE user_consents(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),purpose TEXT NOT NULL,version TEXT NOT NULL,resource_id TEXT NOT NULL DEFAULT '',at TEXT NOT NULL);
CREATE INDEX user_consents_user ON user_consents(user_id,id);
CREATE TABLE moderation_reports(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),submission_id TEXT REFERENCES seller_submissions(id),offer_id TEXT REFERENCES vehicle_offers(id),category TEXT NOT NULL CHECK(category IN ('listing','dispute','complaint')),message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','rejected')),resolution TEXT NOT NULL DEFAULT '',reviewed_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE privacy_requests(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('access','correction','deletion')),message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','rejected')),resolution TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TRIGGER marketplace_offer_immutable BEFORE UPDATE OF amount_minor,currency,buyer_id,seller_id,submission_id,rules_version,rules_snapshot ON vehicle_offers BEGIN SELECT RAISE(ABORT,'immutable_offer'); END;
CREATE TRIGGER marketplace_transaction_money BEFORE UPDATE OF amount_minor,currency,offer_id ON transactions BEGIN SELECT RAISE(ABORT,'immutable_transaction'); END;
CREATE TRIGGER marketplace_offer_created AFTER INSERT ON vehicle_offers BEGIN
 INSERT INTO offer_events(offer_id,actor_id,from_status,to_status,at) VALUES(NEW.id,NEW.buyer_id,'','submitted',NEW.created_at);
 INSERT INTO notifications(user_id,event_code,resource_id,at) VALUES(NEW.seller_id,'offer.submitted',NEW.id,NEW.created_at);
 INSERT INTO user_consents(user_id,purpose,version,resource_id,at) VALUES(NEW.buyer_id,'offer_intention',NEW.rules_version,NEW.id,NEW.intention_at);
 INSERT INTO audit_logs(actor_id,action,resource_id,at) VALUES(NEW.buyer_id,'offer.submitted',NEW.id,NEW.created_at);
END;
CREATE TRIGGER marketplace_offer_changed AFTER UPDATE OF status ON vehicle_offers WHEN NEW.status<>OLD.status BEGIN
 INSERT INTO offer_events(offer_id,actor_id,from_status,to_status,reason,at) VALUES(NEW.id,NEW.actor_id,OLD.status,NEW.status,NEW.reason,NEW.updated_at);
 INSERT INTO notifications(user_id,event_code,resource_id,at) VALUES(NEW.buyer_id,'offer.'||NEW.status,NEW.id,NEW.updated_at);
 INSERT INTO notifications(user_id,event_code,resource_id,at) VALUES(NEW.seller_id,'offer.'||NEW.status,NEW.id,NEW.updated_at);
 INSERT INTO audit_logs(actor_id,action,resource_id,at) VALUES(NEW.actor_id,'offer.'||NEW.status,NEW.id,NEW.updated_at);
 UPDATE transactions SET status='cancelled',updated_at=NEW.updated_at WHERE offer_id=NEW.id AND NEW.status IN ('expired','cancelled');
END;
CREATE TRIGGER marketplace_submission_audit AFTER UPDATE OF stage ON seller_submissions WHEN OLD.stage<>NEW.stage BEGIN
 INSERT INTO audit_logs(actor_id,action,resource_id,at) VALUES(NEW.mutation_actor,'listing.'||NEW.stage,NEW.id,NEW.updated_at);
 INSERT INTO notifications(user_id,event_code,resource_id,at) VALUES(NEW.user_id,'listing.'||NEW.stage,NEW.id,NEW.updated_at);
END;
CREATE TABLE marketplace_api_attempts(user_id INTEGER NOT NULL REFERENCES users(id),at TEXT NOT NULL);
CREATE INDEX marketplace_api_rate ON marketplace_api_attempts(user_id,at);
CREATE TRIGGER marketplace_diagnostic_uploaded AFTER INSERT ON seller_files WHEN NEW.kind='diagnostic' BEGIN
 UPDATE seller_diagnostics SET diagnostic_status='submitted',verified_at=NULL,verified_by=NULL WHERE submission_id=NEW.submission_id;
END;
CREATE TRIGGER marketplace_diagnostic_removed AFTER DELETE ON seller_files WHEN OLD.kind='diagnostic' BEGIN
 UPDATE seller_diagnostics SET diagnostic_status='missing',verified_at=NULL,verified_by=NULL WHERE submission_id=OLD.submission_id AND NOT EXISTS(SELECT 1 FROM seller_files WHERE submission_id=OLD.submission_id AND kind='diagnostic');
END;
