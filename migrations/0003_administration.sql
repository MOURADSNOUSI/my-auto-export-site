-- Administration : rôle des comptes et véhicules gérés depuis /admin.html.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'admin'));

-- Une ligne par véhicule ajouté ou modifié dans l'administration. Elle remplace le véhicule de même
-- référence de lots.json ; removed = 1 le retire du site public (lots.json compris).
CREATE TABLE vehicles (
  reference TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
