// Pages « S'informer » (worker/informer.js) et menu de l'en-tête (worker/seo.js, menuInformer).
import { describe, expect, it } from "vitest";
import { COLONNES_INFORMER, PAGES_INFORMER } from "../worker/informer.js";
import { estRouteSeo, menuInformer } from "../worker/seo.js";

describe("pages S'informer", () => {
  const chemins = COLONNES_INFORMER.flatMap((c) => c.pages);

  it("trois colonnes, dix pages, toutes rédigées", () => {
    expect(COLONNES_INFORMER.map((c) => c.titre)).toEqual(["Magazine", "Conseils", "Services"]);
    expect(chemins).toHaveLength(10);
    expect(Object.keys(PAGES_INFORMER).sort()).toEqual([...chemins].sort());
    for (const chemin of chemins) {
      const page = PAGES_INFORMER[chemin];
      expect(chemin).toMatch(/^\/(magazine|conseils|services)\/[a-z0-9-]+$/);
      expect(page.titre.length, chemin).toBeGreaterThan(10);
      expect(page.description.length, chemin).toBeLessThanOrEqual(200);
      expect(page.sections.length, chemin).toBeGreaterThanOrEqual(3);
      expect(page.sources.length, chemin).toBeGreaterThanOrEqual(1);
      for (const [, url] of page.sources) expect(url, chemin).toMatch(/^https:\/\//);
      expect(estRouteSeo(chemin), chemin).toBe(true);
    }
  });

  it("le menu mène aux pages, plus aucun lien « # »", () => {
    const html = menuInformer();
    expect(html).not.toContain('href="#"');
    for (const chemin of chemins) expect(html).toContain(`href="${chemin}"`);
    expect(html).toContain(">Certificat de conformité (CoC)</a>");
  });
});
