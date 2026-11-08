// Catalogue filtrable (refonte, étape 3) : filtres, tri et pagination par curseur faits par D1 sur les colonnes calculées
// de vehicles (migration 0023), pour tenir 20 000 annonces dans le plan gratuit (10 ms de calcul, 5 millions de lignes
// lues par jour). Compteurs des options de filtre gardés dans catalogue_compteurs (recalculés au plus une fois par heure) ;
// total d'une recherche mis en cache
// 10 minutes (Cache API, gratuit, sans binding KV).
import { lot1Public, legacyAuctionsEnabled } from "./proposal-domain.js";

export const PAR_PAGE = 24;
export const FILTRES_TEXTE = { marque: "c_marque", modele: "c_modele", carrosserie: "c_carrosserie", energie: "c_energie", boite: "c_boite", pays: "c_pays" };
export const TRIS = {
  recent: { colonne: "v.updated_at", sens: "DESC", texte: true },
  prix_asc: { colonne: "v.c_prix_eur", sens: "ASC", texte: false },
  prix_desc: { colonne: "v.c_prix_eur", sens: "DESC", texte: false },
  km_asc: { colonne: "v.c_km", sens: "ASC", texte: false }
};
const VALEUR = /^[\p{L}\p{N} ,.'()/+-]{1,60}$/u;
const DUREE_CACHE = 600;
// Une heure : recalculer les 6 compteurs lit environ 6 × N lignes ; à 20 000 annonces, 24 recalculs par jour au plus
// (environ 3 millions de lignes) restent sous les 5 millions de lignes lues par jour du plan gratuit.
const ATTENTE_RECALCUL_MS = 60 * 60 * 1000;

export class ErreurFiltre extends Error {}

// Filtres de l'URL, contrôlés. Valeur vide : filtre ignoré. Lève ErreurFiltre si une valeur est invalide.
export function lireFiltres(searchParams) {
  const filtres = {};
  for (const cle of Object.keys(FILTRES_TEXTE)) {
    const valeur = (searchParams.get(cle) || "").trim();
    if (!valeur) continue;
    if (!VALEUR.test(valeur)) throw new ErreurFiltre(`Filtre « ${cle} » invalide.`);
    filtres[cle] = valeur;
  }
  for (const [cle, max] of [["prix_max", 10000000], ["annee_min", 2100], ["annee_max", 2100], ["km_max", 10000000]]) {
    const valeur = (searchParams.get(cle) || "").trim().replace(/[\s.]/g, "");
    if (!valeur) continue;
    if (!/^\d{1,8}$/.test(valeur) || Number(valeur) > max) throw new ErreurFiltre(`Filtre « ${cle} » invalide (nombre entier attendu).`);
    filtres[cle] = Number(valeur);
  }
  const tri = searchParams.get("tri") || "recent";
  if (!Object.hasOwn(TRIS, tri)) throw new ErreurFiltre("Tri inconnu.");
  filtres.tri = tri;
  return filtres;
}

// Annonces visibles du public : en ligne, non vendues ; annonces de vendeurs publiées, vendeur non suspendu, diagnostic
// valide (mêmes règles que worker/index.js catalogueComplet) ; ventes terminées sans vendeur affecté exclues.
const SQL_VENDEUR_VALIDE = `EXISTS (SELECT 1 FROM seller_submissions s WHERE 'SV-' || s.id = v.reference AND s.stage = 'published'
      AND NOT EXISTS (SELECT 1 FROM marketplace_suspensions x WHERE x.user_id = s.user_id)
      AND EXISTS (SELECT 1 FROM seller_diagnostics d JOIN partner_garages g ON g.id = d.garage_id WHERE d.submission_id = s.id
        AND d.diagnostic_status = 'approved' AND d.valid_until >= date('now') AND g.active = 1 AND g.valid_until >= date('now')))`;

function conditionsVisibles(env, maintenant) {
  const conditions = [
    "v.removed = 0",
    "COALESCE(v.c_statut, '') NOT IN ('sold', 'archived', 'inactive')",
    `(v.reference NOT LIKE 'SV-%' OR ${SQL_VENDEUR_VALIDE})`
  ];
  const valeurs = [];
  if (!legacyAuctionsEnabled(env)) {
    conditions.push(`NOT (v.c_statut = 'open' AND json_extract(v.data, '$.endsAt') <= ? AND NOT EXISTS (SELECT 1 FROM vehicle_offer_owners ow WHERE ow.vehicle_id = v.reference))`);
  } else {
    // Enchères actives (mode historique) : une vente terminée n'est plus listée (fin prévue ; une prolongation de dernière
    // minute n'est pas prise en compte ici, la fiche reste consultable).
    conditions.push(`NOT (v.c_statut = 'open' AND COALESCE(json_extract(v.data, '$.endsAt'), '') <= ?)`);
  }
  valeurs.push(maintenant.toISOString());
  return { conditions, valeurs };
}

// Conditions SQL des filtres (sauf `sauf`, pour compter les options d'un filtre sans lui-même).
function conditionsFiltres(filtres, sauf = null) {
  const conditions = [];
  const valeurs = [];
  for (const [cle, colonne] of Object.entries(FILTRES_TEXTE)) {
    if (cle === sauf || filtres[cle] === undefined) continue;
    // Égalité exacte (index utilisables) : les valeurs proposées viennent des compteurs eux-mêmes.
    conditions.push(`v.${colonne} = ?`);
    valeurs.push(filtres[cle]);
  }
  if (filtres.prix_max !== undefined) { conditions.push("v.c_prix_eur <= ?"); valeurs.push(filtres.prix_max); }
  if (filtres.annee_min !== undefined) { conditions.push("v.c_annee >= ?"); valeurs.push(filtres.annee_min); }
  if (filtres.annee_max !== undefined) { conditions.push("v.c_annee <= ?"); valeurs.push(filtres.annee_max); }
  if (filtres.km_max !== undefined) { conditions.push("v.c_km <= ?"); valeurs.push(filtres.km_max); }
  return { conditions, valeurs };
}

// Curseur opaque : dernière valeur du tri et référence de la dernière annonce affichée.
export function encoderCurseur(valeur, reference) {
  return btoa(unescape(encodeURIComponent(JSON.stringify([valeur, reference])))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decoderCurseur(curseur) {
  if (!curseur) return null;
  try {
    const [valeur, reference] = JSON.parse(decodeURIComponent(escape(atob(curseur.replace(/-/g, "+").replace(/_/g, "/")))));
    if (typeof reference !== "string" || reference.length > 64 || !["string", "number"].includes(typeof valeur) && valeur !== null) throw new Error();
    return { valeur, reference };
  } catch {
    throw new ErreurFiltre("Page invalide.");
  }
}

// Une page d'annonces : { lots, suivant } (suivant : curseur de la page suivante, ou null).
export async function rechercher(env, filtres, curseur = null, maintenant = new Date()) {
  const tri = TRIS[filtres.tri];
  const visibles = conditionsVisibles(env, maintenant);
  const choisis = conditionsFiltres(filtres);
  const conditions = [...visibles.conditions, ...choisis.conditions];
  const valeurs = [...visibles.valeurs, ...choisis.valeurs];
  // Annonces sans valeur pour la colonne de tri (prix ou kilométrage inconnu) : en fin de liste, hors pagination par prix.
  if (!tri.texte) conditions.push(`${tri.colonne} IS NOT NULL`);
  const position = decoderCurseur(curseur);
  if (position) {
    const comparaison = tri.sens === "DESC" ? "<" : ">";
    conditions.push(`(${tri.colonne} ${comparaison} ? OR (${tri.colonne} = ? AND v.reference ${comparaison} ?))`);
    valeurs.push(position.valeur, position.valeur, position.reference);
  }
  const { results } = await env.DB.prepare(
    `SELECT v.reference, v.data, v.updated_at, ${tri.colonne} AS cle_tri FROM vehicles v WHERE ${conditions.join(" AND ")}
     ORDER BY ${tri.colonne} ${tri.sens}, v.reference ${tri.sens} LIMIT ?`
  ).bind(...valeurs, PAR_PAGE + 1).all();
  const page = results.slice(0, PAR_PAGE);
  const dernier = page.at(-1);
  return {
    lots: page.map((row) => lot1Public(JSON.parse(row.data))),
    suivant: results.length > PAR_PAGE && dernier ? encoderCurseur(dernier.cle_tri, dernier.reference) : null
  };
}

// Nombre d'annonces d'une recherche, mis en cache 10 minutes par combinaison de filtres (hors tri et page).
export async function compter(env, filtres, ctx = null, maintenant = new Date()) {
  const cle = new Request(`https://cache.myautoexport.invalid/compte?${new URLSearchParams(Object.entries(filtres).filter(([k]) => k !== "tri").sort()).toString()}`);
  const cache = globalThis.caches?.default;
  const enCache = cache && await cache.match(cle);
  if (enCache) return Number(await enCache.text());
  const visibles = conditionsVisibles(env, maintenant);
  const choisis = conditionsFiltres(filtres);
  const ligne = await env.DB.prepare(`SELECT COUNT(*) AS n FROM vehicles v WHERE ${[...visibles.conditions, ...choisis.conditions].join(" AND ")}`)
    .bind(...visibles.valeurs, ...choisis.valeurs).first();
  if (cache) {
    const ecriture = cache.put(cle, new Response(String(ligne.n), { headers: { "Cache-Control": `public, max-age=${DUREE_CACHE}` } }));
    if (ctx?.waitUntil) ctx.waitUntil(ecriture); else await ecriture;
  }
  return ligne.n;
}

// Compteurs des options sur tout le catalogue en ligne : { marque: [{ valeur, n }], modele: [{ marque, valeur, n }], … }.
export async function recalculerCompteurs(env, maintenant = new Date()) {
  const visibles = conditionsVisibles(env, maintenant);
  const ou = visibles.conditions.join(" AND ");
  const requetes = Object.entries(FILTRES_TEXTE).map(([cle, colonne]) => {
    const groupe = cle === "modele" ? "v.c_marque AS marque, v.c_modele AS valeur" : `v.${colonne} AS valeur`;
    const par = cle === "modele" ? "v.c_marque, v.c_modele" : `v.${colonne}`;
    return env.DB.prepare(`SELECT ${groupe}, COUNT(*) AS n FROM vehicles v WHERE ${ou} AND v.${colonne} IS NOT NULL AND v.${colonne} <> ''
      GROUP BY ${par} ORDER BY n DESC, valeur LIMIT 300`).bind(...visibles.valeurs);
  });
  const resultats = await env.DB.batch(requetes);
  const le = maintenant.toISOString();
  const compteurs = {};
  await env.DB.batch(Object.keys(FILTRES_TEXTE).map((cle, i) => {
    compteurs[cle] = resultats[i].results;
    return env.DB.prepare("INSERT INTO catalogue_compteurs (filtre, valeurs, calcule_le, perime) VALUES (?, ?, ?, 0) ON CONFLICT(filtre) DO UPDATE SET valeurs = excluded.valeurs, calcule_le = excluded.calcule_le, perime = 0")
      .bind(cle, JSON.stringify(resultats[i].results), le);
  }));
  return compteurs;
}

// Après une écriture du catalogue : compteurs marqués périmés. Recalculés au plus une fois par heure (pas de
// lectures multipliées pendant un import), et chaque nuit par le cron.
export async function marquerCompteursPerimes(env) {
  await env.DB.prepare("UPDATE catalogue_compteurs SET perime = 1").run();
}

export async function lireCompteurs(env, ctx = null, maintenant = new Date()) {
  const { results } = await env.DB.prepare("SELECT filtre, valeurs, calcule_le, perime FROM catalogue_compteurs").all();
  const lignes = new Map(results.map((r) => [r.filtre, r]));
  if (Object.keys(FILTRES_TEXTE).some((cle) => !lignes.has(cle))) return recalculerCompteurs(env, maintenant);
  if (results.some((r) => r.perime)) {
    // Verrou : seul le lecteur qui fait passer la ligne « marque » de périmée à en cours lance le recalcul (en arrière-plan).
    const seuil = new Date(maintenant.getTime() - ATTENTE_RECALCUL_MS).toISOString();
    const verrou = await env.DB.prepare("UPDATE catalogue_compteurs SET perime = 0, calcule_le = ? WHERE filtre = 'marque' AND perime = 1 AND calcule_le < ?")
      .bind(maintenant.toISOString(), seuil).run();
    if (verrou.meta.changes) {
      const recalcul = recalculerCompteurs(env, maintenant).catch(() => console.error("compteurs_failed"));
      if (ctx?.waitUntil) ctx.waitUntil(recalcul); else await recalcul;
    }
  }
  return Object.fromEntries(Object.keys(FILTRES_TEXTE).map((cle) => [cle, JSON.parse(lignes.get(cle).valeurs)]));
}

// Fiche : le segment d'adresse finit par la référence (…-ol-11721446) ; les suffixes possibles sont cherchés par index et
// la plus longue référence l'emporte (…-my-0001 désigne MY-0001, pas 0001). Renvoie l'élément du catalogue, ou null :
// { lot, removed (retirée ou vente terminée : page 410), offerOwnerAssigned, sellerUnavailable (annonce vendeur non
// valide : 404) }.
export function suffixesReference(segment) {
  const morceaux = String(segment || "").toLowerCase().split("-").filter(Boolean);
  return [...new Set(morceaux.slice(-8).map((_, i, liste) => liste.slice(i).join("-")))].filter((s) => s.length <= 64);
}

export async function chargerFiche(env, segment, maintenant = new Date()) {
  const suffixes = suffixesReference(segment);
  if (!suffixes.length) return null;
  const { results } = await env.DB.prepare(
    `SELECT v.reference, v.data, v.removed, v.c_ref_slug,
       EXISTS (SELECT 1 FROM vehicle_offer_owners ow WHERE ow.vehicle_id = v.reference) AS proprietaire,
       CASE WHEN v.reference LIKE 'SV-%' THEN ${SQL_VENDEUR_VALIDE} ELSE 1 END AS vendeur_valide
     FROM vehicles v WHERE v.c_ref_slug IN (${suffixes.map(() => "?").join(",")})`
  ).bind(...suffixes).all();
  const row = results.sort((a, b) => b.c_ref_slug.length - a.c_ref_slug.length)[0];
  if (!row) return null;
  const lot = JSON.parse(row.data);
  const offerOwnerAssigned = Boolean(row.proprietaire);
  const terminee = !legacyAuctionsEnabled(env) && !offerOwnerAssigned && lot.status === "open" && Boolean(lot.endsAt) && Date.parse(lot.endsAt) <= maintenant.getTime();
  const sellerUnavailable = !row.vendeur_valide;
  return { lot: legacyAuctionsEnabled(env) ? lot : lot1Public(lot), source: "base", removed: Boolean(row.removed) || terminee || sellerUnavailable, offerOwnerAssigned, sellerUnavailable };
}

// API JSON : /api/catalogue/recherche (page d'annonces) et /api/catalogue/compte (nombre pour « Voir les N véhicules »).
export async function routeCatalogue(request, env, url, ctx, { json, ApiError, carte }) {
  let filtres;
  try {
    filtres = lireFiltres(url.searchParams);
  } catch (error) {
    if (error instanceof ErreurFiltre) throw new ApiError(400, error.message);
    throw error;
  }
  if (url.pathname === "/api/catalogue/compte") return json({ total: await compter(env, filtres, ctx) }, 200, { "Cache-Control": "public, max-age=60" });
  try {
    const { lots, suivant } = await rechercher(env, filtres, url.searchParams.get("apres"));
    return json({ vehicules: lots.map(carte), suivant });
  } catch (error) {
    if (error instanceof ErreurFiltre) throw new ApiError(400, error.message);
    throw error;
  }
}

