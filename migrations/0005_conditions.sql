-- Acceptation des conditions générales de vente (conditions.html) : version et date, par compte.
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
