-- Connexion avec Google (worker/google.js). Ajouts seulement : un compte peut être relié à un identifiant Google ;
-- les états de connexion en cours (10 minutes, usage unique) sont gardés le temps de l'aller-retour chez Google.
ALTER TABLE users ADD COLUMN google_id TEXT;
CREATE UNIQUE INDEX users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

CREATE TABLE google_etats (
  etat_hash TEXT PRIMARY KEY,
  verificateur TEXT NOT NULL,
  retour TEXT NOT NULL,
  expire TEXT NOT NULL
);
