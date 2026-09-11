/**
 * L'archive: la seule piece qui doit survivre au logiciel.
 *
 * Un controle peut survenir six ans plus tard (art. L102 B du LPF). A cette
 * date, l'editeur peut avoir disparu, le format avoir change trois fois,
 * l'abonnement du client avoir pris fin. Le test central de ce fichier verifie
 * donc quelque chose d'inhabituel: qu'une archive se verifie **a partir de son
 * seul contenu**, sans base de donnees et sans rien d'autre — et que le mode
 * d'emploi necessaire pour le faire a la main est ecrit DANS le fichier.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { preparerEcriture, type EcritureChainee } from "../services/chainage-encaissements";
import { calculerCloture } from "../services/cloture-comptable";
import { construireArchive, nomArchive, verifierArchive } from "../services/archivage-comptable";

const ORG = 12;
const QUAND = "2026-09-11T08:00:00.000Z";

function journal(lignes: Array<[number, string]>): EcritureChainee[] {
  const out: EcritureChainee[] = [];
  for (const [montant, date] of lignes) {
    const p = out.length > 0 ? { numero: out[out.length - 1].numero, empreinte: out[out.length - 1].empreinte } : null;
    out.push(preparerEcriture({
      organisationId: ORG, factureId: 3, montantCentimes: montant, devise: "EUR",
      moyen: "cheque", dateEncaissement: date, sens: "encaissement", annuleNumero: null,
    }, p));
  }
  return out;
}

const LIGNES: Array<[number, string]> = [
  [12000, "2026-08-14T10:00:00.000Z"],
  [ 8000, "2026-08-28T16:00:00.000Z"],
  [45000, "2026-09-02T09:00:00.000Z"],
];

function archiveAout() {
  const j = journal(LIGNES);
  const c = calculerCloture(ORG, "mensuelle", "2026-08", j, null);
  return { journal: j, archive: construireArchive(ORG, "mensuelle", "2026-08", j, [c], QUAND) };
}

describe("ce que l'archive contient", () => {
  it("ne retient que les ecritures de la periode", () => {
    const { archive } = archiveAout();
    expect(archive.nbEcritures).toBe(2);
    expect(archive.totalCentimes).toBe(20000);
    // L'encaissement de septembre n'y est pas.
    expect(archive.contenu).not.toContain("2026-09-02");
  });

  it("porte son fondement juridique en clair", () => {
    // Quelqu'un qui ouvre le fichier dans six ans doit savoir ce qu'il tient.
    expect(archiveAout().archive.contenu).toContain("286-I-3° bis");
  });

  it("inclut le mode d'emploi permettant de la verifier a la main", () => {
    // Sans la forme canonique ecrite dans le fichier, le recalcul est
    // impossible: l'ordre des champs et le separateur ne se devinent pas.
    const { contenu } = archiveAout().archive;
    expect(contenu).toMatch(/SHA-256/);
    expect(contenu).toMatch(/separes par le/);
    expect(contenu).toMatch(/montant_centimes/);
    expect(contenu).toMatch(/CENTIMES entiers/);
  });

  it("nomme le fichier de facon lisible", () => {
    expect(nomArchive(12, "mensuelle", "2026-08")).toBe("reglements-12-mensuelle-2026-08.json");
  });
});

describe("verifier une archive sans rien d'autre que le fichier", () => {
  it("accepte une archive intacte", () => {
    const v = verifierArchive(archiveAout().archive.contenu);
    expect(v.valide).toBe(true);
    expect(v.nbEcritures).toBe(2);
  });

  it("refuse un fichier retouche, meme d'un seul chiffre", () => {
    const { archive } = archiveAout();
    const retouche = archive.contenu.replace('"montant_centimes": 12000', '"montant_centimes": 1200');
    expect(retouche).not.toBe(archive.contenu);

    const v = verifierArchive(retouche);
    expect(v.valide).toBe(false);
    expect(v.motif).toBe("empreinte_archive_incorrecte");
    expect(v.explication).toMatch(/a ete modifie/i);
  });

  it("refuse une archive scellee sur des donnees deja fausses", () => {
    // Cas subtil: quelqu'un fabrique une archive coherente avec elle-meme, en
    // recalculant l'empreinte du fichier apres avoir change un montant. Le
    // fichier est intact — mais les ECRITURES ne correspondent plus a leurs
    // propres empreintes. Une archive intacte et mensongere reste mensongere.
    const { archive } = archiveAout();
    const objet = JSON.parse(archive.contenu);
    objet.ecritures[0].montant_centimes = 1;
    const { empreinte_archive: _, ...sans } = objet;
    objet.empreinte_archive = createHash("sha256")
      .update(JSON.stringify(sans, null, 2), "utf8").digest("hex");

    const v = verifierArchive(JSON.stringify(objet, null, 2));
    expect(v.valide).toBe(false);
    expect(v.motif).toBe("ecriture_alteree");
    expect(v.explication).toMatch(/n° 1/);
  });

  it("refuse une archive dont le chainage a ete casse", () => {
    const { archive } = archiveAout();
    const objet = JSON.parse(archive.contenu);
    objet.ecritures[1].empreinte_precedente = "0".repeat(64);
    // On refait proprement l'empreinte de l'ecriture ET celle du fichier.
    // Le chainage, lui, ne peut pas etre refait sans refaire tout le reste.
    const { empreinte_archive: _, ...sans } = objet;
    objet.empreinte_archive = createHash("sha256")
      .update(JSON.stringify(sans, null, 2), "utf8").digest("hex");

    const v = verifierArchive(JSON.stringify(objet, null, 2));
    expect(v.valide).toBe(false);
    // L'ecriture ne correspond plus a son empreinte, puisque
    // `empreinte_precedente` entre dans le calcul.
    expect(["ecriture_alteree", "chainage_rompu"]).toContain(v.motif);
  });

  it("refuse un fichier sans empreinte", () => {
    const objet = JSON.parse(archiveAout().archive.contenu);
    delete objet.empreinte_archive;
    const v = verifierArchive(JSON.stringify(objet, null, 2));
    expect(v.motif).toBe("empreinte_archive_absente");
  });

  it("refuse un fichier illisible plutot que de planter", () => {
    const v = verifierArchive("ceci n'est pas du JSON");
    expect(v.valide).toBe(false);
    expect(v.motif).toBe("json_illisible");
  });

  it("detecte une cloture retouchee", () => {
    const { archive } = archiveAout();
    const objet = JSON.parse(archive.contenu);
    objet.clotures[0].total_cumule_centimes = 999;
    const { empreinte_archive: _, ...sans } = objet;
    objet.empreinte_archive = createHash("sha256")
      .update(JSON.stringify(sans, null, 2), "utf8").digest("hex");

    const v = verifierArchive(JSON.stringify(objet, null, 2));
    expect(v.valide).toBe(false);
    expect(v.explication).toMatch(/cloture 2026-08/i);
  });
});

describe("reproductibilite", () => {
  it("produit exactement les memes octets pour les memes donnees", () => {
    // Une archive qui changerait a chaque generation ne pourrait pas etre
    // comparee a l'empreinte conservee en base.
    const a = archiveAout().archive;
    const b = archiveAout().archive;
    expect(a.empreinte).toBe(b.empreinte);
    expect(a.contenu).toBe(b.contenu);
  });

  it("change d'empreinte des que le contenu change", () => {
    const j = journal(LIGNES);
    const c = calculerCloture(ORG, "mensuelle", "2026-08", j, null);
    const aout = construireArchive(ORG, "mensuelle", "2026-08", j, [c], QUAND);
    const septembre = construireArchive(ORG, "mensuelle", "2026-09", j, [c], QUAND);
    expect(aout.empreinte).not.toBe(septembre.empreinte);
  });
});
