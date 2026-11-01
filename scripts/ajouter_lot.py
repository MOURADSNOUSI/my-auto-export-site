"""Ajoute un lot au catalogue avec des photos locales.

Exemple :
  python3 scripts/ajouter_lot.py --reference MY-001 --marque Peugeot --modele 3008 \
      --statut open --fin 2026-11-20T18:00 --prix 85000 --annee 2021 --km 54000 \
      --carburant Diesel --categorie SUV ~/Images/3008-avant.jpg ~/Images/3008-arriere.jpg

Les photos sont copiées dans my-auto-export/photos/ et le lot est ajouté à
my-auto-export/lots.json. Ne passe que des photos que tu as le droit de publier.
"""
import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent.parent / "my-auto-export"
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def parse_date(value):
    date = datetime.fromisoformat(value)
    if date.tzinfo is None:
        date = date.astimezone()  # heure locale de la machine
    return date


def main(argv=None):
    parser = argparse.ArgumentParser(description="Ajoute un lot au catalogue M&Y AUTO EXPORT.")
    parser.add_argument("photos", nargs="*", type=Path, help="photos du véhicule (jpg, png, webp)")
    parser.add_argument("--reference", required=True)
    parser.add_argument("--marque", required=True)
    parser.add_argument("--modele", required=True)
    parser.add_argument("--finition")
    parser.add_argument("--statut", choices=["open", "upcoming", "stock"], default="upcoming",
                        help="open = enchère en cours, upcoming = à venir (défaut), stock = vente directe")
    parser.add_argument("--fin", type=parse_date, help="fin de la vente, ex. 2026-11-20T18:00 (obligatoire si open)")
    parser.add_argument("--prix", type=float, help="prix indicatif en TND")
    parser.add_argument("--mise-a-prix", type=float, help="prix de départ de l'enchère en TND")
    parser.add_argument("--reserve", type=float, help="prix de réserve en TND (affiché sur le site)")
    parser.add_argument("--achat-immediat", type=float, help="prix d'achat immédiat en TND")
    parser.add_argument("--disponible", help="disponible à l'enlèvement : date (2026-11-15) ou texte (Immédiatement)")
    parser.add_argument("--lieu", help="lieu d'enlèvement, ex. Tunis, La Marsa")
    parser.add_argument("--vendeur", help="nom du vendeur")
    parser.add_argument("--detail", action="append", default=[], metavar="LIBELLÉ=VALEUR",
                        help="caractéristique affichée sur la fiche, ex. \"Transmission=4x4\" (répétable)")
    parser.add_argument("--annee", type=int)
    parser.add_argument("--km", type=int)
    parser.add_argument("--carburant")
    parser.add_argument("--categorie", help="ex. SUV, Berline, Citadine")
    parser.add_argument("--source", help="lien https vers la fiche fournisseur")
    parser.add_argument("--site", type=Path, default=SITE_DIR, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    if args.statut == "open":
        if args.fin is None:
            parser.error("--fin est obligatoire pour un lot en vente (--statut open)")
        if args.fin <= datetime.now(timezone.utc):
            parser.error("--fin est déjà passée : le lot ne serait pas affiché")
    if args.source and not args.source.startswith("https://"):
        parser.error("--source doit commencer par https://")
    paliers = [("--mise-a-prix", args.mise_a_prix), ("--reserve", args.reserve), ("--achat-immediat", args.achat_immediat)]
    paliers = [(nom, valeur) for nom, valeur in paliers if valeur is not None]
    for (nom_bas, bas), (nom_haut, haut) in zip(paliers, paliers[1:]):
        if haut < bas:
            parser.error(f"{nom_haut} ({haut:.0f}) doit être supérieur ou égal à {nom_bas} ({bas:.0f})")
    specs = []
    for detail in args.detail:
        libelle, _, valeur = detail.partition("=")
        if not libelle.strip() or not valeur.strip():
            parser.error(f"--detail attend LIBELLÉ=VALEUR : {detail}")
        specs.append([libelle.strip(), valeur.strip()])
    for photo in args.photos:
        if not photo.is_file():
            parser.error(f"photo introuvable : {photo}")
        if photo.suffix.lower() not in EXTENSIONS:
            parser.error(f"format non accepté : {photo.name} (jpg, png ou webp)")

    catalogue_path = args.site / "lots.json"
    catalogue = json.loads(catalogue_path.read_text(encoding="utf-8"))
    if any(lot["reference"] == args.reference for lot in catalogue):
        parser.error(f"la référence {args.reference} existe déjà dans lots.json")

    photos_dir = args.site / "photos"
    photos_dir.mkdir(exist_ok=True)
    photos = []
    for index, photo in enumerate(args.photos, start=1):
        nom = f"{args.reference}-{index}{photo.suffix.lower()}"
        shutil.copyfile(photo, photos_dir / nom)
        photos.append({"url": f"photos/{nom}", "authorized": True})

    lot = {
        "reference": args.reference,
        "make": args.marque,
        "model": args.modele,
        "trim": args.finition,
        "status": args.statut,
        "endsAt": args.fin.isoformat() if args.fin else None,
        "indicativePriceTnd": args.prix,
        "startingPriceTnd": args.mise_a_prix,
        "reservePriceTnd": args.reserve,
        "buyNowPriceTnd": args.achat_immediat,
        "year": args.annee,
        "mileageKm": args.km,
        "fuel": args.carburant,
        "bodyType": args.categorie,
        "sourceUrl": args.source,
        "availableFrom": args.disponible,
        "pickupLocation": args.lieu,
        "seller": args.vendeur,
        "photos": photos,
        "specs": specs or None,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    catalogue.append({key: value for key, value in lot.items() if value is not None})
    catalogue_path.write_text(json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Lot {args.reference} ajouté avec {len(photos)} photo(s).")


if __name__ == "__main__":
    sys.exit(main())
