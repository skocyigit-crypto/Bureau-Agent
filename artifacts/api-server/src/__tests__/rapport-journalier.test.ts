// Production en UTC (Cloud Run) : un poste regle sur Paris masquerait l'oubli du fuseau.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activitesReelles, bornesJour, dateDuRapport, estDateCalendaire, jourLocal, ligneRepondus, scoreBorne,
} from "../services/rapport-journalier";

const ROUTE = readFileSync(join(import.meta.dirname, "..", "routes", "workspace.ts"), "utf8");

describe("la journee est celle de Paris", () => {
  it("ete : minuit Paris = 22h UTC la veille, journee de 24 h", () => {
    const { debut, fin } = bornesJour("2026-07-15");
    expect(debut.toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-07-15T22:00:00.000Z");
  });
  it("hiver : minuit Paris = 23h UTC", () => expect(bornesJour("2026-01-10").debut.toISOString()).toBe("2026-01-09T23:00:00.000Z"));
  it("passage a l'heure d'ete : journee de 23 h", () => {
    const { debut, fin } = bornesJour("2026-03-29");
    expect((fin.getTime() - debut.getTime()) / 3600000).toBe(23);
  });
  it("retour a l'heure d'hiver : journee de 25 h", () => {
    const { debut, fin } = bornesJour("2026-10-25");
    expect((fin.getTime() - debut.getTime()) / 3600000).toBe(25);
  });
  it("un appel a 1h30 Paris appartient a SA journee", () => {
    const appel = new Date("2026-07-14T23:30:00Z");
    const { debut, fin } = bornesJour("2026-07-15");
    expect(appel >= debut && appel < fin).toBe(true);
  });
  it("la route utilise ces bornes, fin exclusive", () => {
    expect(ROUTE).toContain("bornesJour(dateStr)");
    expect(ROUTE).not.toMatch(/T00:00:00\.000Z/);
    expect(ROUTE).not.toMatch(/lte\(\w+\.\w+, dayEnd\)/);
  });
});

describe("date du rapport", () => {
  const minuitQuart = new Date("2026-07-14T22:15:00Z"); // 00h15 le 15 a Paris
  it("par defaut : aujourd'hui a Paris, pas la date UTC", () => expect(dateDuRapport(undefined, minuitQuart)).toEqual({ ok: true, date: "2026-07-15" }));
  it("31 fevrier refuse", () => expect(dateDuRapport("2026-02-31", minuitQuart).ok).toBe(false));
  it("29 fevrier bissextile accepte", () => expect(estDateCalendaire("2028-02-29")).toBe(true));
  it("date future refusee", () => expect(dateDuRapport("2026-07-16", minuitQuart).ok).toBe(false));
  it("aujourd'hui accepte", () => expect(dateDuRapport("2026-07-15", minuitQuart).ok).toBe(true));
  it("format libre refuse", () => expect(dateDuRapport("15/07/2026", minuitQuart).ok).toBe(false));
  it("jourLocal", () => expect(jourLocal(minuitQuart)).toBe("2026-07-15"));
});

describe("rien d'invente", () => {
  it("chronologie reelle, heure de Paris, ordonnee", () => {
    const a = activitesReelles([
      { createdAt: new Date("2026-07-15T12:00:00Z"), categorie: "tache", description: "T" },
      { createdAt: new Date("2026-07-15T07:05:00Z"), categorie: "appel", description: "A" },
      { createdAt: null, categorie: "message", description: "M" },
    ]);
    expect(a).toEqual([
      { heure: "09:05", description: "A", categorie: "appel" },
      { heure: "14:00", description: "T", categorie: "tache" },
    ]);
  });
  it("le prompt ne demande plus d'heures estimees", () => {
    expect(ROUTE).not.toContain("plage horaire estimee");
    expect(ROUTE).toContain("activitesReelles(");
  });
  it("sans appel, pas de « 0 % »", () => expect(ligneRepondus(0, 0)).not.toContain("%"));
  it("avec appels, le taux", () => expect(ligneRepondus(4, 3)).toBe("- Repondus: 3 (75%)"));
  it("score borne et entier", () => {
    expect(scoreBorne(140)).toBe(100);
    expect(scoreBorne(-3)).toBe(0);
    expect(scoreBorne(72.6)).toBe(73);
  });
  it("score absent : null, pas 0", () => {
    expect(scoreBorne(undefined)).toBeNull();
    expect(scoreBorne("abc")).toBeNull();
  });
  it("reponse IA inexploitable : 502 et rien d'enregistre", () => {
    const i = ROUTE.indexOf("scoreBorne(parsed?.scorePerformance)");
    const bloc = ROUTE.slice(i, i + 600);
    expect(bloc).toMatch(/if \(!parsed \|\| typeof parsed\.resume !== "string" \|\| score === null\) \{\s*res\.status\(502\)/);
    expect(ROUTE.indexOf("res.status(502)")).toBeLessThan(ROUTE.indexOf("tx.insert(dailyReportsTable)"));
  });
});

describe("pas de doublon", () => {
  it("regenerer une date remplace son rapport, dans une transaction", () => {
    const i = ROUTE.indexOf("db.transaction(");
    const bloc = ROUTE.slice(i, i + 400);
    // Inconditionnel : chercher le seul texte laissait survivre `if (false)` (mesure).
    expect(bloc).toMatch(/async \(tx\) => \{\s*(\/\/[^\n]*\s*)*await tx\.delete\(dailyReportsTable\)/);
    expect(bloc).toContain("eq(dailyReportsTable.reportDate, reportDate)");
    expect(bloc).toContain("eq(dailyReportsTable.organisationId, orgId)");
  });
  it("la semaine se lit par date du rapport", () => expect(ROUTE).toContain("gte(dailyReportsTable.reportDate, weekAgoStr)"));
});
