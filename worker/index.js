// Worker M&Y AUTO EXPORT : sert le site statique et l'API de l'espace acheteur (/api/*).
const SESSION_COOKIE = "my_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000; // maximum accepté par Cloudflare Workers
const MAX_LOGIN_FAILURES = 5; // par adresse e-mail sur 15 minutes
const MAX_OFFER_TND = 10_000_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
  const invoiceDocument = path.match(/^\/api\/invoices\/(\d+)\/document$/);
  if (invoiceDocument && method === "GET") return telechargerFacture(request, env, Number(invoiceDocument[1]));
  if (path === "/api/register" && method === "POST") return register(request, env);
  if (path === "/api/login" && method === "POST") return login(request, env);
  if (path === "/api/logout" && method === "POST") return logout(request, env);
  if (path === "/api/offers" && method === "POST") return createOffer(request, env);
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
    `SELECT users.id, users.email, users.name, users.phone, users.created_at FROM sessions
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
  return { id: user.id, email: user.email, name: user.name, phone: user.phone || "", createdAt: user.created_at };
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
  return json({
    user: profil(user),
    favorites: favorites.results.map((row) => row.reference),
    offers: offers.results.map((row) => ({
      id: row.id, reference: row.reference, amountTnd: row.amount_tnd, kind: row.kind, status: row.status, createdAt: row.created_at
    })),
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
      "INSERT INTO users (email, name, phone, password_hash, password_salt) VALUES (?, ?, ?, ?, ?) RETURNING id, email, name, phone, created_at"
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

async function chargerLot(request, env, reference) {
  const response = await env.ASSETS.fetch(new Request(new URL("/lots.json", request.url)));
  if (!response.ok) throw new ApiError(503, "Catalogue indisponible.");
  const lots = await response.json();
  return Array.isArray(lots) ? lots.find((lot) => lot && lot.reference === reference) : null;
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
  const lot = await chargerLot(request, env, reference);
  if (!lot) throw new ApiError(404, "Lot introuvable.");

  let amount;
  if (kind === "buy_now") {
    if (!Number.isFinite(lot.buyNowPriceTnd)) throw new ApiError(400, "Ce lot n'a pas d'achat immédiat.");
    amount = Math.round(lot.buyNowPriceTnd);
  } else {
    if (!["open", "upcoming"].includes(lot.status)) throw new ApiError(400, "Ce lot n'est pas mis aux enchères.");
    if (lot.status === "open" && Date.parse(lot.endsAt) <= Date.now()) throw new ApiError(400, "La vente de ce lot est terminée.");
    amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_OFFER_TND) throw new ApiError(400, "Montant invalide (nombre entier de dinars).");
    if (Number.isFinite(lot.startingPriceTnd) && amount < lot.startingPriceTnd) {
      throw new ApiError(400, `L'offre doit être d'au moins ${lot.startingPriceTnd} TND (mise à prix).`);
    }
  }
  const offer = await env.DB.prepare(
    "INSERT INTO offers (user_id, reference, amount_tnd, kind) VALUES (?, ?, ?, ?) RETURNING id, reference, amount_tnd, kind, status, created_at"
  ).bind(user.id, reference, amount, kind).first();
  return json({
    offer: { id: offer.id, reference: offer.reference, amountTnd: offer.amount_tnd, kind: offer.kind, status: offer.status, createdAt: offer.created_at }
  }, 201);
}
