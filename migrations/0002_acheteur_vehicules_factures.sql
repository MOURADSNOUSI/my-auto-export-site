-- Dossiers de véhicules et factures visibles uniquement par leur propriétaire.
CREATE TABLE customer_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  trim TEXT,
  status TEXT NOT NULL DEFAULT 'purchased'
    CHECK (status IN ('purchased', 'in_preparation', 'ready_for_pickup', 'picked_up')),
  purchased_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (user_id, reference)
);
CREATE INDEX customer_vehicles_user ON customer_vehicles(user_id, purchased_at);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES customer_vehicles(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  total_tnd INTEGER NOT NULL CHECK (total_tnd >= 0),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'paid', 'void')),
  document_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (user_id, invoice_number)
);
CREATE INDEX invoices_user ON invoices(user_id, issued_at DESC);