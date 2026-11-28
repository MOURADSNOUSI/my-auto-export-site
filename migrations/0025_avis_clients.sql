-- Avis clients : un client dont le véhicule est remis (customer_vehicles « picked_up ») ou dont le mandat est livré
-- (mandats « livre ») dépose un avis noté de 1 à 5. Rien n'est publié avant la validation d'un administrateur.
-- Ajout seulement : aucune table existante n'est modifiée.
CREATE TABLE avis_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Achat concerné : un avis au plus par véhicule remis ou par mandat livré.
  source TEXT NOT NULL CHECK (source IN ('vehicule', 'mandat')),
  source_id INTEGER NOT NULL,
  reference TEXT NOT NULL,
  vehicule TEXT NOT NULL DEFAULT '',
  note INTEGER NOT NULL CHECK (note BETWEEN 1 AND 5),
  texte TEXT NOT NULL CHECK (length(texte) BETWEEN 10 AND 600),
  -- Nom publié (prénom, ou prénom et initiale), choisi par le client.
  nom_affiche TEXT NOT NULL CHECK (length(nom_affiche) BETWEEN 1 AND 40),
  -- Date à laquelle le client a accepté la publication de son avis, de ce nom et du modèle du véhicule.
  consenti_le TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'publie', 'refuse')),
  motif_refus TEXT NOT NULL DEFAULT '',
  decide_le TEXT,
  decide_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cree_le TEXT NOT NULL,
  mis_a_jour TEXT NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX avis_clients_statut ON avis_clients(statut, decide_le);
CREATE INDEX avis_clients_client ON avis_clients(user_id);
