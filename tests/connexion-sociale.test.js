// Contrôles des identités reçues de Google, Apple et Facebook, et secret client signé d'Apple (worker/connexion-sociale.js).
import { describe, expect, it } from "vitest";
import { retourSur, secretClientApple, verifierIdentiteApple, verifierIdentiteFacebook, verifierIdentiteGoogle } from "../worker/connexion-sociale.js";

const maintenant = Date.UTC(2026, 10, 12, 12);
const exp = maintenant / 1000 + 600;

const decoder = (morceau) => JSON.parse(Buffer.from(morceau, "base64url").toString());

describe("verifierIdentiteGoogle", () => {
  const info = { iss: "https://accounts.google.com", aud: "client", exp, sub: "123", email: "A@Gmail.com", email_verified: true, name: "Ana Client" };
  it("accepte une identité valide et normalise l'e-mail", () => {
    expect(verifierIdentiteGoogle(info, "client", maintenant)).toEqual({ compte: { sub: "123", email: "a@gmail.com", nom: "Ana Client" } });
  });
  it("refuse un e-mail non vérifié ou une autre application", () => {
    expect(verifierIdentiteGoogle({ ...info, email_verified: false }, "client", maintenant).motif).toMatch(/non vérifié/);
    expect(verifierIdentiteGoogle(info, "autre", maintenant).motif).toBe("destinataire inattendu");
  });
});

describe("verifierIdentiteApple", () => {
  const info = { iss: "https://appleid.apple.com", aud: "com.myauto.web", exp, sub: "001234.abcdef0123456789.0123", email: "x1y2@privaterelay.appleid.com", email_verified: "true" };
  it("accepte une identité valide, avec le nom transmis à la première autorisation", () => {
    expect(verifierIdentiteApple(info, "com.myauto.web", "Sami Ben Ali", maintenant).compte)
      .toEqual({ sub: "001234.abcdef0123456789.0123", email: "x1y2@privaterelay.appleid.com", nom: "Sami Ben Ali" });
  });
  it("sans nom, reprend le début de l'e-mail", () => {
    expect(verifierIdentiteApple(info, "com.myauto.web", "", maintenant).compte.nom).toBe("x1y2");
  });
  it("refuse émetteur, destinataire, expiration, identifiant et e-mail non conformes", () => {
    const cas = [
      [{ iss: "https://accounts.google.com" }, "émetteur inattendu"],
      [{ aud: "autre" }, "destinataire inattendu"],
      [{ exp: maintenant / 1000 - 1 }, "jeton expiré"],
      [{ sub: "a b" }, "identifiant Apple invalide"],
      [{ email: "" }, "e-mail absent"],
      [{ email_verified: "false" }, "e-mail non vérifié par Apple"]
    ];
    for (const [champs, motif] of cas) expect(verifierIdentiteApple({ ...info, ...champs }, "com.myauto.web", "", maintenant).motif).toBe(motif);
    expect(verifierIdentiteApple(null, "com.myauto.web").motif).toBe("jeton illisible");
  });
});

describe("verifierIdentiteFacebook", () => {
  it("accepte un profil avec e-mail, refuse un profil sans e-mail ou à identifiant invalide", () => {
    expect(verifierIdentiteFacebook({ id: "10001", email: "F@Example.com", name: "Fatma" }).compte).toEqual({ sub: "10001", email: "f@example.com", nom: "Fatma" });
    expect(verifierIdentiteFacebook({ id: "10001", name: "Sans E-mail" }).motif).toBe("e-mail absent");
    expect(verifierIdentiteFacebook({ id: "abc", email: "f@example.com" }).motif).toBe("identifiant Facebook invalide");
    expect(verifierIdentiteFacebook(null).motif).toBe("profil illisible");
  });
});

describe("secretClientApple", () => {
  it("produit un JWT ES256 vérifiable avec la clé publique, aux revendications attendues par Apple", async () => {
    const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", paire.privateKey)).toString("base64");
    // Clé collée avec des « \n » littéraux, comme le permet `wrangler secret put` sur une seule ligne.
    const pem = `-----BEGIN PRIVATE KEY-----\\n${pkcs8.match(/.{1,64}/g).join("\\n")}\\n-----END PRIVATE KEY-----`;
    const env = { APPLE_PRIVATE_KEY: pem, APPLE_KEY_ID: "KEY123", APPLE_TEAM_ID: "TEAM456", APPLE_CLIENT_ID: "com.myauto.web" };
    const jeton = await secretClientApple(env, maintenant);
    const [entete, charge, signature] = jeton.split(".");
    expect(decoder(entete)).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(decoder(charge)).toEqual({ iss: "TEAM456", iat: maintenant / 1000, exp: maintenant / 1000 + 300, aud: "https://appleid.apple.com", sub: "com.myauto.web" });
    const valide = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, paire.publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${entete}.${charge}`));
    expect(valide).toBe(true);
  });
});

describe("retourSur", () => {
  it("garde les chemins du site et refuse les autres domaines", () => {
    expect(retourSur("/vendre")).toBe("/vendre");
    for (const dangereux of ["//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)", null]) expect(retourSur(dangereux)).toBe("/");
  });
});
