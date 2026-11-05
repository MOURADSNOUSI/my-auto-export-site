# Référencement (SEO et moteurs IA) — M&Y AUTO EXPORT

Branche `feature/seo-vehicle-pages`. Rien n'est déployé : la mise en production suit le plan de la section 5,
après validation explicite.

## 1. Audit : constats classés par priorité

Audit du dépôt (`main` @ `9959bc7`) et du site en production le 2026-11-01, en lecture seule (requêtes HTTP anonymes).

### P0 — bloque l'indexation des véhicules

| # | Constat | Preuve | État |
|---|---|---|---|
| 1 | Aucune adresse par véhicule : le catalogue est rendu en JavaScript depuis `/api/catalogue`, la fiche s'ouvre dans une fenêtre modale. Aucun véhicule ne peut être indexé ni partagé par lien. | `index.html` : `ouvrirFiche()` remplit `#lot-dialog`, aucune route `/vehicules/…` | Corrigé |
| 2 | Sans JavaScript, l'accueil affiche « Chargement des véhicules… ». Les robots des assistants IA, qui n'exécutent en général pas JavaScript, ne voient aucun véhicule. | HTML servi : `#empty-title` | Corrigé |
| 3 | Sitemap statique à 2 adresses, dont `/conditions.html`, qui redirige (307). | `curl -I https://www.myautoexport.com/conditions.html` → 307 | Corrigé |

### P1 — doublons, qualité, performance

| # | Constat | Preuve | État |
|---|---|---|---|
| 4 | `http://www.myautoexport.com/` répond 200 au lieu de rediriger vers https : tout le site existe en deux exemplaires. | `curl http://www.myautoexport.com/` → 200 | Corrigé dans le Worker ; **réglage Cloudflare requis** (section 5) |
| 5 | Canonical et liens internes en `.html` alors que Cloudflare redirige vers l'adresse sans extension. | 307 sur `/conditions.html`, `/admin.html`, `/index.html` | Corrigé (identique au travail en cours sur `main`, voir section 6) |
| 6 | Aucune donnée structurée pour les véhicules ; seule l'entreprise est décrite (`AutoDealer`). | `index.html` | Corrigé |
| 7 | La page 404 a un corps vide. Les véhicules vendus ou les ventes terminées n'ont aucun traitement d'indexation. | `curl /page-inexistante` → 404, 0 octet | Corrigé |
| 8 | Image d'accueil (élément LCP) de 3024×4032 pour 709 Ko ; 16 Mo de photos locales en pleine résolution. | `my-auto-export/photos/` | Corrigé : WebP 960×1280 de 123 Ko, 2,6 Mo pour les 20 photos |
| 9 | `/admin` protégé seulement par une balise meta `noindex`. | `admin.html` | Corrigé : en-tête `X-Robots-Tag` en plus |

### P2 — à décider par M&Y AUTO EXPORT (non modifié)

| # | Constat | Recommandation |
|---|---|---|
| 10 | 157 des 177 photos du catalogue sont des images eCarsTrade chargées directement depuis leur serveur et marquées `authorized: true`. Le README rappelle qu'une adresse https ne prouve aucun droit de publication. Les pages véhicules les reprennent (balises `og:image`, données structurées), ce qui accroît leur diffusion. | Confirmer par écrit le droit de réutilisation, ou passer ces photos à `authorized: false`. Les pages s'adaptent seules (« Photo à confirmer »). |
| 11 | Certaines photos eCarsTrade sont des vignettes de 160 px de large (lot 7750872) : rendu flou sur les pages. | Utiliser l'image pleine taille, si les droits le permettent. |
| 12 | Les liens « Fiche fournisseur » vers eCarsTrade répondent 403 aux visiteurs non connectés : ils n'apportent rien à l'acheteur et révèlent la source d'approvisionnement. Le contrôle quotidien les signale en avertissement. | Décider de les garder ou de les retirer de l'affichage public. |
| 13 | Les conditions générales, indexées, se présentent comme un « projet à faire valider par un avocat » et contiennent plusieurs « À compléter » (raison sociale, RNE, matricule fiscal, adresse). C'est défavorable à la confiance accordée par les moteurs et les acheteurs, et c'est d'abord un sujet juridique. | Compléter et faire valider ; c'est aussi un prérequis du guide (section 3.4). |
| 14 | Les photos envoyées depuis `/admin` sont stockées telles quelles dans R2. Une photo prise au téléphone peut contenir la position GPS (EXIF). Les 20 photos locales actuelles n'en contiennent pas. | Retirer les métadonnées à l'envoi, ou passer les photos par `scripts/optimiser_photos.py`. |
| 15 | Champs peu renseignés : catégorie (2 lots sur 21) et pays de provenance (1 sur 21). Les pages et descriptions sont plus pauvres. | Les renseigner depuis le pipeline `my-auto-agent`, qui extrait déjà le pays. |
| 16 | Propriété du site dans Google Search Console et Bing Webmaster Tools : non vérifiable depuis le dépôt. | Vérifier, puis déclarer `https://www.myautoexport.com/sitemap.xml`. |

## 2. Ce qui change

### Pages véhicules — `worker/seo.js`

- **Adresse** : `/vehicules/<marque>-<modèle>-<année>-<référence>`, par exemple
  `/vehicules/porsche-cayenne-2024-7750872`. La référence en fin d'adresse la rend unique. Si la marque, le
  modèle ou l'année change, l'ancienne adresse redirige en 301 vers la nouvelle. Une barre oblique finale
  redirige vers l'adresse sans barre.
- **Rendu côté serveur** à chaque requête, depuis le même catalogue que le site (`lots.json` + véhicules de
  l'administration en D1). Un véhicule ajouté, modifié ou retiré met à jour sa page, la liste et le sitemap
  sans étape de génération ni redéploiement, pour les véhicules gérés depuis `/admin` ou par le MCP.
- **Contenu indexable** : titre et description uniques (marque, modèle, version, année, kilométrage,
  référence), `h1`, tableau des caractéristiques, prix avec la mention de l'article 5 des CGV, photos avec
  `alt` descriptif. La première photo est chargée en priorité, les suivantes en différé, en WebP quand une
  version existe.
- **Données structurées** : `Car` (sous-type de `Vehicle`) et `BreadcrumbList`. `Product` + `Offer` seulement
  pour un véhicule en stock avec un prix affiché : une enchère n'a pas de prix de vente connu d'avance. Aucun
  champ n'est déduit ; un champ absent de l'annonce est absent des données.
- **Annonces obsolètes** :

  | Situation | Réponse | Sitemap |
  |---|---|---|
  | En stock, enchère en cours ou à venir | 200, indexable | oui |
  | Enchère terminée | 200, `noindex` (« Vente terminée ») | non |
  | Véhicule retiré ou vendu | 410, `noindex` | non |
  | Adresse inconnue | 404, `noindex` | non |

- **`/vehicules`** : liste de tous les véhicules indexables (données `ItemList`), point d'entrée pour les
  robots.
- **Accueil** : le Worker insère la liste des véhicules dans la section « Tous nos véhicules », lisible sans
  JavaScript (`HTMLRewriter`). Les cartes du catalogue renvoient vers les pages véhicules. Le lien
  `/?lot=REF`, depuis une page véhicule, ouvre la fiche avec enchère et achat. Titre et description sont
  orientés achat et import de véhicules européens en Tunisie.
- **Sans régression** : enchères, offres, comptes et administration sont inchangés. `/api/catalogue` ajoute
  seulement un champ `url` à chaque lot.

### Sitemap dynamique

`/sitemap.xml` est généré par le Worker : pages statiques (`PAGES_STATIQUES` dans `worker/seo.js`) et
véhicules indexables, avec `lastmod`. Le fichier statique est supprimé, et `robots.txt` est inchangé (`/api/`,
`/oauth/` et `/mcp` restent interdits).

### Guide « Importer un véhicule en Tunisie » (brouillon)

`my-auto-export/importer-un-vehicule-en-tunisie.html` couvre l'achat, la composition du prix, l'enlèvement,
le transport, le dédouanement et le régime FCR, avec des données `FAQPage`. **Il ne contient que des phrases
reprises des conditions générales**, citées article par article : aucune règle douanière, aucun délai ni
montant n'a été ajouté. Comme ces conditions sont elles-mêmes à valider, la page est en `noindex` et hors
sitemap. Pour la publier :

1. faire valider le texte ;
2. retirer `<meta name="robots" content="noindex, follow">` ;
3. ajouter `"/importer-un-vehicule-en-tunisie"` à `PAGES_STATIQUES` dans `worker/seo.js` ;
4. ajouter un lien depuis l'accueil.

### Photos

`scripts/optimiser_photos.py` crée `photos/web/<nom>.webp` (1280 px maximum, qualité 0,8) pour chaque photo de
`photos/`. Il utilise le Chromium de Playwright, déjà requis par les tests, et ne recopie pas les métadonnées.
À relancer après `scripts/ajouter_lot.py` ; `tests/test_referencement.py` échoue s'il manque une version.

### Configuration — `wrangler.jsonc`

- `assets.run_worker_first: ["/", "/admin", "/admin.html"]`. Sans ce réglage, Cloudflare sert ces fichiers
  sans exécuter le Worker, donc sans liste insérée ni en-tête `X-Robots-Tag`. Les autres fichiers (photos,
  logo) restent servis directement.
- `triggers.crons: ["0 5 * * *", "0 6 * * *"]` pour le contrôle quotidien.

## 3. Automatisation et journal

| Moment | Ce qui se passe |
|---|---|
| Véhicule enregistré ou retiré (`/admin`, outils MCP) | Page, liste, accueil et sitemap à jour immédiatement. Contrôle SEO de ce véhicule : en arrière-plan depuis `/admin`, avant la réponse depuis le MCP. Un échec du contrôle n'annule jamais la modification. |
| Chaque jour à 07:00, heure de Paris | Contrôle de tout le catalogue. Le Cron Cloudflare est en UTC : deux déclencheurs, 05:00 et 06:00 UTC, et seul celui qui tombe à 07:00 à Paris s'exécute (heure d'été ou d'hiver). |
| Après un déploiement | `python3 scripts/controle_seo.py` contrôle chaque adresse du sitemap de production (lecture seule). |

Le contrôle du Worker vérifie les adresses en double, les champs manquants (année, kilométrage, photo), les
données structurées, la photo principale et la fiche fournisseur de chaque véhicule (40 liens au plus par
exécution, sous la limite de 50 sous-requêtes du plan gratuit). Il signale aussi les ventes terminées. Les
réponses 401, 403 et 429 sont des avertissements « accès restreint », les autres échecs des erreurs.

**Journal** : table D1 `seo_journal` (migration `0011_journal_seo.sql`, une nouvelle table, aucune donnée
existante modifiée), où sont conservés les 90 derniers contrôles. Chaque contrôle est aussi écrit dans les
logs du Worker (`npx wrangler tail`). Pour le consulter :

```
# compte administrateur connecté : GET /api/admin/seo (30 derniers contrôles)
npx wrangler d1 execute DB --remote --command "SELECT ran_at, declencheur, ok, resume FROM seo_journal ORDER BY id DESC LIMIT 5"
```

**Pipeline `my-auto-agent`** : `publier_catalogue_site.py` écrit `lots.json` dans ce dépôt. Après validation et
déploiement, ces lots ont leur page et leur entrée dans le sitemap sans autre étape. Lancer ensuite
`scripts/controle_seo.py`.

## 4. Tests

```
pip install playwright && playwright install chromium
WRANGLER=/chemin/vers/wrangler python3 -m unittest discover tests
```

Résultat sur cette branche le 2026-11-01 (wrangler 4.156.0, Python 3.14) : **99 tests, tous réussis**. Avant
les changements : 77 tests réussis.

- `tests/test_pages_vehicules.py` (18 tests, Worker + D1 locale + Chromium) : codes HTTP 200, 301, 404 et 410 ;
  canonical ; titre unique ; données structurées (`Car`, `Product`/`Offer`, `BreadcrumbList`, `ItemList`) ;
  caractéristiques dans le HTML ; images WebP et `alt` ; sitemap limité aux pages indexables ; redirection
  après modification ; accueil lisible sans JavaScript ; lien `/?lot=` ; affichage mobile à 360 px (pas de
  défilement horizontal, texte de 16 px, zones tactiles de 44 px) ; contrôle quotidien déclenché à 06:00 UTC
  et ignoré à 05:00 UTC ; journal ; contrôle `scripts/controle_seo.py` sans erreur sur le site local.
- `tests/test_referencement.py` (8 tests, sans serveur) : `robots.txt`, absence de sitemap statique, balises,
  liens sans `.html`, guide en brouillon, versions WebP présentes.

Non couvert : mesure Lighthouse ou Core Web Vitals en conditions réelles (à faire après déploiement avec
PageSpeed Insights, gratuit), redirection http → https (testable seulement sur le vrai domaine).

## 5. Déploiement Cloudflare (après validation explicite)

Ordre à respecter : la migration avant le code, pour que le journal existe au premier contrôle. Le Worker reste
fonctionnel sans elle : le contrôle échoue alors sans effet sur le site.

1. Fusionner la Pull Request dans `main` après revue.
2. Sauvegarder la base : `npx wrangler d1 export DB --remote --output sauvegarde-$(date +%F).sql`.
3. Créer la table du journal : `npx wrangler d1 migrations apply DB --remote` (applique les migrations en attente, dont `0011`).
4. Déployer : `npx wrangler deploy`. Les fichiers (dont `photos/web/`) et les deux Cron sont publiés.
5. Tableau de bord Cloudflare, zone `myautoexport.com` → SSL/TLS → Certificats Edge → **Always Use HTTPS :
   activé** (gratuit). Cela couvre aussi les fichiers servis sans le Worker.
6. Vérifier :
   - `python3 scripts/controle_seo.py` doit renvoyer `"erreurs": []` et le code 0 ;
   - `curl -sI http://www.myautoexport.com/` doit répondre 301 vers https ;
   - ouvrir deux pages véhicules sur mobile ;
   - lendemain : une ligne `quotidien` dans `seo_journal`.
7. Google Search Console et Bing Webmaster Tools : déclarer le sitemap ; faire inspecter une page véhicule.

### Retour arrière

- **Code et fichiers** : `npx wrangler deployments list`, puis `npx wrangler rollback <id-de-version>`. La
  version précédente revient avec ses fichiers statiques, dont l'ancien `sitemap.xml`.
- **Cron** : les déclencheurs ne font pas partie de la version et restent actifs. L'ancienne version n'a pas de
  gestionnaire `scheduled` : supprimer les deux déclencheurs dans le tableau de bord (Worker → Paramètres →
  Déclencheurs).
- **Base** : la table `seo_journal` peut rester, elle n'est lue par rien d'autre. Aucune donnée existante n'a
  été modifiée.
- **Always Use HTTPS** peut rester activé.
- **Moteurs de recherche** : les pages véhicules déjà découvertes répondront 404 après un retour arrière ;
  elles sortent de l'index d'elles-mêmes.

## 6. Coordination

- Le passage aux adresses sans `.html` (`/conditions`, `/admin`) est en cours, non commité, dans la copie de
  travail principale du dépôt. Cette branche contient les **mêmes modifications** pour `conditions.html`,
  `index.html` et `tests/test_encheres.py`. `sitemap.xml` (supprimé ici) et `tests/test_referencement.py`
  (réécrit ici) entreront en conflit.
- La PR #1 (`config/agents-ia`) modifie aussi `wrangler.jsonc` : conflit probable, à résoudre en gardant ses
  réglages d'aperçu et les ajouts de cette branche (`run_worker_first`, `triggers`).
