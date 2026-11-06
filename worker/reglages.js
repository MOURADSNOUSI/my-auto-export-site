// Réglages du site (table reglages) et journal des actions d'écriture (audit_logs, colonnes acteur, details, resultat).

// Clés modifiables depuis /admin, avec leur valeur par défaut si la ligne manque.
export const REGLAGES_INTERRUPTEURS = { automations_actives: true, agent_ecriture_autorisee: false };

export async function reglageActif(env, cle) {
  const ligne = await env.DB.prepare("SELECT valeur FROM reglages WHERE cle = ?").bind(cle).first();
  return ligne ? ligne.valeur === "true" : REGLAGES_INTERRUPTEURS[cle] === true;
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
  await env.DB.prepare(
    `INSERT INTO reglages (cle, valeur, mis_a_jour, mis_a_jour_par) VALUES (?, ?, ?, ?)
     ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, mis_a_jour = excluded.mis_a_jour, mis_a_jour_par = excluded.mis_a_jour_par`
  ).bind(cle, actif ? "true" : "false", new Date().toISOString(), userId).run();
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
