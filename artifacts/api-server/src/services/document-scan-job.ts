import { db, documentsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";
import { scanBase64ContentFullCached, logSecurityEvent, type StoredScanRecord } from "../middleware/security";
import { broadcaster } from "./broadcaster";
import { logger } from "../lib/logger";

/**
 * Recherche un verdict "sain" deja persiste pour un fichier identique (meme
 * empreinte SHA-256) dans la meme organisation, afin de reutiliser ce verdict
 * au lieu de re-interroger le moteur externe. On ne remonte QUE des verdicts
 * surs ; toute empreinte dangereuse ou inconnue est rescannee integralement.
 */
async function findReusableCleanScan(orgId: number, sha256: string): Promise<StoredScanRecord | null> {
  if (!sha256) return null;
  const [existing] = await db.select({
    scanSha256: documentsTable.scanSha256,
    scanVerdict: documentsTable.scanVerdict,
    scanEngine: documentsTable.scanEngine,
    scanDetail: documentsTable.scanDetail,
    scannedAt: documentsTable.scannedAt,
  }).from(documentsTable)
    .where(and(
      eq(documentsTable.organisationId, orgId),
      eq(documentsTable.scanSha256, sha256),
      eq(documentsTable.scanVerdict, "safe"),
    ))
    .limit(1);
  if (!existing) return null;
  return {
    sha256: existing.scanSha256,
    verdict: existing.scanVerdict,
    engine: existing.scanEngine,
    detail: existing.scanDetail,
    scannedAt: existing.scannedAt,
  };
}

/**
 * Etat d'un scan antivirus "Tout analyser" lance en arriere-plan pour une
 * organisation. Le travail tourne cote serveur : le client n'a plus besoin de
 * boucler des requetes. La progression est diffusee via SSE (canal temps reel)
 * ET interrogeable via un endpoint de statut, afin que l'UI reste a jour meme
 * apres une navigation ou un rechargement.
 */
export interface BulkScanStatus {
  status: "running" | "completed" | "failed" | "cancelled" | "idle";
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  scanned: number;
  safe: number;
  dangerous: number;
  reused: number;
  failed: number;
  remaining: number;
  error: string | null;
}

interface BulkScanJob extends BulkScanStatus {
  cleanupTimer?: NodeJS.Timeout;
  cancelRequested?: boolean;
}

const jobs = new Map<number, BulkScanJob>();
const JOB_RETENTION_MS = 5 * 60 * 1000;
const SCAN_BATCH_SIZE = 10;

const IDLE_STATUS: BulkScanStatus = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  total: 0,
  scanned: 0,
  safe: 0,
  dangerous: 0,
  reused: 0,
  failed: 0,
  remaining: 0,
  error: null,
};

function toStatus(job: BulkScanJob): BulkScanStatus {
  return {
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    total: job.total,
    scanned: job.scanned,
    safe: job.safe,
    dangerous: job.dangerous,
    reused: job.reused,
    failed: job.failed,
    remaining: job.remaining,
    error: job.error,
  };
}

function broadcastProgress(orgId: number, job: BulkScanJob): void {
  broadcaster.broadcast(orgId, {
    type: "security",
    action: "updated",
    meta: { source: "bulk-scan", ...toStatus(job) },
  });
}

function scheduleCleanup(orgId: number, job: BulkScanJob): void {
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  job.cleanupTimer = setTimeout(() => {
    if (jobs.get(orgId) === job) jobs.delete(orgId);
  }, JOB_RETENTION_MS);
  job.cleanupTimer.unref?.();
}

async function countRemaining(orgId: number): Promise<number> {
  const [row] = await db.select({
    remaining: sql<number>`count(*) FILTER (WHERE ${documentsTable.scanVerdict} IS NULL AND ${documentsTable.fileContent} IS NOT NULL)::int`,
  }).from(documentsTable).where(eq(documentsTable.organisationId, orgId));
  return row?.remaining ?? 0;
}

async function runJob(orgId: number, userId: number | null, job: BulkScanJob): Promise<void> {
  try {
    job.total = await countRemaining(orgId);
    job.remaining = job.total;
    broadcastProgress(orgId, job);

    // Boucle par lots cote serveur jusqu'a epuisement des documents non analyses.
    // On relit a chaque tour les documents encore "scanVerdict IS NULL", ce qui
    // gere aussi les uploads survenus pendant le scan.
    for (;;) {
      if (job.cancelRequested) break;
      const docs = await db.select({
        id: documentsTable.id,
        fileContent: documentsTable.fileContent,
        originalName: documentsTable.originalName,
      }).from(documentsTable)
        .where(and(
          eq(documentsTable.organisationId, orgId),
          sql`${documentsTable.scanVerdict} IS NULL`,
          sql`${documentsTable.fileContent} IS NOT NULL`,
        ))
        .orderBy(documentsTable.id)
        .limit(SCAN_BATCH_SIZE);

      if (docs.length === 0) break;

      for (const doc of docs) {
        if (job.cancelRequested) break;
        if (!doc.fileContent) continue;
        try {
          const sha256 = crypto.createHash("sha256").update(Buffer.from(doc.fileContent, "base64")).digest("hex");
          const storedScan = await findReusableCleanScan(orgId, sha256);
          const { result: scanResult, reused } = await scanBase64ContentFullCached(doc.fileContent, doc.originalName, storedScan);
          if (reused) job.reused++;
          const verdict = scanResult.safe ? "safe" : "dangerous";
          await db.update(documentsTable).set({
            scanVerdict: verdict,
            scanEngine: scanResult.engine || null,
            scanDetail: scanResult.engineDetail || null,
            scanSha256: scanResult.sha256 || null,
            scannedAt: new Date(scanResult.scannedAt),
            updatedAt: new Date(),
          }).where(eq(documentsTable.id, doc.id));
          job.scanned++;
          if (scanResult.safe) {
            job.safe++;
          } else {
            job.dangerous++;
            logSecurityEvent(
              "malicious_file_detected",
              "background-job",
              userId,
              `Analyse en lot du document #${doc.id} (${scanResult.engine}): ${scanResult.threats.join(", ")}`,
              "critical",
            );
          }
        } catch (scanErr: any) {
          job.failed++;
          logger.error({ scanErr, docId: doc.id }, "Bulk scan job: document scan failed");
        }
        job.remaining = Math.max(0, job.total - job.scanned - job.failed);
        broadcastProgress(orgId, job);
      }
    }

    job.remaining = await countRemaining(orgId);
    job.status = job.cancelRequested ? "cancelled" : "completed";
    job.finishedAt = Date.now();
    broadcastProgress(orgId, job);
    logger.info({ orgId, scanned: job.scanned, safe: job.safe, dangerous: job.dangerous, reused: job.reused, failed: job.failed, cancelled: job.cancelRequested ?? false }, "Bulk document scan job finished");
  } catch (err: any) {
    job.status = "failed";
    job.error = "Erreur lors de l'analyse antivirus en lot";
    job.finishedAt = Date.now();
    broadcastProgress(orgId, job);
    logger.error({ err, orgId }, "Bulk document scan job error");
  } finally {
    scheduleCleanup(orgId, job);
  }
}

/**
 * Demarre un scan en arriere-plan pour l'organisation. Idempotent : si un scan
 * tourne deja, on renvoie son statut sans en lancer un second. Retourne
 * immediatement (le travail continue en tache de fond).
 */
export function startBulkScan(orgId: number, userId: number | null): BulkScanStatus {
  const existing = jobs.get(orgId);
  if (existing && existing.status === "running") {
    return toStatus(existing);
  }

  const job: BulkScanJob = {
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    total: 0,
    scanned: 0,
    safe: 0,
    dangerous: 0,
    reused: 0,
    failed: 0,
    remaining: 0,
    error: null,
  };
  jobs.set(orgId, job);

  // Lance sans attendre : la requete HTTP rend la main immediatement.
  void runJob(orgId, userId, job);

  return toStatus(job);
}

/** Renvoie le statut courant (ou un statut "idle" si aucun scan recent). */
export function getBulkScanStatus(orgId: number): BulkScanStatus {
  const job = jobs.get(orgId);
  if (!job) return { ...IDLE_STATUS };
  return toStatus(job);
}

/**
 * Demande l'arret du scan en arriere-plan pour l'organisation. Le drapeau est
 * verifie entre chaque document/lot : la boucle s'arrete promptement et le job
 * passe en "cancelled", en conservant les verdicts deja calcules.
 */
export function cancelBulkScan(orgId: number): BulkScanStatus {
  const job = jobs.get(orgId);
  if (!job || job.status !== "running") return getBulkScanStatus(orgId);
  job.cancelRequested = true;
  return toStatus(job);
}
