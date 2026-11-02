"""Crée une version WebP allégée de chaque photo de my-auto-export/photos/ dans my-auto-export/photos/web/.

Les pages véhicules et l'accueil servent cette version quand elle existe (balise <picture>), sinon l'original.
Le ré-encodage passe par le canvas de Chromium (Playwright, déjà utilisé par les tests) : aucune dépendance ni
service payant, et les métadonnées des photos (EXIF, position GPS) ne sont pas recopiées.

Lancement : python3 scripts/optimiser_photos.py   (--force pour tout régénérer)
"""
import argparse
import base64
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

PHOTOS = Path(__file__).resolve().parent.parent / "my-auto-export" / "photos"
COTE_MAX = 1280
QUALITE = 0.8
TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}

REENCODER = """async ({ source, coteMax, qualite }) => {
  const image = await createImageBitmap(await (await fetch(source)).blob(), { imageOrientation: "from-image" });
  const echelle = Math.min(1, coteMax / Math.max(image.width, image.height));
  const canvas = new OffscreenCanvas(Math.round(image.width * echelle), Math.round(image.height * echelle));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: qualite });
  const octets = new Uint8Array(await blob.arrayBuffer());
  let binaire = "";
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return { donnees: btoa(binaire), largeur: canvas.width, hauteur: canvas.height };
}"""


def a_traiter(dossier, force):
    for photo in sorted(dossier.iterdir()):
        if photo.suffix.lower() not in TYPES:
            continue
        cible = dossier / "web" / f"{photo.stem}.webp"
        if force or not cible.exists() or cible.stat().st_mtime < photo.stat().st_mtime:
            yield photo, cible


def main(argv=None):
    parser = argparse.ArgumentParser(description="Crée les versions WebP allégées des photos du site.")
    parser.add_argument("--photos", type=Path, default=PHOTOS)
    parser.add_argument("--force", action="store_true", help="régénère aussi les versions à jour")
    args = parser.parse_args(argv)

    taches = list(a_traiter(args.photos, args.force))
    if not taches:
        print("Toutes les versions WebP sont à jour.")
        return 0
    (args.photos / "web").mkdir(exist_ok=True)
    with sync_playwright() as p:
        navigateur = p.chromium.launch()
        page = navigateur.new_page()
        for photo, cible in taches:
            source = f"data:{TYPES[photo.suffix.lower()]};base64,{base64.b64encode(photo.read_bytes()).decode()}"
            resultat = page.evaluate(REENCODER, {"source": source, "coteMax": COTE_MAX, "qualite": QUALITE})
            cible.write_bytes(base64.b64decode(resultat["donnees"]))
            print(f"{photo.name} : {photo.stat().st_size // 1024} Ko → {cible.name} "
                  f"{resultat['largeur']}×{resultat['hauteur']}, {cible.stat().st_size // 1024} Ko")
        navigateur.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
