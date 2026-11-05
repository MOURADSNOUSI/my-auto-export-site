# Phase 1 — audit et architecture (lot A)

Base examinée : origin/main 9959bc7. Branche : feature/marketplace-phase1.

Le site est un ensemble HTML/CSS/JavaScript servi par Cloudflare Workers (worker/main.js et index.js), sans framework ni package de build. D1 stocke users, sessions, vehicles, offers, favoris, factures et OAuth. Les sessions existantes utilisent un cookie HttpOnly, SameSite et un jeton haché ; les mutations API contrôlent Origin. Les migrations de main sont 0001–0007. PHOTOS est le bucket R2 des images du catalogue ; le stockage des factures est désactivé.

Les scripts ajouter_lot.py et importer_wix.py alimentent le catalogue historique ; aucune intégration Facebook ni workflow de production n'est présente sur main. Ces scripts sont conservés. Le catalogue combine lots.json et les surcharges D1. Ses enchères historiques et offres administrées utilisent des montants TND entiers et ne conviennent pas aux offres privées de phase 1.

Réutilisation sélective du travail vendeur de la PR #7 : profils, dossiers, fichiers privés, diagnostics, formulaire par étapes, validation humaine. Cette PR était basée sur config/agents-ia ; importer toute cette branche introduirait notamment des fonctions de caution hors périmètre. La phase 1 part donc de main et n'introduit aucun paiement. Les migrations vendeur 0011–0013 sont additives après 0007 ; les numéros 0008–0010, propres à une autre branche, ne sont pas nécessaires ici.

La nouvelle table vehicle_offers isole le cycle privé des anciennes offers. Les montants phase 1 sont des entiers en unités mineures avec devise explicite. Un index unique protège les acceptations incompatibles. Les diagnostics et les annonces ont des statuts séparés ; publication et confirmation contractuelle restent des actions explicites. Les règles juridiques de confirmation sont désactivées par défaut en attente d'une validation autorisée.

Les rôles complémentaires sont stockés séparément pour préserver la contrainte buyer/admin des comptes existants. Les pièces restent dans un bucket privé, avec contrôle du propriétaire et liens temporaires liés à la session. Les accès de contrôle sont audités sans journal applicatif contenant de données personnelles.

Vérifications réalisées : lecture README, migrations, authentification, catalogue, import, fichiers R2, tests Python ; comparaison main/config/PR #7 ; absence de AGENTS/CLAUDE/TASKS sur main. Les instructions de coordination connues de la session restent appliquées. Aucune commande distante de migration ou déploiement n'a été exécutée.

Risques : main est en retard sur les autres branches (ne pas fusionner aveuglément les migrations) ; bucket privé à provisionner ultérieurement ; modèles et règles à faire valider par un juriste tunisien ; le contrôle de fichiers ne remplace pas un service antivirus spécialisé. Les tests sont exécutés exclusivement sur bases/buckets locaux éphémères.
