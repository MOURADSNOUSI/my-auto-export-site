# my-auto-export-site

## Tests

```
pip install playwright && playwright install chromium
python3 -m unittest discover tests
```

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

## Importer le catalogue Wix

```
python3 scripts/importer_wix.py --essai   # aperçu, n'écrit rien
python3 scripts/importer_wix.py
```

Ajoute les véhicules de la page Wix en statut « En stock », prix en TND selon la formule
(EUR + 3 000) × 3,5 + 20 000. Un lot déjà présent n'est jamais écrasé : seuls ses champs vides sont complétés.

## Espace acheteur (comptes, favoris, offres)

Le site est servi par un Worker Cloudflare (`worker/index.js`) avec une base D1 (`migrations/`).
Mise en service, une seule fois, depuis une machine avec Node.js 20 ou plus :

```
npx wrangler login
npx wrangler d1 create my-auto-export          # copier le database_id affiché dans wrangler.jsonc
npx wrangler d1 migrations apply DB --remote   # crée les tables
npx wrangler deploy
```

Tant que `database_id` vaut `00000000-…` dans `wrangler.jsonc`, le déploiement échoue :
ne pousse pas `main` avant d'avoir fait ces étapes.

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
