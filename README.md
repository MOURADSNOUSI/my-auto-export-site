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
