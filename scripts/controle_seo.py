"""Contrôle SEO d'un site déployé ou local, à partir de son sitemap.

Pour chaque adresse du sitemap : réponse 200 sans redirection, balise canonical identique à l'adresse, pas de noindex,
titre et description présents et uniques, balise viewport, un seul h1, attribut alt sur chaque image, données
structurées JSON-LD lisibles. Code de sortie 1 en cas d'erreur.

Lancement : python3 scripts/controle_seo.py                          (production, lecture seule)
            python3 scripts/controle_seo.py --base http://localhost:8787   (wrangler dev)
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

DOMAINE = "https://www.myautoexport.com"
NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


class SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OUVREUR = urllib.request.build_opener(SansRedirection)


class Analyse(HTMLParser):
    def __init__(self):
        super().__init__()
        self.titre, self.description, self.canonical, self.robots, self.viewport = None, None, None, "", False
        self.h1, self.images_sans_alt, self.json_ld = 0, 0, []
        self._dans = None
        self._texte = []

    def handle_starttag(self, balise, attributs):
        a = dict(attributs)
        if balise == "title":
            self._dans, self._texte = "title", []
        elif balise == "script" and a.get("type") == "application/ld+json":
            self._dans, self._texte = "ld", []
        elif balise == "meta" and a.get("name") == "description":
            self.description = a.get("content")
        elif balise == "meta" and a.get("name") == "robots":
            self.robots = a.get("content", "")
        elif balise == "meta" and a.get("name") == "viewport":
            self.viewport = True
        elif balise == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        elif balise == "h1":
            self.h1 += 1
        elif balise == "img" and "alt" not in a:
            self.images_sans_alt += 1

    def handle_data(self, data):
        if self._dans:
            self._texte.append(data)

    def handle_endtag(self, balise):
        if self._dans == "title" and balise == "title":
            self.titre = "".join(self._texte).strip()
        elif self._dans == "ld" and balise == "script":
            self.json_ld.append("".join(self._texte))
        if balise in ("title", "script"):
            self._dans = None


def lire(url):
    requete = urllib.request.Request(url, headers={"User-Agent": "controle-seo-myautoexport/1.0", "Accept": "text/html,application/xml"})
    try:
        with OUVREUR.open(requete, timeout=20) as reponse:
            return reponse.status, reponse.headers, reponse.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as erreur:
        with erreur:
            return erreur.code, erreur.headers, ""


def controler(base):
    erreurs = []
    statut, _, xml = lire(f"{base}/sitemap.xml")
    if statut != 200:
        return {"pages": 0, "erreurs": [f"sitemap.xml : HTTP {statut}"]}
    adresses = [loc.text.strip() for loc in ET.fromstring(xml).iter(f"{NS}loc")]
    if len(adresses) != len(set(adresses)):
        erreurs.append("sitemap.xml : adresses en double")
    titres, descriptions = {}, {}
    for adresse in adresses:
        if not adresse.startswith(DOMAINE + "/"):
            erreurs.append(f"{adresse} : hors du domaine canonique")
            continue
        statut, entetes, html = lire(base + adresse.removeprefix(DOMAINE))
        if statut != 200:
            erreurs.append(f"{adresse} : HTTP {statut}{' vers ' + entetes.get('Location', '') if 300 <= statut < 400 else ''}")
            continue
        page = Analyse()
        page.feed(html)
        if page.canonical != adresse:
            erreurs.append(f"{adresse} : canonical {page.canonical!r}")
        if "noindex" in page.robots or "noindex" in (entetes.get("X-Robots-Tag") or ""):
            erreurs.append(f"{adresse} : noindex dans une page du sitemap")
        if not page.titre:
            erreurs.append(f"{adresse} : titre manquant")
        elif page.titre in titres:
            erreurs.append(f"{adresse} : même titre que {titres[page.titre]}")
        titres.setdefault(page.titre, adresse)
        if not page.description:
            erreurs.append(f"{adresse} : description manquante")
        elif page.description in descriptions:
            erreurs.append(f"{adresse} : même description que {descriptions[page.description]}")
        descriptions.setdefault(page.description, adresse)
        if not page.viewport:
            erreurs.append(f"{adresse} : balise viewport manquante (affichage mobile)")
        if page.h1 != 1:
            erreurs.append(f"{adresse} : {page.h1} titres h1")
        if page.images_sans_alt:
            erreurs.append(f"{adresse} : {page.images_sans_alt} image(s) sans attribut alt")
        for bloc in page.json_ld:
            try:
                json.loads(bloc)
            except json.JSONDecodeError as erreur:
                erreurs.append(f"{adresse} : JSON-LD illisible ({erreur})")
    return {"pages": len(adresses), "erreurs": erreurs}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Contrôle SEO des pages listées dans le sitemap.")
    parser.add_argument("--base", default=DOMAINE, help="adresse du site à contrôler (défaut : production)")
    args = parser.parse_args(argv)
    resultat = controler(args.base.rstrip("/"))
    print(json.dumps(resultat, ensure_ascii=False, indent=2))
    return 1 if resultat["erreurs"] else 0


if __name__ == "__main__":
    sys.exit(main())
