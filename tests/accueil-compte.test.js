import { describe, expect, it } from "vitest";
import { nombreAnnoncesAccueil } from "../worker/seo.js";

// Sous-titre de l'accueil : « Plus de N voitures… » toujours vrai (N inférieur au nombre d'annonces).
describe("nombreAnnoncesAccueil", () => {
  it("renvoie null sous 11 annonces ou sans nombre", () => {
    for (const n of [0, 1, 10, NaN, null, undefined]) expect(nombreAnnoncesAccueil(n)).toBeNull();
  });
  it("arrondit vers le bas, strictement sous le total", () => {
    expect(nombreAnnoncesAccueil(11)).toBe(10);
    expect(nombreAnnoncesAccueil(47)).toBe(40);
    expect(nombreAnnoncesAccueil(100)).toBe(90);
    expect(nombreAnnoncesAccueil(101)).toBe(100);
    expect(nombreAnnoncesAccueil(1000)).toBe(900);
    expect(nombreAnnoncesAccueil(1250)).toBe(1000);
    expect(nombreAnnoncesAccueil(20000)).toBe(19000);
  });
});
