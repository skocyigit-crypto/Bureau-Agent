process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, encaissementsTable, facturesClientTable, organisationsTable } from "@workspace/db";

import { supprimerFactureAutorisee } from "../services/facture-suppression";

/**
 * Une facture qui a deja recu de l'argent ne se supprime pas.
 *
 * LE DEFAUT MESURE LE 16/09
 *
 * Deux regles existaient, chacune correcte de son cote :
 *
 *   - `DELETE /factures-client/:id` refuse (409) une facture EMISE — elle
 *     porte un numero de sequence, on ne l'efface pas, on l'annule ;
 *   - `POST /encaissements` exige une facture de l'organisation — on ne peut
 *     pas enregistrer un reglement dans le vide.
 *
 * Aucune des deux ne regardait l'autre. Or la seconde ne verifie pas le
 * STATUT de la facture : un reglement peut donc etre rattache a un BROUILLON,
 * que la premiere autorise a supprimer. La cle etrangere est declaree
 * `onDelete: "set null"` — l'ecriture survit, son `factureId` devient NULL.
 *
 * Ce qui reste est le pire des deux mondes : une ecriture dans le journal
 * inalterable (numero pris, empreinte chainee, impossible a retirer) qui ne
 * se rattache plus a rien. Le lettrage ne peut plus la justifier, et c'est
 * exactement l'ecart qu'un controle fiscal cherche — l'encaissement certifie
 * est trace, la piece qui le justifie a disparu.
 *
 * C'est la meme famille que les autres defauts de cet audit : une regle
 * appliquee d'un seul cote.
 *
 * LA REGLE RETENUE
 *
 * Le verrou porte sur le FAIT qu'il existe des encaissements, pas sur le
 * statut. Un brouillon paye n'est plus un brouillon : c'est une facture dont
 * l'emission a ete oubliee.
 */

const stamp = Date.now();
let org = 0;
const createdOrgs: number[] = [];
let numero = 0;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Org encaissement ${stamp}`, slug: `enc-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  org = o!.id;
  createdOrgs.push(org);
});

afterAll(async () => {
  if (createdOrgs.length > 0) {
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, createdOrgs));
  }
});

async function creerFacture(status: string): Promise<number> {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: org,
    reference: `F-${stamp}-${++numero}`,
    title: "Travaux de renovation",
    clientName: "Client essai",
    items: [{ description: "Travaux", quantity: 1, unitPrice: 1000, taxRate: 20 }],
    subtotal: "1000.00",
    taxAmount: "200.00",
    totalAmount: "1200.00",
    status,
  } as never).returning({ id: facturesClientTable.id });
  return f!.id;
}

/** Ajoute une ecriture au journal, comme le fait la route des encaissements. */
async function creerEncaissement(factureId: number): Promise<number> {
  const [e] = await db.insert(encaissementsTable).values({
    organisationId: org,
    numero: ++numero + 1000,
    factureId,
    montantCentimes: 50000,
    devise: "EUR",
    moyen: "virement",
    dateEncaissement: new Date(),
    sens: "encaissement",
    empreintePrecedente: "graine-essai",
    empreinte: `empreinte-${numero}`,
  } as never).returning({ id: encaissementsTable.id });
  return e!.id;
}

describe("une facture deja reglee est protegee, quel que soit son statut", () => {
  it("un BROUILLON qui porte un encaissement ne peut pas etre supprime", async () => {
    // LE COEUR DU DEFAUT : c'est le seul statut que le DELETE laissait passer.
    const factureId = await creerFacture("brouillon");
    await creerEncaissement(factureId);

    const verdict = await supprimerFactureAutorisee(org, factureId);
    expect(verdict.autorise, "un brouillon paye a pu etre supprime").toBe(false);
    expect(verdict.raison).toMatch(/reglement/i);
  });

  it("le refus dit COMBIEN de reglements bloquent", async () => {
    // Sans le compte, l'utilisateur ne sait pas ou aller regarder.
    const factureId = await creerFacture("brouillon");
    await creerEncaissement(factureId);
    await creerEncaissement(factureId);

    const verdict = await supprimerFactureAutorisee(org, factureId);
    expect(verdict.autorise).toBe(false);
    expect(verdict.nbEncaissements).toBe(2);
  });

  it("l'ecriture reste rattachee a sa facture apres la tentative", async () => {
    // La propriete qui compte vraiment : `onDelete: "set null"` ne doit jamais
    // avoir l'occasion de se declencher.
    const factureId = await creerFacture("brouillon");
    const encId = await creerEncaissement(factureId);

    await supprimerFactureAutorisee(org, factureId);

    const [ligne] = await db.select({ factureId: encaissementsTable.factureId })
      .from(encaissementsTable).where(eq(encaissementsTable.id, encId));
    expect(ligne?.factureId, "l'ecriture est devenue orpheline").toBe(factureId);
  });

  it("la facture elle-meme est toujours la", async () => {
    const factureId = await creerFacture("brouillon");
    await creerEncaissement(factureId);
    await supprimerFactureAutorisee(org, factureId);

    const [f] = await db.select({ id: facturesClientTable.id })
      .from(facturesClientTable).where(eq(facturesClientTable.id, factureId));
    expect(f?.id).toBe(factureId);
  });
});

describe("le parcours normal reste ouvert", () => {
  it("un brouillon SANS encaissement se supprime", async () => {
    // Un verrou qui empeche de jeter une erreur de saisie est une panne, pas
    // une securite : c'est le cas d'usage principal du DELETE.
    const factureId = await creerFacture("brouillon");
    const verdict = await supprimerFactureAutorisee(org, factureId);
    expect(verdict.autorise, "un brouillon vide n'est plus supprimable").toBe(true);
    expect(verdict.nbEncaissements).toBe(0);
  });

  it("le verdict ne depend pas du statut quand il n'y a aucun reglement", async () => {
    // Le refus des factures emises reste la regle du DELETE, en amont : cette
    // fonction ne repond qu'a la question des reglements, et ne doit pas s'en
    // inventer une seconde.
    for (const statut of ["brouillon", "envoyee", "annulee"]) {
      const factureId = await creerFacture(statut);
      const v = await supprimerFactureAutorisee(org, factureId);
      expect(v.autorise, `statut ${statut}`).toBe(true);
    }
  });

  it("une facture inexistante n'est pas declaree supprimable par accident", async () => {
    // Elle n'a aucun encaissement : une lecture naive rendrait « autorise ».
    // Le DELETE rend alors 404, mais cette fonction ne doit pas affirmer
    // quelque chose sur une facture qu'elle n'a pas vue.
    const verdict = await supprimerFactureAutorisee(org, 999_999_999);
    expect(verdict.introuvable).toBe(true);
  });
});

describe("la route de suppression consomme bien ce verdict", () => {
  it("le DELETE appelle le verrou avant de supprimer", async () => {
    // Les cas ci-dessus testent la FONCTION. Un verrou correct qui n'est
    // branche nulle part ne protege rien — et c'est la moitie du defaut qu'on
    // corrige ici. La verification se fait sur la source: exercer la route
    // demanderait une session authentifiee complete.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "factures-client.ts"),
      "utf8",
    );
    expect(source).toContain("supprimerFactureAutorisee");

    const iAppel = source.indexOf("await supprimerFactureAutorisee");
    const iDelete = source.indexOf("await db.delete(facturesClientTable)");
    expect(iAppel, "le verrou n'est pas appele dans la route").toBeGreaterThan(0);
    expect(iDelete).toBeGreaterThan(0);
    expect(iAppel, "le verrou est appele APRES la suppression").toBeLessThan(iDelete);
  });

  it("le refus de la route est un 409, pas un 500", async () => {
    // 409 Conflict: l'etat de la ressource s'y oppose. Un 500 ferait croire a
    // une panne et invitera l'utilisateur a reessayer.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "factures-client.ts"),
      "utf8",
    );
    const i = source.indexOf("if (!verdict.autorise)");
    expect(i).toBeGreaterThan(0);
    expect(source.slice(i, i + 300)).toContain("status(409)");
  });
});

describe("la frontiere entre organisations", () => {
  it("les encaissements d'une AUTRE organisation ne comptent pas", async () => {
    // Un compte global rendrait une facture indestructible parce qu'un autre
    // locataire a encaisse quelque chose — et ferait fuiter son activite.
    const [autre] = await db.insert(organisationsTable).values({
      name: `Org voisine ${stamp}`, slug: `enc-voisine-${stamp}`, maxUsers: 5, actif: true,
    }).returning({ id: organisationsTable.id });
    createdOrgs.push(autre!.id);

    const factureId = await creerFacture("brouillon");
    const verdict = await supprimerFactureAutorisee(autre!.id, factureId);
    // Vue depuis l'autre organisation, cette facture n'existe pas.
    expect(verdict.introuvable).toBe(true);
  });

  it("une facture payee reste bloquee quand on la regarde depuis SA propre organisation", async () => {
    const factureId = await creerFacture("brouillon");
    await creerEncaissement(factureId);
    const verdict = await supprimerFactureAutorisee(org, factureId);
    expect(verdict.autorise).toBe(false);
  });

  it("une ecriture d'un AUTRE locataire pointant sur cette facture ne compte pas", async () => {
    // DEFENSE EN PROFONDEUR, et ce test existe parce qu'une mutation a survecu:
    // retirer le filtre d'organisation du comptage ne faisait tomber aucun
    // test, la facture etant deja lue dans son organisation.
    //
    // La route des encaissements ne permet pas d'ecrire cela. La base, si —
    // et c'est precisement ce que le second filtre protege: sinon le nombre de
    // reglements affiche a un locataire proviendrait en partie d'un autre.
    const [voisin] = await db.insert(organisationsTable).values({
      name: `Org intruse ${stamp}`, slug: `enc-intruse-${stamp}`, maxUsers: 5, actif: true,
    }).returning({ id: organisationsTable.id });
    createdOrgs.push(voisin!.id);

    const factureId = await creerFacture("brouillon");
    await db.insert(encaissementsTable).values({
      organisationId: voisin!.id,
      numero: ++numero + 5000,
      factureId,
      montantCentimes: 12345,
      devise: "EUR",
      moyen: "virement",
      dateEncaissement: new Date(),
      sens: "encaissement",
      empreintePrecedente: "graine-intruse",
      empreinte: `empreinte-intruse-${numero}`,
    } as never);

    const verdict = await supprimerFactureAutorisee(org, factureId);
    expect(verdict.nbEncaissements, "une ecriture d'un autre locataire a ete comptee").toBe(0);
    expect(verdict.autorise).toBe(true);
  });

  it("deux factures de la meme organisation sont jugees separement", async () => {
    // Un compte fait au niveau de l'organisation, et non de la facture,
    // bloquerait tout des le premier encaissement enregistre.
    const payee = await creerFacture("brouillon");
    await creerEncaissement(payee);
    const vide = await creerFacture("brouillon");

    expect((await supprimerFactureAutorisee(org, payee)).autorise).toBe(false);
    expect((await supprimerFactureAutorisee(org, vide)).autorise, "le compte deborde d'une facture a l'autre").toBe(true);
  });
});
