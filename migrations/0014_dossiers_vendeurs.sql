-- Les droits vendeur complètent le compte existant sans lui donner de droits administrateur.
CREATE TABLE seller_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE partner_garages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, address TEXT NOT NULL, contact TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE seller_submissions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','corrections','rejected','approved')),
  data TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  feedback TEXT NOT NULL DEFAULT '',
  submitted_at TEXT, reviewed_at TEXT, reviewed_by INTEGER REFERENCES users(id),
  diagnostic_verified_at TEXT,
  public_data TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX seller_submissions_user ON seller_submissions(user_id);
CREATE TABLE seller_files (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES seller_submissions(id),
  kind TEXT NOT NULL CHECK(kind IN ('exterior','interior','dashboard','defects','registration','ownership','diagnostic')),
  storage_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL, size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX seller_files_submission ON seller_files(submission_id);
