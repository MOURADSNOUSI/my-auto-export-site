-- Connexion avec Apple et Facebook (worker/connexion-sociale.js). Ajouts seulement : un compte peut être relié à un
-- identifiant Apple et à un identifiant Facebook ; les états de connexion en cours des trois fournisseurs (10 minutes,
-- usage unique) sont gardés dans une table commune. google_etats (0022) n'est plus utilisée et reste en place.
ALTER TABLE users ADD COLUMN apple_id TEXT;
ALTER TABLE users ADD COLUMN facebook_id TEXT;
CREATE UNIQUE INDEX users_apple_id ON users(apple_id) WHERE apple_id IS NOT NULL;
CREATE UNIQUE INDEX users_facebook_id ON users(facebook_id) WHERE facebook_id IS NOT NULL;

CREATE TABLE connexion_etats (
  etat_hash TEXT PRIMARY KEY,
  fournisseur TEXT NOT NULL CHECK (fournisseur IN ('google', 'apple', 'facebook')),
  verificateur TEXT NOT NULL,
  retour TEXT NOT NULL,
  expire TEXT NOT NULL
);
