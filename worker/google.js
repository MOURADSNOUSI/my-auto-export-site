// Connexion avec Google (OpenID Connect, code d'autorisation + PKCE, sans script Google dans les pages).
// GOOGLE_CLIENT_ID (variable) et GOOGLE_CLIENT_SECRET (wrangler secret) : sans eux, le bouton est masqué et les routes
// répondent 404. Adresses de Google surchargeables (GOOGLE_URL_AUTH, GOOGLE_URL_TOKEN) pour les tests.
// Le jeton d'identité est reçu directement du point de terminaison de Google en HTTPS : sa signature n'est pas
// vérifiée (OpenID Connect Core 3.1.3.7), mais l'émetteur, le destinataire, l'expiration et l'e-mail vérifié le sont.
import { journaliser } from "./reglages.js";

const URL_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const URL_TOKEN = "https://oauth2.googleapis.com/token";
const EMETTEURS = ["https://accounts.google.com", "accounts.google.com"];
const COOKIE = "google_etat";
const DUREE_ETAT = 600; // secondes
const CHEMIN_RETOUR = "/api/auth/google/retour";

export const estRouteGoogle = (path) => path === "/api/auth/google" || path.startsWith("/api/auth/google/");
const actif = (env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

const base64url = (octets) => btoa(String.fromCharCode(...new Uint8Array(octets))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function decoderJwt(jeton) {
  const morceau = String(jeton || "").split(".")[1];
  if (!morceau) return null;
  try {
    const texte = atob(morceau.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(morceau.length / 4) * 4, "="));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(texte, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

// Page de retour après connexion : chemin du site uniquement (pas de redirection ouverte vers un autre domaine).
export function retourSur(valeur) {
  const chemin = typeof valeur === "string" ? valeur : "";
  return /^\/(?![/\\])[A-Za-z0-9/_\-.?=&%]{0,200}$/.test(chemin) ? chemin : "/";
}

function avecParametre(chemin, cle, valeur) {
  const url = new URL(chemin, "https://exemple.invalid");
  url.searchParams.set(cle, valeur);
  return `${url.pathname}${url.search}`;
}

function lireCookie(request, nom) {
  const morceau = (request.headers.get("Cookie") || "").split(";").map((m) => m.trim()).find((m) => m.startsWith(`${nom}=`));
  return morceau ? morceau.slice(nom.length + 1) : "";
}

const redirection = (location, cookies = []) => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
};
const effacerEtat = `${COOKIE}=; Path=${CHEMIN_RETOUR}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// Contrôle des informations d'identité reçues de Google. Renvoie { compte } ou { motif }.
export function verifierIdentite(info, clientId, maintenant = Date.now()) {
  if (!info) return { motif: "jeton illisible" };
  if (!EMETTEURS.includes(info.iss)) return { motif: "émetteur inattendu" };
  if (info.aud !== clientId) return { motif: "destinataire inattendu" };
  if (!Number.isFinite(info.exp) || info.exp * 1000 < maintenant) return { motif: "jeton expiré" };
  if (typeof info.sub !== "string" || !/^[0-9]{1,64}$/.test(info.sub)) return { motif: "identifiant Google invalide" };
  const email = typeof info.email === "string" ? info.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { motif: "e-mail absent" };
  if (info.email_verified !== true && info.email_verified !== "true") return { motif: "e-mail non vérifié par Google" };
  const nom = typeof info.name === "string" && info.name.trim().length >= 2 ? info.name.trim().slice(0, 80) : email.split("@")[0].slice(0, 80);
  return { compte: { sub: info.sub, email, nom } };
}

// deps : fonctions du Worker (sessions, limite d'inscription par IP, mot de passe inutilisable).
export async function routeGoogle(request, env, url, { json, ApiError, ouvrirSession, reserverInscription, motDePasseInutilisable, adresseIp }) {
  if (url.pathname === "/api/auth/google/etat" && request.method === "GET") return json({ actif: actif(env) });
  // Non configurée : retour sur la page de départ avec un message, plutôt qu'une réponse JSON dans le navigateur.
  if (!actif(env)) return redirection(avecParametre(retourSur(url.searchParams.get("retour")), "connexion", "indisponible"));

  if (url.pathname === "/api/auth/google" && request.method === "GET") {
    const etat = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const verificateur = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const defi = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificateur)));
    const maintenant = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM google_etats WHERE expire < ?").bind(new Date(maintenant).toISOString()),
      env.DB.prepare("INSERT INTO google_etats (etat_hash, verificateur, retour, expire) VALUES (?, ?, ?, ?)")
        .bind(await empreinte(etat), verificateur, retourSur(url.searchParams.get("retour")), new Date(maintenant + DUREE_ETAT * 1000).toISOString())
    ]);
    const cible = new URL(env.GOOGLE_URL_AUTH || URL_AUTH);
    for (const [cle, valeur] of Object.entries({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${url.origin}${CHEMIN_RETOUR}`, response_type: "code", scope: "openid email profile",
      state: etat, code_challenge: defi, code_challenge_method: "S256", prompt: "select_account"
    })) cible.searchParams.set(cle, valeur);
    // Le cookie lie l'état au navigateur qui a commencé la connexion (pas de connexion imposée par un autre site).
    return redirection(cible.toString(), [`${COOKIE}=${etat}; Path=${CHEMIN_RETOUR}; HttpOnly; Secure; SameSite=Lax; Max-Age=${DUREE_ETAT}`]);
  }

  if (url.pathname === CHEMIN_RETOUR && request.method === "GET") {
    const etat = url.searchParams.get("state") || "";
    const cookie = lireCookie(request, COOKIE);
    const ligne = etat && cookie === etat
      ? await env.DB.prepare("DELETE FROM google_etats WHERE etat_hash = ? AND expire >= ? RETURNING verificateur, retour").bind(await empreinte(etat), new Date().toISOString()).first()
      : null;
    const retour = ligne?.retour || "/";
    const refus = async (motif, issue = "refusee") => {
      await journaliser(env, { acteur: null, action: "auth.google", resultat: "refuse", details: { motif } });
      return redirection(avecParametre(retour, "connexion", issue), [effacerEtat]);
    };
    if (!ligne) return refus("état invalide ou expiré");
    if (url.searchParams.get("error")) return refus("connexion annulée", "annulee");
    const code = url.searchParams.get("code");
    if (!code) return refus("code absent");

    let info = null;
    try {
      const reponse = await fetch(env.GOOGLE_URL_TOKEN || URL_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${url.origin}${CHEMIN_RETOUR}`, grant_type: "authorization_code", code_verifier: ligne.verificateur
        })
      });
      if (reponse.ok) info = decoderJwt((await reponse.json()).id_token);
      else console.error("google_token_refused", reponse.status);
    } catch {
      console.error("google_token_failed");
    }
    const { compte, motif } = verifierIdentite(info, env.GOOGLE_CLIENT_ID);
    if (!compte) return refus(motif);

    // Compte relié à ce Google, sinon compte existant du même e-mail (vérifié par Google), sinon nouveau compte.
    let user = await env.DB.prepare("SELECT id FROM users WHERE google_id = ?").bind(compte.sub).first();
    let issue = "connexion";
    if (!user) {
      user = await env.DB.prepare("SELECT id, google_id FROM users WHERE email = ?").bind(compte.email).first();
      if (user?.google_id) return refus("e-mail déjà relié à un autre compte Google");
      if (user) {
        await env.DB.prepare("UPDATE users SET google_id = ? WHERE id = ? AND google_id IS NULL").bind(compte.sub, user.id).run();
        issue = "liaison";
      }
    }
    if (!user) {
      if (!(await reserverInscription(env, adresseIp(request)))) return refus("trop d'inscriptions depuis cette connexion", "limite");
      const { hash, salt } = await motDePasseInutilisable();
      user = await env.DB.prepare("INSERT INTO users (email, name, password_hash, password_salt, google_id) VALUES (?, ?, ?, ?, ?) RETURNING id")
        .bind(compte.email, compte.nom, hash, salt, compte.sub).first();
      issue = "creation";
    }
    await journaliser(env, { acteur: null, acteurId: user.id, action: "auth.google", reference: String(user.id), details: { issue } });
    return redirection(retour, [await ouvrirSession(env, user.id), effacerEtat]);
  }
  throw new ApiError(404, "Route inconnue.");
}

async function empreinte(valeur) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valeur)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
