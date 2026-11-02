# my-auto-export-site

## Tests

```
pip install playwright && playwright install chromium
python3 -m unittest discover tests
```

Les tests du Worker (espace acheteur, enchères, administration, MCP, pages véhicules) sont ignorés sans
`WRANGLER=/chemin/vers/wrangler`.

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

## Vendre mon véhicule (issue #5)

`/vendre.html` permet de créer un compte ou de réutiliser son compte, de compléter ses coordonnées
vendeur, puis de préparer plusieurs dossiers. Les brouillons ne sont jamais inclus dans le catalogue.
Les champs VIN (17 caractères), prix en TND, année, kilométrage, motorisation, type de vente,
garage agréé actif, date non future et six observations techniques sont contrôlés à la soumission.
Sept catégories de pièces sont obligatoires : extérieur, intérieur, tableau de bord, défauts,
carte grise, justificatif du droit de vente et diagnostic PDF. Un diagnostic « sans défaut »
doit aussi documenter les points contrôlés. Limite : 40 pièces, 10 Mo par pièce.

Dans `/admin-vendeurs.html` (lien depuis l'administration), un administrateur ajoute les vrais garages
partenaires, active ou désactive leur agrément et examine les dossiers soumis. Aucun garage fictif
n'est ajouté à la base. La désactivation empêche les nouvelles soumissions et approbations ; elle
ne révoque pas les diagnostics déjà approuvés. Un refus ou une demande de corrections exige un motif.
Le vendeur peut alors corriger son dossier et le soumettre à nouveau. Pendant la vérification et après
approbation, le vendeur ne peut modifier ni les données ni les pièces.

L'approbation demande de confirmer explicitement la vérification de l'authenticité auprès du garage
et celle du dossier. Ces cases consignent une vérification humaine : le logiciel ne vérifie pas
l'authenticité d'un PDF à lui seul. L'identifiant de l'administrateur et la date sont enregistrés.
La décision et la publication sont atomiques. Une vente directe paraît « En stock » ; une enchère
paraît « À venir » et l'administrateur fixe ensuite son ouverture et sa date de fin dans le catalogue.
Le prix demandé est utilisé comme mise à prix pour les enchères.

Le badge « Diagnostic vérifié par M&Y AUTO EXPORT » est calculé côté serveur à partir d'une approbation
réelle et du contenu publié, jamais depuis un champ fourni par le vendeur. Une modification ultérieure
des caractéristiques techniques ou des photos dans le catalogue enlève ce badge par prudence :
l'attestation porte sur le véhicule approuvé. La programmation d'une enchère ou un changement de prix
conserve le badge.

Les pièces sont conservées dans un bucket R2 distinct, **privé** (`SELLER_DOCUMENTS`). Ne lui associer
ni domaine public ni accès `r2.dev`. Les téléchargements de pièces sont authentifiés, limités au propriétaire
ou aux administrateurs, forcés en pièces jointes et non mis en cache. Seules les quatre catégories de photos
du véhicule deviennent accessibles sans session après approbation via `/seller-media/<id>`.
Le VIN, les coordonnées, la carte grise, le justificatif et le PDF du diagnostic ne sont pas publiés.
Le retrait d'une annonce du catalogue n'efface pas automatiquement ses photos déjà publiées ni les pièces.

Préparation de mise en service, **à exécuter uniquement après autorisation de déploiement** :

```
npx wrangler r2 bucket create my-auto-export-seller-private
npx wrangler r2 bucket create my-auto-export-seller-private-preview
npx wrangler d1 migrations apply DB --remote
```

Le binding est préparé dans `wrangler.jsonc`, mais aucun bucket distant n'est créé par le code ni par les tests.
Appliquer `0011_dossiers_vendeurs.sql` avant de déployer le Worker ; les autres migrations de branches en cours
ne font pas partie de cette fonctionnalité. Vérifier leur ordre à la fusion. Les garages réels doivent ensuite
être renseignés par l'administrateur avant que les vendeurs puissent soumettre.

Tests isolés, sans base ni bucket de production :

```
WRANGLER=/chemin/vers/wrangler python3 -m unittest discover -s tests -p 'test_vendeur.py' -v
```

Ils utilisent une base D1 et un bucket R2 éphémères, et Playwright/Chromium pour les écrans vendeur.

### Rubriques de l'espace vendeur

Après connexion, le menu de `/vendre` filtre les dossiers du vendeur avec des compteurs calculés :
« Tous les véhicules », « Véhicules actifs », « Vendu », « Archivé ». Les actifs comprennent les
brouillons, les dossiers en vérification ou à corriger et les annonces publiées non vendues/non retirées.
Une offre acceptée classe le véhicule dans « Vendu », même si l'administration a retiré son annonce.
Une annonce approuvée retirée sans vente acceptée apparaît dans « Archivé ». Ces rubriques sont
exclusives et ne modifient pas les données : le retrait reste géré dans l'administration.

### Première étape : identifier le véhicule

« Ajouter un véhicule » ouvre l'identification : numéro de châssis (17 caractères), lieu et pays
d'origine obligatoires ; plaque d'immatriculation et date de première immatriculation facultatives.
Le lieu propose les gouvernorats tunisiens ou « Autre lieu / à l'étranger » avec saisie libre.
La liste des pays utilise les codes ISO. Une date renseignée doit être valide et non future.
« Poursuivre » ne s'active que lorsque l'identification est valide et enregistre le brouillon avant
d'ouvrir « Sélectionner le modèle ». Le retour permet de modifier l'identification ; « Annuler »
conserve le brouillon dans les dossiers sans le soumettre. Les nouveaux champs sont également
contrôlés à la soumission et présentés à l'administrateur. Ils restent privés, comme le VIN.
Les anciens brouillons doivent être complétés avant soumission ; aucune migration SQL supplémentaire
n'est nécessaire car ces champs sont conservés dans les données JSON du dossier.
