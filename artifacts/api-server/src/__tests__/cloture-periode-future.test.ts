/**
 * Une faute de frappe ne doit pas bloquer le journal pour trente-six ans.
 *
 * La route de cloture ne verifiait que la FORME de la periode : `AAAA`,
 * `AAAA-MM`, `AAAA-MM-JJ`. « 2062 » tape pour « 2026 » passait donc, et
 * `periodeClose` compare des CHAINES — « 2026 » <= « 2062 » reste vrai
 * jusqu'en 2062.
 *
 * A partir de cet instant, plus aucun encaissement ni aucune contre-passation
 * ne pouvait etre enregistre dans l'organisation. Et il n'existe, par
 * conception, ni route de suppression ni route de reouverture d'une cloture :
 * c'est le prix de l'inalterabilite exigee par l'article 286-I-3° bis du CGI.
 * Le produit se bloquait donc lui-meme, definitivement, sur une frappe.
 *
 * La regle retenue est la plus permissive qui ferme le defaut : la periode
 * doit avoir COMMENCE. Clore le jour meme a 23 h, le mois en cours le 31, ou
 * l'annee en cours reste possible — ce sont des usages reels.
 *
 * La route refusait deja une date d'encaissement dans le futur (« un
 * encaissement se constate, il ne s'annonce pas ») ; la meme prudence manquait
 * du cote irreversible.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { periodeCommencee } from "../services/cloture-comptable";

const LE_20_SEPTEMBRE_2026 = new Date("2026-09-20T10:00:00.000Z");

describe("une periode qui n'a pas commence ne se clot pas", () => {
  it("l'annee du defaut — 2062 pour 2026 — est refusee", () => {
    expect(periodeCommencee("2062", LE_20_SEPTEMBRE_2026)).toBe(false);
  });

  it("le mois prochain est refuse", () => {
    expect(periodeCommencee("2026-10", LE_20_SEPTEMBRE_2026)).toBe(false);
  });

  it("demain est refuse", () => {
    expect(periodeCommencee("2026-09-21", LE_20_SEPTEMBRE_2026)).toBe(false);
  });

  it("le jour meme est accepte", () => {
    // Clore le journal du jour a 23 h est l'usage normal.
    expect(periodeCommencee("2026-09-20", LE_20_SEPTEMBRE_2026)).toBe(true);
  });

  it("le mois en cours est accepte", () => {
    // On clot le mois le 31, pas le 1er du suivant.
    expect(periodeCommencee("2026-09", LE_20_SEPTEMBRE_2026)).toBe(true);
  });

  it("l'annee en cours est acceptee", () => {
    expect(periodeCommencee("2026", LE_20_SEPTEMBRE_2026)).toBe(true);
  });

  it("hier est accepte", () => {
    expect(periodeCommencee("2026-09-19", LE_20_SEPTEMBRE_2026)).toBe(true);
  });

  it("un exercice passe est accepte", () => {
    expect(periodeCommencee("2025", LE_20_SEPTEMBRE_2026)).toBe(true);
    expect(periodeCommencee("2025-12", LE_20_SEPTEMBRE_2026)).toBe(true);
    expect(periodeCommencee("2025-12-31", LE_20_SEPTEMBRE_2026)).toBe(true);
  });

  it("le passage d'annee ne trompe pas la comparaison", () => {
    // Comparaison de chaines: « 2026-01 » <= « 2025-12-31 » serait faux si on
    // comparait des longueurs differentes sans les tronquer.
    //
    // MIDI, et non 23 h : le jour se lit desormais dans le fuseau de
    // l'entreprise, et 23 h UTC le 31 decembre est deja le 1er janvier a
    // Paris — l'annee y a donc commence. Ce test-ci porte sur la comparaison
    // de chaines ; le passage de minuit est verifie a part, dans
    // cloture-jour-local.test.ts.
    const le31Decembre2025 = new Date("2025-12-31T12:00:00.000Z");
    expect(periodeCommencee("2026", le31Decembre2025)).toBe(false);
    expect(periodeCommencee("2025", le31Decembre2025)).toBe(true);
    expect(periodeCommencee("2026-01", le31Decembre2025)).toBe(false);
    expect(periodeCommencee("2025-12", le31Decembre2025)).toBe(true);
  });

  it("le premier jour d'un mois qui vient de commencer est accepte", () => {
    const le1erOctobre = new Date("2026-10-01T00:30:00.000Z");
    expect(periodeCommencee("2026-10", le1erOctobre)).toBe(true);
    expect(periodeCommencee("2026-10-01", le1erOctobre)).toBe(true);
    expect(periodeCommencee("2026-10-02", le1erOctobre)).toBe(false);
  });

  it("la route pose bien ce refus", () => {
    // Le controle vit dans le service, mais c'est la route qui bloquait le
    // journal: sans l'appel, la regle ne protege rien.
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "encaissements.ts"),
      "utf8",
    );
    const i = source.indexOf("Periode invalide (AAAA");
    expect(i, "la route de cloture a change de forme").toBeGreaterThan(0);
    expect(
      source.slice(i, i + 900),
      "le refus n'est pas pose sur la route de cloture",
    ).toMatch(/periodeCommencee\(periode\)/);
  });

  it("et il dit que la cloture est irreversible", () => {
    // L'utilisateur doit comprendre pourquoi on est strict ici et pas
    // ailleurs.
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "encaissements.ts"),
      "utf8",
    );
    const i = source.indexOf("une cloture atteste d'une periode ecoulee");
    expect(i, "le message de refus a disparu").toBeGreaterThan(0);
    expect(
      source.slice(i, i + 400),
      "le refus ne dit pas que la cloture est definitive",
    ).toMatch(/rouverte|supprimee/);
  });
});
