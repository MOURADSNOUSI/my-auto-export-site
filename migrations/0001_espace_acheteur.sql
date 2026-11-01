-- Espace acheteur : comptes, sessions, favoris et offres.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (user_id, reference)
);

-- kind : bid = offre d'enchère, buy_now = demande d'achat immédiat. Toute offre est confirmée par l'équipe.
CREATE TABLE offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  amount_tnd INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bid', 'buy_now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'refused')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX offers_user ON offers(user_id);
CREATE INDEX offers_reference ON offers(reference);

-- Échecs de connexion récents, pour limiter les essais de mot de passe.
CREATE TABLE login_failures (
  email TEXT NOT NULL COLLATE NOCASE,
  at TEXT NOT NULL
);
CREATE INDEX login_failures_email ON login_failures(email, at);
