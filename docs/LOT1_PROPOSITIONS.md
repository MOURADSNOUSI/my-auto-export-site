# Lot 1 — propositions d'achat automobile

## Résultat et base de travail

Dépôt vérifié via le remote Git : `MOURADSNOUSI/my-auto-export-site` (un seul S à NOUSI). Branche dédiée `feature/lot1-propositions-achat`, fondée sur la marketplace de la PR #10 ; le slogan « Véhicules sans frontières » demandé précédemment est conservé. Les travaux non commités du pied de page dans l'autre worktree ne sont pas incorporés. La PR du Lot 1 doit être relue sur cette base avant toute intégration ; aucune fusion ni production n'est autorisée.

L'acheteur ouvre « Proposer une offre » depuis une carte, une fiche existante ou `/vehicules/:reference`. La fenêtre affiche véhicule/référence, réserve, devise, montant, message facultatif et conditions versionnées. Une session est requise avant envoi. Le vendeur retrouve ses propositions dans `/vendeur/offres` ; l'acheteur les suit et peut annuler une proposition en attente dans `/mes-offres`. Les décisions et échéances produisent un historique et des notifications internes. Aucun e-mail n'est envoyé.

Accepter une proposition ne crée ni transaction nouvelle, ni véhicule acheté, ni facture, ni paiement. Les suites de la vente restent manuelles et hors plateforme. Les étapes contractuelles de la phase précédente sont hors périmètre et leurs routes sont fermées.

## Audit et choix de la réserve

- La réserve historique existe dans `vehicles.data.reservePriceTnd` pour les annonces administrées, et dans les données du catalogue statique avant matérialisation dans D1. Elle est réutilisée ; aucun deuxième champ D1 ne duplique cette réserve.
- Le minimum acceptable `seller_financials.minimum_minor` reste strictement privé, conformément à la réponse explicite de l'utilisateur. Il ne sert ni de réserve publique ni de seuil transmis au navigateur.
- Les dossiers vendeurs disposent d'une réserve publique distincte, saisie dans leur devise : `seller_submissions.data.reservePriceMinor`, incluse dans l'instantané approuvé `vehicles.data`. Les millimes TND et centimes EUR sont des entiers exacts. Aucun change implicite. Le champ transitoire `publicReserveMinor` de l'API sert uniquement à la présentation uniforme.
- Sans réserve publique valide, l'envoi reste bloqué. Aucun repli vers un minimum privé, une mise à prix ou un prix demandé ne fabrique une réserve.
- Le fichier statique audité contient 21 véhicules ; un seul possède déjà `reservePriceTnd`. Les 20 autres ont besoin d'une valeur métier fournie par le responsable avant activation des propositions. Aucun montant n'a été inventé.
- Les annonces importées n'ont pas de propriétaire vendeur explicite dans le schéma initial. `updated_by` identifie un éditeur, pas un vendeur. `vehicle_offer_owners` ajoute cette relation uniquement pour ces annonces ; les annonces SV réutilisent `seller_submissions.user_id`.

## Contrôle serveur et confidentialité

`POST /api/marketplace/offers` relit le véhicule dans D1. Il contrôle session, suspension, propriétaire, activité, devise et réserve officielle. Le JSON du client ne peut pas remplacer la réserve ni le vendeur. Le montant est un entier positif borné en unités mineures ; le montant inférieur reçoit exactement :

> Votre offre doit être supérieure ou égale au prix de réserve de ce véhicule.

L'insertion atomique compare aussi l'instantané du véhicule et son propriétaire : une modification concurrente force le rechargement. Une même personne ne peut pas déposer plusieurs propositions en attente sur un véhicule. Dix tentatives rapprochées au maximum par minute et par compte sont admises ; les tentatives répétées échouent sans créer d'offres supplémentaires. Les écritures utilisent des paramètres SQL. L'origine est vérifiée par le Worker. Les montants, devise, acteurs, message et réserve à l'envoi sont immuables.

Les accès acheteur/vendeur filtrent toujours leur identifiant côté serveur. L'accès de contrôle exige une habilitation et est audité ; il ne donne pas le droit de décider à la place du vendeur. Les listes sont paginées. Les messages et historiques ne figurent jamais dans le catalogue public et sont échappés dans les interfaces. Les justificatifs personnels et le VIN continuent d'utiliser le circuit privé existant.

## Migration D1

`0015_propositions_lot1.sql` réutilise `vehicle_offers` au lieu de créer une seconde table concurrente. `vehicle_id` référence `vehicles.reference` ; `submission_id` demeure une référence optionnelle au dossier vendeur. `amount_minor` est conservé comme nom explicite de l'unité exacte (alias API `offered_amount`), avec `currency`, `reserve_price_at_submission` et `buyer_message`.

Les statuts sont `pending`, `accepted`, `rejected`, `cancelled`, `expired`. Les identifiants, événements et anciennes transactions sont conservés. Le statut antérieur est enregistré dans `historical_status` ; un événement trace sa correspondance. Les anciennes offres n'avaient pas de réserve à l'envoi : celle-ci reste NULL, sans reconstitution fictive depuis le minimum privé. Une nouvelle proposition Lot 1 est requise pour accepter une telle offre encore en attente. Les contrats historiques restent des preuves et aucune étape nouvelle ne les utilise automatiquement.

La reconstruction respecte la procédure de table nouvelle/copie/remplacement, avec vérification des clés étrangères et contraintes différées. Références techniques : [migrations D1](https://developers.cloudflare.com/d1/reference/migrations/), [ALTER TABLE SQLite](https://www.sqlite.org/lang_altertable.html). Les tests couvrent une base SQLite et une D1 locale déjà peuplées avec offre, événements et transaction. Aucun test n'utilise la production.

Index : recherches par acheteur/vendeur/véhicule, expiration, une proposition en attente par couple acheteur/véhicule et une acceptation par véhicule. Deux acceptations incompatibles concurrentes ne peuvent pas aboutir ensemble. Aucune acceptation ne retire automatiquement l'annonce ni ne rejette les autres propositions : le vendeur décide et les échéances restent propres à chaque proposition.

## Exploitation locale et configuration préalable

Le déploiement, les migrations distantes et l'affectation de vendeurs réels nécessitent une autorisation distincte. Sauvegarder et examiner les migrations divergentes de la branche config/agents-ia avant toute intégration. Appliquer la base de la PR #10 puis la migration 0015 uniquement sur une base locale ou de preview autorisée pour validation.

Sur `/admin/marketplace`, « Affecter le vendeur d'une annonce importée » appelle :

```
POST /api/marketplace/offer-ownership
{"vehicleId":"REFERENCE_EXISTANTE","sellerId":IDENTIFIANT_COMPTE_VENDEUR}
```

L'admin doit choisir un compte avec profil vendeur. Le catalogue statique est alors matérialisé dans D1 en conservant ses informations et son état de retrait. Une affectation existante ne peut pas être modifiée tant qu'il existe une proposition en attente ou acceptée. Pour les annonces SV, le propriétaire vient toujours du dossier et ne peut pas être remplacé par ce mécanisme. Les anciennes enchères expirées ne sont pas réactivées implicitement ; leur passage en propositions nécessite une affectation explicite.

Les conditions techniques de durée et d'annulation restent versionnées dans `marketplace_policy`. La migration utilise `lot1-draft-1` et désactive la confirmation contractuelle. La fonction de confirmation ne peut pas être activée par cette politique en Lot 1. La durée exacte, l'effet juridique de l'offre/de l'acceptation, les annulations et les réclamations doivent être validés par un juriste tunisien ; la page `/conditions-marketplace` est un modèle, sans affirmation de conformité définitive.

`LEGACY_AUCTIONS_ENABLED` vaut **false** dans la configuration livrée et en l'absence de variable. Le catalogue ne diffuse pas de compte à rebours ni d'historique d'enchères ; les routes de soumission/décision historiques sont fermées. Les tests historiques utilisent explicitement un environnement local avec cette variable à true afin de vérifier que le module conservé reste isolé. Ce réglage de test n'active aucune enchère dans l'environnement livré.

## Fichiers concernés

| Fichier(s) | Modification |
|---|---|
| `migrations/0015_propositions_lot1.sql` | Évolution de la table existante, instantané de réserve, message, cinq statuts, propriété des annonces importées, index et audit. |
| `worker/proposals.js` | API des propositions, règles d'accès, seuil officiel atomique, décision, annulation et affectation vendeur. |
| `worker/proposal-domain.js` | Réserve canonique, devise exacte, activité, présentation Lot 1 et expiration. |
| `worker/index.js` | Intégration API, fiches importées, fermeture des enchères par défaut et conservation de la visibilité des annonces historiques. |
| `worker/marketplace-domain.js`, `worker/marketplace.js` | Expiration à cinq statuts, retrait du workflow contractuel, états de disponibilité et interfaces de contrôle. |
| `worker/seller-domain.js`, `worker/seller.js` | Réserve publique distincte du minimum privé, validation et présentation du dossier. |
| `worker/marketplace-pages.js` | Fiches avec réserve/bouton et modèles de conditions du Lot 1. |
| `my-auto-export/proposal-dialog.js`, `proposal-dialog.css` | Fenêtre commune, connexion, contrôle du seuil, message facultatif, accessibilité et responsive. |
| `my-auto-export/index.html` | Réserve et bouton sur cartes/fiches, rubrique Mes offres et navigation enchères désactivée ; slogan conservé. |
| `my-auto-export/marketplace-ui.js`, `marketplace-i18n.js` | Listes privées, statuts, historique, pagination, notifications et affectation admin. |
| `my-auto-export/vendeur.js` | Saisie séparée de la réserve publique. |
| `wrangler.jsonc` | Enchères désactivées explicitement. |
| `tests/test_propositions_lot1.py` | Seuils, manipulations, droits, devise, spam, statuts, données préservées et trois tailles d'écran. |
| `tests/test_migration_lot1_d1.py` | Migration réelle d'une D1 locale peuplée et intégrité référentielle. |
| `tests/test_marketplace_domain.py`, `tests/test_vendeur.py` | Intégrité monétaire/migration et adaptation des parcours existants aux statuts du Lot 1. |
| `tests/test_administration.py`, `test_catalogue.py`, `test_espace_acheteur.py` | Activation explicite du seul environnement de tests historiques, sans changer le défaut livré. |
| `README.md`, `TASKS.md`, ce document | Installation, décisions, suivi et résultats de livraison. |

## Validation

**115 tests réussis en 389,139 s**, sans test ignoré : 77 tests historiques isolés, 22 parcours vendeur adaptés, 11 scénarios du Lot 1, quatre contrôles de domaine/migration et une migration D1 peuplée. Les onze scénarios du Lot 1 ont été relancés après le dernier contrôle de visibilité : **11 réussis en 67,874 s**.

Compilation finale avec Wrangler 4.156.0 `deploy --dry-run` réussie : **174,90 KiB**, gzip **45,65 KiB**. Aucun code envoyé et aucune ressource distante créée. Aucun e-mail réel, déploiement en production, migration distante ou fusion.

Vérification visuelle Chromium sur ordinateur (1440 px), tablette (820 px) et mobile (390 px), avec un véhicule fictif et une D1 locale éphémère : libellés, réserve, formulaire, retour de validation et bouton accessibles, sans débordement horizontal. Captures :

- [Ordinateur](images/lot1-ordinateur.png)
- [Tablette](images/lot1-tablette.png)
- [Mobile](images/lot1-mobile.png)

Les fichiers `docs/images/lot1-*.png` sont des captures de données fictives, pas des annonces réelles. `docs/PHASE1_EXPLOITATION.md` renvoie désormais vers les instructions de ce Lot 1.

Contrôle complémentaire des annonces sans réserve : cas élargi réussi (25,681 s), avec devise TND visible et absence de valeur déduite du prix demandé. Aperçu actualisé sur http://127.0.0.1:8787/ dans une base locale distincte ; 20 annonces historiques restent visibles, sans compte à rebours ni données d’enchères, et aucune affectation réelle n’a été effectuée.
