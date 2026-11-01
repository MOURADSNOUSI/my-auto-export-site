"""Importe le catalogue du site Wix M&Y AUTO EXPORT dans my-auto-export/lots.json.

Lancement :
  python3 scripts/importer_wix.py            # importe
  python3 scripts/importer_wix.py --essai    # affiche ce qui changerait, sans écrire
  python3 scripts/importer_wix.py --photos-autorisees   # droit de publier les photos confirmé par le fournisseur

Les véhicules sont publiés « En stock » (vente directe). Prix en TND selon la formule
M&Y : (prix fournisseur HT EUR + 3 000) × 3,5 + 30 000 ; sans prix fournisseur, « Prix sur demande ».
Les photos importées ne sont pas affichées sur le site (authorized: false) tant que le droit de les publier
n'a pas été confirmé avec --photos-autorisees.
Un véhicule déjà présent dans lots.json n'est jamais écrasé : seuls ses champs vides sont complétés.
"""
import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent.parent / "my-auto-export"
WIX_URL = "https://headless-fcneupvvsmh-contactmyautoexpor-1412.wix-site-host.com/"
# Marques en plusieurs mots : début du titre -> (marque, modèle)
MARQUES_COMPOSEES = {"Mercedes-Benz ": ("Mercedes-Benz", None), "Range Rover ": ("Land Rover", "Range Rover")}


def lire_catalogue(html):
    match = re.search(r"const cars=(\[.*?\]);", html, re.S)
    if not match:
        raise ValueError("tableau « cars » introuvable dans la page Wix")
    return json.loads(match.group(1))


def prix_tnd(eur):
    return None if eur is None else (eur + 3000) * 3.5 + 30000


def decouper_titre(titre):
    for prefixe, (marque, modele) in MARQUES_COMPOSEES.items():
        if titre.startswith(prefixe):
            reste = titre[len(prefixe):]
            break
    else:
        marque, _, reste = titre.partition(" ")
        modele = None
    if modele is None:
        modele, _, reste = reste.partition(" ")
    return marque, modele, reste.strip() or None


def vers_lot(car, maintenant, photos_autorisees=False):
    marque, modele, finition = decouper_titre(car["title"])
    mois, _, annee = car["date"].partition("/")
    lot = {
        "reference": str(car["id"]),
        "make": marque,
        "model": modele,
        "trim": finition,
        "status": "stock",
        "year": int(annee) if annee.isdigit() else None,
        "mileageKm": car.get("km"),
        "fuel": car.get("fuel"),
        "indicativePriceTnd": prix_tnd(car.get("eur")),
        "sourceUrl": f"https://ecarstrade.com/cars/{car['id']}",
        # Une adresse https ne dit rien des droits sur l'image : l'autorisation doit être confirmée explicitement.
        "photos": [{"url": url, "authorized": photos_autorisees} for url in car.get("photos", []) if url.startswith("https://")],
        "specs": [["Mise en circulation", car["date"]]],
        "createdAt": maintenant,
    }
    return {key: value for key, value in lot.items() if value is not None}


def fusionner(catalogue, nouveaux):
    """Ajoute les nouveaux lots ; pour une référence existante, ne complète que les champs vides."""
    par_reference = {lot["reference"]: lot for lot in catalogue}
    ajoutes, completes = [], []
    for nouveau in nouveaux:
        existant = par_reference.get(nouveau["reference"])
        if existant is None:
            catalogue.append(nouveau)
            ajoutes.append(nouveau["reference"])
            continue
        champs = [cle for cle, valeur in nouveau.items() if existant.get(cle) in (None, "", []) and cle not in ("status", "createdAt")]
        for cle in champs:
            existant[cle] = nouveau[cle]
        if champs:
            completes.append((nouveau["reference"], champs))
    return ajoutes, completes


def main(argv=None):
    parser = argparse.ArgumentParser(description="Importe le catalogue Wix dans lots.json.")
    parser.add_argument("--url", default=WIX_URL)
    parser.add_argument("--essai", action="store_true", help="n'écrit rien, affiche seulement le résultat")
    parser.add_argument("--photos-autorisees", action="store_true",
                        help="le fournisseur a confirmé par écrit le droit de publier ses photos ; sinon elles restent masquées")
    parser.add_argument("--html", type=Path, help=argparse.SUPPRESS)  # page déjà téléchargée (tests)
    parser.add_argument("--site", type=Path, default=SITE_DIR, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    if args.html:
        html = args.html.read_text(encoding="utf-8")
    else:
        requete = urllib.request.Request(args.url, headers={"User-Agent": "Mozilla/5.0"})
        html = urllib.request.urlopen(requete, timeout=30).read().decode("utf-8")
    maintenant = datetime.now(timezone.utc).isoformat()
    nouveaux = [vers_lot(car, maintenant, args.photos_autorisees) for car in lire_catalogue(html)]

    chemin = args.site / "lots.json"
    catalogue = json.loads(chemin.read_text(encoding="utf-8"))
    ajoutes, completes = fusionner(catalogue, nouveaux)
    print(f"{len(nouveaux)} véhicules sur la page Wix : {len(ajoutes)} ajoutés, {len(completes)} complétés, "
          f"{len(nouveaux) - len(ajoutes) - len(completes)} déjà à jour.")
    for reference, champs in completes:
        print(f"  {reference} complété : {', '.join(champs)}")
    if not args.essai:
        chemin.write_text(json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
