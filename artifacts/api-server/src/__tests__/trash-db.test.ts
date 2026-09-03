process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  deletedRowsTable,
  organisationsTable,
  prospectsTable,
  usersTable,
} from "@workspace/db";
import {
  archiveDeletedRows,
  listTrash,
  purgeExpiredTrash,
  restoreFromTrash,
} from "../services/trash";

/**
 * Le voyage complet, contre une vraie base: supprimer, retrouver, remettre.
 *
 * Les tests statiques d'a cote verifient les regles — quelles tables sont
 * restaurables, que l'organisation est reimposee, que rien n'est ecrase. Ils
 * ne peuvent pas dire si la ligne revient VRAIMENT. C'est pourtant la seule
 * chose qui compte pour la personne qui vient de supprimer par erreur, et
 * c'est le genre de promesse qu'on ne decouvre fausse qu'au pire moment.
 *
 * Deux organisations, parce que la propriete la plus dangereuse a rater n'est
 * pas « la restauration fonctionne » mais « elle ne franchit pas la frontiere
 * du locataire ».
 */

const stamp = Date.now();
let orgA = 0;
let orgB = 0;
const createdOrgs: number[] = [];

beforeAll(async () => {
  const [a] = await db.insert(organisationsTable).values({
    name: `Org trash A ${stamp}`, slug: `trash-a-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  const [b] = await db.insert(organisationsTable).values({
    name: `Org trash B ${stamp}`, slug: `trash-b-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgA = a!.id; orgB = b!.id;
  createdOrgs.push(orgA, orgB);
});

afterAll(async () => {
  // `deleted_rows` et `prospects` referencent l'organisation en cascade.
  if (createdOrgs.length > 0) {
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, createdOrgs));
  }
});

/** Cree un prospect, le supprime en archivant, et rend l'entree de corbeille. */
async function deleteProspect(orgId: number, title: string) {
  const [row] = await db.insert(prospectsTable).values({
    organisationId: orgId, title, stage: "nouveau",
  }).returning();
  const [deleted] = await db.delete(prospectsTable)
    .where(eq(prospectsTable.id, row!.id)).returning();
  await archiveDeletedRows(prospectsTable, [deleted!], { orgId, userId: null, userName: "essai@example.fr" });
  const entries = await listTrash(orgId);
  return { rowId: row!.id, entry: entries.find((e) => e.rowId === row!.id)! };
}

describe("supprimer puis remettre", () => {
  it("fait revenir la ligne exactement ou elle etait", async () => {
    const title = `Prospect ${stamp} a restaurer`;
    const { rowId, entry } = await deleteProspect(orgA, title);

    // Elle est bien partie de sa table: la corbeille n'est pas un drapeau
    // pose sur une ligne encore presente.
    const gone = await db.select().from(prospectsTable).where(eq(prospectsTable.id, rowId));
    expect(gone).toHaveLength(0);

    expect(entry, "la suppression n'a pas atteint la corbeille").toBeDefined();
    expect(entry.label).toBe(title);
    expect(entry.tableName).toBe("prospects");
    expect(entry.deletedByName).toBe("essai@example.fr");

    const outcome = await restoreFromTrash(orgA, entry.id);
    expect(outcome.ok, `restauration refusee: ${JSON.stringify(outcome)}`).toBe(true);

    const back = await db.select().from(prospectsTable).where(eq(prospectsTable.id, rowId));
    expect(back, "la ligne n'est pas revenue").toHaveLength(1);
    expect(back[0]!.title).toBe(title);
    // Le meme identifiant: tout ce qui pointait vers cette ligne pointe encore.
    expect(back[0]!.id).toBe(rowId);
    expect(back[0]!.organisationId).toBe(orgA);

    // L'entree disparait une fois servie: sinon un second clic tenterait de
    // recreer une ligne deja presente.
    const after = await listTrash(orgA);
    expect(after.some((e) => e.id === entry.id)).toBe(false);
  });

  it("refuse de restaurer la corbeille d'une autre organisation", async () => {
    // La propriete la plus dangereuse a rater. Sans le filtre, un identifiant
    // devine suffirait a ecrire une ligne chez un autre client.
    const { entry } = await deleteProspect(orgB, `Prospect ${stamp} de B`);
    const outcome = await restoreFromTrash(orgA, entry.id);
    expect(outcome).toEqual({ ok: false, reason: "not_found" });

    // Et l'entree de B est intacte: une tentative echouee ne consomme rien.
    const stillThere = await listTrash(orgB);
    expect(stillThere.some((e) => e.id === entry.id)).toBe(true);
  });

  it("ne montre a chacun que sa propre corbeille", async () => {
    const a = await listTrash(orgA);
    const b = await listTrash(orgB);
    const idsB = new Set(b.map((e) => e.id));
    expect(a.some((e) => idsB.has(e.id))).toBe(false);
  });
});

describe("expiration", () => {
  it("efface les entrees plus vieilles que la fenetre, et seulement elles", async () => {
    const { entry: vieille } = await deleteProspect(orgA, `Prospect ${stamp} ancien`);
    const { entry: recente } = await deleteProspect(orgA, `Prospect ${stamp} recent`);

    // On vieillit artificiellement une entree: attendre trente jours n'est pas
    // une option, et figer l'horloge ne testerait pas la requete SQL reelle.
    await db.update(deletedRowsTable)
      .set({ deletedAt: new Date(Date.now() - 31 * 86400_000) })
      .where(eq(deletedRowsTable.id, vieille.id));

    await purgeExpiredTrash();

    const restants = await db.select({ id: deletedRowsTable.id }).from(deletedRowsTable)
      .where(and(
        eq(deletedRowsTable.organisationId, orgA),
        inArray(deletedRowsTable.id, [vieille.id, recente.id]),
      ));
    const ids = restants.map((r) => r.id);
    expect(ids, "l'entree expiree devait disparaitre").not.toContain(vieille.id);
    expect(ids, "une entree recente a ete emportee").toContain(recente.id);
  });
});

describe("perimetre", () => {
  it("n'archive pas une table hors liste, plutot que de promettre a tort", async () => {
    // Archiver ce qu'on ne saura pas remettre ferait mentir la corbeille a
    // celui qui la consulte: il verrait sa ligne et ne pourrait rien en faire.
    const archived = await archiveDeletedRows(
      usersTable,
      [{ id: 999_999, email: "hors-perimetre@example.fr" }],
      { orgId: orgA, userId: null, userName: null },
    );
    expect(archived).toBe(0);
    const entries = await listTrash(orgA);
    expect(entries.some((e) => e.tableName === "users")).toBe(false);
  });
});
