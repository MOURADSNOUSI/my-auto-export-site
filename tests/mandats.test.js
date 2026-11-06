// Tests des mandats (worker/mandats.js) : passages de statut, contrôle du formulaire et véhicules ouverts au mandat.
// Lancement : npm run test:js
import { describe, expect, it } from "vitest";
import { ANNULABLE_PAR_CLIENT, STATUTS, TRANSITIONS, transitionAutorisee, validerDemande, vehiculeMandat } from "../worker/mandats.js";
import { fr } from "../worker/textes.js";

const demande = (champs = {}) => ({ reference: "MY-0001", public: "resident", prixMax: 45000, telephone: "+216 12 345 678", accepte: true, ...champs });

describe("passages de statut", () => {
  it("suit le parcours normal jusqu'à la livraison", () => {
    const parcours = ["demande", "eligibilite_verifiee", "acompte_recu", "achat_en_cours", "achete", "livre"];
    for (let i = 1; i < parcours.length; i++) expect(transitionAutorisee(parcours[i - 1], parcours[i])).toBe(true);
  });

  it("refuse les sauts d'étape et les retours en arrière", () => {
    expect(transitionAutorisee("demande", "acompte_recu")).toBe(false);
    expect(transitionAutorisee("acompte_recu", "demande")).toBe(false);
    expect(transitionAutorisee("achete", "annule")).toBe(false);
    expect(transitionAutorisee("demande", "inconnu")).toBe(false);
    expect(transitionAutorisee("inconnu", "demande")).toBe(false);
  });

  it("garde non_obtenu, livre et annule définitifs", () => {
    for (const fin of ["non_obtenu", "livre", "annule"]) expect(TRANSITIONS[fin]).toEqual([]);
  });

  it("couvre tous les statuts, chacun avec son libellé", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...STATUTS].sort());
    for (const s of STATUTS) expect(fr[`statut_${s}`]).toBeTruthy();
    expect(ANNULABLE_PAR_CLIENT).toEqual(["demande", "eligibilite_verifiee"]);
  });
});

describe("validerDemande", () => {
  it("normalise une demande résident en TND", () => {
    expect(validerDemande(demande())).toEqual({ demande: { reference: "MY-0001", public: "resident", devise: "TND", prixMax: 45000, telephone: "+21612345678", reponses: {} } });
  });

  it("exige le pays et la réponse FCR pour un Tunisien résidant à l'étranger, en EUR", () => {
    expect(validerDemande(demande({ public: "tre" })).erreur).toMatch(/pays/);
    expect(validerDemande(demande({ public: "tre", paysResidence: "France" })).erreur).toMatch(/FCR/);
    const { demande: d } = validerDemande(demande({ public: "tre", paysResidence: " France ", fcrDejaUtilise: false }));
    expect(d.devise).toBe("EUR");
    expect(d.reponses).toEqual({ paysResidence: "France", fcrDejaUtilise: false });
  });

  it("refuse les champs invalides et l'absence d'acceptation", () => {
    expect(validerDemande(demande({ accepte: false })).erreur).toMatch(/Acceptez/);
    expect(validerDemande(demande({ accepte: "true" })).erreur).toMatch(/Acceptez/);
    for (const prixMax of [0, -5, 12.5, "45000", 10000001]) expect(validerDemande(demande({ prixMax })).erreur, String(prixMax)).toMatch(/Prix maximum/);
    for (const telephone of ["123", "abc12345678", "+2161234567890123"]) expect(validerDemande(demande({ telephone })).erreur, telephone).toMatch(/téléphone/);
    for (const reference of ["", "MY 0001", "../x", "a".repeat(65)]) expect(validerDemande(demande({ reference })).erreur, reference).toMatch(/Référence/);
    expect(validerDemande(demande({ public: "autre" })).erreur).toMatch(/Tunisie/);
  });
});

describe("vehiculeMandat", () => {
  const item = (lot, autres = {}) => ({ lot: { reference: "MY-0001", status: "stock", ...lot }, removed: false, ...autres });

  it("ouvre les véhicules de M&Y seulement si les mandats sont actifs", () => {
    expect(vehiculeMandat(item({}), true)).toBe(true);
    expect(vehiculeMandat(item({}), false)).toBe(false);
  });

  it("exclut les annonces de vendeurs, les véhicules affectés, retirés ou vendus", () => {
    expect(vehiculeMandat(item({ reference: "SV-abc" }), true)).toBe(false);
    expect(vehiculeMandat(item({ marketplace: true }), true)).toBe(false);
    expect(vehiculeMandat(item({}, { offerOwnerAssigned: true }), true)).toBe(false);
    expect(vehiculeMandat(item({}, { removed: true }), true)).toBe(false);
    expect(vehiculeMandat(item({}, { sellerUnavailable: true }), true)).toBe(false);
    expect(vehiculeMandat(item({ status: "sold" }), true)).toBe(false);
  });
});
