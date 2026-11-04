-- Extension additive : le statut historique reste compatible, stage porte le nouveau circuit.
ALTER TABLE seller_profiles ADD COLUMN seller_type TEXT NOT NULL DEFAULT 'individual' CHECK(seller_type IN ('individual','professional'));
ALTER TABLE seller_profiles ADD COLUMN professional_number TEXT NOT NULL DEFAULT '';
ALTER TABLE partner_garages ADD COLUMN professional_number TEXT NOT NULL DEFAULT '';
ALTER TABLE partner_garages ADD COLUMN valid_until TEXT;
ALTER TABLE seller_submissions ADD COLUMN stage TEXT NOT NULL DEFAULT 'draft' CHECK(stage IN ('draft','submitted','reviewing','corrections','approved','rejected','published','archived'));
ALTER TABLE seller_submissions ADD COLUMN mutation_token TEXT;
ALTER TABLE seller_submissions ADD COLUMN public_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE seller_submissions ADD COLUMN purged_at TEXT;
UPDATE seller_submissions SET stage=CASE status WHEN 'pending' THEN 'submitted' WHEN 'approved' THEN 'published' ELSE status END;
-- Les anciens doublons doivent être régularisés avant d'ajouter un VIN à une nouvelle annonce.
CREATE TABLE seller_vin_claims(vin TEXT PRIMARY KEY, submission_id TEXT NOT NULL UNIQUE REFERENCES seller_submissions(id));
INSERT OR IGNORE INTO seller_vin_claims(vin,submission_id)
 SELECT UPPER(json_extract(data,'$.vin')),id FROM seller_submissions
 WHERE LENGTH(json_extract(data,'$.vin'))=17 AND stage NOT IN ('archived','rejected') ORDER BY created_at;
CREATE TABLE seller_files_new (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES seller_submissions(id),
 kind TEXT NOT NULL CHECK(kind IN ('exterior','front','rear','left','right','interior','dashboard','engine','trunk','defects','registration','ownership','diagnostic','roadworthiness','service_book','invoice','other')),
 storage_key TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL, size INTEGER NOT NULL,
 created_at TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1))
);
INSERT INTO seller_files_new(id,submission_id,kind,storage_key,content_type,size,created_at) SELECT id,submission_id,kind,storage_key,content_type,size,created_at FROM seller_files;
DROP TABLE seller_files;
ALTER TABLE seller_files_new RENAME TO seller_files;
CREATE INDEX seller_files_submission ON seller_files(submission_id);
CREATE TABLE seller_diagnostics (
 submission_id TEXT PRIMARY KEY REFERENCES seller_submissions(id), garage_id INTEGER REFERENCES partner_garages(id),
 report_reference TEXT NOT NULL, inspected_vin TEXT NOT NULL, mileage_km INTEGER,
 inspection_date TEXT NOT NULL, observations TEXT NOT NULL, verified_by INTEGER REFERENCES users(id), verified_at TEXT
);
CREATE TABLE seller_damages (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES seller_submissions(id),
 zone TEXT NOT NULL, damage_type TEXT NOT NULL, severity TEXT NOT NULL, description TEXT NOT NULL, photo_ids TEXT NOT NULL
);
CREATE INDEX seller_damages_submission ON seller_damages(submission_id);
CREATE TABLE seller_validation_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, submission_id TEXT NOT NULL REFERENCES seller_submissions(id),
 actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL, from_stage TEXT NOT NULL, to_stage TEXT NOT NULL,
 message TEXT NOT NULL DEFAULT '', at TEXT NOT NULL
);
CREATE INDEX seller_events_submission ON seller_validation_events(submission_id,id);
CREATE TABLE seller_upload_attempts(user_id INTEGER NOT NULL REFERENCES users(id), at TEXT NOT NULL);
CREATE INDEX seller_upload_limits ON seller_upload_attempts(user_id,at);
CREATE TABLE seller_file_access (
 token_hash TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES seller_files(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL
);
CREATE TABLE seller_file_deletions(storage_key TEXT PRIMARY KEY, requested_at TEXT NOT NULL);
ALTER TABLE seller_submissions ADD COLUMN mutation_actor INTEGER REFERENCES users(id);
CREATE TRIGGER seller_files_delete_queue BEFORE DELETE ON seller_files BEGIN
 INSERT OR IGNORE INTO seller_file_deletions(storage_key,requested_at) VALUES(OLD.storage_key,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER seller_stage_audit AFTER UPDATE OF stage ON seller_submissions WHEN OLD.stage<>NEW.stage BEGIN
 INSERT INTO seller_validation_events(submission_id,actor_id,action,from_stage,to_stage,message,at)
 VALUES(NEW.id,NEW.mutation_actor,NEW.stage,OLD.stage,NEW.stage,NEW.feedback,NEW.updated_at);
END;
