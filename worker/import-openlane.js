// Import d'annonces OpenLane (via TheCarApi) dans le catalogue : recherche dans /admin-import, puis import en
// brouillon (véhicule retiré, invisible du public) que l'administration relit et remet en ligne depuis /admin.
// Rien n'est jamais publié automatiquement. Les photos restent à leur adresse d'origine (aucune copie dans R2).
// Suivi quotidien (cron 30 2 * * *) : une annonce dont l'enchère est terminée est retirée du site, sans appel à l'API.
import { ErreurCatalogue, VALEUR_VALIDE, appelerTheCarApi, date, nombre, normaliserVoiture, texte } from "./voitures-europe.js";
import { ecrireReglageJson, journaliser, reglageActif, reglageJson } from "./reglages.js";

export const MAX_IMPORTS_SUIVIS = 100;

// Préfiltre des annonces à récupérer, réglé dans /admin-import (réglage import_openlane_filtres). achatImmediat : formats
// « Achat immédiat », « Achat immédiat et enlèvement » et « 24/7 Achat immédiat » d'OpenLane, que TheCarApi ne distingue
// pas (buy_now / is_buy_now). TheCarApi ne dit pas si une enchère a un prix de réserve : ce format n'est pas filtrable.
const CLE_FILTRES = "import_openlane_filtres";
export const FILTRES_DEFAUT = { anneeMin: 2022, anneeMax: null, kmMax: 150000, prixMaxEur: 30000, achatImmediat: true, carburant: "", boite: "" };
export const CARBURANTS_IMPORT = { Petrol: "Essence", Diesel: "Diesel", Hybrid: "Hybride", Electric: "Électrique" };
export const BOITES_IMPORT = { Automatic: "Automatique", Manual: "Manuelle" };
const ANNEE_MIN_POSSIBLE = 1990;

const entierEntre = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;

// Préfiltre contrôlé et complété par les valeurs par défaut. Renvoie { filtres } ou { erreur }.
export function validerFiltres(valeur, anneeCourante = new Date().getUTCFullYear()) {
  if (!valeur || typeof valeur !== "object" || Array.isArray(valeur)) return { erreur: "Préfiltre attendu." };
  const f = { ...FILTRES_DEFAUT, ...valeur };
  if (!entierEntre(f.anneeMin, ANNEE_MIN_POSSIBLE, anneeCourante + 1)) return { erreur: `Année minimum entre ${ANNEE_MIN_POSSIBLE} et ${anneeCourante + 1}.` };
  if (f.anneeMax !== null && (!entierEntre(f.anneeMax, f.anneeMin, anneeCourante + 1))) return { erreur: "Année maximum invalide (au moins l'année minimum)." };
  if (!entierEntre(f.kmMax, 1, 1000000)) return { erreur: "Kilométrage maximum entre 1 et 1 000 000 km." };
  if (!entierEntre(f.prixMaxEur, 1, 1000000)) return { erreur: "Prix maximum entre 1 et 1 000 000 €." };
  if (typeof f.achatImmediat !== "boolean") return { erreur: "Achat immédiat : vrai ou faux." };
  if (f.carburant !== "" && !Object.hasOwn(CARBURANTS_IMPORT, f.carburant)) return { erreur: "Carburant inconnu." };
  if (f.boite !== "" && !Object.hasOwn(BOITES_IMPORT, f.boite)) return { erreur: "Boîte de vitesses inconnue." };
  const { anneeMin, anneeMax, kmMax, prixMaxEur, achatImmediat, carburant, boite } = f;
  return { filtres: { anneeMin, anneeMax, kmMax, prixMaxEur, achatImmediat, carburant, boite } };
}

export async function lireFiltres(env) {
  const enregistres = await reglageJson(env, CLE_FILTRES);
  return (enregistres && validerFiltres(enregistres).filtres) || { ...FILTRES_DEFAUT };
}
const MAX_PHOTOS = 20;
const https = (valeur) => (typeof valeur === "string" && valeur.length <= 1000 && /^https:\/\/[^\s"'<>]+$/.test(valeur) ? valeur : null);
// Copies servies par TheCarApi (adresse relative signée, valable jusqu'au 1er janvier 2027 sur la réponse du 7 novembre
// 2026) : rendues absolues quand l'annonce n'a pas d'adresse d'origine pour cette photo.
const ORIGINE_PHOTOS_THECARAPI = "https://api.thecarapi.com";
const copieTheCarApi = (valeur) => (typeof valeur === "string" && /^\/(?:auction-photo|image-vault)\/[A-Za-z0-9/_.\-?=&%]{1,500}$/.test(valeur) ? `${ORIGINE_PHOTOS_THECARAPI}${valeur}` : null);

// Référence du catalogue d'une annonce OpenLane : OL- suivi du numéro d'enchère (caractères sûrs, 40 au plus).
export function referenceImport(numero) {
  const propre = String(numero || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 37);
  return propre ? `OL-${propre}` : null;
}

// Annonce brute de TheCarApi : champs du catalogue public, plus ceux utiles à l'import (marque et modèle séparés,
// lien de l'annonce, première immatriculation, puissance, photos). Noms vérifiés sur une vraie réponse du 7 novembre 2026
// (contrat 2026-10-05) ; la cylindrée n'y figure pas (à saisir dans /admin), les autres noms restent en repli.
export function annonceImport(brute) {
  const voiture = normaliserVoiture(brute, null);
  const numero = texte(brute.auction_id_str ?? brute.auction_id ?? brute.id, 80);
  const photos = [];
  // Une photo par entrée de images[] : adresse d'origine (serveur d'OpenLane) si elle existe, sinon la copie de TheCarApi.
  // Sans images[], la vignette d'origine seule.
  const images = Array.isArray(brute.images) && brute.images.length ? brute.images : [brute.original_thumbnail_url ?? brute.image ?? brute.image_url];
  for (const image of images) {
    const adresse = typeof image === "string" ? https(image) ?? copieTheCarApi(image)
      : https(image?.url) ?? https(image?.remote_url) ?? copieTheCarApi(image?.url) ?? copieTheCarApi(image?.served_url);
    if (adresse && !photos.includes(adresse) && photos.length < MAX_PHOTOS) photos.push(adresse);
  }
  const cylindree = nombre(brute.engine_cc ?? brute.cylinder_capacity ?? brute.cc ?? brute.displacement ?? brute.engine_capacity);
  const puissance = nombre(brute.hp);
  const immatriculation = String(brute.date_first_registration ?? "").slice(0, 10);
  return {
    ...voiture,
    achatImmediat: brute.is_buy_now === true,
    numero,
    reference: referenceImport(numero),
    marque: texte(brute.clean_make ?? brute.brand ?? brute.make, 80),
    modele: texte(brute.clean_model ?? brute.model, 120),
    lien: https(brute.original_url ?? brute.url ?? brute.link ?? brute.car_url ?? brute.listing_url),
    cylindree: cylindree !== null && cylindree >= 50 && cylindree <= 10000 ? Math.round(cylindree) : null,
    puissance: puissance !== null && puissance >= 1 && puissance <= 2000 ? Math.round(puissance) : null,
    premiereImmatriculation: /^\d{4}-\d{2}-\d{2}$/.test(immatriculation) ? immatriculation : null,
    couleur: texte(brute.color ?? brute.colour, 60),
    photos
  };
}

// Champs d'un véhicule du catalogue (contrôlés ensuite par validerVehicule) et trace de la source.
export function versVehicule(annonce) {
  if (!annonce || typeof annonce !== "object") return { erreur: "Annonce manquante." };
  const reference = referenceImport(annonce.numero);
  if (!reference) return { erreur: "Numéro d'annonce manquant." };
  if (!texte(annonce.marque, 80) || !texte(annonce.modele, 120)) return { erreur: "Marque et modèle obligatoires pour importer." };
  const corps = {
    make: annonce.marque, model: annonce.modele, status: "stock", fuel: annonce.carburant ?? undefined,
    transmission: annonce.boite ?? undefined, color: annonce.couleur ?? undefined, year: annonce.annee ?? undefined,
    mileageKm: annonce.km ?? undefined, prixEur: annonce.prixEur ?? undefined, engineCc: annonce.cylindree ?? undefined,
    powerHp: annonce.puissance ?? undefined, premiereImmatriculation: annonce.premiereImmatriculation ?? undefined,
    sourceUrl: https(annonce.lien) ?? undefined, seller: "Vendeur professionnel (OpenLane)",
    photos: (Array.isArray(annonce.photos) ? annonce.photos : []).map(https).filter(Boolean).slice(0, MAX_PHOTOS),
    specs: [["Source", "OpenLane"], ...(annonce.finEnchere ? [["Fin de l'enchère", new Date(annonce.finEnchere).toLocaleString("fr-FR", { timeZone: "Africa/Tunis", dateStyle: "long", timeStyle: "short" })]] : [])]
  };
  const source = { site: "openlane", id: texte(annonce.numero, 80), finEnchere: date(annonce.finEnchere), termine: false };
  return { reference, corps, source };
}

async function importsSuivis(env) {
  const ligne = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM vehicles WHERE json_extract(data, '$.importSource.site') = 'openlane' AND json_extract(data, '$.importSource.termine') = 0"
  ).first();
  return ligne.n;
}

// Paramètres envoyés à TheCarApi : préfiltre de l'administration, puis recherche du moment (marque, modèle, carburant,
// année, prix, page), qui ne peut que le resserrer. Lève ErreurCatalogue(400) si une valeur est invalide.
export function parametresImport(searchParams, filtres) {
  const p = { site: "openlane", limit: "24", year_from: String(filtres.anneeMin), kilometers_to: String(filtres.kmMax), price_to: String(filtres.prixMaxEur) };
  if (filtres.anneeMax !== null) p.year_to = String(filtres.anneeMax);
  if (filtres.achatImmediat) p.buy_now = "true";
  if (filtres.carburant) p.fuel = filtres.carburant;
  if (filtres.boite) p.gearbox = filtres.boite;
  const lire = (nom) => {
    const valeur = (searchParams.get(nom) || "").trim();
    if (valeur && !VALEUR_VALIDE.test(valeur)) throw new ErreurCatalogue(400, `Filtre « ${nom} » invalide.`);
    return valeur;
  };
  const entier = (nom) => {
    const valeur = lire(nom);
    if (!valeur) return null;
    if (!/^\d{1,9}$/.test(valeur)) throw new ErreurCatalogue(400, `Filtre « ${nom} » invalide (nombre entier attendu).`);
    return Number(valeur);
  };
  for (const nom of ["brand", "model"]) if (lire(nom)) p[nom] = lire(nom);
  if (!filtres.carburant && Object.hasOwn(CARBURANTS_IMPORT, lire("fuel"))) p.fuel = lire("fuel");
  const annee = entier("year_from");
  if (annee !== null) p.year_from = String(Math.max(annee, filtres.anneeMin));
  const prix = entier("price_to");
  if (prix !== null) p.price_to = String(Math.min(prix, filtres.prixMaxEur));
  const page = entier("page");
  if (page !== null) {
    if (page < 1 || page > 50) throw new ErreurCatalogue(400, "Filtre « page » invalide (1 à 50).");
    p.page = String(page);
  }
  return p;
}

// Contrôle d'une annonce contre le préfiltre (en plus du filtre envoyé à l'API, et à l'import). Motif, ou null.
export function horsFiltres(annonce, filtres) {
  if (filtres.achatImmediat && annonce.achatImmediat !== true) return "annonce hors achat immédiat";
  if (!Number.isInteger(annonce.annee) || annonce.annee < filtres.anneeMin) return `véhicule antérieur à ${filtres.anneeMin}`;
  if (filtres.anneeMax !== null && annonce.annee > filtres.anneeMax) return `véhicule postérieur à ${filtres.anneeMax}`;
  if (Number.isFinite(annonce.km) && annonce.km > filtres.kmMax) return `plus de ${filtres.kmMax} km`;
  if (Number.isFinite(annonce.prixEur) && annonce.prixEur > filtres.prixMaxEur) return `plus de ${filtres.prixMaxEur} €`;
  return null;
}

export async function rechercherAnnonces(env, searchParams) {
  const filtres = await lireFiltres(env);
  const donnees = await appelerTheCarApi(env, parametresImport(searchParams, filtres));
  const liste = [donnees?.results, donnees?.cars, donnees?.data, donnees?.items, donnees].find(Array.isArray) || [];
  const annonces = liste.filter((brute) => brute && typeof brute === "object").map(annonceImport).filter((a) => !horsFiltres(a, filtres));
  const references = annonces.map((a) => a.reference).filter(Boolean);
  const deja = new Set();
  if (references.length) {
    const { results } = await env.DB.prepare(`SELECT reference FROM vehicles WHERE reference IN (${references.map(() => "?").join(",")})`).bind(...references).all();
    for (const row of results) deja.add(row.reference);
  }
  return {
    total: nombre(donnees?.total) ?? annonces.length,
    annonces: annonces.map((a) => ({ ...a, dejaImporte: deja.has(a.reference) })),
    suivis: await importsSuivis(env), max: MAX_IMPORTS_SUIVIS, filtres
  };
}

// Import en brouillon. enregistrerBrouillon (worker/index.js) contrôle les champs et écrit le véhicule retiré.
export async function importerAnnonce(env, user, annonce, { ApiError, enregistrerBrouillon }) {
  const { reference, corps, source, erreur } = versVehicule(annonce);
  if (erreur) throw new ApiError(400, erreur);
  const motif = horsFiltres(annonce, await lireFiltres(env));
  if (motif) throw new ApiError(400, `Hors du préfiltre d'import : ${motif}.`);
  if ((await importsSuivis(env)) >= MAX_IMPORTS_SUIVIS) throw new ApiError(429, `${MAX_IMPORTS_SUIVIS} annonces OpenLane suivies au plus : retirez-en avant d'importer.`);
  if (!(await enregistrerBrouillon(env, user, reference, corps, source))) throw new ApiError(409, `Annonce déjà importée (réf. ${reference}).`);
  return { reference, brouillon: true, message: "Brouillon créé : à relire dans /admin (Retirés), puis « Remettre en ligne »." };
}

export async function routeAdminImport(request, env, url, user, deps) {
  if (url.pathname === "/api/admin/import/filtres" && request.method === "GET") {
    return deps.json({ filtres: await lireFiltres(env), defaut: FILTRES_DEFAUT, carburants: CARBURANTS_IMPORT, boites: BOITES_IMPORT });
  }
  if (url.pathname === "/api/admin/import/filtres" && request.method === "PUT") {
    const { filtres, erreur } = validerFiltres((await deps.lireJson(request)).filtres);
    if (erreur) throw new deps.ApiError(400, erreur);
    await ecrireReglageJson(env, CLE_FILTRES, filtres, user.id);
    return deps.json({ filtres });
  }
  if (url.pathname === "/api/admin/import/recherche" && request.method === "GET") return deps.json(await rechercherAnnonces(env, url.searchParams));
  if (url.pathname === "/api/admin/import" && request.method === "POST") {
    const { annonce } = await deps.lireJson(request);
    return deps.json(await importerAnnonce(env, user, annonce, deps), 201);
  }
  throw new deps.ApiError(404, "Route inconnue.");
}

// Cron quotidien : retire du site les annonces importées dont l'enchère est terminée. Coupé par automations_actives.
export async function suivreImports(env, maintenant = new Date()) {
  if (!(await reglageActif(env, "automations_actives"))) return 0;
  const { results } = await env.DB.prepare(
    `SELECT reference, data FROM vehicles WHERE removed = 0 AND json_extract(data, '$.importSource.site') = 'openlane'
     AND json_extract(data, '$.importSource.termine') = 0 AND json_extract(data, '$.importSource.finEnchere') < ?`
  ).bind(maintenant.toISOString()).all();
  for (const row of results) {
    const lot = JSON.parse(row.data);
    lot.importSource = { ...lot.importSource, termine: true };
    await env.DB.prepare("UPDATE vehicles SET data = ?, removed = 1, updated_at = ? WHERE reference = ? AND removed = 0")
      .bind(JSON.stringify(lot), maintenant.toISOString(), row.reference).run();
    await journaliser(env, { acteur: "systeme", action: "import.openlane.termine", reference: row.reference, details: { finEnchere: lot.importSource.finEnchere } });
  }
  return results.length;
}
