-- Réglages du site (interrupteur des automatisations, droits de l'agent local ; plus tard numéro WhatsApp, règles
-- d'éligibilité, textes légaux) et journal des actions d'écriture. Le journal réutilise audit_logs (marketplace), qui
-- reçoit le type d'acteur, des détails et le résultat. Ajouts seulement : les lignes existantes gardent acteur NULL
-- (action d'un utilisateur du site).
CREATE TABLE reglages (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL,
  mis_a_jour TEXT NOT NULL,
  mis_a_jour_par INTEGER REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO reglages (cle, valeur, mis_a_jour) VALUES
  ('automations_actives', 'true', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('agent_ecriture_autorisee', 'false', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

ALTER TABLE audit_logs ADD COLUMN acteur TEXT CHECK (acteur IS NULL OR acteur IN ('admin', 'mcp', 'agent', 'systeme'));
ALTER TABLE audit_logs ADD COLUMN details TEXT;
ALTER TABLE audit_logs ADD COLUMN resultat TEXT CHECK (resultat IS NULL OR resultat IN ('ok', 'refuse', 'erreur'));
CREATE INDEX audit_logs_at ON audit_logs(at);
