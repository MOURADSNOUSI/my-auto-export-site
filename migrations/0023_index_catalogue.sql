-- Refonte du catalogue (étape 3) : filtres et pagination faits par D1 pour tenir 20 000 annonces dans le plan gratuit
-- (10 ms de calcul par requête). Ajouts seulement : colonnes calculées (VIRTUAL, aucune donnée copiée) lues dans
-- vehicles.data, index des filtres, et compteurs des options de filtre recalculés après chaque écriture.
ALTER TABLE vehicles ADD COLUMN c_marque TEXT GENERATED ALWAYS AS (json_extract(data, '$.make')) VIRTUAL;
ALTER TABLE vehicles ADD COLUMN c_modele TEXT GENERATED ALWAYS AS (json_extract(data, '$.model')) VIRTUAL;
ALTER TABLE vehicles ADD COLUMN c_carrosserie TEXT GENERATED ALWAYS AS (json_extract(data, '$.bodyType')) VIRTUAL;
ALTER TABLE vehicles ADD COLUMN c_energie TEXT GENERATED ALWAYS AS (json_extract(data, '$.fuel')) VIRTUAL;
ALTER TABLE vehicles ADD COLUMN c_boite TEXT GENERATED ALWAYS AS (json_extract(data, '$.transmission')) VIRTUAL;
ALTER TABLE vehicles ADD COLUMN c_pays TEXT GENERATED ALWAYS AS (json_extract(data, '$.country')) VIRTUAL;
ALTER TABLE vehicles ADD COLUMN c_annee INTEGER GENERATED ALWAYS AS (json_extract(data, '$.year')) VIRTUAL;
ALTER TABLE vehicles ADD COLUMN c_km INTEGER GENERATED ALWAYS AS (json_extract(data, '$.mileageKm')) VIRTUAL;
ALTER TABLE vehicles ADD COLUMN c_prix_eur REAL GENERATED ALWAYS AS (json_extract(data, '$.prixEur')) VIRTUAL;
ALTER TABLE vehicles ADD COLUMN c_statut TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) VIRTUAL;

-- Tri par défaut (plus récents d'abord) et pagination par curseur (updated_at, reference).
CREATE INDEX vehicles_catalogue_recent ON vehicles(removed, updated_at DESC, reference DESC);
CREATE INDEX vehicles_catalogue_marque ON vehicles(removed, c_marque, c_modele);
CREATE INDEX vehicles_catalogue_prix ON vehicles(removed, c_prix_eur, reference);
CREATE INDEX vehicles_catalogue_annee ON vehicles(removed, c_annee);
CREATE INDEX vehicles_catalogue_km ON vehicles(removed, c_km);
CREATE INDEX vehicles_catalogue_energie ON vehicles(removed, c_energie);
CREATE INDEX vehicles_catalogue_pays ON vehicles(removed, c_pays);

-- Compteurs des options de filtre (marque, modèle, carrosserie, énergie, boîte, pays) sur tout le catalogue en ligne :
-- une ligne par filtre. Une modification du catalogue les marque périmés ; ils sont recalculés au plus une fois par
-- heure, et chaque nuit (worker/catalogue.js).
CREATE TABLE catalogue_compteurs (
  filtre TEXT PRIMARY KEY,
  valeurs TEXT NOT NULL,
  calcule_le TEXT NOT NULL,
  perime INTEGER NOT NULL DEFAULT 0 CHECK (perime IN (0, 1))
);
