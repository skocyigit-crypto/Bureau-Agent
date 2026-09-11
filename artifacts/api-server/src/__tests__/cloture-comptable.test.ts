/**
 * La conservation: ce que les clotures attrapent et que le chainage laisse passer.
 *
 * Le premier test de ce fichier est le plus important, et il commence par
 * demontrer une FAILLE: on retire les dernieres ecritures d'un journal, et la
 * verification du chainage repond « intacte ». Elle a raison — les numeros
 * restants se suivent, les empreintes s'accrochent. C'est la fraude la plus
 * simple qui soit: encaisser en especes, puis effacer la ligne le soir.
 *
 * Tout le reste du fichier existe pour que ce cas-la soit detecte.
 */
import { describe, expect, it } from "vitest";

import { preparerEcriture, verifierChaine, type EcritureChainee } from "../services/chainage-encaissements";
import {
  calculerCloture,
  empreinteCloture,
  formeCanoniqueCloture,
  periodeClose,
  periodeDe,
  verifierConservation,
  type ClotureScellee,
} from "../services/cloture-comptable";

const ORG = 7;

/** Journal: [montantCentimes, dateISO]. */
function journal(lignes: Array<[number, string]>): EcritureChainee[] {
  const out: EcritureChainee[] = [];
  for (const [montant, date] of lignes) {
    const p = out.length > 0 ? { numero: out[out.length - 1].numero, empreinte: out[out.length - 1].empreinte } : null;
    out.push(preparerEcriture({
      organisationId: ORG, factureId: 1, montantCentimes: montant, devise: "EUR",
      moyen: "especes", dateEncaissement: date, sens: "encaissement", annuleNumero: null,
    }, p));
  }
  return out;
}

const JOURNEE = [
  [10000, "2026-09-09T10:00:00.000Z"],
  [25000, "2026-09-09T15:00:00.000Z"],
  [ 5000, "2026-09-10T09:00:00.000Z"],
  [ 7500, "2026-09-10T18:00:00.000Z"],
] as Array<[number, string]>;

describe("la faille que le chainage seul laisse ouverte", () => {
  it("une suppression en fin de journal laisse une chaine parfaitement valide", () => {
    const complet = journal(JOURNEE);
    const tronque = complet.slice(0, 2); // on efface les deux dernieres

    // Le chainage ne voit RIEN: les numeros 1 et 2 se suivent, les empreintes
    // s'accrochent. C'est exactement pourquoi la conservation existe.
    expect(verifierChaine(tronque, ORG).intacte).toBe(true);
  });

  it("mais la cloture la denonce, et chiffre le manque", () => {
    const complet = journal(JOURNEE);
    // Cloture du 10 septembre, prise quand tout etait encore la.
    const cloture = calculerCloture(ORG, "journaliere", "2026-09-10", complet, null);
    expect(cloture.totalCumuleCentimes).toBe(47500);

    // Le soir, quelqu'un efface les deux dernieres ecritures.
    const tronque = complet.slice(0, 2);

    const v = verifierConservation([cloture], tronque, ORG);
    expect(v.coherent).toBe(false);
    expect(v.motif).toBe("cumul_ne_correspond_pas");
    expect(v.ecartCentimes).toBe(12500);
    expect(v.explication).toMatch(/manque 125\.00 €/);
    expect(v.explication).toMatch(/supprimees/i);
  });
});

describe("le total cumule", () => {
  it("ne se remet jamais a zero d'une periode a l'autre", () => {
    // Un « total » qui repartirait de zero chaque mois ne prouverait plus rien
    // sur les mois precedents.
    const j = journal(JOURNEE);
    const c9 = calculerCloture(ORG, "journaliere", "2026-09-09", j, null);
    const c10 = calculerCloture(ORG, "journaliere", "2026-09-10", j, c9);

    expect(c9.totalPeriodeCentimes).toBe(35000);
    expect(c9.totalCumuleCentimes).toBe(35000);
    expect(c10.totalPeriodeCentimes).toBe(12500);
    expect(c10.totalCumuleCentimes).toBe(47500);
  });

  it("compte les annulations comme des montants negatifs", () => {
    const j = journal(JOURNEE);
    const annulation = preparerEcriture({
      organisationId: ORG, factureId: 1, montantCentimes: -25000, devise: "EUR",
      moyen: "especes", dateEncaissement: "2026-09-10T11:00:00.000Z",
      sens: "annulation", annuleNumero: 2,
    }, { numero: 4, empreinte: j[3].empreinte });
    const avecAnnulation = [...j, annulation];

    const c = calculerCloture(ORG, "journaliere", "2026-09-10", avecAnnulation, null);
    // 47 500 - 25 000: la contre-passation entre dans le cumul, elle ne
    // l'efface pas.
    expect(c.totalCumuleCentimes).toBe(22500);
  });

  it("se recalcule sur le journal entier, pas par addition successive", () => {
    // Additionner le total de la periode au cumul precedent donnerait un faux
    // cumul si une ecriture anterieure avait ete saisie apres coup.
    const j = journal([
      [10000, "2026-09-10T10:00:00.000Z"],
      [ 3000, "2026-09-09T10:00:00.000Z"], // saisie apres, datee avant
    ]);
    const c10 = calculerCloture(ORG, "journaliere", "2026-09-10", j, null);
    expect(c10.totalCumuleCentimes).toBe(13000);
  });
});

describe("les clotures sont elles-memes chainees", () => {
  it("se verifient quand elles sont intactes", () => {
    const j = journal(JOURNEE);
    const c9 = calculerCloture(ORG, "journaliere", "2026-09-09", j, null);
    const c10 = calculerCloture(ORG, "journaliere", "2026-09-10", j, c9);
    expect(verifierConservation([c9, c10], j, ORG).coherent).toBe(true);
  });

  it("voient une cloture reecrite", () => {
    // Un cumul fige qu'on pourrait reecrire ne fige rien.
    const j = journal(JOURNEE);
    const c9 = calculerCloture(ORG, "journaliere", "2026-09-09", j, null);
    const c10 = calculerCloture(ORG, "journaliere", "2026-09-10", j, c9);
    const falsifiee: ClotureScellee = { ...c9, totalCumuleCentimes: 1 };

    const v = verifierConservation([falsifiee, c10], j, ORG);
    expect(v.coherent).toBe(false);
    expect(v.motif).toBe("empreinte_cloture_incorrecte");
  });

  it("voient une cloture retiree", () => {
    const j = journal(JOURNEE);
    const c9 = calculerCloture(ORG, "journaliere", "2026-09-09", j, null);
    const c10 = calculerCloture(ORG, "journaliere", "2026-09-10", j, c9);
    const v = verifierConservation([c10], j, ORG); // la premiere a disparu
    expect(v.motif).toBe("chainon_cloture_rompu");
  });

  it("refusent un cumul qui recule", () => {
    // Meme si les empreintes etaient refaites proprement, un cumul ne recule
    // jamais: il additionne des montants dont les annulations sont signees.
    const j = journal(JOURNEE);
    const c9 = calculerCloture(ORG, "journaliere", "2026-09-09", j, null);
    const faux = { ...c9, periode: "2026-09-10", totalCumuleCentimes: 100, empreintePrecedente: c9.empreinte };
    const scelle: ClotureScellee = { ...faux, empreinte: empreinteCloture(faux) };

    const v = verifierConservation([c9, scelle], j, ORG);
    expect(v.coherent).toBe(false);
    expect(v.motif).toBe("cumul_regresse");
  });
});

describe("anti-datation", () => {
  it("detecte une ecriture glissee dans une periode deja close", () => {
    const j = journal(JOURNEE);
    const c = calculerCloture(ORG, "journaliere", "2026-09-10", j, null);

    const glissee = preparerEcriture({
      organisationId: ORG, factureId: 1, montantCentimes: 90000, devise: "EUR",
      moyen: "especes", dateEncaissement: "2026-09-09T23:00:00.000Z", // anti-datee
      sens: "encaissement", annuleNumero: null,
    }, { numero: 4, empreinte: j[3].empreinte });

    const v = verifierConservation([c], [...j, glissee], ORG);
    expect(v.coherent).toBe(false);
    expect(v.ecartCentimes).toBe(-90000);
    expect(v.explication).toMatch(/date anterieure a une periode deja close/i);
  });

  it("permet de refuser l'ecriture avant meme de l'enregistrer", () => {
    // Mieux vaut empecher que constater: sans ce refus, l'anti-fraude serait
    // contournable par le bas.
    const j = journal(JOURNEE);
    const c = calculerCloture(ORG, "journaliere", "2026-09-10", j, null);
    expect(periodeClose("2026-09-09T23:00:00.000Z", [c])?.periode).toBe("2026-09-10");
    expect(periodeClose("2026-09-11T09:00:00.000Z", [c])).toBeNull();
  });
});

describe("le decoupage des periodes", () => {
  it("ne depend pas du fuseau de la machine qui calcule", () => {
    // Deux instances Cloud Run dans deux regions produiraient sinon deux
    // clotures differentes pour les memes ecritures.
    expect(periodeDe("2026-09-10T23:30:00.000Z", "journaliere")).toBe("2026-09-10");
    expect(periodeDe("2026-09-10T23:30:00.000Z", "mensuelle")).toBe("2026-09");
    expect(periodeDe("2026-09-10T23:30:00.000Z", "annuelle")).toBe("2026");
  });

  it("porte un numero de version dans la forme canonique", () => {
    const j = journal(JOURNEE);
    const c = calculerCloture(ORG, "annuelle", "2026", j, null);
    expect(formeCanoniqueCloture(c).startsWith("v1|")).toBe(true);
  });
});

describe("une periode sans mouvement", () => {
  it("se clot quand meme, avec un total nul et le cumul conserve", () => {
    // Une journee sans encaissement doit produire une cloture: son absence
    // serait indistinguable d'une journee effacee.
    const j = journal(JOURNEE);
    const c = calculerCloture(ORG, "journaliere", "2026-09-11", j, null);
    expect(c.nbEcritures).toBe(0);
    expect(c.totalPeriodeCentimes).toBe(0);
    expect(c.totalCumuleCentimes).toBe(47500);
    expect(c.premierNumero).toBeNull();
  });
});
