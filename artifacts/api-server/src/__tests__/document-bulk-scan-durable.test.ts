/**
 * Tâche #170 — un scan « Tout analyser » arrêté doit le RESTER, même après un
 * redémarrage serveur ou s'il est repris par une autre instance.
 *
 * Le scan antivirus en lot (`/api/documents/bulk/scan`) persiste son état dans la
 * table partagée `bulk_scan_jobs` afin de survivre à un redémarrage et de tourner
 * sur plusieurs instances API. La source de vérité est la ligne DB ; l'état
 * vivant en mémoire (emitter/abortController) n'est qu'un cache local de
 * l'instance porteuse. Cette suite verrouille le chemin DURABLE — celui qui n'a
 * aujourd'hui aucune couverture — pour empêcher la régression la plus dangereuse :
 * qu'un scan « annulé » reprenne silencieusement.
 *
 * On exerce directement les helpers DB de `routes/documents.ts` (acquisition
 * atomique du slot, écriture d'état, détection d'arrêt, réconciliation des jobs
 * orphelins) plus l'endpoint d'annulation, en simulant plusieurs « runners »
 * (instances) et un redémarrage (état mémoire perdu, ligne DB conservée).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { EventEmitter } from "events";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { db, bulkScanJobsTable, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";
import {
  acquireBulkScanSlot,
  persistBulkScanJob,
  shouldStopBulkScan,
  reconcileStaleBulkScan,
  getActiveBulkScan,
  loadBulkScanSnapshot,
  BULK_SCAN_STALE_MS,
  type BulkScanJobState,
} from "../routes/documents";

const stamp = Date.now();
const CANCEL_URL = "/api/documents/bulk/scan/cancel";

let orgId: number;
let agentId: number;
let agentToken: string;

/**
 * Fabrique un état de job pour un « runner » donné (= une instance API). Chaque
 * runner a son propre jeton d'appartenance (`runnerId`) : c'est lui qui
 * distingue « mon job » de « le job d'une autre instance ».
 */
function makeJob(runnerId: string, overrides: Partial<BulkScanJobState> = {}): BulkScanJobState {
  return {
    status: "running",
    runnerId,
    startedAt: Date.now(),
    startedByUserId: agentId,
    requested: 3,
    total: 3,
    completed: 0,
    safe: 0,
    dangerous: 0,
    reused: 0,
    failed: 0,
    results: [],
    events: [],
    emitter: new EventEmitter(),
    abortController: new AbortController(),
    ...overrides,
  };
}

/** Lit la ligne durable du job pour l'org de test (ou undefined). */
async function readRow() {
  const [row] = await db.select().from(bulkScanJobsTable)
    .where(eq(bulkScanJobsTable.organisationId, orgId)).limit(1);
  return row;
}

/** Force le heartbeat (`updated_at`) d'une ligne dans le passé pour la périmer. */
async function ageHeartbeat(ms: number) {
  await db.update(bulkScanJobsTable)
    .set({ updatedAt: new Date(Date.now() - ms) })
    .where(eq(bulkScanJobsTable.organisationId, orgId));
}

beforeAll(async () => {
  const [org] = await db.insert(organisationsTable).values({
    name: `Bulk Scan Durable Org ${stamp}`,
    slug: `bulk-scan-durable-${stamp}`,
    maxUsers: 5,
    actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = org.id;

  const [agent] = await db.insert(usersTable).values({
    email: `bulkdurable-agent-${stamp}@example.test`,
    passwordHash: "x",
    nom: "Agent",
    prenom: "Test",
    role: "agent",
    organisationId: orgId,
    actif: true,
  }).returning({ id: usersTable.id });
  agentId = agent.id;

  agentToken = mintApiToken({
    userId: agentId,
    userRole: "agent",
    organisationId: orgId,
    userEmail: `bulkdurable-agent-${stamp}@example.test`,
    prenom: "Agent",
    nom: "Test",
  });
});

afterAll(async () => {
  try {
    await db.delete(bulkScanJobsTable).where(eq(bulkScanJobsTable.organisationId, orgId));
    await db.delete(usersTable).where(inArray(usersTable.id, [agentId]));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [orgId]));
  } catch {
    // best-effort : ids uniques par run via `stamp`.
  }
});

beforeEach(async () => {
  // Repart d'une ardoise propre : aucune ligne de job résiduelle.
  await db.delete(bulkScanJobsTable).where(eq(bulkScanJobsTable.organisationId, orgId));
});

describe("bulk_scan_jobs — acquisition atomique du slot", () => {
  it("le premier runner gagne le slot ; un second runner frais est refusé", async () => {
    const r1 = makeJob("runner-A");
    const r2 = makeJob("runner-B");

    // Premier acquéreur : gagne (INSERT).
    expect(await acquireBulkScanSlot(orgId, r1)).toBe(true);

    // Un second runner ne peut PAS voler un slot dont le job est frais (running,
    // heartbeat récent) : l'acquisition atomique échoue.
    expect(await acquireBulkScanSlot(orgId, r2)).toBe(false);

    const row = await readRow();
    expect(row.status).toBe("running");
    expect(row.runnerId).toBe("runner-A");
  });

  it("le slot est réacquérable une fois le job précédent terminal", async () => {
    const r1 = makeJob("runner-A");
    expect(await acquireBulkScanSlot(orgId, r1)).toBe(true);

    // Job terminé : on fige l'état terminal partagé.
    r1.status = "completed";
    r1.finishedAt = Date.now();
    await persistBulkScanJob(orgId, r1, { terminal: true });

    // Un nouveau scan (autre runner) peut reprendre le slot (ON CONFLICT DO
    // UPDATE car statut non-running).
    const r2 = makeJob("runner-B");
    expect(await acquireBulkScanSlot(orgId, r2)).toBe(true);

    const row = await readRow();
    expect(row.status).toBe("running");
    expect(row.runnerId).toBe("runner-B");
  });
});

describe("bulk_scan_jobs — écriture d'état conditionnée à l'appartenance", () => {
  it("persistBulkScanJob terminal fige le statut final de l'org", async () => {
    const job = makeJob("runner-A");
    expect(await acquireBulkScanSlot(orgId, job)).toBe(true);

    job.status = "completed";
    job.completed = 3;
    job.safe = 3;
    job.finishedAt = Date.now();
    await persistBulkScanJob(orgId, job, { terminal: true });

    const row = await readRow();
    expect(row.status).toBe("completed");
    expect(row.completed).toBe(3);
    expect(row.safe).toBe(3);
    expect(row.finishedAt).not.toBeNull();
  });

  it("une écriture de progression n'a aucun effet une fois le job annulé (pas de réanimation)", async () => {
    const job = makeJob("runner-A");
    expect(await acquireBulkScanSlot(orgId, job)).toBe(true);

    // Le job est annulé dans la table partagée (par une autre instance / endpoint).
    await db.update(bulkScanJobsTable)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(bulkScanJobsTable.organisationId, orgId));

    // Le worker, pas encore au courant, tente une écriture de PROGRESSION
    // (non terminale). Elle est conditionnée à `status = 'running'` : 0 ligne
    // touchée → le job annulé n'est PAS ressuscité.
    job.completed = 1;
    job.safe = 1;
    await persistBulkScanJob(orgId, job);

    const row = await readRow();
    expect(row.status).toBe("cancelled");
    expect(row.completed).toBe(0);
  });

  it("un runner ayant perdu l'appartenance n'écrase pas l'état du nouveau runner", async () => {
    // Runner-A détient le job, puis devient orphelin (heartbeat périmé).
    const a = makeJob("runner-A");
    expect(await acquireBulkScanSlot(orgId, a)).toBe(true);
    await ageHeartbeat(BULK_SCAN_STALE_MS + 5000);

    // Runner-B reprend le slot orphelin.
    const b = makeJob("runner-B", { requested: 9, total: 9 });
    expect(await acquireBulkScanSlot(orgId, b)).toBe(true);

    // Runner-A « revient » et tente une écriture terminale : conditionnée à SON
    // runnerId, elle ne touche aucune ligne (B est désormais propriétaire).
    a.status = "completed";
    a.finishedAt = Date.now();
    await persistBulkScanJob(orgId, a, { terminal: true });

    const row = await readRow();
    expect(row.runnerId).toBe("runner-B");
    expect(row.status).toBe("running");
    expect(row.total).toBe(9);
  });
});

describe("bulk_scan_jobs — reprise d'un job orphelin par une autre instance", () => {
  it("acquireBulkScanSlot reprend un job 'running' au heartbeat périmé", async () => {
    const dead = makeJob("runner-dead");
    expect(await acquireBulkScanSlot(orgId, dead)).toBe(true);

    // Le processus porteur meurt en plein scan : son heartbeat se périme.
    await ageHeartbeat(BULK_SCAN_STALE_MS + 5000);

    // Une autre instance peut reprendre le slot (le SET ON CONFLICT s'applique
    // car le heartbeat est périmé même si le statut est encore 'running').
    const fresh = makeJob("runner-fresh");
    expect(await acquireBulkScanSlot(orgId, fresh)).toBe(true);

    const row = await readRow();
    expect(row.runnerId).toBe("runner-fresh");

    // Le runner mort détecte la perte d'appartenance et doit s'arrêter.
    expect(await shouldStopBulkScan(orgId, dead)).toBe(true);
    // Le nouveau runner, lui, garde la main.
    expect(await shouldStopBulkScan(orgId, fresh)).toBe(false);
  });

  it("reconcileStaleBulkScan passe un job orphelin en 'interrupted' (réconciliable)", async () => {
    const dead = makeJob("runner-dead");
    expect(await acquireBulkScanSlot(orgId, dead)).toBe(true);
    await ageHeartbeat(BULK_SCAN_STALE_MS + 5000);

    // getActiveBulkScan : un job au heartbeat périmé n'est PAS considéré actif
    // et est réconcilié en 'interrupted' au passage.
    expect(await getActiveBulkScan(orgId)).toBeNull();
    expect((await readRow()).status).toBe("interrupted");

    // Idempotent / direct : reconcileStaleBulkScan ne ranime rien.
    await reconcileStaleBulkScan(orgId);
    expect((await readRow()).status).toBe("interrupted");
  });

  it("loadBulkScanSnapshot reflète l'interruption d'un job orphelin après redémarrage", async () => {
    const dead = makeJob("runner-dead");
    expect(await acquireBulkScanSlot(orgId, dead)).toBe(true);
    await ageHeartbeat(BULK_SCAN_STALE_MS + 5000);

    // Après un redémarrage, l'instance n'a PAS d'état local : le snapshot lit la
    // ligne durable et réconcilie le job orphelin en 'interrupted'.
    const snap = await loadBulkScanSnapshot(orgId);
    expect(snap?.status).toBe("interrupted");
    expect((await readRow()).status).toBe("interrupted");
  });
});

describe("bulk_scan_jobs — l'annulation survit à un redémarrage serveur", () => {
  it("annuler après un redémarrage (état mémoire perdu) arrête le worker pour de bon", async () => {
    // 1) Un scan a démarré AVANT le redémarrage : seule la ligne durable subsiste.
    //    On simule un job FRAIS (heartbeat récent) sans aucun état en mémoire —
    //    exactement l'état d'un serveur qui vient de redémarrer pendant un scan.
    const preRestart = makeJob("runner-pre-restart");
    expect(await acquireBulkScanSlot(orgId, preRestart)).toBe(true);

    // Sanity : avant l'annulation, le worker ne devrait PAS s'arrêter.
    expect(await shouldStopBulkScan(orgId, preRestart)).toBe(false);

    // 2) L'utilisateur clique « Annuler ». Comme l'instance n'a aucun job local
    //    (mémoire perdue au redémarrage), l'endpoint passe la ligne durable à
    //    'cancelled' pour que l'instance porteuse s'arrête.
    const res = await request(app)
      .post(CANCEL_URL)
      .set("Authorization", `Bearer ${agentToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelling");

    // 3) La ligne durable est bien 'cancelled' et figée (finishedAt).
    const row = await readRow();
    expect(row.status).toBe("cancelled");
    expect(row.finishedAt).not.toBeNull();

    // 4) Le worker d'origine, en relisant l'état partagé, DOIT s'arrêter : un scan
    //    annulé ne reprend jamais silencieusement.
    expect(await shouldStopBulkScan(orgId, preRestart)).toBe(true);

    // 5) Le statut exposé reste 'cancelled' (pas de reprise fantôme).
    const snap = await loadBulkScanSnapshot(orgId);
    expect(snap?.status).toBe("cancelled");
  });

  it("le worker s'arrête aussi si la ligne durable a disparu (org purgée)", async () => {
    const job = makeJob("runner-A");
    expect(await acquireBulkScanSlot(orgId, job)).toBe(true);

    // La ligne est supprimée (purge, suppression d'org, etc.).
    await db.delete(bulkScanJobsTable)
      .where(and(
        eq(bulkScanJobsTable.organisationId, orgId),
        eq(bulkScanJobsTable.runnerId, "runner-A"),
      ));

    // Plus de ligne → le worker doit s'arrêter (ne pas continuer dans le vide).
    expect(await shouldStopBulkScan(orgId, job)).toBe(true);
  });

  it("le endpoint d'annulation est un no-op idempotent quand aucun scan ne tourne", async () => {
    // Aucune ligne de job : « Annuler » ne doit pas planter et renvoyer 'idle'.
    const res = await request(app)
      .post(CANCEL_URL)
      .set("Authorization", `Bearer ${agentToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("idle");
  });
});
