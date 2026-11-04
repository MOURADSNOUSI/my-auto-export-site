-- Montant réellement encaissé par carte (en centimes, devise Stripe) pour vérifier le webhook.
ALTER TABLE deposits ADD COLUMN charge_amount INTEGER;
ALTER TABLE deposits ADD COLUMN charge_currency TEXT;
