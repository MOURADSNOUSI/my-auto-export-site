# CODEX — M&Y AUTO EXPORT
## PHASE 1 : Marketplace automobile et gestion des offres d'achat

### 1. Contexte du projet

**Site :** https://www.myautoexport.com
**Dépôt GitHub :** `MOURADSNOUSI/my-auto-export-site`
**Projet :** M&Y AUTO EXPORT
**Marché initial :** Tunisie
**Marchés futurs :** France, Europe et Afrique du Nord
**Technologies existantes :** Cloudflare Workers, Cloudflare D1 et architecture actuelle du dépôt.

Tu interviens en tant que développeur full-stack senior, architecte logiciel et spécialiste de la sécurité applicative.

Ta mission est de développer la **phase 1 d'une marketplace automobile**, intégrée au site existant, sans casser les fonctionnalités déjà en production.

**Règle impérative : aucun déploiement en production sans mon autorisation explicite.**

---

### 2. Audit préalable obligatoire

Avant toute modification :

1. Examiner le dépôt GitHub et sa branche principale.
2. Lire `README.md`, `AGENTS.md`, `CLAUDE.md`, `TASKS.md` lorsqu'ils existent.
3. Identifier le framework, le système d'authentification et le schéma D1.
4. Examiner les migrations SQL existantes.
5. Identifier les fonctionnalités de publication automatique, les annonces importées et les éventuelles intégrations Facebook.
6. Examiner les mécanismes d'upload d'images et de documents.
7. Identifier les API et les composants réutilisables.
8. Vérifier les tests et scripts de build.

**Ne pas réécrire le site et ne pas remplacer son architecture actuelle sans nécessité documentée.**

Créer une branche dédiée :

`feature/marketplace-phase1`

---

### 3. Périmètre fonctionnel

Développer une marketplace permettant :

- L'inscription et l'authentification des vendeurs et acheteurs.
- La publication d'annonces automobiles par des particuliers et professionnels.
- L'importation de photos et documents.
- L'ajout obligatoire d'un rapport de diagnostic.
- La vérification et la validation administrative des annonces.
- La consultation publique des véhicules approuvés.
- La soumission d'offres d'achat privées.
- L'acceptation ou le refus manuel d'une offre par le vendeur.
- La confirmation contractuelle explicite des deux parties.
- L'enregistrement et la traçabilité des actions.
- La modération et la gestion des litiges.

**Exclusions de la phase 1 :**

- Pas d'enchères chronométrées avec gagnant automatique.
- Pas d'adjudication automatique.
- Pas de paiement, caution ou séquestre collecté pour le compte des vendeurs.
- Pas de commission prélevée automatiquement sur les fonds des tiers.
- Pas de transfert automatique de propriété.
- Pas de publication automatique d'annonces utilisateurs.
- Pas de qualification des diagnostics internes comme homologation étatique.

---

### 4. Gestion des utilisateurs et des rôles

Prévoir les rôles :

| Rôle | Permissions principales |
|---|---|
| Visiteur | Rechercher et consulter les annonces publiques |
| Acheteur | Soumettre et suivre ses offres |
| Vendeur particulier | Déposer et administrer ses véhicules |
| Vendeur professionnel | Gérer plusieurs véhicules et les informations de son entreprise |
| Garage partenaire | Déposer un rapport de diagnostic sur les dossiers qui lui sont attribués |
| Modérateur | Vérifier les annonces et documents |
| Administrateur | Superviser les comptes, annonces, offres et incidents |

Exigences de sécurité :

- Contrôle d'accès côté serveur sur chaque opération sensible.
- Aucune possibilité pour un vendeur de modifier les offres des acheteurs.
- Aucune exposition publique des pièces d'identité, cartes grises ou documents confidentiels.
- Vérification des permissions sur chaque ressource.
- Protection contre les accès non autorisés aux documents et les abus d'API.
- Réutiliser le système d'authentification existant lorsqu'il est adapté.

---

### 5. Formulaire de dépôt d'un véhicule

Conserver les champs existants et ajouter ou harmoniser :

**Identification**

- Marque
- Modèle
- Version et finition
- Première mise en circulation
- Année
- VIN / numéro de châssis, privé par défaut
- Pays d'immatriculation
- Localisation du véhicule

**Caractéristiques**

- Carburant
- Boîte de vitesses
- Kilométrage
- Puissance
- Cylindrée
- Couleur
- Type de carrosserie
- Nombre de portes
- Nombre de sièges
- Condition générale
- Historique d'entretien
- Dommages et réparations connus

**Commercialisation**

- Prix demandé
- Devise (TND ou EUR)
- Prix minimum acceptable, strictement privé
- Offres d'achat autorisées : oui/non
- Date de disponibilité
- Conditions de livraison
- Statut de disponibilité du véhicule

Ne pas ajouter de mécanisme de compte à rebours ou de désignation automatique du meilleur enchérisseur.

Les valeurs financières sont stockées en unités monétaires mineures, avec devise explicite. Aucune conversion TND/EUR implicite ou approximative.

---

### 6. Photos et documents obligatoires

**Photos :**

- Minimum configurable, avec objectif de 7 à 8 photos.
- Photo principale.
- Extérieur.
- Intérieur.
- Tableau de bord.
- Kilométrage.
- Défauts et dommages visibles.

**Documents privés :**

- Certificat d'immatriculation.
- Justificatif de propriété ou mandat de vente.
- Documents d'identification du vendeur selon la procédure applicable.
- Rapport de diagnostic.
- Documents complémentaires facultatifs.

Exigences techniques :

- Réutiliser Cloudflare R2 si déjà configuré ; sinon proposer une migration adaptée, sans l'appliquer en production.
- Validation du type réel, de la taille et du contenu des fichiers.
- Protection contre les fichiers malveillants.
- Stockage privé des documents sensibles.
- Accès temporaire et autorisé aux fichiers.
- Suppression des métadonnées EXIF des photos publiques lorsque nécessaire.
- Journalisation des accès administratifs sensibles.
- Politique de conservation et de suppression des documents configurable.

Les données personnelles ne doivent jamais apparaître dans les logs applicatifs.

---

### 7. Diagnostic automobile obligatoire

Chaque annonce doit posséder un diagnostic validé avant publication.

Créer les statuts :

- `missing`
- `submitted`
- `under_review`
- `approved`
- `rejected`
- `expired`

Informations du diagnostic :

- Identifiant du véhicule.
- Garage ou contrôleur.
- Date du contrôle.
- Kilométrage constaté.
- État mécanique.
- État carrosserie.
- Défauts signalés.
- Réserves éventuelles.
- Rapport PDF.
- Date de validité.
- Identité du validateur.

Le diagnostic doit pouvoir provenir :

1. D'un garage partenaire enregistré.
2. D'un prestataire de contrôle mandaté par la plateforme.
3. D'une autre source autorisée après validation administrative.

Les garages sont qualifiés de *partenaires validés par M&Y AUTO EXPORT*, sans prétendre à un agrément officiel non obtenu.

---

### 8. Gestion des offres d'achat privées

Créer un module permettant à un acheteur authentifié de soumettre une offre sur un véhicule approuvé.

**Workflow :**

1. L'acheteur consulte une annonce.
2. Il clique sur « Faire une offre ».
3. Il saisit un montant et sa devise.
4. Il consulte les conditions de l'offre.
5. Il confirme son intention de soumettre l'offre.
6. Le système enregistre l'offre.
7. Le vendeur reçoit une notification.
8. Le vendeur peut accepter, refuser ou laisser expirer l'offre.
9. En cas d'acceptation, les parties passent à une étape distincte de confirmation contractuelle.
10. La transaction est finalisée en dehors du système de paiement de la plateforme en phase 1.

Statuts proposés :

- `submitted`
- `accepted_by_seller`
- `rejected`
- `expired`
- `withdrawn`
- `awaiting_contract_confirmation`
- `contract_confirmed`
- `cancelled`

Une acceptation par le vendeur **ne doit pas être affichée comme une adjudication automatique ni comme un transfert de propriété**.

Les règles relatives au caractère contraignant des offres, aux délais, au retrait et à la confirmation doivent être configurables et soumises à validation juridique.

Ne jamais afficher publiquement le prix de réserve privé ou les informations personnelles des enchérisseurs.

---

### 9. Modération et administration

Créer un espace privé `/admin/marketplace` avec :

- Tableau de bord des annonces.
- Annonces en attente de validation.
- Vérification des diagnostics.
- Vérification des documents.
- Liste des vendeurs.
- Liste des garages partenaires.
- Historique des offres.
- Signalements.
- Suspensions de comptes.
- Journal d'audit.

Aucune annonce utilisateur n'est rendue publique avant validation.

En cas de rejet, enregistrer le motif et permettre au vendeur de corriger son dossier.

Les modifications d'une annonce déjà approuvée portant sur des éléments significatifs doivent déclencher une nouvelle validation.

---

### 10. Modèle de données Cloudflare D1

Auditer d'abord les tables existantes et éviter les doublons.

Prévoir, uniquement si nécessaire, les entités :

- `users`
- `user_profiles`
- `seller_profiles`
- `vehicles`
- `vehicle_media`
- `vehicle_documents`
- `diagnostic_reports`
- `partner_garages`
- `vehicle_offers`
- `offer_events`
- `transactions`
- `moderation_reviews`
- `notifications`
- `audit_logs`
- `user_consents`

Exigences :

- Identifiants uniques.
- Clés étrangères.
- Index pertinents.
- Contraintes d'intégrité.
- Transitions d'état contrôlées.
- Historique des actions importantes.
- Dates en UTC.
- Migrations versionnées.
- Migrations compatibles avec les données existantes.
- Tests sur une base D1 locale ou de prévisualisation, jamais directement en production.

Les opérations critiques, notamment la décision sur une offre, doivent être atomiques et résistantes aux requêtes concurrentes.

---

### 11. Interfaces utilisateur

Respecter l'identité visuelle existante de M&Y AUTO EXPORT.

Créer les pages nécessaires :

- `/vendre` : déposer un véhicule.
- `/mes-vehicules` : gérer les annonces.
- `/vehicules/:id` : fiche détaillée.
- `/mes-offres` : suivi des offres acheteur.
- `/vendeur/offres` : gestion des offres reçues.
- `/garages` : interface des partenaires habilités.
- `/admin/marketplace` : administration.

Adapter la page d'accueil existante avec :

**« Vendez votre véhicule sur M&Y AUTO EXPORT »**

Et un bouton :

**« Déposer mon véhicule »**

La page doit rester responsive, accessible, utilisable sur mobile et compatible avec les annonces automobiles déjà importées.

Prévoir une structure internationalisable, en commençant par le français, tout en permettant l'ajout de l'arabe et de l'anglais.

---

### 12. Conformité fonctionnelle et confidentialité

Prévoir des pages et mécanismes pour :

- Mentions légales.
- Conditions générales d'utilisation.
- Conditions applicables aux vendeurs.
- Conditions de soumission des offres.
- Politique de confidentialité.
- Gestion des consentements.
- Signalements et réclamations.
- Demandes d'accès, correction et suppression des données.

Ne pas générer de clauses juridiques définitives en affirmant leur conformité. Préparer des modèles signalés comme nécessitant la validation d'un juriste tunisien.

La société tunisienne devra accomplir les formalités applicables auprès de l'INPDP, notamment lorsque des données sont hébergées ou transférées hors de Tunisie.

---

### 13. Sécurité et tests

Développer des tests automatisés couvrant au minimum :

1. Création d'un compte vendeur.
2. Dépôt d'un véhicule incomplet.
3. Refus de publication sans diagnostic approuvé.
4. Publication après validation administrative.
5. Soumission d'une offre authentifiée.
6. Rejet d'une offre non autorisée.
7. Acceptation manuelle d'une offre.
8. Protection contre l'acceptation concurrente d'offres incompatibles.
9. Accès interdit aux documents d'autres utilisateurs.
10. Revalidation après modification d'un véhicule.
11. Protection contre les injections SQL, XSS et CSRF selon l'architecture.
12. Vérification des permissions administrateur.
13. Non-régression des annonces existantes.
14. Isolation des environnements local, preview et production.

Ne jamais écrire de secrets dans le dépôt, les fichiers de test ou les logs.

---

### 14. Coordination GitHub et livraison

Respecter la configuration de collaboration IA existante.

Utiliser la branche :

`feature/marketplace-phase1`

Découper la réalisation en étapes vérifiables :

- Lot A : audit et architecture.
- Lot B : modèle de données et migrations.
- Lot C : comptes et permissions.
- Lot D : dépôt des véhicules et documents.
- Lot E : diagnostics et modération.
- Lot F : offres d'achat.
- Lot G : interfaces et notifications.
- Lot H : sécurité, tests et documentation.

Pour chaque lot :

- Implémenter le code.
- Ajouter les tests.
- Documenter les changements.
- Exécuter les contrôles disponibles.
- Produire un compte rendu des résultats.
- Signaler les risques résiduels.

Créer une Pull Request vers la branche principale, sans fusion automatique.

Ne pas modifier les workflows de production, les intégrations Facebook ou les automatisations de collecte sans nécessité et sans autorisation.

---

### 15. Critères d'acceptation

La phase 1 sera considérée techniquement prête lorsque :

- Un vendeur peut créer un compte et déposer une annonce.
- Le véhicule dispose de photos et de documents privés.
- Un diagnostic peut être téléchargé et validé.
- Un administrateur peut approuver ou refuser l'annonce.
- Seuls les véhicules approuvés sont visibles publiquement.
- Un acheteur peut soumettre une offre.
- Un vendeur peut accepter ou refuser manuellement.
- La confirmation contractuelle est distincte de l'acceptation de l'offre.
- Les accès et les actions sensibles sont sécurisés et tracés.
- Les annonces existantes du site continuent de fonctionner.
- Les tests et le build passent.
- Aucune adjudication ou collecte de paiement n'a été introduite.
- Aucune modification n'a été déployée en production.

---

### 16. Consigne finale à Codex

Commence par auditer le dépôt réel.

Présente brièvement les constats d'architecture et les risques de compatibilité. Ensuite, implémente progressivement la phase 1 sur la branche dédiée, en privilégiant les changements minimaux, réversibles et testés.

N'invente ni structure de projet, ni API, ni migration existante : vérifie le code réel.

Si une intégration nécessite des identifiants, un service payant, une décision juridique ou une opération irréversible, ne l'active pas sans autorisation.

**Livrables attendus :**

- Code source fonctionnel.
- Migrations SQL.
- Tests automatisés.
- Documentation d'installation et d'exploitation.
- Pull Request GitHub.
- Rapport des changements.
- Liste des points juridiques ou techniques bloquants.

**Autorisation accordée : développement, tests locaux et création d'une Pull Request.**

**Autorisation non accordée : fusion dans la branche principale, modification de la base de production, publication de véhicules ou déploiement en production.**
