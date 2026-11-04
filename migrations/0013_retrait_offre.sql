-- Offre retirée par l'acheteur : elle passe en « refused » (donc n'est plus comptée) et garde la date du retrait.
ALTER TABLE offers ADD COLUMN withdrawn_at TEXT;
