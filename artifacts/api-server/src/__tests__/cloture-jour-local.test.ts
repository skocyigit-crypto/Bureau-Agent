/**
 * Clore la journee en cours, a une heure du matin.
 *
 * `periodeCommencee` lisait le jour dans `toISOString()`, c'est-a-dire en UTC.
 * Le 24 septembre a 00h30 a Paris, UTC est encore le 23 : clore « 2026-09-24 »
 * etait refuse — « periode non commencee » — pendant les deux premieres heures
 * de chaque jour (une heure en hiver). Un artisan qui arrete sa caisse apres
 * minuit tombait dessus systematiquement.
 *
 * Le controle automatique ne pouvait pas le voir : les serveurs d'integration
 * tournent en UTC, ou les deux dates coincident toujours. C'est en travaillant
 * a 00h30 a Paris que le defaut est apparu — d'ou ce test, qui fixe l'heure au
 * lieu de dependre de celle de la machine.
 */
import { describe, expect, it } from "vitest";
import { periodeCommencee } from "../services/cloture-comptable";
import { jourLocal } from "../lib/jour-local";

/** 24/09/2026 a 00h30 heure de Paris = 23/09/2026 22h30 UTC (ete). */
const NUIT_PARIS = new Date("2026-09-23T22:30:00.000Z");
/** 01/01/2026 a 00h30 a Paris = 31/12/2025 23h30 UTC (hiver). */
const NOUVEL_AN_PARIS = new Date("2025-12-31T23:30:00.000Z");
/** Milieu de journee : les deux dates coincident, rien ne doit changer. */
const MIDI = new Date("2026-09-24T12:00:00.000Z");

describe("la journee en cours se clot des qu'elle a commence, a Paris", () => {
  it("a 00h30 a Paris, le jour du calendrier est commence", () => {
    expect(jourLocal(NUIT_PARIS)).toBe("2026-09-24");
    expect(periodeCommencee("2026-09-24", NUIT_PARIS)).toBe(true);
  });

  it("le lendemain, lui, n'est pas commence", () => {
    // La garde d'origine reste : une faute de frappe (« 2062 » pour « 2026 »)
    // bloquerait l'organisation pour trente-six ans, sans reouverture possible.
    expect(periodeCommencee("2026-09-25", NUIT_PARIS)).toBe(false);
    expect(periodeCommencee("2062-09-24", NUIT_PARIS)).toBe(false);
  });

  it("le passage d'annee : le 1er janvier a 00h30 a Paris", () => {
    expect(jourLocal(NOUVEL_AN_PARIS)).toBe("2026-01-01");
    expect(periodeCommencee("2026-01-01", NOUVEL_AN_PARIS)).toBe(true);
    expect(periodeCommencee("2026", NOUVEL_AN_PARIS), "l'annee en cours").toBe(true);
    expect(periodeCommencee("2026-01", NOUVEL_AN_PARIS), "le mois en cours").toBe(true);
    expect(periodeCommencee("2027", NOUVEL_AN_PARIS)).toBe(false);
  });

  it("le mois en cours se clot le premier du mois, a 00h30", () => {
    const premierOctobre = new Date("2026-09-30T22:30:00.000Z"); // 01/10 a Paris
    expect(periodeCommencee("2026-10", premierOctobre)).toBe(true);
    expect(periodeCommencee("2026-11", premierOctobre)).toBe(false);
  });

  it("en pleine journee, rien ne change : les deux dates coincident", () => {
    expect(periodeCommencee("2026-09-24", MIDI)).toBe(true);
    expect(periodeCommencee("2026-09-25", MIDI)).toBe(false);
    expect(periodeCommencee("2026-09", MIDI)).toBe(true);
    expect(periodeCommencee("2026", MIDI)).toBe(true);
  });

  it("une periode passee reste close-able", () => {
    expect(periodeCommencee("2025-01-01", NUIT_PARIS)).toBe(true);
    expect(periodeCommencee("2024", NUIT_PARIS)).toBe(true);
  });

  it("le calcul ne lit plus l'heure UTC", () => {
    // Preuve par la difference : a cet instant precis, UTC et Paris ne sont
    // pas le meme jour. Un calcul en UTC rendrait false.
    expect(NUIT_PARIS.toISOString().slice(0, 10)).toBe("2026-09-23");
    expect(jourLocal(NUIT_PARIS)).toBe("2026-09-24");
    expect(periodeCommencee("2026-09-24", NUIT_PARIS)).toBe(true);
  });
});

describe("ce que la regle garde de son intention d'origine", () => {
  it("une periode qui n'a pas commence reste refusee, quel que soit le type", () => {
    for (const [periode, attendu] of [
      ["2026-09-24", true], ["2026-09-25", false],
      ["2026-09", true], ["2026-10", false],
      ["2026", true], ["2027", false],
    ] as const) {
      expect(periodeCommencee(periode, NUIT_PARIS), periode).toBe(attendu);
    }
  });

  it("la comparaison reste textuelle : aucun fuseau de MACHINE n'intervient", () => {
    // Deux instances Cloud Run dans deux regions doivent repondre pareil : le
    // fuseau est celui de l'entreprise, fixe, jamais celui de la machine.
    const source = require("node:fs").readFileSync(
      require("node:path").join(import.meta.dirname, "..", "services", "cloture-comptable.ts"), "utf8",
    );
    expect(source).not.toMatch(/maintenant\.toISOString\(\)\.slice\(0, 10\)/);
    expect(source).toMatch(/jourLocal\(maintenant\)/);
  });
});
