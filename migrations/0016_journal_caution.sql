-- Journal des ajustements manuels de caution (administration) : ancienne et nouvelle valeur, motif, auteur, date.
-- Trace financière : sans clé étrangère sur l'acheteur, elle reste conservée si son compte est supprimé.
CREATE TABLE deposit_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  previous_tnd INTEGER NOT NULL,
  new_tnd INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX deposit_adjustments_user ON deposit_adjustments(user_id, id);
