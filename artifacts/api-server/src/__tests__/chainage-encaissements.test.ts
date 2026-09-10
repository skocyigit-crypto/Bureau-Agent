/**
 * Le journal des reglements: inalterable, et demontrable.
 *
 * Ce que ces tests verrouillent n'est pas « le code calcule un hash », mais la
 * propriete qui interesse un controle fiscal: **on ne peut pas modifier une
 * ecriture passee sans que cela se voie**. Chaque test simule donc une
 * falsification reelle — changer un montant, retirer une ligne, deplacer une
 * ecriture d'une organisation a l'autre — et exige que la verification la
 * designe, avec son numero.
 *
 * L'amende de l'article 286-I-3° bis du CGI est de 7 500 € par logiciel non
 * conforme, et elle frappe l'entreprise qui l'utilise. Un journal qu'on croit
 * inalterable sans l'avoir prouve ne protege personne.
 */
import { describe, expect, it } from "vitest";

import {
  empreinteDe,
  formeCanonique,
  graine,
  preparerEcriture,
  soldeFacture,
  verifierChaine,
  type EcritureChainee,
} from "../services/chainage-encaissements";

const ORG = 42;

/** Construit un journal de n encaissements sur la meme facture. */
function journal(montantsCentimes: number[], organisationId = ORG): EcritureChainee[] {
  const out: EcritureChainee[] = [];
  for (const montant of montantsCentimes) {
    const precedente = out.length > 0
      ? { numero: out[out.length - 1].numero, empreinte: out[out.length - 1].empreinte }
      : null;
    out.push(preparerEcriture({
      organisationId,
      factureId: 7,
      montantCentimes: montant,
      devise: "EUR",
      moyen: "virement",
      dateEncaissement: "2026-09-10T09:00:00.000Z",
      sens: "encaissement",
      annuleNumero: null,
    }, precedente));
  }
  return out;
}

describe("une chaine intacte", () => {
  it("se verifie", () => {
    const v = verifierChaine(journal([50000, 25000, 12500]), ORG);
    expect(v.intacte).toBe(true);
    expect(v.premiereRupture).toBeNull();
    expect(v.verifiees).toBe(3);
  });

  it("commence sur une graine propre a l'organisation", () => {
    // Sans cela, deux organisations qui commencent par le meme encaissement
    // auraient la meme empreinte initiale, et une ecriture pourrait passer de
    // l'une a l'autre sans casser aucun chainon.
    expect(graine(1)).not.toBe(graine(2));
    expect(journal([1000], 1)[0].empreinte).not.toBe(journal([1000], 2)[0].empreinte);
  });

  it("numerote sans trou, a partir de 1", () => {
    expect(journal([100, 200, 300]).map((e) => e.numero)).toEqual([1, 2, 3]);
  });
});

describe("ce qu'un controle cherche: la falsification", () => {
  it("voit un montant change apres coup", () => {
    const j = journal([50000, 25000, 12500]);
    // La fraude type: on gonfle ou on efface un encaissement deja enregistre.
    j[1] = { ...j[1], montantCentimes: 1 };

    const v = verifierChaine(j, ORG);
    expect(v.intacte).toBe(false);
    expect(v.premiereRupture).toBe(2);
    expect(v.motif).toBe("empreinte_incorrecte");
    expect(v.explication).toMatch(/modifie apres coup/i);
  });

  it("voit une ecriture retiree", () => {
    const j = journal([50000, 25000, 12500]);
    j.splice(1, 1); // on supprime la deuxieme

    const v = verifierChaine(j, ORG);
    expect(v.intacte).toBe(false);
    expect(v.motif).toBe("numero_non_consecutif");
    // Le message dit quoi faire a la place: contre-passer, pas supprimer.
    expect(v.explication).toMatch(/ecriture inverse/i);
  });

  it("voit une ecriture ajoutee au milieu", () => {
    const j = journal([50000, 25000, 12500]);
    const faux = preparerEcriture({
      organisationId: ORG, factureId: 7, montantCentimes: 99900, devise: "EUR",
      moyen: "especes", dateEncaissement: "2026-09-10T09:00:00.000Z",
      sens: "encaissement", annuleNumero: null,
    }, { numero: 1, empreinte: j[0].empreinte });
    j.splice(1, 0, faux);

    const v = verifierChaine(j, ORG);
    expect(v.intacte).toBe(false);
    // L'insertion produit deux ecritures n° 2: la suite ne peut plus tenir.
    expect(v.premiereRupture).toBeGreaterThanOrEqual(2);
  });

  it("voit une ecriture deplacee d'une organisation a l'autre", () => {
    const j = journal([50000, 25000]);
    j[1] = { ...j[1], organisationId: 99 };

    const v = verifierChaine(j, ORG);
    expect(v.motif).toBe("organisation_etrangere");
    expect(v.explication).toMatch(/changer de journal/i);
  });

  it("voit une empreinte precedente recopiee a la main", () => {
    // Quelqu'un qui comprend le mecanisme essaiera de recoller les morceaux.
    const j = journal([50000, 25000, 12500]);
    j[1] = { ...j[1], montantCentimes: 1 };
    j[1] = { ...j[1], empreinte: empreinteDe(j[1]) }; // il recalcule SON empreinte
    // ... mais la suivante pointe toujours sur l'ancienne.
    const v = verifierChaine(j, ORG);
    expect(v.intacte).toBe(false);
    expect(v.premiereRupture).toBe(3);
    expect(v.motif).toBe("chainon_rompu");
  });

  it("designe la PREMIERE rupture, pas toutes", () => {
    // Apres une rupture, tout ce qui suit est faux par construction. Une liste
    // de mille erreurs identiques ne dit rien de plus que la premiere.
    const j = journal([100, 200, 300, 400, 500]);
    j[1] = { ...j[1], montantCentimes: 7 };
    const v = verifierChaine(j, ORG);
    expect(v.premiereRupture).toBe(2);
    expect(v.verifiees).toBe(1);
  });
});

describe("la forme canonique", () => {
  it("ne depend pas de l'ordre des cles de l'objet", () => {
    // `JSON.stringify` suit l'ordre d'insertion: une refonte innocente du code
    // changerait toutes les empreintes et invaliderait des annees de journal.
    const a = journal([12345])[0];
    const reconstruite = {
      empreintePrecedente: a.empreintePrecedente,
      annuleNumero: a.annuleNumero,
      sens: a.sens,
      dateEncaissement: a.dateEncaissement,
      moyen: a.moyen,
      devise: a.devise,
      montantCentimes: a.montantCentimes,
      factureId: a.factureId,
      organisationId: a.organisationId,
      numero: a.numero,
    };
    expect(empreinteDe(reconstruite)).toBe(a.empreinte);
  });

  it("garde un nombre de separateurs constant, champs nuls compris", () => {
    const avec = journal([100])[0];
    const sans = { ...avec, factureId: null, annuleNumero: null };
    expect(formeCanonique(avec).split("|")).toHaveLength(11);
    expect(formeCanonique(sans).split("|")).toHaveLength(11);
  });

  it("porte un numero de version", () => {
    // Le jour ou la forme devra changer, les anciennes ecritures doivent rester
    // verifiables avec l'ancienne regle. Sans marqueur de version, elles
    // deviendraient toutes fausses d'un coup.
    expect(formeCanonique(journal([100])[0]).startsWith("v1|")).toBe(true);
  });
});

describe("corriger sans effacer", () => {
  it("annule un encaissement par une ecriture inverse", () => {
    const j = journal([50000, 25000]);
    const annulation = preparerEcriture({
      organisationId: ORG, factureId: 7, montantCentimes: -25000, devise: "EUR",
      moyen: "virement", dateEncaissement: "2026-09-11T09:00:00.000Z",
      sens: "annulation", annuleNumero: 2,
    }, { numero: 2, empreinte: j[1].empreinte });
    j.push(annulation);

    // La chaine tient: on a ajoute, pas modifie.
    expect(verifierChaine(j, ORG).intacte).toBe(true);
    // Et le solde reflete la correction.
    expect(soldeFacture(j, 7)).toBe(50000);
  });

  it("calcule le solde depuis le journal, pas depuis une colonne", () => {
    const j = journal([30000, 20000, 10000]);
    expect(soldeFacture(j, 7)).toBe(60000);
    expect(soldeFacture(j, 999), "une autre facture n'est pas concernee").toBe(0);
  });
});

describe("les montants", () => {
  it("sont en centimes entiers", () => {
    // 0.1 + 0.2 ne vaut pas 0.3 en binaire. Un controleur qui refait le calcul
    // doit retrouver exactement la meme empreinte, sinon la preuve ne prouve
    // rien.
    const j = journal([10, 20]);
    expect(Number.isInteger(j[0].montantCentimes)).toBe(true);
    // Deux montants distincts ne peuvent pas produire la meme empreinte.
    expect(j[0].empreinte).not.toBe(j[1].empreinte);
  });
});
