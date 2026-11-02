# PROMPT CODEX — Développer l'espace vendeur M&Y AUTO EXPORT

## 1. Mission

Tu es un ingénieur logiciel senior Full Stack spécialisé dans Cloudflare Workers, D1, R2, JavaScript, sécurité applicative et plateformes d'enchères automobiles.

**Projet :** M&Y AUTO EXPORT  
**Site :** https://www.myautoexport.com  
**GitHub :** https://github.com/MOURADSNOUSI/my-auto-export-site

**Objectif :** développer un espace vendeur professionnel permettant aux particuliers et professionnels de proposer leurs véhicules à la vente directe ou aux enchères.

Prendre comme référence fonctionnelle le document `OPENLANE Sell.pdf` fourni, sans copier son identité visuelle, ses éléments graphiques propriétaires ou son code.

**Règle fondamentale : aucun véhicule proposé par un utilisateur ne doit être publié sans diagnostic automobile réalisé par un garage agréé par M&Y AUTO EXPORT et vérification préalable par un administrateur.**

## 2. Audit préalable du projet

Avant de développer :

- Examiner la structure actuelle du dépôt GitHub.
- Identifier les fonctionnalités existantes : authentification, rôles, administration, annonces, enchères et fichiers.
- Étudier le Worker Cloudflare, les migrations D1 et le stockage R2.
- Réutiliser les composants existants et préserver leur fonctionnement.
- Ne pas modifier les règles des enchères existantes.
- Créer une branche `feature/marketplace-vendeurs-diagnostic`.

Éviter toute refonte inutile.

## 3. Espace vendeur

Ajouter un bouton visible dans la navigation :

**« Vendre mon véhicule »**

Créer un espace accessible aux utilisateurs connectés comprenant :

- Déposer un véhicule
- Mes annonces
- Mes brouillons
- Mes diagnostics
- Mes documents
- État de validation
- Messages de l'administration

Permettre de créer, enregistrer, modifier et soumettre une annonce.

## 4. Formulaire de dépôt de véhicule

Concevoir un formulaire moderne, responsive, organisé en étapes, inspiré de la structure fonctionnelle d'OPENLANE Sell.

### Étape 1 — Identification du véhicule

Champs :

- Marque et modèle
- Version et finition
- Numéro VIN (17 caractères)
- Immatriculation
- Date de première mise en circulation
- Date de production (facultative)
- Kilométrage
- Pays d'origine
- Pays de première immatriculation
- Localisation du véhicule

### Étape 2 — Caractéristiques techniques

- Motorisation
- Essence, diesel, hybride, électrique
- Puissance kW et chevaux
- Cylindrée
- Boîte de vitesses
- Nombre de rapports
- Transmission
- Carrosserie
- Nombre de portes
- Nombre de places
- Norme Euro
- Émissions CO₂
- Couleur extérieure et intérieure

### Étape 3 — Équipements

Créer des catégories avec cases à cocher :

- Confort
- Climatisation
- Multimédia
- Navigation
- Toit ouvrant / panoramique
- Aides à la conduite
- Sécurité
- Stationnement
- Sièges
- Éclairage
- Jantes et pneumatiques

Permettre la recherche rapide des équipements.

### Étape 4 — Historique et entretien

- Historique d'entretien
- Date et kilométrage du dernier entretien
- Nombre de propriétaires précédents
- Accidents connus
- Réparations importantes
- Contrôle technique et validité
- État mécanique déclaré
- État de fonctionnement

### Étape 5 — Photos

Créer un module d'upload multiphotos comprenant :

- Avant
- Arrière
- Côté gauche
- Côté droit
- Intérieur
- Tableau de bord avec kilométrage
- Compartiment moteur
- Coffre
- Dommages visibles

Fonctionnalités :

- Glisser-déposer
- Aperçu des images
- Réorganisation
- Suppression
- Choix de la photo principale
- Compression adaptée
- Contrôle des formats et tailles
- Stockage R2

Prévoir au minimum 8 photos pour pouvoir soumettre l'annonce, avec contrôle côté serveur.

### Étape 6 — Inspection des dommages

Créer un module interactif d'inspection automobile.

Afficher un schéma générique original du véhicule, avec sélection des zones :

- Pare-chocs
- Capot
- Portières
- Ailes
- Toit
- Coffre
- Jantes
- Vitrages

Pour chaque dommage :

- Localisation
- Type : rayure, bosse, fissure, impact, corrosion, etc.
- Niveau de gravité
- Description
- Photos justificatives

Associer chaque dommage aux zones du schéma et enregistrer les informations dans D1.

Ne pas utiliser les illustrations propriétaires d'OPENLANE.

## 5. Diagnostic automobile obligatoire

**Fonctionnalité prioritaire.**

Seuls les diagnostics réalisés par des garages partenaires agréés par M&Y AUTO EXPORT pourront permettre la publication d'une annonce.

Créer un référentiel des garages agréés avec :

- Identifiant du garage
- Raison sociale
- Adresse
- Coordonnées
- Numéro professionnel
- Statut d'agrément
- Date de validité de l'agrément

Le vendeur sélectionne son garage dans une liste de partenaires actifs.

Il doit obligatoirement joindre :

- Rapport de diagnostic PDF
- Date de l'inspection
- Référence du rapport
- Garage ayant effectué le diagnostic
- Kilométrage relevé
- VIN du véhicule inspecté

Contrôler la correspondance entre le VIN de l'annonce et celui du rapport, avec validation humaine en cas de données non lisibles.

Prévoir ultérieurement un espace professionnel permettant aux garages de remplir et signer directement leurs diagnostics.

Le diagnostic devra pouvoir couvrir :

- Moteur
- Boîte de vitesses
- Freinage
- Suspension
- Direction
- Électronique
- Batterie, notamment pour les hybrides et électriques
- Carrosserie
- Pneumatiques
- Défauts constatés

Un rapport téléversé ne doit jamais être considéré comme automatiquement authentique.

**La confirmation par un administrateur est obligatoire.**

## 6. Documents du véhicule

Créer un module de téléchargement sécurisé pour :

- Certificat d'immatriculation
- Justificatif de propriété ou de droit de vente
- Contrôle technique lorsqu'il est applicable
- Carnet d'entretien
- Factures disponibles
- Diagnostic du garage
- Autres documents justificatifs

Distinguer les pièces obligatoires des pièces facultatives selon le pays et le type de vendeur.

Les documents personnels doivent rester strictement privés.

Utiliser un stockage R2 privé, des autorisations par utilisateur et des accès temporaires sécurisés.

Ne jamais publier automatiquement les cartes grises, documents d'identité ou justificatifs personnels.

## 7. Prix et mode de vente

Proposer deux modes :

**Vente directe**

- Prix fixe
- Devise EUR ou TND
- Description commerciale
- Possibilité de recevoir des offres

**Vente aux enchères**

- Prix de départ
- Prix de réserve facultatif
- Date de début
- Date de fin
- Réutilisation du système d'enchères existant

L'administrateur doit approuver le véhicule avant son activation sur le site.

Ne pas déclencher les enchères immédiatement après la soumission du vendeur.

## 8. Circuit de validation

Mettre en place les statuts suivants :

1. Brouillon
2. Soumis
3. En cours de vérification
4. Corrections demandées
5. Approuvé
6. Refusé
7. Publié
8. Archivé

Lorsqu'un vendeur soumet un véhicule :

- Vérifier les champs obligatoires.
- Vérifier le nombre minimal de photos.
- Vérifier les documents requis.
- Vérifier la présence du diagnostic PDF.
- Vérifier que le garage sélectionné est agréé et actif.
- Mettre le dossier dans la file d'attente administrative.

Créer dans `/admin.html` une rubrique **« Annonces vendeurs à valider »**.

L'administrateur pourra :

- Consulter le dossier complet.
- Visualiser les photos.
- Examiner les documents privés.
- Vérifier le garage et le diagnostic.
- Demander des corrections.
- Approuver ou refuser l'annonce.
- Autoriser sa publication.
- Consulter l'historique de validation.

Aucun vendeur ne doit pouvoir modifier directement son statut en « Approuvé » ou « Publié ».

## 9. Affichage sur le site public

Après validation, publier l'annonce dans le catalogue existant.

Ajouter une indication :

**« Diagnostic vérifié par M&Y AUTO EXPORT »**

Afficher :

- Nom du garage agréé
- Date du diagnostic
- Informations techniques
- Photos
- Équipements
- Défauts et dommages déclarés
- Résumé du diagnostic autorisé à la publication
- Prix ou enchères

Prévoir une mention précisant qu'un diagnostic de garage ne remplace pas les obligations légales de contrôle technique et ne constitue pas une garantie d'absence de défaut.

## 10. Architecture et sécurité

Respecter l'architecture existante :

- Frontend du site existant
- API Cloudflare Workers
- Base D1
- Stockage R2
- Authentification existante

Créer les migrations nécessaires pour :

- Annonces vendeurs
- Garages agréés
- Documents
- Diagnostics
- Photos
- Dommages
- Historique de validation

Mettre en place :

- Contrôle d'accès vendeur / administrateur
- Validation serveur de tous les champs
- Protection contre les fichiers malveillants
- Limitation de taille et de fréquence des uploads
- Noms de fichiers aléatoires
- Historique d'audit
- Protection contre les doublons
- Protection des données personnelles
- Politique de conservation et suppression des fichiers
- Gestion des erreurs et des soumissions concurrentes

Les règles de sécurité doivent être contrôlées côté serveur, jamais uniquement dans le navigateur.

## 11. Interface et ergonomie

Créer une interface :

- Professionnelle
- Responsive mobile et ordinateur
- Cohérente avec l'identité M&Y AUTO EXPORT
- Facile à utiliser pour les particuliers
- Adaptée aux professionnels ayant plusieurs véhicules

Ajouter :

- Barre de progression du formulaire
- Sauvegarde en brouillon
- Messages d'erreur précis
- Prévisualisation de l'annonce
- Indicateur des pièces manquantes
- Tableau de bord des véhicules déposés

## 12. Tests obligatoires

Prévoir des tests couvrant notamment :

- Création d'annonce
- Sauvegarde et modification des brouillons
- Upload des photos
- Upload du diagnostic
- Rejet de soumission sans diagnostic
- Rejet lorsque le garage n'est pas agréé
- Vérification du VIN
- Accès non autorisé aux documents
- Validation administrateur
- Publication après approbation
- Régression du système d'enchères existant

Vérifier que les annonces publiques existantes continuent de fonctionner.

## 13. Livrables attendus

1. Code source opérationnel.
2. Migrations D1.
3. Configuration du stockage R2.
4. API et interfaces vendeur.
5. Interface de gestion administrative.
6. Tests automatisés.
7. Documentation technique et fonctionnelle.
8. Instructions de déploiement.
9. Pull Request GitHub détaillée.

## 14. Consignes finales

Commence par auditer le dépôt existant et identifier les composants réutilisables.

Développe ensuite la fonctionnalité de bout en bout sur une branche dédiée.

Ne crée pas de solution parallèle incompatible avec le site existant.

Utilise les bonnes pratiques de développement, de sécurité et d'accessibilité.

Exécute les tests disponibles et corrige les erreurs.

Présente un récapitulatif des fichiers modifiés, des nouvelles routes API, des migrations et des éventuelles limitations.

**Autorisation : développement, commits et ouverture d'une Pull Request.**

**Interdiction : aucun déploiement en production, aucune migration de la base de production, aucune publication d'annonce réelle et aucune fusion dans la branche principale sans mon autorisation explicite.**