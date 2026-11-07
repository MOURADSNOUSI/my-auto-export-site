// Tests du design system (my-auto-export/design/) : contrastes WCAG AA des couples de couleurs utilisés par les composants,
// propriétés logiques (arabe RTL sans réécriture) et polices hébergées sur le site.
// Lancement : npm run test:js
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const racine = new URL("../my-auto-export/", import.meta.url);
const tokens = readFileSync(new URL("design/tokens.css", racine), "utf8");
const composants = readFileSync(new URL("design/composants.css", racine), "utf8");
const couleurs = Object.fromEntries([...tokens.matchAll(/--(my-[a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map(([, nom, valeur]) => [nom, valeur]));

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a, b) => {
  const [claire, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (claire + 0.05) / (sombre + 0.05);
};

describe("palette B (bleu nuit et or)", () => {
  it("garde les valeurs validées", () => {
    expect(couleurs).toMatchObject({ "my-nuit": "#14213d", "my-or": "#e9a23b", "my-vert": "#2f7d4f", "my-encre": "#111827", "my-fond": "#f7f7f5" });
  });

  // Couples texte / fond réellement employés par composants.css.
  const couples = [
    ["my-blanc", "my-nuit", "en-tête, bouton principal"],
    ["my-nuit", "my-or", "bouton d'action"],
    ["my-nuit", "my-or-700", "bouton d'action au survol"],
    ["my-blanc", "my-nuit-700", "bouton principal au survol"],
    ["my-nuit", "my-surface", "bouton contour, titres"],
    ["my-nuit", "my-nuit-100", "badge info, contour au survol"],
    ["my-nuit", "my-or-100", "badge accent"],
    ["my-vert-900", "my-vert-100", "badge positif"],
    ["my-blanc", "my-vert", "badge positif fort"],
    ["my-rouge", "my-rouge-100", "badge alerte"],
    ["my-encre", "my-fond", "texte de page"],
    ["my-encre-doux", "my-surface", "texte secondaire"],
    ["my-encre-doux", "my-fond", "texte secondaire sur le fond"],
    ["my-or", "my-nuit", "sous-titre de la marque sur l'en-tête"]
  ];
  for (const [texte, fond, usage] of couples) {
    it(`${usage} : contraste AA (4,5:1 au moins)`, () => {
      expect(couleurs[texte], texte).toBeDefined();
      expect(couleurs[fond], fond).toBeDefined();
      expect(contraste(couleurs[texte], couleurs[fond])).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("prêt pour l'arabe", () => {
  it("n'utilise que des propriétés logiques (pas de left, right, margin-left…)", () => {
    for (const [nom, css] of [["tokens.css", tokens], ["composants.css", composants]]) {
      const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(sansCommentaires, nom).not.toMatch(/(?:margin|padding|border)-(?:left|right)\b|(?:^|[;{\s])(?:left|right)\s*:|text-align:\s*(?:left|right)|float:\s*(?:left|right)/m);
    }
  });

  it("déclare Noto Sans Arabic et l'interligne arabe", () => {
    expect(tokens).toMatch(/font-family: "Noto Sans Arabic"/);
    expect(tokens).toMatch(/:root:lang\(ar\)[^{]*\{[^}]*--my-interligne: 1\.7/);
  });
});

describe("polices hébergées", () => {
  it("fournit les fichiers woff2 et la licence OFL, sans dépasser 200 Ko chacun", () => {
    for (const fichier of ["polices/noto-sans-latin.woff2", "polices/noto-sans-arabic.woff2"]) {
      const taille = statSync(new URL(fichier, racine)).size;
      expect(taille, fichier).toBeGreaterThan(10_000);
      expect(taille, fichier).toBeLessThan(200_000);
      expect(tokens).toContain(`/${fichier}`);
    }
    expect(readFileSync(new URL("polices/OFL.txt", racine), "utf8")).toMatch(/SIL Open Font License/);
  });
});
