// Tests du catalogue filtrable (worker/catalogue.js) : lecture et contrôle des filtres, curseur de pagination.
// Les requêtes D1 sont couvertes par tests/test_catalogue_filtre.py.
// Lancement : npm run test:js
import { describe, expect, it } from "vitest";
import { ErreurFiltre, decoderCurseur, encoderCurseur, lireFiltres } from "../worker/catalogue.js";

const filtres = (chaine) => lireFiltres(new URLSearchParams(chaine));

describe("lireFiltres", () => {
  it("garde les filtres valides, dans leur type", () => {
    expect(filtres("marque=Peugeot&modele=3008&carrosserie=SUV&energie=Diesel&boite=Automatique&pays=Allemagne&prix_max=25 000&annee_min=2022&annee_max=2025&km_max=80000&tri=prix_asc"))
      .toEqual({ marque: "Peugeot", modele: "3008", carrosserie: "SUV", energie: "Diesel", boite: "Automatique", pays: "Allemagne", prix_max: 25000, annee_min: 2022, annee_max: 2025, km_max: 80000, tri: "prix_asc" });
  });

  it("ignore les valeurs vides et les paramètres inconnus, tri récent par défaut", () => {
    expect(filtres("marque=&energie=%20&site=bca&removed=1")).toEqual({ tri: "recent" });
  });

  it("refuse les valeurs invalides", () => {
    for (const chaine of ["marque=%3Cscript%3E", "marque=" + "a".repeat(61), "prix_max=abc", "annee_min=-1", "km_max=1e9", "tri=au_hasard", "annee_max=3000"]) {
      expect(() => filtres(chaine), chaine).toThrow(ErreurFiltre);
    }
  });

  it("accepte les accents et les noms composés", () => {
    expect(filtres("energie=Électrique&pays=Royaume-Uni&marque=Mercedes-Benz&carrosserie=Pick-up").energie).toBe("Électrique");
  });
});

describe("curseur", () => {
  it("fait l'aller-retour (texte, nombre, accents)", () => {
    for (const [valeur, reference] of [["2026-11-07T10:00:00.000Z", "OL-11721446"], [14500, "MY-0001"], ["Électrique", "SV-abc"]]) {
      expect(decoderCurseur(encoderCurseur(valeur, reference))).toEqual({ valeur, reference });
    }
    expect(encoderCurseur(1, "A")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuse un curseur falsifié", () => {
    for (const faux of ["pas-un-curseur", btoa("[1]"), btoa(JSON.stringify([{}, "A"])), btoa(JSON.stringify([1, "x".repeat(65)]))]) {
      expect(() => decoderCurseur(faux), faux).toThrow(ErreurFiltre);
    }
    expect(decoderCurseur("")).toBeNull();
  });
});
