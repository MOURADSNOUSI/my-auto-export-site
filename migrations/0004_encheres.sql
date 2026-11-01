-- Enchères en direct : les enchères sont les lignes de offers avec kind = 'bid'.
-- Index pour retrouver vite la meilleure enchère et la dernière enchère d'un lot.
CREATE INDEX offers_bids ON offers(reference, kind, amount_tnd DESC, created_at);
