# Déploiement du Lot 1

## Périmètre autorisé et préparation

Déploiement explicitement demandé par l’utilisateur le 4 novembre 2026, depuis `feature/lot1-propositions-achat`, sans fusion des PR #10 et #11. Les changements non commités du worktree `fix/pied-de-page` restent séparés.

Le Worker actif à l’audit est `f25d7329-e4de-40cd-a4b4-cb6fc6a9f6eb`. Il contient déjà des protections par IP, des pages SEO et un registre de dépôts, absents de la base initiale de la branche Lot 1. La livraison conserve ces protections, les URLs canoniques, les variantes WebP, le contrôle SEO quotidien, les soldes et le traitement idempotent des webhooks historiques. Les nouveaux paiements et les enchères sont désactivés dans le Lot 1.

L’export D1 standard est refusé par Cloudflare avec l’erreur d’authentification 10000. Un point de restauration Time Travel et une sauvegarde SQL de toutes les tables applicatives sont donc enregistrés hors dépôt, dans un dossier privé. Cette sauvegarde est reconstruite en SQLite : contrôle d’intégrité réussi, aucune violation de clé étrangère. Aucun identifiant personnel ni secret n’est ajouté au dépôt.

Les cinq migrations manquantes sont :

- `0011_dossiers_vendeurs.sql`
- `0012_marketplace_vendeurs.sql`
- `0013_regles_documents_vendeurs.sql`
- `0014_marketplace_phase1.sql`
- `0015_propositions_lot1.sql`

Les migrations historiques de production `0008_depot_garantie.sql` à `0013_retrait_offre.sql` sont conservées sous leurs noms complets. Le préfixe numérique commun de plusieurs migrations ne constitue pas un doublon : D1 les suit par nom complet. La répétition des cinq migrations sur la sauvegarde réelle conserve à l’identique les treize tables existantes de comptes, sessions, dépôts, factures, offres, favoris et authentification. Le test D1 local reproduit également l’ordre de migration de production avec un dépôt payé.

Deux buckets séparés sont créés : `my-auto-export-seller-private` et `my-auto-export-seller-private-preview`. Aucun accès public n’est configuré. Les domaines du Worker restent gérés dans le tableau de bord Cloudflare ; les variables existantes et secrets sont conservés.

## Fichiers de compatibilité

| Fichiers | Comportement conservé ou vérifié |
| --- | --- |
| `worker/index.js`, `worker/mcp.js`, `my-auto-export/_headers` | Authentification par IP, en-têtes de sécurité, comptes et statuts historiques. |
| `worker/seo.js` | Pages canoniques, sitemap dynamique, diagnostics et médias publics validés, formulaire Lot 1 et devise native. |
| `worker/legacy-deposits.js` | Webhook signé et crédit historique unique ; aucune création de paiement. |
| `my-auto-export/index.html`, `my-auto-export/photos/web/*` | Améliorations mobiles et images déjà livrées, liens indexables, consultation du solde existant. |
| `migrations/0008*`, `0009*`, `0010*`, `0011_journal_seo.sql`, `0012_limites_par_ip.sql`, `0013_retrait_offre.sql` | Schéma de production conservé pour les nouvelles installations et tests. |
| `wrangler.jsonc` | Ressources privées séparées, enchères désactivées, variables préservées et crons SEO. |
| `tests/test_compatibilite_production.py`, `tests/test_securite.py`, `tests/test_migration_lot1_d1.py` | URLs et devises, données privées, dépôts et migration depuis la production. |
| Tests historiques d’administration, d’acheteur, d’enchères et MCP | Harness navigateur compatible avec la CSP, IP distinctes pour les clients OAuth de test. Les tests de sécurité et du Lot 1 gardent la CSP réelle. |

## Configuration des annonces

L’administrateur se connecte avec son compte existant. Les comptes et mots de passe locaux ne sont pas copiés vers la production.

- Réserve des annonces importées : `/admin.html`, champ du prix de réserve historique en TND.
- Affectation à un compte disposant d’un profil vendeur : `/admin/marketplace`.
- Annonces vendeurs : `/vendre`, réserve publique distincte du minimum privé ; vérification humaine du dossier et du diagnostic obligatoire.
- Offres reçues : `/vendeur/offres` ; offres envoyées : `/mes-offres`.

Les champs montant et message restent éditables pour préparer une proposition. L’envoi exige toujours une annonce active, une réserve officielle et un vendeur identifié. Aucune réserve, affectation réelle ni annonce n’est inventée pendant le déploiement. La confirmation contractuelle et les emails restent désactivés.

## Résultats de livraison

**134 tests Python réussis en 434,653 s**, sans test ignoré. Le premier passage a révélé un écart de retrait des annonces à diagnostic expiré et des fixtures historiques à adapter à la CSP et aux limites OAuth ; ces points sont corrigés, puis la suite complète a été relancée avec succès.

Simulation finale Wrangler réussie : 208,12 KiB, gzip 55,67 KiB. Les cinq migrations sont appliquées en production : 18 migrations enregistrées, aucune violation de clé étrangère, comptes et dépôts conservés. Le Worker est publié depuis le commit `ce78c64` : version **`57fc059f-98f9-4193-bd0a-d98d7e7d21cf`**, sur **https://www.myautoexport.com**. Démarrage Worker : 2 ms. Les deux crons SEO sont conservés. La version précédente `f25d7329-e4de-40cd-a4b4-cb6fc6a9f6eb` et le point de restauration D1 sont enregistrés pour le retour arrière ; les migrations ajoutées restent compatibles avec l’ancien Worker.

Après publication, les quinze lectures HTTP attendues passent : accueil, portail vendeur, espaces d’offres, catalogue, règles, fiche canonique et sitemap. Les API privées refusent les visiteurs anonymes (401), les enchères répondent 410 et une référence de média privé inexistante répond 404. Le client Python urllib reçoit un 403 ; les vérifications passent avec curl et Chromium, les clients utilisés pour la validation finale.

Chromium vérifie la production à 1440 et 390 px, avec la CSP réelle : slogan et lien `#accueil`, absence de débordement, montant et message éditables, valeurs conservées, aucune erreur JavaScript et aucune requête d’écriture. Aucune proposition réelle, création de compte, connexion de test ni paiement n’est envoyé en production. Les captures de production restent locales.

La Citroën C5 `7753628` n’a toujours pas de réserve publique et ne reçoit pas encore d’offres. Cette donnée métier et l’affectation du vendeur restent à renseigner par l’administrateur. Les champs sont utilisables ; les contrôles d’envoi restent actifs.

L’aperçu local 8787 reçoit également les six migrations historiques manquantes pour conserver sa compatibilité ; son compte administrateur et ses données restent séparés de la production.

Le contrôle GitHub « Workers Builds: my-auto-export-site » du commit `4b9d2c8` est **SUCCESS**. La branche et la PR #11 sont actualisées sans fusion ; la version active demeure celle vérifiée ci-dessus.
