// Catalogue Europe (GET /api/voitures-europe) : voitures préfiltrées par M&Y, lues chez TheCarApi et renvoyées au site sous
// forme normalisée. La clé (env.THECARAPI_KEY) ne quitte jamais le serveur. Réponse mise en cache 15 minutes (Cache API)
// pour économiser le quota ; aucune nouvelle tentative en cas d'échec (5 échecs d'authentification bloquent l'IP 15 min).

export const API_THECARAPI = "https://api.thecarapi.com/api/search";
export const CACHE_SECONDES = 15 * 60;

// Préfiltre M&Y, toujours appliqué : le visiteur peut seulement le resserrer.
export const PREFILTRE = { site: "openlane,ecarstrade", year_from: "2019", limit: "24" };
// À vérifier : filtres absents de la documentation TheCarApi (mileage_to, price_to, et la pagination « page »).
export const PREFILTRE_A_VERIFIER = { mileage_to: "150000", price_to: "30000" };
export const PARAMETRES_A_VERIFIER = ["page"];

// Seuls paramètres acceptés du visiteur ; tout autre paramètre est ignoré.
export const PARAMETRES_VISITEUR = ["brand", "model", "fuel", "year_from", "price_to", "page"];
const VALEUR_VALIDE = /^[\p{L}\p{N} ,.-]{1,40}$/u;
const PAGE_MAX = 50;
const DELAI_API_MS = 8000;

export class ErreurCatalogue extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Paramètres envoyés à TheCarApi : préfiltre, puis affinages du visiteur validés. Lève ErreurCatalogue(400) si une
// valeur est invalide.
export function parametresRecherche(searchParams) {
  const parametres = { ...PREFILTRE, ...PREFILTRE_A_VERIFIER };
  for (const nom of PARAMETRES_VISITEUR) {
    const brute = searchParams.get(nom);
    if (brute === null || brute.trim() === "") continue;
    const valeur = brute.trim();
    if (!VALEUR_VALIDE.test(valeur)) throw new ErreurCatalogue(400, `Filtre « ${nom} » invalide.`);
    if (nom === "year_from") parametres.year_from = String(Math.max(entier(valeur, nom), Number(PREFILTRE.year_from)));
    else if (nom === "price_to") parametres.price_to = String(Math.min(entier(valeur, nom), Number(PREFILTRE_A_VERIFIER.price_to)));
    else if (nom === "page") {
      const page = entier(valeur, nom);
      if (page < 1 || page > PAGE_MAX) throw new ErreurCatalogue(400, `Filtre « page » invalide (1 à ${PAGE_MAX}).`);
      parametres.page = String(page);
    } else parametres[nom] = valeur;
  }
  return parametres;
}

function entier(valeur, nom) {
  if (!/^\d{1,9}$/.test(valeur)) throw new ErreurCatalogue(400, `Filtre « ${nom} » invalide (nombre entier attendu).`);
  return Number(valeur);
}

// Paramètres triés : deux recherches identiques partagent la même entrée de cache, quel que soit l'ordre.
export function chaineTriee(parametres) {
  return Object.keys(parametres).sort().map((cle) => `${encodeURIComponent(cle)}=${encodeURIComponent(parametres[cle])}`).join("&");
}

export async function voituresEurope(request, env, url, ctx) {
  const parametres = parametresRecherche(url.searchParams);
  if (!env.THECARAPI_KEY) throw new ErreurCatalogue(503, "Le catalogue Europe n'est pas encore disponible.");
  const requete = chaineTriee(parametres);
  const cache = globalThis.caches?.default;
  const cle = new Request(`${url.origin}/api/voitures-europe?${requete}`);
  const enCache = cache && await cache.match(cle);
  if (enCache) return enCache;

  let reponse;
  try {
    reponse = await fetch(`${API_THECARAPI}?${requete}`, {
      headers: { "X-API-Key": env.THECARAPI_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(DELAI_API_MS)
    });
  } catch (error) {
    console.error("thecarapi", "réseau", error?.name);
    throw indisponible();
  }
  if (!reponse.ok) {
    // 401/403 : clé ou portée invalide ; 429 : quota ou trop d'essais. Statut seul, jamais la clé ni la réponse.
    console.error("thecarapi", reponse.status);
    throw indisponible();
  }
  let donnees;
  try {
    donnees = await reponse.json();
  } catch {
    console.error("thecarapi", "réponse illisible");
    throw indisponible();
  }

  const corps = JSON.stringify(normaliser(donnees, tauxTnd(env)));
  const resultat = new Response(corps, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${CACHE_SECONDES}` }
  });
  if (cache) {
    const enregistrement = cache.put(cle, resultat.clone());
    if (ctx?.waitUntil) ctx.waitUntil(enregistrement);
    else await enregistrement;
  }
  return resultat;
}

function indisponible() {
  return new ErreurCatalogue(502, "Le catalogue Europe est momentanément indisponible. Réessaie dans quelques minutes.");
}

function tauxTnd(env) {
  const taux = Number(env.EUR_TND_RATE);
  return Number.isFinite(taux) && taux > 0 ? taux : null;
}

// --- Normalisation : champs connus (car_name_en, registration_year, public_price_eur, site_name, auction_id, total),
// autres champs lus avec des replis tolérants ---

export function normaliser(donnees, taux) {
  const liste = [donnees?.results, donnees?.cars, donnees?.data, donnees?.items, donnees].find(Array.isArray) || [];
  const voitures = liste.filter((voiture) => voiture && typeof voiture === "object").map((voiture) => normaliserVoiture(voiture, taux));
  const total = nombre(donnees?.total);
  return { total: total ?? voitures.length, voitures };
}

function normaliserVoiture(voiture, taux) {
  const prixEur = nombre(voiture.public_price_eur ?? voiture.price_eur ?? voiture.price);
  const source = texte(voiture.site_name ?? voiture.site, 60);
  const numero = texte(voiture.auction_id ?? voiture.id, 80);
  const marqueModele = [texte(voiture.brand ?? voiture.make, 80), texte(voiture.model, 120)].filter(Boolean).join(" ");
  return {
    // Préfixé par la source : un même numéro d'enchère peut exister chez OPENLANE et chez eCarsTrade.
    id: numero && source ? `${source.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${numero}` : numero,
    titre: texte(voiture.car_name_en ?? voiture.title ?? voiture.name, 200) ?? (marqueModele || null),
    annee: annee(voiture.registration_year ?? voiture.year),
    km: nombre(voiture.mileage_km ?? voiture.mileage ?? voiture.km ?? voiture.odometer),
    carburant: texte(voiture.fuel ?? voiture.fuel_type, 60),
    boite: texte(voiture.gearbox ?? voiture.transmission, 60),
    prixEur,
    prixTnd: prixEur !== null && taux ? Math.round(prixEur * taux) : null,
    source,
    finEnchere: date(voiture.auction_end ?? voiture.end_date ?? voiture.ends_at ?? voiture.auction_end_date),
    image: image(voiture)
  };
}

function texte(valeur, max) {
  if (typeof valeur === "number" && Number.isFinite(valeur)) return String(valeur);
  return typeof valeur === "string" && valeur.trim() ? valeur.trim().slice(0, max) : null;
}

function nombre(valeur) {
  if (typeof valeur === "number") return Number.isFinite(valeur) ? valeur : null;
  if (typeof valeur !== "string") return null;
  const propre = valeur.replace(/[\s  ]/g, "").replace(",", ".");
  return /^\d+(\.\d+)?$/.test(propre) ? Number(propre) : null;
}

function annee(valeur) {
  const resultat = String(valeur ?? "").match(/\b(19|20)\d{2}\b/);
  return resultat ? Number(resultat[0]) : null;
}

function date(valeur) {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  const instant = typeof valeur === "number" ? (valeur < 1e12 ? valeur * 1000 : valeur) : Date.parse(valeur);
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

// Première image en https : une autre adresse (http, javascript:…) n'est jamais renvoyée au site.
function image(voiture) {
  const candidats = [voiture.image, voiture.image_url, voiture.thumbnail, voiture.photo, ...(Array.isArray(voiture.images) ? voiture.images : [])];
  for (const candidat of candidats) {
    const adresse = typeof candidat === "string" ? candidat : candidat?.url;
    if (typeof adresse === "string" && /^https:\/\/[^\s"'<>]+$/.test(adresse) && adresse.length <= 1000) return adresse;
  }
  return null;
}
