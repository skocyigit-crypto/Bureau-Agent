/**
 * Le produit declenchait la captation d'une voix sans que personne en soit averti.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * `POST /telephony/call` lisait `record` dans le corps de la requete et le
 * passait tel quel au fournisseur :
 *
 *     makeCall(provider.provider, config, { to, record: record === true })
 *
 * ce qui devient `Record: "true"` chez Twilio et `record-from-answer`
 * ailleurs. Le produit DECLENCHE donc l'enregistrement lui-meme.
 *
 * Et dans tout le depot, aucune annonce : la recherche de « cet appel »,
 * « peut etre enregistre », « est enregistre » ne renvoie que des
 * commentaires sans rapport. Aucune trace non plus d'une information des
 * salaries ni d'une consultation du CSE.
 *
 * Le consentement de l'interlocuteur n'est presume que s'il a ete REELLEMENT
 * informe et est reste en ligne alors qu'il pouvait s'y opposer. Sans annonce,
 * cette presomption ne nait pas.
 *
 * POURQUOI CELUI-CI REFUSE, ALORS QUE LES AUTRES AVERTISSENT
 *
 * Les modules de conformite de ce lot — durees du travail, delais de paiement,
 * retenue de garantie, mentions obligatoires — DECRIVENT ce qui a eu lieu.
 * Refuser d'enregistrer une journee de treize heures produirait un registre
 * faux, et le registre existe pour prouver la realite.
 *
 * Ici, le produit n'enregistre pas un fait : il ACCOMPLIT un acte. La
 * distinction n'est pas de degre — decrire un manquement et le commettre sont
 * deux choses differentes.
 *
 * CE QUE L'ATTESTATION EST, ET N'EST PAS
 *
 * Le produit ne peut verifier aucune des trois conditions : l'annonce vit dans
 * l'IVR de l'operateur, l'information des salaries et la consultation du CSE
 * sont des actes de l'entreprise. Pretendre les controler serait mentir.
 *
 * Attester ne rend donc pas conforme. Cela rend la responsabilite explicite,
 * datee et nominative, et remplace un declenchement silencieux par une
 * decision assumee.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";

import {
  CONDITIONS_ENREGISTREMENT,
  verifierEnregistrement,
} from "../services/enregistrement-appels";

describe("sans attestation, l'enregistrement est refuse", () => {
  it("une organisation neuve ne peut pas enregistrer", () => {
    const v = verifierEnregistrement({});
    expect(v.autorise).toBe(false);
    expect(v.attesteLe).toBeNull();
  });

  it("le refus rappelle les trois conditions", () => {
    // Un refus sans mode d'emploi se contourne ou se subit; avec les
    // conditions, il devient une consigne.
    const v = verifierEnregistrement({});
    expect(v.conditions).toHaveLength(3);
  });

  it("les trois conditions sont l'annonce, l'information des salaries et le CSE", () => {
    const texte = CONDITIONS_ENREGISTREMENT.join(" ");
    expect(texte).toMatch(/annonce/i);
    expect(texte).toContain("L1222-4");
    expect(texte).toContain("L2312-38");
  });

  it("une attestation vide ou nulle ne vaut pas attestation", () => {
    for (const v of [null, undefined, ""]) {
      expect(verifierEnregistrement({ enregistrementAppelsAtteste: v }).autorise, String(v)).toBe(false);
    }
  });

  it("une date illisible ne vaut pas attestation", () => {
    // Une valeur corrompue ne doit pas ouvrir la captation: c'est le sens
    // prudent, et le seul acceptable ici.
    expect(verifierEnregistrement({ enregistrementAppelsAtteste: "pas-une-date" }).autorise).toBe(false);
  });

  it("le motif dit que c'est le produit qui declenche", () => {
    // L'utilisateur doit comprendre pourquoi ce refus le concerne, lui, et
    // pas son operateur.
    expect(verifierEnregistrement({}).motif).toMatch(/declenche lui-meme/i);
  });
});

describe("avec attestation, l'enregistrement est possible", () => {
  it("une date valide autorise", () => {
    // L'erreur symetrique compte: un verrou qui ne s'ouvre jamais serait
    // contourne en desactivant le controle.
    const v = verifierEnregistrement({ enregistrementAppelsAtteste: "2026-09-16T10:00:00Z" });
    expect(v.autorise).toBe(true);
    expect(v.attesteLe?.toISOString()).toBe("2026-09-16T10:00:00.000Z");
  });

  it("un objet Date est accepte comme une chaine", () => {
    const v = verifierEnregistrement({ enregistrementAppelsAtteste: new Date("2026-09-16T10:00:00Z") });
    expect(v.autorise).toBe(true);
  });

  it("aucune condition n'est rappelee quand c'est attesté", () => {
    expect(verifierEnregistrement({ enregistrementAppelsAtteste: new Date() }).conditions).toEqual([]);
  });

  it("une attestation ancienne reste valable", () => {
    // Elle porte sur une mise en service, pas sur chaque appel: la faire
    // expirer obligerait a re-attester sans qu'aucun fait ait change.
    const v = verifierEnregistrement({ enregistrementAppelsAtteste: "2024-01-01T00:00:00Z" });
    expect(v.autorise).toBe(true);
  });
});

describe("le verrou est branche sur l'appel sortant", () => {
  it("la route refuse `record: true` sans attestation", async () => {
    // Un verrou non branche ne protege personne: c'est le mode de panne
    // recurrent de ce depot.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "telephony.ts"), "utf8");
    expect(source).toContain("enregistrement-appels");
    expect(source).toContain("if (record === true) {");
    const i = source.indexOf("if (record === true) {");
    const bloc = source.slice(i, i + 900);
    expect(bloc).toContain("verifierEnregistrement");
    expect(bloc).toContain("status(409)");
  });

  it("le verrou precede l'appel au fournisseur", async () => {
    // Refuser APRES avoir declenche la captation ne servirait a rien.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "telephony.ts"), "utf8");
    const iVerrou = source.indexOf("if (record === true) {");
    const iAppel = source.indexOf("await makeCall(provider.provider, config");
    expect(iVerrou).toBeGreaterThan(0);
    expect(iAppel).toBeGreaterThan(0);
    expect(iVerrou).toBeLessThan(iAppel);
  });

  it("un appel SANS enregistrement n'est pas bloque", async () => {
    // La telephonie doit continuer de fonctionner: bloquer tous les appels
    // parce que l'enregistrement n'est pas atteste serait une panne.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "telephony.ts"), "utf8");
    const i = source.indexOf("if (record === true) {");
    const bloc = source.slice(i, i + 900);
    // Le refus vit a l'interieur du `if`: aucun `return` de refus ne doit se
    // trouver avant lui dans ce chemin.
    expect(bloc).toContain("if (!verdict.autorise) {");
  });

  it("le refus explique comment lever le blocage", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "telephony.ts"), "utf8");
    expect(source).toContain("remediation:");
    expect(source).toContain("enregistrement-atteste");
  });
});

describe("l'attestation est datee et nominative", () => {
  it("la route enregistre qui a atteste", async () => {
    // L'article 5.2 du RGPD demande de pouvoir DEMONTRER: une attestation
    // anonyme ne demontre rien.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "telephony.ts"), "utf8");
    expect(source).toContain("enregistrementAppelsAttestePar: atteste ? userId : null");
  });

  it("retirer l'attestation efface aussi son auteur", async () => {
    // Un nom qui subsiste sur une attestation revoquee laisserait croire
    // qu'elle tient toujours.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "telephony.ts"), "utf8");
    expect(source).toContain("enregistrementAppelsAtteste: atteste ? new Date() : null");
  });

  it("le changement d'attestation est journalise", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "telephony.ts"), "utf8");
    expect(source).toMatch(/attestation d'enregistrement modifiee/);
  });

  it("un corps sans booleen est refuse, avec les conditions", async () => {
    // L'utilisateur doit lire ce qu'il atteste avant de l'attester.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "telephony.ts"), "utf8");
    const i = source.indexOf('if (typeof atteste !== "boolean")');
    expect(i).toBeGreaterThan(0);
    expect(source.slice(i, i + 300)).toContain("CONDITIONS_ENREGISTREMENT");
  });
});
