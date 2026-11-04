# my-auto-export-site

## Tests

```
pip install playwright && playwright install chromium
python3 -m unittest discover tests
```

Les tests du Worker (espace acheteur, enchères, administration, MCP, pages véhicules) sont ignorés sans
`WRANGLER=/chemin/vers/wrangler`.

Tests JavaScript (Vitest, `fetch` simulé) : `npm install`, puis `npm run test:js`.

## Catalogue Europe (TheCarApi)

`GET /api/voitures-europe` renvoie des voitures lues chez TheCarApi (`worker/voitures-europe.js`), sous la forme
`{ total, voitures: [{ id, titre, annee, km, carburant, boite, prixEur, prixTnd, source, finEnchere, image }] }`.

- **Préfiltre M&Y**, toujours appliqué (constantes en haut du fichier) : sites `openlane,ecarstrade`, année ≥ 2019,
  150 000 km au plus, 30 000 € au plus, 24 résultats. `mileage_to`, `price_to` et `page` ne sont pas documentés par
  TheCarApi : à vérifier (`PREFILTRE_A_VERIFIER`, `PARAMETRES_A_VERIFIER`).
- **Affinages du visiteur** : `brand`, `model`, `fuel`, `year_from`, `price_to`, `page` uniquement (40 caractères au plus,
  lettres, chiffres, espaces, virgules, points, tirets), sinon 400. `year_from` et `price_to` ne peuvent que resserrer
  le préfiltre. Tout autre paramètre est ignoré.
- **Cache** de 15 minutes (Cache API, clé = paramètres triés) pour économiser le quota. Aucune nouvelle tentative en cas
  d'échec : 5 échecs d'authentification bloquent l'IP 15 minutes chez TheCarApi.
- **Erreurs** : sans clé, 503 ; si TheCarApi échoue (401/403 clé ou portée, 429 quota…), 502 avec un message en
  français. Seul le statut est journalisé, jamais la clé ni la réponse.

Configuration :
- **Clé** : `npx wrangler secret put THECARAPI_KEY` (production). Elle n'est jamais envoyée au navigateur.
- **`EUR_TND_RATE`** (dinars pour 1 euro) donne `prixTnd = round(prixEur × taux)` ; sans taux valide, `prixTnd` vaut `null`.
  Le déclarer de préférence comme secret (`npx wrangler secret put EUR_TND_RATE`) : `wrangler.jsonc` n'a pas de `vars`,
  et une variable saisie dans le tableau de bord Cloudflare est effacée au déploiement suivant par `wrangler deploy`.
- **En local** : copier `.dev.vars.example` en `.dev.vars` (ignoré par git) et y mettre la clé et le taux.

## Référencement

Pages véhicules `/vehicules/…`, sitemap dynamique, contrôle SEO quotidien et journal : voir [docs/SEO.md](docs/SEO.md).
Contrôler le site en production (lecture seule) : `python3 scripts/controle_seo.py`.

## Ajouter un lot

```
python3 scripts/ajouter_lot.py --reference MY-001 --marque Peugeot --modele 3008 \
    --statut open --fin 2026-11-20T18:00 --prix 85000 --annee 2021 --km 54000 \
    --carburant Diesel --categorie SUV photo-avant.jpg photo-arriere.jpg
```

Les photos sont copiées dans `my-auto-export/photos/` et le lot est ajouté à
`my-auto-export/lots.json`. `--statut upcoming` (défaut) pour un lot à venir, sans date de fin.
`--source` (lien https vers la fiche fournisseur) est facultatif : sans lien, la carte affiche
« Se renseigner », qui ouvre le formulaire de contact. `python3 scripts/ajouter_lot.py -h` liste
toutes les options. Pour retirer un lot, supprime son entrée dans `lots.json` et ses photos.
Après l'ajout de photos, lance `python3 scripts/optimiser_photos.py` : il crée leurs versions WebP allégées.

## Importer le catalogue Wix

```
python3 scripts/importer_wix.py --essai   # aperçu, n'écrit rien
python3 scripts/importer_wix.py
```

Ajoute les véhicules de la page Wix en statut « En stock », prix en TND selon la formule
(prix HT EUR + 3 000) × 3,5 + 30 000. Un lot déjà présent n'est jamais écrasé : seuls ses champs vides sont complétés
(un prix déjà importé n'est donc pas recalculé).

Les photos importées sont enregistrées avec `authorized: false` et ne s'affichent pas sur le site : une adresse
https ne prouve aucun droit de publication. Une fois le droit confirmé par écrit par le fournisseur, relancer avec
`--photos-autorisees`.

## Espace acheteur (comptes, favoris, offres)

Le site est servi par un Worker Cloudflare (`worker/index.js`, point d'entrée `worker/main.js`) avec une base D1 (`migrations/`).
Mise en service, une seule fois, depuis une machine avec Node.js 20 ou plus :

```
npx wrangler login
npx wrangler d1 create my-auto-export          # copier le database_id affiché dans wrangler.jsonc
npx wrangler d1 migrations apply DB --remote   # crée les tables
npx wrangler deploy
```

`wrangler.jsonc` contient déjà le `database_id` de la base de production : ces étapes ne sont à refaire que pour
une nouvelle base (remplacer alors l'identifiant par celui qu'affiche `d1 create`).

Consulter les offres reçues et y répondre :

```
npx wrangler d1 execute DB --remote --command "SELECT o.id, o.reference, o.amount_tnd, o.kind, o.status, o.created_at, u.name, u.email, u.phone FROM offers o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC"
npx wrangler d1 execute DB --remote --command "UPDATE offers SET status = 'accepted' WHERE id = 1"   # ou 'refused'
```

Tests du Worker (ignorés sans wrangler) : `WRANGLER=$(npx which wrangler) python3 -m unittest discover tests`

## Administration du catalogue (/admin.html)

Ajouter, modifier, retirer un véhicule et envoyer ses photos, depuis un téléphone ou un ordinateur.
Les véhicules sont enregistrés dans D1 (table `vehicles`) et les photos dans R2 (`my-auto-export-photos`).
Le site public affiche `lots.json` + les véhicules de l'administration : modifier un véhicule de `lots.json`
dans l'administration le remplace, le retirer le masque (sans toucher au fichier).

Mise en service, une seule fois :

```
npx wrangler r2 bucket create my-auto-export-photos
npx wrangler d1 migrations apply DB --remote
```

Puis crée ton compte sur le site (« Se connecter » → « Créer un compte ») et donne-lui l'accès :

```
npx wrangler d1 execute DB --remote --command "UPDATE users SET role = 'admin' WHERE email = 'ton@email.com'"
```

Retirer l'accès : même commande avec `role = 'buyer'`.

## Enchères en direct

Un véhicule est mis aux enchères dans l'administration avec le statut « Enchère en cours » et une date de fin
(« Enchère à venir » l'affiche sans permettre d'enchérir).

- Chaque enchère doit dépasser la meilleure d'un pas minimum : celui du véhicule (champ « Pas d'enchère »),
  sinon 200 TND sous 20 000, 500 sous 100 000, 1 000 sous 300 000, 2 000 au-delà. La première enchère part de la mise à prix.
- Une enchère placée dans les 2 dernières minutes repousse la fin à 2 minutes après elle.
- Le site affiche le prix actuel, le compte à rebours, la réserve atteinte ou non et l'historique anonymisé ;
  la fiche se met à jour toutes les 8 secondes.
- À la fin, le meilleur enchérisseur gagne si la réserve est atteinte. Dans l'administration, le bouton « Enchères »
  d'un véhicule liste les enchères avec le nom, l'e-mail et le téléphone de chaque enchérisseur.

Mise en service : `npx wrangler d1 migrations apply DB --remote` (index 0004), puis `git push origin main`.

## Conditions générales de vente (/conditions.html)

Projet rédigé selon le droit tunisien (COC, loi n° 2000-83, loi n° 92-117, loi organique n° 2004-63),
**à faire valider par un avocat tunisien** et à compléter (passages surlignés « À compléter ») avant publication.

- Avant sa première enchère ou demande d'achat, l'acheteur coche « J'ai lu et j'accepte les conditions » ;
  la version et la date d'acceptation sont enregistrées (`users.terms_version`, `users.terms_accepted_at`).
- Pour publier une nouvelle version : modifier `conditions.html`, puis changer la même date dans
  `CGV_VERSION` (worker/index.js) et dans `#cgv-version` (conditions.html). Tous les acheteurs devront réaccepter.

⚠️ Appliquer la migration **avant** de pousser le code, sinon la connexion échoue :
`npx wrangler d1 migrations apply DB --remote`, puis `git push origin main`.

## Accepter ou refuser les offres (administration)

En haut de `/admin`, la rubrique « À traiter » liste les ventes terminées en attente de décision et les demandes
d'achat immédiat. « Décider » ouvre les offres du véhicule (acheteur, e-mail, téléphone) :

- **Accepter** (possible seulement après la fin de la vente pour une enchère, y compris sous la réserve) : les autres
  offres en attente passent en « Refusée », le véhicule apparaît dans « Mes véhicules » de l'acheteur et, si la case est
  cochée, il est retiré du site. Le bouton « Envoyer la confirmation écrite » prépare l'e-mail prévu par les CGV (art. 6.3).
- **Refuser** : l'offre seule passe en « Refusée ».

L'acheteur voit « Acceptée · l'équipe vous contacte » ou « Refusée » dans sa page personnelle.

Pour une enchère, seule la **meilleure** peut être acceptée (les autres peuvent seulement être refusées). L'acceptation
est atomique : si deux administrateurs acceptent en même temps deux offres du même véhicule, une seule passe, l'autre
reçoit une erreur sans rien modifier. La base l'impose aussi (index `offers_une_acceptee`, migration 0006).

⚠️ Avant de pousser ce code : `npx wrangler d1 migrations apply DB --remote` (0006). La migration échoue si un véhicule
a déjà deux offres acceptées ; vérifier avant :
`npx wrangler d1 execute DB --remote --command "SELECT reference, COUNT(*) FROM offers WHERE status = 'accepted' GROUP BY reference HAVING COUNT(*) > 1"`

## Factures PDF

Le téléchargement des factures est **désactivé** : `wrangler.jsonc` ne déclare pas de stockage `DOCUMENTS`. L'espace
acheteur affiche « PDF non disponible » et `/api/invoices/<id>/document` répond 503. Pour l'activer, il faudra créer un
bucket R2 privé (`npx wrangler r2 bucket create my-auto-export-documents`), le déclarer avec le binding `DOCUMENTS`
et prévoir l'envoi des PDF depuis l'administration (pas encore développé).

## Sécurité

- **Enchères refusées** : refuser une enchère (par exemple un montant fantaisiste) la retire du prix courant, de l'historique
  public et du calcul de la meilleure enchère ; la vente reprend au prix réel.
- **Essais de mot de passe** : 5 échecs par e-mail et par adresse IP, 30 par IP, 100 par e-mail sur 15 minutes. De faux mots de
  passe tapés ailleurs ne bloquent donc pas le titulaire du compte. Inscriptions : 10 par IP et par heure.
- **En-têtes** : `ENTETES_SECURITE` (worker/index.js) pour les réponses du Worker, `my-auto-export/_headers` pour les fichiers
  statiques (CSP, HSTS, interdiction d'affichage dans un cadre). Les deux doivent rester identiques (tests/test_securite.py).

⚠️ Appliquer la migration **avant** de pousser le code, sinon la connexion échoue :
`npx wrangler d1 migrations apply DB --remote` (0012), puis `git push origin main`.

Dans le tableau de bord Cloudflare (SSL/TLS → Edge Certificates) : activer « Always Use HTTPS », sans quoi le site reste
accessible en http.

## Connecter Claude au site (serveur MCP)

Le Worker expose un serveur MCP sur `/mcp` : Claude peut alors gérer le site avec les droits d'un administrateur
(`worker/mcp.js`). Outils : rechercher les véhicules, voir une fiche, ventes à traiter, lister les offres, ajouter
ou modifier un véhicule, le retirer du site, accepter ou refuser une offre. Ils appliquent les mêmes règles que
`/admin.html` (seule la meilleure enchère peut être acceptée, après la fin de la vente, etc.).

Mise en service, une seule fois : `npx wrangler d1 migrations apply DB --remote` (0007), puis `git push origin main`.

- **claude.ai / Claude Desktop** : Paramètres → Connecteurs → Ajouter un connecteur personnalisé, adresse
  `https://www.myautoexport.com/mcp`.
- **Claude Code** : `claude mcp add --transport http my-auto-export https://www.myautoexport.com/mcp`, puis `/mcp` pour se connecter.

Claude ouvre la page `/oauth/authorize` du site : se connecter avec un compte **administrateur** et cliquer « Autoriser ».
Le mot de passe est demandé à chaque autorisation, même si l'on est déjà connecté au site. Les codes ne peuvent être
renvoyés qu'à Claude (claude.ai, claude.com) ou à une adresse locale (`localhost`).

- L'accès (jeton de 1 heure, renouvelé automatiquement) dure tant que Claude s'en sert au moins une fois tous les 30 jours.
- Il s'arrête dès que le compte perd le rôle `admin`.
- Couper tous les accès donnés à Claude :
  `npx wrangler d1 execute DB --remote --command "DELETE FROM oauth_tokens"`

Claude est invité à demander confirmation avant toute modification, mais c'est le réglage d'autorisation des outils
dans Claude (« Toujours demander ») qui l'impose : à garder pour `accepter_offre`, `refuser_offre`, `retirer_vehicule`
et `enregistrer_vehicule`.
