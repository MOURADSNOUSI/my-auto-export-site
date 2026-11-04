# Validation de la marketplace vendeurs

Livraison du 3 novembre 2026, issue #5, branche `feature/marketplace-vendeurs-diagnostic`.
Base : `344b7e9` de `config/agents-ia`, incluant sécurité, SEO, filtres et caution.

## Suite finale

```
WRANGLER=/chemin/vers/wrangler python -m unittest discover -s tests -v

Ran 160 tests in 375.162s
OK
```

Les 160 tests ont été exécutés, sans test ignoré. Wrangler 4.156.0, D1/R2 locaux
éphémères et Chromium/Playwright. La suite couvre aussi bien le vendeur que le
catalogue, les filtres, les pages SEO, les conditions, l'administration, les comptes,
OAuth/MCP, les limitations IP, les enchères, la concurrence et la caution.

Le parcours vendeur complet passe : inscription, coordonnées, huit étapes, galerie,
photo principale, dommage relié à une photo, diagnostic, documents, soumission,
vérification, approbation sans publication, autorisation distincte et affichage public.
Les tests incluent doublons de VIN, pièces manquantes, agrément expiré, accès à autrui,
expiration des liens, quotas/tailles, PDF actifs, données privées dans les textes publics,
règles par pays/type, purge et restauration après échec partiel d'envoi.

Les tests d'intégration vérifient que l'éditeur générique ne peut pas contourner le
circuit vendeur, qu'un changement de prix conserve les métadonnées validées et que
les propositions de prix ne contournent pas un passage du véhicule aux enchères.

## Contrôles complémentaires

- Syntaxe des modules JS et `git diff --check` valides.
- Prévisualisation 8787 : `/`, `/vendre`, `/admin-vendeurs`, `/seller-schema.js`,
  `/api/catalogue`, `/vehicules` répondent 200.
- Page vendeur mobile 390 px : formulaire visible, aucun débordement horizontal,
  aucune violation CSP, en-tête `X-Robots-Tag: noindex, nofollow`.
- La CSP stricte est préservée ; les attentes Playwright sont des fonctions, sans
  assouplissement par `unsafe-eval`.
- Les ResourceWarning HTTPError d'anciens tests n'ont pas causé d'échec ; les nouvelles
  requêtes de test ferment leurs réponses.

## Périmètre des opérations

Aucun déploiement en production, aucune migration distante, aucune annonce réelle
publiée et aucune fusion main. Les migrations et publications de test ont lieu dans
des bases temporaires ; la prévisualisation locale dispose de données isolées.

Le PDF OPENLANE n'était pas présent : aucune vérification de ce document n'est
revendiquée. Les contrôles de format/PDF ne sont ni un antivirus complet ni un OCR ;
l'authenticité du diagnostic reste une vérification humaine obligatoire.
