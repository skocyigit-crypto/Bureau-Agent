import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Budget d'accessibilite de la vitrine — cliquet anti-regression.
 *
 * C'est la page ou arrivent les prospects, et la seule que Google indexe. Un
 * defaut y coute deux fois: il ecarte des visiteurs, et il est visible de
 * l'exterieur.
 *
 * La vitrine est aujourd'hui a ZERO bouton-icone sans nom accessible. Le
 * plafond est donc fixe a zero: c'est le cliquet le plus strict possible, et
 * il n'y a aucune raison de le desserrer sur un site de cette taille.
 */

const SRC = path.resolve(import.meta.dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

const ICON_ONLY =
  /<(Button|button)\b([^>]*)>\s*(?:\{[^}]*\?\s*)?<([A-Z][A-Za-z0-9]*)\b[^>]*\/>(?:\s*:\s*<[A-Z][A-Za-z0-9]*\b[^>]*\/>\s*\})?\s*<\/\1>/g;

describe("budget d'accessibilite de la vitrine", () => {
  it("ne laisse aucun bouton-icone sans nom accessible", () => {
    const found: string[] = [];
    for (const file of walk(SRC)) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(ICON_ONLY)) {
        if (/aria-label|aria-labelledby|title=/.test(m[2] ?? "")) continue;
        found.push(`${path.relative(SRC, file)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(found, `Boutons sans nom accessible:\n${found.join("\n")}`).toEqual([]);
  });

  it("garde le lien d'evitement", () => {
    // WCAG 2.2 2.4.1 (A).
    const navbar = fs.readFileSync(path.join(SRC, "components/layout/Navbar.tsx"), "utf8");
    expect(navbar).toContain('href="#contenu"');
  });

  it("garde une cible de pointage utilisable pour le carrousel", () => {
    // Les puces mesuraient 6 px, espacees de 6 px: sous les 24x24 de WCAG 2.2
    // 2.5.8 (AA), sans controle equivalent ailleurs — elles sont le seul moyen
    // de choisir un exemple — et de fait intouchables au doigt.
    const demo = fs.readFileSync(path.join(SRC, "components/AjanDemo.tsx"), "utf8");
    expect(demo).toContain("h-6 min-w-6");
    // La puce visible reste portee par un span interieur: la zone cliquable
    // grandit, l'apparence ne bouge pas.
    expect(demo).toMatch(/<span\s+aria-hidden="true"/);
  });
});
