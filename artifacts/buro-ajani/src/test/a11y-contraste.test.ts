/**
 * Le texte ambre se lit (RGAA 3.2 / WCAG 1.4.3 : 4,5:1 pour le texte courant).
 *
 * L'ambre de marque (hsl 38 92% 50%) ne donne que 2,1:1 sur fond clair —
 * mesure par pa11y sur le site le 21/09/2026, et 113 textes `text-primary`
 * dans l'application. Un ambre plus sombre est reserve au TEXTE ; les aplats
 * et les fonds gardent l'ambre de marque.
 *
 * Les ratios sont CALCULES a partir des jetons des feuilles de style, pas
 * recopies : un jeton modifie demain est remesure.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const CSS_APP = readFileSync(join(RACINE, "artifacts", "buro-ajani", "src", "index.css"), "utf8");
const CSS_SITE = readFileSync(join(RACINE, "artifacts", "tanitim", "src", "index.css"), "utf8");

/** Le bloc `:root { ... }` (theme clair), sans le bloc `.dark`. */
function racine(css: string): string {
  const i = css.indexOf(":root {");
  return css.slice(i, css.indexOf("}", i));
}

/** « 32 100% 33% » -> [h, s, l] */
function jeton(bloc: string, nom: string): [number, number, number] {
  const m = new RegExp(`--${nom}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(bloc);
  if (!m) throw new Error(`jeton --${nom} introuvable`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function rgb([h, s, l]: [number, number, number]): [number, number, number] {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminance(c: [number, number, number]): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(c).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const BLANC: [number, number, number] = [0, 0, 100];

describe("le calcul est juste", () => {
  it("noir sur blanc donne 21:1", () => {
    expect(ratio([0, 0, 0], BLANC)).toBeCloseTo(21, 1);
  });

  it("l'ambre de marque sur blanc echoue, comme pa11y l'a mesure", () => {
    // Sans ce temoin, un calcul faux pourrait tout declarer conforme.
    expect(ratio([38, 92, 50], BLANC)).toBeLessThan(2.5);
  });
});

describe("application : le texte ambre en theme clair", () => {
  const clair = racine(CSS_APP);

  it("le jeton de texte depasse 4,5:1 sur le fond", () => {
    expect(ratio(jeton(clair, "primary-text"), jeton(clair, "background"))).toBeGreaterThanOrEqual(4.5);
  });

  it("et sur les cartes", () => {
    expect(ratio(jeton(clair, "primary-text"), jeton(clair, "card"))).toBeGreaterThanOrEqual(4.5);
  });

  it("text-primary l'emploie en theme clair", () => {
    // Une regle, pas 113 classes : un nouvel ecran en herite sans y penser.
    expect(CSS_APP).toMatch(/:root:not\(\.dark\) \.text-primary\s*\{\s*color:\s*hsl\(var\(--primary-text\)\)/);
  });

  it("en theme sombre, l'ambre de marque suffit deja", () => {
    const i = CSS_APP.indexOf(".dark {");
    const sombre = CSS_APP.slice(i, CSS_APP.indexOf("}", i));
    expect(ratio(jeton(sombre, "primary"), jeton(sombre, "background"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("site : les intitules ambres sur fond clair", () => {
  const clair = racine(CSS_SITE);

  it("le jeton de texte depasse 4,5:1 sur le fond", () => {
    expect(ratio(jeton(clair, "accent-text"), jeton(clair, "background"))).toBeGreaterThanOrEqual(4.5);
  });

  it("les deux intitules releves par pa11y l'emploient", () => {
    const home = readFileSync(join(RACINE, "artifacts", "tanitim", "src", "pages", "home.tsx"), "utf8");
    for (const t of ["Plateforme Unifiée", "Déploiement Éclair"]) {
      const i = home.indexOf(`>${t}</span>`);
      expect(i, `${t} introuvable`).toBeGreaterThan(0);
      expect(home.slice(i - 140, i), `${t} n'emploie pas l'ambre de texte`).toContain("text-[hsl(var(--accent-text))]");
    }
  });
});
