import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { libelleHeure, serieHebdomadaire, serieHoraire } from "../analytics-series";

const ECRAN = readFileSync(join(import.meta.dirname, "..", "..", "app", "analytics.tsx"), "utf8");

describe("serieHoraire", () => {
  it("lit la forme reelle de l'API sans planter (hour numerique)", () => {
    expect(serieHoraire({ hours: [{ hour: 9, total: 4, answered: 3, missed: 1 }] })).toEqual([{ label: "9h", value: 4 }]);
  });
  it("tolere l'ancienne forme chaine", () => {
    expect(serieHoraire({ hours: [{ hour: "14:00", calls: 2 }] })).toEqual([{ label: "14h", value: 2 }]);
  });
  it("rend null sans reponse", () => expect(serieHoraire(null)).toBeNull());
  it("rend null pour une liste vide", () => expect(serieHoraire({ hours: [] })).toBeNull());
  it("ignore une heure illisible sans perdre les autres", () => {
    expect(serieHoraire({ hours: [{ hour: 99, total: 1 }, { hour: 10, total: 5 }] })).toEqual([{ label: "10h", value: 5 }]);
  });
  it("un total a zero reste une mesure", () => {
    expect(serieHoraire({ hours: [{ hour: 8, total: 0 }] })).toEqual([{ label: "8h", value: 0 }]);
  });
});

describe("libelleHeure", () => {
  it("borne 0 et 23", () => {
    expect(libelleHeure(0)).toBe("0h");
    expect(libelleHeure(23)).toBe("23h");
    expect(libelleHeure(24)).toBeNull();
  });
  it("refuse un objet", () => expect(libelleHeure({})).toBeNull());
});

describe("serieHebdomadaire", () => {
  it("sans `days` rend null, pas sept zeros", () => {
    expect(serieHebdomadaire({ thisWeek: { calls: 200 } }, "calls")).toBeNull();
  });
  it("lit la mesure demandee", () => {
    const r = { days: [{ label: "Lundi", calls: 3, tasks: 7 }] };
    expect(serieHebdomadaire(r, "calls")).toEqual([{ label: "Lun", value: 3 }]);
    expect(serieHebdomadaire(r, "tasks")).toEqual([{ label: "Lun", value: 7 }]);
  });
});

describe("l'ecran", () => {
  it("n'appelle plus replace sur l'heure", () => expect(ECRAN).not.toContain('h.hour.replace'));
  it("n'a plus de repli a sept zeros", () => expect(ECRAN).not.toContain("value: 0 }))"));
  it("annonce l'absence de donnees", () => expect(ECRAN).toContain('t("analyticsScreen.noData")'));
  it("les six langues ont le libelle", () => {
    for (const l of ["ar", "de", "en", "es", "fr", "tr"]) {
      const j = JSON.parse(readFileSync(join(import.meta.dirname, "..", "i18n", "locales", `${l}.json`), "utf8"));
      expect(j.analyticsScreen.noData, l).toBeTruthy();
    }
  });
});
