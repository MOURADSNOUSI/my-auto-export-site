-- Limites d'essais par adresse IP : un tiers ne peut plus bloquer la connexion d'un compte en tapant de faux mots
-- de passe depuis chez lui, et les inscriptions comme les enregistrements d'applications MCP en masse sont freinés.
-- Une ligne de login_failures est réservée avant chaque vérification de mot de passe (supprimée en cas de succès).
ALTER TABLE login_failures ADD COLUMN ip TEXT;
CREATE INDEX login_failures_ip ON login_failures(ip, at);

-- Adresses d'où le titulaire s'est déjà connecté : la limite globale du compte ne s'y applique pas.
CREATE TABLE login_known_ips (
  email TEXT NOT NULL COLLATE NOCASE,
  ip TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (email, ip)
);

-- Tentatives d'inscription (réussies ou non), par IP.
CREATE TABLE registrations (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX registrations_ip ON registrations(ip, at);

ALTER TABLE oauth_clients ADD COLUMN ip TEXT;
CREATE INDEX oauth_clients_ip ON oauth_clients(ip, created_at);
