# Audit de l'espace vendeur

Audit du 2 novembre 2026, branche `feature/marketplace-vendeurs-diagnostic`, issue #5.

## Réutilisation

- `worker/index.js` : authentification PBKDF2, sessions HttpOnly, garde d'origine CSRF, rôles acheteur/admin, catalogue fusionnant JSON et D1, offres et enchères.
- `migrations/0001` à `0007` : comptes, sessions, offres, favoris, véhicules administratifs, conditions et MCP.
- `my-auto-export/index.html` et `admin.html` : catalogue, galerie et administration. Les règles du pas d'enchère, de réserve, de prolongation et de décision restent dans leur implémentation existante.
- Travail vendeur déjà réalisé dans cette session : profil vendeur complémentaire au compte, brouillons privés, pièces R2, garages partenaires, première étape d'identification et menu de statuts.
- Tests Python `unittest`, D1/R2 locaux via Wrangler, navigateur Chromium via Playwright.

## Écarts traités dans l'extension

Le premier parcours n'avait que six observations techniques, une galerie élémentaire, aucun historique durable de validation, et l'approbation publiait immédiatement. Il manquait les équipements, l'entretien, les dommages, la référence et le VIN du rapport, la validité des garages, le minimum de huit vues, les devises, l'accès temporaire, la limitation d'envoi et la politique de purge.

La migration 0012 ajoute ces éléments en préservant les lignes 0011 et le statut historique. Le champ `stage` devient la source de vérité pour le circuit détaillé. Les métadonnées de diagnostic, dommages et audit ont leurs propres tables D1 ; le JSON de brouillon conserve les autres caractéristiques. Les contrôles sont partagés dans `seller-schema.js` et exécutés sur le Worker.

## Référence et périmètre

Le texte du cahier des charges est archivé dans `ESPACE_VENDEUR_CAHIER_DES_CHARGES.md`. Aucun fichier `OPENLANE Sell.pdf` n'était présent dans les pièces jointes accessibles : aucune comparaison PDF n'est revendiquée. Le schéma SVG du véhicule est original et ne reprend pas une illustration de cette plateforme.

Le travail local non committé du dépôt d'origine `my-auto-export-site` n'est pas déplacé ni incorporé. Le travail vendeur est isolé dans `my-auto-export-vendeur`. Aucun déploiement de production, aucune migration distante, aucune annonce réelle et aucune fusion ne sont autorisés par ce développement.

## Intégration de la base actualisée

La base `config/agents-ia` a reçu les changements de sécurité et SEO pendant le développement
(commit d'intégration `a8ae916`). Ils sont conservés : en-têtes et limitations IP, réponses 404,
pages véhicules, sitemap dynamique et contrôles SEO. La purge vendeur a son cron distinct,
sans remplacer les contrôles SEO de 07:00 Paris. Les pages vendeur/admin passent aussi par
le Worker pour leurs en-têtes d'indexation. Les photos et diagnostics vendeurs sont présentés
sur les fiches HTML rendues côté serveur, et la publication alimente le contrôle SEO existant.

La base a ensuite intégré les 16 filtres du catalogue (commit `344b7e9`). La branche vendeur
a été replacée sur cette base, sans conflit. Les champs publiés transmission/couleur/puissance/
cylindrée/portes/places/état utilisent le contrat du catalogue, tout en restant protégés par la
validation du diagnostic. Les variantes de boîte et les puissances en kW restent recherchables.
