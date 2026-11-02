
# Coordination des tâches — my-auto-export-site

## Source de vérité

Le dépôt est connecté à GitHub : les issues du dépôt
[`MOURADSNOUSI/my-auto-export-site`](https://github.com/MOURADSNOUSI/my-auto-export-site/issues)
font foi pour le périmètre, le responsable et le statut des tâches. Cette page ne fait qu'indexer
les issues et leurs comptes rendus. À la dernière vérification, aucune issue ouverte n'était présente.
Ne pas démarrer une tâche de code sans issue correspondante ; ne pas créer d'issue ou de branche distante
sans autorisation.

## Rôles proposés

- **Copilot** : cadrage, triage, coordination et mise à jour des liens/statuts.
- **Codex** : implémentation du site et tests ciblés.
- **Claude Code** : audit et revue des changements.
- Un responsable unique par tâche ; toute revue est suivie dans l'issue concernée.

## Issues actives

Aucune issue ouverte connue. Ajouter ici un lien vers chaque issue active, avec l'agent responsable
et le nom de sa branche dédiée. L'issue reste la référence si un statut diverge.

| Issue | Tâche | Agent | Statut | Branche |
|---|---|---|---|---|
| [#5](https://github.com/MOURADSNOUSI/my-auto-export-site/issues/5) | Vendre mon véhicule : dossier vendeur et diagnostic validé | OpenAI Codex | Extension marketplace, vérification finale en cours, non déployé | `feature/marketplace-vendeurs-diagnostic` |
| — | Aucune issue ouverte | — | — | — |

Après chaque intervention, commenter l'issue et actualiser la ligne correspondante avec le statut,
les fichiers modifiés, les tests réellement exécutés et leurs résultats, et les blocages.

## Pistes historiques à convertir en issues

Ces entrées proviennent du suivi antérieur ; elles ne sont pas des tâches autorisées/en cours tant
qu'une issue n'existe pas. Vérifier leur pertinence et leur périmètre avant de les reprendre.

- Vérifier le fonctionnement des agents IA.
- Contrôler le déploiement : revue de configuration uniquement ; aucun déploiement sans autorisation explicite.
- Tester l'extraction des annonces automobiles : relève du dépôt `my-auto-agent`.
- Audit du code du site (entrée précédemment indiquée « en cours » ; statut à confirmer).

## Historique

- Configuration initiale de GitHub (entrée historique marquée terminée dans le suivi précédent).


Compte rendu #5 (2026-11-02) — développement isolé dans `/home/yoyo/projets/my-auto-export-vendeur`,
à partir de `fd3b0c9`, sans incorporer les changements locaux non committés de `config/agents-ia`.
Fichiers : `worker/seller.js`, `worker/index.js`, `migrations/0011_dossiers_vendeurs.sql`,
`my-auto-export/vendre.html`, `admin-vendeurs.html`, `vendeur.js`, `vendeur.css`, `index.html`,
`admin.html`, `wrangler.jsonc`, `tests/test_vendeur.py`, `tests/test_catalogue.py`, `README.md`, `TASKS.md`.
Tests : suite complète Python `unittest` avec Wrangler 4.156.0 et Chromium : **88 tests réussis**
en 94,240 s, dont 9 tests vendeur et un test supplémentaire contre les faux badges statiques.
Le parcours navigateur couvre création du compte, coordonnées, dépôt des sept catégories de pièces,
soumission, revue administrateur et publication du badge. Syntaxe JS et `git diff --check` valides.
Une première suite (87 tests) avait signalé le lien `/vendre.html` ; corrigé en `/vendre`, puis
suite complète relancée avec succès. Les tests acheteur existants émettent des ResourceWarning
sur des réponses HTTPError non fermées, sans échec. Aucun déploiement, commit, branche distante ni PR.
Mise en service restante : création du bucket R2 privé, migration D1, déploiement autorisé et
saisie des vrais garages partenaires. Attention à l'ordre des migrations lors de l'intégration
avec les travaux caution/SEO menés sur d'autres branches.

Prévisualisation locale #5 (2026-11-02), demandée par l'utilisateur : version vendeur démarrée
sur `http://127.0.0.1:8787/` depuis le worktree dédié. L'ancien serveur local a été arrêté,
sans supprimer ses données. Configuration, base D1, buckets R2 simulés et journal isolés dans
`.wrangler/vendeur-preview/` (ignoré par Git) ; 8 migrations appliquées en local uniquement.
Contrôles : accueil avec lien vendeur, `/vendre`, `/admin-vendeurs`, JS/CSS et catalogue API répondent
200 ; API privée répond 401 sans session ; écran vendeur vérifié dans Chromium à 390 px.
Le contrôle initial attendait à tort 200 sur `/api/me` sans session ; corrigé pour vérifier 401.
Aucun nouveau test métier nécessaire, aucun changement métier depuis les 88 tests réussis.
Aucune ressource ni donnée de production modifiée. Base locale neuve : comptes et garages à renseigner.

Extension #5 (2026-11-02), demandée et située par l'utilisateur dans l'espace vendeur :
menu « Tous les véhicules / Véhicules actifs / Vendu / Archivé », compteurs dynamiques et filtres
avec état sélectionné accessible. Actifs : dossiers en cours et annonces non retirées/non vendues ;
vendus : offre acceptée (prioritaire sur le retrait) ; archivés : annonce approuvée retirée sans vente.
Fichiers : `worker/seller.js`, `my-auto-export/vendre.html`, `vendeur.js`, `vendeur.css`,
`tests/test_vendeur.py`, `README.md`, `TASKS.md`. Branche : `feature/5-vendre-vehicule`, responsable Codex.
Tests : **11 tests vendeur réussis en 18,268 s**, dont deux nouveaux tests des états réels et du menu
(compteurs 7/6/1/0, filtrage, état vide, réactualisation et largeur mobile 390 px). Syntaxe JS et
`git diff --check` valides. Suite globale non relancée : modifications limitées au parcours vendeur.
Serveur local 8787 rechargé automatiquement. Aucun changement de production ni nouvelle migration.

Ajustement visuel #5 (2026-11-02), Codex, branche `feature/5-vendre-vehicule` : bouton vendeur
renommé « Ajouter un véhicule », contour et texte bleus, forme arrondie et fond transparent selon
la capture. Fichiers : `my-auto-export/vendre.html`, `vendeur.css`, `tests/test_vendeur.py`, `TASKS.md`.
Vérifications : 3 tests navigateur existants réussis en 12,532 s (création du brouillon, parcours
complet et filtres/mobile), libellé servi sur le port 8787 confirmé et `git diff --check` valide.
Suite globale non relancée pour ce changement visuel. Aucun déploiement en production.

Identification du véhicule #5 (2026-11-02), Codex, branche `feature/5-vendre-vehicule` :
étape initiale conforme aux champs de la capture (châssis, plaque, première immatriculation,
lieu, pays d'origine), « Poursuivre » désactivé tant que les champs obligatoires sont invalides,
étape modèle masquée jusqu'à validation, retour et annulation avec conservation du brouillon.
Lieu : gouvernorats tunisiens ou autre lieu à préciser ; pays ISO ; dates non futures.
Stockage privé JSON, contrôles serveur à la soumission et présentation à l'administrateur.
Fichiers : `worker/seller.js`, `my-auto-export/vendeur.js`, `vendeur.css`, `tests/test_vendeur.py`,
`README.md`, `TASKS.md`. Tests : **13 tests vendeur réussis en 32,379 s**, dont deux nouveaux tests
sur la persistance, les champs obligatoires, les dates, le retour et l'annulation/mobile.
Les tests de publication vérifient aussi l'absence des nouveaux champs privés dans le catalogue.
Syntaxe JS et `git diff --check` valides. Suite globale non relancée pour cet ajout au parcours vendeur.
Serveur local 8787 rechargé ; aucune nouvelle migration ni modification de production.


Extension complète du cahier des charges #5 (2026-11-02), responsable OpenAI Codex.
Branche demandée : `feature/marketplace-vendeurs-diagnostic`, worktree vendeur conservé.
Le travail local du dépôt d'origine n'est pas incorporé. La branche vendeur a été replacée
sur `origin/config/agents-ia` (5bc617c) pour préserver le dépôt de garantie et les règles existantes.
La future PR dépend de #1 et ne fusionne pas main. Autorisation explicite reçue pour commits et PR ;
production, migrations distantes, annonces réelles et fusion principale toujours interdits.

Livré : formulaire huit étapes, équipements, galerie compressée/ordonnée avec couverture, SVG de
dommages original, diagnostic complet, agrément daté, documents conditionnels pays/type, accès
privés temporaires, audit, conservation/purge, devises et propositions de prix directes.
Approbation et publication sont distinctes ; les enchères restent à venir jusqu'à activation par
l'administration existante. Les références SV sont réservées au circuit vendeur ; l'éditeur générique
ne peut ni publier un dossier non validé ni en modifier les caractéristiques/photos sans revalidation.
Un changement de prix conserve les métadonnées vérifiées, et les propositions de prix prennent en
compte le mode de vente actuel pour empêcher un contournement des enchères.

Fichiers : `worker/seller.js`, `seller-domain.js`, `index.js`,
`my-auto-export/vendeur.js`, `vendeur.css`, `seller-schema.js`, `vendre.html`, `admin-vendeurs.html`,
`index.html`, `admin.html`, migrations 0011/0012/0013, `wrangler.jsonc`, tests vendeur/catalogue,
README et docs d'audit, cahier des charges et guide fonctionnel/technique.
Les nouvelles migrations ont été appliquées seulement à la prévisualisation locale 8787.
Validation finale en cours ; les premières suites ont détecté et permis de corriger le comptage
des changements D1 avec triggers, une assertion du marqueur de couverture et le code HTTP d'une
écriture documentaire interdite. Les règles métier, les enchères et la caution passent dans la
première suite globale de 105 tests (1 échec de code HTTP corrigé).
Le PDF OPENLANE n'était pas présent ; aucun audit PDF ni antivirus complet n'est revendiqué.
