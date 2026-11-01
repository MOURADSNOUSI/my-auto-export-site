// Référencement : pages véhicules rendues par le Worker, sitemap dynamique, liste indexable de l'accueil,
// page 404 et contrôle SEO (après chaque publication et chaque jour à 07:00, heure de Paris).
// Les pages sont calculées à chaque requête depuis le catalogue (lots.json + administration) : ajouter, modifier
// ou retirer un véhicule met à jour sa page, l'accueil et le sitemap sans étape de génération.
import { catalogueComplet, etatEnchere, resumesEncheres } from "./index.js";

export const SITE = "https://www.myautoexport.com";
// Pages statiques indexables. Ajouter ici une page informative une fois son contenu validé (et sa balise noindex retirée).
export const PAGES_STATIQUES = ["/", "/vehicules", "/conditions"];
const PREFIXE = "/vehicules/";
const MAX_VERIFICATIONS_LIENS = 40; // sous la limite de 50 sous-requêtes par exécution du plan gratuit
const JOURNAL_CONSERVE = 90;

const STATUTS = { open: "Enchère en cours", upcoming: "Enchère à venir", stock: "En stock" };
const NOTE_PRIX = "Prix indicatif export : ne sont pas compris les droits et taxes de douane (dont l'éventuel régime FCR), le transport, le dédouanement, l'homologation et l'immatriculation en Tunisie.";

// --- Adresses ---

export function slug(texte) {
  return String(texte ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// /vehicules/porsche-cayenne-2024-7750872 : la référence, en fin d'adresse, rend l'adresse unique et permanente.
export function cheminVehicule(lot) {
  const debut = slug([lot.make, lot.model, lot.year].filter(Boolean).join(" "));
  return `${PREFIXE}${debut ? `${debut}-` : ""}${slug(lot.reference)}`;
}

function absolue(url) {
  if (/^https:\/\//.test(url)) return url;
  return `${SITE}/${String(url).replace(/^\/+/, "")}`;
}

// --- Contenu ---

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
}

const nombreFr = (n) => new Intl.NumberFormat("fr-TN").format(n);
const tnd = (n) => `${new Intl.NumberFormat("fr-TN", { maximumFractionDigits: 2 }).format(n)} TND`;

function photoAffichable(url) {
  return typeof url === "string" && (url.startsWith("https://") || /^photos\/[^/]+$/.test(url) || /^\/media\/vehicules\/[A-Za-z0-9._-]+\/[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(url));
}

// Mêmes règles que la page d'accueil (photosLot) : seules les photos autorisées sont publiées.
export function photosLot(lot) {
  return (lot.photos || []).filter((photo) => photo?.authorized === true && photoAffichable(photo.url)).map((photo) => photo.url);
}

function titreLot(lot) {
  return `${lot.make} ${lot.model} ${lot.trim || ""}`.trim();
}

function spec(lot, nom) {
  return (Array.isArray(lot.specs) ? lot.specs : []).find((s) => Array.isArray(s) && s[0] === nom)?.[1];
}

export function statutLot(lot) {
  if (lot.status === "open" && lot.auction?.status === "ended") return "Vente terminée";
  return STATUTS[lot.status] || "";
}

// Une annonce est indexable tant qu'elle est en ligne et que sa vente n'est pas terminée.
export function indexable(item) {
  return !item.removed && !(item.lot.status === "open" && item.lot.auction?.status !== "live");
}

export function prixAffiche(lot) {
  const a = lot.auction;
  if (a?.currentBidTnd != null) return { label: a.status === "ended" ? "Dernière enchère" : "Enchère actuelle", value: tnd(a.currentBidTnd) };
  if (Number.isFinite(lot.startingPriceTnd)) return { label: "Mise à prix", value: tnd(lot.startingPriceTnd) };
  if (Number.isFinite(lot.indicativePriceTnd)) return { label: "Prix indicatif export", value: tnd(lot.indicativePriceTnd) };
  if (Number.isFinite(lot.buyNowPriceTnd)) return { label: "Achat immédiat", value: tnd(lot.buyNowPriceTnd) };
  return { label: "Tarif", value: "Prix sur demande" };
}

export function titrePage(lot) {
  const km = Number.isFinite(lot.mileageKm) ? ` · ${nombreFr(lot.mileageKm)} km` : "";
  return `${titreLot(lot)}${lot.year ? ` ${lot.year}` : ""}${km} · Réf. ${lot.reference} | M&Y AUTO EXPORT`;
}

// Description construite uniquement à partir des champs renseignés de l'annonce.
export function descriptionPage(lot) {
  const morceaux = [`${titreLot(lot)}${lot.year ? ` (${lot.year})` : ""}`];
  if (Number.isFinite(lot.mileageKm)) morceaux.push(`${nombreFr(lot.mileageKm)} km`);
  if (lot.fuel) morceaux.push(lot.fuel);
  if (lot.country) morceaux.push(`provenance ${lot.country}`);
  const prix = prixAffiche(lot);
  return `${morceaux.join(", ")}. ${statutLot(lot)} chez M&Y AUTO EXPORT, livraison en Tunisie. ${prix.label} : ${prix.value}. Réf. ${lot.reference}.`;
}

function caracteristiques(lot) {
  const lignes = [
    ["Marque", lot.make], ["Modèle", lot.model], ["Version", lot.trim], ["Année", lot.year],
    ["Kilométrage", Number.isFinite(lot.mileageKm) ? `${nombreFr(lot.mileageKm)} km` : null],
    ["Énergie", lot.fuel], ["Catégorie", lot.bodyType], ["Provenance", lot.country],
    ["Lieu d'enlèvement", lot.pickupLocation], ["Disponible à partir du", lot.availableFrom],
    ...(Array.isArray(lot.specs) ? lot.specs : [])
  ];
  return lignes.filter((l) => Array.isArray(l) && l[0] && l[1] != null && l[1] !== "");
}

// Schema.org : Car (sous-type de Vehicle). Product + Offer seulement pour un véhicule en stock avec un prix affiché :
// une enchère n'a pas de prix de vente connu d'avance.
export function donneesStructurees(lot, url) {
  const photos = photosLot(lot).map(absolue);
  const prix = lot.status === "stock" ? (lot.buyNowPriceTnd ?? lot.indicativePriceTnd) : null;
  const vehicule = {
    "@context": "https://schema.org",
    "@type": Number.isFinite(prix) ? ["Product", "Car"] : "Car",
    "@id": `${url}#vehicule`,
    name: titreLot(lot),
    description: descriptionPage(lot),
    url,
    sku: lot.reference,
    brand: { "@type": "Brand", name: lot.make },
    model: lot.model,
    itemCondition: "https://schema.org/UsedCondition"
  };
  if (lot.trim) vehicule.vehicleConfiguration = lot.trim;
  if (lot.year) vehicule.vehicleModelDate = String(lot.year);
  const mise = spec(lot, "Mise en circulation");
  if (mise && /^\d{2}\/\d{4}$/.test(mise)) vehicule.dateVehicleFirstRegistered = `${mise.slice(3)}-${mise.slice(0, 2)}`;
  if (Number.isFinite(lot.mileageKm)) vehicule.mileageFromOdometer = { "@type": "QuantitativeValue", value: lot.mileageKm, unitCode: "KMT" };
  if (lot.fuel) vehicule.fuelType = lot.fuel;
  if (lot.bodyType) vehicule.bodyType = lot.bodyType;
  if (spec(lot, "Transmission")) vehicule.vehicleTransmission = spec(lot, "Transmission");
  if (photos.length) vehicule.image = photos;
  if (Number.isFinite(prix)) {
    vehicule.offers = {
      "@type": "Offer",
      url,
      price: prix,
      priceCurrency: "TND",
      availability: "https://schema.org/InStock",
      description: Number.isFinite(lot.buyNowPriceTnd) ? "Prix d'achat immédiat." : NOTE_PRIX,
      seller: { "@type": "AutoDealer", name: "M&Y AUTO EXPORT", url: `${SITE}/` }
    };
  }
  const filAriane = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Véhicules", item: `${SITE}/vehicules` },
      { "@type": "ListItem", position: 3, name: titreLot(lot), item: url }
    ]
  };
  return [vehicule, filAriane];
}

function jsonLd(donnees) {
  // « < » échappé : le JSON ne peut pas fermer la balise script.
  return `<script type="application/ld+json">${JSON.stringify(donnees).replace(/</g, "\\u003c")}</script>`;
}

// --- Gabarit commun ---

const STYLE = `
:root{--ink:#17201d;--soft:#44514c;--paper:#f3f5f3;--surface:#fff;--line:#d7ddd8;--accent:#0f6b4f}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--paper)}
a{color:var(--accent)}img{max-width:100%;display:block}
.shell{width:min(1100px,100% - 32px);margin:0 auto}
header{background:#101513;color:#fff}header .shell{display:flex;align-items:center;gap:12px;min-height:60px}
header a{color:#fff;text-decoration:none;font-weight:700}header img{width:36px;height:36px}
nav.ariane{font-size:14px;color:var(--soft);margin:16px 0}nav.ariane a{color:var(--soft)}
h1{font-size:clamp(24px,5vw,36px);line-height:1.2;margin:0 0 8px}
.meta{color:var(--soft);margin:0 0 16px}
.fiche{display:grid;gap:24px}@media(min-width:860px){.fiche{grid-template-columns:3fr 2fr}}
.galerie-principale{aspect-ratio:4/3;background:#dfe5e1;border-radius:8px;overflow:hidden}
.galerie-principale img{width:100%;height:100%;object-fit:cover}
.vignettes{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px;margin-top:8px;list-style:none;padding:0}
.vignettes img{aspect-ratio:4/3;width:100%;object-fit:cover;border-radius:4px}
.sans-photo{display:grid;place-items:center;height:100%;color:var(--soft)}
.carte{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px}
.prix small{display:block;color:var(--soft)}.prix strong{font-size:26px}
.note{font-size:14px;color:var(--soft)}
dl{display:grid;grid-template-columns:minmax(120px,auto) 1fr;gap:6px 16px;margin:0}dt{color:var(--soft)}dd{margin:0;overflow-wrap:anywhere}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.bouton{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:6px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
.bouton.secondaire{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.liste{list-style:none;padding:0;display:grid;gap:8px}.liste a{display:block;padding:12px 16px;background:var(--surface);border:1px solid var(--line);border-radius:6px;text-decoration:none;color:var(--ink)}
.liste small{color:var(--soft)}
footer{margin-top:48px;padding:24px 0;border-top:1px solid var(--line);font-size:14px;color:var(--soft)}
`;

function gabarit({ titre, description, canonique, robots, image, contenu, donnees = [] }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(titre)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  ${robots ? `<meta name="robots" content="${robots}">` : ""}
  ${canonique ? `<link rel="canonical" href="${escapeHtml(canonique)}">` : ""}
  <link rel="icon" href="/logo.png" type="image/png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="M&amp;Y AUTO EXPORT">
  <meta property="og:locale" content="fr_TN">
  <meta property="og:title" content="${escapeHtml(titre)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${canonique ? `<meta property="og:url" content="${escapeHtml(canonique)}">` : ""}
  <meta property="og:image" content="${escapeHtml(image || `${SITE}/logo.png`)}">
  <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
  ${donnees.map(jsonLd).join("\n  ")}
  <style>${STYLE}</style>
</head>
<body>
  <header><div class="shell"><a href="/"><img src="/logo.png" alt="Logo M&amp;Y AUTO EXPORT" width="36" height="36"></a><a href="/">M&amp;Y AUTO EXPORT</a></div></header>
  <main class="shell">${contenu}</main>
  <footer><div class="shell"><strong>M&amp;Y AUTO EXPORT</strong> · Véhicules européens livrés en Tunisie · <a href="/vehicules">Tous les véhicules</a> · <a href="/conditions">Conditions générales de vente</a> · <a href="mailto:contact@myautoexport.com">contact@myautoexport.com</a></div></footer>
</body>
</html>`;
}

function reponseHtml(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff", ...headers }
  });
}

export function page404() {
  return reponseHtml(gabarit({
    titre: "Page introuvable | M&Y AUTO EXPORT",
    description: "Cette page n'existe pas ou n'est plus disponible.",
    robots: "noindex",
    contenu: `<h1>Page introuvable</h1><p>Cette page n'existe pas ou n'est plus disponible.</p>
      <p class="actions"><a class="bouton" href="/vehicules">Voir les véhicules disponibles</a><a class="bouton secondaire" href="/">Accueil</a></p>`
  }), 404, { "Cache-Control": "no-store" });
}

// Photo locale (photos/…) : version WebP allégée si scripts/optimiser_photos.py l'a produite.
async function variantesWebp(env, request, photos) {
  const variantes = await Promise.all(photos.map(async (url) => {
    const local = url.match(/^photos\/([^/]+)\.(?:jpe?g|png)$/i);
    if (!local) return null;
    const chemin = `/photos/web/${local[1]}.webp`;
    const reponse = await env.ASSETS.fetch(new Request(new URL(chemin, request.url), { method: "HEAD" })).catch(() => null);
    return reponse?.ok ? chemin : null;
  }));
  return variantes;
}

function image(url, webp, alt, { principale = false } = {}) {
  const src = url.startsWith("photos/") ? `/${url}` : url;
  const attributs = principale ? `fetchpriority="high" decoding="async"` : `loading="lazy" decoding="async"`;
  const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" ${attributs}>`;
  return webp ? `<picture><source srcset="${escapeHtml(webp)}" type="image/webp">${img}</picture>` : img;
}

// --- Routes ---

async function lotsAvecEtat(request, env) {
  const [items, resumes] = await Promise.all([catalogueComplet(request, env), resumesEncheres(env)]);
  const maintenant = Date.now();
  return items.map((item) => {
    const auction = etatEnchere(item.lot, resumes.get(item.lot.reference), maintenant);
    return { ...item, lot: auction ? { ...item.lot, auction } : item.lot };
  });
}

export function estRouteSeo(path) {
  return path === "/sitemap.xml" || path === "/vehicules" || path.startsWith(PREFIXE);
}

export async function routeSeo(request, env, url) {
  if (url.pathname === "/sitemap.xml") return sitemap(request, env);
  if (url.pathname === "/vehicules") return pageListe(request, env);
  if (url.pathname.endsWith("/")) {
    return Response.redirect(`${url.origin}${url.pathname.replace(/\/+$/, "")}`, 301);
  }
  return pageVehicule(request, env, url);
}

async function pageVehicule(request, env, url) {
  const items = await lotsAvecEtat(request, env);
  const demande = url.pathname.toLowerCase();
  let item = items.find((entry) => cheminVehicule(entry.lot) === demande);
  if (!item) {
    // Ancienne adresse (marque, modèle ou année modifiés) : redirection permanente vers l'adresse actuelle.
    // La plus longue référence l'emporte : …-my-0001 désigne MY-0001, pas 0001.
    const ancien = items
      .filter((entry) => demande.endsWith(`-${slug(entry.lot.reference)}`))
      .sort((a, b) => slug(b.lot.reference).length - slug(a.lot.reference).length)[0];
    if (ancien) return Response.redirect(`${url.origin}${cheminVehicule(ancien.lot)}`, 301);
    return page404();
  }
  const lot = item.lot;
  if (item.removed) {
    // Véhicule vendu ou retiré : 410 indique aux moteurs de retirer la page de l'index.
    return reponseHtml(gabarit({
      titre: `${titreLot(lot)} — annonce retirée | M&Y AUTO EXPORT`,
      description: "Ce véhicule n'est plus proposé à la vente.",
      robots: "noindex",
      contenu: `<h1>${escapeHtml(titreLot(lot))}</h1><p>Ce véhicule (réf. ${escapeHtml(lot.reference)}) n'est plus proposé à la vente.</p>
        <p class="actions"><a class="bouton" href="/vehicules">Voir les véhicules disponibles</a></p>`
    }), 410);
  }

  const canonique = `${SITE}${cheminVehicule(lot)}`;
  const photos = photosLot(lot);
  const webp = await variantesWebp(env, request, photos);
  const titre = titreLot(lot);
  const prix = prixAffiche(lot);
  const enVente = indexable(item);
  const sujet = encodeURIComponent(`Véhicule réf. ${lot.reference} — ${titre}`);
  const galerie = photos.length
    ? `<div class="galerie-principale">${image(photos[0], webp[0], `${titre} — photo 1 sur ${photos.length}`, { principale: true })}</div>
       ${photos.length > 1 ? `<ul class="vignettes">${photos.slice(1).map((photo, index) => `<li><a href="${escapeHtml(photo.startsWith("photos/") ? `/${photo}` : photo)}">${image(photo, webp[index + 1], `${titre} — photo ${index + 2} sur ${photos.length}`)}</a></li>`).join("")}</ul>` : ""}`
    : `<div class="galerie-principale"><p class="sans-photo">Photo à confirmer</p></div>`;

  const contenu = `
    <nav class="ariane" aria-label="Fil d'Ariane"><a href="/">Accueil</a> › <a href="/vehicules">Véhicules</a> › ${escapeHtml(titre)}</nav>
    <h1>${escapeHtml(titre)}${lot.year ? ` ${escapeHtml(lot.year)}` : ""}</h1>
    <p class="meta">Réf. ${escapeHtml(lot.reference)} · ${escapeHtml(statutLot(lot))}</p>
    <div class="fiche">
      <section aria-label="Photos">${galerie}</section>
      <div>
        <section class="carte prix" aria-label="Prix">
          <small>${escapeHtml(prix.label)}</small><strong>${escapeHtml(prix.value)}</strong>
          ${lot.auction?.endsAt && lot.auction.status === "live" ? `<p>Fin de la vente : <time datetime="${escapeHtml(lot.auction.endsAt)}">${escapeHtml(new Date(lot.auction.endsAt).toLocaleString("fr-FR", { timeZone: "Africa/Tunis", dateStyle: "long", timeStyle: "short" }))}</time> (heure de Tunis)</p>` : ""}
          <p class="note">${NOTE_PRIX} Ces éléments sont communiqués sur demande avant tout engagement (<a href="/conditions#prix">conditions</a>).</p>
          <div class="actions">
            ${enVente ? `<a class="bouton" href="/?lot=${encodeURIComponent(lot.reference)}">${lot.status === "stock" ? "Demander l'achat" : "Voir l'enchère"}</a>` : ""}
            <a class="bouton secondaire" href="mailto:contact@myautoexport.com?subject=${sujet}">Poser une question</a>
          </div>
        </section>
        <section class="carte" aria-labelledby="titre-caracteristiques" style="margin-top:16px">
          <h2 id="titre-caracteristiques">Caractéristiques</h2>
          <dl>${caracteristiques(lot).map(([libelle, valeur]) => `<div style="display:contents"><dt>${escapeHtml(libelle)}</dt><dd>${escapeHtml(valeur)}</dd></div>`).join("")}</dl>
          <p class="note">Kilométrage relevé au compteur ou communiqué par le fournisseur. Disponibilité et caractéristiques confirmées par l'équipe avant tout engagement.</p>
          ${lot.sourceUrl ? `<p><a href="${escapeHtml(lot.sourceUrl)}" rel="nofollow noopener noreferrer" target="_blank">Fiche fournisseur ↗</a></p>` : ""}
        </section>
      </div>
    </div>`;

  return reponseHtml(gabarit({
    titre: titrePage(lot),
    description: descriptionPage(lot),
    canonique,
    // Vente terminée : la page reste consultable mais sort de l'index et du sitemap.
    robots: enVente ? "" : "noindex",
    image: photos.length ? absolue(photos[0]) : null,
    donnees: donneesStructurees(lot, canonique),
    contenu
  }));
}

function ligneListe(lot) {
  const prix = prixAffiche(lot);
  const details = [lot.year, Number.isFinite(lot.mileageKm) ? `${nombreFr(lot.mileageKm)} km` : null, lot.fuel, statutLot(lot), `${prix.label} : ${prix.value}`].filter(Boolean);
  return `<li><a href="${escapeHtml(cheminVehicule(lot))}"><strong>${escapeHtml(titreLot(lot))}</strong><br><small>${escapeHtml(details.join(" · "))}</small></a></li>`;
}

// Liste HTML des véhicules indexables, insérée dans l'accueil par le Worker : lisible sans JavaScript.
export async function listeIndexable(request, env) {
  const lots = (await lotsAvecEtat(request, env)).filter(indexable).map((item) => item.lot);
  return lots.map(ligneListe).join("");
}

async function pageListe(request, env) {
  const lots = (await lotsAvecEtat(request, env)).filter(indexable).map((item) => item.lot);
  const canonique = `${SITE}/vehicules`;
  const donnees = [{
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Véhicules proposés par M&Y AUTO EXPORT",
    numberOfItems: lots.length,
    itemListElement: lots.map((lot, index) => ({ "@type": "ListItem", position: index + 1, url: `${SITE}${cheminVehicule(lot)}`, name: titreLot(lot) }))
  }];
  return reponseHtml(gabarit({
    titre: "Véhicules européens à vendre, livrés en Tunisie | M&Y AUTO EXPORT",
    description: `${lots.length} véhicule${lots.length > 1 ? "s" : ""} d'occasion sélectionné${lots.length > 1 ? "s" : ""} en Europe : stock, enchères et achat direct, prix affichés en dinars tunisiens.`,
    canonique,
    donnees,
    contenu: `<nav class="ariane" aria-label="Fil d'Ariane"><a href="/">Accueil</a> › Véhicules</nav>
      <h1>Véhicules à vendre</h1>
      <p class="meta">${lots.length} véhicule${lots.length > 1 ? "s" : ""} en ligne. Prix en dinars tunisiens (TND).</p>
      ${lots.length ? `<ul class="liste">${lots.map(ligneListe).join("")}</ul>` : "<p>Aucun véhicule en ligne pour le moment.</p>"}
      <p class="note">${NOTE_PRIX}</p>`
  }));
}

function dateIso(valeur) {
  const t = Date.parse(valeur);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

async function sitemap(request, env) {
  const items = (await lotsAvecEtat(request, env)).filter(indexable);
  const urls = [
    ...PAGES_STATIQUES.map((chemin) => ({ loc: `${SITE}${chemin}` })),
    ...items.map((item) => ({ loc: `${SITE}${cheminVehicule(item.lot)}`, lastmod: dateIso(item.updatedAt || item.lot.createdAt) }))
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

// --- Contrôle SEO et journal ---

// Le Cron Cloudflare est en UTC : deux déclencheurs (05:00 et 06:00 UTC) couvrent l'heure d'été et l'heure d'hiver ;
// seul celui qui tombe à 07:00 à Paris exécute le contrôle.
export function heureParis(date) {
  // formatToParts : format() rend « 07 h » en français.
  const parties = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  return Number(parties.find((partie) => partie.type === "hour").value);
}

// Code HTTP du lien (0 si injoignable).
async function statutLien(env, url) {
  if (url.startsWith("photos/")) return (await env.ASSETS.fetch(new Request(`${SITE}/${url}`, { method: "HEAD" }))).status;
  if (url.startsWith("/media/")) return env.PHOTOS && await env.PHOTOS.head(decodeURIComponent(url.slice("/media/".length))) ? 200 : 404;
  return (await fetch(url, { method: "HEAD", redirect: "follow" })).status;
}

// Vérifie les annonces (toutes, ou celles des références données) et journalise le résultat.
export async function controlerSeo(env, { declencheur, references = null }) {
  const debut = new Date();
  const items = await lotsAvecEtat(new Request(`${SITE}/`), env);
  const erreurs = [];
  const avertissements = [];
  const chemins = new Map();
  for (const item of items.filter((entry) => !entry.removed)) {
    const chemin = cheminVehicule(item.lot);
    if (chemins.has(chemin)) erreurs.push({ reference: item.lot.reference, probleme: `adresse en double avec ${chemins.get(chemin)} : ${chemin}` });
    chemins.set(chemin, item.lot.reference);
  }

  const cibles = items.filter((item) => references ? references.includes(item.lot.reference) : true);
  const liens = [];
  for (const item of cibles) {
    const { lot } = item;
    if (item.removed) continue;
    if (!indexable(item)) {
      avertissements.push({ reference: lot.reference, probleme: "vente terminée : page exclue de l'index et du sitemap" });
      continue;
    }
    const photos = photosLot(lot);
    if (!photos.length) avertissements.push({ reference: lot.reference, probleme: "aucune photo autorisée" });
    if (!lot.year) avertissements.push({ reference: lot.reference, probleme: "année manquante (absente de l'adresse et du titre)" });
    if (!Number.isFinite(lot.mileageKm)) avertissements.push({ reference: lot.reference, probleme: "kilométrage manquant" });
    try {
      JSON.stringify(donneesStructurees(lot, `${SITE}${cheminVehicule(lot)}`));
    } catch (error) {
      erreurs.push({ reference: lot.reference, probleme: `données structurées invalides : ${error.message}` });
    }
    if (photos[0]) liens.push({ reference: lot.reference, url: photos[0], type: "photo principale" });
    if (lot.sourceUrl) liens.push({ reference: lot.reference, url: lot.sourceUrl, type: "fiche fournisseur" });
  }

  const verifies = liens.slice(0, MAX_VERIFICATIONS_LIENS);
  await Promise.all(verifies.map(async (lien) => {
    const statut = await statutLien(env, lien.url).catch(() => 0);
    if (statut >= 200 && statut < 300) return;
    // 401/403/429 : le site distant refuse les visiteurs anonymes ou les robots ; le lien existe peut-être.
    if ([401, 403, 429].includes(statut)) avertissements.push({ reference: lien.reference, probleme: `${lien.type} à accès restreint (HTTP ${statut}) : ${lien.url}` });
    else erreurs.push({ reference: lien.reference, probleme: `${lien.type} inaccessible (HTTP ${statut || "injoignable"}) : ${lien.url}` });
  }));
  if (liens.length > verifies.length) avertissements.push({ probleme: `${liens.length - verifies.length} liens non vérifiés (limite de ${MAX_VERIFICATIONS_LIENS} par contrôle)` });

  const resultat = {
    declencheur,
    debut: debut.toISOString(),
    dureeMs: Date.now() - debut.getTime(),
    vehicules: cibles.length,
    indexables: cibles.filter(indexable).length,
    liensVerifies: verifies.length,
    erreurs,
    avertissements
  };
  console.log(JSON.stringify({ controleSeo: resultat }));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO seo_journal (ran_at, declencheur, ok, resume) VALUES (?, ?, ?, ?)")
      .bind(resultat.debut, declencheur, erreurs.length ? 0 : 1, JSON.stringify(resultat)),
    env.DB.prepare("DELETE FROM seo_journal WHERE id NOT IN (SELECT id FROM seo_journal ORDER BY id DESC LIMIT ?)").bind(JOURNAL_CONSERVE)
  ]);
  return resultat;
}

// Après une publication ou un retrait : le contrôle ne doit jamais faire échouer la modification elle-même.
export function controlerApresPublication(env, ctx, reference) {
  const controle = controlerSeo(env, { declencheur: "publication", references: [reference] }).catch((error) => console.error(error));
  if (ctx?.waitUntil) ctx.waitUntil(controle);
  else return controle;
}

export async function controleQuotidien(controller, env) {
  if (heureParis(new Date(controller.scheduledTime)) !== 7) return null;
  return controlerSeo(env, { declencheur: "quotidien" });
}
