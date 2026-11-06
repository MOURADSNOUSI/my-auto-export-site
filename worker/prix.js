// Prix estimés (chantier 2) : calcul pur (calculerPrix), lecture des paramètres en base, taux EUR→TND quotidien et
// routes /api/admin/prix. Aucune valeur douanière n'est officielle : tout reste « À VÉRIFIER » par le transitaire.
// Aucun prix n'est montré au public tant que le réglage prix_publics_actifs est faux (chantier 3).
import { ecrireReglageJson, journaliser, reglageActif, reglageJson } from "./reglages.js";

export const CARBURANTS = ["essence", "diesel", "hybride", "hybride_rechargeable", "electrique"];
// Contrôle de vraisemblance du taux (dinars pour 1 euro).
export const TAUX_MIN = 2;
export const TAUX_MAX = 6;
export const URL_BCT = "https://www.bct.gov.tn/bct/siteprod/cours.jsp";
export const URL_SECOURS = "https://open.er-api.com/v6/latest/EUR";
const DROIT_COMMUN = "resident_droit_commun";
const FCR = "fcr_classique";
// Régime résident selon le carburant, s'il est actif ; sinon droit commun.
const REGIME_RESIDENT = { hybride_rechargeable: "resident_phev_lf2026", hybride: "resident_hev_lf2026", electrique: "resident_electrique_lf2026" };
const NOTE_VALEUR = "Valeur en douane estimée = valeur CAF (prix + transport + assurance), Code des douanes art. 23 et 24 selon le "
  + "commentaire LF 2026 InFirst (non officiel). La Douane applique sa propre évaluation : À VÉRIFIER.";
const NOTE_CASCADE = "Droits en cascade (DD sur la valeur, DC sur valeur + DD, TVA sur valeur + DD + DC) : hypothèse À VÉRIFIER. "
  + "Divergence : un exemple de presse calcule le DC sur la valeur CAF seule (sans effet si le DD est à 0 %).";
const NOTE_REDEVANCE = "Redevance de prestations douanières : % du total des droits et taxes, avec un minimum. Commentaire LF 2026 InFirst "
  + "(non officiel) : À VÉRIFIER.";
const NOTE_NON_COMPTES = "Non comptés (montants non trouvés) : taxe de formation et de développement, FODEC, droit de timbre, taxe de "
  + "maîtrise de l'énergie. Carte grise et vignette : montant fixe d'exemple (frais d'immatriculation), À REMPLACER.";

// --- Calcul ---

// Carburant d'un lot (« Essence », « Hybride rechargeable », « Électrique »…) vers le code de la grille, null si inconnu.
export function normaliserCarburant(fuel) {
  const t = String(fuel ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!t) return null;
  if (/rechargeable|plug|phev/.test(t)) return "hybride_rechargeable";
  if (/hybrid|\bhev\b/.test(t)) return "hybride";
  if (/electri|^b?ev$/.test(t)) return "electrique";
  if (/diesel|gazole|gasoil/.test(t)) return "diesel";
  if (/essence|petrol|gasoline|benzin/.test(t)) return "essence";
  return null;
}

// Nombre positif ou nul lu dans un paramètre texte, null si vide ou invalide.
function nombre(valeur) {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  const n = Number(valeur);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Taux manuel s'il est actif, sinon automatique, multiplié par (1 + marge). null sans taux : aucun taux par défaut.
export function tauxApplique(valeurs) {
  const manuel = valeurs.taux_manuel_actif === "true";
  const base = nombre(manuel ? valeurs.taux_manuel : valeurs.taux_auto);
  if (!base) return null;
  const margePct = nombre(valeurs.marge_change_pct) ?? 0;
  return {
    valeur: base * (1 + margePct / 100), base, margePct, manuel,
    date: manuel ? null : valeurs.taux_auto_date || null,
    source: manuel ? "Taux manuel (administrateur)" : valeurs.taux_auto_source || null
  };
}

// Âge en années pleines depuis la première immatriculation (AAAA-MM-JJ), sinon différence d'années civiles.
function ageAns(vehicule, aujourdhui) {
  const [a, m, j] = aujourdhui.split("-").map(Number);
  const date = String(vehicule.premiereImmatriculation ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [ya, ym, yj] = date.split("-").map(Number);
    return a - ya - (m < ym || (m === ym && j < yj) ? 1 : 0);
  }
  const annee = Number(vehicule.year);
  return Number.isInteger(annee) && annee > 1900 ? a - annee : null;
}

function motifNonEligible(regles, { age, cylindree, carburant }) {
  if (!regles) return "Règles d'éligibilité absentes.";
  if (age === null) return "Année ou date de première immatriculation inconnue.";
  if (Number.isFinite(regles.age_max_ans) && age > regles.age_max_ans) return `Véhicule de ${age} ans : ${regles.age_max_ans} ans au plus.`;
  if (Number.isFinite(regles.cylindree_max_cc) && cylindree > regles.cylindree_max_cc) {
    return `Cylindrée de ${cylindree} cm³ : ${regles.cylindree_max_cc} cm³ au plus.`;
  }
  if (Array.isArray(regles.carburants_admis) && !regles.carburants_admis.includes(carburant)) return `Carburant non admis : ${carburant}.`;
  return null;
}

// Ligne de la grille du régime pour ce carburant et cette cylindrée ; la ligne du carburant passe avant « * ».
function ligneGrille(grille, regime, carburant, cylindree) {
  const lignes = grille.filter((l) => l.regime === regime && (l.carburant === carburant || l.carburant === "*")
    && cylindree >= l.cylindree_min && (l.cylindree_max === null || l.cylindree_max === undefined || cylindree <= l.cylindree_max));
  return lignes.find((l) => l.carburant === carburant) || lignes[0] || null;
}

// Droits en cascade, chaque montant arrondi au dinar avant l'étape suivante.
function droits(valeur, ligne) {
  const dd = Math.round(valeur * ligne.droits_douane_pct / 100);
  const dc = Math.round((valeur + dd) * ligne.droit_consommation_pct / 100);
  const tva = Math.round((valeur + dd + dc) * ligne.tva_pct / 100);
  return { dd, dc, tva };
}

// Fonction pure : ne lit ni n'écrit la base. parametres = { valeurs: {cle: texte}, regimes, grille,
// eligibilite: { resident, fcr }, aujourdhui: "AAAA-MM-JJ" } (voir lireParametresPrix).
// vehicule = { prixEur, transportEur?, year? ou premiereImmatriculation?, engineCc, fuel }.
// Redevance douanière = max(total des droits et taxes payés × %, minimum), hors assiette de la TVA.
// Arrondis : chaque ligne du détail est arrondie à l'entier (TND ou EUR) et chaque total est la somme des lignes.
export function calculerPrix(vehicule, parametres) {
  const v = parametres.valeurs || {};
  const sortie = {
    prixResidentTnd: null, prixTreEur: null, dedouanementFcrEstimeTnd: null, regimeResident: null,
    motifNonEligibleResident: null, motifNonEligibleFcr: null, detail: [],
    taux: { valeur: null, date: null, source: null, manuel: false }, avertissements: []
  };
  const sansPrix = (motif) => {
    sortie.motifNonEligibleResident = sortie.motifNonEligibleFcr = motif;
    sortie.avertissements.push(motif);
    return sortie;
  };
  const taux = tauxApplique(v);
  if (!taux) return sansPrix("Aucun taux EUR→TND disponible (ni automatique, ni manuel actif) : pas de prix.");
  sortie.taux = { valeur: taux.valeur, date: taux.date, source: taux.source, manuel: taux.manuel, base: taux.base, margePct: taux.margePct };

  const prixEur = nombre(vehicule.prixEur);
  if (!prixEur) return sansPrix("Prix d'achat en EUR manquant.");
  const transportSaisi = vehicule.transportEur !== undefined && vehicule.transportEur !== null && vehicule.transportEur !== "";
  const transportEur = nombre(transportSaisi ? vehicule.transportEur : v.transport_defaut_eur);
  if (transportEur === null) return sansPrix("Transport inconnu (ni saisi, ni valeur par défaut).");
  const carburant = normaliserCarburant(vehicule.fuel);
  if (!carburant) return sansPrix(`Carburant inconnu : ${String(vehicule.fuel ?? "").slice(0, 40) || "non renseigné"}.`);
  const cylindree = Math.round(nombre(vehicule.engineCc) ?? 0); // 0 accepté pour un électrique
  if (carburant !== "electrique" && !cylindree) return sansPrix("Cylindrée manquante.");
  const age = ageAns(vehicule, parametres.aujourdhui);

  const manquants = [];
  const param = (cle) => {
    const n = nombre(v[cle]);
    if (n === null) manquants.push(cle);
    return n ?? 0;
  };
  const transitaire = Math.round(param("frais_transitaire_tnd"));
  const port = Math.round(param("frais_port_tnd"));
  const immatriculation = param("frais_immatriculation_tnd");
  const commissionPct = param("commission_pct");
  const commissionFixe = param("commission_fixe_tnd");
  const assurancePct = param("assurance_transport_pct");
  const redevancePct = param("redevance_douane_pct");
  const redevanceMin = param("redevance_douane_min_tnd");
  const redevance = (droitsPayes) => Math.max(Math.round(droitsPayes * redevancePct / 100), Math.round(redevanceMin));

  const ligne = (libelle, montant, devise, note = "") => sortie.detail.push({ libelle, montant, devise, note });
  const regimes = parametres.regimes || [];
  const regimeActif = (code, public_) => regimes.find((r) => r.code === code && r.public === public_ && r.actif) || null;
  const utilises = [];
  const contexte = { age, cylindree, carburant };
  // Valeur en douane (CAF) commune aux deux calculs, en TND : assurance en % de (prix + transport).
  const valeurTnd = Math.round((prixEur + transportEur) * (1 + assurancePct / 100) * taux.valeur);

  // Résident : régime selon le carburant, puis éligibilité résident.
  sortie.motifNonEligibleResident = motifNonEligible(parametres.eligibilite?.resident, contexte);
  if (!sortie.motifNonEligibleResident) {
    const regime = regimeActif(REGIME_RESIDENT[carburant], "resident") || regimeActif(DROIT_COMMUN, "resident");
    const grille = regime && ligneGrille(parametres.grille || [], regime.code, carburant, cylindree);
    if (!regime) sortie.motifNonEligibleResident = "Aucun régime résident actif.";
    else if (!grille) sortie.motifNonEligibleResident = `Aucune ligne de grille ${regime.code} pour ${carburant} ${cylindree} cm³.`;
    else {
      utilises.push(regime);
      sortie.regimeResident = regime.code;
      const { dd, dc, tva } = droits(valeurTnd, grille);
      const immat = Math.round(immatriculation * (1 - grille.reduction_immatriculation_pct / 100));
      const redevanceResident = redevance(dd + dc + tva);
      // Commission : pourcentage du prix d'achat du véhicule (EUR, hors transport et taxes) + montant fixe.
      const commission = Math.round(prixEur * commissionPct / 100 * taux.valeur + commissionFixe);
      ligne(`Résident : valeur en douane estimée (CAF, assurance ${assurancePct} %)`, valeurTnd, "TND", NOTE_VALEUR);
      ligne(`Résident : droits de douane (${grille.droits_douane_pct} %)`, dd, "TND", grille.note);
      ligne(`Résident : droit de consommation (${grille.droit_consommation_pct} %)`, dc, "TND", NOTE_CASCADE);
      ligne(`Résident : TVA (${grille.tva_pct} %)`, tva, "TND", NOTE_CASCADE);
      ligne(`Résident : redevance douanière (${redevancePct} %, min. ${redevanceMin} TND)`, redevanceResident, "TND", NOTE_REDEVANCE);
      ligne("Résident : frais de transitaire", transitaire, "TND");
      ligne("Résident : frais de port", port, "TND");
      ligne(`Résident : immatriculation${grille.reduction_immatriculation_pct ? ` (-${grille.reduction_immatriculation_pct} %)` : ""}`, immat, "TND");
      ligne(`Résident : commission (${commissionPct} % du prix d'achat + ${commissionFixe} TND)`, commission, "TND");
      sortie.prixResidentTnd = valeurTnd + dd + dc + tva + redevanceResident + transitaire + port + immat + commission;
    }
  }

  // TRE : prix en EUR (véhicule + transport + commission), puis dédouanement FCR estimé en TND.
  const commissionEur = Math.round(prixEur * commissionPct / 100 + commissionFixe / taux.valeur);
  ligne("TRE : véhicule", Math.round(prixEur), "EUR");
  ligne("TRE : transport", Math.round(transportEur), "EUR");
  ligne(`TRE : commission (${commissionPct} % du prix d'achat + ${commissionFixe} TND convertis)`, commissionEur, "EUR");
  sortie.prixTreEur = Math.round(prixEur) + Math.round(transportEur) + commissionEur;

  sortie.motifNonEligibleFcr = motifNonEligible(parametres.eligibilite?.fcr, contexte);
  if (!sortie.motifNonEligibleFcr) {
    const regime = regimeActif(FCR, "tre");
    const grille = regime && ligneGrille(parametres.grille || [], FCR, carburant, cylindree);
    if (!regime) sortie.motifNonEligibleFcr = "Régime FCR inactif.";
    else if (!grille) sortie.motifNonEligibleFcr = `Aucune ligne de grille FCR pour ${carburant} ${cylindree} cm³.`;
    else {
      utilises.push(regime);
      const { dd, dc, tva } = droits(valeurTnd, grille);
      const part = Math.round((dd + dc + tva) * grille.part_payee_pct / 100);
      // Redevance sur la part effectivement payée : hypothèse À VÉRIFIER.
      const redevanceFcr = redevance(part);
      ligne(`FCR : valeur en douane estimée (CAF, assurance ${assurancePct} %)`, valeurTnd, "TND", NOTE_VALEUR);
      ligne("FCR : droits et taxes dus (DD + DC + TVA)", dd + dc + tva, "TND", `${NOTE_CASCADE} ${grille.note}`);
      ligne(`FCR : part payée (${grille.part_payee_pct} %)`, part, "TND", grille.note);
      ligne(`FCR : redevance douanière (${redevancePct} % de la part payée, min. ${redevanceMin} TND)`, redevanceFcr, "TND", `${NOTE_REDEVANCE} Assiette en FCR : À VÉRIFIER.`);
      ligne("FCR : frais de transitaire", transitaire, "TND");
      ligne("FCR : frais de port", port, "TND");
      sortie.dedouanementFcrEstimeTnd = part + redevanceFcr + transitaire + port;
    }
  }

  if (sortie.prixResidentTnd !== null || sortie.dedouanementFcrEstimeTnd !== null) sortie.avertissements.push(NOTE_VALEUR, NOTE_CASCADE, NOTE_NON_COMPTES);
  const nonVerifies = utilises.filter((r) => r.statut_verification !== "verifie").map((r) => r.code);
  if (nonVerifies.length) sortie.avertissements.push(`Valeurs À VÉRIFIER par le transitaire (régimes non vérifiés : ${nonVerifies.join(", ")}).`);
  if (manquants.length) sortie.avertissements.push(`Paramètres manquants, comptés 0 : ${manquants.join(", ")}.`);
  if (taux.manuel) sortie.avertissements.push("Taux manuel appliqué.");
  return sortie;
}

// --- Base ---

export async function lireParametresPrix(env) {
  const [parametres, regimes, grille] = await env.DB.batch([
    env.DB.prepare("SELECT cle, valeur, unite, note, mis_a_jour, mis_a_jour_par FROM parametres_prix ORDER BY cle"),
    env.DB.prepare("SELECT code, libelle, public, actif, statut_verification, source, note FROM regimes_douaniers ORDER BY public, code"),
    env.DB.prepare("SELECT * FROM grille_droits ORDER BY regime, carburant, cylindree_min")
  ]);
  const [resident, fcr] = await Promise.all([reglageJson(env, "eligibilite_resident"), reglageJson(env, "eligibilite_fcr")]);
  return {
    lignesParametres: parametres.results,
    valeurs: Object.fromEntries(parametres.results.map((p) => [p.cle, p.valeur])),
    regimes: regimes.results.map((r) => ({ ...r, actif: r.actif === 1 })),
    grille: grille.results,
    eligibilite: { resident, fcr },
    aujourdhui: new Date().toISOString().slice(0, 10)
  };
}

// --- Taux quotidien ---

// Cours EUR de la page BCT : une ligne du texte ressemble à « EURO EUR 1 3,3834 » (unité, virgule décimale).
// La première valeur après l'unité est retenue (colonne à vérifier). null si la page n'a pas de ligne EUR.
export function lireTauxBct(texte) {
  const brut = String(texte ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ");
  const trouve = brut.match(/\bEUR\s+(\d+)\s+(\d+(?:[.,]\d+)?)/);
  if (!trouve) return null;
  const unite = Number(trouve[1]);
  const cours = Number(trouve[2].replace(",", "."));
  return unite > 0 && Number.isFinite(cours) ? cours / unite : null;
}

export function tauxVraisemblable(taux) {
  return Number.isFinite(taux) && taux >= TAUX_MIN && taux <= TAUX_MAX;
}

// Page BCT en ISO-8859-1 : chaque octet est un caractère.
function latin1(buffer) {
  const octets = new Uint8Array(buffer);
  let texte = "";
  for (let i = 0; i < octets.length; i += 8192) texte += String.fromCharCode(...octets.subarray(i, i + 8192));
  return texte;
}

// Passage quotidien (cron 0 6 * * *) : BCT, sinon ExchangeRate-API. En cas d'échec des deux, le dernier taux est gardé.
// Chaque passage est journalisé (acteur systeme). Adresses surchargeables par PRIX_URL_BCT et PRIX_URL_SECOURS.
export async function mettreAJourTaux(env) {
  const sources = [
    { source: "BCT", url: env.PRIX_URL_BCT || URL_BCT, lire: async (r) => lireTauxBct(latin1(await r.arrayBuffer())) },
    { source: "ExchangeRate-API", url: env.PRIX_URL_SECOURS || URL_SECOURS, lire: async (r) => Number((await r.json())?.rates?.TND) }
  ];
  const echecs = [];
  for (const { source, url, lire } of sources) {
    let taux;
    try {
      const reponse = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      taux = await lire(reponse);
    } catch (error) {
      echecs.push(`${source} : ${String(error?.message || "échec").slice(0, 120)}`);
      continue;
    }
    if (!tauxVraisemblable(taux)) {
      echecs.push(`${source} : valeur rejetée (${taux})`);
      continue;
    }
    const valeur = String(Math.round(taux * 10_000) / 10_000);
    const maintenant = new Date().toISOString();
    const ecrire = (cle, val) => env.DB.prepare("UPDATE parametres_prix SET valeur = ?, mis_a_jour = ?, mis_a_jour_par = NULL WHERE cle = ?").bind(val, maintenant, cle);
    await env.DB.batch([ecrire("taux_auto", valeur), ecrire("taux_auto_date", maintenant), ecrire("taux_auto_source", source)]);
    await journaliser(env, { acteur: "systeme", action: "prix.taux_auto", reference: "taux_auto", details: { source, valeur, echecs }, resultat: "ok" });
    return { ok: true, source, valeur: Number(valeur) };
  }
  await journaliser(env, { acteur: "systeme", action: "prix.taux_auto", reference: "taux_auto", details: { echecs }, resultat: "erreur" });
  return { ok: false, echecs };
}

// --- Administration (/api/admin/prix) ---

// Paramètres modifiables et bornes. Les taux ont leur propre route (taux manuel) ou sont automatiques.
const PARAMETRES_MODIFIABLES = {
  marge_change_pct: [0, 20], transport_defaut_eur: [0, 100_000], frais_transitaire_tnd: [0, 1_000_000],
  frais_port_tnd: [0, 1_000_000], frais_immatriculation_tnd: [0, 1_000_000], commission_pct: [0, 100], commission_fixe_tnd: [0, 1_000_000],
  assurance_transport_pct: [0, 10], redevance_douane_pct: [0, 20], redevance_douane_min_tnd: [0, 10_000]
};
// Bornes des pourcentages de la grille (le droit de consommation peut dépasser 100 %).
const BORNES_GRILLE = {
  droits_douane_pct: 100, droit_consommation_pct: 300, tva_pct: 100, reduction_immatriculation_pct: 100, part_payee_pct: 100
};

async function etatPrix(env) {
  const p = await lireParametresPrix(env);
  return {
    parametres: p.lignesParametres.map((l) => ({ cle: l.cle, valeur: l.valeur, unite: l.unite, note: l.note, misAJour: l.mis_a_jour })),
    regimes: p.regimes, grille: p.grille, eligibilite: p.eligibilite,
    taux: tauxApplique(p.valeurs),
    prixPublicsActifs: await reglageActif(env, "prix_publics_actifs"),
    aVerifier: p.regimes.some((r) => r.actif && r.statut_verification !== "verifie"),
    sourcesTaux: { principale: URL_BCT, secours: URL_SECOURS }
  };
}

export async function routeAdminPrix(request, env, path, method, user, { json, ApiError, lireJson }) {
  const borne = (valeur, min, max, nom, entier = false) => {
    if (typeof valeur !== "number" || !Number.isFinite(valeur) || valeur < min || valeur > max || (entier && !Number.isInteger(valeur))) {
      throw new ApiError(400, `${nom} : ${entier ? "nombre entier" : "nombre"} entre ${min} et ${max} attendu.`);
    }
    return valeur;
  };
  const note = (valeur) => {
    if (typeof valeur !== "string" || !valeur.trim() || valeur.length > 1000) throw new ApiError(400, "Note obligatoire (source et mention À VÉRIFIER), 1 000 caractères au plus.");
    return valeur.trim();
  };
  const maintenant = new Date().toISOString();
  const ecrireParametre = (cle, valeur) => env.DB.prepare("UPDATE parametres_prix SET valeur = ?, mis_a_jour = ?, mis_a_jour_par = ? WHERE cle = ?")
    .bind(valeur, maintenant, user.id, cle);

  if (path === "/api/admin/prix" && method === "GET") return json(await etatPrix(env));

  const parametre = path.match(/^\/api\/admin\/prix\/parametres\/([a-z_]{1,64})$/);
  if (parametre && method === "PUT") {
    const bornes = PARAMETRES_MODIFIABLES[parametre[1]];
    if (!bornes) throw new ApiError(404, "Paramètre inconnu ou non modifiable ici.");
    const { valeur } = await lireJson(request);
    await ecrireParametre(parametre[1], String(borne(valeur, ...bornes, parametre[1]))).run();
    return json(await etatPrix(env));
  }

  if (path === "/api/admin/prix/taux-manuel" && method === "PUT") {
    const { valeur, actif } = await lireJson(request);
    if (typeof actif !== "boolean") throw new ApiError(400, "actif : vrai ou faux attendu.");
    if (valeur !== null || actif) borne(valeur, TAUX_MIN, TAUX_MAX, "Taux manuel");
    await env.DB.batch([ecrireParametre("taux_manuel", valeur === null ? "" : String(valeur)), ecrireParametre("taux_manuel_actif", String(actif))]);
    return json(await etatPrix(env));
  }

  const ligne = path.match(/^\/api\/admin\/prix\/grille\/(\d{1,9})$/);
  if (ligne && method === "PUT") {
    const body = await lireJson(request);
    const min = borne(body.cylindree_min, 0, 20_000, "cylindree_min", true);
    const max = body.cylindree_max === null ? null : borne(body.cylindree_max, min, 20_000, "cylindree_max", true);
    const valeurs = Object.entries(BORNES_GRILLE).map(([cle, plafond]) => borne(body[cle], 0, plafond, cle));
    const resultat = await env.DB.prepare(
      `UPDATE grille_droits SET cylindree_min = ?, cylindree_max = ?, droits_douane_pct = ?, droit_consommation_pct = ?, tva_pct = ?,
       reduction_immatriculation_pct = ?, part_payee_pct = ?, note = ? WHERE id = ?`
    ).bind(min, max, ...valeurs, note(body.note), Number(ligne[1])).run();
    if (!resultat.meta.changes) throw new ApiError(404, "Ligne de grille introuvable.");
    return json(await etatPrix(env));
  }

  const regime = path.match(/^\/api\/admin\/prix\/regimes\/([a-z0-9_]{1,64})$/);
  if (regime && method === "PUT") {
    const { actif, statut_verification: statut } = await lireJson(request);
    if (actif === undefined && statut === undefined) throw new ApiError(400, "actif ou statut_verification attendu.");
    if (actif !== undefined && typeof actif !== "boolean") throw new ApiError(400, "actif : vrai ou faux attendu.");
    if (statut !== undefined && !["a_verifier", "verifie"].includes(statut)) throw new ApiError(400, "statut_verification : a_verifier ou verifie.");
    const resultat = await env.DB.prepare(
      "UPDATE regimes_douaniers SET actif = COALESCE(?, actif), statut_verification = COALESCE(?, statut_verification) WHERE code = ?"
    ).bind(actif === undefined ? null : Number(actif), statut ?? null, regime[1]).run();
    if (!resultat.meta.changes) throw new ApiError(404, "Régime inconnu.");
    return json(await etatPrix(env));
  }

  const eligibilite = path.match(/^\/api\/admin\/prix\/eligibilite\/(resident|fcr)$/);
  if (eligibilite && method === "PUT") {
    const body = await lireJson(request);
    const carburants = body.carburants_admis;
    if (!Array.isArray(carburants) || !carburants.length || carburants.some((c) => !CARBURANTS.includes(c)) || new Set(carburants).size !== carburants.length) {
      throw new ApiError(400, `carburants_admis : liste parmi ${CARBURANTS.join(", ")}.`);
    }
    await ecrireReglageJson(env, `eligibilite_${eligibilite[1]}`, {
      age_max_ans: borne(body.age_max_ans, 0, 50, "age_max_ans", true),
      cylindree_max_cc: body.cylindree_max_cc === null ? null : borne(body.cylindree_max_cc, 1, 20_000, "cylindree_max_cc", true),
      carburants_admis: carburants, note: note(body.note)
    }, user.id);
    return json(await etatPrix(env));
  }

  if (path === "/api/admin/prix/simulation" && method === "POST") {
    const body = await lireJson(request);
    const facultatif = (valeur, min, max, nom, entier) => (valeur === null || valeur === undefined || valeur === "" ? null : borne(valeur, min, max, nom, entier));
    const date = body.premiereImmatriculation;
    if (date !== undefined && date !== null && date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, "premiereImmatriculation : date AAAA-MM-JJ attendue.");
    if (typeof body.fuel !== "string" || body.fuel.length > 40) throw new ApiError(400, "fuel : carburant attendu.");
    const vehicule = {
      prixEur: borne(body.prixEur, 1, 10_000_000, "prixEur"),
      transportEur: facultatif(body.transportEur, 0, 100_000, "transportEur"),
      year: facultatif(body.year, 1950, 2100, "year", true),
      premiereImmatriculation: date || null,
      engineCc: facultatif(body.engineCc, 0, 20_000, "engineCc", true),
      fuel: body.fuel
    };
    return json(calculerPrix(vehicule, await lireParametresPrix(env)));
  }
  throw new ApiError(404, "Route inconnue.");
}
