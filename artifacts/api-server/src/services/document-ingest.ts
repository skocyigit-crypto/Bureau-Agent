import crypto from "crypto";
import { db, documentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  scanBase64Content,
  scanBase64ContentFullCached,
  logSecurityEvent,
  type StoredScanRecord,
} from "../middleware/security";
import { logger } from "../lib/logger";

/**
 * Helpers PARTAGES d'ingestion de documents. Centralise la creation d'un
 * enregistrement `documents` + son analyse antivirus en arriere-plan afin que
 * TOUT canal d'entree (upload UI, pieces jointes Gmail, import Drive, media
 * WhatsApp entrant, et tout futur canal) beneficie du meme scan sans dupliquer
 * la logique. Voir `ingestDocument` pour le point d'entree unique.
 */

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/tiff",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "application/rtf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/zip",
  "application/x-rar-compressed",
  "application/json",
  "application/xml", "text/xml",
];

export const EXTENSION_MIME_MAP: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json",
  ".xml": "application/xml",
  ".zip": "application/zip",
};

export const MAX_FILE_SIZE_MB = 25;

export const VALID_ENTITY_TYPES = [
  "contact", "task", "message", "invoice", "devis", "prospect", "project", "stock", "event", "general",
];

export function resolveMime(fileName: string, provided: string): string {
  if (ALLOWED_MIME_TYPES.includes(provided)) return provided;
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  return EXTENSION_MIME_MAP[ext] || provided;
}

/**
 * Recherche un verdict d'analyse "sain" deja persiste pour un fichier
 * identique (meme empreinte SHA-256) ailleurs dans la meme organisation.
 * Permet de reutiliser ce verdict au lieu de re-interroger le moteur externe
 * (VirusTotal) pour des octets deja juges propres. On ne remonte QUE des
 * verdicts surs : les empreintes dangereuses ou inconnues declenchent toujours
 * un scan complet via `scanBase64ContentFullCached`.
 */
export async function findReusableCleanScan(orgId: number, sha256: string): Promise<StoredScanRecord | null> {
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
 * Analyse antivirus complete d'un document deja insere, executee en
 * arriere-plan pour ne pas bloquer la reponse. Reutilise un verdict sain deja
 * persiste (meme empreinte SHA-256) puis met a jour
 * scanVerdict/scanEngine/scanDetail/scanSha256/scannedAt. Tout verdict
 * dangereux est journalise comme evenement de securite critique. Fail-soft : en
 * cas d'erreur le document reste "Non analyse" et le scan groupe peut le
 * rattraper.
 */
export async function scanDocumentInBackground(params: {
  docId: number;
  orgId: number;
  userId: number | null;
  fileContent: string;
  fileName: string;
  ip: string;
}): Promise<void> {
  const { docId, orgId, userId, fileContent, fileName, ip } = params;
  try {
    const sha256 = crypto.createHash("sha256").update(Buffer.from(fileContent, "base64")).digest("hex");
    const storedScan = await findReusableCleanScan(orgId, sha256);
    const { result: scanResult } = await scanBase64ContentFullCached(fileContent, fileName, storedScan);
    await db.update(documentsTable).set({
      scanVerdict: scanResult.safe ? "safe" : "dangerous",
      scanEngine: scanResult.engine || null,
      scanDetail: scanResult.engineDetail || null,
      scanSha256: scanResult.sha256 || null,
      scannedAt: new Date(scanResult.scannedAt),
      updatedAt: new Date(),
    }).where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));
    if (!scanResult.safe) {
      logSecurityEvent(
        "malicious_upload_detected",
        ip,
        userId,
        `Menace detectee dans un document televerse (#${docId}, ${scanResult.engine}): ${scanResult.threats.join(", ")}`,
        "critical",
      );
    }
  } catch (err: any) {
    logger.error({ err, docId }, "Background document scan failed");
  }
}

export type DocumentRow = typeof documentsTable.$inferSelect;

export interface IngestDocumentParams {
  orgId: number;
  userId: number | null;
  /** Contenu du fichier encode en base64. */
  fileContent: string;
  fileName: string;
  /** Type MIME annonce (sera resolu/valide via l'extension au besoin). */
  mimeType?: string;
  entityType?: string | null;
  entityId?: number | null;
  category?: string | null;
  description?: string | null;
  tags?: string[];
  /** Canal d'origine (ex: "upload", "gmail", "drive", "whatsapp"). */
  source?: string;
  ip?: string;
  /**
   * Declenche l'analyse antivirus complete en arriere-plan apres l'insert
   * (defaut: true). Mettre a false uniquement si l'appelant gere lui-meme le
   * scan du document insere.
   */
  triggerScan?: boolean;
}

export type IngestDocumentResult =
  | { status: "created"; doc: DocumentRow }
  | { status: "blocked"; threats: string[] }
  | { status: "rejected"; error: string };

/**
 * Point d'entree UNIQUE pour faire entrer un fichier dans la bibliotheque de
 * documents. Applique les memes garde-fous que l'upload UI :
 *  - validation type MIME + taille,
 *  - garde synchrone heuristique (bloque les menaces evidentes SANS stocker, et
 *    journalise un evenement de securite coherent avec l'upload),
 *  - insertion de l'enregistrement `documents`,
 *  - analyse antivirus complete en arriere-plan (persiste
 *    scanVerdict/scanEngine/scannedAt).
 *
 * Tout nouveau canal d'ingestion doit passer par ici pour heriter du scan.
 */
export async function ingestDocument(params: IngestDocumentParams): Promise<IngestDocumentResult> {
  const {
    orgId,
    userId,
    fileContent,
    fileName,
    mimeType: rawMime,
    entityType,
    entityId,
    category,
    description,
    tags,
    source,
    ip = "unknown",
    triggerScan = true,
  } = params;

  if (!fileContent || !fileName) {
    return { status: "rejected", error: "fileContent et fileName sont requis" };
  }

  const mimeType = resolveMime(fileName, rawMime || "application/octet-stream");
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return { status: "rejected", error: `Type de fichier non autorise: ${mimeType}` };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileContent, "base64");
  } catch {
    return { status: "rejected", error: "Encodage base64 invalide" };
  }
  if (buffer.length === 0) {
    return { status: "rejected", error: "Fichier vide" };
  }
  if (buffer.length > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return { status: "rejected", error: `Fichier trop volumineux. Maximum: ${MAX_FILE_SIZE_MB} Mo.` };
  }

  if (entityType && !VALID_ENTITY_TYPES.includes(entityType)) {
    return { status: "rejected", error: `Type d'entite invalide. Types valides: ${VALID_ENTITY_TYPES.join(", ")}` };
  }

  // Garde synchrone instantanee (heuristique locale, sans reseau): bloque les
  // menaces evidentes SANS les stocker. L'analyse antivirus complete tourne
  // ensuite en arriere-plan via scanDocumentInBackground.
  const heuristic = scanBase64Content(fileContent, fileName);
  if (!heuristic.safe) {
    logSecurityEvent(
      "malicious_upload_blocked",
      ip,
      userId,
      `Fichier entrant bloque${source ? ` (${source})` : ""} (${heuristic.engine}): ${heuristic.threats.join(", ")}`,
      "critical",
    );
    return { status: "blocked", threats: heuristic.threats };
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._\-\s()àâéèêëïîôùûüÿçÀÂÉÈÊËÏÎÔÙÛÜŸÇ]/g, "_");
  const storedName = `${Date.now()}_${safeName}`;

  const mergedTags = source ? Array.from(new Set([...(tags || []), `source:${source}`])) : (tags || []);

  const [doc] = await db.insert(documentsTable).values({
    organisationId: orgId,
    uploadedBy: userId,
    fileName: storedName,
    originalName: fileName,
    mimeType,
    fileSize: buffer.length,
    fileContent,
    entityType: entityType || null,
    entityId: entityId ?? null,
    category: category || "general",
    description: description || null,
    tags: mergedTags,
    status: "uploaded",
  }).returning();

  if (triggerScan) {
    void scanDocumentInBackground({ docId: doc.id, orgId, userId, fileContent, fileName, ip });
  }

  return { status: "created", doc };
}
