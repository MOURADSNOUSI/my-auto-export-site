import {freeOffersEnabled,legacyAuctionsEnabled,lot1Public,reserveTerms} from './proposal-domain.js';
const money=(v,c)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:c,minimumFractionDigits:c==='TND'?3:2}).format(v/(c==='TND'?1000:100));
import { sellerMedia, verifiedSellerLots } from "./seller.js";
// Référencement : pages véhicules rendues par le Worker, sitemap dynamique, liste indexable de l'accueil,
// page 404 et contrôle SEO (après chaque publication et chaque jour à 07:00, heure de Paris).
// Les pages sont calculées à chaque requête depuis le catalogue (lots.json + administration) : ajouter, modifier
// ou retirer un véhicule met à jour sa page, l'accueil et le sitemap sans étape de génération.
import { catalogueComplet, etatEnchere, resumesEncheres } from "./index.js";
import { calculerPrix, lireParametresPrix } from "./prix.js";
import { REGLAGES_SITE, lireReglagesSite } from "./reglages.js";
import { NOMBRE_QUESTIONS, TEXTES_NAVIGATEUR, fr, t } from "./textes.js";
import { COLONNES_INFORMER, MISE_A_JOUR, PAGES_INFORMER } from "./informer.js";
import { vehiculeMandat } from "./mandats.js";
import { ErreurFiltre, TRIS, chargerFiche, compter, lireCompteurs, lireFiltres as lireFiltresCatalogue, marquerCompteursPerimes, rechercher } from "./catalogue.js";

export const SITE = "https://www.myautoexport.com";
// Pages statiques indexables. Ajouter ici une page informative une fois son contenu validé (et sa balise noindex retirée).
export const PAGES_STATIQUES = ["/", "/vehicules", "/conditions"];
const PREFIXE = "/vehicule/";
// Ancien préfixe des fiches (avant la refonte) : redirigé en 301 vers le nouveau.
const ANCIEN_PREFIXE = "/vehicules/";
const MAX_VERIFICATIONS_LIENS = 40; // sous la limite de 50 sous-requêtes par exécution du plan gratuit
const JOURNAL_CONSERVE = 90;

const STATUTS = { open: "Enchère en cours", upcoming: "Enchère à venir", stock: "En stock" };
const NOTE_PRIX = "Prix indicatif export : ne sont pas compris les droits et taxes de douane (dont l'éventuel régime FCR), le transport, le dédouanement, l'homologation et l'immatriculation en Tunisie.";

// --- Adresses ---

export function slug(texte) {
  return String(texte ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// /vehicule/porsche-cayenne-2024-7750872 : la référence, en fin d'adresse, rend l'adresse unique et permanente.
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
  return typeof url === "string" && (url.startsWith("https://") || /^\/seller-media\/[a-f0-9]{32}$/.test(url) || /^photos\/[^/]+$/.test(url) || /^\/media\/vehicules\/[A-Za-z0-9._-]+\/[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(url));
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
  if(lot.priceMinor!=null&&['TND','EUR'].includes(lot.currency))return {label:"Prix demandé",value:money(lot.priceMinor,lot.currency)};
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
  const immatriculation = /^\d{4}-\d{2}-\d{2}$/.test(lot.premiereImmatriculation || "") ? lot.premiereImmatriculation.split("-").reverse().join("/") : null;
  const lignes = [
    ["Marque", lot.make], ["Modèle", lot.model], ["Version", lot.trim], ["Année", lot.year], ["Première immatriculation", immatriculation],
    ["Kilométrage", Number.isFinite(lot.mileageKm) ? `${nombreFr(lot.mileageKm)} km` : null],
    ["Énergie", lot.fuel], ["Boîte de vitesses", lot.transmission], ["Carrosserie", lot.bodyType],
    ["Puissance", Number.isFinite(lot.powerHp) ? `${lot.powerHp} ch` : null], ["Cylindrée", Number.isFinite(lot.engineCc) ? `${nombreFr(lot.engineCc)} cm³` : null],
    ["Couleur", lot.color], ["Portes", lot.doors], ["Places", lot.seats], ["Pays d'origine", lot.country],
    ["Lieu d'enlèvement", lot.pickupLocation], ["Disponible à partir du", lot.availableFrom],
    ...(Array.isArray(lot.specs) ? lot.specs : [])
  ];
  return lignes.filter((l) => Array.isArray(l) && l[0] && l[1] != null && l[1] !== "");
}

// Schema.org : Car (sous-type de Vehicle). Product + Offer seulement pour un véhicule en stock avec un prix affiché :
// une enchère n'a pas de prix de vente connu d'avance.
export function donneesStructurees(lot, url) {
  const photos = photosLot(lot).map(absolue);
  const prix = lot.priceMinor!=null ? lot.priceMinor/(lot.currency==='TND'?1000:100) : lot.status === "stock" ? (lot.buyNowPriceTnd ?? lot.indicativePriceTnd) : null;
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
  if (lot.transmission || spec(lot, "Transmission")) vehicule.vehicleTransmission = lot.transmission || spec(lot, "Transmission");
  if (/^\d{4}-\d{2}-\d{2}$/.test(lot.premiereImmatriculation || "")) vehicule.dateVehicleFirstRegistered = lot.premiereImmatriculation;
  if (Number.isFinite(lot.engineCc)) vehicule.vehicleEngine = { "@type": "EngineSpecification", engineDisplacement: { "@type": "QuantitativeValue", value: lot.engineCc, unitCode: "CMQ" } };
  if (lot.color) vehicule.color = lot.color;
  if (lot.country) vehicule.countryOfOrigin = { "@type": "Country", name: lot.country };
  if (photos.length) vehicule.image = photos;
  if (Number.isFinite(prix)) {
    vehicule.offers = {
      "@type": "Offer",
      url,
      price: prix,
      priceCurrency: lot.currency || "TND",
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

// --- Vitrine : choix du public, prix estimés, cartes (chantier 3) ---

// Public choisi : cookie « public » (tre ou resident), sinon le réglage public_par_defaut. Aucune donnée personnelle.
export const PUBLICS = ["tre", "resident"];

export function publicDuCookie(request) {
  const morceau = (request.headers.get("Cookie") || "").split(";").map((m) => m.trim()).find((m) => m.startsWith("public="));
  const valeur = morceau?.slice("public=".length);
  return PUBLICS.includes(valeur) ? valeur : null;
}

export function cookiePublic(valeur) {
  return `public=${valeur}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
}

// Choix sans JavaScript : ?public=resident pose le cookie puis redirige (303) vers la même adresse sans le paramètre.
// Une valeur invalide est ignorée (redirection sans cookie).
export function redirectionPublic(url) {
  const valeur = url.searchParams.get("public");
  const cible = new URL(url);
  cible.searchParams.delete("public");
  const headers = { Location: `${cible.pathname}${cible.search}`, "Cache-Control": "no-store" };
  if (PUBLICS.includes(valeur)) headers["Set-Cookie"] = cookiePublic(valeur);
  return new Response(null, { status: 303, headers });
}

// Les pages qui lisent le cookie ne doivent pas être servies d'un cache à un autre public.
export const ENTETES_VITRINE = { "Cache-Control": "private, no-cache", Vary: "Cookie" };

// Réglages et paramètres de prix, lus une seule fois par requête. En cas d'échec : prix masqués, sans WhatsApp.
export async function contexteVitrine(request, env) {
  try {
    const [site, parametres] = await Promise.all([lireReglagesSite(env), lireParametresPrix(env)]);
    return { site, parametres, public: publicDuCookie(request) || site.public_par_defaut };
  } catch {
    console.error("vitrine_reglages_failed");
    const site = Object.fromEntries(Object.entries(REGLAGES_SITE).map(([cle, r]) => [cle, r.defaut]));
    return { site, parametres: null, public: publicDuCookie(request) || site.public_par_defaut };
  }
}

// Calcul à l'affichage, sans stockage. null si le calcul est impossible (prix d'achat, carburant… manquants) :
// l'éligibilité est alors inconnue.
function estimation(lot, ctx) {
  if (!ctx.parametres) return null;
  const r = calculerPrix({
    prixEur: lot.prixEur, transportEur: lot.transportEur, year: lot.year, premiereImmatriculation: lot.premiereImmatriculation,
    engineCc: lot.engineCc, fuel: lot.fuel
  }, ctx.parametres);
  return r.prixTreEur === null ? null : r;
}

const eur = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const montant = (n, devise) => (devise === "EUR" ? eur(n) : tnd(n));

// Date du taux (JJ/MM/AAAA) : date du taux automatique, sinon dernière modification du taux manuel, sinon aujourd'hui.
function dateTaux(r, ctx) {
  const iso = String(r.taux.date || ctx.parametres.lignesParametres?.find((l) => l.cle === "taux_manuel")?.mis_a_jour || ctx.parametres.aujourdhui);
  // Date et heure (UTC) : jour affiché à l'heure de Tunis, sinon la veille s'afficherait après minuit.
  if (iso.length > 10 && Number.isFinite(Date.parse(iso))) return new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Tunis", day: "2-digit", month: "2-digit", year: "numeric" });
  const [a, m, j] = iso.slice(0, 10).split("-");
  return `${j}/${m}/${a}`;
}

function whatsappChiffres(ctx) {
  return String(ctx.site.whatsapp_numero || "").replace(/^\+/, "");
}

function boutonContact(lot, ctx, { email = true } = {}) {
  const message = t("contact_message", { reference: lot.reference });
  if (whatsappChiffres(ctx)) {
    return `<a class="bouton-contact" href="https://wa.me/${whatsappChiffres(ctx)}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">${escapeHtml(t("contact_whatsapp"))}</a>`;
  }
  return email ? `<a class="bouton-contact" href="mailto:contact@myautoexport.com?subject=${encodeURIComponent(message)}">${escapeHtml(t("contact_email"))}</a>` : "";
}

export function boutonWhatsapp(ctx) {
  if (!whatsappChiffres(ctx)) return "";
  return `<a class="bouton-whatsapp" href="https://wa.me/${whatsappChiffres(ctx)}" target="_blank" rel="noopener" aria-label="${escapeHtml(t("whatsapp_aria"))}">${escapeHtml(t("whatsapp"))}</a>`;
}

// Badge résident seulement si prix_resident_actif : aucune règle résident n'est encore vérifiée.
function badgesEligibilite(r, ctx) {
  const badges = [];
  if (r && ctx.site.prix_resident_actif && r.motifNonEligibleResident === null) badges.push(`<li class="badge badge-resident">${escapeHtml(t("badge_resident"))}</li>`);
  if (r && r.motifNonEligibleFcr === null) badges.push(`<li class="badge badge-fcr">${escapeHtml(t("badge_fcr"))}</li>`);
  return badges.length ? `<ul class="badges">${badges.join("")}</ul>` : "";
}

// Montant estimé, mention et détail dépliable (sans JavaScript). prefixes : lignes du détail retenues.
function prixEstime(total, devise, r, ctx, prefixes, extra = "") {
  const lignes = r.detail.filter((l) => prefixes.some((p) => l.libelle.startsWith(p)));
  return `<p class="prix-estime"><small>${escapeHtml(t("prix_estime"))}</small><strong>${escapeHtml(montant(total, devise))}</strong></p>
    <p class="prix-mention">${escapeHtml(t("prix_mention", { date: dateTaux(r, ctx) }))}</p>
    <details class="prix-detail"><summary>${escapeHtml(t("prix_detail"))}</summary><ul>${lignes.map((l) => `<li><span>${escapeHtml(l.libelle)}</span><span>${escapeHtml(montant(l.montant, l.devise))}</span></li>`).join("")}
      <li class="prix-total"><span>${escapeHtml(t("prix_total"))}</span><span>${escapeHtml(montant(total, devise))}</span></li>${extra}</ul></details>`;
}

// Règles d'affichage : aucun prix calculé si prix_publics_actifs est faux ; aucun prix résident si prix_resident_actif
// est faux (régime résident en attente de textes d'application).
function blocPrix(lot, r, ctx, options) {
  const { prix_publics_actifs: publics, prix_resident_actif: resident } = ctx.site;
  if (ctx.public === "resident") {
    if (r && r.motifNonEligibleResident !== null) return `<p class="prix-statut">${escapeHtml(t("prix_reserve_tre"))}</p>`;
    if (r && publics && resident && r.prixResidentTnd !== null) return prixEstime(r.prixResidentTnd, "TND", r, ctx, ["Résident :"]);
    return `<p class="prix-statut">${escapeHtml(t("prix_resident_devis"))}</p><p class="prix-mention">${escapeHtml(t("prix_resident_explication"))}</p>${boutonContact(lot, ctx, options)}`;
  }
  if (r && publics) {
    const fcr = r.dedouanementFcrEstimeTnd === null ? "" : `<li class="prix-total"><span>${escapeHtml(t("prix_fcr"))}</span><span>${escapeHtml(tnd(r.dedouanementFcrEstimeTnd))}</span></li>`;
    return prixEstime(r.prixTreEur, "EUR", r, ctx, ["TRE :", "FCR :"], fcr);
  }
  return `<p class="prix-statut">${escapeHtml(t("prix_sur_demande"))}</p>${boutonContact(lot, ctx, options)}`;
}

// Badges et prix d'un véhicule, pour une carte ou une fiche.
export function estimationVehicule(lot, ctx, options = {}) {
  const r = estimation(lot, ctx);
  return `${badgesEligibilite(r, ctx)}<div class="bloc-prix">${blocPrix(lot, r, ctx, options)}</div>`;
}

function photoCarte(lot) {
  const url = photosLot(lot)[0];
  if (!url) return `<span class="carte-sans-photo"></span>`;
  const src = url.startsWith("photos/") ? `/${url}` : url;
  const webp = url.match(/^photos\/([^/]+)\.(?:jpe?g|png)$/i);
  // Sans provenance : les serveurs d'images d'OpenLane refusent les photos demandées depuis un autre site (403).
  const img = `<img src="${escapeHtml(src)}" alt="" width="400" height="300" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  return webp ? `<picture><source srcset="/photos/web/${escapeHtml(webp[1])}.webp" type="image/webp">${img}</picture>` : img;
}

// Carte rendue par le serveur : visible sans JavaScript.
// Délai de livraison estimé d'un pays d'origine (réglage delais_livraison, saisi dans /admin-import), ou null.
function delaiLivraison(lot, ctx) {
  const delais = ctx?.site?.delais_livraison;
  return lot.country && delais && Object.hasOwn(delais, lot.country) ? delais[lot.country] : null;
}

export function carteVehicule(lot, ctx) {
  const chemin = escapeHtml(cheminVehicule(lot));
  const titre = [titreLot(lot), lot.year].filter(Boolean).join(" ");
  const infos = [Number.isFinite(lot.mileageKm) ? `${nombreFr(lot.mileageKm)} km` : null, lot.fuel, lot.transmission].filter(Boolean);
  const delai = delaiLivraison(lot, ctx);
  const badges = [lot.country ? `<span class="my-badge my-badge--info">${escapeHtml(lot.country)}</span>` : "",
    delai ? `<span class="my-badge my-badge--accent">${escapeHtml(t("carte_delai", { delai }))}</span>` : ""].filter(Boolean);
  return `<li class="carte-vehicule"><a class="carte-photo" href="${chemin}" tabindex="-1" aria-hidden="true">${photoCarte(lot)}</a>
    <div class="carte-corps"><h3 class="carte-titre"><a href="${chemin}">${escapeHtml(titre)}</a></h3>
    ${infos.length ? `<p class="carte-infos">${escapeHtml(infos.join(" · "))}</p>` : ""}
    ${badges.length ? `<p class="carte-badges">${badges.join("")}</p>` : ""}
    ${estimationVehicule(lot, ctx)}
    <a class="carte-fiche" href="${chemin}">${escapeHtml(t("voir_fiche"))}<span class="visually-hidden"> : ${escapeHtml(titreLot(lot))}</span></a></div></li>`;
}

// Styles des cartes, badges et prix, partagés par l'accueil et les pages /vehicules.
// Propriétés logiques (inline/block) pour préparer l'arabe.
const CSS_WHATSAPP = `.bouton-whatsapp{display:inline-flex;align-items:center;min-block-size:40px;padding-inline:12px;border-radius:20px;background:#166b3e;color:#fff;font-size:14px;font-weight:700;text-decoration:none;white-space:nowrap}
`;

export const CSS_VITRINE = `
.visually-hidden{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.cartes-vehicules{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr));gap:14px;margin:0;padding:0;list-style:none}
.carte-vehicule{display:flex;flex-direction:column;min-inline-size:0;overflow:hidden;border:1px solid #d7ddd8;border-radius:8px;background:#fff;color:#17201d}
.carte-photo{display:block;aspect-ratio:4/3;background:#dfe5e1}
.carte-photo img,.carte-photo picture{display:block;inline-size:100%;block-size:100%;object-fit:cover}
.carte-sans-photo{display:block;block-size:100%}
.carte-corps{display:flex;flex:1;flex-direction:column;gap:8px;padding:12px 14px 14px}
.carte-titre{margin:0;font-size:17px;line-height:1.3}.carte-titre a{color:inherit;text-decoration:none}.carte-titre a:hover{text-decoration:underline}
.carte-infos{margin:0;color:#4f5b55;font-size:14px}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.badge{padding-block:2px;padding-inline:8px;border-radius:12px;font-size:12px;font-weight:700}
.badge-resident{background:#e4f0e9;color:#185740}.badge-fcr{background:#f4ead5;color:#5c4a24}
.bloc-prix{display:grid;gap:6px}
.prix-statut{margin:0;font-weight:700}
.prix-estime{margin:0}.prix-estime small{display:block;color:#4f5b55;font-size:12px}.prix-estime strong{font-size:21px}
.prix-mention{margin:0;color:#4f5b55;font-size:13px}
.prix-detail summary{cursor:pointer;color:#185740;font-weight:700;font-size:14px}
.prix-detail ul{margin:6px 0 0;padding:0;list-style:none;font-size:13px}
.prix-detail li{display:flex;justify-content:space-between;gap:12px;padding-block:3px;border-block-end:1px solid #edf0ee}
.prix-detail li span:last-child{white-space:nowrap}.prix-total{font-weight:700}
.bouton-contact{display:inline-flex;align-items:center;justify-content:center;min-block-size:44px;padding-inline:16px;border-radius:var(--my-rayon-pilule, 6px);background:var(--my-nuit, #185740);color:#fff;font-weight:700;text-decoration:none;justify-self:start}
.carte-fiche{margin-block-start:auto;color:#185740;font-weight:700}
${CSS_WHATSAPP}.etapes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px;margin:0;padding:0;list-style:none}
.etapes li,.lignes-prix,.temoignages li,.faq{padding:14px 16px;border:1px solid #d7ddd8;border-radius:8px;background:#fff}
.etapes h3{margin:0 0 6px;font-size:16px}.etapes p{margin:0}
.lignes-prix{margin:0;padding-inline-start:34px}
.temoignages{display:grid;gap:12px;margin:0;padding:0;list-style:none}.temoignages blockquote{margin:0}
.faq{margin-block-end:8px}.faq summary{cursor:pointer;font-weight:700}.faq p{margin-block:8px 0}
`;

function sectionsAccueil(ctx) {
  const titre = (id, cle) => `<div class="section-title"><h2 id="${id}">${escapeHtml(t(cle))}</h2></div>`;
  const temoignages = Array.isArray(ctx.site.temoignages) ? ctx.site.temoignages : [];
  return {
    comment: `${titre("comment-titre", "comment_titre")}<ol class="etapes">${[1, 2, 3].map((i) => `<li><h3>${escapeHtml(t(`etape${i}_titre`))}</h3><p>${escapeHtml(t(`etape${i}_texte`))}</p></li>`).join("")}</ol>`,
    prix: `${titre("prix-titre", "prix_titre")}<p>${escapeHtml(t("prix_intro"))}</p><ul class="lignes-prix">${["achat", "transport", "douane", "frais", "immatriculation", "commission"].map((c) => `<li>${escapeHtml(t(`prix_ligne_${c}`))}</li>`).join("")}</ul><p class="note">${escapeHtml(t("prix_note"))}</p>`,
    temoignages: temoignages.length ? `${titre("temoignages-titre", "temoignages_titre")}<ul class="temoignages">${temoignages.map((x) => `<li><blockquote><p>${escapeHtml(x.texte)}</p></blockquote><p>— ${escapeHtml(x.nom)}${x.vehicule ? `, ${escapeHtml(x.vehicule)}` : ""}</p></li>`).join("")}</ul>` : "",
    questions: `${titre("questions-titre", "questions_titre")}${Array.from({ length: NOMBRE_QUESTIONS }, (_, i) => `<details class="faq"><summary>${escapeHtml(t(`faq${i + 1}_question`))}</summary><p>${escapeHtml(t(`faq${i + 1}_reponse`))}</p></details>`).join("")}`
  };
}

// Sous-titre de l'accueil : « Plus de N voitures… », N arrondi vers le bas à la dizaine, la centaine ou au millier et
// toujours inférieur au nombre d'annonces en ligne (« plus de » reste vrai). Même total que /vehicules sans filtre, dans un
// cache séparé de 10 minutes. null sous 10 annonces ou si le comptage échoue : texte sans nombre.
export function nombreAnnoncesAccueil(n) {
  if (!Number.isFinite(n) || n < 11) return null;
  const pas = n <= 100 ? 10 : n <= 1000 ? 100 : 1000;
  return Math.floor((n - 1) / pas) * pas;
}

async function sousTitreAccueil(env) {
  let n = null;
  try {
    n = nombreAnnoncesAccueil(await compter(env, { tri: "recent" }, null, new Date(), "compte-accueil"));
  } catch {
    console.error("accueil_compte_failed");
  }
  return n === null ? t("hero_sous_titre_peu") : t("hero_sous_titre", { n: new Intl.NumberFormat("fr-FR").format(n) });
}

// Accueil : textes (data-texte), choix du public, WhatsApp et sections insérés dans index.html. Les cartes des véhicules
// lisibles sans JavaScript sont sur /vehicules, lié depuis le menu.
export async function vitrineAccueil(request, env, reponse) {
  const [ctx, sousTitre] = await Promise.all([contexteVitrine(request, env), sousTitreAccueil(env)]);
  const sections = sectionsAccueil(ctx);
  const textesNavigateur = JSON.stringify(Object.fromEntries(TEXTES_NAVIGATEUR.map((cle) => [cle, t(cle)]))).replace(/</g, "\\u003c");
  const remplir = (html) => ({ element: (element) => element.setInnerContent(html, { html: true }) });
  let rewriter = new HTMLRewriter()
    .on("[data-texte]", { element: (element) => {
      const cle = element.getAttribute("data-texte");
      if (cle === "hero_sous_titre") element.setInnerContent(sousTitre);
      else if (Object.hasOwn(fr, cle)) element.setInnerContent(t(cle));
    } })
    // Libellés d'accessibilité et infobulles (data-texte-aria, data-texte-title).
    .on("[data-texte-aria]", { element: (element) => {
      const cle = element.getAttribute("data-texte-aria");
      if (Object.hasOwn(fr, cle)) element.setAttribute("aria-label", t(cle));
    } })
    .on("[data-texte-title]", { element: (element) => {
      const cle = element.getAttribute("data-texte-title");
      if (Object.hasOwn(fr, cle)) element.setAttribute("title", t(cle));
    } })
    .on("head", { element: (element) => element.append(`<style>${CSS_VITRINE}</style><script type="application/json" id="textes">${textesNavigateur}</script>`, { html: true }) })
    .on(".header-tools", { element: (element) => element.prepend(boutonWhatsapp(ctx), { html: true }) })
    .on("#main-nav", { element: (element) => element.prepend(menuInformer(), { html: true }) })
    .on("#comment-ca-marche", remplir(sections.comment))
    .on("#nos-prix", remplir(sections.prix))
    .on("#questions", remplir(sections.questions));
  if (sections.temoignages) {
    rewriter = rewriter.on("#temoignages", { element: (element) => {
      element.removeAttribute("hidden");
      element.setInnerContent(sections.temoignages, { html: true });
    } });
  }
  const entetes = new Headers(reponse.headers);
  entetes.delete("ETag");
  for (const [cle, valeur] of Object.entries(ENTETES_VITRINE)) entetes.set(cle, valeur);
  return rewriter.transform(new Response(reponse.body, { status: reponse.status, headers: entetes }));
}

// --- Gabarit commun ---

// Règles de l'en-tête commun (pages du Worker et /vendre). Menu replié sous 1366 px, comme sur l'accueil
// (my-auto-export/index.html) : l'en-tête garde la même forme d'une page à l'autre.
export const CSS_ENTETE = `.my-entete{font-family:var(--my-police)}
.my-entete .my-nav > a{white-space:nowrap}
@media(max-width:1365px){.my-entete .my-nav{display:none}.my-entete .my-burger{display:inline-flex}}
@media(max-width:420px){.compte-entete{padding-inline:var(--my-esp-3)}}
`;

const STYLE = `
:root{--ink:#17201d;--soft:#44514c;--paper:#f3f5f3;--surface:#fff;--line:#d7ddd8;--accent:#0f6b4f}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.55 var(--my-police);color:var(--ink);background:var(--paper)}
a{color:var(--accent)}img{max-width:100%;display:block}
.shell{width:min(1100px,100% - 32px);margin:0 auto}
${CSS_ENTETE}nav.ariane{font-size:14px;color:var(--soft);margin:16px 0}nav.ariane a{color:var(--soft)}
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

// Menu « S'informer » : bouton et panneau à trois colonnes, en premier dans le menu de chaque page (accueil compris,
// inséré dans #main-nav). Ouverture et fermeture par /menu-informer.js, styles dans /design/menu-informer.css. suffixe :
// identifiants distincts quand le menu figure deux fois dans la page (menu de bureau et menu mobile).
export function menuInformer(suffixe = "") {
  const id = `info-panel${suffixe}`;
  const colonnes = COLONNES_INFORMER.map(({ titre, pages }, i) => `<div class="info-colonne"><p class="info-titre" id="${id}-titre-${i + 1}">${escapeHtml(titre)}</p>`
    + `<ul aria-labelledby="${id}-titre-${i + 1}">${pages.map((chemin) => `<li><a href="${chemin}">${escapeHtml(PAGES_INFORMER[chemin].menu)}</a></li>`).join("")}</ul></div>`).join("");
  return `<div class="menu-informer"><button class="menu-informer-bouton" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="${id}">`
    + `${escapeHtml(t("menu_informer"))}<svg aria-hidden="true"><use href="#i-chevron"/></svg></button><div class="info-panel" id="${id}">${colonnes}</div></div>`;
}

// Icône du chevron pour les pages sans le jeu d'icônes de l'accueil (même tracé que #i-chevron de index.html).
const SPRITE_ENTETE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="i-chevron" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol></svg>';
export const RESSOURCES_MENU_INFORMER = '<link rel="stylesheet" href="/design/menu-informer.css"><script src="/menu-informer.js" defer></script>';

// En-tête commun des pages rendues par le Worker (design system, design/composants.css) : menu par façon d'acheter,
// « S'informer », compte, WhatsApp si un numéro est saisi (ctx absent : page d'erreur). Menu mobile en <details> :
// il s'ouvre sans JavaScript.
export function entete(ctx, chemin) {
  const liens = [["/vehicules", "menu_vehicules"], ["/#comment-ca-marche", "menu_mandat"], ["/vendre", "menu_vendre"], ["/#contact", "menu_contact"]]
    .map(([href, cle]) => `<a href="${href}"${href === chemin ? ' aria-current="page"' : ""}>${escapeHtml(t(cle))}</a>`).join("");
  return `${SPRITE_ENTETE}<header class="my-entete my-sur-nuit"><div class="my-conteneur my-entete-interieur">
    <a class="my-marque" href="/"><img src="/logo.png" alt="" width="40" height="40"><span>M&amp;Y AUTO EXPORT<small>Véhicules sans frontières</small></span></a>
    <nav class="my-nav" aria-label="Navigation principale">${menuInformer()}${liens}</nav>
    <div class="my-entete-actions">${ctx ? boutonWhatsapp(ctx) : ""}<a class="my-bouton my-bouton--action my-bouton--petit compte-entete" href="/?espace=acheteur">${escapeHtml(t("compte_titre"))}</a>
      <details class="my-burger menu-mobile"><summary class="my-bouton my-bouton--contour my-bouton--petit" aria-label="${escapeHtml(t("menu_ouvrir"))}">☰</summary>
        <nav class="menu-mobile-panneau" aria-label="Navigation principale (mobile)">${menuInformer("-mobile")}${liens}</nav></details></div></div></header>`;
}

// Espace vendeur (/vendre, my-auto-export/vendre.html, et /mes-vehicules qui le sert) : en-tête commun inséré avant
// l'ancien bandeau, gardé comme barre de l'espace vendeur (déconnexion pilotée par vendeur.js).
export async function enteteEspaceVendeur(request, env, reponse) {
  const ctx = await contexteVitrine(request, env);
  return new HTMLRewriter()
    .on("head", { element: (element) => element.append(`<link rel="preload" href="/polices/noto-sans-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/design/tokens.css"><link rel="stylesheet" href="/design/composants.css">${RESSOURCES_MENU_INFORMER}<style>${CSS_ENTETE}${CSS_WHATSAPP}</style>`, { html: true }) })
    .on("body > header", { element: (element) => element.before(entete(ctx, "/vendre"), { html: true }) })
    .transform(reponse);
}

function gabarit({ titre, description, canonique, robots, image, contenu, scripts = '', donnees = [], ctx = null, typeOg = "website" }) {
  const chemin = canonique ? new URL(canonique).pathname : "/";
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
  <meta property="og:type" content="${typeOg}">
  <meta property="og:site_name" content="M&amp;Y AUTO EXPORT">
  <meta property="og:locale" content="fr_TN">
  <meta property="og:title" content="${escapeHtml(titre)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${canonique ? `<meta property="og:url" content="${escapeHtml(canonique)}">` : ""}
  <meta property="og:image" content="${escapeHtml(image || `${SITE}/logo.png`)}">
  <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
  ${donnees.map(jsonLd).join("\n  ")}
  <style>${STYLE}${CSS_VITRINE}</style>
  <link rel="preload" href="/polices/noto-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/design/tokens.css">
  <link rel="stylesheet" href="/design/composants.css">
  <link rel="stylesheet" href="/proposal-dialog.css">
  ${RESSOURCES_MENU_INFORMER}
</head>
<body>
  ${entete(ctx, chemin)}
  <main class="shell">${contenu}</main>
  <footer><div class="shell"><strong>M&amp;Y AUTO EXPORT</strong> · Véhicules européens livrés en Tunisie · <a href="/vehicules">Tous les véhicules</a> · <a href="/conditions">Conditions générales de vente</a> · <a href="mailto:contact@myautoexport.com">contact@myautoexport.com</a></div></footer>
${scripts}
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
  const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" ${attributs} referrerpolicy="no-referrer">`;
  return webp ? `<picture><source srcset="${escapeHtml(webp)}" type="image/webp">${img}</picture>` : img;
}

// --- Routes ---

async function lotsAvecEtat(request, env) {
  const [items, resumes] = await Promise.all([catalogueComplet(request, env), legacyAuctionsEnabled(env)?resumesEncheres(env):Promise.resolve(new Map())]);
  if(!legacyAuctionsEnabled(env))return items.map(item=>({...item,removed:item.removed||(!item.offerOwnerAssigned&&item.lot.status==='open'&&!!item.lot.endsAt&&Date.parse(item.lot.endsAt)<=Date.now()),lot:lot1Public(item.lot)}));
  const maintenant = Date.now();
  return items.map((item) => {
    const auction = etatEnchere(item.lot, resumes.get(item.lot.reference), maintenant);
    return { ...item, lot: auction ? { ...item.lot, auction } : item.lot };
  });
}

export function estRouteSeo(path) {
  return Object.hasOwn(PAGES_INFORMER, path) || path === "/sitemap.xml" || path === "/vehicules" || path === PREFIXE.slice(0, -1) || path.startsWith(PREFIXE) || path.startsWith(ANCIEN_PREFIXE);
}

export async function routeSeo(request, env, url) {
  if (url.pathname === "/sitemap.xml") return sitemap(request, env);
  if (url.searchParams.has("public")) return redirectionPublic(url);
  if (url.pathname === "/vehicules") return pageListe(request, env, url);
  if (Object.hasOwn(PAGES_INFORMER, url.pathname)) return pageInformer(request, env, url.pathname);
  if (url.pathname === PREFIXE || url.pathname === PREFIXE.slice(0, -1)) return Response.redirect(`${url.origin}/vehicules`, 301);
  if (url.pathname.startsWith(ANCIEN_PREFIXE)) return Response.redirect(`${url.origin}${PREFIXE}${url.pathname.slice(ANCIEN_PREFIXE.length)}${url.search}`, 301);
  if (url.pathname.endsWith("/")) {
    return Response.redirect(`${url.origin}${url.pathname.replace(/\/+$/, "")}`, 301);
  }
  return pageVehicule(request, env, url);
}

function diagnosticVendeur(lot) {
  if (!lot.diagnosticVerified || !lot.diagnostic) return "";
  const d = lot.diagnostic;
  const zones = {bumpers:"Pare-chocs",hood:"Capot",doors:"Portières",fenders:"Ailes",roof:"Toit",trunk:"Coffre",wheels:"Jantes",glass:"Vitrages"};
  return `<section class="carte" style="margin-top:16px"><h2>Diagnostic vérifié par M&amp;Y AUTO EXPORT</h2><p><strong>${escapeHtml(d.garage)}</strong> · ${escapeHtml(d.date)}</p><p>${escapeHtml(d.summary)}</p><p class="note">${escapeHtml(d.notice)}</p>${lot.description ? `<h3>Description</h3><p>${escapeHtml(lot.description)}</p>` : ""}<h3>Équipements</h3><ul>${(lot.equipment || []).map(v=>`<li>${escapeHtml(v)}</li>`).join("") || "<li>Aucun équipement renseigné.</li>"}</ul><h3>Dommages déclarés</h3>${(lot.damages || []).map(x=>`<article><strong>${escapeHtml(zones[x.zone] || x.zone)} · ${escapeHtml(x.type)} · ${escapeHtml(x.severity)}</strong><p>${escapeHtml(x.description)}</p>${(x.photos || []).filter(photoAffichable).map(url=>`<img src="${escapeHtml(url)}" alt="Photo du dommage déclaré" loading="lazy" style="width:120px;max-width:100%">`).join("")}</article>`).join("") || "<p>Aucun dommage déclaré.</p>"}</section>`;
}

async function pageVehicule(request, env, url) {
  const demande = url.pathname.toLowerCase();
  let item;
  if (!legacyAuctionsEnabled(env)) {
    // Fiche lue directement dans D1 (index sur la référence) : pas de chargement du catalogue entier.
    const trouve = await chargerFiche(env, demande.slice(PREFIXE.length));
    if (!trouve) return page404();
    if (cheminVehicule(trouve.lot) !== demande) return Response.redirect(`${url.origin}${cheminVehicule(trouve.lot)}`, 301);
    [item] = trouve.lot.reference.startsWith("SV-") ? await verifiedSellerLots(env, [trouve]) : [trouve];
  }
  const items = item ? null : await lotsAvecEtat(request, env);
  item ??= items.find((entry) => cheminVehicule(entry.lot) === demande);
  if (!item) {
    // Ancienne adresse (marque, modèle ou année modifiés) ou référence seule (/vehicules/SV-…, liens des offres) :
    // redirection permanente vers l'adresse actuelle. La plus longue référence l'emporte : …-my-0001 désigne MY-0001, pas 0001.
    const ancien = items
      .filter((entry) => demande.endsWith(`-${slug(entry.lot.reference)}`) || demande === `${PREFIXE}${slug(entry.lot.reference)}`)
      .sort((a, b) => slug(b.lot.reference).length - slug(a.lot.reference).length)[0];
    if (ancien) return Response.redirect(`${url.origin}${cheminVehicule(ancien.lot)}`, 301);
    return page404();
  }
  if(item.sellerUnavailable)return page404();
  const lot = item.lot;
  const ctx = await contexteVitrine(request, env);
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
  const enVente = indexable(item);
  // Offres privées : toutes les annonces en mode « propositions seules », sinon les annonces vendeur et celles dont
  // le vendeur a été affecté (worker/proposals.js). Les enchères et l'achat immédiat restent sur l'accueil (/?lot=…).
  // Achat sur mandat (chantier 4) : véhicules de M&Y en stock ; il remplace alors la proposition d'offre.
  const mandat = enVente && vehiculeMandat(item, ctx.site.mandats_actifs) && (!legacyAuctionsEnabled(env) || lot.status === "stock");
  const proposition = !mandat && enVente && (!legacyAuctionsEnabled(env) || Boolean(lot.marketplace) || Boolean(item.offerOwnerAssigned));
  const terms = reserveTerms(lot);
  const sujet = encodeURIComponent(`Véhicule réf. ${lot.reference} — ${titre}`);
  const galerie = galerieFiche(photos, webp, titre);
  const delai = delaiLivraison(lot, ctx);
  // Un seul bouton d'action : mandat si les demandes sont ouvertes, sinon proposition d'offre (ou enchère, mode historique).
  const action = mandat ? `<button class="my-bouton my-bouton--action my-bouton--large" type="button" data-mandat-ref="${escapeHtml(lot.reference)}">${escapeHtml(t("mandat_bouton"))}</button>`
    : proposition ? `<button class="my-bouton my-bouton--action my-bouton--large" type="button" data-proposal-ref="${escapeHtml(lot.reference)}">Proposer une offre</button>`
    : enVente ? `<a class="my-bouton my-bouton--action my-bouton--large" href="/?lot=${encodeURIComponent(lot.reference)}">${lot.status === "stock" ? "Demander l'achat" : "Voir l'enchère"}</a>` : "";

  const contenu = `
    <nav class="ariane" aria-label="Fil d'Ariane"><a href="/">Accueil</a> › <a href="/vehicules">Véhicules</a> › ${escapeHtml(titre)}</nav>
    <h1>${escapeHtml(titre)}${lot.year ? ` ${escapeHtml(lot.year)}` : ""}</h1>
    <p class="meta">Réf. ${escapeHtml(lot.reference)} · ${escapeHtml(statutLot(lot))}</p>
    <article data-reference="${escapeHtml(lot.reference)}"><div class="fiche">
      <section aria-label="Photos">${galerie}</section>
      <div>
        <section class="carte prix boite-prix" aria-labelledby="titre-prix">
          <h2 id="titre-prix">${escapeHtml(t(ctx.public === "resident" ? "prix_boite_resident" : "prix_boite_tre"))}</h2>
          ${lot.auction?.endsAt && lot.auction.status === "live" ? `<p>Fin de la vente : <time datetime="${escapeHtml(lot.auction.endsAt)}">${escapeHtml(new Date(lot.auction.endsAt).toLocaleString("fr-FR", { timeZone: "Africa/Tunis", dateStyle: "long", timeStyle: "short" }))}</time> (heure de Tunis)</p>` : ""}
          ${badgesEligibilite(estimation(lot, ctx), ctx)}
          <div class="estimation">${boitePrix(lot, ctx)}</div>
          ${delai ? `<p class="my-badge my-badge--accent">${escapeHtml(t("carte_delai", { delai }))}</p>` : ""}
          ${proposition && (terms || !freeOffersEnabled(env)) ? `<p class="proposal-reserve">Prix de réserve : <strong>${terms?escapeHtml(money(terms.reserveMinor,terms.currency)):"À renseigner par le vendeur"}</strong></p>`:""}
          <div class="fiche-action">${action}
            <p class="fiche-secondaire"><a href="mailto:contact@myautoexport.com?subject=${sujet}">Poser une question</a>${whatsappChiffres(ctx) ? ` · <a href="https://wa.me/${whatsappChiffres(ctx)}?text=${encodeURIComponent(t("contact_message", { reference: lot.reference }))}" target="_blank" rel="noopener">${escapeHtml(t("contact_whatsapp"))}</a>` : ""}</p>
          </div>
          <p class="note">${escapeHtml(t("prix_note_fiche"))} <a href="/conditions#prix">${escapeHtml(t("prix_conditions"))}</a></p>
        </section>
        <section class="carte" aria-labelledby="titre-caracteristiques" style="margin-top:16px">
          <h2 id="titre-caracteristiques">Caractéristiques</h2>
          <dl>${caracteristiques(lot).map(([libelle, valeur]) => `<div style="display:contents"><dt>${escapeHtml(libelle)}</dt><dd>${escapeHtml(valeur)}</dd></div>`).join("")}</dl>
          <p class="note">Kilométrage relevé au compteur ou communiqué par le fournisseur. Disponibilité et caractéristiques confirmées par l'équipe avant tout engagement.</p>
          ${lot.sourceUrl ? `<p><a href="${escapeHtml(lot.sourceUrl)}" rel="nofollow noopener noreferrer" target="_blank">Fiche fournisseur ↗</a></p>` : ""}
        </section>
      </div>
    </div>${diagnosticVendeur(lot)}<p id="status" role="status"></p><div id="offer-form"></div><button id="report-listing" disabled>Signaler cette annonce</button></article>`;

  return reponseHtml(gabarit({
    scripts: mandat ? '<script type="module" src="/mandat-dialog.js"></script>' : proposition ? '<script type="module" src="/marketplace-ui.js"></script>' : '',
    titre: titrePage(lot),
    description: descriptionPage(lot),
    canonique,
    // Vente terminée : la page reste consultable mais sort de l'index et du sitemap.
    robots: enVente ? "" : "noindex",
    image: photos.length ? absolue(photos[0]) : null,
    typeOg: "product",
    donnees: donneesStructurees(lot, canonique),
    contenu: `<style>${CSS_FICHE}</style>${contenu}`,
    ctx
  }), 200, ENTETES_VITRINE);
}

// Boîte de prix de la fiche : prix du véhicule en Europe, frais de mandat M&Y, transport vers la Tunisie, dédouanement
// estimé, total. Montants issus de calculerPrix (paramètres de /admin-prix) ; « sur devis » tant que les réglages
// prix_publics_actifs (et prix_resident_actif pour un résident) ne les autorisent pas.
function boitePrix(lot, ctx) {
  const r = estimation(lot, ctx);
  const { prix_publics_actifs: publics, prix_resident_actif: resident } = ctx.site;
  const resid = ctx.public === "resident";
  const surDevis = escapeHtml(t("prix_sur_devis"));
  if (resid && r && r.motifNonEligibleResident !== null) {
    return `<p class="prix-statut">${escapeHtml(t("prix_reserve_tre"))}</p>`;
  }
  const postes = resid ? (publics && resident ? r?.postesResident : null) : (publics ? r?.postesTre : null);
  const devise = resid ? "TND" : "EUR";
  const valeur = (n) => (postes ? escapeHtml(montant(n, devise)) : surDevis);
  const lignes = [["prix_poste_vehicule", postes?.vehicule], ["prix_poste_mandat", postes?.mandat], ["prix_poste_transport", postes?.transport]];
  if (resid) lignes.push(["prix_poste_dedouanement", postes?.dedouanement]);
  const total = postes ? (resid ? r.prixResidentTnd : r.prixTreEur) : null;
  const fcr = !resid && postes && r.dedouanementFcrEstimeTnd !== null ? `<div class="prix-ligne"><dt>${escapeHtml(t("prix_poste_fcr"))}</dt><dd>${escapeHtml(tnd(r.dedouanementFcrEstimeTnd))}</dd></div>` : "";
  const detail = postes ? `<details class="prix-detail"><summary>${escapeHtml(t("prix_detail"))}</summary><ul>${r.detail.filter((l) => l.libelle.startsWith(resid ? "Résident :" : "TRE :") || (!resid && l.libelle.startsWith("FCR :")))
    .map((l) => `<li><span>${escapeHtml(l.libelle)}</span><span>${escapeHtml(montant(l.montant, l.devise))}</span></li>`).join("")}</ul></details>` : "";
  return `<dl class="prix-postes">${lignes.map(([cle, n]) => `<div class="prix-ligne"><dt>${escapeHtml(t(cle))}</dt><dd>${valeur(n)}</dd></div>`).join("")}
      <div class="prix-ligne prix-total-ligne"><dt>${escapeHtml(t(resid ? "prix_total_resident" : "prix_total_tre"))}</dt><dd>${postes ? escapeHtml(montant(total, devise)) : escapeHtml(t(resid ? "prix_resident_devis" : "prix_sur_demande"))}</dd></div>${fcr}</dl>
    ${postes ? `<p class="prix-mention">${escapeHtml(t("prix_mention", { date: dateTaux(r, ctx) }))}</p>` : `<p class="prix-mention">${escapeHtml(t(resid ? "prix_resident_explication" : "prix_masque_explication"))}</p>`}
    ${detail}`;
}

// Galerie : bande défilante (glisser au doigt, défilement par vignettes ancrées), sans JavaScript ; première photo
// prioritaire, les suivantes à la demande.
function galerieFiche(photos, webp, titre) {
  if (!photos.length) return `<div class="galerie-principale"><p class="sans-photo">Photo à confirmer</p></div>`;
  const vues = photos.map((photo, i) => `<li id="photo-${i + 1}">${image(photo, webp[i], `${titre} — photo ${i + 1} sur ${photos.length}`, { principale: i === 0 })}</li>`).join("");
  const vignettes = photos.length > 1 ? `<ol class="galerie-vignettes" aria-label="Choisir une photo">${photos.map((photo, i) => `<li><a href="#photo-${i + 1}" aria-label="Photo ${i + 1}">${image(photo, null, "")}</a></li>`).join("")}</ol>` : "";
  return `<ul class="galerie-bande" aria-label="Photos (${photos.length})">${vues}</ul>${vignettes}`;
}

const CSS_FICHE = `
.fiche>*,.fiche .carte{min-inline-size:0}
.galerie-bande{inline-size:100%;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;gap:0;margin:0;padding:0;list-style:none;border-radius:var(--my-rayon-m);background:#dfe5e1;aspect-ratio:4/3}
.galerie-bande>li{flex:0 0 100%;scroll-snap-align:start}.galerie-bande img{inline-size:100%;block-size:100%;object-fit:cover}
.galerie-vignettes{display:flex;gap:6px;overflow-x:auto;margin:8px 0 0;padding:0;list-style:none}
.galerie-vignettes a{display:block;inline-size:72px;block-size:54px;overflow:hidden;border-radius:4px;border:2px solid transparent}
.galerie-vignettes a:focus-visible,.galerie-vignettes a:hover{border-color:var(--my-nuit)}.galerie-vignettes img{inline-size:100%;block-size:100%;object-fit:cover}
.boite-prix{display:grid;gap:var(--my-esp-3)}.boite-prix h2{margin:0;font-size:var(--my-taille-l);color:var(--my-nuit)}
.boite-prix dl.prix-postes{display:grid;grid-template-columns:minmax(0,1fr);gap:0;margin:0}.prix-ligne{display:flex;justify-content:space-between;gap:var(--my-esp-3);padding-block:var(--my-esp-2);border-block-end:1px solid var(--my-trait)}
.prix-ligne dt{flex:1;min-inline-size:0;color:var(--my-encre-doux)}.prix-ligne dd{margin:0;max-inline-size:55%;font-weight:var(--my-graisse-forte);text-align:end}
.prix-total-ligne{border-block-end:0;font-size:var(--my-taille-l)}.prix-total-ligne dt,.prix-total-ligne dd{color:var(--my-nuit);font-weight:var(--my-graisse-titre)}
.fiche-action{display:grid;gap:var(--my-esp-2)}.fiche-secondaire{display:flex;flex-wrap:wrap;gap:var(--my-esp-3);font-size:var(--my-taille-s)}
`;

// Libellés des filtres du catalogue, dans l'ordre de la page.
const FILTRES_LIBELLES = [["marque", "filtre_marque"], ["modele", "filtre_modele"], ["carrosserie", "filtre_carrosserie"], ["energie", "filtre_energie"], ["boite", "filtre_boite"]];

function parametresFiltres(filtres, sauf = []) {
  return new URLSearchParams(Object.entries(filtres).filter(([cle, valeur]) => !sauf.includes(cle) && !(cle === "tri" && valeur === "recent")).map(([cle, valeur]) => [cle, String(valeur)]));
}

// Formulaire des filtres (GET, sans JavaScript) : options avec leur nombre d'annonces. Sur téléphone, panneau plein
// écran ouvert par le lien #filtres (:target) ; le nombre du bouton « Voir les N véhicules » suit les choix (script).
function formulaireFiltres(filtres, compteurs, total) {
  const choix = (cle, options) => {
    const libelle = t(FILTRES_LIBELLES.find(([c]) => c === cle)?.[1] || `filtre_${cle}`);
    const desactive = cle === "modele" && !filtres.marque;
    return `<label class="filtre"><span>${escapeHtml(libelle)}</span><select name="${cle}"${desactive ? " disabled" : ""}>
      <option value=""${cle === "modele" ? ` data-tous="${escapeHtml(t("filtre_tous"))}" data-marque="${escapeHtml(t("filtre_modele_marque"))}"` : ""}>${escapeHtml(desactive ? t("filtre_modele_marque") : t("filtre_tous"))}</option>
      ${options.map((o) => `<option value="${escapeHtml(o.valeur)}"${filtres[cle] === o.valeur ? " selected" : ""}>${escapeHtml(o.valeur)} (${o.n})</option>`).join("")}</select></label>`;
  };
  const nombreChamp = (cle, libelle, attributs) => `<label class="filtre"><span>${escapeHtml(t(libelle))}</span><input name="${cle}" type="number" inputmode="numeric" ${attributs} value="${filtres[cle] ?? ""}"></label>`;
  const modeles = (compteurs.modele || []).filter((o) => o.marque === filtres.marque);
  return `<script type="application/json" id="modeles-catalogue">${JSON.stringify(compteurs.modele || []).replace(/</g, "\\u003c")}</script>
  <form class="filtres" id="filtres" action="/vehicules" method="get" aria-labelledby="filtres-titre">
    <div class="filtres-entete"><h2 id="filtres-titre">${escapeHtml(t("filtres_titre"))}</h2><a class="filtres-fermer my-bouton my-bouton--lien" href="#">${escapeHtml(t("filtres_fermer"))}</a></div>
    ${choix("marque", compteurs.marque || [])}
    ${choix("modele", modeles)}
    ${choix("carrosserie", compteurs.carrosserie || [])}
    ${choix("energie", compteurs.energie || [])}
    ${choix("boite", compteurs.boite || [])}
    ${nombreChamp("prix_max", "filtre_prix_max", 'min="0" step="500" placeholder="—"')}
    <div class="filtres-paire">${nombreChamp("annee_min", "filtre_annee_min", 'min="1990" max="2100" placeholder="—"')}${nombreChamp("annee_max", "filtre_annee_max", 'min="1990" max="2100" placeholder="—"')}</div>
    ${nombreChamp("km_max", "filtre_km_max", 'min="0" step="5000" placeholder="—"')}
    ${choix("pays", compteurs.pays || [])}
    <label class="filtre"><span>${escapeHtml(t("filtre_tri"))}</span><select name="tri">${Object.keys(TRIS).map((tri) => `<option value="${tri}"${filtres.tri === tri ? " selected" : ""}>${escapeHtml(t(`tri_${tri}`))}</option>`).join("")}</select></label>
    <div class="filtres-actions"><button class="my-bouton my-bouton--principal my-bouton--large" type="submit" data-voir>${escapeHtml(t("filtres_voir", { n: total }))}</button>
      <a class="my-bouton my-bouton--lien" href="/vehicules">${escapeHtml(t("filtres_effacer"))}</a></div>
  </form>`;
}

// Nombre du bouton « Voir les N véhicules » mis à jour à chaque choix (sans JavaScript : le formulaire marche tel quel).
// Modèles de la marque choisie remplis depuis les compteurs servis dans la page (#modeles-catalogue), sans rechargement.
const SCRIPT_FILTRES = `<script>(()=>{const f=document.getElementById("filtres");if(!f)return;const b=f.querySelector("[data-voir]");const gabarit=b.dataset.gabarit;let n=0;
const modeles=JSON.parse(document.getElementById("modeles-catalogue")?.textContent||"[]");
const remplir=(marque)=>{const m=f.elements.modele;const premier=m.options[0];premier.textContent=marque?premier.dataset.tous:premier.dataset.marque;m.replaceChildren(premier);
for(const o of modeles.filter((x)=>x.marque===marque)){const e=document.createElement("option");e.value=o.valeur;e.textContent=o.valeur+" ("+o.n+")";m.append(e);}m.disabled=!marque;};
f.addEventListener("change",async(e)=>{if(e.target.name==="marque")remplir(e.target.value);const p=new URLSearchParams(new FormData(f));for(const[k,v]of[...p])if(!v||k==="tri")p.delete(k);const id=++n;
try{const r=await fetch("/api/catalogue/compte?"+p);const d=await r.json();if(id===n&&r.ok)b.textContent=gabarit.replace("{n}",d.total);}catch{}});})();</script>`;

const CSS_CATALOGUE = `
.catalogue{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--my-esp-6);margin-block-start:var(--my-esp-4)}
@media(min-width:960px){.catalogue{grid-template-columns:280px minmax(0,1fr);align-items:start}.filtres{position:sticky;inset-block-start:80px}}
.filtres{display:grid;gap:var(--my-esp-3);padding:var(--my-esp-4);border:1px solid var(--my-trait);border-radius:var(--my-rayon-m);background:var(--my-surface)}
.filtres-entete{display:flex;align-items:center;justify-content:space-between}.filtres-entete h2{margin:0;font-size:var(--my-taille-l);color:var(--my-nuit)}
.filtre{display:grid;gap:4px;font-size:var(--my-taille-s);font-weight:var(--my-graisse-forte);color:var(--my-encre-doux)}
.filtre select,.filtre input{inline-size:100%;min-block-size:var(--my-cible);padding-inline:var(--my-esp-3);border:1px solid var(--my-trait);border-radius:var(--my-rayon-s);background:var(--my-surface);color:var(--my-encre);font:inherit;font-size:var(--my-taille-m);font-weight:400}
.filtres-paire{display:grid;grid-template-columns:1fr 1fr;gap:var(--my-esp-2)}
.filtres-actions{display:grid;gap:var(--my-esp-1);margin-block-start:var(--my-esp-2)}
.filtres-fermer,.ouvrir-filtres{display:none}
@media(max-width:959px){
  .ouvrir-filtres{display:inline-flex}
  .filtres{position:fixed;inset:0;z-index:40;display:none;overflow-y:auto;align-content:start;border:0;border-radius:0;padding:var(--my-esp-4) var(--my-gouttiere) var(--my-esp-12)}
  .filtres:target{display:grid}.filtres-fermer{display:inline-flex}
  .filtres-actions{position:sticky;inset-block-end:0;padding-block:var(--my-esp-3);background:var(--my-surface)}
}
.catalogue-resume{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--my-esp-3);margin-block-end:var(--my-esp-4)}
.catalogue-resume p{margin:0;font-weight:var(--my-graisse-forte)}
.carte-badges{display:flex;flex-wrap:wrap;gap:var(--my-esp-1)}
.catalogue-suite{display:flex;justify-content:center;margin-block:var(--my-esp-8)}
.catalogue-vide{padding:var(--my-esp-6);border:1px dashed var(--my-trait);border-radius:var(--my-rayon-m);background:var(--my-surface)}
`;

// Catalogue : filtres, total, une page de cartes et lien vers la suivante (curseur). Pages filtrées ou suivantes non
// indexées (la page sans filtre reste la page canonique).
// Pages du menu « S'informer » (worker/informer.js) : article, sources, autres pages de la rubrique. Indexables.
const CSS_INFORMER = `
.article{max-width:760px}.article .chapo{font-size:18px;color:var(--soft);margin:0 0 8px}
.article .maj{font-size:14px;color:var(--soft);margin:0 0 24px}
.article h2{margin:32px 0 10px;font-size:21px;line-height:1.3;color:var(--my-nuit,#14213d)}
.article ul,.article ol{padding-inline-start:22px}.article li{margin:6px 0}
.article ul.cases{list-style:none;padding:0}.article ul.cases li{position:relative;padding-inline-start:30px}
.article ul.cases li::before{content:"";position:absolute;inset-inline-start:0;top:4px;width:16px;height:16px;border:2px solid var(--my-nuit,#14213d);border-radius:3px}
.article .avertissement{margin:32px 0 0;padding:14px 16px;border-inline-start:4px solid var(--my-or,#c99d4d);background:var(--my-or-100,#fbefd9);font-size:14px}
.article .sources{margin-top:24px;font-size:14px;color:var(--soft)}.article .sources li{overflow-wrap:anywhere}
.article .actions-article{display:flex;flex-wrap:wrap;gap:10px;margin:28px 0 0}
.voir-aussi{margin-top:40px;padding-top:24px;border-top:1px solid var(--line)}.voir-aussi h2{font-size:18px;margin:0 0 12px}
.voir-aussi ul{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:8px;margin:0;padding:0;list-style:none}
.voir-aussi a{display:block;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--my-nuit,#14213d);font-weight:650;text-decoration:none}
.voir-aussi a:hover{border-color:var(--my-nuit,#14213d)}
@media print{.my-entete,.voir-aussi,.actions-article,footer,nav.ariane,.sprite-entete{display:none!important}.article{max-width:none}}
`;

// Typographie française : espace insécable avant « ? », « : », « ! », « ; », « » » et après « « » (pas de signe seul en
// début de ligne).
const insecables = (texte) => texte.replace(/ ([?:!;»])/g, "\u00a0$1").replace(/« /g, "«\u00a0");

async function pageInformer(request, env, chemin) {
  const page = PAGES_INFORMER[chemin];
  const ctx = await contexteVitrine(request, env);
  const colonne = COLONNES_INFORMER.find((c) => c.pages.includes(chemin));
  const canonique = `${SITE}${chemin}`;
  const dateMaj = new Date(`${MISE_A_JOUR}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const autres = COLONNES_INFORMER.flatMap((c) => c.pages).filter((c) => c !== chemin);
  const actions = [
    page.imprimable ? '<button class="my-bouton my-bouton--contour" type="button" data-imprimer>Imprimer ou enregistrer en PDF</button>' : "",
    page.action ? `<a class="my-bouton my-bouton--action" href="${page.action.href}">${escapeHtml(page.action.libelle)}</a>` : ""
  ].join("");
  const donnees = [{
    "@context": "https://schema.org", "@type": "Article", headline: page.titre, description: page.description, inLanguage: "fr",
    dateModified: MISE_A_JOUR, mainEntityOfPage: canonique, publisher: { "@type": "Organization", name: "M&Y AUTO EXPORT", logo: { "@type": "ImageObject", url: `${SITE}/logo.png` } }
  }, {
    "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: page.menu, item: canonique }
    ]
  }];
  return reponseHtml(gabarit({
    titre: `${page.titre} | M&Y AUTO EXPORT`,
    description: page.description,
    canonique, donnees, ctx, typeOg: "article",
    contenu: `<style>${CSS_INFORMER}</style><nav class="ariane" aria-label="Fil d'Ariane"><a href="/">Accueil</a> › ${escapeHtml(colonne.titre)} › ${escapeHtml(page.menu)}</nav>
    <article class="article"><h1>${escapeHtml(insecables(page.titre))}</h1><p class="chapo">${escapeHtml(insecables(page.chapo))}</p><p class="maj">Mis à jour le ${escapeHtml(dateMaj)}</p>
      ${page.sections.map((section) => `<section><h2>${escapeHtml(insecables(section.titre))}</h2>${insecables(section.html)}</section>`).join("")}
      ${actions ? `<div class="actions-article">${actions}</div>` : ""}
      <p class="avertissement">Ces informations sont générales et peuvent évoluer. Elles ne remplacent pas l'avis de la douane, de l'ATTT ou d'un professionnel : vérifiez votre situation avant d'engager un achat.</p>
      ${page.sources.length ? `<section class="sources"><h2>Sources</h2><ul>${page.sources.map(([libelle, url]) => `<li><a href="${escapeHtml(url)}" rel="noopener" target="_blank">${escapeHtml(libelle)}</a></li>`).join("")}</ul></section>` : ""}
    </article>
    <nav class="voir-aussi" aria-label="Autres pages S'informer"><h2>À lire aussi</h2><ul>${autres.map((c) => `<li><a href="${c}">${escapeHtml(PAGES_INFORMER[c].menu)}</a></li>`).join("")}</ul></nav>`
  }), 200, { "Cache-Control": "public, max-age=300" });
}

async function pageListe(request, env, url) {
  let filtres;
  try {
    filtres = lireFiltresCatalogue(url.searchParams);
  } catch (error) {
    if (!(error instanceof ErreurFiltre)) throw error;
    return Response.redirect(`${url.origin}/vehicules`, 302);
  }
  const curseur = url.searchParams.get("apres");
  let page;
  try {
    page = await rechercher(env, filtres, curseur);
  } catch (error) {
    if (!(error instanceof ErreurFiltre)) throw error;
    return Response.redirect(`${url.origin}/vehicules?${parametresFiltres(filtres)}`, 302);
  }
  const [ctx, compteurs, total] = await Promise.all([contexteVitrine(request, env), lireCompteurs(env), compter(env, filtres)]);
  const { lots, suivant } = page;
  const filtre = [...parametresFiltres(filtres)].length > 0;
  const canonique = `${SITE}/vehicules`;
  const donnees = [{
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Véhicules proposés par M&Y AUTO EXPORT",
    numberOfItems: total,
    itemListElement: lots.map((lot, index) => ({ "@type": "ListItem", position: index + 1, url: `${SITE}${cheminVehicule(lot)}`, name: titreLot(lot) }))
  }];
  const lienSuivant = suivant ? `/vehicules?${new URLSearchParams([...parametresFiltres(filtres), ["apres", suivant]])}` : null;
  return reponseHtml(gabarit({
    titre: "Véhicules européens à vendre, livrés en Tunisie | M&Y AUTO EXPORT",
    description: `${total} véhicule${total > 1 ? "s" : ""} d'occasion sélectionné${total > 1 ? "s" : ""} en Europe, achetés sur mandat et livrés en Tunisie.`,
    canonique,
    robots: filtre || curseur ? "noindex, follow" : "",
    donnees,
    contenu: `<style>${CSS_CATALOGUE}</style><nav class="ariane" aria-label="Fil d'Ariane"><a href="/">Accueil</a> › Véhicules</nav>
      <h1>${escapeHtml(t("catalogue_titre"))}</h1>
      <div class="catalogue">
        ${formulaireFiltres(filtres, compteurs, total).replace("data-voir>", `data-voir data-gabarit="${escapeHtml(fr.filtres_voir)}">`)}
        <section aria-labelledby="resultats-titre">
          <div class="catalogue-resume"><p id="resultats-titre" role="status">${escapeHtml(t(total > 1 ? "catalogue_total" : "catalogue_total_un", { n: total }))}</p>
            <a class="ouvrir-filtres my-bouton my-bouton--contour my-bouton--petit" href="#filtres">${escapeHtml(t("filtres_ouvrir"))}</a></div>
          ${lots.length ? `<ul class="cartes-vehicules">${lots.map((lot) => carteVehicule(lot, ctx)).join("")}</ul>`
            : `<div class="catalogue-vide"><p><strong>${escapeHtml(t("catalogue_vide"))}</strong></p><p>${escapeHtml(t("catalogue_vide_aide"))}</p>
                <a class="my-bouton my-bouton--contour" href="/vehicules">${escapeHtml(t("filtres_effacer"))}</a></div>`}
          ${lienSuivant ? `<p class="catalogue-suite"><a class="my-bouton my-bouton--contour" href="${escapeHtml(lienSuivant)}" rel="next">${escapeHtml(t("catalogue_suivant"))}</a></p>` : ""}
          <p class="note">${NOTE_PRIX}</p>
        </section>
      </div>`,
    scripts: SCRIPT_FILTRES,
    ctx
  }), 200, ENTETES_VITRINE);
}

function dateIso(valeur) {
  const t = Date.parse(valeur);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

async function sitemap(request, env) {
  const items = (await lotsAvecEtat(request, env)).filter(indexable);
  const urls = [
    ...PAGES_STATIQUES.map((chemin) => ({ loc: `${SITE}${chemin}` })),
    ...Object.keys(PAGES_INFORMER).map((chemin) => ({ loc: `${SITE}${chemin}`, lastmod: MISE_A_JOUR })),
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
  if (/^\/seller-media\/[a-f0-9]{32}$/.test(url)) return (await sellerMedia(env, url.split("/")[2], true)).status;
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
  // Toute écriture visible du catalogue passe ici : compteurs des filtres à recalculer.
  const compteurs = marquerCompteursPerimes(env).catch(() => console.error("compteurs_perimes_failed"));
  if (ctx?.waitUntil) ctx.waitUntil(compteurs);
  const controle = controlerSeo(env, { declencheur: "publication", references: [reference] }).catch((error) => console.error(error));
  if (ctx?.waitUntil) ctx.waitUntil(controle);
  else return Promise.all([compteurs, controle]);
}

export async function controleQuotidien(controller, env) {
  if (heureParis(new Date(controller.scheduledTime)) !== 7) return null;
  return controlerSeo(env, { declencheur: "quotidien" });
}
