/**
 * La propriete qui compte vraiment, verifiee contre une VRAIE base: une
 * sauvegarde ne contient que les lignes de son organisation.
 *
 * L'export precedent du depot (`google-drive-backup.ts`) faisait
 * `SELECT * FROM table` sans filtre: branche sur le Drive d'un client, il lui
 * aurait livre les donnees de tous les autres. Un test unitaire ne l'aurait pas
 * vu — il faut des lignes de deux organisations dans la meme base.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  contactsTable,
  facturesClientTable,
  organisationBackupsTable,
  organisationsTable,
  prospectsTable,
} from "@workspace/db";
import {
  buildOrganisationBackup,
  createOrganisationBackup,
  pruneOrganisationBackups,
  readStoredBackup,
} from "../services/tenant-backup";

const stamp = Date.now();
// Marqueurs sans recouvrement possible: ALPHA serait un sous-texte de
// plusieurs autres valeurs, ce qui rendrait les assertions ambigues.
const ALPHA = `ALPHA-${stamp}`;
const BETA = `BETA-${stamp}`;
let orgA = 0;
let orgB = 0;

beforeAll(async () => {
  const [a] = await db.insert(organisationsTable).values({
    name: `Org ${ALPHA}`, slug: `backup-a-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  const [b] = await db.insert(organisationsTable).values({
    name: `Org ${BETA}`, slug: `backup-b-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgA = a.id; orgB = b.id;

  await db.insert(contactsTable).values([
    { organisationId: orgA, firstName: "Contact", lastName: ALPHA, phone: "0100000001" },
    { organisationId: orgB, firstName: "Contact", lastName: BETA, phone: "0100000002" },
  ]);
  await db.insert(prospectsTable).values([
    { organisationId: orgA, title: `Prospect ${ALPHA}`, stage: "nouveau", priority: "moyenne" },
    { organisationId: orgB, title: `Prospect ${BETA}`, stage: "nouveau", priority: "moyenne" },
  ]);
  await db.insert(facturesClientTable).values([
    { organisationId: orgA, reference: `BK-A-${stamp}`, title: `Facture ${ALPHA}`, clientName: "Client A" },
    { organisationId: orgB, reference: `BK-B-${stamp}`, title: `Facture ${BETA}`, clientName: "Client B" },
  ]);
});

afterAll(async () => {
  try {
    const orgs = [orgA, orgB].filter(Boolean);
    if (!orgs.length) return;
    await db.delete(organisationBackupsTable).where(inArray(organisationBackupsTable.organisationId, orgs));
    await db.delete(facturesClientTable).where(inArray(facturesClientTable.organisationId, orgs));
    await db.delete(prospectsTable).where(inArray(prospectsTable.organisationId, orgs));
    await db.delete(contactsTable).where(inArray(contactsTable.organisationId, orgs));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, orgs));
  } catch { /* nettoyage best-effort */ }
});

describe("buildOrganisationBackup", () => {
  it("n'emporte que les lignes de l'organisation demandee", async () => {
    const backup = await buildOrganisationBackup(orgA);
    const serialized = JSON.stringify(backup);

    expect(serialized).toContain(ALPHA);
    expect(serialized).toContain(`Prospect ${ALPHA}`);
    expect(serialized).toContain(`Facture ${ALPHA}`);

    // Le temoin: aucune trace de l'autre organisation, nulle part.
    expect(serialized).not.toContain(BETA);
    expect(serialized).not.toContain(`Prospect ${BETA}`);
    expect(serialized).not.toContain(`Facture ${BETA}`);
    expect(serialized).not.toContain(`Org ${BETA}`);
  });

  it("porte la fiche de l'organisation elle-meme", async () => {
    const backup = await buildOrganisationBackup(orgA);

    expect(backup.tables.organisations).toHaveLength(1);
    expect((backup.tables.organisations[0] as { id: number }).id).toBe(orgA);
    expect(backup.meta.organisationId).toBe(orgA);
    expect(backup.meta.rows).toBeGreaterThanOrEqual(4);
  });

  it("interroge chaque table declaree, meme vide", async () => {
    const backup = await buildOrganisationBackup(orgA);

    // Une table absente de l'objet voudrait dire qu'on ne l'a pas lue du tout.
    for (const table of ["contacts", "prospects", "factures_client", "documents", "tasks"]) {
      expect(backup.tables, table).toHaveProperty(table);
    }
  });
});

describe("createOrganisationBackup", () => {
  it("stocke un contenu relisable et intact", async () => {
    const saved = await createOrganisationBackup(orgA, { origin: "manual" });

    const [row] = await db.select().from(organisationBackupsTable)
      .where(eq(organisationBackupsTable.id, saved.id));

    expect(row.organisationId).toBe(orgA);
    expect(row.sizeBytes).toBeGreaterThan(0);
    const { json, valid } = readStoredBackup({ content: row.content, checksum: row.checksum });
    expect(valid).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.meta.organisationId).toBe(orgA);
    expect(json).toContain(ALPHA);
    expect(json).not.toContain(BETA);
  });

  it("compresse: le stockage pese moins que le JSON brut", async () => {
    const saved = await createOrganisationBackup(orgA, { origin: "manual" });
    const [row] = await db.select().from(organisationBackupsTable)
      .where(eq(organisationBackupsTable.id, saved.id));

    const { json } = readStoredBackup({ content: row.content, checksum: row.checksum });
    expect(row.sizeBytes).toBeLessThan(Buffer.byteLength(json, "utf8"));
  });
});

describe("retention", () => {
  it("ne conserve que les N plus recentes, et seulement pour cette organisation", async () => {
    for (let i = 0; i < 3; i++) await createOrganisationBackup(orgA, { origin: "auto" });
    await createOrganisationBackup(orgB, { origin: "auto" });

    await pruneOrganisationBackups(orgA, 2);

    const remainingA = await db.select({ id: organisationBackupsTable.id })
      .from(organisationBackupsTable).where(eq(organisationBackupsTable.organisationId, orgA));
    const remainingB = await db.select({ id: organisationBackupsTable.id })
      .from(organisationBackupsTable).where(eq(organisationBackupsTable.organisationId, orgB));

    expect(remainingA).toHaveLength(2);
    // La purge d'une organisation ne doit jamais toucher aux sauvegardes d'une autre.
    expect(remainingB.length).toBeGreaterThanOrEqual(1);
  });
});
