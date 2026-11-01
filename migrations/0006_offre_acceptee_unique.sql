-- Décisions de l'administration sur les offres : date et auteur de l'acceptation ou du refus.
ALTER TABLE offers ADD COLUMN decided_at TEXT;
ALTER TABLE offers ADD COLUMN decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Une seule offre acceptée par véhicule : deux décisions simultanées ne peuvent pas vendre le même lot deux fois.
-- Échoue si la base contient déjà deux offres acceptées pour une même référence (à corriger avant d'appliquer).
CREATE UNIQUE INDEX offers_une_acceptee ON offers(reference) WHERE status = 'accepted';
