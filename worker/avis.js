// Avis clients (migration 0025). Un client dépose un avis sur un véhicule remis (customer_vehicles « picked_up ») ou un
// mandat livré (mandats « livre ») ; l'administration le publie ou le refuse. Seuls les avis publiés sont lus par
// l'accueil. Une modification par le client remet l'avis en attente de validation.

const NOTE_MIN = 1;
const NOTE_MAX = 5;
const TEXTE_MIN = 10;
const TEXTE_MAX = 600;
const NOM_MAX = 40;
const MOTIF_MAX = 300;
// Avis montrés sur l'accueil, les plus récemment publiés d'abord.
export const AVIS_ACCUEIL = 12;
export const STATUTS_AVIS = ["en_attente", "publie", "refuse"];

export function estRouteAvis(path) {
  return path === "/api/avis" || path.startsWith("/api/avis/");
}

// Achats ouvrant droit à un avis, avec l'avis déjà déposé. Une seule requête : véhicules remis et mandats livrés.
async function achatsEligibles(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT e.source, e.source_id, e.reference, e.vehicule, a.id AS avis_id, a.note, a.texte, a.nom_affiche, a.statut, a.motif_refus FROM (
       SELECT 'vehicule' AS source, id AS source_id, reference, trim(make || ' ' || model || ' ' || coalesce(trim, '')) AS vehicule
         FROM customer_vehicles WHERE user_id = ?1 AND status = 'picked_up'
       UNION ALL
       SELECT 'mandat', m.id, m.reference, coalesce(trim(v.c_marque || ' ' || v.c_modele), '')
         FROM mandats m LEFT JOIN vehicles v ON v.reference = m.reference WHERE m.user_id = ?1 AND m.statut = 'livre'
     ) e LEFT JOIN avis_clients a ON a.source = e.source AND a.source_id = e.source_id AND a.user_id = ?1
     ORDER BY e.source, e.source_id DESC`
  ).bind(userId).all();
  return results.map((row) => ({
    source: row.source, sourceId: row.source_id, reference: row.reference, vehicule: row.vehicule || "",
    avis: row.avis_id ? { note: row.note, texte: row.texte, nomAffiche: row.nom_affiche, statut: row.statut, motifRefus: row.motif_refus } : null
  }));
}

// Prénom proposé par défaut : premier mot du nom du compte et initiale du suivant (« Sami B. »).
export function nomParDefaut(nom) {
  const mots = String(nom || "").trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return "";
  const prenom = mots[0].charAt(0).toUpperCase() + mots[0].slice(1);
  return (mots[1] ? `${prenom} ${mots[1].charAt(0).toUpperCase()}.` : prenom).slice(0, NOM_MAX);
}

// Champs du formulaire, contrôlés et normalisés. Renvoie { avis } ou { erreur }.
export function validerAvis(body) {
  if (!Number.isInteger(body?.note) || body.note < NOTE_MIN || body.note > NOTE_MAX) return { erreur: "Choisissez une note de 1 à 5 étoiles." };
  const texte = typeof body.texte === "string" ? body.texte.replace(/\s+/g, " ").trim() : "";
  if (texte.length < TEXTE_MIN || texte.length > TEXTE_MAX) return { erreur: `Votre avis doit faire entre ${TEXTE_MIN} et ${TEXTE_MAX} caractères.` };
  const nomAffiche = typeof body.nomAffiche === "string" ? body.nomAffiche.replace(/\s+/g, " ").trim() : "";
  if (!nomAffiche || nomAffiche.length > NOM_MAX) return { erreur: `Indiquez le nom à afficher (${NOM_MAX} caractères au plus).` };
  if (body.consentement !== true) return { erreur: "Acceptez la publication de votre avis pour l'envoyer." };
  return { avis: { note: body.note, texte, nomAffiche } };
}

export async function routeAvis(request, env, url, { json, ApiError, exigerUtilisateur, lireJson }) {
  const method = request.method;
  const user = await exigerUtilisateur(request, env);
  if (url.pathname === "/api/avis" && method === "GET") {
    return json({ achats: await achatsEligibles(env, user.id), nomParDefaut: nomParDefaut(user.name) });
  }
  const cible = url.pathname.match(/^\/api\/avis\/(vehicule|mandat)\/(\d{1,12})$/);
  if (cible && method === "PUT") {
    const { avis, erreur } = validerAvis(await lireJson(request));
    if (erreur) throw new ApiError(400, erreur);
    const [source, sourceId] = [cible[1], Number(cible[2])];
    const achat = (await achatsEligibles(env, user.id)).find((a) => a.source === source && a.sourceId === sourceId);
    if (!achat) throw new ApiError(404, "Cet achat n'ouvre pas droit à un avis : le véhicule doit vous avoir été remis.");
    const maintenant = new Date().toISOString();
    // Nouvel avis, ou modification de l'avis du même client : retour en attente de validation dans les deux cas.
    const ecrit = await env.DB.prepare(
      `INSERT INTO avis_clients (user_id, source, source_id, reference, vehicule, note, texte, nom_affiche, consenti_le, cree_le, mis_a_jour)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source, source_id) DO UPDATE SET note = excluded.note, texte = excluded.texte, nom_affiche = excluded.nom_affiche,
         consenti_le = excluded.consenti_le, statut = 'en_attente', motif_refus = '', decide_le = NULL, decide_par = NULL, mis_a_jour = excluded.mis_a_jour
       WHERE avis_clients.user_id = excluded.user_id RETURNING id`
    ).bind(user.id, source, sourceId, achat.reference, achat.vehicule, avis.note, avis.texte, avis.nomAffiche, maintenant, maintenant, maintenant).first();
    if (!ecrit) throw new ApiError(409, "Un avis existe déjà pour cet achat.");
    return json({ achats: await achatsEligibles(env, user.id), nomParDefaut: nomParDefaut(user.name) });
  }
  throw new ApiError(404, "Route inconnue.");
}

// Administration : liste par statut (coordonnées du client pour vérifier l'avis) et décision.
export async function routeAdminAvis(request, env, url, user, { json, ApiError, lireJson }) {
  const method = request.method;
  if (url.pathname === "/api/admin/avis" && method === "GET") {
    const statut = url.searchParams.get("statut") || "en_attente";
    if (!STATUTS_AVIS.includes(statut)) throw new ApiError(400, "Statut inconnu.");
    const [{ results }, compteurs] = await Promise.all([
      env.DB.prepare(
        `SELECT a.id, a.source, a.reference, a.vehicule, a.note, a.texte, a.nom_affiche, a.statut, a.motif_refus, a.cree_le, a.mis_a_jour, a.decide_le,
           u.name, u.email FROM avis_clients a JOIN users u ON u.id = a.user_id WHERE a.statut = ? ORDER BY a.mis_a_jour DESC LIMIT 200`
      ).bind(statut).all(),
      env.DB.prepare("SELECT statut, COUNT(*) AS n FROM avis_clients GROUP BY statut").all()
    ]);
    return json({
      statut,
      compteurs: Object.fromEntries(STATUTS_AVIS.map((s) => [s, compteurs.results.find((r) => r.statut === s)?.n || 0])),
      avis: results.map((row) => ({
        id: row.id, source: row.source, reference: row.reference, vehicule: row.vehicule, note: row.note, texte: row.texte,
        nomAffiche: row.nom_affiche, statut: row.statut, motifRefus: row.motif_refus, creeLe: row.cree_le, misAJour: row.mis_a_jour,
        decideLe: row.decide_le, client: { nom: row.name, email: row.email }
      }))
    });
  }
  const decision = url.pathname.match(/^\/api\/admin\/avis\/(\d{1,12})\/(publier|refuser)$/);
  if (decision && method === "POST") {
    const body = await lireJson(request).catch(() => ({}));
    const motif = typeof body.motif === "string" ? body.motif.trim() : "";
    if (decision[2] === "refuser" && (!motif || motif.length > MOTIF_MAX)) throw new ApiError(400, `Motif du refus obligatoire (${MOTIF_MAX} caractères au plus).`);
    const statut = decision[2] === "publier" ? "publie" : "refuse";
    const row = await env.DB.prepare(
      "UPDATE avis_clients SET statut = ?, motif_refus = ?, decide_le = ?, decide_par = ? WHERE id = ? RETURNING id, statut"
    ).bind(statut, statut === "refuse" ? motif : "", new Date().toISOString(), user.id, Number(decision[1])).first();
    if (!row) throw new ApiError(404, "Avis introuvable.");
    return json({ id: row.id, statut: row.statut });
  }
  throw new ApiError(404, "Route inconnue.");
}

// Avis publiés pour l'accueil, avec la note moyenne de tous les avis publiés. En cas d'échec : aucun avis, l'accueil
// reste servi.
export async function avisPublies(env) {
  try {
    const [liste, resume] = await env.DB.batch([
      env.DB.prepare("SELECT note, texte, nom_affiche, vehicule FROM avis_clients WHERE statut = 'publie' ORDER BY decide_le DESC LIMIT ?").bind(AVIS_ACCUEIL),
      env.DB.prepare("SELECT COUNT(*) AS n, AVG(note) AS moyenne FROM avis_clients WHERE statut = 'publie'")
    ]);
    return {
      avis: liste.results.map((row) => ({ note: row.note, texte: row.texte, nom: row.nom_affiche, vehicule: row.vehicule || "" })),
      total: resume.results[0]?.n || 0,
      moyenne: resume.results[0]?.moyenne || null
    };
  } catch {
    console.error("avis_publies_failed");
    return { avis: [], total: 0, moyenne: null };
  }
}
