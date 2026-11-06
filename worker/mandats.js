// Demandes d'achat sur mandat (chantier 4) : le client choisit un véhicule de M&Y, fixe un prix maximum et accepte le
// mandat ; l'acompte n'est pas encaissé en ligne, l'administration fait avancer le statut à la main (ou via le MCP).
// Les tables d'enchères et d'offres ne sont pas touchées.
import { calculerPrix, lireParametresPrix } from "./prix.js";
import { lireReglagesSite } from "./reglages.js";
import { fr, t } from "./textes.js";

export const STATUTS = ["demande", "eligibilite_verifiee", "acompte_recu", "achat_en_cours", "achete", "non_obtenu", "livre", "annule"];
// Passages autorisés. non_obtenu, livre et annule sont définitifs.
export const TRANSITIONS = {
  demande: ["eligibilite_verifiee", "annule"],
  eligibilite_verifiee: ["acompte_recu", "annule"],
  acompte_recu: ["achat_en_cours", "annule"],
  achat_en_cours: ["achete", "non_obtenu", "annule"],
  achete: ["livre"],
  non_obtenu: [],
  livre: [],
  annule: []
};
// Avant le versement de l'acompte, le client peut annuler lui-même sa demande.
export const ANNULABLE_PAR_CLIENT = ["demande", "eligibilite_verifiee"];
const MAX_EN_COURS = 10;
const PRIX_MAX = 10000000;

export function transitionAutorisee(de, vers) {
  return Boolean(TRANSITIONS[de]?.includes(vers));
}

// Véhicules ouverts au mandat : ceux de M&Y (pas les annonces de vendeurs ni celles dont un vendeur est affecté),
// en ligne et non vendus, quand le réglage mandats_actifs est vrai. Sinon le site garde ses propositions d'offre.
export function vehiculeMandat(item, actifs) {
  if (!actifs || !item || item.removed || item.sellerUnavailable || item.offerOwnerAssigned) return false;
  const lot = item.lot || {};
  if (lot.marketplace || String(lot.reference || "").startsWith("SV-")) return false;
  return !["sold", "archived", "inactive"].includes(lot.status);
}

// Champs du formulaire, contrôlés et normalisés. Renvoie { demande } ou { erreur }.
export function validerDemande(body) {
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(reference)) return { erreur: "Référence du véhicule invalide." };
  if (!["resident", "tre"].includes(body.public)) return { erreur: "Indiquez si vous habitez en Tunisie ou à l'étranger." };
  if (!Number.isSafeInteger(body.prixMax) || body.prixMax <= 0 || body.prixMax > PRIX_MAX) return { erreur: "Prix maximum invalide : montant entier attendu." };
  const telephone = typeof body.telephone === "string" ? body.telephone.replace(/[\s.()-]/g, "") : "";
  if (!/^\+?[0-9]{8,15}$/.test(telephone)) return { erreur: "Numéro de téléphone invalide, par exemple +21612345678." };
  if (body.accepte !== true) return { erreur: "Acceptez le mandat, les CGV et les conditions de l'acompte pour envoyer votre demande." };
  const reponses = {};
  if (body.public === "tre") {
    const pays = typeof body.paysResidence === "string" ? body.paysResidence.trim() : "";
    if (!pays || pays.length > 60) return { erreur: "Indiquez votre pays de résidence." };
    if (typeof body.fcrDejaUtilise !== "boolean") return { erreur: "Indiquez si vous avez déjà bénéficié du régime FCR ces 10 dernières années." };
    Object.assign(reponses, { paysResidence: pays, fcrDejaUtilise: body.fcrDejaUtilise });
  }
  return { demande: { reference, public: body.public, devise: body.public === "resident" ? "TND" : "EUR", prixMax: body.prixMax, telephone, reponses } };
}

// Motif d'éligibilité calculé avec les règles de /admin-prix (null : rien à signaler ou calcul impossible).
function motifEligibilite(lot, publicChoisi, parametres) {
  if (!parametres) return null;
  const r = calculerPrix({ prixEur: lot.prixEur, transportEur: lot.transportEur, year: lot.year, premiereImmatriculation: lot.premiereImmatriculation, engineCc: lot.engineCc, fuel: lot.fuel }, parametres);
  return publicChoisi === "resident" ? r.motifNonEligibleResident : r.motifNonEligibleFcr;
}

const titreLot = (lot) => [lot.make, lot.model, lot.trim].filter(Boolean).join(" ") || lot.reference;
const maintenant = () => new Date().toISOString();

// Textes du formulaire et du suivi, servis aux scripts du navigateur (fichier de traductions, règle 9). Modèles bruts :
// le navigateur remplace lui-même {devise}.
function libelles() {
  return Object.fromEntries(Object.entries(fr).filter(([cle]) => cle.startsWith("mandat_") || cle.startsWith("statut_")));
}

async function vehicule(request, env, catalogueComplet, reference) {
  if (!(await lireReglagesSite(env)).mandats_actifs) return null;
  return (await catalogueComplet(request, env)).find((item) => item.lot.reference === reference && vehiculeMandat(item, true)) || null;
}

async function evenements(env, ids) {
  if (!ids.length) return new Map();
  const { results } = await env.DB.prepare(`SELECT mandat_id, de, vers, acteur, note, le FROM mandat_evenements WHERE mandat_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`).bind(...ids).all();
  const parMandat = new Map();
  for (const e of results) parMandat.set(e.mandat_id, [...(parMandat.get(e.mandat_id) || []), { de: e.de, vers: e.vers, acteur: e.acteur, note: e.note, le: e.le }]);
  return parMandat;
}

function formater(row, historique, titres, admin) {
  const mandat = {
    id: row.id, reference: row.reference, titre: titres.get(row.reference) || row.reference, public: row.public, devise: row.devise,
    prixMax: row.prix_max, acompte: row.acompte, statut: row.statut, creeLe: row.cree_le, misAJour: row.mis_a_jour,
    annulable: ANNULABLE_PAR_CLIENT.includes(row.statut),
    evenements: (historique.get(row.id) || []).map(({ de, vers, le }) => ({ de, vers, le }))
  };
  if (!admin) return mandat;
  return {
    ...mandat, telephone: row.telephone, reponses: JSON.parse(row.reponses || "{}"), eligibiliteAuto: row.eligibilite_auto, noteAdmin: row.note_admin,
    client: { id: row.user_id, nom: row.nom, email: row.email }, suivants: TRANSITIONS[row.statut], evenements: historique.get(row.id) || []
  };
}

async function titresCatalogue(request, env, catalogueComplet) {
  return new Map((await catalogueComplet(request, env)).map((item) => [item.lot.reference, titreLot(item.lot)]));
}

// Liste pour l'administration et le MCP (données personnelles du client incluses : réservé aux administrateurs).
export async function listerMandats(request, env, catalogueComplet, statut) {
  if (statut !== undefined && !STATUTS.includes(statut)) throw Object.assign(new Error(`Statut inconnu : ${statut}.`), { status: 400 });
  const { results } = await env.DB.prepare(
    `SELECT m.*, u.name AS nom, u.email FROM mandats m JOIN users u ON u.id = m.user_id ${statut ? "WHERE m.statut = ?" : ""} ORDER BY m.id DESC LIMIT 200`
  ).bind(...(statut ? [statut] : [])).all();
  const [historique, titres] = await Promise.all([evenements(env, results.map((r) => r.id)), titresCatalogue(request, env, catalogueComplet)]);
  return results.map((row) => formater(row, historique, titres, true));
}

// Changement de statut, d'acompte ou de note par l'administration (admin, mcp ou agent). Le passage est vérifié et
// l'écriture ne réussit que si le statut n'a pas changé entre-temps.
export async function changerMandat(env, { id, statut, acompte, note, acteur, acteurId = null }) {
  const erreur = (status, message) => Object.assign(new Error(message), { status });
  if (!Number.isSafeInteger(id) || id <= 0) throw erreur(400, "Numéro de mandat invalide.");
  const row = await env.DB.prepare("SELECT * FROM mandats WHERE id = ?").bind(id).first();
  if (!row) throw erreur(404, "Mandat introuvable.");
  if (statut !== undefined && !STATUTS.includes(statut)) throw erreur(400, `Statut inconnu : ${statut}.`);
  if (acompte !== undefined && acompte !== null && (!Number.isSafeInteger(acompte) || acompte <= 0 || acompte > PRIX_MAX)) throw erreur(400, "Acompte invalide : montant entier attendu.");
  if (note !== undefined && (typeof note !== "string" || note.length > 2000)) throw erreur(400, "Note de 2 000 caractères au plus.");
  const vers = statut ?? row.statut;
  if (vers !== row.statut && !transitionAutorisee(row.statut, vers)) throw erreur(409, `Passage de « ${t(`statut_${row.statut}`)} » à « ${t(`statut_${vers}`)} » impossible.`);
  if (acompte !== undefined && !["demande", "eligibilite_verifiee"].includes(row.statut)) throw erreur(409, "L'acompte ne se modifie plus une fois reçu.");
  let montant = acompte === undefined ? row.acompte : acompte;
  if (vers === "eligibilite_verifiee" && !montant) {
    const site = await lireReglagesSite(env);
    montant = (row.devise === "TND" ? site.acompte_defaut_tnd : site.acompte_defaut_eur) || null;
    if (!montant) throw erreur(400, "Indique le montant de l'acompte à demander au client.");
  }
  const le = maintenant();
  const resultat = await env.DB.prepare("UPDATE mandats SET statut = ?, acompte = ?, note_admin = ?, mis_a_jour = ? WHERE id = ? AND statut = ?")
    .bind(vers, montant, note === undefined ? row.note_admin : note.trim(), le, id, row.statut).run();
  if (!resultat.meta.changes) throw erreur(409, "Le mandat vient d'être modifié : recharge la liste.");
  if (vers !== row.statut) {
    await env.DB.prepare("INSERT INTO mandat_evenements (mandat_id, de, vers, acteur, acteur_id, note, le) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, row.statut, vers, acteur, acteurId, "", le).run();
  }
  return { id, statut: vers, acompte: montant };
}

export const estRouteMandats = (path) => path === "/api/mandats" || path.startsWith("/api/mandats/");

// Routes du client : formulaire (public), demande, suivi et annulation (connecté).
export async function routeMandats(request, env, url, { json, ApiError, exigerUtilisateur, lireJson, catalogueComplet }) {
  const path = url.pathname;
  const method = request.method;
  const formulaire = path.match(/^\/api\/mandats\/formulaire\/([A-Za-z0-9_-]{1,64})$/);
  if (formulaire && method === "GET") {
    const item = await vehicule(request, env, catalogueComplet, formulaire[1]);
    if (!item) throw new ApiError(404, t("mandat_indisponible"));
    const site = await lireReglagesSite(env);
    return json({
      vehicule: { reference: item.lot.reference, titre: titreLot(item.lot) },
      textes: { mandat: site.texte_mandat, cgv: site.cgv_mandat, acompte: site.conditions_acompte },
      libelles: libelles()
    });
  }
  if (path === "/api/mandats" && method === "GET") {
    const user = await exigerUtilisateur(request, env);
    const { results } = await env.DB.prepare("SELECT * FROM mandats WHERE user_id = ? ORDER BY id DESC").bind(user.id).all();
    const [historique, titres] = await Promise.all([evenements(env, results.map((r) => r.id)), titresCatalogue(request, env, catalogueComplet)]);
    return json({ mandats: results.map((row) => formater(row, historique, titres, false)), libelles: libelles() });
  }
  if (path === "/api/mandats" && method === "POST") {
    const user = await exigerUtilisateur(request, env);
    const { demande, erreur } = validerDemande(await lireJson(request));
    if (erreur) throw new ApiError(400, erreur);
    const item = await vehicule(request, env, catalogueComplet, demande.reference);
    if (!item) throw new ApiError(404, t("mandat_indisponible"));
    const site = await lireReglagesSite(env);
    if (!site.texte_mandat || !site.cgv_mandat || !site.conditions_acompte) throw new ApiError(503, "Les demandes de mandat ne sont pas encore ouvertes.");
    let parametres = null;
    try { parametres = await lireParametresPrix(env); } catch { console.error("mandat_parametres_failed"); }
    const motif = motifEligibilite(item.lot, demande.public, parametres);
    // Règles résident vérifiées seulement quand les prix résidents sont publiés : sinon le motif est transmis à l'admin.
    if (demande.public === "resident" && motif && site.prix_resident_actif) throw new ApiError(400, `${t("prix_reserve_tre")} : ${motif}`);
    const enCours = await env.DB.prepare("SELECT COUNT(*) AS n FROM mandats WHERE user_id = ? AND statut NOT IN ('non_obtenu', 'livre', 'annule')").bind(user.id).first();
    if (enCours.n >= MAX_EN_COURS) throw new ApiError(429, `${MAX_EN_COURS} demandes en cours au plus.`);
    const le = maintenant();
    const textes = JSON.stringify({ mandat: site.texte_mandat, cgv: site.cgv_mandat, acompte: site.conditions_acompte });
    let ligne;
    try {
      ligne = await env.DB.prepare(
        `INSERT INTO mandats (user_id, reference, public, devise, prix_max, telephone, reponses, eligibilite_auto, textes_acceptes, accepte_le, cree_le, mis_a_jour)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      ).bind(user.id, demande.reference, demande.public, demande.devise, demande.prixMax, demande.telephone, JSON.stringify(demande.reponses), motif, textes, le, le, le).first();
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new ApiError(409, t("mandat_deja_en_cours"));
      throw error;
    }
    await env.DB.prepare("INSERT INTO mandat_evenements (mandat_id, de, vers, acteur, acteur_id, le) VALUES (?, '', 'demande', 'client', ?, ?)").bind(ligne.id, user.id, le).run();
    return json({ id: ligne.id, statut: "demande" }, 201);
  }
  const annulation = path.match(/^\/api\/mandats\/(\d{1,12})\/annuler$/);
  if (annulation && method === "POST") {
    const user = await exigerUtilisateur(request, env);
    const row = await env.DB.prepare("SELECT id, statut FROM mandats WHERE id = ? AND user_id = ?").bind(Number(annulation[1]), user.id).first();
    if (!row) throw new ApiError(404, "Mandat introuvable.");
    if (!ANNULABLE_PAR_CLIENT.includes(row.statut)) throw new ApiError(409, t("mandat_annulation_impossible"));
    const le = maintenant();
    const resultat = await env.DB.prepare("UPDATE mandats SET statut = 'annule', mis_a_jour = ? WHERE id = ? AND statut = ?").bind(le, row.id, row.statut).run();
    if (!resultat.meta.changes) throw new ApiError(409, t("mandat_annulation_impossible"));
    await env.DB.prepare("INSERT INTO mandat_evenements (mandat_id, de, vers, acteur, acteur_id, le) VALUES (?, ?, 'annule', 'client', ?, ?)").bind(row.id, row.statut, user.id, le).run();
    return json({ id: row.id, statut: "annule" });
  }
  throw new ApiError(404, "Route inconnue.");
}

// Routes de /admin-mandats (administrateur déjà vérifié et écritures journalisées par routeAdminJournalisee).
export async function routeAdminMandats(request, env, url, user, { json, ApiError, lireJson, catalogueComplet }) {
  const path = url.pathname;
  const enErreurApi = async (action) => {
    try { return await action(); } catch (error) {
      if (error.status) throw new ApiError(error.status, error.message);
      throw error;
    }
  };
  if (path === "/api/admin/mandats" && request.method === "GET") {
    const statut = url.searchParams.get("statut") || undefined;
    return json({ mandats: await enErreurApi(() => listerMandats(request, env, catalogueComplet, statut)), statuts: STATUTS.map((s) => ({ code: s, libelle: t(`statut_${s}`) })) });
  }
  const modification = path.match(/^\/api\/admin\/mandats\/(\d{1,12})$/);
  if (modification && request.method === "PUT") {
    const body = await lireJson(request);
    const resultat = await enErreurApi(() => changerMandat(env, { id: Number(modification[1]), statut: body.statut, acompte: body.acompte, note: body.note, acteur: "admin", acteurId: user.id }));
    return json(resultat);
  }
  throw new ApiError(404, "Route inconnue.");
}
