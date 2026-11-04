-- Demandes de dépôt de garantie : carte bancaire (Stripe, validée par webhook) ou virement (validé par un administrateur).
CREATE TABLE deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('card', 'transfer')),
  amount_tnd INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  stripe_session_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  confirmed_at TEXT
);
CREATE INDEX deposits_user ON deposits(user_id, status);
