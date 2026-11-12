// Connexion avec Google, Apple et Facebook : code d'autorisation, sans script tiers dans les pages.
// Routes /api/auth/<fournisseur>, /api/auth/<fournisseur>/retour et /api/auth/<fournisseur>/etat ; /api/auth/fournisseurs
// dit lesquels sont configurés (les pages n'affichent que ceux-là). Un fournisseur sans ses identifiants est fermé :
// ses liens ramènent sur la page de départ avec ?connexion=indisponible.
//
// Identifiants (identifiants publics dans wrangler.jsonc « vars », secrets avec `npx wrangler secret put`) :
//   Google   : GOOGLE_CLIENT_ID ; secret GOOGLE_CLIENT_SECRET.
//   Apple    : APPLE_CLIENT_ID (Services ID), APPLE_TEAM_ID, APPLE_KEY_ID ; secret APPLE_PRIVATE_KEY (contenu du .p8).
//   Facebook : FACEBOOK_APP_ID ; secret FACEBOOK_APP_SECRET.
// Adresses des fournisseurs surchargeables pour les tests (GOOGLE_URL_AUTH, APPLE_URL_TOKEN, FACEBOOK_URL_PROFIL…).
//
// Sécurité commune : état aléatoire à usage unique (10 minutes) lié au navigateur par un cookie ; retour limité aux
// chemins du site ; jetons reçus directement du fournisseur en HTTPS avec le secret de l'application (signature du
// jeton d'identité non vérifiée, OpenID Connect Core 3.1.3.7 ; émetteur, destinataire et expiration le sont).
// Un compte existant n'est relié par son e-mail que si le fournisseur garantit l'avoir vérifié (Google, Apple) ;
// Facebook ne le garantit pas : une adresse déjà inscrite doit d'abord se connecter avec son mot de passe.
import { journaliser } from "./reglages.js";

const DUREE_ETAT = 600; // secondes
const VERSION_FACEBOOK = "v23.0";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const texteUtf8 = (valeur) => new TextEncoder().encode(valeur);
const base64url = (octets) => btoa(String.fromCharCode(...new Uint8Array(octets))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const base64urlJson = (objet) => base64url(texteUtf8(JSON.stringify(objet)));
const hexa = (octets) => [...new Uint8Array(octets)].map((b) => b.toString(16).padStart(2, "0")).join("");
const empreinte = async (valeur) => hexa(await crypto.subtle.digest("SHA-256", texteUtf8(valeur)));

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

const emailNormalise = (valeur) => (typeof valeur === "string" ? valeur.trim().toLowerCase() : "");
const nomOuEmail = (nom, email) => (typeof nom === "string" && nom.trim().length >= 2 ? nom.trim().slice(0, 80) : email.split("@")[0].slice(0, 80));
const jetonExpire = (info, maintenant) => !Number.isFinite(info.exp) || info.exp * 1000 < maintenant;

// --- Contrôle des identités reçues. Chaque fonction renvoie { compte: { sub, email, nom } } ou { motif }. ---

export function verifierIdentiteGoogle(info, clientId, maintenant = Date.now()) {
  if (!info) return { motif: "jeton illisible" };
  if (!["https://accounts.google.com", "accounts.google.com"].includes(info.iss)) return { motif: "émetteur inattendu" };
  if (info.aud !== clientId) return { motif: "destinataire inattendu" };
  if (jetonExpire(info, maintenant)) return { motif: "jeton expiré" };
  if (typeof info.sub !== "string" || !/^[0-9]{1,64}$/.test(info.sub)) return { motif: "identifiant Google invalide" };
  const email = emailNormalise(info.email);
  if (!EMAIL.test(email) || email.length > 254) return { motif: "e-mail absent" };
  if (info.email_verified !== true && info.email_verified !== "true") return { motif: "e-mail non vérifié par Google" };
  return { compte: { sub: info.sub, email, nom: nomOuEmail(info.name, email) } };
}

// nom : envoyé par Apple au navigateur à la première autorisation seulement (champ « user » du formulaire de retour).
export function verifierIdentiteApple(info, clientId, nom = "", maintenant = Date.now()) {
  if (!info) return { motif: "jeton illisible" };
  if (info.iss !== "https://appleid.apple.com") return { motif: "émetteur inattendu" };
  if (info.aud !== clientId) return { motif: "destinataire inattendu" };
  if (jetonExpire(info, maintenant)) return { motif: "jeton expiré" };
  if (typeof info.sub !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(info.sub)) return { motif: "identifiant Apple invalide" };
  const email = emailNormalise(info.email);
  if (!EMAIL.test(email) || email.length > 254) return { motif: "e-mail absent" };
  if (info.email_verified !== true && info.email_verified !== "true") return { motif: "e-mail non vérifié par Apple" };
  return { compte: { sub: info.sub, email, nom: nomOuEmail(nom, email) } };
}

export function verifierIdentiteFacebook(info) {
  if (!info) return { motif: "profil illisible" };
  if (typeof info.id !== "string" || !/^[0-9]{1,64}$/.test(info.id)) return { motif: "identifiant Facebook invalide" };
  const email = emailNormalise(info.email);
  if (!EMAIL.test(email) || email.length > 254) return { motif: "e-mail absent" };
  return { compte: { sub: info.id, email, nom: nomOuEmail(info.name, email) } };
}

// --- Échanges avec les fournisseurs (code → identité). Une erreur réseau ou un refus donne null. ---

async function lireJson(reponse, journal) {
  if (reponse.ok) return reponse.json();
  console.error(journal, reponse.status);
  return null;
}

async function jetonGoogle(env, code, redirectUri, verificateur) {
  const donnees = await lireJson(await fetch(env.GOOGLE_URL_TOKEN || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verificateur
    })
  }), "google_token_refused");
  return decoderJwt(donnees?.id_token);
}

// Secret client d'Apple : JWT ES256 signé avec la clé privée du compte développeur (valable 5 minutes).
export async function secretClientApple(env, maintenant = Date.now()) {
  const pem = String(env.APPLE_PRIVATE_KEY).replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const cle = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Math.floor(maintenant / 1000);
  const contenu = `${base64urlJson({ alg: "ES256", kid: env.APPLE_KEY_ID })}.${base64urlJson({
    iss: env.APPLE_TEAM_ID, iat, exp: iat + 300, aud: "https://appleid.apple.com", sub: env.APPLE_CLIENT_ID
  })}`;
  // WebCrypto signe au format r‖s (64 octets), celui attendu par JWS.
  return `${contenu}.${base64url(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cle, texteUtf8(contenu)))}`;
}

async function jetonApple(env, code, redirectUri) {
  const donnees = await lireJson(await fetch(env.APPLE_URL_TOKEN || "https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.APPLE_CLIENT_ID, client_secret: await secretClientApple(env), redirect_uri: redirectUri, grant_type: "authorization_code"
    })
  }), "apple_token_refused");
  return decoderJwt(donnees?.id_token);
}

async function profilFacebook(env, code, redirectUri) {
  const urlJeton = new URL(env.FACEBOOK_URL_TOKEN || `https://graph.facebook.com/${VERSION_FACEBOOK}/oauth/access_token`);
  for (const [cle, valeur] of Object.entries({ client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET, redirect_uri: redirectUri, code })) {
    urlJeton.searchParams.set(cle, valeur);
  }
  const jeton = (await lireJson(await fetch(urlJeton), "facebook_token_refused"))?.access_token;
  if (typeof jeton !== "string" || !jeton) return null;
  // appsecret_proof : la requête de profil prouve qu'elle vient de l'application (jeton volé inutilisable ailleurs).
  const cle = await crypto.subtle.importKey("raw", texteUtf8(env.FACEBOOK_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const urlProfil = new URL(env.FACEBOOK_URL_PROFIL || `https://graph.facebook.com/${VERSION_FACEBOOK}/me`);
  urlProfil.searchParams.set("fields", "id,name,email");
  urlProfil.searchParams.set("access_token", jeton);
  urlProfil.searchParams.set("appsecret_proof", hexa(await crypto.subtle.sign("HMAC", cle, texteUtf8(jeton))));
  return lireJson(await fetch(urlProfil), "facebook_profile_refused");
}

function nomApple(champ) {
  try {
    const { firstName = "", lastName = "" } = JSON.parse(champ || "{}").name || {};
    return `${String(firstName)} ${String(lastName)}`.trim();
  } catch {
    return "";
  }
}

// --- Fournisseurs. ---
// pkce : défi S256 (Google). sameSite : Apple renvoie le navigateur par un formulaire POST depuis son domaine, que
// le cookie d'état ne suit qu'en SameSite=None. liaisonParEmail : e-mail vérifié par le fournisseur.
const FOURNISSEURS = {
  google: {
    colonne: "google_id",
    actif: (env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    urlAuth: (env) => env.GOOGLE_URL_AUTH || "https://accounts.google.com/o/oauth2/v2/auth",
    parametres: (env) => ({ client_id: env.GOOGLE_CLIENT_ID, response_type: "code", scope: "openid email profile", prompt: "select_account" }),
    pkce: true,
    sameSite: "Lax",
    liaisonParEmail: true,
    identite: async (env, { code, redirectUri, verificateur }) => verifierIdentiteGoogle(await jetonGoogle(env, code, redirectUri, verificateur), env.GOOGLE_CLIENT_ID)
  },
  apple: {
    colonne: "apple_id",
    actif: (env) => Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY),
    urlAuth: (env) => env.APPLE_URL_AUTH || "https://appleid.apple.com/auth/authorize",
    parametres: (env) => ({ client_id: env.APPLE_CLIENT_ID, response_type: "code", scope: "name email", response_mode: "form_post" }),
    pkce: false,
    sameSite: "None",
    liaisonParEmail: true,
    identite: async (env, { code, redirectUri, champs }) => verifierIdentiteApple(await jetonApple(env, code, redirectUri), env.APPLE_CLIENT_ID, nomApple(champs.get("user")))
  },
  facebook: {
    colonne: "facebook_id",
    actif: (env) => Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET),
    urlAuth: (env) => env.FACEBOOK_URL_AUTH || `https://www.facebook.com/${VERSION_FACEBOOK}/dialog/oauth`,
    parametres: (env) => ({ client_id: env.FACEBOOK_APP_ID, response_type: "code", scope: "email,public_profile" }),
    pkce: false,
    sameSite: "Lax",
    liaisonParEmail: false,
    identite: async (env, { code, redirectUri }) => verifierIdentiteFacebook(await profilFacebook(env, code, redirectUri))
  }
};

const ROUTE = /^\/api\/auth\/(google|apple|facebook)(\/retour|\/etat)?$/;
export const estRouteConnexionSociale = (path) => path === "/api/auth/fournisseurs" || ROUTE.test(path);
// Retour d'Apple : formulaire POST venu d'appleid.apple.com, à traiter avant le contrôle d'origine du Worker
// (l'état à usage unique lié au cookie du navigateur tient lieu de protection).
export const estRetourApple = (path, method) => path === "/api/auth/apple/retour" && method === "POST";

// deps : fonctions du Worker (sessions, limite d'inscription par IP, mot de passe inutilisable).
export async function routeConnexionSociale(request, env, url, { json, ApiError, ouvrirSession, reserverInscription, motDePasseInutilisable, adresseIp }) {
  if (url.pathname === "/api/auth/fournisseurs" && request.method === "GET") {
    return json(Object.fromEntries(Object.entries(FOURNISSEURS).map(([nom, f]) => [nom, f.actif(env)])));
  }
  const [, nom, suite = ""] = url.pathname.match(ROUTE);
  const fournisseur = FOURNISSEURS[nom];
  const cheminRetour = `/api/auth/${nom}/retour`;
  const redirectUri = `${url.origin}${cheminRetour}`;
  const nomCookie = `${nom}_etat`;
  const optionsCookie = `Path=${cheminRetour}; HttpOnly; Secure; SameSite=${fournisseur.sameSite}`;
  const effacerEtat = `${nomCookie}=; ${optionsCookie}; Max-Age=0`;

  if (suite === "/etat" && request.method === "GET") return json({ actif: fournisseur.actif(env) });
  // Non configuré : retour sur la page de départ avec un message, plutôt qu'une réponse JSON dans le navigateur.
  if (!fournisseur.actif(env)) return redirection(avecParametre(retourSur(url.searchParams.get("retour")), "connexion", "indisponible"));

  if (suite === "" && request.method === "GET") {
    const etat = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const verificateur = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const maintenant = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM connexion_etats WHERE expire < ?").bind(new Date(maintenant).toISOString()),
      env.DB.prepare("INSERT INTO connexion_etats (etat_hash, fournisseur, verificateur, retour, expire) VALUES (?, ?, ?, ?, ?)")
        .bind(await empreinte(etat), nom, verificateur, retourSur(url.searchParams.get("retour")), new Date(maintenant + DUREE_ETAT * 1000).toISOString())
    ]);
    const cible = new URL(fournisseur.urlAuth(env));
    const parametres = { ...fournisseur.parametres(env), redirect_uri: redirectUri, state: etat };
    if (fournisseur.pkce) {
      parametres.code_challenge = base64url(await crypto.subtle.digest("SHA-256", texteUtf8(verificateur)));
      parametres.code_challenge_method = "S256";
    }
    for (const [cle, valeur] of Object.entries(parametres)) cible.searchParams.set(cle, valeur);
    // Le cookie lie l'état au navigateur qui a commencé la connexion (pas de connexion imposée par un autre site).
    return redirection(cible.toString(), [`${nomCookie}=${etat}; ${optionsCookie}; Max-Age=${DUREE_ETAT}`]);
  }

  const retourPost = request.method === "POST" && nom === "apple";
  if (suite === "/retour" && (request.method === "GET" || retourPost)) {
    const champs = retourPost ? new URLSearchParams(await request.text()) : url.searchParams;
    const etat = champs.get("state") || "";
    const ligne = etat && lireCookie(request, nomCookie) === etat
      ? await env.DB.prepare("DELETE FROM connexion_etats WHERE etat_hash = ? AND fournisseur = ? AND expire >= ? RETURNING verificateur, retour")
        .bind(await empreinte(etat), nom, new Date().toISOString()).first()
      : null;
    const retour = ligne?.retour || "/";
    const action = `auth.${nom}`;
    const refus = async (motif, issue = "refusee") => {
      await journaliser(env, { acteur: null, action, resultat: "refuse", details: { motif } });
      return redirection(avecParametre(retour, "connexion", issue), [effacerEtat]);
    };
    if (!ligne) return refus("état invalide ou expiré");
    if (champs.get("error")) return refus("connexion annulée", "annulee");
    const code = champs.get("code");
    if (!code) return refus("code absent");

    let resultat;
    try {
      resultat = await fournisseur.identite(env, { code, redirectUri, verificateur: ligne.verificateur, champs });
    } catch {
      console.error(`${nom}_token_failed`);
      resultat = { motif: "fournisseur injoignable" };
    }
    const { compte, motif } = resultat;
    if (!compte) return refus(motif);

    // Compte relié à cet identifiant, sinon compte existant du même e-mail (si vérifié par le fournisseur), sinon
    // nouveau compte. La colonne vient de FOURNISSEURS, jamais de la requête.
    const colonne = fournisseur.colonne;
    let user = await env.DB.prepare(`SELECT id FROM users WHERE ${colonne} = ?`).bind(compte.sub).first();
    let issue = "connexion";
    if (!user) {
      user = await env.DB.prepare(`SELECT id, ${colonne} AS relie FROM users WHERE email = ?`).bind(compte.email).first();
      if (user?.relie) return refus("e-mail déjà relié à un autre compte du même fournisseur");
      if (user && !fournisseur.liaisonParEmail) return refus("e-mail déjà inscrit, liaison non vérifiable", "existant");
      if (user) {
        await env.DB.prepare(`UPDATE users SET ${colonne} = ? WHERE id = ? AND ${colonne} IS NULL`).bind(compte.sub, user.id).run();
        issue = "liaison";
      }
    }
    if (!user) {
      if (!(await reserverInscription(env, adresseIp(request)))) return refus("trop d'inscriptions depuis cette connexion", "limite");
      const { hash, salt } = await motDePasseInutilisable();
      user = await env.DB.prepare(`INSERT INTO users (email, name, password_hash, password_salt, ${colonne}) VALUES (?, ?, ?, ?, ?) RETURNING id`)
        .bind(compte.email, compte.nom, hash, salt, compte.sub).first();
      issue = "creation";
    }
    await journaliser(env, { acteur: null, acteurId: user.id, action, reference: String(user.id), details: { issue } });
    return redirection(retour, [await ouvrirSession(env, user.id), effacerEtat]);
  }
  throw new ApiError(404, "Route inconnue.");
}
