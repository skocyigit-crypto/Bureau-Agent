/**
 * Le client doit VOIR que son standard telephonique n'a aucun document.
 * Base reelle : le compte se mesure sur des documents inseres.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, documentsTable, organisationsTable } from "@workspace/db";
import { getKnowledgeStatus } from "../services/knowledge-base";

const stamp = Date.now();
let orgId = 0;
const PAGE = readFileSync(join(import.meta.dirname, "..", "..", "..", "buro-ajani", "src", "pages", "knowledge-base.tsx"), "utf8");

async function doc(category: string, texte: string | null, scanVerdict: string | null = null) {
  await db.insert(documentsTable).values({
    organisationId: orgId, fileName: `${category}.txt`, originalName: `${category}.txt`, mimeType: "text/plain",
    fileSize: 10, fileContent: "", category, extractedText: texte, scanVerdict,
  } as any);
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `KB statut ${stamp}`, slug: `kb-statut-${stamp}`, email: `kb-statut-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
}, 60_000);
afterAll(async () => { if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); });

describe("compte des documents utilisables par le standard", () => {
  it("organisation sans document : 0", async () => expect((await getKnowledgeStatus(orgId)).publicDocuments).toBe(0));
  it("des factures et contrats ne comptent pas", async () => {
    await doc("facture", "Facture 1200 EUR");
    await doc("contrat", "Contrat de sous-traitance");
    expect((await getKnowledgeStatus(orgId)).publicDocuments).toBe(0);
  });
  it("un document Public sans texte extrait ne compte pas (inutilisable)", async () => {
    await doc("public", null);
    expect((await getKnowledgeStatus(orgId)).publicDocuments).toBe(0);
  });
  it("un document Public juge dangereux ne compte pas", async () => {
    await doc("public", "Tarifs", "dangerous");
    expect((await getKnowledgeStatus(orgId)).publicDocuments).toBe(0);
  });
  it("un document Public lisible compte", async () => {
    await doc("public", "Tarifs 2026 : deplacement 60 EUR");
    expect((await getKnowledgeStatus(orgId)).publicDocuments).toBe(1);
  });
});

describe("ecran", () => {
  it("l'alerte s'affiche exactement quand le compte vaut 0", () => {
    expect(PAGE).toContain('{status?.publicDocuments === 0 && (');
    expect(PAGE).toContain('t("knowledgeBase.noPublicDocuments")');
  });
  it("l'alerte est annoncee aux lecteurs d'ecran", () => expect(PAGE).toMatch(/role="status"[^>]*>\s*\{t\("knowledgeBase\.noPublicDocuments"\)/));
  it("six langues", () => {
    for (const l of ["ar", "de", "en", "es", "fr", "tr"]) {
      const j = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "buro-ajani", "src", "i18n", "locales", `${l}.json`), "utf8"));
      expect(j.knowledgeBase.noPublicDocuments, l).toBeTruthy();
    }
  });
});
