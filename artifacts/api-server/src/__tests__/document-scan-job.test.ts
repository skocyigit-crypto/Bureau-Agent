/**
 * Tâche #159 — l'arrêt d'un scan « Tout analyser » doit fonctionner à coup sûr.
 *
 * Le scan antivirus en lot tourne en arrière-plan côté serveur
 * (`document-scan-job.ts`). On a ajouté un bouton « Annuler » (web + mobile) qui
 * appelle un endpoint d'annulation ; le job doit alors s'arrêter promptement
 * SANS perdre les verdicts déjà calculés. Cette suite verrouille la mécanique
 * cœur pour éviter une régression silencieuse du problème « on ne peut pas
 * arrêter un scan long » :
 *
 *   - annuler en plein scan stoppe la boucle promptement (tous les documents ne
 *     sont PAS analysés) ;
 *   - le job passe en statut « cancelled » ;
 *   - les verdicts déjà calculés restent persistés (et les documents non encore
 *     traités gardent scanVerdict NULL) ;
 *   - un événement SSE terminal « cancelled » est diffusé ;
 *   - sans annulation, le job analyse tout et passe en « completed » (sanity).
 *
 * Le moteur antivirus (`scanBase64ContentFullCached`) est moqué pour rendre le
 * test déterministe : l'annulation est déclenchée DEPUIS le moteur moqué après
 * un nombre précis de scans, ce qui supprime toute dépendance au timing.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Moteur antivirus moqué : on contrôle le verdict ET le moment de l'annulation.
vi.mock("../middleware/security", () => ({
  scanBase64ContentFullCached: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

import crypto from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db, documentsTable, organisationsTable } from "@workspace/db";
import { scanBase64ContentFullCached } from "../middleware/security";
import { broadcaster } from "../services/broadcaster";
import {
  startBulkScan,
  getBulkScanStatus,
  cancelBulkScan,
} from "../services/document-scan-job";

const mockScan = vi.mocked(scanBase64ContentFullCached);

const stamp = Date.now();
let orgId: number;

/** Construit un verdict « sain » cohérent avec le contenu base64 fourni. */
function safeResult(base64: string) {
  const sha256 = crypto.createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
  return {
    result: {
      safe: true,
      threats: [] as string[],
      fileType: "text/plain",
      sha256,
      size: Buffer.from(base64, "base64").length,
      scannedAt: new Date().toISOString(),
      engine: "Heuristique",
      engineDetail: undefined,
    },
    reused: false,
  };
}

/** Insère N documents jamais scannés (scanVerdict NULL) dans l'org de test. */
async function seedUnscanned(count: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const content = Buffer.from(`doc-${stamp}-${i}-${Math.random()}`, "utf-8").toString("base64");
    const [row] = await db.insert(documentsTable).values({
      organisationId: orgId,
      fileName: `f${i}.txt`,
      originalName: `f${i}.txt`,
      mimeType: "text/plain",
      fileSize: 32,
      fileContent: content,
      scanVerdict: null,
    }).returning({ id: documentsTable.id });
    ids.push(row.id);
  }
  return ids;
}

/** Attend la fin du job (statut ≠ "running"), avec borne dure anti-blocage. */
async function waitForTerminal(): Promise<ReturnType<typeof getBulkScanStatus>> {
  for (let i = 0; i < 300; i++) {
    const s = getBulkScanStatus(orgId);
    if (s.status !== "running") return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Le job de scan n'est jamais arrivé à un état terminal");
}

beforeAll(async () => {
  const [org] = await db.insert(organisationsTable).values({
    name: `Scan Job Test Org ${stamp}`,
    slug: `scan-job-test-${stamp}`,
    maxUsers: 5,
    actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = org.id;
});

afterAll(async () => {
  try {
    await db.delete(documentsTable).where(eq(documentsTable.organisationId, orgId));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [orgId]));
  } catch {
    // best-effort: les ids sont uniques par run grâce à `stamp`.
  }
});

beforeEach(async () => {
  // Repart d'une ardoise propre : aucun document, aucun verdict résiduel.
  await db.delete(documentsTable).where(eq(documentsTable.organisationId, orgId));
  mockScan.mockReset();
});

describe("document-scan-job — annulation du scan en lot", () => {
  it("annuler en plein scan arrête la boucle promptement et passe en 'cancelled'", async () => {
    const ids = await seedUnscanned(6);
    const broadcastSpy = vi.spyOn(broadcaster, "broadcast");

    // L'annulation est demandée DEPUIS le moteur, juste après le 2e scan : la
    // boucle doit alors s'arrêter avant de traiter les documents restants.
    let scans = 0;
    mockScan.mockImplementation(async (content: string) => {
      scans++;
      if (scans === 2) cancelBulkScan(orgId);
      return safeResult(content) as any;
    });

    startBulkScan(orgId, null);
    const terminal = await waitForTerminal();

    // Arrêt prompt : tous les documents n'ont PAS été analysés.
    expect(terminal.status).toBe("cancelled");
    expect(terminal.scanned).toBe(2);
    expect(terminal.scanned).toBeLessThan(terminal.total);
    expect(mockScan).toHaveBeenCalledTimes(2);

    // Les 2 premiers documents gardent leur verdict ; les autres restent NULL.
    const rows = await db.select({
      id: documentsTable.id,
      scanVerdict: documentsTable.scanVerdict,
    }).from(documentsTable)
      .where(eq(documentsTable.organisationId, orgId))
      .orderBy(documentsTable.id);
    const persisted = rows.filter((r) => r.scanVerdict === "safe");
    const remaining = rows.filter((r) => r.scanVerdict === null);
    expect(persisted).toHaveLength(2);
    expect(remaining).toHaveLength(4);
    // Les verdicts persistés correspondent bien aux 2 premiers documents.
    expect(persisted.map((r) => r.id)).toEqual(ids.slice(0, 2));

    // `remaining` du job reflète les documents non analysés.
    expect(terminal.remaining).toBe(4);

    // Un événement SSE terminal "cancelled" (source bulk-scan) est diffusé.
    const terminalEvent = broadcastSpy.mock.calls.find(([broadcastOrg, evt]) => {
      const meta = (evt as any)?.meta;
      return broadcastOrg === orgId && meta?.source === "bulk-scan" && meta?.status === "cancelled";
    });
    expect(terminalEvent).toBeDefined();

    broadcastSpy.mockRestore();
  });

  it("conserve les verdicts déjà calculés après annulation (rien n'est perdu)", async () => {
    await seedUnscanned(5);

    let scans = 0;
    mockScan.mockImplementation(async (content: string) => {
      scans++;
      if (scans === 3) cancelBulkScan(orgId);
      return safeResult(content) as any;
    });

    startBulkScan(orgId, null);
    const terminal = await waitForTerminal();

    expect(terminal.status).toBe("cancelled");
    // 3 verdicts calculés et persistés malgré l'annulation ; rien n'est perdu.
    const rows = await db.select({ v: documentsTable.scanVerdict })
      .from(documentsTable)
      .where(eq(documentsTable.organisationId, orgId));
    const safeRows = rows.filter((r) => r.v === "safe");
    expect(rows.length).toBe(5);
    expect(safeRows.length).toBe(3);
    expect(terminal.scanned).toBe(3);
  });

  it("sans annulation, le job analyse tout et passe en 'completed' (sanity)", async () => {
    await seedUnscanned(4);

    mockScan.mockImplementation(async (content: string) => safeResult(content) as any);

    startBulkScan(orgId, null);
    const terminal = await waitForTerminal();

    expect(terminal.status).toBe("completed");
    expect(terminal.scanned).toBe(4);
    expect(terminal.safe).toBe(4);
    expect(terminal.remaining).toBe(0);

    const remaining = (await db.select({ v: documentsTable.scanVerdict })
      .from(documentsTable)
      .where(eq(documentsTable.organisationId, orgId)))
      .filter((r) => r.v === null);
    expect(remaining).toHaveLength(0);
  });
});
