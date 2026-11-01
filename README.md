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
