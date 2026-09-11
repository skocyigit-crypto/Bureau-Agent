/**
 * Quelles periodes la tache de cloture doit clore.
 *
 * Le calcul des periodes est la partie ou l'on se trompe, et ou l'erreur coute
 * cher dans les deux sens:
 *
 *  - clore la periode EN COURS interdirait d'enregistrer un encaissement de
 *    cet apres-midi — le refus d'anti-datation se retournerait contre
 *    l'utilisateur, et c'est le logiciel qui l'empecherait de travailler;
 *
 *  - ne pas rattraper les periodes manquees laisserait des journees sans
 *    cloture, et une journee sans cloture est indistinguable d'une journee
 *    effacee. C'est precisement ce que la conservation doit rendre impossible.
 */
import { describe, expect, it } from "vitest";

import { periodesAClore } from "../services/cloture-cron";

const MAINTENANT = new Date("2026-09-11T14:00:00.000Z");

describe("la periode en cours", () => {
  it("n'est jamais close", () => {
    // Le 11 est en cours: le clore empecherait d'encaisser cet apres-midi.
    const p = periodesAClore("2026-09-09T10:00:00.000Z", MAINTENANT, "journaliere", new Set());
    expect(p).not.toContain("2026-09-11");
  });

  it("vaut aussi pour le mois et l'annee", () => {
    expect(periodesAClore("2026-07-01T10:00:00.000Z", MAINTENANT, "mensuelle", new Set()))
      .not.toContain("2026-09");
    expect(periodesAClore("2024-01-01T10:00:00.000Z", MAINTENANT, "annuelle", new Set()))
      .not.toContain("2026");
  });
});

describe("les periodes echues", () => {
  it("sont closes, de la premiere ecriture a hier", () => {
    const p = periodesAClore("2026-09-09T10:00:00.000Z", MAINTENANT, "journaliere", new Set());
    expect(p).toEqual(["2026-09-09", "2026-09-10"]);
  });

  it("rattrapent un arret de plusieurs jours", () => {
    // Une instance eteinte tout un week-end ne doit pas laisser de trou.
    const p = periodesAClore("2026-09-05T10:00:00.000Z", MAINTENANT, "journaliere", new Set());
    expect(p).toEqual([
      "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
    ]);
  });

  it("sautent celles qui sont deja closes", () => {
    // La cloture est idempotente: relancer la tache ne doit rien refaire.
    const deja = new Set(["2026-09-09"]);
    const p = periodesAClore("2026-09-09T10:00:00.000Z", MAINTENANT, "journaliere", deja);
    expect(p).toEqual(["2026-09-10"]);
  });

  it("ne rendent rien quand tout est deja clos", () => {
    const deja = new Set(["2026-09-09", "2026-09-10"]);
    expect(periodesAClore("2026-09-09T10:00:00.000Z", MAINTENANT, "journaliere", deja)).toEqual([]);
  });
});

describe("les mois et les annees", () => {
  it("enchainent les mois en passant l'annee", () => {
    const p = periodesAClore("2025-11-20T10:00:00.000Z", MAINTENANT, "mensuelle", new Set());
    expect(p.slice(0, 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(p[p.length - 1]).toBe("2026-08");
  });

  it("closent les annees revolues", () => {
    const p = periodesAClore("2024-03-01T10:00:00.000Z", MAINTENANT, "annuelle", new Set());
    expect(p).toEqual(["2024", "2025"]);
  });
});

describe("bornes de securite", () => {
  it("limite le rattrapage pour ne pas bloquer le processus", () => {
    // Un journal ancien jamais clos produirait des milliers de clotures d'un
    // coup. Les passages suivants terminent.
    const p = periodesAClore("2020-01-01T10:00:00.000Z", MAINTENANT, "journaliere", new Set());
    expect(p.length).toBeLessThanOrEqual(60);
    expect(p[0]).toBe("2020-01-01");
  });

  it("ne rend aucune periode quand la premiere ecriture est aujourd'hui", () => {
    // Rien n'est encore echu: il n'y a rien a clore, et surtout pas
    // aujourd'hui.
    expect(periodesAClore("2026-09-11T09:00:00.000Z", MAINTENANT, "journaliere", new Set())).toEqual([]);
  });
});
