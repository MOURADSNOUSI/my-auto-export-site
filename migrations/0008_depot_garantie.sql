-- Dépôt de garantie (caution) reçu de l'acheteur, en dinars : requis pour pouvoir enchérir.
ALTER TABLE users ADD COLUMN deposit_tnd INTEGER NOT NULL DEFAULT 0;
