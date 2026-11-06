// Réglages du site (table reglages) et journal des actions d'écriture (audit_logs, colonnes acteur, details, resultat).

// Clés modifiables depuis /admin, avec leur valeur par défaut si la ligne manque.
export const REGLAGES_INTERRUPTEURS = { automations_actives: true, agent_ecriture_autorisee: false };
// Autres booléens, modifiables dans la rubrique « Site » de /admin (REGLAGES_SITE). prix_publics_actifs : aucun prix
// calculé n'est montré au public tant qu'il est faux ; prix_resident_actif : aucun prix résident tant qu'il est faux.
const AUTRES_BOOLEENS = { prix_publics_actifs: false, prix_resident_actif: false };

// Réglages de la rubrique « Site » (chantier 3) : type et valeur par défaut si la ligne manque (pas de migration).
export const REGLAGES_SITE = {
  whatsapp_numero: { type: "texte", defaut: "" },
  public_par_defaut: { type: "choix", defaut: "tre", choix: ["tre", "resident"] },
  prix_publics_actifs: { type: "booleen", defaut: false },
  prix_resident_actif: { type: "booleen", defaut: false },
  temoignages: { type: "json", defaut: [] }
};
export const FORMAT_WHATSAPP = /^\+?[0-9]{8,15}$/;
const MAX_TEMOIGNAGES = 20;

// Valeurs des réglages du site, en une requête. Une valeur illisible ou d'un mauvais type revient au défaut.
export async function lireReglagesSite(env) {
  const cles = Object.keys(REGLAGES_SITE);
  const { results } = await env.DB.prepare(`SELECT cle, valeur, mis_a_jour, mis_a_jour_par FROM reglages WHERE cle IN (${cles.map(() => "?").join(", ")})`)
    .bind(...cles).all();
  const lignes = new Map(results.map((row) => [row.cle, row]));
  return Object.fromEntries(cles.map((cle) => {
    const ligne = lignes.get(cle);
    let valeur = REGLAGES_SITE[cle].defaut;
    if (ligne) {
      try {
        const lue = REGLAGES_SITE[cle].type === "booleen" ? ligne.valeur === "true" : REGLAGES_SITE[cle].type === "json" ? JSON.parse(ligne.valeur) : ligne.valeur;
        if (!validerReglageSite(cle, lue).erreur) valeur = lue;
      } catch { /* défaut */ }
    }
    return [cle, valeur];
  }));
}

export async function listerReglagesSite(env) {
  const valeurs = await lireReglagesSite(env);
  const { results } = await env.DB.prepare("SELECT cle, mis_a_jour, mis_a_jour_par FROM reglages").all();
  const lignes = new Map(results.map((row) => [row.cle, row]));
  return Object.entries(valeurs).map(([cle, valeur]) => ({
    cle, type: REGLAGES_SITE[cle].type, valeur, misAJour: lignes.get(cle)?.mis_a_jour_par ? lignes.get(cle).mis_a_jour : null
  }));
}

// Valeur à enregistrer (texte de la colonne valeur) ou message d'erreur.
export function validerReglageSite(cle, valeur) {
  const reglage = REGLAGES_SITE[cle];
  if (!reglage) return { erreur: "Réglage inconnu." };
  if (reglage.type === "booleen") return typeof valeur === "boolean" ? { texte: String(valeur) } : { erreur: "Valeur attendue : vrai ou faux." };
  if (reglage.type === "choix") return reglage.choix.includes(valeur) ? { texte: valeur } : { erreur: `Valeur attendue : ${reglage.choix.join(" ou ")}.` };
  if (cle === "whatsapp_numero") {
    if (typeof valeur !== "string") return { erreur: "Numéro attendu en texte." };
    const numero = valeur.replace(/[\s.-]/g, "");
    return numero === "" || FORMAT_WHATSAPP.test(numero) ? { texte: numero } : { erreur: "Numéro au format international attendu, par exemple +21612345678." };
  }
  // temoignages : liste de { nom, texte, vehicule? }, sans interface de saisie pour l'instant.
  const texteValide = (v, max, obligatoire) => (v === undefined && !obligatoire) || (typeof v === "string" && v.trim().length > 0 && v.length <= max);
  if (!Array.isArray(valeur) || valeur.length > MAX_TEMOIGNAGES
    || valeur.some((x) => !x || typeof x !== "object" || !texteValide(x.nom, 80, true) || !texteValide(x.texte, 600, true) || !texteValide(x.vehicule, 120, false))) {
    return { erreur: `Liste de ${MAX_TEMOIGNAGES} témoignages au plus : { nom, texte, vehicule facultatif }.` };
  }
  return { texte: JSON.stringify(valeur.map(({ nom, texte, vehicule }) => ({ nom: nom.trim(), texte: texte.trim(), ...(vehicule ? { vehicule: vehicule.trim() } : {}) }))) };
}

export async function ecrireReglageSite(env, cle, texte, userId) {
  await ecrireReglage(env, cle, texte, userId);
}

export async function reglageActif(env, cle) {
  const ligne = await env.DB.prepare("SELECT valeur FROM reglages WHERE cle = ?").bind(cle).first();
  return ligne ? ligne.valeur === "true" : (REGLAGES_INTERRUPTEURS[cle] ?? AUTRES_BOOLEENS[cle]) === true;
}

// Valeur JSON d'un réglage (règles d'éligibilité des prix estimés), null si la ligne manque ou est illisible :
// pas de valeur par défaut.
export async function reglageJson(env, cle) {
  const ligne = await env.DB.prepare("SELECT valeur FROM reglages WHERE cle = ?").bind(cle).first();
  try {
    return ligne ? JSON.parse(ligne.valeur) : null;
  } catch {
    return null;
  }
}

export async function ecrireReglageJson(env, cle, valeur, userId) {
  await ecrireReglage(env, cle, JSON.stringify(valeur), userId);
}

export async function listerReglages(env) {
  const { results } = await env.DB.prepare("SELECT cle, valeur, mis_a_jour, mis_a_jour_par FROM reglages ORDER BY cle").all();
  const lignes = new Map(results.map((row) => [row.cle, row]));
  return Object.entries(REGLAGES_INTERRUPTEURS).map(([cle, defaut]) => ({
    // Date affichée seulement après une modification par un administrateur (pas pour la valeur initiale de la migration).
    cle, valeur: lignes.has(cle) ? lignes.get(cle).valeur === "true" : defaut,
    misAJour: lignes.get(cle)?.mis_a_jour_par ? lignes.get(cle).mis_a_jour : null
  }));
}

export async function ecrireInterrupteur(env, cle, actif, userId) {
  await ecrireReglage(env, cle, actif ? "true" : "false", userId);
}

async function ecrireReglage(env, cle, valeur, userId) {
  await env.DB.prepare(
    `INSERT INTO reglages (cle, valeur, mis_a_jour, mis_a_jour_par) VALUES (?, ?, ?, ?)
     ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, mis_a_jour = excluded.mis_a_jour, mis_a_jour_par = excluded.mis_a_jour_par`
  ).bind(cle, valeur, new Date().toISOString(), userId).run();
}

// Une ligne par action d'écriture. Les détails ne portent ni mot de passe, ni jeton, ni contenu de formulaire.
// Un échec du journal est signalé dans les logs mais ne bloque pas l'action.
export async function journaliser(env, { acteur, acteurId = null, action, reference = "", details = null, resultat = "ok" }) {
  try {
    await env.DB.prepare("INSERT INTO audit_logs (actor_id, action, resource_id, at, acteur, details, resultat) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(acteurId, action, String(reference ?? ""), new Date().toISOString(), acteur, details ? JSON.stringify(details) : null, resultat).run();
  } catch (error) {
    console.error("journal", error?.message);
  }
}
