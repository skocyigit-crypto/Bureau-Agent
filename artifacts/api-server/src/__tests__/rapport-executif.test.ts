// Le serveur de production tourne en UTC (Cloud Run). Sans cela, un poste
// de dev regle sur Paris masquerait l'oubli du fuseau : mutation survivante.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bornerJours, derniersJours, ecart, heureLocale, jourLocal, libelleJour,
  pourcent, rangSeverite, scoreGlobal, tauxDeGain, tendance,
} from "../services/rapport-executif";

const ROUTE = readFileSync(join(import.meta.dirname, "..", "routes", "smart-reports.ts"), "utf8");

describe("zero n'est pas inconnu", () => {
  it("taux sans appel : null, donc pas d'alerte « 0 % »", () => expect(pourcent(0, 0)).toBeNull());
  it("taux mesure", () => expect(pourcent(17, 20)).toBe(85));
  it("tendance sans reference : null", () => expect(tendance(50, 0)).toBeNull());
  it("tendance mesuree", () => expect(tendance(30, 20)).toBe(50));
  it("ecart en points, null si un taux manque", () => {
    expect(ecart(80, 70)).toBe(10);
    expect(ecart(null, 70)).toBeNull();
    expect(ecart(80, null)).toBeNull();
  });
  it("l'alerte critique est conditionnee a un taux connu", () => {
    expect(ROUTE).toContain("responseRate !== null && responseRate < 70");
  });
});

describe("taux de gain sur les affaires conclues", () => {
  it("les affaires ouvertes ne comptent pas", () => expect(tauxDeGain(2, 2)).toBe(50));
  it("aucune affaire conclue : null", () => expect(tauxDeGain(0, 0)).toBeNull());
  it("tout perdu reste une mesure : 0", () => expect(tauxDeGain(0, 4)).toBe(0));
  it("la route n'utilise plus le total des affaires creees", () => {
    expect(ROUTE).toContain("tauxDeGain(ps.won, ps.lost)");
    expect(ROUTE).not.toContain("ps.won / ps.total");
  });
});

describe("score global", () => {
  it("moyenne des composantes connues seulement", () => expect(scoreGlobal([80, null, 60])).toBe(70));
  it("aucune composante : null", () => expect(scoreGlobal([null, null, null])).toBeNull());
  it("la composante « contacts par jour x 100 » a disparu", () => expect(ROUTE).not.toContain("periodDays)) * 100"));
});

describe("tri des rappels", () => {
  it("critique passe avant info (0 n'est pas « absent »)", () => {
    expect(rangSeverite("critique")).toBe(0);
    expect(rangSeverite("critique")).toBeLessThan(rangSeverite("info"));
  });
  it("severite inconnue en dernier", () => expect(rangSeverite("bizarre")).toBe(3));
  it("la route trie avec rangSeverite", () => expect(ROUTE).toContain("rangSeverite(a.severity) - rangSeverite(b.severity)"));
});

describe("bornes", () => {
  it("days absent, invalide ou negatif : valeur par defaut", () => {
    expect(bornerJours(undefined, 14)).toBe(14);
    expect(bornerJours("abc", 14)).toBe(14);
    expect(bornerJours("-5", 14)).toBe(14);
  });
  it("days demesure plafonne a 365", () => expect(bornerJours("100000", 14)).toBe(365));
  it("la chronologie ne boucle plus de requetes par jour", () => {
    const i = ROUTE.indexOf('"/smart-reports/daily-timeline"');
    expect(ROUTE.slice(i, i + 2500)).not.toContain("for (let i = 0; i < days; i++)");
  });
});

describe("fuseau de Paris, pas celui du serveur", () => {
  it("10h30 a Paris s'affiche 10:30 (et non 08:30 UTC)", () => {
    expect(heureLocale(new Date("2026-07-15T08:30:00Z"))).toBe("10:30");
  });
  it("lundi 00h30 Paris est lundi", () => expect(jourLocal(new Date("2026-07-12T22:30:00Z"))).toBe("2026-07-13"));
  it("n derniers jours, aujourd'hui inclus, ordonnes", () => {
    expect(derniersJours(3, new Date("2026-03-01T10:00:00Z"))).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
  it("le passage a l'heure d'ete ne saute ni ne double un jour", () => {
    const j = derniersJours(3, new Date("2026-03-30T10:00:00Z"));
    expect(j).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
  });
  it("evenement de 23h30 ce soir : aujourd'hui ; 00h30 : demain", () => {
    const maintenant = new Date("2026-07-15T08:00:00Z");
    expect(libelleJour(new Date("2026-07-15T21:30:00Z"), maintenant)).toBe("Aujourd'hui");
    expect(libelleJour(new Date("2026-07-15T22:30:00Z"), maintenant)).toBe("Demain");
  });
  it("la route n'affiche plus d'heure sans fuseau", () => {
    expect(ROUTE).not.toMatch(/toLocaleTimeString\("fr-FR", \{ hour: "2-digit", minute: "2-digit" \}\)/);
  });
});
