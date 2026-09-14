/**
 * Le trait « maintenant » doit tomber a la bonne minute, dans les DEUX vues.
 *
 * Etat trouve: la vue jour calculait `(minutes / 60) * 100`; la vue semaine
 * ecrivait `top-1/2` — toujours le milieu de l'heure. A 10 h 05 le trait
 * annoncait 10 h 30.
 *
 * Un repere temporel faux est pire qu'un repere absent: on lit l'agenda en se
 * fiant a lui pour juger « ai-je encore le temps ». Trente minutes d'ecart,
 * c'est la difference entre partir maintenant et arriver en retard.
 *
 * Le calcul existait a un seul endroit sur deux: c'est la duplication qui a
 * permis aux deux vues de diverger, et ce fichier la remplace par une regle
 * unique et verifiable.
 */
import { describe, expect, it } from "vitest";

import { heureDOuverture, positionDansLHeure } from "@/lib/position-heure-courante";

const a = (h: number, m: number) => new Date(2026, 8, 15, h, m, 0, 0);

describe("la position du trait dans l'heure", () => {
  it.each([
    [0, 0],
    [15, 25],
    [30, 50],
    [45, 75],
    [59, Math.round((59 / 60) * 100)],
  ])("a %i minutes, le trait est a %i %% de la case", (minutes, attendu) => {
    expect(Math.round(positionDansLHeure(a(10, minutes)))).toBe(attendu);
  });

  it("ne vaut plus toujours 50 %", () => {
    // Contre-epreuve directe de l'ancienne vue semaine (`top-1/2`).
    expect(positionDansLHeure(a(10, 5))).not.toBe(50);
    expect(Math.round(positionDansLHeure(a(10, 5)))).toBe(8);
  });

  it("reste dans la case", () => {
    // Un trait sorti de sa ligne se superposerait a l'heure voisine et
    // designerait un creneau qui n'est pas le bon.
    for (let m = 0; m < 60; m++) {
      const p = positionDansLHeure(a(9, m));
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });
});

describe("l'heure sur laquelle ouvrir la grille", () => {
  const HEURES = Array.from({ length: 15 }, (_, i) => i + 7); // 7 h -> 21 h

  it("ouvre sur l'heure courante pendant la journee", () => {
    expect(heureDOuverture(HEURES, a(14, 20))).toBe(14);
  });

  it("ouvre sur la premiere heure affichee avant l'embauche", () => {
    // A 5 h du matin, ouvrir « a l'heure courante » montrerait une plage qui
    // n'existe pas dans la grille.
    expect(heureDOuverture(HEURES, a(5, 0))).toBe(7);
  });

  it("ouvre sur la derniere heure affichee en soiree", () => {
    expect(heureDOuverture(HEURES, a(23, 30))).toBe(21);
  });

  it("ne propose jamais une heure absente de la grille", () => {
    for (let h = 0; h < 24; h++) {
      expect(HEURES).toContain(heureDOuverture(HEURES, a(h, 0)));
    }
  });

  it("ne casse pas sur une grille vide", () => {
    expect(heureDOuverture([], a(10, 0))).toBe(0);
  });
});
