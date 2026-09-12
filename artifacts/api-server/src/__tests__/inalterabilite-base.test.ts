/**
 * L'inalterabilite, eprouvee contre une VRAIE base.
 *
 * Les quinze tests de `chainage-encaissements` verifient la fonction, sur des
 * objets fabriques en memoire. Aucun ne verifiait le CHEMIN COMPLET: ecrire
 * dans Postgres, relire, recalculer les empreintes, et conclure.
 *
 * Ce chemin est precisement celui ou la garantie peut se perdre sans bruit.
 * L'empreinte est calculee sur une forme canonique ou la date est une CHAINE
 * (`toISOString()`), alors que la colonne est un `timestamp`: la lecture rend
 * un objet `Date`. La conversion est faite des deux cotes par la route — mais
 * rien ne l'imposait. Le jour ou elle disparait d'un cote, deux choses
 * peuvent arriver, et les deux sont graves:
 *
 *   - la verification crie a l'alteration sur un journal parfaitement sain,
 *     et l'utilisateur ne peut plus distinguer une vraie alerte d'un bruit;
 *   - ou elle normalise une difference reelle, et une modification passe.
 *
 * L'enjeu n'est pas theorique: l'attestation remise au client affirme qu'il
 * peut verifier son journal « a tout moment », et l'article 286-I-3° bis du
 * CGI assortit le manquement d'une amende de 7 500 EUR par logiciel.
 *
 * Ce fichier ne teste donc pas une fonction: il teste la PROMESSE.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { db, encaissementsTable, organisationsTable } from "@workspace/db";
import {
  preparerEcriture,
  verifierChaine,
  type EcritureChainee,
} from "../services/chainage-encaissements";

const QUAND = new Date("2026-09-12T10:00:00.000Z");
let orgId = 0;

afterEach(async () => {
  if (orgId) {
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
    orgId = 0;
  }
});

/**
 * Relit le journal comme le fait la route: la date redevient une chaine.
 *
 * C'est cette conversion qui est verifiee ici autant que le reste — si elle
 * sautait, le premier test echouerait sur un journal pourtant intact.
 */
async function relire(org: number): Promise<EcritureChainee[]> {
  const lignes = await db
    .select()
    .from(encaissementsTable)
    .where(eq(encaissementsTable.organisationId, org))
    .orderBy(encaissementsTable.numero);

  return lignes.map((l) => ({
    numero: l.numero,
    organisationId: l.organisationId,
    factureId: l.factureId,
    montantCentimes: l.montantCentimes,
    devise: l.devise,
    moyen: l.moyen,
    dateEncaissement: l.dateEncaissement.toISOString(),
    sens: l.sens,
    annuleNumero: l.annuleNumero,
    empreintePrecedente: l.empreintePrecedente,
    empreinte: l.empreinte,
  })) as EcritureChainee[];
}

/** Trois encaissements chaines, ecrits comme la route les ecrit. */
async function journalDeTrois(): Promise<number> {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: "Verification inalterabilite",
      slug: `inalterabilite-${Date.now()}`,
      email: `inalterabilite-${Date.now()}@exemple.test`,
      maxUsers: 3,
      actif: true,
    })
    .returning({ id: organisationsTable.id });

  let precedente: EcritureChainee | null = null;
  for (let i = 1; i <= 3; i++) {
    const ecriture = preparerEcriture(
      {
        // `numero` et `empreintePrecedente` ne sont pas fournis: `preparerEcriture`
        // les derive de l'ecriture precedente. L'appelant ne choisit pas sa
        // place dans la sequence — c'est ce qui rend la suite verifiable.
        organisationId: org.id,
        factureId: null,
        montantCentimes: 10_000 * i,
        devise: "EUR",
        moyen: "virement",
        dateEncaissement: QUAND.toISOString(),
        sens: "encaissement",
        annuleNumero: null,
      },
      precedente,
    );
    // La colonne est un timestamp: on ecrit un Date, on hache une chaine.
    await db.insert(encaissementsTable).values({ ...ecriture, dateEncaissement: QUAND } as never);
    precedente = ecriture;
  }
  return org.id;
}

describe("le journal relu depuis Postgres", () => {
  it("est declare intact quand il n'a pas ete touche", async () => {
    orgId = await journalDeTrois();
    const verdict = verifierChaine(await relire(orgId), orgId);

    // Ce cas compte autant que les suivants: une verification qui crie au loup
    // sur un journal sain rendrait toutes ses alertes inutilisables.
    expect(verdict.motif ?? "aucun").toBe("aucun");
    expect(verdict.intacte).toBe(true);
  });

  it("detecte un montant modifie directement en base", async () => {
    orgId = await journalDeTrois();

    // L'alteration que le dispositif existe pour attraper: quelqu'un change un
    // montant en base sans pouvoir recalculer la chaine.
    await db.execute(
      sql`UPDATE encaissements SET montant_centimes = 99999 WHERE organisation_id = ${orgId} AND numero = 2`,
    );

    const verdict = verifierChaine(await relire(orgId), orgId);
    expect(verdict.intacte).toBe(false);
    expect(verdict.motif).toBe("empreinte_incorrecte");
    // Designer la ligne est ce qui rend le constat utilisable par un tiers.
    expect(verdict.premiereRupture).toBe(2);
  });

  it("detecte une ecriture supprimee au milieu", async () => {
    orgId = await journalDeTrois();

    await db.execute(
      sql`DELETE FROM encaissements WHERE organisation_id = ${orgId} AND numero = 2`,
    );

    const verdict = verifierChaine(await relire(orgId), orgId);
    expect(verdict.intacte).toBe(false);
    // Une suppression laisse un trou dans la numerotation avant meme de rompre
    // le chainage: c'est le premier signe, et le plus lisible.
    expect(verdict.motif).toBe("numero_non_consecutif");
  });
});
