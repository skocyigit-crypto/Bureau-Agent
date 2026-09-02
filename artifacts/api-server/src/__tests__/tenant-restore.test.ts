/**
 * Une restauration doit rendre ce qui manque SANS defaire ce qui a ete fait
 * depuis. C'est la propriete dangereuse: une restauration qui ecrase ferait
 * perdre au client une journee de travail au moment precis ou il essaie de se
 * proteger. Verifiee ici contre une vraie base.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  contactsTable,
  organisationBackupsTable,
  organisationsTable,
  prospectsTable,
} from "@workspace/db";
import { buildOrganisationBackup } from "../services/tenant-backup";
import { planRestore, restoreMissingRows, RESTORABLE_TABLES } from "../services/tenant-restore";

const stamp = Date.now();
const MARK = `RESTORE-${stamp}`;
let orgId = 0;
let otherOrgId = 0;
let doomedProspectId = 0;

beforeAll(async () => {
  const [org] = await db.insert(organisationsTable).values({
    name: `Restore Org ${stamp}`, slug: `restore-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  const [other] = await db.insert(organisationsTable).values({
    name: `Restore Other ${stamp}`, slug: `restore-other-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = org.id; otherOrgId = other.id;

  const [prospect] = await db.insert(prospectsTable).values({
    organisationId: orgId, title: `Prospect ${MARK}`, stage: "nouveau", priority: "moyenne",
  }).returning({ id: prospectsTable.id });
  doomedProspectId = prospect.id;

  await db.insert(contactsTable).values({
    organisationId: orgId, firstName: "Avant", lastName: MARK, phone: "0100000009",
  });
});

afterAll(async () => {
  try {
    const orgs = [orgId, otherOrgId].filter(Boolean);
    await db.delete(organisationBackupsTable).where(inArray(organisationBackupsTable.organisationId, orgs));
    await db.delete(prospectsTable).where(inArray(prospectsTable.organisationId, orgs));
    await db.delete(contactsTable).where(inArray(contactsTable.organisationId, orgs));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, orgs));
  } catch { /* best-effort */ }
});

describe("restauration additive", () => {
  it("rend une ligne supprimee sans toucher au travail fait depuis", async () => {
    // 1. Sauvegarde de l'etat courant.
    const backup = await buildOrganisationBackup(orgId);

    // 2. Le client supprime un prospect par erreur, puis continue a travailler:
    //    il modifie un contact et en cree un autre.
    await db.delete(prospectsTable).where(eq(prospectsTable.id, doomedProspectId));
    await db.update(contactsTable)
      .set({ firstName: "Apres" })
      .where(and(eq(contactsTable.organisationId, orgId), eq(contactsTable.lastName, MARK)));
    await db.insert(contactsTable).values({
      organisationId: orgId, firstName: "Nouveau", lastName: `${MARK}-2`, phone: "0100000010",
    });

    // 3. L'apercu annonce exactement ce qui manque.
    const plan = await planRestore(backup, orgId);
    const prospectPlan = plan.find((p) => p.table === "prospects");
    expect(prospectPlan?.missing).toBe(1);
    expect(plan.find((p) => p.table === "contacts")).toBeUndefined();

    // 4. Restauration.
    const result = await restoreMissingRows(backup, orgId);
    expect(result.restored).toBeGreaterThanOrEqual(1);

    // Le prospect supprime est revenu...
    const [restored] = await db.select().from(prospectsTable)
      .where(eq(prospectsTable.id, doomedProspectId));
    expect(restored?.title).toBe(`Prospect ${MARK}`);

    // ... la modification faite APRES la sauvegarde n'a pas ete ecrasee...
    const [modified] = await db.select().from(contactsTable)
      .where(and(eq(contactsTable.organisationId, orgId), eq(contactsTable.lastName, MARK)));
    expect(modified.firstName, "une restauration ne doit jamais ecraser une ligne existante").toBe("Apres");

    // ... et le contact cree apres est toujours la.
    const [created] = await db.select().from(contactsTable)
      .where(and(eq(contactsTable.organisationId, orgId), eq(contactsTable.lastName, `${MARK}-2`)));
    expect(created, "une restauration ne doit jamais supprimer une ligne recente").toBeTruthy();
  });

  it("est idempotente: rejouee, elle ne cree pas de doublon", async () => {
    const backup = await buildOrganisationBackup(orgId);
    const before = await db.select({ id: prospectsTable.id }).from(prospectsTable)
      .where(eq(prospectsTable.organisationId, orgId));

    const result = await restoreMissingRows(backup, orgId);

    const after = await db.select({ id: prospectsTable.id }).from(prospectsTable)
      .where(eq(prospectsTable.organisationId, orgId));
    expect(after).toHaveLength(before.length);
    expect(result.restored).toBe(0);
  });

  it("n'ecrit jamais dans une autre organisation", async () => {
    const backup = await buildOrganisationBackup(orgId);

    await restoreMissingRows(backup, orgId);

    const strangers = await db.select({ id: prospectsTable.id }).from(prospectsTable)
      .where(eq(prospectsTable.organisationId, otherOrgId));
    expect(strangers).toHaveLength(0);
  });

  it("refuse les tables hors liste, meme demandees explicitement", async () => {
    const backup = await buildOrganisationBackup(orgId);

    // `users` et `audit_logs` ne sont pas restaurables: reinjecter un compte
    // supprime serait une faille, et les journaux sont append-only.
    const result = await restoreMissingRows(backup, orgId, { tables: ["users", "audit_logs", "api_keys"] });

    expect(result.perTable).toEqual([]);
    expect(result.restored).toBe(0);
  });

  it("garde les tables d'authentification et de journal hors du perimetre", () => {
    for (const forbidden of ["users", "api_keys", "subscriptions", "audit_logs", "license_audit_log", "ai_usage"]) {
      expect(RESTORABLE_TABLES as readonly string[], forbidden).not.toContain(forbidden);
    }
  });

  it("declare les parents avant leurs enfants", () => {
    // Une facture reference son devis: restaurer l'enfant d'abord echouerait.
    const order = RESTORABLE_TABLES as readonly string[];
    for (const [parent, child] of [
      ["contacts", "devis"],
      ["devis", "factures_client"],
      ["whatsapp_conversations", "whatsapp_messages"],
      ["stock_articles", "stock_mouvements"],
    ]) {
      expect(order.indexOf(parent), `${parent} doit preceder ${child}`).toBeLessThan(order.indexOf(child));
    }
  });
});
