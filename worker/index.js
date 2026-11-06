import { sellerRoutes, routeSeller, sellerMedia, verifiedSellerLots, purgeSeller } from "./seller.js";
// Worker M&Y AUTO EXPORT : sert le site statique, l'API de l'espace acheteur (/api/*), le serveur MCP (worker/mcp.js),
// les pages de référencement (worker/seo.js) et la marketplace (offres privées, propositions d'achat du Lot 1).
import Stripe from "stripe";
import { proposalRoute, proposals } from "./proposals.js";
import { legacyAuctionsEnabled, lot1Public, freeOffersEnabled } from "./proposal-domain.js";
import { marketplace } from "./marketplace.js";
import { diagnosticValid, expireOffers, policy } from "./marketplace-domain.js";
import { marketplacePage } from "./marketplace-pages.js";
import { estRouteMcp, routeMcp } from "./mcp.js";
import { cheminVehicule, controleQuotidien, controlerApresPublication, estRouteSeo, page404, redirectionPublic, routeSeo, vitrineAccueil } from "./seo.js";
import { ErreurCatalogue, voituresEurope } from "./voitures-europe.js";
import { REGLAGES_INTERRUPTEURS, REGLAGES_SITE, reglageActif, ecrireInterrupteur, ecrireReglageSite, journaliser, listerReglages, listerReglagesSite, validerReglageSite } from "./reglages.js";
import { mettreAJourTaux, routeAdminPrix } from "./prix.js";
import { estRouteMandats, routeAdminMandats, routeMandats, vehiculeMandat } from "./mandats.js";
import { estRouteGoogle, routeGoogle } from "./google.js";
import { routeAdminImport, suivreImports } from "./import-openlane.js";

const SESSION_COOKIE = "my_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000; // maximum accepté par Cloudflare Workers
export const MAX_LOGIN_FAILURES = 5; // par adresse e-mail et par IP sur 15 minutes
const MAX_ECHECS_PAR_IP = 30; // toutes adresses e-mail confondues, sur 15 minutes
const MAX_ECHECS_PAR_COMPTE = 100; // toutes IP confondues, sur 15 minutes : freine une attaque répartie
const MAX_INSCRIPTIONS_PAR_IP = 10; // par heure
const MAX_OFFER_TND = 10_000_000;
const MAX_MOTIF_CAUTION = 2000; // motif d'un ajustement manuel de caution
// Version des conditions générales (conditions.html). La changer redemande l'acceptation à tous les acheteurs.
const CGV_VERSION = "2026-11-01";
// Barème de la caution selon la valeur du lot (prix de réserve, à défaut mise à prix) : [plafond inclus, caution] en TND.
const DEPOSIT_TIERS = [[30_000, 500], [50_000, 1000], [70_000, 1500], [100_000, 2000], [199_999, 2500]];
const DEPOSIT_TOP_TND = 3000; // à partir de 200 000 TND

// Le solde de caution du compte est global : il couvre tous les lots dont la caution exigée est inférieure ou égale.
export function depotRequis(lot) {
  const valeur = [lot.reservePriceTnd, lot.startingPriceTnd].find((v) => Number.isFinite(v) && v > 0) || 0;
  return DEPOSIT_TIERS.find(([plafond]) => valeur <= plafond)?.[1] ?? DEPOSIT_TOP_TND;
}
const RETRAIT_MIN_MS = 12 * 3_600_000; // une enchère ne peut plus être retirée dans les 12 dernières heures
const ANTI_SNIPE_MS = 2 * 60_000; // une enchère dans les 2 dernières minutes repousse la fin de 2 minutes
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// En-têtes de sécurité de toutes les réponses. Les mêmes sont déclarés dans my-auto-export/_headers pour les fichiers
// que Cloudflare sert sans passer par le Worker (tests/test_securite.py vérifie qu'ils restent identiques).
// Une réponse qui fixe déjà l'un d'eux le garde (page d'autorisation MCP : CSP sans form-action).
export const ENTETES_SECURITE = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
    + "img-src 'self' https: data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; "
    + "form-action 'self'; frame-ancestors 'none'"
};

// Pages de la marketplace rendues par le Worker (worker/marketplace-pages.js).
const PAGES_MARKETPLACE = ["/mes-offres", "/vendeur/offres", "/garages", "/admin/marketplace", "/confidentialite", "/conditions-marketplace", "/droits-donnees"];
// Pages privées : jamais en cache partagé ni indexées.
const PAGES_PRIVEES = ["/vendre", "/vendre.html", "/mes-vehicules", "/mes-offres", "/vendeur/offres", "/garages", "/admin/marketplace", "/admin-vendeurs", "/admin-vendeurs.html", "/admin-prix", "/admin-prix.html", "/mes-mandats", "/mes-mandats.html", "/admin-mandats", "/admin-mandats.html"];
// CSP des pages privées qui n'en fixent pas déjà une : pas de script en ligne.
const CSP_PAGES_PRIVEES = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; "
  + "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

export default {
  async fetch(request, env, ctx) {
    const reponse = new Response(...corps(await repondre(request, env, ctx)));
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/") || PAGES_PRIVEES.includes(path)) {
      reponse.headers.set("Cache-Control", "private, no-store");
      reponse.headers.set("X-Robots-Tag", "noindex, nofollow");
      if (!path.startsWith("/api/") && !reponse.headers.has("Content-Security-Policy")) reponse.headers.set("Content-Security-Policy", CSP_PAGES_PRIVEES);
    }
    for (const [cle, valeur] of Object.entries(ENTETES_SECURITE)) {
      if (!reponse.headers.has(cle)) reponse.headers.set(cle, valeur);
    }
    return reponse;
  },

  // 02:30 UTC : expiration des offres privées et diagnostics, puis purge des dossiers vendeurs inactifs.
  // 05:00 et 06:00 UTC : contrôle SEO (seul celui de 07:00 à Paris s'exécute).
  // 06:00 UTC : taux EUR→TND des prix estimés (worker/prix.js), une fois par jour.
  async scheduled(controller, env) {
    if (controller.cron === "30 2 * * *") {
      await expireOffers(env);
      await suivreImports(env).catch(() => console.error("suivi_imports_failed"));
      const regles = await policy(env);
      await purgeSeller(env, regles?.retention_days ?? (env.SELLER_RETENTION_DAYS || 180));
    } else {
      if (controller.cron === "0 6 * * *") await mettreAJourTaux(env).catch(() => console.error("taux_auto_failed"));
      await controleQuotidien(controller, env);
    }
  }
};

// Corps et options d'une réponse, pour en refaire une copie aux en-têtes modifiables.
function corps(response) {
  return [response.body, { status: response.status, statusText: response.statusText, headers: response.headers }];
}

async function repondre(request, env, ctx) {
  const url = new URL(request.url);
  // Une seule version du site : http répondait aussi, ce qui dupliquait chaque page.
  if (url.protocol === "http:" && /(^|\.)myautoexport\.com$/.test(url.hostname)) {
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }
  const lecture = request.method === "GET" || request.method === "HEAD";
  if (/^\/seller-media\/[a-f0-9]{32}$/.test(url.pathname) && lecture) {
    try { return await sellerMedia(env, url.pathname.split("/")[2], request.method === "HEAD"); } catch { return new Response("Indisponible", {status:503}); }
  }
  if (url.pathname.startsWith("/media/") && lecture) return servirPhoto(env, url);
  if (estRouteMcp(url.pathname)) return routeMcp(request, env, url);
  if (estRouteSeo(url.pathname) && lecture) return routeSeo(request, env, url);
  if (!url.pathname.startsWith("/api/")) {
    // Choix du public sans JavaScript (/?public=resident) : cookie puis redirection 303.
    if (url.pathname === "/" && url.searchParams.has("public") && lecture) return redirectionPublic(url);
    if (url.pathname === "/mes-vehicules" && lecture) return servirFichier(request, env, url, "/vendre");
    if (PAGES_MARKETPLACE.includes(url.pathname) && lecture) return marketplacePage(url.pathname);
    return servirFichier(request, env, url);
  }
  try {
    return await routeApi(request, env, url, ctx);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    if (String(error).includes("marketplace_one") || String(error).includes("UNIQUE constraint failed: vehicle_offers")) {
      return json({ error: "Une offre incompatible existe déjà." }, 409);
    }
    // Le message et la pile d'une erreur D1/R2 peuvent contenir des données privées.
    console.error("worker_request_failed");
    return json({ error: "Erreur interne, réessaie plus tard." }, 500);
  }
}

// alias : autre fichier servi à cette adresse (/mes-vehicules sert l'espace vendeur /vendre).
async function servirFichier(request, env, url, alias) {
  // Accueil : le rendu dépend du cookie « public » ; pas de 304 sur le fichier statique, qui ne change pas avec lui.
  const accueilDemande = url.pathname === "/" && request.method === "GET";
  const sansConditions = () => {
    const entetes = new Headers(request.headers);
    entetes.delete("If-None-Match");
    entetes.delete("If-Modified-Since");
    return new Request(request.url, { method: request.method, headers: entetes });
  };
  const reponse = await env.ASSETS.fetch(alias ? new Request(new URL(alias, url), request) : accueilDemande ? sansConditions() : request);
  if (reponse.status === 404 && (request.headers.get("Accept") || "").includes("text/html")) return page404();
  if (["/admin", "/admin.html", "/vendre", "/vendre.html", "/admin-vendeurs", "/admin-vendeurs.html"].includes(url.pathname)) {
    const entetes = new Headers(reponse.headers);
    entetes.set("X-Robots-Tag", "noindex, nofollow");
    return new Response(reponse.body, { status: reponse.status, headers: entetes });
  }
  if (!["/", "/index.html"].includes(url.pathname) || !reponse.ok || request.method !== "GET") return reponse;
  // Mode « propositions seules » (LEGACY_AUCTIONS_ENABLED à "false") : l'accueil masque enchères et achat immédiat.
  // Le mode de production est configuré dans wrangler.jsonc.
  const accueil = legacyAuctionsEnabled(env) ? reponse : new HTMLRewriter()
    .on("html", { element: (element) => {
      element.setAttribute("data-proposal-only", "true");
      element.setAttribute("data-free-offers", String(freeOffersEnabled(env)));
    } })
    .transform(reponse);
  if (url.pathname !== "/") return accueil;
  // Accueil : textes, choix du public et cartes des véhicules insérés côté serveur (worker/seo.js), lisibles sans
  // JavaScript.
  return vitrineAccueil(request, env, accueil);
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function routeApi(request, env, url, ctx) {
  const method = request.method;
  const path = url.pathname;
  if (path === "/api/stripe/webhook" && method === "POST") return webhookStripe(request, env);
  if (method !== "GET" && method !== "HEAD") verifierOrigine(request, url);

  if (!legacyAuctionsEnabled(env) && ["/api/deposit/card", "/api/deposit/transfer"].includes(path) && method === "POST") {
    await exigerUtilisateur(request, env);
    throw new ApiError(410, "Les nouveaux dépôts de garantie sont désactivés tant que les enchères le sont.");
  }
  if (proposalRoute(path)) return proposals(request, env, url, {json, ApiError, exigerUtilisateur, lireJson, catalogueComplet});
  if (path.startsWith("/api/marketplace/")) return marketplace(request, env, url, {json, ApiError, exigerUtilisateur, lireJson});
  if (sellerRoutes(path)) {
    const response = await routeSeller(request, env, url, {json, ApiError, exigerUtilisateur, lireJson, sha256, CGV_VERSION});
    const publication = path.match(/^\/api\/admin\/seller\/submissions\/([a-f0-9]{32})\/(publish|archive)$/);
    if (publication && method === "POST" && response.ok) await controlerApresPublication(env, ctx, `SV-${publication[1]}`);
    return response;
  }
  if (estRouteGoogle(path)) return routeGoogle(request, env, url, { json, ApiError, ouvrirSession, reserverInscription, motDePasseInutilisable, adresseIp });
  if (estRouteMandats(path)) return routeMandats(request, env, url, { json, ApiError, exigerUtilisateur, lireJson, catalogueComplet });
  if (path === "/api/me" && method === "GET") return me(request, env);
  if (path === "/api/account/profiles" && method === "POST") return activerProfil(request, env);
  if (path === "/api/catalogue" && method === "GET") {
    return json((await catalogue(request, env)).map((lot) => ({ ...lot, url: cheminVehicule(lot) })));
  }
  if (path === "/api/voitures-europe" && method === "GET") {
    try {
      return await voituresEurope(request, env, url, ctx);
    } catch (error) {
      if (error instanceof ErreurCatalogue) throw new ApiError(error.status, error.message);
      throw error;
    }
  }
  const enchere = path.match(/^\/api\/auctions\/([^/]{1,64})$/);
  if (enchere && method === "GET") return detailEnchere(request, env, decodeURIComponent(enchere[1]));
  if (path.startsWith("/api/admin/")) return routeAdminJournalisee(request, env, path, method, ctx);
  const invoiceDocument = path.match(/^\/api\/invoices\/(\d+)\/document$/);
  if (invoiceDocument && method === "GET") return telechargerFacture(request, env, Number(invoiceDocument[1]));
  if (path === "/api/register" && method === "POST") return register(request, env);
  if (path === "/api/login" && method === "POST") return login(request, env);
  if (path === "/api/logout" && method === "POST") return logout(request, env);
  if (path === "/api/offers" && method === "POST") return createOffer(request, env);
  const retrait = path.match(/^\/api\/offers\/(\d{1,12})$/);
  if (retrait && method === "DELETE") return retirerOffre(request, env, Number(retrait[1]));
  if (path === "/api/terms" && method === "POST") return accepterConditions(request, env);
  if (path === "/api/deposit/card" && method === "POST") return caution_carte(request, env, url);
  if (path === "/api/deposit/transfer" && method === "POST") return caution_virement(request, env);
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

export function json(data, status = 200, headers = {}) {
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
    if(Number(request.headers.get('Content-Length'))>262144)throw new ApiError(413,'JSON trop volumineux.');
    const reader=request.body?.getReader();if(!reader)throw new Error();const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();throw new ApiError(413,'JSON trop volumineux.');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch(e) {if(e instanceof ApiError)throw e;}
  throw new ApiError(400, "Requête illisible.");
}

// Adresse IP du visiteur, fournie par Cloudflare. Une adresse IPv6 est ramenée à son /64 : un abonné en dispose souvent
// d'un entier, qu'il pourrait parcourir pour contourner les limites.
export function adresseIp(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
  if (!ip.includes(":") || ip.includes(".")) return ip;
  const [tete, queue] = ip.toLowerCase().split("::");
  const debut = tete ? tete.split(":") : [];
  const fin = queue ? queue.split(":") : [];
  const groupes = queue === undefined ? debut : [...debut, ...Array(8 - debut.length - fin.length).fill("0"), ...fin];
  return `${groupes.slice(0, 4).map((groupe) => groupe.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export function texte(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// --- Mots de passe et sessions ---

export function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function octetsAleatoires(taille) {
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

export async function sha256(value) {
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
    `SELECT users.id, users.email, users.name, users.phone, users.role, users.terms_version, users.deposit_tnd, users.created_at, users.buyer_enabled, users.seller_enabled FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
  ).bind(await sha256(token), new Date().toISOString()).first();
}

async function exigerUtilisateur(request, env) {
  const user = await utilisateurConnecte(request, env);
  if (!user) throw new ApiError(401, "Connecte-toi à ton compte.");
  if(await env.DB.prepare('SELECT 1 FROM marketplace_suspensions WHERE user_id=?').bind(user.id).first())throw new ApiError(403,'Compte suspendu. Contacter la plateforme.');
  return user;
}

function profil(user) {
  return {
    id: user.id, email: user.email, name: user.name, phone: user.phone || "", role: user.role || "buyer", createdAt: user.created_at,
    termsAccepted: user.terms_version === CGV_VERSION, termsVersion: CGV_VERSION,
    depositTnd: user.deposit_tnd || 0,
    profiles: { buyer: Boolean(user.buyer_enabled), seller: Boolean(user.seller_enabled) }
  };
}

async function activerProfil(request, env) {
  const user = await exigerUtilisateur(request, env);
  const body = await lireJson(request);
  if (!["buyer", "seller"].includes(body.profile)) throw new ApiError(400, "Choisis le profil Acheteur ou Vendeur.");
  const colonne = body.profile === "buyer" ? "buyer_enabled" : "seller_enabled";
  await env.DB.prepare(`UPDATE users SET ${colonne}=1 WHERE id=?`).bind(user.id).run();
  return me(request, env);
}

async function exigerAcheteur(request, env) {
  const user = await exigerUtilisateur(request, env);
  if (!user.buyer_enabled) throw new ApiError(403, "Active ton profil Acheteur pour accéder à cet espace.");
  return user;
}

async function accepterConditions(request, env) {
  const user = await exigerUtilisateur(request, env);
  const body = await lireJson(request);
  if (body.version !== CGV_VERSION) throw new ApiError(409, "Les conditions ont changé : recharge la page pour lire la dernière version.");
  await env.DB.prepare("UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE id = ?")
    .bind(CGV_VERSION, new Date().toISOString(), user.id).run();
  return json({ termsAccepted: true, termsVersion: CGV_VERSION });
}

// --- Dépôt de garantie : carte (Stripe) ou virement ---

// Complément à verser pour pouvoir enchérir sur le lot demandé.
async function montantARegler(request, env, user, body) {
  const lot = await chargerLot(request, env, texte(body.reference, 64));
  if (!lot) throw new ApiError(404, "Lot introuvable.");
  return Math.max(depotRequis(lot) - (user.deposit_tnd || 0), 0);
}

// Crédite la caution et clôt la demande dans une même transaction ; ne fait rien si la demande n'est plus en attente.
async function crediterDepot(env, depositId, methode) {
  const [, clos] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET deposit_tnd = deposit_tnd + (SELECT amount_tnd FROM deposits WHERE id = ?1 AND status = 'pending' AND method = ?2)
       WHERE id = (SELECT user_id FROM deposits WHERE id = ?1 AND status = 'pending' AND method = ?2)`
    ).bind(depositId, methode),
    env.DB.prepare("UPDATE deposits SET status = 'paid', confirmed_at = ? WHERE id = ? AND status = 'pending' AND method = ?")
      .bind(new Date().toISOString(), depositId, methode)
  ]);
  return clos.meta.changes === 1;
}

async function caution_carte(request, env, url) {
  const user = await exigerAcheteur(request, env);
  if (!env.STRIPE_SECRET_KEY) throw new ApiError(503, "Le paiement par carte n'est pas encore disponible. Utilise le virement bancaire.");
  // Stripe n'encaisse pas le dinar : la carte est débitée en euros au taux TND_PER_EUR (dinars pour 1 €), déclaré par le
  // propriétaire. Jamais de taux de secours : sans taux valide, aucune demande n'est créée.
  const taux = Number(env.TND_PER_EUR);
  if (!(Number.isFinite(taux) && taux > 0)) throw new ApiError(503, "Paiement par carte indisponible : taux de change non configuré. Utilise le virement bancaire.");
  const montant = await montantARegler(request, env, user, await lireJson(request));
  if (!montant) throw new ApiError(409, "Ton dépôt de garantie couvre déjà ce véhicule.");
  const centimes = Math.ceil((montant / taux) * 100);
  const depot = await env.DB.prepare("INSERT INTO deposits (user_id, method, amount_tnd, charge_amount, charge_currency) VALUES (?, 'card', ?, ?, 'eur') RETURNING id")
    .bind(user.id, montant, centimes).first();
  let session;
  try {
    session = await new Stripe(env.STRIPE_SECRET_KEY).checkout.sessions.create({
      mode: "payment",
      success_url: `${url.origin}/?caution=ok`,
      cancel_url: `${url.origin}/?caution=annule`,
      client_reference_id: String(depot.id),
      customer_email: user.email,
      metadata: { deposit_id: String(depot.id) },
      integration_identifier: "deposit-checkout-kqzvmwtr",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: centimes,
          product_data: { name: `Dépôt de garantie M&Y AUTO EXPORT (${montant} TND)` }
        }
      }]
    });
  } catch (error) {
    console.error("Stripe", error?.message);
    await env.DB.prepare("UPDATE deposits SET status = 'cancelled' WHERE id = ?").bind(depot.id).run();
    throw new ApiError(502, "Le paiement par carte est momentanément indisponible. Réessaie ou utilise le virement.");
  }
  await env.DB.prepare("UPDATE deposits SET stripe_session_id = ? WHERE id = ?").bind(session.id, depot.id).run();
  return json({ url: session.url });
}

async function signatureStripeValide(corps, entete, secret) {
  const parties = Object.fromEntries((entete || "").split(",").map((p) => p.trim().split("=")).filter((p) => p.length === 2));
  const horodatage = Number(parties.t);
  if (!Number.isFinite(horodatage) || Math.abs(Date.now() / 1000 - horodatage) > 300 || !/^[0-9a-f]{64}$/.test(parties.v1 || "")) return false;
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const attendue = Uint8Array.from(parties.v1.match(/../g).map((o) => parseInt(o, 16)));
  return crypto.subtle.verify("HMAC", cle, attendue, new TextEncoder().encode(`${parties.t}.${corps}`));
}

async function webhookStripe(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new ApiError(503, "Webhook non configuré.");
  const corps = await request.text();
  if (!(await signatureStripeValide(corps, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) {
    throw new ApiError(400, "Signature invalide.");
  }
  const evenement = JSON.parse(corps);
  const session = evenement.data?.object;
  if (session?.object === "checkout.session" && session.id) {
    const depot = await env.DB.prepare("SELECT id, amount_tnd, charge_amount, charge_currency, status FROM deposits WHERE stripe_session_id = ? AND method = 'card'").bind(session.id).first();
    if (depot && depot.status === "pending") {
      const paye = ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(evenement.type)
        && session.payment_status === "paid" && session.amount_total === depot.charge_amount && String(session.currency).toLowerCase() === depot.charge_currency;
      if (paye) await crediterDepot(env, depot.id, "card");
      else if (["checkout.session.expired", "checkout.session.async_payment_failed"].includes(evenement.type)) {
        await env.DB.prepare("UPDATE deposits SET status = 'cancelled' WHERE id = ? AND status = 'pending'").bind(depot.id).run();
      }
    }
  }
  return json({ received: true });
}

async function caution_virement(request, env) {
  const user = await exigerAcheteur(request, env);
  if (!env.BANK_IBAN || !env.BANK_BENEFICIARY) throw new ApiError(503, "Le virement bancaire n'est pas encore disponible. Contacte M&Y AUTO EXPORT.");
  const montant = await montantARegler(request, env, user, await lireJson(request));
  if (!montant) throw new ApiError(409, "Ton dépôt de garantie couvre déjà ce véhicule.");
  // Le montant d'une demande est figé : une demande en attente d'un autre montant est annulée et remplacée (nouvelle
  // référence), celle du même montant est reprise. Une seule transaction : jamais deux demandes en attente.
  const [, , trouve] = await env.DB.batch([
    env.DB.prepare("UPDATE deposits SET status = 'cancelled' WHERE user_id = ?1 AND method = 'transfer' AND status = 'pending' AND amount_tnd <> ?2")
      .bind(user.id, montant),
    env.DB.prepare(
      `INSERT INTO deposits (user_id, method, amount_tnd) SELECT ?1, 'transfer', ?2
       WHERE NOT EXISTS (SELECT 1 FROM deposits WHERE user_id = ?1 AND method = 'transfer' AND status = 'pending')`
    ).bind(user.id, montant),
    env.DB.prepare("SELECT id, amount_tnd FROM deposits WHERE user_id = ? AND method = 'transfer' AND status = 'pending' ORDER BY id DESC LIMIT 1")
      .bind(user.id)
  ]);
  const depot = trouve.results[0];
  return json({
    transfer: {
      id: depot.id, amountTnd: depot.amount_tnd, reference: referenceVirement(depot.id),
      beneficiary: env.BANK_BENEFICIARY, iban: env.BANK_IBAN
    }
  }, 201);
}

// Libellé à porter sur le virement : propre à chaque demande, donc à un montant unique.
function referenceVirement(depositId) {
  return `CAUTION-${depositId}`;
}

async function listerVirements(env) {
  const { results } = await env.DB.prepare(
    `SELECT deposits.id, deposits.user_id, deposits.amount_tnd, deposits.created_at, users.name, users.email, users.phone
     FROM deposits JOIN users ON users.id = deposits.user_id
     WHERE deposits.method = 'transfer' AND deposits.status = 'pending' ORDER BY deposits.created_at`
  ).all();
  return {
    transfers: results.map((row) => ({
      id: row.id, userId: row.user_id, amountTnd: row.amount_tnd, createdAt: row.created_at,
      reference: referenceVirement(row.id), name: row.name, email: row.email, phone: row.phone || ""
    }))
  };
}

// Confirmer exige le montant réellement reçu : il doit être celui de la demande (figé à sa création).
async function deciderVirement(env, id, confirmer, body) {
  if (confirmer) {
    const recu = Number(body.amountTnd);
    if (!Number.isInteger(recu) || recu <= 0 || recu > MAX_OFFER_TND) throw new ApiError(400, "Indique le montant reçu (nombre entier de dinars).");
    const depot = await env.DB.prepare("SELECT amount_tnd FROM deposits WHERE id = ? AND method = 'transfer' AND status = 'pending'").bind(id).first();
    if (!depot) throw new ApiError(404, "Virement introuvable ou déjà traité.");
    if (depot.amount_tnd !== recu) {
      throw new ApiError(409, `Montant reçu (${recu} TND) différent de la demande ${referenceVirement(id)} (${depot.amount_tnd} TND) : rien n'est crédité. Corrige la caution à la main, avec un motif, si besoin.`);
    }
    if (!(await crediterDepot(env, id, "transfer"))) throw new ApiError(404, "Virement introuvable ou déjà traité.");
    return { id, status: "paid" };
  }
  const res = await env.DB.prepare("UPDATE deposits SET status = 'cancelled' WHERE id = ? AND method = 'transfer' AND status = 'pending'").bind(id).run();
  if (res.meta.changes !== 1) throw new ApiError(404, "Virement introuvable ou déjà traité.");
  return { id, status: "cancelled" };
}

// --- Routes ---

async function me(request, env) {
  const user = await utilisateurConnecte(request, env);
  if (!user) return json({ user: null }, 401);
  const [favorites, offers, vehicles, invoices] = await Promise.all([
    env.DB.prepare("SELECT reference FROM favorites WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all(),
    env.DB.prepare("SELECT id, reference, amount_tnd, kind, status, created_at, withdrawn_at FROM offers WHERE user_id = ? ORDER BY id DESC").bind(user.id).all(),
    env.DB.prepare("SELECT id, reference, make, model, trim, status, purchased_at FROM customer_vehicles WHERE user_id = ? ORDER BY purchased_at DESC, id DESC").bind(user.id).all(),
    env.DB.prepare("SELECT id, vehicle_id, invoice_number, issued_at, total_tnd, status, document_key FROM invoices WHERE user_id = ? ORDER BY issued_at DESC, id DESC").bind(user.id).all()
  ]);
  const references = !legacyAuctionsEnabled(env)?[]:[...new Set(offers.results.filter((row) => row.kind === "bid").map((row) => row.reference))];
  const encheres = new Map();
  if (references.length) {
    const [lots, meilleures] = await Promise.all([
      catalogue(request, env),
      env.DB.prepare(
        `SELECT reference, id, MAX(amount_tnd) AS top FROM offers WHERE kind = 'bid' AND status <> 'refused'
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
      const retiree = Boolean(row.withdrawn_at);
      return {
        id: row.id, reference: row.reference, amountTnd: row.amount_tnd, kind: row.kind,
        status: retiree ? "withdrawn" : enchere ? statutEnchere(row, enchere.meilleureId, enchere.auction) : row.status, createdAt: row.created_at,
        canWithdraw: row.kind === "bid" && row.status === "pending" && retraitPossible(enchere?.auction, Date.now())
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
  const user = await exigerAcheteur(request, env);
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

// Place d'inscription réservée en une requête (pas de course entre comptage et enregistrement) et gardée même si
// l'adresse e-mail est déjà prise : les essais d'adresses pour savoir qui est client comptent aussi. Faux : limite atteinte.
async function reserverInscription(env, ip) {
  const maintenant = new Date();
  const [, place] = await env.DB.batch([
    env.DB.prepare("DELETE FROM registrations WHERE at < ?").bind(new Date(maintenant.getTime() - 86400_000).toISOString()),
    env.DB.prepare(
      "INSERT INTO registrations (ip, at) SELECT ?, ? WHERE (SELECT COUNT(*) FROM registrations WHERE ip = ? AND at > ?) < ? RETURNING rowid"
    ).bind(ip, maintenant.toISOString(), ip, new Date(maintenant.getTime() - 3600_000).toISOString(), MAX_INSCRIPTIONS_PAR_IP)
  ]);
  return place.results.length > 0;
}

// Compte créé avec Google : mot de passe aléatoire jamais communiqué, donc inutilisable (connexion par Google seulement).
async function motDePasseInutilisable() {
  const salt = hex(octetsAleatoires(16));
  return { salt, hash: await hacherMotDePasse(hex(octetsAleatoires(32)), salt) };
}

async function register(request, env) {
  const body = await lireJson(request);
  const name = texte(body.name, 80);
  const email = texte(body.email, 254).toLowerCase();
  const phone = texte(body.phone, 30);
  const password = typeof body.password === "string" ? body.password : "";
  const choix = body.accountType ?? "buyer";
  if (!["buyer", "seller", "both"].includes(choix)) throw new ApiError(400, "Choisis Acheteur, Vendeur ou les deux.");
  if (name.length < 2) throw new ApiError(400, "Indique ton nom.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Adresse e-mail invalide.");
  if (phone && !/^[+0-9 ().-]{6,30}$/.test(phone)) throw new ApiError(400, "Numéro de téléphone invalide.");
  if (password.length < 10 || password.length > 200) throw new ApiError(400, "Le mot de passe doit contenir au moins 10 caractères.");
  if (!(await reserverInscription(env, adresseIp(request)))) throw new ApiError(429, "Trop d'inscriptions depuis cette connexion. Réessaie dans une heure.");

  const salt = hex(octetsAleatoires(16));
  const hash = await hacherMotDePasse(password, salt);
  let created;
  try {
    created = await env.DB.prepare(
      "INSERT INTO users (email, name, phone, password_hash, password_salt, buyer_enabled, seller_enabled) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, email, name, phone, role, terms_version, deposit_tnd, created_at, buyer_enabled, seller_enabled"
    ).bind(email, name, phone || null, hash, salt, choix !== "seller" ? 1 : 0, choix !== "buyer" ? 1 : 0).first();
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new ApiError(409, "Un compte existe déjà avec cette adresse e-mail.");
    throw error;
  }
  return json({ user: profil(created), favorites: [], offers: [] }, 201, { "Set-Cookie": await ouvrirSession(env, created.id) });
}

async function login(request, env) {
  const body = await lireJson(request);
  const email = texte(body.email, 254).toLowerCase();
  const user = await verifierMotDePasse(env, email, body.password, adresseIp(request));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_failures WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?").bind(user.id, new Date().toISOString())
  ]);
  const cookie = await ouvrirSession(env, user.id);
  const reponse = await me(new Request(request.url, { headers: { Cookie: cookie.split(";")[0] } }), env);
  return new Response(reponse.body, { status: 200, headers: { ...Object.fromEntries(reponse.headers), "Set-Cookie": cookie } });
}

// Vérifie e-mail et mot de passe (connexion au site, autorisation d'une application MCP), avec limite d'essais.
// Limites par IP : de faux mots de passe tapés ailleurs ne bloquent pas le titulaire du compte. La limite globale du
// compte (attaque répartie) ne s'applique pas aux adresses d'où il s'est déjà connecté.
// L'essai est compté avant le calcul du mot de passe, en une requête : des essais simultanés ne passent pas tous.
export async function verifierMotDePasse(env, email, motDePasse, ip = "inconnue") {
  const password = typeof motDePasse === "string" ? motDePasse.slice(0, 200) : "";
  const maintenant = new Date();
  const depuis = new Date(maintenant.getTime() - 15 * 60_000).toISOString();
  const essai = await env.DB.prepare(
    `INSERT INTO login_failures (email, ip, at) SELECT ?, ?, ?
     WHERE (SELECT COUNT(*) FROM login_failures WHERE at > ? AND email = ? AND ip = ?) < ?
       AND (SELECT COUNT(*) FROM login_failures WHERE at > ? AND ip = ?) < ?
       AND ((SELECT COUNT(*) FROM login_failures WHERE at > ? AND email = ?) < ?
         OR EXISTS (SELECT 1 FROM login_known_ips WHERE email = ? AND ip = ?))
     RETURNING rowid`
  ).bind(email, ip, maintenant.toISOString(), depuis, email, ip, MAX_LOGIN_FAILURES, depuis, ip, MAX_ECHECS_PAR_IP,
    depuis, email, MAX_ECHECS_PAR_COMPTE, email, ip).first();
  if (!essai) throw new ApiError(429, "Trop de tentatives. Réessaie dans 15 minutes.");

  const user = await env.DB.prepare("SELECT id, role, password_hash, password_salt FROM users WHERE email = ?").bind(email).first();
  // Même calcul que l'adresse existe ou non, pour ne pas révéler les comptes par le temps de réponse.
  const hash = await hacherMotDePasse(password, user ? user.password_salt : "00".repeat(16));
  if (!user || !egaliteConstante(hash, user.password_hash)) {
    await env.DB.prepare("DELETE FROM login_failures WHERE at < ?").bind(new Date(maintenant.getTime() - 86400_000).toISOString()).run();
    throw new ApiError(401, "E-mail ou mot de passe incorrect.");
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_failures WHERE rowid = ?").bind(essai.rowid),
    env.DB.prepare(
      "INSERT INTO login_known_ips (email, ip, at) VALUES (?, ?, ?) ON CONFLICT(email, ip) DO UPDATE SET at = excluded.at"
    ).bind(email, ip, maintenant.toISOString()),
    env.DB.prepare("DELETE FROM login_known_ips WHERE at < ?").bind(new Date(maintenant.getTime() - 180 * 86400_000).toISOString())
  ]);
  return { id: user.id, role: user.role };
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
export async function catalogueComplet(request, env) {
  const [fichier, base] = await Promise.all([
    lotsFichier(request, env),
    env.DB.prepare("SELECT reference, data, removed, updated_at,EXISTS(SELECT 1 FROM vehicle_offer_owners ow WHERE ow.vehicle_id=vehicles.reference) AS offer_owner_assigned FROM vehicles").all()
  ]);
  const lignes = new Map(base.results.map((row) => [row.reference, row]));
  const resultat = fichier.map((lot) => {
    const row = lignes.get(lot.reference);
    lignes.delete(lot.reference);
    return row ? { lot: JSON.parse(row.data), source: "base", removed: Boolean(row.removed), updatedAt: row.updated_at,offerOwnerAssigned:Boolean(row.offer_owner_assigned) } : { lot, source: "fichier", removed: false };
  });
  for (const row of lignes.values()) {
    resultat.push({ lot: JSON.parse(row.data), source: "base", removed: Boolean(row.removed), updatedAt: row.updated_at,offerOwnerAssigned:Boolean(row.offer_owner_assigned) });
  }
  // Annonces vendeur : visibles seulement publiées, diagnostic valide et vendeur non suspendu.
  const rows = await env.DB.prepare("SELECT s.id, s.stage, x.user_id AS suspended FROM seller_submissions s LEFT JOIN marketplace_suspensions x ON x.user_id = s.user_id").all();
  const sellerRows = new Map(rows.results.map((r) => ["SV-" + r.id, r]));
  const checked = await verifiedSellerLots(env, resultat);
  return Promise.all(checked.map(async (item) => {
    if (!item.lot.reference.startsWith("SV-")) return item;
    const row = sellerRows.get(item.lot.reference);
    const valid = Boolean(row && row.stage === "published" && !row.suspended && await diagnosticValid(env, row.id));
    return { ...item, sellerUnavailable: !valid, removed: item.removed || !valid };
  }));
}

// Lots publics, avec l'état de leur enchère (prix actuel, fin effective…) pour les lots open et upcoming.
async function catalogue(request, env) {
  // Mandat (réglage mandats_actifs) : véhicules de M&Y ; avec les enchères actives, ceux en stock seulement, les ventes
  // en cours continuant jusqu'à leur fin.
  const mandats = await reglageActif(env, "mandats_actifs");
  if(!legacyAuctionsEnabled(env))return (await catalogueComplet(request,env)).filter(item=>!item.removed&&(freeOffersEnabled(env)||item.offerOwnerAssigned||item.lot.status!=='open'||!item.lot.endsAt||Date.parse(item.lot.endsAt)>Date.now())).map(item=>({...lot1Public(item.lot),url:cheminVehicule(item.lot),mandat:vehiculeMandat(item,mandats)}));
  const [items, resumes] = await Promise.all([catalogueComplet(request, env), resumesEncheres(env)]);
  const maintenant = Date.now();
  return items.filter((item) => !item.removed).map((item) => ({ ...avecEnchere(item.lot, resumes, maintenant), mandat: vehiculeMandat(item, mandats) && item.lot.status === "stock" }));
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

export async function resumesEncheres(env) {
  const { results } = await env.DB.prepare(
    `SELECT reference, SUM(status <> 'refused') AS n, MAX(CASE WHEN status <> 'refused' THEN amount_tnd END) AS top,
            MAX(created_at) AS last FROM offers WHERE kind = 'bid' GROUP BY reference`
  ).all();
  return new Map(results.map((row) => [row.reference, row]));
}

// Fin effective : la date prévue, repoussée à 2 minutes après la dernière enchère si celle-ci est arrivée tard.
// La dernière enchère compte même refusée : refuser une enchère fantaisiste de dernière minute laisse aux autres
// acheteurs le temps de surenchérir au prix réel.
// Chaque enchère acceptée l'a été avant la fin effective du moment, d'où ce calcul à partir de la seule dernière.
export function etatEnchere(lot, resume, maintenant) {
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
    reserveMet: Number.isFinite(lot.reservePriceTnd) ? top != null && top >= lot.reservePriceTnd : null,
    depositRequiredTnd: depotRequis(lot)
  };
}

async function etiquettesEncherisseurs(env, reference) {
  const { results } = await env.DB.prepare(
    "SELECT user_id, MIN(created_at) AS premiere FROM offers WHERE reference = ? AND kind = 'bid' GROUP BY user_id ORDER BY premiere"
  ).bind(reference).all();
  return new Map(results.map((row, index) => [row.user_id, `Enchérisseur ${index + 1}`]));
}

async function detailEnchere(request, env, reference) {
  if(!legacyAuctionsEnabled(env))throw new ApiError(410,"Les enchères sont désactivées pendant le Lot 1.");
  const lot = await chargerLot(request, env, reference);
  if (!lot?.auction) throw new ApiError(404, "Aucune enchère pour ce lot.");
  const [user, etiquettes, { results }] = await Promise.all([
    utilisateurConnecte(request, env),
    etiquettesEncherisseurs(env, reference),
    env.DB.prepare("SELECT user_id, amount_tnd, created_at FROM offers WHERE reference = ? AND kind = 'bid' AND status <> 'refused' ORDER BY amount_tnd DESC, created_at ASC LIMIT 30")
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

// Retrait possible tant qu'il reste au moins 12 h avant la fin effective de la vente.
function retraitPossible(auction, maintenant) {
  if (auction?.status !== "live") return false;
  const fin = Date.parse(auction.endsAt);
  return Number.isFinite(fin) && fin - maintenant >= RETRAIT_MIN_MS;
}

async function retirerOffre(request, env, offreId) {
  const user = await exigerAcheteur(request, env);
  const offre = await env.DB.prepare("SELECT id, reference, kind, status FROM offers WHERE id = ? AND user_id = ?").bind(offreId, user.id).first();
  if (!offre) throw new ApiError(404, "Offre introuvable.");
  if (offre.kind !== "bid") throw new ApiError(400, "Un achat immédiat n'est pas révocable : seule une enchère d'une vente ouverte peut être retirée.");
  if (offre.status !== "pending") throw new ApiError(409, "Cette offre a déjà été traitée ou retirée.");
  const lot = await chargerLot(request, env, offre.reference);
  if (!retraitPossible(lot?.auction, Date.now())) {
    throw new ApiError(403, "Une enchère ne peut plus être retirée moins de 12 heures avant la fin de la vente.");
  }
  const { meta } = await env.DB.prepare("UPDATE offers SET status = 'refused', withdrawn_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'")
    .bind(new Date().toISOString(), offreId, user.id).run();
  if (meta.changes !== 1) throw new ApiError(409, "Cette offre a déjà été traitée ou retirée.");
  const auction = etatEnchere(lot, (await resumesEncheres(env)).get(offre.reference), Date.now());
  return json({ id: offreId, status: "withdrawn", auction });
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

// Chaque requête d'écriture d'un administrateur connecté est journalisée (acteur admin), réussie ou non. Les requêtes
// non authentifiées ne le sont pas : elles ne doivent pas pouvoir remplir le journal.
async function routeAdminJournalisee(request, env, path, method, ctx) {
  if (method === "GET" || method === "HEAD") return routeAdmin(request, env, path, method, ctx);
  const admin = await utilisateurConnecte(request, env);
  if (admin?.role !== "admin") return routeAdmin(request, env, path, method, ctx);
  const trace = { acteur: "admin", acteurId: admin.id, action: `${method} ${path}`, reference: decodeURIComponent(path.split("/").at(-1)) };
  try {
    const reponse = await routeAdmin(request, env, path, method, ctx);
    await journaliser(env, { ...trace, resultat: reponse.ok ? "ok" : "erreur", details: { status: reponse.status } });
    return reponse;
  } catch (error) {
    const refuse = error instanceof ApiError && error.status < 500;
    await journaliser(env, { ...trace, resultat: refuse ? "refuse" : "erreur", details: { status: error instanceof ApiError ? error.status : 500 } });
    throw error;
  }
}

async function routeAdmin(request, env, path, method, ctx) {
  const user = await exigerAdmin(request, env);
  if (path === "/api/admin/prix" || path.startsWith("/api/admin/prix/")) return routeAdminPrix(request, env, path, method, user, { json, ApiError, lireJson });
  if (path === "/api/admin/import" || path.startsWith("/api/admin/import/")) {
    try {
      return await routeAdminImport(request, env, new URL(request.url), user, { json, ApiError, lireJson, enregistrerBrouillon });
    } catch (error) {
      if (error instanceof ErreurCatalogue) throw new ApiError(error.status, error.message);
      throw error;
    }
  }
  if (path === "/api/admin/mandats" || path.startsWith("/api/admin/mandats/")) return routeAdminMandats(request, env, new URL(request.url), user, { json, ApiError, lireJson, catalogueComplet });
  if (path === "/api/admin/reglages" && method === "GET") return json({ reglages: await listerReglages(env) });
  const reglage = path.match(/^\/api\/admin\/reglages\/([a-z_]{1,64})$/);
  if (reglage && method === "PUT") {
    if (!Object.hasOwn(REGLAGES_INTERRUPTEURS, reglage[1])) throw new ApiError(404, "Réglage inconnu.");
    const { valeur } = await lireJson(request);
    if (typeof valeur !== "boolean") throw new ApiError(400, "Valeur attendue : vrai ou faux.");
    await ecrireInterrupteur(env, reglage[1], valeur, user.id);
    return json({ reglages: await listerReglages(env) });
  }
  // Rubrique « Site » : WhatsApp, public par défaut, affichage des prix, témoignages.
  if (path === "/api/admin/site" && method === "GET") return json({ reglages: await listerReglagesSite(env) });
  const reglageSite = path.match(/^\/api\/admin\/site\/([a-z_]{1,64})$/);
  if (reglageSite && method === "PUT") {
    if (!Object.hasOwn(REGLAGES_SITE, reglageSite[1])) throw new ApiError(404, "Réglage inconnu.");
    const { valeur } = await lireJson(request);
    const { texte, erreur } = validerReglageSite(reglageSite[1], valeur);
    if (erreur) throw new ApiError(400, erreur);
    await ecrireReglageSite(env, reglageSite[1], texte, user.id);
    return json({ reglages: await listerReglagesSite(env) });
  }
  if (path.includes("/auctions/") && !legacyAuctionsEnabled(env)) throw new ApiError(410, "Les enchères sont désactivées pendant le Lot 1.");
  if (path === "/api/admin/seo" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT ran_at, declencheur, ok, resume FROM seo_journal ORDER BY id DESC LIMIT 30").all();
    return json({ controles: results.map((row) => ({ ranAt: row.ran_at, declencheur: row.declencheur, ok: Boolean(row.ok), ...JSON.parse(row.resume) })) });
  }
  if (path === "/api/admin/vehicles" && method === "GET") {
    const [items, resumes] = await Promise.all([catalogueComplet(request, env), resumesEncheres(env)]);
    const maintenant = Date.now();
    const vehicles = items.map((item) => ({ ...item, auction: legacyAuctionsEnabled(env)?etatEnchere(item.lot, resumes.get(item.lot.reference), maintenant):null }));
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
  if (vehicule && method === "PUT") return json(await enregistrerVehicule(env, user, decodeURIComponent(vehicule[1]), await lireJson(request), ctx));
  if (vehicule && method === "DELETE") return json(await retirerVehicule(request, env, user, decodeURIComponent(vehicule[1]), ctx));
  if (path === "/api/admin/offers" && method === "GET") return json(await listerOffres(request, env, new URL(request.url).searchParams.get("reference")));
  const decision = path.match(/^\/api\/admin\/offers\/(\d+)\/(accept|refuse)$/);
  if (decision && method === "POST") {
    const body = await lireJson(request).catch(() => ({}));
    return json(await deciderOffre(request, env, user, Number(decision[1]), decision[2] === "accept", body.removeFromSite !== false));
  }
  const caution = path.match(/^\/api\/admin\/users\/(\d+)\/deposit$/);
  if (caution && method === "POST") {
    const body = await lireJson(request);
    const amount = Number(body.amountTnd);
    if (!Number.isInteger(amount) || amount < 0 || amount > MAX_OFFER_TND) throw new ApiError(400, "Montant invalide (nombre entier de dinars).");
    const motif = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!motif || motif.length > MAX_MOTIF_CAUTION) throw new ApiError(400, `Motif obligatoire (${MAX_MOTIF_CAUTION} caractères au plus).`);
    // Journal puis solde dans la même transaction : l'ancienne valeur est lue juste avant l'écriture, sans fenêtre.
    const acheteur = Number(caution[1]);
    const [, maj] = await env.DB.batch([
      env.DB.prepare("INSERT INTO deposit_adjustments (user_id, previous_tnd, new_tnd, reason, actor_id) SELECT id, deposit_tnd, ?, ?, ? FROM users WHERE id = ?")
        .bind(amount, motif, user.id, acheteur),
      env.DB.prepare("UPDATE users SET deposit_tnd = ? WHERE id = ? RETURNING id, deposit_tnd").bind(amount, acheteur)
    ]);
    const row = maj.results[0];
    if (!row) throw new ApiError(404, "Acheteur introuvable.");
    return json({ userId: row.id, depositTnd: row.deposit_tnd });
  }
  if (path === "/api/admin/deposits" && method === "GET") return json(await listerVirements(env));
  const virement = path.match(/^\/api\/admin\/deposits\/(\d+)\/(confirm|cancel)$/);
  if (virement && method === "POST") {
    const body = virement[2] === "confirm" ? await lireJson(request) : {};
    return json(await deciderVirement(env, Number(virement[1]), virement[2] === "confirm", body));
  }
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
export async function listerOffres(request, env, reference) {
  const [items, resumes, etiquettes, { results }] = await Promise.all([
    catalogueComplet(request, env),
    resumesEncheres(env),
    reference ? etiquettesEncherisseurs(env, reference) : Promise.resolve(null),
    env.DB.prepare(
      `SELECT offers.id, offers.reference, offers.kind, offers.amount_tnd, offers.status, offers.created_at, offers.withdrawn_at, offers.user_id,
              users.name, users.email, users.phone, users.deposit_tnd FROM offers JOIN users ON users.id = offers.user_id
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
      auction: legacyAuctionsEnabled(env)?etatEnchere(item.lot, resumes.get(item.lot.reference), maintenant):null
    };
  }
  const meilleures = new Map();
  for (const row of results) {
    if (row.kind === "bid" && row.status !== "refused" && !meilleures.has(row.reference)) meilleures.set(row.reference, row.id);
  }
  return {
    lots,
    offers: results.map((row) => ({
      id: row.id, reference: row.reference, kind: row.kind, amountTnd: row.amount_tnd, status: row.withdrawn_at ? "withdrawn" : row.status, createdAt: row.created_at,
      best: meilleures.get(row.reference) === row.id, bidder: etiquettes?.get(row.user_id) || null,
      name: row.name, email: row.email, phone: row.phone || "", userId: row.user_id, depositTnd: row.deposit_tnd || 0
    }))
  };
}

// Accepter une offre : les autres offres en attente du véhicule sont refusées, le véhicule rejoint « Mes véhicules »
// de l'acheteur et, si demandé, il est retiré du site. Refuser : l'offre seule passe en « refusée ».
export async function deciderOffre(request, env, user, offreId, accepter, retirerDuSite = true) {
  if(!legacyAuctionsEnabled(env))throw new ApiError(410,"Les décisions du module historique sont désactivées pendant le Lot 1.");
  const offre = await env.DB.prepare("SELECT id, user_id, reference, kind, amount_tnd, status FROM offers WHERE id = ?").bind(offreId).first();
  if (!offre) throw new ApiError(404, "Offre introuvable.");
  if (offre.status !== "pending") throw new ApiError(409, "Cette offre a déjà été traitée.");
  const maintenant = new Date().toISOString();
  if (!accepter) {
    const { meta } = await env.DB.prepare("UPDATE offers SET status = 'refused', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'")
      .bind(maintenant, user.id, offreId).run();
    if (meta.changes !== 1) throw new ApiError(409, "Cette offre a déjà été traitée.");
    return { id: offreId, status: "refused" };
  }

  const item = (await catalogueComplet(request, env)).find((entry) => entry.lot.reference === offre.reference);
  if (!item) throw new ApiError(404, "Véhicule introuvable.");
  const dejaVendu = await env.DB.prepare("SELECT id FROM offers WHERE reference = ? AND status = 'accepted'").bind(offre.reference).first();
  if (dejaVendu) throw new ApiError(409, "Une offre a déjà été acceptée pour ce véhicule.");
  if (offre.kind === "bid") {
    const auction = etatEnchere(item.lot, (await resumesEncheres(env)).get(offre.reference), Date.now());
    if (auction?.status === "live") throw new ApiError(409, "La vente est encore en cours : attends sa fin pour accepter une enchère.");
    const meilleure = await env.DB.prepare(MEILLEURE_ENCHERE).bind(offre.reference).first();
    if (meilleure?.id !== offre.id) throw new ApiError(409, "Seule la meilleure enchère peut être acceptée.");
  }

  // Les vérifications ci-dessus donnent un message clair ; c'est la batch qui décide. Elle s'exécute en une transaction :
  // la première requête n'accepte l'offre que si elle est toujours en attente, la meilleure enchère et seule acceptée
  // du véhicule (index offers_une_acceptee en plus) ; les suivantes n'agissent que si c'est cette décision-ci qui l'a acceptée.
  const decisionPrise = "EXISTS (SELECT 1 FROM offers WHERE id = ? AND status = 'accepted' AND decided_at = ? AND decided_by = ?)";
  const decision = [offreId, maintenant, user.id];
  const requetes = [
    env.DB.prepare(
      `UPDATE offers SET status = 'accepted', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM offers WHERE reference = ? AND status = 'accepted')
       AND (kind <> 'bid' OR id = (${MEILLEURE_ENCHERE}))`
    ).bind(maintenant, user.id, offreId, offre.reference, offre.reference),
    env.DB.prepare(
      `UPDATE offers SET status = 'refused', decided_at = ?, decided_by = ? WHERE reference = ? AND id <> ? AND status = 'pending' AND ${decisionPrise}`
    ).bind(maintenant, user.id, offre.reference, offreId, ...decision),
    env.DB.prepare(
      `INSERT INTO customer_vehicles (user_id, reference, make, model, trim, status, purchased_at)
       SELECT ?, ?, ?, ?, ?, 'purchased', ? WHERE ${decisionPrise}
       ON CONFLICT(user_id, reference) DO NOTHING`
    ).bind(offre.user_id, offre.reference, item.lot.make, item.lot.model, item.lot.trim || null, maintenant, ...decision)
  ];
  if (retirerDuSite) {
    requetes.push(env.DB.prepare(
      `INSERT INTO vehicles (reference, data, removed, updated_at, updated_by) SELECT ?, ?, 1, ?, ? WHERE ${decisionPrise}
       ON CONFLICT(reference) DO UPDATE SET removed = 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(offre.reference, JSON.stringify(item.lot), maintenant, user.id, ...decision));
  }
  let resultats;
  try {
    resultats = await env.DB.batch(requetes);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new ApiError(409, "Une offre a déjà été acceptée pour ce véhicule.");
    throw error;
  }
  if (resultats[0].meta.changes !== 1) {
    throw new ApiError(409, "Cette offre ne peut plus être acceptée : une autre décision vient d'être enregistrée pour ce véhicule.");
  }
  return { id: offreId, status: "accepted", removedFromSite: retirerDuSite };
}

// Meilleure enchère d'un véhicule : la plus haute, la plus ancienne à montant égal (même ordre que listerOffres).
// Une enchère refusée ne compte plus : refuser une enchère fantaisiste rend la vente à la suivante.
const MEILLEURE_ENCHERE = "SELECT id FROM offers WHERE reference = ? AND kind = 'bid' AND status <> 'refused' ORDER BY amount_tnd DESC, created_at ASC, id ASC LIMIT 1";

const STATUTS = ["open", "upcoming", "stock"];
const ETATS_VEHICULE = ["new", "used", "accident", "damaged"];

function nombre(value, nom) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new ApiError(400, `${nom} : nombre invalide.`);
  return n;
}

function photoValide(url) {
  return typeof url === "string" && url.length <= 500
    && (/^https:\/\/[^\s"'<>]+$/.test(url) || /^\/media\/vehicules\/[A-Za-z0-9._-]+\/[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(url) || /^\/seller-media\/[a-f0-9]{32}$/.test(url) || /^photos\/[^/]+$/.test(url));
}

// Ne garde que les champs connus, vérifiés comme le fait la page publique (lotValide).
function validerVehicule(body, reference) {
  const lot = { reference };
  const champs = { make: "Marque", model: "Modèle", trim: null, fuel: null, bodyType: null, country: null, transmission: null, color: null, pickupLocation: null, seller: null, availableFrom: null };
  for (const [cle, obligatoire] of Object.entries(champs)) {
    const valeur = texte(body[cle], 120);
    if (obligatoire && !valeur) throw new ApiError(400, `${obligatoire} obligatoire.`);
    if (valeur) lot[cle] = valeur;
  }
  if (body.condition !== undefined && body.condition !== null && body.condition !== "") {
    if (!ETATS_VEHICULE.includes(body.condition)) throw new ApiError(400, "État du véhicule invalide.");
    lot.condition = body.condition;
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
  for (const [cle, nom] of [["mileageKm", "Kilométrage"], ["indicativePriceTnd", "Prix"], ["startingPriceTnd", "Mise à prix"], ["reservePriceTnd", "Prix de réserve"], ["buyNowPriceTnd", "Achat immédiat"], ["bidIncrementTnd", "Pas d'enchère"], ["prixEur", "Prix d'achat en EUR"]]) {
    const valeur = nombre(body[cle], nom);
    if (valeur !== null) lot[cle] = valeur;
  }
  for (const [cle, nom, max] of [["powerHp", "Puissance", 5000], ["engineCc", "Cylindrée", 20000], ["doors", "Nombre de portes", 9], ["seats", "Nombre de sièges", 99]]) {
    const valeur = nombre(body[cle], nom);
    if (valeur === null) continue;
    if (!Number.isInteger(valeur) || valeur < 1 || valeur > max) throw new ApiError(400, `${nom} : valeur invalide.`);
    lot[cle] = valeur;
  }
  // Date de première immatriculation (AAAA-MM-JJ) : âge exact du véhicule pour l'éligibilité des prix estimés.
  const immatriculation = texte(body.premiereImmatriculation, 20);
  if (immatriculation) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(immatriculation) || !Number.isFinite(Date.parse(immatriculation))) throw new ApiError(400, "Date de première immatriculation invalide (AAAA-MM-JJ).");
    lot.premiereImmatriculation = immatriculation;
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

// ctx absent (outil MCP) : le contrôle SEO est attendu avant la réponse au lieu de tourner en arrière-plan.
export async function enregistrerVehicule(env, user, reference, body, ctx) {
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(reference)) throw new ApiError(400, "Référence invalide (lettres, chiffres, . _ - ; 40 caractères maximum).");
  if(reference.startsWith('SV-'))throw new ApiError(409,'Les annonces vendeur passent par la validation marketplace.');
  const lot = validerVehicule(body, reference);
  // Annonce importée (worker/import-openlane.js) : la source suivie est gardée quand l'administration la modifie.
  const existant = await env.DB.prepare("SELECT json_extract(data, '$.importSource') AS source FROM vehicles WHERE reference = ?").bind(reference).first();
  if (existant?.source) lot.importSource = { ...JSON.parse(existant.source), termine: false };
  await env.DB.prepare(
    `INSERT INTO vehicles (reference, data, removed, updated_at, updated_by) VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(reference) DO UPDATE SET data = excluded.data, removed = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(reference, JSON.stringify(lot), new Date().toISOString(), user.id).run();
  await controlerApresPublication(env, ctx, reference);
  return { vehicle: lot, url: cheminVehicule(lot) };
}

// Brouillon d'une annonce importée : véhicule retiré (invisible du public) jusqu'à sa remise en ligne depuis /admin.
// Faux si la référence existe déjà (annonce déjà importée).
export async function enregistrerBrouillon(env, user, reference, corps, source) {
  const lot = { ...validerVehicule(corps, reference), importSource: source };
  const resultat = await env.DB.prepare(
    "INSERT INTO vehicles (reference, data, removed, updated_at, updated_by) VALUES (?, ?, 1, ?, ?) ON CONFLICT(reference) DO NOTHING"
  ).bind(reference, JSON.stringify(lot), new Date().toISOString(), user.id ?? null).run();
  return resultat.meta.changes > 0;
}

export async function retirerVehicule(request, env, user, reference, ctx) {
  const existant = (await catalogueComplet(request, env)).find((item) => item.lot.reference === reference);
  if (!existant) throw new ApiError(404, "Véhicule introuvable.");
  await env.DB.prepare(
    `INSERT INTO vehicles (reference, data, removed, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(reference) DO UPDATE SET removed = 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(reference, JSON.stringify(existant.lot), new Date().toISOString(), user.id).run();
  await controlerApresPublication(env, ctx, reference);
  return { reference, removed: true };
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
  const user = await exigerAcheteur(request, env);
  if (ajouter) {
    if (!(await chargerLot(request, env, reference))) throw new ApiError(404, "Lot introuvable.");
    await env.DB.prepare("INSERT OR IGNORE INTO favorites (user_id, reference) VALUES (?, ?)").bind(user.id, reference).run();
  } else {
    await env.DB.prepare("DELETE FROM favorites WHERE user_id = ? AND reference = ?").bind(user.id, reference).run();
  }
  return json({ reference, favorite: ajouter });
}

async function createOffer(request, env) {
  const user = await exigerAcheteur(request, env);
  if(!legacyAuctionsEnabled(env))throw new ApiError(410,"Utilisez Proposer une offre ; les enchères et achats automatiques sont désactivés pendant le Lot 1.");
  const body = await lireJson(request);
  const reference = texte(body.reference, 64);
  if(reference.startsWith('SV-'))throw new ApiError(409,'Utiliser les offres privées marketplace.');
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
  if ((user.deposit_tnd || 0) < etat.depositRequiredTnd) {
    throw new ApiError(403, `Un dépôt de garantie de ${etat.depositRequiredTnd} TND est nécessaire pour enchérir sur ce véhicule.`);
  }
  if (amount < etat.minNextBidTnd) throw new ApiError(400, `L'enchère minimale est de ${etat.minNextBidTnd} TND.`);

  // Vérification et insertion en une seule requête : deux enchères simultanées ne peuvent pas passer toutes les deux.
  const offer = await env.DB.prepare(
    `INSERT INTO offers (user_id, reference, amount_tnd, kind, created_at)
     SELECT ?, ?, ?, 'bid', ?
     WHERE ? >= COALESCE((SELECT MAX(amount_tnd) FROM offers WHERE reference = ? AND kind = 'bid' AND status <> 'refused') + ?, ?)
     RETURNING id, reference, amount_tnd, kind, created_at`
  ).bind(user.id, lot.reference, amount, new Date().toISOString(), amount, lot.reference, etat.incrementTnd, etat.minNextBidTnd).first();
  if (!offer) throw new ApiError(409, "Une enchère plus haute vient d'être placée. Le prix a été mis à jour, réessaie.");

  const auction = etatEnchere(lot, (await resumesEncheres(env)).get(lot.reference), Date.now());
  return json({
    offer: {
      id: offer.id, reference: offer.reference, amountTnd: offer.amount_tnd, kind: offer.kind, status: "leading", createdAt: offer.created_at,
      canWithdraw: retraitPossible(auction, Date.now())
    },
    auction
  }, 201);
}
