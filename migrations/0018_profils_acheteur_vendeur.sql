-- Identité et connexion communes ; habilitations métier indépendantes.
ALTER TABLE users ADD COLUMN buyer_enabled INTEGER NOT NULL DEFAULT 1 CHECK(buyer_enabled IN (0,1));
ALTER TABLE users ADD COLUMN seller_enabled INTEGER NOT NULL DEFAULT 0 CHECK(seller_enabled IN (0,1));
UPDATE users SET seller_enabled=1
 WHERE id IN (SELECT user_id FROM seller_profiles)
 OR id IN (SELECT user_id FROM seller_submissions)
 OR id IN (SELECT seller_id FROM vehicle_offer_owners)
 OR id IN (SELECT seller_id FROM vehicle_offers WHERE seller_id IS NOT NULL);
