// Worker M&Y AUTO EXPORT : sert le site statique et l'API de l'espace acheteur (/api/*).
const SESSION_COOKIE = "my_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000; // maximum accepté par Cloudflare Workers
const MAX_LOGIN_FAILURES = 5; // par adresse e-mail sur 15 minutes
const MAX_OFFER_TND = 10_000_000;
// Version des conditions générales (conditions.html). La changer redemande l'acceptation à tous les acheteurs.
const CGV_VERSION = "2026-11-01";
const ANTI_SNIPE_MS = 2 * 60_000; // une enchère dans les 2 dernières minutes repousse la fin de 2 minutes
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/media/") && (request.method === "GET" || request.method === "HEAD")) return servirPhoto(env, url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await routeApi(request, env, url);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "Erreur interne, réessaie plus tard." }, 500);
    }
  }
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function routeApi(request, env, url) {
  const method = request.method;
  const path = url.pathname;
  if (method !== "GET" && method !== "HEAD") verifierOrigine(request, url);

  if (path === "/api/me" && method === "GET") return me(request, env);
  if (path === "/api/catalogue" && method === "GET") return json(await catalogue(request, env));
  const enchere = path.match(/^\/api\/auctions\/([^/]{1,64})$/);
  if (enchere && method === "GET") return detailEnchere(request, env, decodeURIComponent(enchere[1]));
  if (path.startsWith("/api/admin/")) return routeAdmin(request, env, path, method);
  const invoiceDocument = path.match(/^\/api\/invoices\/(\d+)\/document$/);
  if (invoiceDocument && method === "GET") return telechargerFacture(request, env, Number(invoiceDocument[1]));
  if (path === "/api/register" && method === "POST") return register(request, env);
  if (path === "/api/login" && method === "POST") return login(request, env);
  if (path === "/api/logout" && method === "POST") return logout(request, env);
  if (path === "/api/offers" && method === "POST") return createOffer(request, env);
  if (path === "/api/terms" && method === "POST") return accepterConditions(request, env);
  const favorite = path.match(/^\/api\/favorites\/([^/]{1,64})$/);
  if (favorite && (method === "PUT" || method === "DELETE")) {
    return toggleFavorite(request, env, decodeURIComponent(favorite[1]), method === "PUT");
  }
  throw new ApiError(404, "Route inconnue.");
}

// Protection CSRF : les requêtes qui modifient des données doivent venir du site lui-même.
function verifierOrigine(request, url) {
  const origin = request.headers.get("Origin");
  if (origin !== url.origin) throw new ApiError(403, "Origine non autorisée.");
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

async function lireJson(request) {
  if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) {
    throw new ApiError(415, "Format attendu : JSON.");
  }
  try {
    const body = await request.json();
    if (body && typeof body === "object") return body;
  } catch {}
  throw new ApiError(400, "Requête illisible.");
}

function texte(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// --- Mots de passe et sessions ---

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function octetsAleatoires(taille) {
  return crypto.getRandomValues(new Uint8Array(taille));
}

async function hacherMotDePasse(motDePasse, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g), (pair) => parseInt(pair, 16));
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(motDePasse), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, cle, 256);
  return hex(bits);
}

function egaliteConstante(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function lireCookie(request, nom) {
  for (const partie of (request.headers.get("Cookie") || "").split(";")) {
    const [cle, ...reste] = partie.trim().split("=");
    if (cle === nom) return reste.join("=");
  }
  return null;
}

function cookieSession(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function ouvrirSession(env, userId) {
  const token = hex(octetsAleatoires(32));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, expires).run();
  return cookieSession(token, SESSION_DAYS * 86400);
}

async function utilisateurConnecte(request, env) {
  const token = lireCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return env.DB.prepare(
    `SELECT users.id, users.email, users.name, users.phone, users.role, users.terms_version, users.created_at FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
  ).bind(await sha256(token), new Date().toISOString()).first();
}

async function exigerUtilisateur(request, env) {
  const user = await utilisateurConnecte(request, env);
  if (!user) throw new ApiError(401, "Connecte-toi à ton espace acheteur.");
  return user;
}

function profil(user) {
  return {
    id: user.id, email: user.email, name: user.name, phone: user.phone || "", role: user.role || "buyer", createdAt: user.created_at,
    termsAccepted: user.terms_version === CGV_VERSION, termsVersion: CGV_VERSION
  };
}

async function accepterConditions(request, env) {
  const user = await exigerUtilisateur(request, env);
  const body = await lireJson(request);
  if (body.version !== CGV_VERSION) throw new ApiError(409, "Les conditions ont changé : recharge la page pour lire la dernière version.");
  await env.DB.prepare("UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE id = ?")
    .bind(CGV_VERSION, new Date().toISOString(), user.id).run();
  return json({ termsAccepted: true, termsVersion: CGV_VERSION });
}

// --- Routes ---

async function me(request, env) {
  const user = await utilisateurConnecte(request, env);
  if (!user) return json({ user: null }, 401);
  const [favorites, offers, vehicles, invoices] = await Promise.all([
    env.DB.prepare("SELECT reference FROM favorites WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all(),
    env.DB.prepare("SELECT id, reference, amount_tnd, kind, status, created_at FROM offers WHERE user_id = ? ORDER BY id DESC").bind(user.id).all(),
    env.DB.prepare("SELECT id, reference, make, model, trim, status, purchased_at FROM customer_vehicles WHERE user_id = ? ORDER BY purchased_at DESC, id DESC").bind(user.id).all(),
    env.DB.prepare("SELECT id, vehicle_id, invoice_number, issued_at, total_tnd, status, document_key FROM invoices WHERE user_id = ? ORDER BY issued_at DESC, id DESC").bind(user.id).all()
  ]);
  const references = [...new Set(offers.results.filter((row) => row.kind === "bid").map((row) => row.reference))];
  const encheres = new Map();
  if (references.length) {
    const [lots, meilleures] = await Promise.all([
      catalogue(request, env),
      env.DB.prepare(
        `SELECT reference, id, MAX(amount_tnd) AS top FROM offers WHERE kind = 'bid'
         AND reference IN (${references.map(() => "?").join(",")}) GROUP BY reference`
      ).bind(...references).all()
    ]);
    for (const row of meilleures.results) {
      encheres.set(row.reference, { meilleureId: row.id, auction: lots.find((lot) => lot.reference === row.reference)?.auction });
    }
  }
  return json({
    user: profil(user),
    favorites: favorites.results.map((row) => row.reference),
    offers: offers.results.map((row) => {
      const enchere = row.kind === "bid" ? encheres.get(row.reference) : null;
      return {
        id: row.id, reference: row.reference, amountTnd: row.amount_tnd, kind: row.kind,
        status: enchere ? statutEnchere(row, enchere.meilleureId, enchere.auction) : row.status, createdAt: row.created_at
      };
    }),
    vehicles: vehicles.results.map((row) => ({
      id: row.id, reference: row.reference, make: row.make, model: row.model, trim: row.trim || "",
      status: row.status, purchasedAt: row.purchased_at
    })),
    invoices: invoices.results.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, invoiceNumber: row.invoice_number, issuedAt: row.issued_at,
      totalTnd: row.total_tnd, status: row.status, documentAvailable: Boolean(row.document_key && env.DOCUMENTS)
    }))
  });
}

async function telechargerFacture(request, env, invoiceId) {
  const user = await exigerUtilisateur(request, env);
  const invoice = await env.DB.prepare(
    "SELECT invoice_number, document_key FROM invoices WHERE id = ? AND user_id = ?"
  ).bind(invoiceId, user.id).first();
  if (!invoice || !invoice.document_key) throw new ApiError(404, "Facture introuvable.");
  if (!env.DOCUMENTS) throw new ApiError(503, "Le stockage sécurisé des factures n'est pas configuré.");

  const object = await env.DOCUMENTS.get(invoice.document_key);
  if (!object) throw new ApiError(404, "Fichier de facture introuvable.");
  const filename = String(invoice.invoice_number).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || `facture-${invoiceId}`;
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox"
    }
  });
}

async function register(request, env) {
  const body = await lireJson(request);
  const name = texte(body.name, 80);
  const email = texte(body.email, 254).toLowerCase();
  const phone = texte(body.phone, 30);
  const password = typeof body.password === "string" ? body.password : "";
  if (name.length < 2) throw new ApiError(400, "Indique ton nom.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Adresse e-mail invalide.");
  if (phone && !/^[+0-9 ().-]{6,30}$/.test(phone)) throw new ApiError(400, "Numéro de téléphone invalide.");
  if (password.length < 10 || password.length > 200) throw new ApiError(400, "Le mot de passe doit contenir au moins 10 caractères.");

  const salt = hex(octetsAleatoires(16));
  const hash = await hacherMotDePasse(password, salt);
  let created;
  try {
    created = await env.DB.prepare(
      "INSERT INTO users (email, name, phone, password_hash, password_salt) VALUES (?, ?, ?, ?, ?) RETURNING id, email, name, phone, role, terms_version, created_at"
    ).bind(email, name, phone || null, hash, salt).first();
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new ApiError(409, "Un compte existe déjà avec cette adresse e-mail.");
    throw error;
  }
  return json({ user: profil(created), favorites: [], offers: [] }, 201, { "Set-Cookie": await ouvrirSession(env, created.id) });
}

async function login(request, env) {
  const body = await lireJson(request);
  const email = texte(body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  const depuis = new Date(Date.now() - 15 * 60_000).toISOString();
  const echecs = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND at > ?").bind(email, depuis).first();
  if (echecs.n >= MAX_LOGIN_FAILURES) throw new ApiError(429, "Trop de tentatives. Réessaie dans 15 minutes.");

  const user = await env.DB.prepare("SELECT id, password_hash, password_salt FROM users WHERE email = ?").bind(email).first();
  // Même calcul que l'adresse existe ou non, pour ne pas révéler les comptes par le temps de réponse.
  const hash = await hacherMotDePasse(password, user ? user.password_salt : "00".repeat(16));
  if (!user || !egaliteConstante(hash, user.password_hash)) {
    await env.DB.prepare("INSERT INTO login_failures (email, at) VALUES (?, ?)").bind(email, new Date().toISOString()).run();
    throw new ApiError(401, "E-mail ou mot de passe incorrect.");
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_failures WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?").bind(user.id, new Date().toISOString())
  ]);
  const cookie = await ouvrirSession(env, user.id);
  const reponse = await me(new Request(request.url, { headers: { Cookie: cookie.split(";")[0] } }), env);
  return new Response(reponse.body, { status: 200, headers: { ...Object.fromEntries(reponse.headers), "Set-Cookie": cookie } });
}

async function logout(request, env) {
  const token = lireCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ user: null }, 200, { "Set-Cookie": cookieSession("", 0) });
}

// --- Catalogue : lots.json + véhicules de l'administration ---

async function lotsFichier(request, env) {
  const response = await env.ASSETS.fetch(new Request(new URL("/lots.json", request.url)));
  if (!response.ok) throw new ApiError(503, "Catalogue indisponible.");
  const lots = await response.json();
  return Array.isArray(lots) ? lots.filter((lot) => lot && typeof lot.reference === "string") : [];
}

// Tous les véhicules, retirés compris, avec leur origine : « fichier » (lots.json) ou « base » (administration).
async function catalogueComplet(request, env) {
  const [fichier, base] = await Promise.all([
    lotsFichier(request, env),
    env.DB.prepare("SELECT reference, data, removed, updated_at FROM vehicles").all()
  ]);
  const lignes = new Map(base.results.map((row) => [row.reference, row]));
  const resultat = fichier.map((lot) => {
    const row = lignes.get(lot.reference);
    lignes.delete(lot.reference);
    return row ? { lot: JSON.parse(row.data), source: "base", removed: Boolean(row.removed), updatedAt: row.updated_at } : { lot, source: "fichier", removed: false };
  });
  for (const row of lignes.values()) {
    resultat.push({ lot: JSON.parse(row.data), source: "base", removed: Boolean(row.removed), updatedAt: row.updated_at });
  }
  return resultat;
}

// Lots publics, avec l'état de leur enchère (prix actuel, fin effective…) pour les lots open et upcoming.
async function catalogue(request, env) {
  const [items, resumes] = await Promise.all([catalogueComplet(request, env), resumesEncheres(env)]);
  const maintenant = Date.now();
  return items.filter((item) => !item.removed).map((item) => avecEnchere(item.lot, resumes, maintenant));
}

function avecEnchere(lot, resumes, maintenant) {
  const auction = etatEnchere(lot, resumes.get(lot.reference), maintenant);
  return auction ? { ...lot, auction } : lot;
}

// --- Enchères ---

// Pas minimum entre deux enchères : celui du lot s'il est fixé, sinon selon le prix atteint.
function pasEnchere(lot, montant) {
  if (Number.isFinite(lot.bidIncrementTnd) && lot.bidIncrementTnd > 0) return lot.bidIncrementTnd;
  if (montant < 20_000) return 200;
  if (montant < 100_000) return 500;
  if (montant < 300_000) return 1_000;
  return 2_000;
}

async function resumesEncheres(env) {
  const { results } = await env.DB.prepare(
    "SELECT reference, COUNT(*) AS n, MAX(amount_tnd) AS top, MAX(created_at) AS last FROM offers WHERE kind = 'bid' GROUP BY reference"
  ).all();
  return new Map(results.map((row) => [row.reference, row]));
}

// Fin effective : la date prévue, repoussée à 2 minutes après la dernière enchère si celle-ci est arrivée tard.
// Chaque enchère acceptée l'a été avant la fin effective du moment, d'où ce calcul à partir de la seule dernière.
function etatEnchere(lot, resume, maintenant) {
  if (lot.status !== "open" && lot.status !== "upcoming") return null;
  const depart = Number.isFinite(lot.startingPriceTnd) ? lot.startingPriceTnd : 0;
  const top = resume?.top ?? null;
  const prixActuel = top ?? depart;
  const pas = pasEnchere(lot, prixActuel);
  let fin = Date.parse(lot.endsAt);
  if (resume?.last && Number.isFinite(fin)) fin = Math.max(fin, Date.parse(resume.last) + ANTI_SNIPE_MS);
  const statut = lot.status === "upcoming" ? "upcoming" : (Number.isFinite(fin) && maintenant < fin ? "live" : "ended");
  return {
    status: statut,
    endsAt: Number.isFinite(fin) ? new Date(fin).toISOString() : null,
    extended: Number.isFinite(fin) && fin > Date.parse(lot.endsAt),
    currentBidTnd: top,
    bidCount: resume?.n ?? 0,
    incrementTnd: pas,
    minNextBidTnd: top == null ? Math.max(depart, 1) : top + pas,
    reserveMet: Number.isFinite(lot.reservePriceTnd) ? top != null && top >= lot.reservePriceTnd : null
  };
}

async function etiquettesEncherisseurs(env, reference) {
  const { results } = await env.DB.prepare(
    "SELECT user_id, MIN(created_at) AS premiere FROM offers WHERE reference = ? AND kind = 'bid' GROUP BY user_id ORDER BY premiere"
  ).bind(reference).all();
  return new Map(results.map((row, index) => [row.user_id, `Enchérisseur ${index + 1}`]));
}

async function detailEnchere(request, env, reference) {
  const lot = await chargerLot(request, env, reference);
  if (!lot?.auction) throw new ApiError(404, "Aucune enchère pour ce lot.");
  const [user, etiquettes, { results }] = await Promise.all([
    utilisateurConnecte(request, env),
    etiquettesEncherisseurs(env, reference),
    env.DB.prepare("SELECT user_id, amount_tnd, created_at FROM offers WHERE reference = ? AND kind = 'bid' ORDER BY amount_tnd DESC, created_at ASC LIMIT 30")
      .bind(reference).all()
  ]);
  return json({
    reference,
    auction: lot.auction,
    bids: results.map((row) => ({
      amountTnd: row.amount_tnd, createdAt: row.created_at, bidder: etiquettes.get(row.user_id), you: Boolean(user && user.id === row.user_id)
    }))
  });
}

// Statut d'une enchère de l'acheteur : leading / outbid tant que la vente dure, won / reserve_not_met / lost ensuite.
function statutEnchere(offre, meilleureId, auction) {
  // Une décision de l'administration (acceptée / refusée) l'emporte sur l'état calculé de la vente.
  if (offre.status === "accepted" || offre.status === "refused" || !auction) return offre.status;
  const enTete = offre.id === meilleureId;
  if (auction.status !== "ended") return enTete ? "leading" : "outbid";
  if (!enTete) return "lost";
  return auction.reserveMet === false ? "reserve_not_met" : "won";
}

async function chargerLot(request, env, reference) {
  return (await catalogue(request, env)).find((lot) => lot.reference === reference) || null;
}

// --- Administration ---

async function exigerAdmin(request, env) {
  const user = await exigerUtilisateur(request, env);
  if (user.role !== "admin") throw new ApiError(403, "Ce compte n'a pas accès à l'administration.");
  return user;
}

async function routeAdmin(request, env, path, method) {
  const user = await exigerAdmin(request, env);
  if (path === "/api/admin/vehicles" && method === "GET") {
    const [items, resumes] = await Promise.all([catalogueComplet(request, env), resumesEncheres(env)]);
    const maintenant = Date.now();
    const vehicles = items.map((item) => ({ ...item, auction: etatEnchere(item.lot, resumes.get(item.lot.reference), maintenant) }));
    return json({ vehicles, photosEnabled: Boolean(env.PHOTOS) });
  }
  const encheres = path.match(/^\/api\/admin\/auctions\/([^/]{1,64})$/);
  if (encheres && method === "GET") {
    const reference = decodeURIComponent(encheres[1]);
    const [etiquettes, { results }] = await Promise.all([
      etiquettesEncherisseurs(env, reference),
      env.DB.prepare(
        `SELECT offers.amount_tnd, offers.created_at, offers.user_id, users.name, users.email, users.phone FROM offers
         JOIN users ON users.id = offers.user_id WHERE offers.reference = ? AND offers.kind = 'bid'
         ORDER BY offers.amount_tnd DESC, offers.created_at ASC`
      ).bind(reference).all()
    ]);
    return json({
      reference,
      bids: results.map((row) => ({
        amountTnd: row.amount_tnd, createdAt: row.created_at, bidder: etiquettes.get(row.user_id),
        name: row.name, email: row.email, phone: row.phone || ""
      }))
    });
  }
  const vehicule = path.match(/^\/api\/admin\/vehicles\/([^/]{1,64})$/);
  if (vehicule && method === "PUT") return enregistrerVehicule(request, env, user, decodeURIComponent(vehicule[1]));
  if (vehicule && method === "DELETE") return retirerVehicule(request, env, user, decodeURIComponent(vehicule[1]));
  if (path === "/api/admin/offers" && method === "GET") return listerOffres(request, env, new URL(request.url).searchParams.get("reference"));
  const decision = path.match(/^\/api\/admin\/offers\/(\d+)\/(accept|refuse)$/);
  if (decision && method === "POST") return deciderOffre(request, env, Number(decision[1]), decision[2] === "accept");
  if (path === "/api/admin/photos" && method === "POST") return envoyerPhoto(request, env);
  const photo = path.match(/^\/api\/admin\/photos\/(vehicules\/[A-Za-z0-9._-]+\/[a-f0-9]{32}\.(?:jpg|png|webp))$/);
  if (photo && method === "DELETE") {
    if (!env.PHOTOS) throw new ApiError(503, "Le stockage des photos n'est pas configuré.");
    await env.PHOTOS.delete(photo[1]);
    return json({ deleted: photo[1] });
  }
  throw new ApiError(404, "Route inconnue.");
}

// Toutes les enchères et demandes d'achat immédiat (ou celles d'un véhicule), avec l'acheteur et l'état de la vente.
async function listerOffres(request, env, reference) {
  const [items, resumes, etiquettes, { results }] = await Promise.all([
    catalogueComplet(request, env),
    resumesEncheres(env),
    reference ? etiquettesEncherisseurs(env, reference) : Promise.resolve(null),
    env.DB.prepare(
      `SELECT offers.id, offers.reference, offers.kind, offers.amount_tnd, offers.status, offers.created_at, offers.user_id,
              users.name, users.email, users.phone FROM offers JOIN users ON users.id = offers.user_id
       ${reference ? "WHERE offers.reference = ?" : ""} ORDER BY offers.reference, offers.kind, offers.amount_tnd DESC, offers.created_at ASC LIMIT 1000`
    ).bind(...(reference ? [reference] : [])).all()
  ]);
  const maintenant = Date.now();
  const lots = {};
  for (const item of items) {
    if (!results.some((row) => row.reference === item.lot.reference)) continue;
    lots[item.lot.reference] = {
      title: `${item.lot.make} ${item.lot.model} ${item.lot.trim || ""}`.trim(),
      removed: item.removed,
      auction: etatEnchere(item.lot, resumes.get(item.lot.reference), maintenant)
    };
  }
  const meilleures = new Map();
  for (const row of results) {
    if (row.kind === "bid" && !meilleures.has(row.reference)) meilleures.set(row.reference, row.id);
  }
  return json({
    lots,
    offers: results.map((row) => ({
      id: row.id, reference: row.reference, kind: row.kind, amountTnd: row.amount_tnd, status: row.status, createdAt: row.created_at,
      best: meilleures.get(row.reference) === row.id, bidder: etiquettes?.get(row.user_id) || null,
      name: row.name, email: row.email, phone: row.phone || ""
    }))
  });
}

// Accepter une offre : les autres offres en attente du véhicule sont refusées, le véhicule rejoint « Mes véhicules »
// de l'acheteur et, si demandé, il est retiré du site. Refuser : l'offre seule passe en « refusée ».
async function deciderOffre(request, env, offreId, accepter) {
  const user = await exigerAdmin(request, env);
  const body = await lireJson(request).catch(() => ({}));
  const offre = await env.DB.prepare("SELECT id, user_id, reference, kind, amount_tnd, status FROM offers WHERE id = ?").bind(offreId).first();
  if (!offre) throw new ApiError(404, "Offre introuvable.");
  if (offre.status !== "pending") throw new ApiError(409, "Cette offre a déjà été traitée.");
  if (!accepter) {
    await env.DB.prepare("UPDATE offers SET status = 'refused' WHERE id = ? AND status = 'pending'").bind(offreId).run();
    return json({ id: offreId, status: "refused" });
  }

  const item = (await catalogueComplet(request, env)).find((entry) => entry.lot.reference === offre.reference);
  if (!item) throw new ApiError(404, "Véhicule introuvable.");
  const dejaVendu = await env.DB.prepare("SELECT id FROM offers WHERE reference = ? AND status = 'accepted'").bind(offre.reference).first();
  if (dejaVendu) throw new ApiError(409, "Une offre a déjà été acceptée pour ce véhicule.");
  if (offre.kind === "bid") {
    const auction = etatEnchere(item.lot, (await resumesEncheres(env)).get(offre.reference), Date.now());
    if (auction?.status === "live") throw new ApiError(409, "La vente est encore en cours : attends sa fin pour accepter une enchère.");
  }

  const maintenant = new Date().toISOString();
  const requetes = [
    env.DB.prepare("UPDATE offers SET status = 'accepted' WHERE id = ? AND status = 'pending'").bind(offreId),
    env.DB.prepare("UPDATE offers SET status = 'refused' WHERE reference = ? AND id <> ? AND status = 'pending'").bind(offre.reference, offreId),
    env.DB.prepare(
      `INSERT INTO customer_vehicles (user_id, reference, make, model, trim, status, purchased_at) VALUES (?, ?, ?, ?, ?, 'purchased', ?)
       ON CONFLICT(user_id, reference) DO NOTHING`
    ).bind(offre.user_id, offre.reference, item.lot.make, item.lot.model, item.lot.trim || null, maintenant)
  ];
  if (body.removeFromSite !== false) {
    requetes.push(env.DB.prepare(
      `INSERT INTO vehicles (reference, data, removed, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(reference) DO UPDATE SET removed = 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(offre.reference, JSON.stringify(item.lot), maintenant, user.id));
  }
  await env.DB.batch(requetes);
  return json({ id: offreId, status: "accepted", removedFromSite: body.removeFromSite !== false });
}

const STATUTS = ["open", "upcoming", "stock"];

function nombre(value, nom) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new ApiError(400, `${nom} : nombre invalide.`);
  return n;
}

function photoValide(url) {
  return typeof url === "string" && url.length <= 500
    && (/^https:\/\/[^\s"'<>]+$/.test(url) || /^\/media\/vehicules\/[A-Za-z0-9._-]+\/[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(url) || /^photos\/[^/]+$/.test(url));
}

// Ne garde que les champs connus, vérifiés comme le fait la page publique (lotValide).
function validerVehicule(body, reference) {
  const lot = { reference };
  const champs = { make: "Marque", model: "Modèle", trim: null, fuel: null, bodyType: null, country: null, pickupLocation: null, seller: null, availableFrom: null };
  for (const [cle, obligatoire] of Object.entries(champs)) {
    const valeur = texte(body[cle], 120);
    if (obligatoire && !valeur) throw new ApiError(400, `${obligatoire} obligatoire.`);
    if (valeur) lot[cle] = valeur;
  }
  if (!STATUTS.includes(body.status)) throw new ApiError(400, "Statut invalide.");
  lot.status = body.status;
  if (lot.status === "open") {
    const fin = Date.parse(body.endsAt);
    if (!Number.isFinite(fin)) throw new ApiError(400, "Date de fin de vente obligatoire pour un lot en vente.");
    lot.endsAt = new Date(fin).toISOString();
  }
  const annee = nombre(body.year, "Année");
  if (annee !== null) {
    if (!Number.isInteger(annee) || annee < 1950 || annee > 2100) throw new ApiError(400, "Année invalide.");
    lot.year = annee;
  }
  for (const [cle, nom] of [["mileageKm", "Kilométrage"], ["indicativePriceTnd", "Prix"], ["startingPriceTnd", "Mise à prix"], ["reservePriceTnd", "Prix de réserve"], ["buyNowPriceTnd", "Achat immédiat"], ["bidIncrementTnd", "Pas d'enchère"]]) {
    const valeur = nombre(body[cle], nom);
    if (valeur !== null) lot[cle] = valeur;
  }
  const sourceUrl = texte(body.sourceUrl, 500);
  if (sourceUrl) {
    if (!/^https:\/\/[^\s"'<>]+$/.test(sourceUrl)) throw new ApiError(400, "Le lien fournisseur doit commencer par https://");
    lot.sourceUrl = sourceUrl;
  }
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length > 40) throw new ApiError(400, "40 photos maximum.");
  lot.photos = photos.map((photo) => {
    const url = typeof photo === "string" ? photo : photo?.url;
    if (!photoValide(url)) throw new ApiError(400, "Adresse de photo invalide.");
    return { url, authorized: true };
  });
  const specs = Array.isArray(body.specs) ? body.specs : [];
  if (specs.length > 30) throw new ApiError(400, "30 caractéristiques maximum.");
  const lignes = specs.map((spec) => [texte(spec?.[0], 60), texte(spec?.[1], 160)]).filter(([libelle, valeur]) => libelle && valeur);
  if (lignes.length) lot.specs = lignes;
  lot.createdAt = texte(body.createdAt, 40) || new Date().toISOString();
  return lot;
}

async function enregistrerVehicule(request, env, user, reference) {
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(reference)) throw new ApiError(400, "Référence invalide (lettres, chiffres, . _ - ; 40 caractères maximum).");
  const lot = validerVehicule(await lireJson(request), reference);
  await env.DB.prepare(
    `INSERT INTO vehicles (reference, data, removed, updated_at, updated_by) VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(reference) DO UPDATE SET data = excluded.data, removed = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(reference, JSON.stringify(lot), new Date().toISOString(), user.id).run();
  return json({ vehicle: lot });
}

async function retirerVehicule(request, env, user, reference) {
  const existant = (await catalogueComplet(request, env)).find((item) => item.lot.reference === reference);
  if (!existant) throw new ApiError(404, "Véhicule introuvable.");
  await env.DB.prepare(
    `INSERT INTO vehicles (reference, data, removed, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(reference) DO UPDATE SET removed = 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(reference, JSON.stringify(existant.lot), new Date().toISOString(), user.id).run();
  return json({ reference, removed: true });
}

async function envoyerPhoto(request, env) {
  if (!env.PHOTOS) throw new ApiError(503, "Le stockage des photos n'est pas configuré.");
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, "Envoi de photo illisible.");
  }
  const fichier = form.get("photo");
  const reference = texte(form.get("reference"), 40);
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(reference)) throw new ApiError(400, "Indique d'abord la référence du véhicule.");
  if (!fichier || typeof fichier === "string") throw new ApiError(400, "Aucune photo reçue.");
  const extension = PHOTO_TYPES[fichier.type];
  if (!extension) throw new ApiError(415, "Format accepté : JPEG, PNG ou WebP.");
  if (fichier.size > MAX_PHOTO_BYTES) throw new ApiError(413, "Photo trop lourde (10 Mo maximum).");
  const key = `vehicules/${reference}/${hex(octetsAleatoires(16))}.${extension}`;
  await env.PHOTOS.put(key, fichier.stream(), { httpMetadata: { contentType: fichier.type } });
  return json({ url: `/media/${key}`, key }, 201);
}

async function servirPhoto(env, url) {
  const key = decodeURIComponent(url.pathname.slice("/media/".length));
  if (!env.PHOTOS || !/^vehicules\/[A-Za-z0-9._-]+\/[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(key)) return new Response("Introuvable", { status: 404 });
  const object = await env.PHOTOS.get(key);
  if (!object) return new Response("Introuvable", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      // Clé aléatoire par photo : le contenu ne change jamais pour une même adresse.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function toggleFavorite(request, env, reference, ajouter) {
  const user = await exigerUtilisateur(request, env);
  if (ajouter) {
    if (!(await chargerLot(request, env, reference))) throw new ApiError(404, "Lot introuvable.");
    await env.DB.prepare("INSERT OR IGNORE INTO favorites (user_id, reference) VALUES (?, ?)").bind(user.id, reference).run();
  } else {
    await env.DB.prepare("DELETE FROM favorites WHERE user_id = ? AND reference = ?").bind(user.id, reference).run();
  }
  return json({ reference, favorite: ajouter });
}

async function createOffer(request, env) {
  const user = await exigerUtilisateur(request, env);
  const body = await lireJson(request);
  const reference = texte(body.reference, 64);
  const kind = body.kind === "buy_now" ? "buy_now" : "bid";
  if (user.terms_version !== CGV_VERSION) {
    throw new ApiError(428, "Accepte les conditions générales de vente avant d'enchérir ou d'acheter.");
  }
  const lot = await chargerLot(request, env, reference);
  if (!lot) throw new ApiError(404, "Lot introuvable.");

  if (kind === "bid") return placerEnchere(request, env, user, lot, body);
  if (!Number.isFinite(lot.buyNowPriceTnd)) throw new ApiError(400, "Ce lot n'a pas d'achat immédiat.");
  if (lot.auction?.status === "ended") throw new ApiError(400, "La vente de ce lot est terminée.");
  const offer = await env.DB.prepare(
    "INSERT INTO offers (user_id, reference, amount_tnd, kind) VALUES (?, ?, ?, 'buy_now') RETURNING id, reference, amount_tnd, kind, status, created_at"
  ).bind(user.id, reference, Math.round(lot.buyNowPriceTnd)).first();
  return json({
    offer: { id: offer.id, reference: offer.reference, amountTnd: offer.amount_tnd, kind: offer.kind, status: offer.status, createdAt: offer.created_at }
  }, 201);
}

async function placerEnchere(request, env, user, lot, body) {
  const etat = lot.auction;
  if (lot.status === "upcoming") throw new ApiError(400, "Les enchères de ce lot ne sont pas encore ouvertes.");
  if (!etat) throw new ApiError(400, "Ce lot n'est pas mis aux enchères.");
  if (etat.status !== "live") throw new ApiError(400, "La vente de ce lot est terminée.");
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_OFFER_TND) throw new ApiError(400, "Montant invalide (nombre entier de dinars).");
  if (amount < etat.minNextBidTnd) throw new ApiError(400, `L'enchère minimale est de ${etat.minNextBidTnd} TND.`);

  // Vérification et insertion en une seule requête : deux enchères simultanées ne peuvent pas passer toutes les deux.
  const offer = await env.DB.prepare(
    `INSERT INTO offers (user_id, reference, amount_tnd, kind, created_at)
     SELECT ?, ?, ?, 'bid', ?
     WHERE ? >= COALESCE((SELECT MAX(amount_tnd) FROM offers WHERE reference = ? AND kind = 'bid') + ?, ?)
     RETURNING id, reference, amount_tnd, kind, created_at`
  ).bind(user.id, lot.reference, amount, new Date().toISOString(), amount, lot.reference, etat.incrementTnd, etat.minNextBidTnd).first();
  if (!offer) throw new ApiError(409, "Une enchère plus haute vient d'être placée. Le prix a été mis à jour, réessaie.");

  const auction = etatEnchere(lot, (await resumesEncheres(env)).get(lot.reference), Date.now());
  return json({
    offer: { id: offer.id, reference: offer.reference, amountTnd: offer.amount_tnd, kind: offer.kind, status: "leading", createdAt: offer.created_at },
    auction
  }, 201);
}
