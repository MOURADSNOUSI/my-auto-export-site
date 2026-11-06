// Tests des prix estimés (worker/prix.js) : calcul pur avec des cas chiffrés à la main, lecture du cours BCT et mise à
// jour du taux avec fetch et D1 simulés. Aucun appel réel à la BCT ni à ExchangeRate-API.
// Lancement : npm run test:js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculerPrix, lireTauxBct, mettreAJourTaux, normaliserCarburant } from "../worker/prix.js";

// Paramètres de test (indépendants des exemples de la migration). Taux appliqué : 3,4 × (1 + 2 %) = 3,468.
// Assurance 1 % : valeur CAF = (prix + transport) × 1,01. Redevance douanière 3 % des droits et taxes, minimum 10 TND.
// Grille : barème DC du commentaire InFirst, DD de 20 % (exemple), électriques à 0 %.
function parametres(valeurs = {}, autres = {}) {
  const tous = ["essence", "diesel", "hybride", "hybride_rechargeable", "electrique"];
  const l = (regime, carburant, cylindree_min, cylindree_max, dd, dc, tva, reduction = 0, part = 100) => ({
    regime, carburant, cylindree_min, cylindree_max, droits_douane_pct: dd, droit_consommation_pct: dc, tva_pct: tva,
    reduction_immatriculation_pct: reduction, part_payee_pct: part, note: "Exemple de test"
  });
  return {
    valeurs: {
      marge_change_pct: "2", transport_defaut_eur: "1000", frais_transitaire_tnd: "800", frais_port_tnd: "500",
      frais_immatriculation_tnd: "600", commission_pct: "5", commission_fixe_tnd: "1000", assurance_transport_pct: "1",
      redevance_douane_pct: "3", redevance_douane_min_tnd: "10",
      taux_auto: "3.4", taux_auto_date: "2026-11-06T06:00:00.000Z", taux_auto_source: "BCT", taux_manuel: "", taux_manuel_actif: "false",
      ...valeurs
    },
    regimes: [
      { code: "resident_droit_commun", public: "resident", actif: true, statut_verification: "a_verifier" },
      { code: "resident_phev_lf2026", public: "resident", actif: true, statut_verification: "a_verifier" },
      { code: "resident_hev_lf2026", public: "resident", actif: true, statut_verification: "a_verifier" },
      { code: "resident_electrique_lf2026", public: "resident", actif: true, statut_verification: "a_verifier" },
      { code: "fcr_classique", public: "tre", actif: true, statut_verification: "a_verifier" }
    ],
    grille: [
      l("resident_droit_commun", "essence", 0, 1300, 20, 20, 19),
      l("resident_droit_commun", "essence", 1301, 1500, 20, 38, 19),
      l("resident_droit_commun", "essence", 1501, 1700, 20, 48, 19),
      l("resident_droit_commun", "essence", 1701, 2000, 20, 65, 19),
      l("resident_droit_commun", "essence", 2001, null, 20, 84, 19),
      l("resident_droit_commun", "*", 0, null, 20, 20, 19),
      l("resident_phev_lf2026", "hybride_rechargeable", 0, null, 20, 0, 7, 50),
      l("resident_hev_lf2026", "hybride", 0, 1300, 20, 10, 19),
      l("resident_hev_lf2026", "hybride", 1301, 1500, 20, 19, 19),
      l("resident_hev_lf2026", "hybride", 1501, 1700, 20, 24, 19),
      l("resident_hev_lf2026", "hybride", 1701, 2000, 20, 65, 19),
      l("resident_electrique_lf2026", "electrique", 0, null, 0, 0, 7, 50),
      l("fcr_classique", "essence", 0, 1300, 20, 20, 19, 0, 25),
      l("fcr_classique", "essence", 1301, 1500, 20, 38, 19, 0, 25),
      l("fcr_classique", "essence", 1501, 2000, 20, 65, 19, 0, 25),
      l("fcr_classique", "essence", 2001, null, 20, 84, 19, 0, 30),
      l("fcr_classique", "electrique", 0, null, 0, 0, 7, 0, 25)
    ],
    eligibilite: {
      resident: { age_max_ans: 3, cylindree_max_cc: 2500, carburants_admis: tous },
      fcr: { age_max_ans: 5, cylindree_max_cc: null, carburants_admis: tous }
    },
    aujourdhui: "2026-11-06",
    ...autres
  };
}

const ESSENCE = { prixEur: 10000, year: 2024, engineCc: 1400, fuel: "Essence" };
const montant = (resultat, debut) => resultat.detail.find((d) => d.libelle.startsWith(debut))?.montant;

describe("calculerPrix", () => {
  it("résident essence éligible", () => {
    const r = calculerPrix(ESSENCE, parametres());
    // Valeur CAF = (10 000 + 1 000 transport par défaut) × 1,01 × 3,468 = 38 529,48 → 38 529
    // DD = 38 529 × 20 % = 7 705,8 → 7 706 ; DC = (38 529 + 7 706) × 38 % = 17 569,3 → 17 569
    // TVA = (38 529 + 7 706 + 17 569) × 19 % = 12 122,76 → 12 123
    // Redevance = (7 706 + 17 569 + 12 123) × 3 % = 1 121,94 → 1 122 (au-dessus du minimum de 10)
    // Commission = 10 000 × 5 % × 3,468 + 1 000 = 2 734
    // Total = 38 529 + 7 706 + 17 569 + 12 123 + 1 122 + 800 + 500 + 600 + 2 734 = 81 683
    expect(r.regimeResident).toBe("resident_droit_commun");
    expect(montant(r, "Résident : valeur")).toBe(38529);
    expect(montant(r, "Résident : droits de douane")).toBe(7706);
    expect(montant(r, "Résident : droit de consommation")).toBe(17569);
    expect(montant(r, "Résident : TVA")).toBe(12123);
    expect(montant(r, "Résident : redevance")).toBe(1122);
    expect(montant(r, "Résident : commission")).toBe(2734);
    expect(r.prixResidentTnd).toBe(81683);
    expect(r.motifNonEligibleResident).toBeNull();
    expect(r.taux).toMatchObject({ date: "2026-11-06T06:00:00.000Z", source: "BCT", manuel: false });
    expect(r.taux.valeur).toBeCloseTo(3.468, 10);
    expect(r.avertissements.some((a) => a.includes("À VÉRIFIER par le transitaire"))).toBe(true);
    expect(r.avertissements.some((a) => a.includes("propre évaluation"))).toBe(true);
    expect(r.avertissements.some((a) => a.includes("valeur CAF seule"))).toBe(true);
  });

  it("redevance douanière : minimum appliqué", () => {
    // Minimum porté à 2 000 TND > 1 122 : total = 81 683 - 1 122 + 2 000 = 82 561
    const r = calculerPrix(ESSENCE, parametres({ redevance_douane_min_tnd: "2000" }));
    expect(montant(r, "Résident : redevance")).toBe(2000);
    expect(r.prixResidentTnd).toBe(82561);
  });

  it("résident non éligible par l'âge", () => {
    const r = calculerPrix({ ...ESSENCE, year: 2020 }, parametres());
    expect(r.prixResidentTnd).toBeNull();
    expect(r.motifNonEligibleResident).toBe("Véhicule de 6 ans : 3 ans au plus.");
  });

  it("âge compté depuis la date de première immatriculation", () => {
    // Au 2026-11-06 : 2022-11-07 → 3 ans pleins, éligible (3 ans au plus) ; 2022-11-06 → 4 ans, refusé.
    expect(calculerPrix({ ...ESSENCE, year: undefined, premiereImmatriculation: "2022-11-07" }, parametres()).prixResidentTnd).toBe(81683);
    expect(calculerPrix({ ...ESSENCE, premiereImmatriculation: "2022-11-06" }, parametres()).motifNonEligibleResident).toBe("Véhicule de 4 ans : 3 ans au plus.");
  });

  it("résident non éligible par la cylindrée", () => {
    const r = calculerPrix({ ...ESSENCE, engineCc: 3000 }, parametres());
    expect(r.prixResidentTnd).toBeNull();
    expect(r.motifNonEligibleResident).toBe("Cylindrée de 3000 cm³ : 2500 cm³ au plus.");
    // FCR sans plafond de cylindrée : part de 30 % au-delà de 2 000 cm³.
    // Valeur 38 529 ; DD 7 706 ; DC = 46 235 × 84 % = 38 837,4 → 38 837 ; TVA = 85 072 × 19 % = 16 163,68 → 16 164
    // Droits 62 707 × 30 % = 18 812,1 → 18 812 ; redevance 18 812 × 3 % = 564,36 → 564 ; + 800 + 500 = 20 676
    expect(r.dedouanementFcrEstimeTnd).toBe(20676);
  });

  it("hybride rechargeable : régime LF 2026", () => {
    const r = calculerPrix({ prixEur: 20000, transportEur: 1500, year: 2025, engineCc: 1500, fuel: "Hybride rechargeable" }, parametres());
    // Art. 47 LF 2026 : voiture particulière (87.03) au droit de douane commun (20 % ici), DC exonéré, TVA 7 %.
    // Valeur = 21 500 × 1,01 × 3,468 = 75 307,62 → 75 308 ; DD = 15 061,6 → 15 062 ; DC 0
    // TVA = 90 370 × 7 % = 6 325,9 → 6 326 ; redevance = 21 388 × 3 % = 641,64 → 642
    // Immatriculation = 600 × 50 % = 300 ; commission = 20 000 × 5 % × 3,468 + 1 000 = 4 468
    // Total = 75 308 + 15 062 + 6 326 + 642 + 800 + 500 + 300 + 4 468 = 103 406
    expect(r.regimeResident).toBe("resident_phev_lf2026");
    expect(montant(r, "Résident : droits de douane")).toBe(15062);
    expect(montant(r, "Résident : droit de consommation")).toBe(0);
    expect(montant(r, "Résident : TVA")).toBe(6326);
    expect(montant(r, "Résident : immatriculation")).toBe(300);
    expect(r.prixResidentTnd).toBe(103406);
  });

  it("hybride rechargeable : droit commun si le régime LF 2026 est inactif", () => {
    const p = parametres();
    p.regimes.find((x) => x.code === "resident_phev_lf2026").actif = false;
    expect(calculerPrix({ ...ESSENCE, fuel: "Hybride rechargeable" }, p).regimeResident).toBe("resident_droit_commun");
  });

  it("électrique : DD 0 %, DC exonéré, TVA 7 %, résident et FCR", () => {
    const r = calculerPrix({ prixEur: 30000, year: 2025, fuel: "Électrique" }, parametres());
    // Valeur = 31 000 × 1,01 × 3,468 = 108 583,08 → 108 583 ; TVA = 7 600,81 → 7 601 ; redevance 228,03 → 228
    // Résident : 108 583 + 7 601 + 228 + 800 + 500 + 300 + (30 000 × 5 % × 3,468 + 1 000 = 6 202) = 124 214
    // FCR : 7 601 × 25 % = 1 900,25 → 1 900 ; redevance 57 ; + 1 300 = 3 257
    expect(r.regimeResident).toBe("resident_electrique_lf2026");
    expect(r.prixResidentTnd).toBe(124214);
    expect(r.dedouanementFcrEstimeTnd).toBe(3257);
  });

  it("hybride non rechargeable sous le seuil de 1 700 cm³", () => {
    const r = calculerPrix({ prixEur: 15000, year: 2025, engineCc: 1600, fuel: "Hybride" }, parametres());
    // Valeur = 16 000 × 1,01 × 3,468 = 56 043,88 → 56 043 ; DD = 11 208,6 → 11 209
    // DC = 67 252 × 24 % (48 % × 50 %) = 16 140,48 → 16 140 ; TVA = 83 392 × 19 % = 15 844,48 → 15 844
    // Redevance = 43 193 × 3 % = 1 295,79 → 1 296 ; commission = 15 000 × 5 % × 3,468 + 1 000 = 3 601
    // Total = 56 043 + 11 209 + 16 140 + 15 844 + 1 296 + 800 + 500 + 600 + 3 601 = 106 033
    expect(r.regimeResident).toBe("resident_hev_lf2026");
    expect(montant(r, "Résident : droit de consommation")).toBe(16140);
    expect(r.prixResidentTnd).toBe(106033);
  });

  it("hybride non rechargeable au-dessus du seuil", () => {
    const r = calculerPrix({ prixEur: 15000, year: 2025, engineCc: 1800, fuel: "Hybride" }, parametres());
    // DC = 67 252 × 65 % = 43 713,8 → 43 714 ; TVA = 110 966 × 19 % = 21 083,54 → 21 084
    // Redevance = 76 007 × 3 % = 2 280,21 → 2 280
    // Total = 56 043 + 11 209 + 43 714 + 21 084 + 2 280 + 800 + 500 + 600 + 3 601 = 139 831
    expect(montant(r, "Résident : droit de consommation")).toBe(43714);
    expect(r.prixResidentTnd).toBe(139831);
  });

  it("TRE : FCR à 25 %", () => {
    const r = calculerPrix(ESSENCE, parametres());
    // Prix TRE = 10 000 + 1 000 + (10 000 × 5 % + 1 000 / 3,468 = 788,35 → 788) = 11 788 EUR
    // Droits = 7 706 + 17 569 + 12 123 = 37 398 ; × 25 % = 9 349,5 → 9 350 ; redevance 280,5 → 281 ; + 800 + 500 = 10 931
    expect(r.prixTreEur).toBe(11788);
    expect(montant(r, "FCR : part payée (25 %)")).toBe(9350);
    expect(montant(r, "FCR : redevance")).toBe(281);
    expect(r.dedouanementFcrEstimeTnd).toBe(10931);
  });

  it("TRE : FCR à 30 %", () => {
    const r = calculerPrix({ prixEur: 12000, year: 2023, engineCc: 2200, fuel: "Essence" }, parametres());
    // Valeur = 13 000 × 1,01 × 3,468 = 45 534,84 → 45 535 ; DD = 9 107 ; DC = 54 642 × 84 % = 45 899,28 → 45 899
    // TVA = 100 541 × 19 % = 19 102,79 → 19 103 ; droits 74 109 × 30 % = 22 232,7 → 22 233
    // Redevance 22 233 × 3 % = 666,99 → 667 ; + 1 300 = 24 200
    expect(montant(r, "FCR : droits et taxes dus")).toBe(74109);
    expect(r.dedouanementFcrEstimeTnd).toBe(24200);
  });

  it("TRE non éligible au FCR (plus de 5 ans)", () => {
    const r = calculerPrix({ ...ESSENCE, year: 2019 }, parametres());
    expect(r.dedouanementFcrEstimeTnd).toBeNull();
    expect(r.motifNonEligibleFcr).toBe("Véhicule de 7 ans : 5 ans au plus.");
    expect(r.prixTreEur).toBe(11788);
  });

  it("taux manuel prioritaire", () => {
    const r = calculerPrix(ESSENCE, parametres({ taux_manuel: "3.5", taux_manuel_actif: "true" }));
    // 3,5 × 1,02 = 3,57 ; valeur = 11 000 × 1,01 × 3,57 = 39 662,7 → 39 663
    expect(r.taux.manuel).toBe(true);
    expect(r.taux.valeur).toBeCloseTo(3.57, 10);
    expect(montant(r, "Résident : valeur")).toBe(39663);
  });

  it("absence de taux : aucun prix", () => {
    const r = calculerPrix(ESSENCE, parametres({ taux_auto: "" }));
    expect([r.prixResidentTnd, r.prixTreEur, r.dedouanementFcrEstimeTnd, r.taux.valeur]).toEqual([null, null, null, null]);
    expect(r.motifNonEligibleResident).toMatch(/Aucun taux/);
    expect(r.detail).toEqual([]);
    // Taux manuel actif mais vide : pas de repli sur un autre taux.
    expect(calculerPrix(ESSENCE, parametres({ taux_manuel_actif: "true" })).prixResidentTnd).toBeNull();
  });

  it("commission en pourcentage seul et fixe seule", () => {
    const pourcentage = calculerPrix(ESSENCE, parametres({ commission_pct: "10", commission_fixe_tnd: "0" }));
    // 10 000 × 10 % × 3,468 = 3 468 TND ; TRE : 10 000 × 10 % = 1 000 EUR
    expect(montant(pourcentage, "Résident : commission")).toBe(3468);
    expect(montant(pourcentage, "TRE : commission")).toBe(1000);
    expect(pourcentage.prixResidentTnd).toBe(81683 - 2734 + 3468);
    const fixe = calculerPrix(ESSENCE, parametres({ commission_pct: "0", commission_fixe_tnd: "3468" }));
    // 3 468 TND fixes ; TRE : 3 468 / 3,468 = 1 000 EUR
    expect(montant(fixe, "Résident : commission")).toBe(3468);
    expect(montant(fixe, "TRE : commission")).toBe(1000);
  });

  it("carburant inconnu ou cylindrée manquante : motif clair", () => {
    expect(calculerPrix({ ...ESSENCE, fuel: "GPL" }, parametres()).motifNonEligibleResident).toBe("Carburant inconnu : GPL.");
    expect(calculerPrix({ ...ESSENCE, engineCc: null }, parametres()).motifNonEligibleResident).toBe("Cylindrée manquante.");
  });

  it("normalise les carburants des lots", () => {
    expect(["Essence", "Diesel", "Hybride", "Hybride rechargeable", "Électrique", "Plug-in hybrid", "?"].map(normaliserCarburant))
      .toEqual(["essence", "diesel", "hybride", "hybride_rechargeable", "electrique", "hybride_rechargeable", null]);
  });
});

// --- Taux ---

const PAGE_BCT = `<html><body><table>
  <tr><td>DOLLAR DES USA</td><td>USD</td><td>1</td><td>2,9512</td></tr>
  <tr><td>EURO</td><td>EUR</td><td>1</td><td>3,3834</td></tr>
  <tr><td>YEN JAPONAIS</td><td>JPY</td><td>1000</td><td>19,4210</td></tr>
</table></body></html>`;

describe("lireTauxBct", () => {
  it("extrait le cours EUR (virgule décimale, unité)", () => {
    expect(lireTauxBct(PAGE_BCT)).toBe(3.3834);
    expect(lireTauxBct("EURO EUR 10 33,834")).toBeCloseTo(3.3834, 10);
  });
  it("rend null sans ligne EUR", () => {
    expect(lireTauxBct("<table><tr><td>DOLLAR DES USA</td><td>USD</td><td>1</td><td>2,9512</td></tr></table>")).toBeNull();
    expect(lireTauxBct("")).toBeNull();
  });
});

// D1 minimale : parametres_prix en mémoire et journal des requêtes INSERT INTO audit_logs.
function d1Simulee(tauxInitial = "3.3") {
  const valeurs = { taux_auto: tauxInitial, taux_auto_date: "2026-11-05T06:00:00.000Z", taux_auto_source: "BCT" };
  const journal = [];
  const preparer = (sql) => ({
    bind: (...args) => ({
      run: async () => {
        if (sql.startsWith("UPDATE parametres_prix")) valeurs[args[2]] = args[0];
        if (sql.startsWith("INSERT INTO audit_logs")) journal.push({ acteur: args[4], action: args[1], details: JSON.parse(args[5]), resultat: args[6] });
        return { meta: { changes: 1 } };
      }
    })
  });
  return { valeurs, journal, DB: { prepare: preparer, batch: async (requetes) => Promise.all(requetes.map((r) => r.run())) } };
}

const reponseBct = (texte, status = 200) => new Response(new TextEncoder().encode(texte), { status, headers: { "Content-Type": "text/html; charset=ISO-8859-1" } });
const reponseJson = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });

describe("mettreAJourTaux", () => {
  let base;
  beforeEach(() => { base = d1Simulee(); });
  afterEach(() => vi.unstubAllGlobals());
  const env = () => ({ DB: base.DB, PRIX_URL_BCT: "https://bct.test/cours.jsp", PRIX_URL_SECOURS: "https://secours.test/EUR" });

  it("BCT disponible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseBct(PAGE_BCT)));
    expect(await mettreAJourTaux(env())).toEqual({ ok: true, source: "BCT", valeur: 3.3834 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://bct.test/cours.jsp");
    expect(base.valeurs).toMatchObject({ taux_auto: "3.3834", taux_auto_source: "BCT" });
    expect(base.journal).toEqual([{ acteur: "systeme", action: "prix.taux_auto", details: { source: "BCT", valeur: "3.3834", echecs: [] }, resultat: "ok" }]);
  });

  it("BCT en échec, secours disponible", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => (url.includes("bct") ? reponseBct("indisponible", 503) : reponseJson({ result: "success", rates: { TND: 3.4012 } }))));
    expect(await mettreAJourTaux(env())).toEqual({ ok: true, source: "ExchangeRate-API", valeur: 3.4012 });
    expect(base.valeurs.taux_auto).toBe("3.4012");
    expect(base.journal[0]).toMatchObject({ acteur: "systeme", resultat: "ok", details: { source: "ExchangeRate-API", echecs: ["BCT : HTTP 503"] } });
  });

  it("deux sources en échec : l'ancien taux est gardé", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url.includes("bct")) throw new Error("réseau coupé");
      return reponseJson({}, 500);
    }));
    expect((await mettreAJourTaux(env())).ok).toBe(false);
    expect(base.valeurs).toMatchObject({ taux_auto: "3.3", taux_auto_date: "2026-11-05T06:00:00.000Z" });
    expect(base.journal).toEqual([{ acteur: "systeme", action: "prix.taux_auto", details: { echecs: ["BCT : réseau coupé", "ExchangeRate-API : HTTP 500"] }, resultat: "erreur" }]);
  });

  it("valeur aberrante rejetée", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => (url.includes("bct") ? reponseBct("EURO EUR 1 33,834") : reponseJson({ rates: { TND: 0.29 } }))));
    expect((await mettreAJourTaux(env())).ok).toBe(false);
    expect(base.valeurs.taux_auto).toBe("3.3");
    expect(base.journal[0].details.echecs).toEqual(["BCT : valeur rejetée (33.834)", "ExchangeRate-API : valeur rejetée (0.29)"]);
  });

  it("page BCT sans ligne EUR : secours utilisé", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => (url.includes("bct") ? reponseBct("<p>Maintenance</p>") : reponseJson({ rates: { TND: 3.39 } }))));
    expect(await mettreAJourTaux(env())).toEqual({ ok: true, source: "ExchangeRate-API", valeur: 3.39 });
  });
});
