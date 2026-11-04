// Tests du catalogue Europe (worker/voitures-europe.js) avec fetch et Cache API simulés : aucun appel réel à TheCarApi.
// Lancement : npm run test:js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_SECONDES, ErreurCatalogue, normaliser, parametresRecherche, voituresEurope } from "../worker/voitures-europe.js";

const ENV = { THECARAPI_KEY: "cle-de-test", EUR_TND_RATE: "3.5" };
const ORIGINE = "https://www.myautoexport.com";

function reponseApi(corps, status = 200) {
  return new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });
}

// Cache API minimale : une Map indexée par l'adresse de la requête.
function cacheSimule() {
  const entrees = new Map();
  return {
    entrees,
    match: vi.fn(async (requete) => entrees.get(requete.url)?.clone()),
    put: vi.fn(async (requete, reponse) => { entrees.set(requete.url, reponse); })
  };
}

async function appeler(recherche = "", env = ENV) {
  const url = new URL(`${ORIGINE}/api/voitures-europe${recherche}`);
  return voituresEurope(new Request(url), env, url, null);
}

function parametresEnvoyes(appel = 0) {
  return new URL(fetch.mock.calls[appel][0]).searchParams;
}

let cache;
beforeEach(() => {
  cache = cacheSimule();
  vi.stubGlobal("caches", { default: cache });
  vi.stubGlobal("fetch", vi.fn(async () => reponseApi({ total: 0, results: [] })));
});
afterEach(() => vi.unstubAllGlobals());

describe("préfiltre M&Y", () => {
  it("est toujours envoyé, avec la clé dans l'en-tête", async () => {
    await appeler();
    const envoyes = parametresEnvoyes();
    expect(Object.fromEntries(envoyes)).toEqual({
      site: "openlane,ecarstrade", year_from: "2019", mileage_to: "150000", price_to: "30000", limit: "24"
    });
    expect(fetch.mock.calls[0][0].startsWith("https://api.thecarapi.com/api/search?")).toBe(true);
    expect(fetch.mock.calls[0][1].headers["X-API-Key"]).toBe("cle-de-test");
  });

  it("peut seulement être resserré par le visiteur", async () => {
    expect(parametresRecherche(new URLSearchParams("year_from=2015&price_to=50000"))).toMatchObject({ year_from: "2019", price_to: "30000" });
    expect(parametresRecherche(new URLSearchParams("year_from=2022&price_to=18000"))).toMatchObject({ year_from: "2022", price_to: "18000" });
  });

  it("accepte les affinages autorisés", async () => {
    await appeler("?brand=Peugeot,Renault&model=3008&fuel=Diesel&page=2");
    expect(Object.fromEntries(parametresEnvoyes())).toMatchObject({ brand: "Peugeot,Renault", model: "3008", fuel: "Diesel", page: "2" });
  });
});

describe("paramètres du visiteur", () => {
  it("ignore un paramètre non autorisé, même s'il recouvre le préfiltre", async () => {
    await appeler("?site=autre&limit=500&mileage_to=999999&cle=x&brand=BMW");
    const envoyes = Object.fromEntries(parametresEnvoyes());
    expect(envoyes).toMatchObject({ site: "openlane,ecarstrade", limit: "24", mileage_to: "150000", brand: "BMW" });
    expect(envoyes).not.toHaveProperty("cle");
  });

  it.each([
    ["brand", "<script>"],
    ["model", "a".repeat(41)],
    ["fuel", "diesel;drop"],
    ["year_from", "deux-mille"],
    ["price_to", "1e9"],
    ["page", "0"],
    ["page", "51"]
  ])("rejette %s=%s sans appeler l'API", async (nom, valeur) => {
    const appel = appeler(`?${nom}=${encodeURIComponent(valeur)}`);
    await expect(appel).rejects.toBeInstanceOf(ErreurCatalogue);
    await expect(appel).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepte lettres accentuées, chiffres, espaces, virgules, points et tirets", () => {
    expect(parametresRecherche(new URLSearchParams("model=Classe C 300e,A-Klasse.2")).model).toBe("Classe C 300e,A-Klasse.2");
    expect(parametresRecherche(new URLSearchParams("brand=Citroën")).brand).toBe("Citroën");
  });
});

describe("normalisation", () => {
  it("lit les champs connus et les replis", () => {
    const resultat = normaliser({
      total: 2,
      results: [
        {
          auction_id: 7754225, car_name_en: "Mercedes-Benz GLC 300e", registration_year: "2021-03",
          public_price_eur: 28500, site_name: "OPENLANE", mileage: "85 659", fuel_type: "Hybrid", gearbox: "Automatic",
          auction_end: "2026-11-10T16:00:00Z", images: [{ url: "https://cdn.exemple.com/1.jpg" }]
        },
        { id: "x1", title: "Peugeot 3008", year: 2020, price_eur: "19990,50", km: 120000, transmission: "Manual", image: "http://non-chiffre.jpg" }
      ]
    }, 3.5);
    expect(resultat).toEqual({
      total: 2,
      voitures: [
        {
          id: "openlane-7754225", titre: "Mercedes-Benz GLC 300e", annee: 2021, km: 85659, carburant: "Hybrid", boite: "Automatic",
          prixEur: 28500, prixTnd: 99750, source: "OPENLANE", finEnchere: "2026-11-10T16:00:00.000Z", image: "https://cdn.exemple.com/1.jpg"
        },
        {
          id: "x1", titre: "Peugeot 3008", annee: 2020, km: 120000, carburant: null, boite: "Manual",
          prixEur: 19990.5, prixTnd: 69967, source: null, finEnchere: null, image: null
        }
      ]
    });
  });

  it("distingue deux enchères de même numéro sur deux sources", () => {
    const { voitures } = normaliser({ results: [{ auction_id: 42, site_name: "OPENLANE" }, { auction_id: 42, site_name: "eCarsTrade" }] }, null);
    expect(voitures.map((voiture) => voiture.id)).toEqual(["openlane-42", "ecarstrade-42"]);
  });

  it("compose le titre avec la marque et le modèle si car_name_en manque", () => {
    const { voitures } = normaliser({ results: [{ brand: "Peugeot", model: "3008" }, { make: "Audi" }, { car_name_en: "  ", model: "Q5" }] }, null);
    expect(voitures.map((voiture) => voiture.titre)).toEqual(["Peugeot 3008", "Audi", "Q5"]);
  });

  it("tolère une réponse incomplète ou inattendue", () => {
    expect(normaliser(null, 3.5)).toEqual({ total: 0, voitures: [] });
    expect(normaliser({ cars: [{}, null, "x"] }, null)).toEqual({
      total: 1,
      voitures: [{ id: null, titre: null, annee: null, km: null, carburant: null, boite: null, prixEur: null, prixTnd: null, source: null, finEnchere: null, image: null }]
    });
  });
});

describe("conversion en dinars", () => {
  const voiture = { results: [{ auction_id: 1, public_price_eur: 10001 }] };

  it("arrondit prixEur × EUR_TND_RATE", async () => {
    fetch.mockResolvedValueOnce(reponseApi(voiture));
    const corps = await (await appeler()).json();
    expect(corps.voitures[0]).toMatchObject({ prixEur: 10001, prixTnd: 35004 });
  });

  it.each([[undefined], ["0"], ["abc"], ["-3"]])("renvoie prixTnd null si le taux vaut %s", async (taux) => {
    fetch.mockResolvedValueOnce(reponseApi(voiture));
    const corps = await (await appeler("", { THECARAPI_KEY: "cle-de-test", EUR_TND_RATE: taux })).json();
    expect(corps.voitures[0]).toMatchObject({ prixEur: 10001, prixTnd: null });
  });
});

describe("cache", () => {
  it("garde la réponse 15 minutes, avec une clé indépendante de l'ordre des paramètres", async () => {
    const premiere = await appeler("?fuel=Diesel&brand=BMW");
    expect(premiere.headers.get("Cache-Control")).toBe(`public, max-age=${CACHE_SECONDES}`);
    const seconde = await appeler("?brand=BMW&fuel=Diesel");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await seconde.json()).toEqual({ total: 0, voitures: [] });
    expect([...cache.entrees.keys()]).toEqual([`${ORIGINE}/api/voitures-europe?brand=BMW&fuel=Diesel&limit=24&mileage_to=150000&price_to=30000&site=openlane%2Cecarstrade&year_from=2019`]);
  });
});

describe("erreurs", () => {
  it.each([401, 403, 429, 500])("API en %i : 502 en français, statut journalisé, sans nouvelle tentative ni cache", async (status) => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    fetch.mockResolvedValueOnce(reponseApi({ error: "Invalid API key cle-de-test" }, status));
    const erreur = await appeler().catch((e) => e);
    expect(erreur).toBeInstanceOf(ErreurCatalogue);
    expect(erreur.status).toBe(502);
    expect(erreur.message).toMatch(/momentanément indisponible/);
    expect(erreur.message).not.toMatch(/cle-de-test|Invalid|401|403|429/);
    expect(journal).toHaveBeenCalledWith("thecarapi", status);
    expect(JSON.stringify(journal.mock.calls)).not.toContain("cle-de-test");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("réseau coupé ou réponse illisible : 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(appeler()).rejects.toMatchObject({ status: 502 });
    fetch.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    await expect(appeler()).rejects.toMatchObject({ status: 502 });
  });

  it("sans clé configurée : 503, aucun appel", async () => {
    await expect(appeler("", {})).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
