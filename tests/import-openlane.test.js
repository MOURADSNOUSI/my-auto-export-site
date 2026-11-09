// Tests de l'import OpenLane (worker/import-openlane.js) : lecture d'une annonce brute et passage au format du catalogue.
// Lancement : npm run test:js
import { describe, expect, it } from "vitest";
import { FILTRES_DEFAUT, annonceImport, horsFiltres, parametresImport, plafondApi, referenceImport, validerFiltres, versVehicule } from "../worker/import-openlane.js";

// Forme réelle d'une annonce TheCarApi (contrat 2026-10-05), valeurs inventées pour le test. engine_cc n'existe pas chez
// TheCarApi : présent ici pour vérifier le repli.
const BRUTE = {
  auction_id_str: "9876543210", site_name: "openlane", clean_make: "Peugeot", clean_model: "3008", car_name_en: "Peugeot 3008 1.5 BlueHDi",
  registration_year: 2021, date_first_registration: "2021-03-15T00:00:00", is_buy_now: true, mileage: 64000, fuel_group: "Diesel", gearbox_group: "Automatic",
  hp: 130, buy_now_price: 14500, public_price_eur: 19600, engine_cc: 1499, color: "Grey", original_url: "https://www.openlane.eu/en/car/info?auctionId=9876543210",
  auction_end_at: "2026-11-20T15:00:00Z", thumbnail_url: "/image-vault/aa/bb/x.webp?k=1&exp=1&sig=s",
  original_thumbnail_url: "https://images.openlane.eu/carimgs/1/general/1.jpg",
  images: [{ url: "https://images.openlane.eu/carimgs/1/general/1.jpg", served_url: "/image-vault/1.webp" }, { url: "https://images.openlane.eu/carimgs/1/general/2.jpg" },
    { url: "http://images.openlane.eu/3.jpg" }, { url: "javascript:alert(1)" }, { remote_url: "https://images.openlane.eu/carimgs/1/general/4.jpg" },
    { url: "/auction-photo/openlane/9876543210/5?k=142&exp=1798761600&sig=abc" }, { url: "/autre/chemin.jpg" }]
};

describe("referenceImport", () => {
  it("préfixe par OL- et ne garde que des caractères sûrs", () => {
    expect(referenceImport("9876543210")).toBe("OL-9876543210");
    expect(referenceImport("12/34 <b>")).toBe("OL-1234b");
    expect(referenceImport("a".repeat(60))).toHaveLength(40);
    expect(referenceImport("")).toBeNull();
    expect(referenceImport("///")).toBeNull();
  });
});

describe("préfiltre de l'administration", () => {
  it("par défaut : achat immédiat, 2022 ou après, 150 000 km et 30 000 € au plus", () => {
    expect(FILTRES_DEFAUT).toEqual({ anneeMin: 2022, anneeMax: null, kmMax: 150000, prixMaxEur: 30000, achatImmediat: true, carburant: "", boite: "" });
    expect(parametresImport(new URLSearchParams(), FILTRES_DEFAUT)).toEqual({
      site: "openlane", limit: "24", year_from: "2022", kilometers_to: "150000", price_to: "41100", buy_now: "true"
    });
  });

  it("traduit le préfiltre réglé en paramètres TheCarApi", () => {
    const filtres = { anneeMin: 2023, anneeMax: 2025, kmMax: 80000, prixMaxEur: 45000, achatImmediat: false, carburant: "Diesel", boite: "Automatic" };
    expect(parametresImport(new URLSearchParams(), filtres)).toEqual({
      site: "openlane", limit: "24", year_from: "2023", year_to: "2025", kilometers_to: "80000", price_to: "45000", fuel: "Diesel", gearbox: "Automatic"
    });
  });

  it("la recherche du moment ne peut que resserrer", () => {
    const p = parametresImport(new URLSearchParams("year_from=2019&price_to=90000&buy_now=false&site=bca&fuel=Petrol&brand=Peugeot&page=3"), FILTRES_DEFAUT);
    expect(p).toMatchObject({ site: "openlane", year_from: "2022", price_to: "41100", buy_now: "true", fuel: "Petrol", brand: "Peugeot", page: "3" });
    expect(parametresImport(new URLSearchParams("year_from=2025&price_to=20000"), FILTRES_DEFAUT)).toMatchObject({ year_from: "2025", price_to: "28400" });
    expect(parametresImport(new URLSearchParams("fuel=Petrol"), { ...FILTRES_DEFAUT, carburant: "Diesel" }).fuel).toBe("Diesel");
    expect(() => parametresImport(new URLSearchParams("brand=%3Cb%3E"), FILTRES_DEFAUT)).toThrow(/brand/);
    expect(() => parametresImport(new URLSearchParams("page=51"), FILTRES_DEFAUT)).toThrow(/page/);
  });

  it("valide les valeurs saisies", () => {
    expect(validerFiltres({ prixMaxEur: 50000 }, 2026).filtres).toEqual({ ...FILTRES_DEFAUT, prixMaxEur: 50000 });
    for (const mauvais of [{ anneeMin: 1980 }, { anneeMin: 2030 }, { anneeMax: 2020 }, { kmMax: 0 }, { prixMaxEur: "30000" }, { achatImmediat: "oui" }, { carburant: "Gasoil" }, { boite: "CVT" }]) {
      expect(validerFiltres(mauvais, 2026).erreur, JSON.stringify(mauvais)).toBeTruthy();
    }
    expect(validerFiltres(null).erreur).toBeTruthy();
    // Clés inconnues ignorées.
    expect(validerFiltres({ site: "bca" }, 2026).filtres).toEqual(FILTRES_DEFAUT);
  });

  it("contrôle chaque annonce contre le préfiltre", () => {
    const a = { achatImmediat: true, annee: 2024, km: 20000, prixEur: 25000, prixAchatImmediatEur: 25000 };
    expect(horsFiltres(a, FILTRES_DEFAUT)).toBeNull();
    expect(horsFiltres({ ...a, achatImmediat: false }, FILTRES_DEFAUT)).toMatch(/achat immédiat/);
    expect(horsFiltres({ ...a, achatImmediat: false }, { ...FILTRES_DEFAUT, achatImmediat: false })).toBeNull();
    expect(horsFiltres({ ...a, annee: 2021 }, FILTRES_DEFAUT)).toMatch(/2022/);
    expect(horsFiltres({ ...a, annee: 2026 }, { ...FILTRES_DEFAUT, anneeMax: 2025 })).toMatch(/2025/);
    expect(horsFiltres({ ...a, km: 160000 }, FILTRES_DEFAUT)).toMatch(/km/);
    expect(horsFiltres({ ...a, prixEur: 31000 }, FILTRES_DEFAUT)).toMatch(/€/);
    // Achat immédiat : un prix d'achat immédiat affiché est obligatoire.
    expect(horsFiltres({ ...a, prixAchatImmediatEur: null }, FILTRES_DEFAUT)).toMatch(/prix d'achat immédiat/);
    expect(horsFiltres({ ...a, prixAchatImmediatEur: null }, { ...FILTRES_DEFAUT, achatImmediat: false })).toBeNull();
  });

  it("plafond élargi envoyé à l'API (price_to porte sur le prix tout compris de TheCarApi)", () => {
    expect(plafondApi(30000)).toBe(41100);
    expect(plafondApi(1500)).toBe(4905);
    // Plafond exact quand l'achat immédiat n'est pas exigé : TheCarApi filtre alors le prix qu'il affiche.
    expect(parametresImport(new URLSearchParams("price_to=20000"), { ...FILTRES_DEFAUT, achatImmediat: false }).price_to).toBe("20000");
    expect(parametresImport(new URLSearchParams("price_to=20000"), FILTRES_DEFAUT).price_to).toBe(String(plafondApi(20000)));
  });
});

describe("annonceImport", () => {
  it("lit marque, modèle, lien, cylindrée et photos en https sans doublon", () => {
    const a = annonceImport(BRUTE);
    expect(a).toMatchObject({
      achatImmediat: true, numero: "9876543210", reference: "OL-9876543210", marque: "Peugeot", modele: "3008", annee: 2021, km: 64000,
      carburant: "Diesel", boite: "Automatic", prixEur: 14500, cylindree: 1499, puissance: 130, couleur: "Grey",
      premiereImmatriculation: "2021-03-15", lien: "https://www.openlane.eu/en/car/info?auctionId=9876543210", finEnchere: "2026-11-20T15:00:00.000Z"
    });
    // Adresse d'origine si elle existe, sinon copie de TheCarApi rendue absolue ; http, javascript: et chemins inconnus écartés.
    expect(a.photos).toEqual(["https://images.openlane.eu/carimgs/1/general/1.jpg", "https://images.openlane.eu/carimgs/1/general/2.jpg",
      "https://images.openlane.eu/carimgs/1/general/4.jpg", "https://api.thecarapi.com/auction-photo/openlane/9876543210/5?k=142&exp=1798761600&sig=abc"]);
  });

  it("prend le prix d'achat immédiat affiché, pas le prix tout compris de TheCarApi", () => {
    expect(annonceImport(BRUTE)).toMatchObject({ prixEur: 14500, prixAchatImmediatEur: 14500 });
    // Annonce aux enchères ou sans prix d'achat immédiat : prix de TheCarApi en repli, aucun prix d'achat immédiat.
    expect(annonceImport({ ...BRUTE, is_buy_now: false })).toMatchObject({ prixEur: 19600, prixAchatImmediatEur: null });
    expect(annonceImport({ ...BRUTE, buy_now_price: 0 })).toMatchObject({ prixEur: 19600, prixAchatImmediatEur: null });
  });

  it("écarte un lien non https et une cylindrée invraisemblable", () => {
    const a = annonceImport({ ...BRUTE, original_url: "javascript:alert(1)", engine_cc: 3 });
    expect(a.lien).toBeNull();
    expect(a.cylindree).toBeNull();
  });
});

describe("versVehicule", () => {
  it("donne un véhicule en stock avec la source suivie", () => {
    const { reference, corps, source } = versVehicule(annonceImport(BRUTE));
    expect(reference).toBe("OL-9876543210");
    expect(corps).toMatchObject({
      make: "Peugeot", model: "3008", status: "stock", year: 2021, mileageKm: 64000, prixEur: 14500, engineCc: 1499, powerHp: 130,
      premiereImmatriculation: "2021-03-15", sourceUrl: "https://www.openlane.eu/en/car/info?auctionId=9876543210", seller: "Vendeur professionnel (OpenLane)"
    });
    expect(corps.photos).toHaveLength(4);
    expect(corps.specs[0]).toEqual(["Source", "OpenLane"]);
    expect(source).toEqual({ site: "openlane", id: "9876543210", finEnchere: "2026-11-20T15:00:00.000Z", termine: false });
  });

  it("refuse une annonce sans numéro, marque ou modèle", () => {
    expect(versVehicule(null).erreur).toMatch(/manquante/);
    expect(versVehicule({ marque: "Peugeot", modele: "3008" }).erreur).toMatch(/Numéro/);
    expect(versVehicule({ numero: "1", modele: "3008" }).erreur).toMatch(/Marque et modèle/);
  });
});
