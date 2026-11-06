// Tests de l'import OpenLane (worker/import-openlane.js) : lecture d'une annonce brute et passage au format du catalogue.
// Lancement : npm run test:js
import { describe, expect, it } from "vitest";
import { annonceImport, referenceImport, versVehicule } from "../worker/import-openlane.js";

// Forme réelle d'une annonce TheCarApi (contrat 2026-10-05), valeurs inventées pour le test. engine_cc n'existe pas chez
// TheCarApi : présent ici pour vérifier le repli.
const BRUTE = {
  auction_id_str: "9876543210", site_name: "openlane", clean_make: "Peugeot", clean_model: "3008", car_name_en: "Peugeot 3008 1.5 BlueHDi",
  registration_year: 2021, date_first_registration: "2021-03-15T00:00:00", mileage: 64000, fuel_group: "Diesel", gearbox_group: "Automatic",
  hp: 130, public_price_eur: 14500, engine_cc: 1499, color: "Grey", original_url: "https://www.openlane.eu/en/car/info?auctionId=9876543210",
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

describe("annonceImport", () => {
  it("lit marque, modèle, lien, cylindrée et photos en https sans doublon", () => {
    const a = annonceImport(BRUTE);
    expect(a).toMatchObject({
      numero: "9876543210", reference: "OL-9876543210", marque: "Peugeot", modele: "3008", annee: 2021, km: 64000,
      carburant: "Diesel", boite: "Automatic", prixEur: 14500, cylindree: 1499, puissance: 130, couleur: "Grey",
      premiereImmatriculation: "2021-03-15", lien: "https://www.openlane.eu/en/car/info?auctionId=9876543210", finEnchere: "2026-11-20T15:00:00.000Z"
    });
    // Adresse d'origine si elle existe, sinon copie de TheCarApi rendue absolue ; http, javascript: et chemins inconnus écartés.
    expect(a.photos).toEqual(["https://images.openlane.eu/carimgs/1/general/1.jpg", "https://images.openlane.eu/carimgs/1/general/2.jpg",
      "https://images.openlane.eu/carimgs/1/general/4.jpg", "https://api.thecarapi.com/auction-photo/openlane/9876543210/5?k=142&exp=1798761600&sig=abc"]);
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
