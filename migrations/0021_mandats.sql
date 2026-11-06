-- Chantier 4 : demandes d'achat sur mandat. Ajouts seulement : les tables d'enchères et d'offres ne changent pas.
-- Montants en unités entières de la devise (TND pour un résident, EUR pour un Tunisien résidant à l'étranger).
CREATE TABLE mandats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reference TEXT NOT NULL,
  public TEXT NOT NULL CHECK (public IN ('resident', 'tre')),
  devise TEXT NOT NULL CHECK (devise IN ('TND', 'EUR')),
  prix_max INTEGER NOT NULL CHECK (prix_max > 0 AND prix_max <= 10000000),
  telephone TEXT NOT NULL,
  -- Réponses du formulaire et motif d'éligibilité calculé à la demande (null : rien à signaler).
  reponses TEXT NOT NULL DEFAULT '{}',
  eligibilite_auto TEXT,
  -- Copie des textes acceptés (mandat, CGV, conditions de l'acompte) et date d'acceptation.
  textes_acceptes TEXT NOT NULL,
  accepte_le TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'demande' CHECK (statut IN ('demande', 'eligibilite_verifiee', 'acompte_recu', 'achat_en_cours', 'achete', 'non_obtenu', 'livre', 'annule')),
  acompte INTEGER CHECK (acompte IS NULL OR (acompte > 0 AND acompte <= 10000000)),
  note_admin TEXT NOT NULL DEFAULT '',
  cree_le TEXT NOT NULL,
  mis_a_jour TEXT NOT NULL
);
CREATE INDEX mandats_client ON mandats(user_id, cree_le);
CREATE INDEX mandats_statut ON mandats(statut, cree_le);
-- Une seule demande en cours par client et par véhicule.
CREATE UNIQUE INDEX mandats_un_en_cours ON mandats(user_id, reference) WHERE statut NOT IN ('non_obtenu', 'livre', 'annule');

CREATE TABLE mandat_evenements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mandat_id INTEGER NOT NULL REFERENCES mandats(id),
  de TEXT NOT NULL,
  vers TEXT NOT NULL,
  acteur TEXT NOT NULL CHECK (acteur IN ('client', 'admin', 'mcp', 'agent')),
  acteur_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  le TEXT NOT NULL
);
CREATE INDEX mandat_evenements_mandat ON mandat_evenements(mandat_id, id);

-- Textes légaux provisoires, modifiables dans /admin-mandats. Montants d'acompte par défaut : exemples À REMPLACER.
INSERT OR IGNORE INTO reglages (cle, valeur, mis_a_jour) VALUES
  ('texte_mandat', 'MODÈLE PROVISOIRE — À FAIRE RELIRE PAR UN JURISTE.

Mandat d''achat. Le client (le mandant) charge M&Y AUTO EXPORT (le mandataire) d''acheter en son nom et pour son compte le véhicule désigné dans la demande, auprès d''un vendeur professionnel européen, pour un prix qui ne dépasse pas le prix maximum indiqué par le client (articles 1104 et suivants du Code des obligations et des contrats).

M&Y AUTO EXPORT ne garantit pas l''obtention du véhicule : si le véhicule n''est pas obtenu au prix maximum fixé, la demande passe au statut « non obtenu » et l''acompte est remboursé selon les conditions de l''acompte.

Après l''achat, M&Y AUTO EXPORT organise pour le compte du client le transport et les formalités de dédouanement avec son transitaire. Les droits, taxes et frais sont à la charge du client ; le devis définitif lui est communiqué avant tout paiement du solde.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('cgv_mandat', 'MODÈLE PROVISOIRE — À FAIRE RELIRE PAR UN JURISTE.

Conditions générales de l''achat sur mandat.
1. Demande : la demande n''engage pas M&Y AUTO EXPORT tant que l''éligibilité n''a pas été vérifiée et l''acompte reçu.
2. Prix : les prix affichés sur le site sont des estimations. Le devis définitif est établi après vérification par notre transitaire.
3. Rétractation : le client dispose d''un délai de dix jours ouvrables à compter de son acceptation pour se rétracter (loi n° 2000-83 relative aux échanges et au commerce électroniques). Les exceptions éventuelles sont à préciser par le juriste.
4. Données personnelles : les données de la demande (nom, e-mail, téléphone) servent uniquement au traitement du mandat (loi organique n° 2004-63). Le client peut y accéder et les faire rectifier en écrivant à contact@myautoexport.com.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('conditions_acompte', 'MODÈLE PROVISOIRE — À FAIRE RELIRE PAR UN JURISTE.

L''acompte est versé après la vérification de l''éligibilité, sur demande de M&Y AUTO EXPORT, qui en indique le montant. Il n''est pas encaissé en ligne.
Il est remboursé intégralement si le véhicule n''est pas obtenu, si M&Y AUTO EXPORT annule la demande, ou en cas de rétractation dans le délai légal. Il est déduit du prix total une fois le véhicule acheté.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('acompte_defaut_tnd', '1000', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('acompte_defaut_eur', '300', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
