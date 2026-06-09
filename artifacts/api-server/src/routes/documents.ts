import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import multer from "multer";
import { db, documentsTable, bulkScanJobsTable, organisationsTable } from "@workspace/db";
import { eq, and, or, ne, lt, desc, sql, inArray } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { getOrgId } from "../middleware/tenant";
import { scanBase64ContentFull, scanBase64ContentFullCached, logSecurityEvent, type StoredScanRecord } from "../middleware/security";
import { logger } from "../lib/logger";
import { analyzeDocument, processDocumentForImport, importRowsToModule, analyzeDocumentMultiModel, askDocumentQuestion } from "../services/document-ai";
import { emitSecurityAlert } from "../services/security-alerts";
import {
  recordDocumentThreatSuggestion,
  shouldNotifyDocumentThreat,
  broadcastDocumentThreatNotification,
} from "../services/proactive-engine";
import { openSseStream } from "../services/ai-stream";
import { ingestDocument, resolveMime, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_MB, findReusableCleanScan } from "../services/document-ingest";
import { EventEmitter } from "events";
import { startBulkScan, getBulkScanStatus, cancelBulkScan } from "../services/document-scan-job";

const router = Router();
const requireMinAgent = requireRole("super_admin", "administrateur", "agent");

// Téléversement en flux (multipart) pour le mobile: le fichier est streamé
// depuis le disque côté client (expo `uploadAsync`) et reçu ici en mémoire
// serveur, évitant la double copie base64 (base64 ~+33% + copie JSON.stringify)
// dans le tas JS du téléphone — cause de pics mémoire sur les gros fichiers.
// La couche stockage/scan reste en base64: on convertit le buffer UNE fois ici.
// multer est un no-op pour les requêtes JSON: la compat web (base64) est intacte.
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (MAX_FILE_SIZE_MB + 1) * 1024 * 1024 },
});

function handleUploadStream(req: Request, res: Response, next: (err?: unknown) => void): void {
  uploadMem.single("file")(req, res, (err: unknown) => {
    if (err) {
      const code = (err as { code?: string })?.code;
      const msg = code === "LIMIT_FILE_SIZE"
        ? `Fichier trop volumineux (max ${MAX_FILE_SIZE_MB} Mo).`
        : "Téléversement invalide.";
      res.status(400).json({ error: msg });
      return;
    }
    next();
  });
}

router.post("/documents/upload", requireMinAgent, handleUploadStream, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId;

    // Deux transports supportés sur le même endpoint:
    //  - multipart/form-data (mobile): fichier dans `req.file`, méta en champs texte.
    //  - application/json (web legacy): base64 dans `req.body.fileContent`.
    const uploadedFile = req.file;
    const fileContent = uploadedFile
      ? uploadedFile.buffer.toString("base64")
      : req.body.fileContent;
    const fileName = uploadedFile
      ? (req.body.fileName || req.body.filename || uploadedFile.originalname)
      : (req.body.fileName || req.body.filename);
    const rawMime = uploadedFile
      ? (req.body.mimeType || uploadedFile.mimetype)
      : req.body.mimeType;
    const { entityType, entityId, category, description } = req.body;
    let tags = req.body.tags;
    if (typeof tags === "string") {
      // multipart transmet les tags en JSON array OU en CSV. On normalise
      // TOUJOURS vers string[]: un JSON non-array (objet/scalaire) ne doit pas
      // atteindre `ingestDocument` (qui fait `[...tags]` et planterait -> 500).
      let parsed: unknown;
      try { parsed = JSON.parse(tags); } catch { parsed = undefined; }
      tags = Array.isArray(parsed)
        ? parsed.map((t) => String(t).trim()).filter(Boolean)
        : tags.split(",").map((t: string) => t.trim()).filter(Boolean);
    }
    const analyzeWithAi = req.body.analyzeWithAi === true || req.body.analyzeWithAi === "true";

    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket?.remoteAddress || "unknown";

    // Ingestion partagee: validation (type/taille/entite), garde synchrone
    // heuristique (bloque les menaces evidentes), insertion, puis analyse
    // antivirus complete en arriere-plan. Identique a tous les autres canaux.
    const ingest = await ingestDocument({
      orgId,
      userId: userId ?? null,
      fileContent,
      fileName,
      mimeType: rawMime,
      entityType,
      entityId: entityId ? parseInt(String(entityId)) : null,
      category,
      description,
      tags,
      source: "upload",
      ip,
    });

    if (ingest.status === "blocked") {
      res.status(400).json({ error: "Fichier bloque pour raisons de securite.", threats: ingest.threats });
      return;
    }
    if (ingest.status === "rejected") {
      res.status(400).json({ error: ingest.error });
      return;
    }

    const doc = ingest.doc;
    const mimeType = doc.mimeType;

    let aiResult = null;
    if (analyzeWithAi) {
      try {
        aiResult = await analyzeDocument(fileContent, mimeType, fileName, orgId);
        await db.update(documentsTable).set({
          aiProcessed: true,
          aiAnalysis: aiResult as any,
          extractedText: aiResult.summary,
          extractedData: aiResult.extractedFields as any,
          status: "analyzed",
          updatedAt: new Date(),
        }).where(eq(documentsTable.id, doc.id));
      } catch (err: any) {
        logger.warn({ err, docId: doc.id }, "AI analysis failed for uploaded document");
      }
    }

    res.json({
      success: true,
      document: {
        id: doc.id,
        fileName: doc.originalName,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        entityType: doc.entityType,
        entityId: doc.entityId,
        category: doc.category,
        status: aiResult ? "analyzed" : "uploaded",
        createdAt: doc.createdAt,
      },
      aiAnalysis: aiResult || null,
    });
  } catch (err: any) {
    logger.error({ err }, "Document upload error");
    res.status(500).json({ error: "Erreur lors du telechargement du document" });
  }
});

router.post("/documents/upload-multiple", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId;
    const { files, entityType, entityId, category } = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: "Un tableau de fichiers est requis" });
      return;
    }

    if (files.length > 20) {
      res.status(400).json({ error: "Maximum 20 fichiers par lot" });
      return;
    }

    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket?.remoteAddress || "unknown";

    const results: any[] = [];
    for (const file of files) {
      try {
        // Ingestion partagee (validation + garde heuristique + insert + scan
        // en arriere-plan), identique a l'upload unitaire et aux autres canaux.
        const ingest = await ingestDocument({
          orgId,
          userId: userId ?? null,
          fileContent: file.fileContent,
          fileName: file.fileName,
          mimeType: file.mimeType,
          entityType: entityType || file.entityType || null,
          entityId: entityId ? parseInt(String(entityId)) : (file.entityId ? parseInt(String(file.entityId)) : null),
          category: category || file.category || null,
          description: file.description || null,
          tags: file.tags,
          source: "upload",
          ip,
        });

        if (ingest.status === "blocked") {
          results.push({ fileName: file.fileName, success: false, error: "Fichier bloque (securite)" });
          continue;
        }
        if (ingest.status === "rejected") {
          results.push({ fileName: file.fileName || "inconnu", success: false, error: ingest.error });
          continue;
        }

        results.push({ fileName: file.fileName, success: true, documentId: ingest.doc.id, fileSize: ingest.doc.fileSize });
      } catch (err: any) {
        results.push({ fileName: file.fileName || "inconnu", success: false, error: err.message });
      }
    }

    res.json({
      success: true,
      total: files.length,
      uploaded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  } catch (err: any) {
    logger.error({ err }, "Multi-upload error");
    res.status(500).json({ error: "Erreur lors du telechargement multiple" });
  }
});

router.get("/documents/list", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const entityType = req.query.entityType ? String(req.query.entityType) : undefined;
    const entityId = req.query.entityId ? parseInt(String(req.query.entityId)) : undefined;
    const category = req.query.category ? String(req.query.category) : undefined;
    const scanVerdict = req.query.scanVerdict ? String(req.query.scanVerdict) : undefined;
    const limitRaw = parseInt(String(req.query.limit || "50"));
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);
    const offsetRaw = parseInt(String(req.query.offset || "0"));
    const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);

    const conditions: any[] = [eq(documentsTable.organisationId, orgId)];
    if (entityType) conditions.push(eq(documentsTable.entityType, entityType));
    if (entityId && !isNaN(entityId)) conditions.push(eq(documentsTable.entityId, entityId));
    if (category) conditions.push(eq(documentsTable.category, category));
    if (scanVerdict) {
      if (scanVerdict === "none") conditions.push(sql`${documentsTable.scanVerdict} IS NULL`);
      else conditions.push(eq(documentsTable.scanVerdict, scanVerdict));
    }

    const [docs, countResult] = await Promise.all([
      db.select({
        id: documentsTable.id,
        fileName: documentsTable.originalName,
        mimeType: documentsTable.mimeType,
        fileSize: documentsTable.fileSize,
        entityType: documentsTable.entityType,
        entityId: documentsTable.entityId,
        category: documentsTable.category,
        description: documentsTable.description,
        tags: documentsTable.tags,
        aiProcessed: documentsTable.aiProcessed,
        status: documentsTable.status,
        scanVerdict: documentsTable.scanVerdict,
        scanEngine: documentsTable.scanEngine,
        scanDetail: documentsTable.scanDetail,
        scannedAt: documentsTable.scannedAt,
        uploadedBy: documentsTable.uploadedBy,
        createdAt: documentsTable.createdAt,
      }).from(documentsTable)
        .where(and(...conditions))
        .orderBy(desc(documentsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(documentsTable).where(and(...conditions)),
    ]);

    res.json({
      documents: docs.map(d => ({
        ...d,
        fileSizeFormatted: d.fileSize > 1048576 ? `${(d.fileSize / 1048576).toFixed(1)} Mo` : `${(d.fileSize / 1024).toFixed(0)} Ko`,
      })),
      total: countResult[0]?.count ?? 0,
      limit,
      offset,
    });
  } catch (err: any) {
    logger.error({ err }, "Document list error");
    res.status(500).json({ error: "Erreur lors de la recuperation des documents" });
  }
});

router.get("/documents/stats/overview", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);

    const [total, byType, byCategory, totalSize, scanCounts, org] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(documentsTable).where(eq(documentsTable.organisationId, orgId)),
      db.execute(sql`SELECT entity_type, count(*)::int as count FROM documents WHERE organisation_id = ${orgId} AND entity_type IS NOT NULL GROUP BY entity_type ORDER BY count DESC`),
      db.execute(sql`SELECT category, count(*)::int as count FROM documents WHERE organisation_id = ${orgId} GROUP BY category ORDER BY count DESC`),
      db.select({ total: sql<number>`coalesce(sum(file_size), 0)::bigint` }).from(documentsTable).where(eq(documentsTable.organisationId, orgId)),
      db.select({
        safe: sql<number>`count(*) FILTER (WHERE ${documentsTable.scanVerdict} = 'safe')::int`,
        dangerous: sql<number>`count(*) FILTER (WHERE ${documentsTable.scanVerdict} = 'dangerous')::int`,
        unscanned: sql<number>`count(*) FILTER (WHERE ${documentsTable.scanVerdict} IS NULL)::int`,
      }).from(documentsTable).where(eq(documentsTable.organisationId, orgId)),
      db.select({
        reusedScanCount: organisationsTable.reusedScanCount,
        reusedScanSavedMs: organisationsTable.reusedScanSavedMs,
      }).from(organisationsTable).where(eq(organisationsTable.id, orgId)),
    ]);

    const totalBytes = Number(totalSize[0]?.total ?? 0);

    res.json({
      totalDocuments: total[0]?.count ?? 0,
      totalSize: totalBytes > 1048576 ? `${(totalBytes / 1048576).toFixed(1)} Mo` : `${(totalBytes / 1024).toFixed(0)} Ko`,
      totalSizeBytes: totalBytes,
      byEntityType: byType.rows,
      byCategory: byCategory.rows,
      byScanVerdict: {
        safe: scanCounts[0]?.safe ?? 0,
        dangerous: scanCounts[0]?.dangerous ?? 0,
        unscanned: scanCounts[0]?.unscanned ?? 0,
      },
      reuseSavings: {
        reusedScanCount: org[0]?.reusedScanCount ?? 0,
        reusedScanSavedMs: Number(org[0]?.reusedScanSavedMs ?? 0),
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Document stats error");
    res.status(500).json({ error: "Erreur" });
  }
});

const requireOwner = requireRole("super_admin", "administrateur");

router.post("/documents/reuse-savings/reset", requireOwner, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    await db.update(organisationsTable)
      .set({ reusedScanCount: 0, reusedScanSavedMs: 0 })
      .where(eq(organisationsTable.id, orgId));
    logger.info({ orgId }, "Reuse savings counters reset");
    res.json({ success: true, reuseSavings: { reusedScanCount: 0, reusedScanSavedMs: 0 } });
  } catch (err: any) {
    logger.error({ err }, "Reuse savings reset error");
    res.status(500).json({ error: "Erreur lors de la reinitialisation du compteur" });
  }
});

router.post("/documents/process", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { documentId, fileContent, fileName, mimeType: rawMime } = req.body;

    let content = fileContent;
    let name = fileName;
    let mime = rawMime;
    let storedScan: StoredScanRecord | null = null;

    if (documentId) {
      const docId = parseInt(String(documentId));
      if (isNaN(docId)) { res.status(400).json({ error: "documentId invalide" }); return; }
      const [doc] = await db.select().from(documentsTable)
        .where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));
      if (!doc || !doc.fileContent) { res.status(404).json({ error: "Document introuvable" }); return; }
      content = doc.fileContent;
      name = doc.originalName;
      mime = doc.mimeType;
      storedScan = {
        sha256: doc.scanSha256,
        verdict: doc.scanVerdict,
        engine: doc.scanEngine,
        detail: doc.scanDetail,
        scannedAt: doc.scannedAt,
      };
    }

    if (!content || !name) {
      res.status(400).json({ error: "fileContent+fileName ou documentId requis" });
      return;
    }

    mime = resolveMime(name, mime || "application/octet-stream");

    if (!ALLOWED_MIME_TYPES.includes(mime)) {
      res.status(400).json({ error: `Type de fichier non autorise: ${mime}` });
      return;
    }

    const buffer = Buffer.from(content, "base64");
    if (buffer.length > MAX_FILE_SIZE_MB * 1024 * 1024) {
      res.status(400).json({ error: `Fichier trop volumineux. Maximum: ${MAX_FILE_SIZE_MB} Mo.` });
      return;
    }

    const { result: scanResult, reused } = await scanBase64ContentFullCached(content, name, storedScan);
    if (!scanResult.safe) {
      res.status(400).json({ error: "Fichier bloque pour raisons de securite.", threats: scanResult.threats });
      return;
    }

    const result = await processDocumentForImport(content, mime, name, orgId);

    if (documentId) {
      const docUpdates: Record<string, unknown> = {
        extractedData: result as any,
        status: "processed",
        updatedAt: new Date(),
      };
      // Si l'empreinte n'avait jamais ete persistee (document anterieur a cette
      // fonctionnalite), on enregistre le verdict du rescan pour les fois
      // suivantes.
      if (!reused && scanResult.sha256) {
        docUpdates.scanVerdict = scanResult.safe ? "safe" : "dangerous";
        docUpdates.scanEngine = scanResult.engine || null;
        docUpdates.scanDetail = scanResult.engineDetail || null;
        docUpdates.scanSha256 = scanResult.sha256;
        docUpdates.scannedAt = new Date(scanResult.scannedAt);
      }
      await db.update(documentsTable).set(docUpdates)
        .where(and(eq(documentsTable.id, parseInt(String(documentId))), eq(documentsTable.organisationId, orgId)));
    }

    logger.info({ orgId, fileName: name, totalRows: result.totalRows, suggestedModule: result.suggestedModule }, "Document processed for import");

    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "Document process error");
    res.status(500).json({ error: "Erreur lors du traitement du document" });
  }
});

router.post("/documents/import", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId || null;
    const { rows, targetModule, skipDuplicates, selectedRows, documentId } = req.body;

    if (!rows || !Array.isArray(rows) || !targetModule) {
      res.status(400).json({ error: "rows (tableau) et targetModule sont requis" });
      return;
    }

    if (!["contacts", "taches"].includes(targetModule)) {
      res.status(400).json({ error: `Module d'import non supporte: ${targetModule}. Modules disponibles: contacts, taches` });
      return;
    }

    if (rows.length > 500) {
      res.status(400).json({ error: "Maximum 500 enregistrements par importation" });
      return;
    }

    const CONTACT_REQUIRED = ["lastName"];
    const TASK_REQUIRED = ["title"];
    const requiredFields = targetModule === "contacts" ? CONTACT_REQUIRED : TASK_REQUIRED;

    const sanitizedRows = rows.map((row: any, i: number) => {
      if (!row || typeof row !== "object" || !row.fields || typeof row.fields !== "object") {
        return { rowIndex: i, fields: {}, errors: ["Structure de ligne invalide"], warnings: [], duplicateOf: row?.duplicateOf };
      }
      const fields: Record<string, any> = {};
      for (const [key, val] of Object.entries(row.fields)) {
        if (typeof key === "string" && key.length < 50) {
          fields[key] = typeof val === "string" ? val.slice(0, 1000) : val;
        }
      }
      const errors: string[] = Array.isArray(row.errors) ? row.errors.filter((e: any) => typeof e === "string") : [];
      for (const req of requiredFields) {
        if (!fields[req] || String(fields[req]).trim() === "") {
          errors.push(`Champ obligatoire manquant: ${req}`);
        }
      }
      return {
        rowIndex: typeof row.rowIndex === "number" ? row.rowIndex : i,
        fields,
        errors,
        warnings: Array.isArray(row.warnings) ? row.warnings : [],
        duplicateOf: row.duplicateOf || undefined,
      };
    });

    const validSelectedRows = Array.isArray(selectedRows) ? selectedRows.filter((r: any) => typeof r === "number") : undefined;

    const result = await importRowsToModule(sanitizedRows, targetModule, orgId, userId, skipDuplicates !== false, validSelectedRows);

    if (documentId) {
      const docId = parseInt(String(documentId));
      if (!isNaN(docId)) {
        await db.update(documentsTable).set({
          status: "imported",
          updatedAt: new Date(),
        }).where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));
      }
    }

    logger.info({
      orgId, targetModule, totalImported: result.totalImported,
      totalSkipped: result.totalSkipped, totalErrors: result.totalErrors,
    }, "Document data imported");

    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "Document import error");
    res.status(500).json({ error: "Erreur lors de l'importation des donnees" });
  }
});

router.get("/documents/entity/:entityType/:entityId", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const entityType = String(req.params.entityType);
    const entityId = parseInt(String(req.params.entityId));
    if (isNaN(entityId)) { res.status(400).json({ error: "ID invalide" }); return; }

    const docs = await db.select({
      id: documentsTable.id,
      fileName: documentsTable.originalName,
      mimeType: documentsTable.mimeType,
      fileSize: documentsTable.fileSize,
      category: documentsTable.category,
      description: documentsTable.description,
      tags: documentsTable.tags,
      aiProcessed: documentsTable.aiProcessed,
      status: documentsTable.status,
      scanVerdict: documentsTable.scanVerdict,
      scanEngine: documentsTable.scanEngine,
      scannedAt: documentsTable.scannedAt,
      createdAt: documentsTable.createdAt,
    }).from(documentsTable)
      .where(and(eq(documentsTable.organisationId, orgId), eq(documentsTable.entityType, entityType), eq(documentsTable.entityId, entityId)))
      .orderBy(desc(documentsTable.createdAt));

    res.json({ documents: docs, total: docs.length, entityType, entityId });
  } catch (err: any) {
    logger.error({ err }, "Entity documents error");
    res.status(500).json({ error: "Erreur" });
  }
});

router.get("/documents/:id", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const docId = parseInt(String(req.params.id));
    if (isNaN(docId)) { res.status(400).json({ error: "ID invalide" }); return; }

    const [doc] = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));

    if (!doc) { res.status(404).json({ error: "Document introuvable" }); return; }

    const isImage = doc.mimeType?.startsWith("image/");
    const isText = doc.mimeType === "text/plain" || doc.mimeType === "application/json" || doc.mimeType === "text/xml" || doc.mimeType === "application/xml";

    res.json({
      id: doc.id,
      fileName: doc.originalName,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      entityType: doc.entityType,
      entityId: doc.entityId,
      category: doc.category,
      description: doc.description,
      tags: doc.tags,
      aiProcessed: doc.aiProcessed,
      aiAnalysis: doc.aiAnalysis,
      extractedText: doc.extractedText,
      extractedData: doc.extractedData,
      // For images: return the base64 so mobile can display inline
      imageBase64: isImage && doc.fileContent ? `data:${doc.mimeType};base64,${doc.fileContent}` : null,
      // For plain text files: also return decoded text content
      rawText: isText && doc.fileContent ? Buffer.from(doc.fileContent, "base64").toString("utf-8").slice(0, 500000) : null,
      status: doc.status,
      scanVerdict: doc.scanVerdict,
      scanEngine: doc.scanEngine,
      scanDetail: doc.scanDetail,
      scanSha256: doc.scanSha256,
      scannedAt: doc.scannedAt,
      uploadedBy: doc.uploadedBy,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  } catch (err: any) {
    logger.error({ err }, "Document detail error");
    res.status(500).json({ error: "Erreur" });
  }
});

router.get("/documents/:id/download", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const docId = parseInt(String(req.params.id));
    if (isNaN(docId)) { res.status(400).json({ error: "ID invalide" }); return; }

    const [doc] = await db.select({
      fileContent: documentsTable.fileContent,
      originalName: documentsTable.originalName,
      mimeType: documentsTable.mimeType,
      organisationId: documentsTable.organisationId,
    }).from(documentsTable)
      .where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));

    if (!doc || !doc.fileContent) {
      res.status(404).json({ error: "Document introuvable ou contenu manquant" });
      return;
    }

    const buffer = Buffer.from(doc.fileContent, "base64");
    // Defense-in-depth on user-uploaded file downloads:
    // - nosniff prevents the browser from MIME-sniffing an HTML/JS payload
    //   out of a file we declared as e.g. application/pdf (XSS via download).
    // - X-Download-Options: noopen blocks legacy IE "Open" action.
    // - Restrictive CSP neuters any inline script if the file is rendered
    //   inline (e.g. SVG/HTML the upload validator missed).
    // - Content-Disposition: attachment + sanitised filename forces a save
    //   dialog and prevents header injection via \r\n in originalName.
    const safeName = String(doc.originalName).replace(/[\r\n"\\]/g, "_");
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Download-Options", "noopen");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(safeName)}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
    );
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err: any) {
    logger.error({ err }, "Document download error");
    res.status(500).json({ error: "Erreur lors du telechargement" });
  }
});

router.post("/documents/:id/analyze", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const docId = parseInt(String(req.params.id));
    if (isNaN(docId)) { res.status(400).json({ error: "ID invalide" }); return; }

    const [doc] = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));

    if (!doc || !doc.fileContent) {
      res.status(404).json({ error: "Document introuvable" });
      return;
    }

    const aiResult = await analyzeDocument(doc.fileContent, doc.mimeType, doc.originalName, orgId);

    await db.update(documentsTable).set({
      aiProcessed: true,
      aiAnalysis: aiResult as any,
      extractedText: aiResult.summary,
      extractedData: aiResult.extractedFields as any,
      status: "analyzed",
      updatedAt: new Date(),
    }).where(eq(documentsTable.id, docId));

    res.json({ success: true, documentId: docId, analysis: aiResult });
  } catch (err: any) {
    logger.error({ err }, "Document analysis error");
    res.status(500).json({ error: "Erreur lors de l'analyse" });
  }
});

/**
 * Scan antivirus groupe en ARRIERE-PLAN. Comme un lot peut contenir beaucoup de
 * fichiers et que chaque analyse interroge un moteur externe (VirusTotal...),
 * un traitement synchrone risquerait un timeout HTTP. On reprend donc le meme
 * patron que les routes IA : le travail tourne en tache de fond, le client suit
 * la progression en direct via SSE (`/documents/bulk/scan/stream`) ou par
 * sondage (`GET /documents/bulk/scan/status`). Un document sans contenu ou dont
 * le scan echoue n'arrete pas le lot : il est compte comme echec et le
 * traitement continue.
 *
 * Doivent etre declarees AVANT `/documents/:id/scan` pour que le segment "bulk"
 * ne soit pas capture par le parametre `:id`.
 */
type BulkScanResult = {
  documentId: number;
  scanVerdict?: string;
  scanEngine?: string | null;
  scannedAt?: string;
  error?: string;
};

type BulkScanEvent = { event: string; data: any };

export type BulkScanJobStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type BulkScanJobState = {
  status: BulkScanJobStatus;
  runnerId: string;
  startedAt: number;
  startedByUserId: number | null;
  requested: number;
  total: number;
  completed: number;
  safe: number;
  dangerous: number;
  reused: number;
  failed: number;
  results: BulkScanResult[];
  events: BulkScanEvent[];
  emitter: EventEmitter;
  abortController: AbortController;
  finishedAt?: number;
  cleanupTimer?: NodeJS.Timeout;
  heartbeatTimer?: NodeJS.Timeout;
};

// État vivant (emitter + abortController) du job en cours sur CETTE instance.
// La source de vérité partagée/durable est la table `bulk_scan_jobs` ; ce Map
// ne sert qu'à diffuser le flux SSE en direct et à piloter l'annulation locale.
const bulkScanJobs = new Map<number, BulkScanJobState>();
const BULK_SCAN_RETENTION_MS = 5 * 60 * 1000;
// Heartbeat : on rafraîchit `updated_at` régulièrement pendant le scan pour
// qu'une autre instance puisse distinguer un job vivant d'un job orphelin.
const BULK_SCAN_HEARTBEAT_MS = 10 * 1000;
// Un job "running" dont le heartbeat dépasse ce seuil est considéré comme
// orphelin (processus mort en plein scan) et réconcilié en "interrupted".
export const BULK_SCAN_STALE_MS = 60 * 1000;

type BulkScanRow = typeof bulkScanJobsTable.$inferSelect;

// Acquisition ATOMIQUE du slot de scan d'une organisation, sûre entre instances.
// Une seule instruction SQL : INSERT ... ON CONFLICT (organisation_id) DO UPDATE
// dont le SET n'est appliqué QUE si le job courant n'est plus actif (statut
// terminal) OU si son heartbeat est périmé (worker mort). RETURNING ne renvoie
// une ligne que si l'on a gagné le slot ; sinon un autre worker frais le détient.
// Empêche deux instances de lancer simultanément un scan pour la même org.
export async function acquireBulkScanSlot(orgId: number, job: BulkScanJobState): Promise<boolean> {
  const values = {
    runnerId: job.runnerId,
    status: "running" as const,
    startedByUserId: job.startedByUserId,
    requested: job.requested,
    total: job.total,
    completed: 0,
    safe: 0,
    dangerous: 0,
    reused: 0,
    failed: 0,
    results: [] as unknown[],
    events: [] as unknown[],
    startedAt: new Date(job.startedAt),
    finishedAt: null,
    updatedAt: new Date(),
  };
  const staleBefore = new Date(Date.now() - BULK_SCAN_STALE_MS);
  try {
    const rows = await db.insert(bulkScanJobsTable)
      .values({ organisationId: orgId, ...values })
      .onConflictDoUpdate({
        target: bulkScanJobsTable.organisationId,
        set: values,
        setWhere: or(
          ne(bulkScanJobsTable.status, "running"),
          lt(bulkScanJobsTable.updatedAt, staleBefore),
        ),
      })
      .returning({ id: bulkScanJobsTable.id });
    return rows.length > 0;
  } catch (err) {
    logger.error({ err, orgId }, "acquireBulkScanSlot failed");
    return false;
  }
}

// Écrit l'état du job dans la table partagée. Toutes les écritures sont
// conditionnées au jeton d'appartenance (`runnerId`) : si une autre instance a
// repris un job orphelin, nos écritures n'affectent aucune ligne (0 row) au lieu
// d'écraser son état. En mode progression on exige aussi `status = 'running'`
// pour ne pas réanimer un job annulé entre-temps.
export async function persistBulkScanJob(
  orgId: number,
  job: BulkScanJobState,
  opts?: { terminal?: boolean },
) {
  const values = {
    status: job.status,
    requested: job.requested,
    total: job.total,
    completed: job.completed,
    safe: job.safe,
    dangerous: job.dangerous,
    reused: job.reused,
    failed: job.failed,
    results: job.results as unknown[],
    events: job.events as unknown[],
    finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
    updatedAt: new Date(),
  };
  const ownership = and(
    eq(bulkScanJobsTable.organisationId, orgId),
    eq(bulkScanJobsTable.runnerId, job.runnerId),
  );
  try {
    await db.update(bulkScanJobsTable).set(values)
      .where(opts?.terminal
        ? ownership
        : and(ownership, eq(bulkScanJobsTable.status, "running")));
  } catch (err) {
    logger.error({ err, orgId }, "persistBulkScanJob failed");
  }
}

function bulkScanRowToSnapshot(row: BulkScanRow, overrideStatus?: BulkScanJobStatus) {
  return {
    status: overrideStatus ?? (row.status as BulkScanJobStatus),
    startedAt: new Date(row.startedAt).getTime(),
    requested: row.requested,
    total: row.total,
    completed: row.completed,
    safe: row.safe,
    dangerous: row.dangerous,
    reused: row.reused,
    failed: row.failed,
    results: (row.results as BulkScanResult[] | null) ?? [],
    finishedAt: row.finishedAt ? new Date(row.finishedAt).getTime() : undefined,
  };
}

// Passe une ligne "running" périmée à "interrupted" (best effort) afin que l'état
// reste réconciliable après un crash/redémarrage du processus qui la portait.
export async function reconcileStaleBulkScan(orgId: number): Promise<void> {
  await db.update(bulkScanJobsTable)
    .set({ status: "interrupted", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(bulkScanJobsTable.organisationId, orgId),
      eq(bulkScanJobsTable.status, "running"),
    ));
}

// Renvoie le job actif (running, heartbeat frais) pour l'org, sinon null. Réconcilie
// au passage les jobs orphelins. Sert à empêcher de relancer un scan déjà en cours
// sur une autre instance et à décider de l'attache du flux SSE.
export async function getActiveBulkScan(orgId: number): Promise<{ total: number; completed: number } | null> {
  const local = bulkScanJobs.get(orgId);
  if (local && local.status === "running") return { total: local.total, completed: local.completed };
  const [row] = await db.select().from(bulkScanJobsTable)
    .where(eq(bulkScanJobsTable.organisationId, orgId)).limit(1);
  if (row && row.status === "running") {
    const age = Date.now() - new Date(row.updatedAt).getTime();
    if (age <= BULK_SCAN_STALE_MS) return { total: row.total, completed: row.completed };
    await reconcileStaleBulkScan(orgId);
  }
  return null;
}

// Snapshot de statut résilient : privilégie le job vivant local (le plus frais),
// sinon lit la ligne partagée et réconcilie un éventuel job orphelin.
export async function loadBulkScanSnapshot(orgId: number) {
  const local = bulkScanJobs.get(orgId);
  if (local && local.status === "running") return bulkScanStatusSnapshot(local);
  const [row] = await db.select().from(bulkScanJobsTable)
    .where(eq(bulkScanJobsTable.organisationId, orgId)).limit(1);
  if (!row) return local ? bulkScanStatusSnapshot(local) : null;
  if (row.status === "running" && !local) {
    const age = Date.now() - new Date(row.updatedAt).getTime();
    if (age > BULK_SCAN_STALE_MS) {
      await reconcileStaleBulkScan(orgId);
      return bulkScanRowToSnapshot(row, "interrupted");
    }
  }
  return local ? bulkScanStatusSnapshot(local) : bulkScanRowToSnapshot(row);
}

// Indique si le worker doit s'arrêter, en lisant l'état partagé : annulation /
// interruption décidée ailleurs, ligne disparue, OU perte d'appartenance (une
// autre instance a repris le slot — runnerId différent). En cas d'erreur de
// lecture, on ne stoppe pas (on évite d'interrompre un scan sain sur un blip DB).
export async function shouldStopBulkScan(orgId: number, job: BulkScanJobState): Promise<boolean> {
  try {
    const [row] = await db.select({
      status: bulkScanJobsTable.status,
      runnerId: bulkScanJobsTable.runnerId,
    }).from(bulkScanJobsTable).where(eq(bulkScanJobsTable.organisationId, orgId)).limit(1);
    if (!row) return true;
    if (row.status === "cancelled" || row.status === "interrupted") return true;
    if (row.runnerId !== job.runnerId) return true;
    return false;
  } catch {
    return false;
  }
}

function emitBulkScanEvent(job: BulkScanJobState, event: string, data: any) {
  job.events.push({ event, data });
  job.emitter.emit("event", event, data);
}

function scheduleBulkScanCleanup(orgId: number, job: BulkScanJobState) {
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  job.cleanupTimer = setTimeout(() => {
    if (bulkScanJobs.get(orgId) === job) bulkScanJobs.delete(orgId);
  }, BULK_SCAN_RETENTION_MS);
  job.cleanupTimer.unref?.();
}

// Rafraîchit périodiquement `updated_at` tant que le scan tourne, même si un
// document est long à analyser, afin que les autres instances ne le prennent pas
// pour un job orphelin.
function startBulkScanHeartbeat(orgId: number, job: BulkScanJobState) {
  job.heartbeatTimer = setInterval(() => {
    db.update(bulkScanJobsTable)
      .set({ updatedAt: new Date() })
      .where(and(
        eq(bulkScanJobsTable.organisationId, orgId),
        eq(bulkScanJobsTable.status, "running"),
        eq(bulkScanJobsTable.runnerId, job.runnerId),
      ))
      .catch((err) => logger.error({ err, orgId }, "bulk scan heartbeat failed"));
  }, BULK_SCAN_HEARTBEAT_MS);
  job.heartbeatTimer.unref?.();
}

function stopBulkScanHeartbeat(job: BulkScanJobState) {
  if (job.heartbeatTimer) {
    clearInterval(job.heartbeatTimer);
    job.heartbeatTimer = undefined;
  }
}

function bulkScanStatusSnapshot(job: BulkScanJobState) {
  return {
    status: job.status,
    startedAt: job.startedAt,
    requested: job.requested,
    total: job.total,
    completed: job.completed,
    safe: job.safe,
    dangerous: job.dangerous,
    reused: job.reused,
    failed: job.failed,
    results: job.results,
    finishedAt: job.finishedAt,
  };
}

async function runBulkScanJob(
  orgId: number,
  validIds: number[],
  userId: number | null,
  ip: string,
  job: BulkScanJobState,
) {
  const signal = job.abortController.signal;
  startBulkScanHeartbeat(orgId, job);
  try {
    const docs = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.organisationId, orgId), inArray(documentsTable.id, validIds)));

    const missing = validIds.length - docs.length;
    if (missing > 0) job.failed += missing;
    job.total = docs.length;

    emitBulkScanEvent(job, "start", { requested: job.requested, total: job.total });
    await persistBulkScanJob(orgId, job);

    for (const doc of docs) {
      if (signal.aborted) break;
      // Arrêt décidé ailleurs : annulation/interruption partagée, ligne disparue,
      // ou reprise du slot par une autre instance (perte d'appartenance).
      if (await shouldStopBulkScan(orgId, job)) {
        try { job.abortController.abort(); } catch {}
        break;
      }
      if (!doc.fileContent) {
        job.failed++;
        job.completed++;
        const result: BulkScanResult = { documentId: doc.id, error: "Contenu indisponible" };
        job.results.push(result);
        emitBulkScanEvent(job, "progress", {
          completed: job.completed, total: job.total,
          safe: job.safe, dangerous: job.dangerous, reused: job.reused, failed: job.failed,
          last: result,
        });
        await persistBulkScanJob(orgId, job);
        continue;
      }
      try {
        const previousVerdict = doc.scanVerdict;
        const storedScan: StoredScanRecord = {
          sha256: doc.scanSha256,
          verdict: doc.scanVerdict,
          engine: doc.scanEngine,
          detail: doc.scanDetail,
          scannedAt: doc.scannedAt,
        };
        const { result: scanResult, reused } = await scanBase64ContentFullCached(
          doc.fileContent, doc.originalName, storedScan,
        );
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

        if (scanResult.safe) {
          job.safe++;
        } else {
          job.dangerous++;
          logSecurityEvent("malicious_file_detected", ip, userId, `Scan groupe du document #${doc.id} (${scanResult.engine}): ${scanResult.threats.join(", ")}`, "critical");
          emitSecurityAlert({
            orgId,
            kind: "file",
            verdict: "dangerous",
            target: doc.originalName,
            detail: scanResult.engine || undefined,
            excludeUserId: userId,
          });
          void recordDocumentThreatSuggestion({
            orgId,
            fileName: doc.originalName,
            engine: scanResult.engine,
            documentId: doc.id,
          });
          // Tâche #134 : notification push mobile, dédupliquée par document via
          // la transition de verdict (un même fichier déjà « dangerous » ne
          // re-notifie pas, mais chaque nouveau fichier dangereux notifie).
          if (shouldNotifyDocumentThreat(previousVerdict, verdict)) {
            broadcastDocumentThreatNotification({
              orgId,
              fileName: doc.originalName,
              engine: scanResult.engine,
            });
          }
        }
        const result: BulkScanResult = {
          documentId: doc.id,
          scanVerdict: verdict,
          scanEngine: scanResult.engine || null,
          scannedAt: new Date(scanResult.scannedAt).toISOString(),
        };
        job.completed++;
        job.results.push(result);
        emitBulkScanEvent(job, "progress", {
          completed: job.completed, total: job.total,
          safe: job.safe, dangerous: job.dangerous, reused: job.reused, failed: job.failed,
          last: result,
        });
        await persistBulkScanJob(orgId, job);
      } catch (scanErr: any) {
        logger.error({ err: scanErr, docId: doc.id }, "Bulk document scan: per-doc failure");
        job.failed++;
        job.completed++;
        const result: BulkScanResult = { documentId: doc.id, error: "Erreur d'analyse" };
        job.results.push(result);
        emitBulkScanEvent(job, "progress", {
          completed: job.completed, total: job.total,
          safe: job.safe, dangerous: job.dangerous, reused: job.reused, failed: job.failed,
          last: result,
        });
        await persistBulkScanJob(orgId, job);
      }
    }

    if (signal.aborted) {
      job.status = "cancelled";
      emitBulkScanEvent(job, "aborted", bulkScanStatusSnapshot(job));
    } else {
      job.status = "completed";
      emitBulkScanEvent(job, "done", {
        success: true,
        requested: job.requested,
        scanned: job.safe + job.dangerous,
        safe: job.safe,
        dangerous: job.dangerous,
        reused: job.reused,
        failed: job.failed,
        results: job.results,
      });
    }
  } catch (err: any) {
    logger.error({ err }, "Bulk document scan error");
    job.status = "failed";
    emitBulkScanEvent(job, "error", { error: "Erreur lors de l'analyse antivirus groupee" });
  } finally {
    job.finishedAt = Date.now();
    stopBulkScanHeartbeat(job);
    // Écriture terminale : on fige l'état final partagé pour qu'il reste
    // réconciliable après coup (redémarrage, autre instance). Conditionnée à
    // l'appartenance (`terminal`) : si une autre instance a repris le slot, on
    // n'écrase pas son état (0 row).
    await persistBulkScanJob(orgId, job, { terminal: true });
    job.emitter.emit("end");
    scheduleBulkScanCleanup(orgId, job);
  }
}

function parseBulkScanIds(body: unknown): { ids: number[]; error?: string } {
  const { ids } = (body || {}) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return { ids: [], error: "ids requis" };
  const validIds = Array.from(new Set(ids.map((n) => parseInt(String(n))).filter((n) => !isNaN(n))));
  if (validIds.length === 0) return { ids: [], error: "ids invalides" };
  return { ids: validIds };
}

// Démarre un job. Renvoie le job si l'on a gagné le slot ATOMIQUEMENT, ou `null`
// si une autre instance détient déjà un scan frais pour cette org (course
// perdue). C'est l'acquisition atomique — et non le contrôle préalable
// getActiveBulkScan — qui garantit qu'un seul worker tourne entre instances.
async function startBulkScanJob(req: Request, validIds: number[]): Promise<BulkScanJobState | null> {
  const orgId = getOrgId(req);
  const userId = req.session?.userId || null;
  const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
  const job: BulkScanJobState = {
    status: "running",
    runnerId: crypto.randomUUID(),
    startedAt: Date.now(),
    startedByUserId: userId,
    requested: validIds.length,
    total: validIds.length,
    completed: 0,
    safe: 0,
    dangerous: 0,
    reused: 0,
    failed: 0,
    results: [],
    events: [],
    emitter: new EventEmitter(),
    abortController: new AbortController(),
  };
  job.emitter.setMaxListeners(50);
  // Acquisition atomique du slot AVANT toute exécution : si on perd la course,
  // on n'enregistre pas de job local et on ne lance pas de worker.
  const acquired = await acquireBulkScanSlot(orgId, job);
  if (!acquired) return null;
  bulkScanJobs.set(orgId, job);
  runBulkScanJob(orgId, validIds, userId, ip, job).catch((err) => logger.error({ err }, "runBulkScanJob failed"));
  return job;
}

router.post("/documents/bulk/scan", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { ids: validIds, error } = parseBulkScanIds(req.body);
  if (error) { res.status(400).json({ error }); return; }

  const active = await getActiveBulkScan(orgId);
  if (active) {
    res.json({ status: "already_running", total: active.total, completed: active.completed });
    return;
  }

  const job = await startBulkScanJob(req, validIds);
  if (!job) {
    // Course perdue : une autre instance a démarré le scan entre-temps.
    const current = await getActiveBulkScan(orgId);
    res.json({
      status: "already_running",
      total: current?.total ?? validIds.length,
      completed: current?.completed ?? 0,
    });
    return;
  }
  res.json({ status: "started", total: job.total });
});

router.get("/documents/bulk/scan/status", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const snapshot = await loadBulkScanSnapshot(orgId);
  if (!snapshot) { res.json({ status: "idle" }); return; }
  res.json(snapshot);
});

router.post("/documents/bulk/scan/cancel", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const local = bulkScanJobs.get(orgId);
  if (local && local.status === "running") {
    try { local.abortController.abort(); } catch {}
    res.json({ status: "cancelling" });
    return;
  }
  // Pas de job local : tenter d'annuler un job qui tourne sur une autre instance.
  // On passe la ligne partagée à "cancelled" ; l'instance porteuse le détecte via
  // shouldStopBulkScan et s'arrête. Un job orphelin devient simplement terminal
  // (réconciliable).
  const [row] = await db.select().from(bulkScanJobsTable)
    .where(eq(bulkScanJobsTable.organisationId, orgId)).limit(1);
  if (row && row.status === "running") {
    await db.update(bulkScanJobsTable)
      .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(bulkScanJobsTable.organisationId, orgId),
        eq(bulkScanJobsTable.status, "running"),
      ));
    res.json({ status: "cancelling" });
    return;
  }
  res.json({ status: "idle" });
});

router.post("/documents/bulk/scan/stream", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);

  let job = bulkScanJobs.get(orgId);
  if (!job || job.status !== "running") {
    const active = await getActiveBulkScan(orgId);
    if (active) {
      // Un scan tourne ailleurs (autre instance) : on rejoue l'état persisté puis
      // on ferme. Le client suit la suite via le sondage /status.
      const [row] = await db.select().from(bulkScanJobsTable)
        .where(eq(bulkScanJobsTable.organisationId, orgId)).limit(1);
      const replay = openSseStream(res);
      for (const ev of ((row?.events as BulkScanEvent[] | null | undefined) ?? [])) {
        replay.send(ev.event, ev.data);
      }
      replay.end();
      return;
    }
    const { ids: validIds, error } = parseBulkScanIds(req.body);
    if (error) {
      // Aucun job actif et pas d'ids : rejouer le dernier état terminal persisté
      // (utile pour un client qui se reconnecte après un redémarrage).
      const [row] = await db.select().from(bulkScanJobsTable)
        .where(eq(bulkScanJobsTable.organisationId, orgId)).limit(1);
      const replay = openSseStream(res);
      for (const ev of ((row?.events as BulkScanEvent[] | null | undefined) ?? [])) {
        replay.send(ev.event, ev.data);
      }
      replay.end();
      return;
    }
    job = (await startBulkScanJob(req, validIds)) ?? undefined;
    if (!job) {
      // Course perdue : une autre instance vient de démarrer le scan. On rejoue
      // l'état persisté puis on ferme (le client suit via le sondage /status).
      const [row] = await db.select().from(bulkScanJobsTable)
        .where(eq(bulkScanJobsTable.organisationId, orgId)).limit(1);
      const replay = openSseStream(res);
      for (const ev of ((row?.events as BulkScanEvent[] | null | undefined) ?? [])) {
        replay.send(ev.event, ev.data);
      }
      replay.end();
      return;
    }
  }

  const stream = openSseStream(res);
  const activeJob = job;

  // Replay buffered events so reattaching clients see current state.
  for (const ev of activeJob.events) stream.send(ev.event, ev.data);

  if (activeJob.status !== "running") {
    stream.end();
    return;
  }

  const onEvent = (event: string, data: any) => stream.send(event, data);
  const onEnd = () => stream.end();

  activeJob.emitter.on("event", onEvent);
  activeJob.emitter.once("end", onEnd);

  const detach = () => {
    activeJob.emitter.off("event", onEvent);
    activeJob.emitter.off("end", onEnd);
  };

  // When the request closes (tab switched / navigated away), just detach this
  // subscriber. The background scan continues so the user can reattach later.
  stream.signal.addEventListener("abort", detach);
  res.on("close", detach);
});

/**
 * Re-scan antivirus a la demande d'un document deja stocke. Contrairement au
 * verdict reutilise a l'upload, on force un scan complet frais
 * (`scanBase64ContentFull`) pour donner un signal de confiance a jour, puis on
 * persiste le nouveau verdict. Renvoie l'etat de scan que le mobile/web affiche
 * (verdict / moteur / detail / date) sans bloquer si une menace est detectee :
 * le but est d'informer, pas de supprimer le fichier.
 */
router.post("/documents/:id/scan", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId || null;
    const docId = parseInt(String(req.params.id));
    if (isNaN(docId)) { res.status(400).json({ error: "ID invalide" }); return; }

    const [doc] = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));

    if (!doc || !doc.fileContent) {
      res.status(404).json({ error: "Document introuvable" });
      return;
    }

    const previousVerdict = doc.scanVerdict;
    const scanResult = await scanBase64ContentFull(doc.fileContent, doc.originalName);
    const verdict = scanResult.safe ? "safe" : "dangerous";

    await db.update(documentsTable).set({
      scanVerdict: verdict,
      scanEngine: scanResult.engine || null,
      scanDetail: scanResult.engineDetail || null,
      scanSha256: scanResult.sha256 || null,
      scannedAt: new Date(scanResult.scannedAt),
      updatedAt: new Date(),
    }).where(eq(documentsTable.id, docId));

    if (!scanResult.safe) {
      const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
      logSecurityEvent("malicious_file_detected", ip, userId, `Re-scan du document #${docId} (${scanResult.engine}): ${scanResult.threats.join(", ")}`, "critical");
      emitSecurityAlert({
        orgId,
        kind: "file",
        verdict: "dangerous",
        target: doc.originalName,
        detail: scanResult.engine || undefined,
        excludeUserId: userId,
      });
      void recordDocumentThreatSuggestion({
        orgId,
        fileName: doc.originalName,
        engine: scanResult.engine,
        documentId: docId,
      });
      // Tâche #134 : notification push mobile, dédupliquée par document via la
      // transition de verdict (re-scanner un fichier déjà « dangerous » ne
      // re-notifie pas ; chaque nouveau fichier devenu dangereux notifie).
      if (shouldNotifyDocumentThreat(previousVerdict, verdict)) {
        broadcastDocumentThreatNotification({
          orgId,
          fileName: doc.originalName,
          engine: scanResult.engine,
        });
      }
    }

    res.json({
      success: true,
      documentId: docId,
      scanVerdict: verdict,
      scanEngine: scanResult.engine || null,
      scanDetail: scanResult.engineDetail || null,
      scannedAt: new Date(scanResult.scannedAt).toISOString(),
      threats: scanResult.threats,
    });
  } catch (err: any) {
    logger.error({ err }, "Document re-scan error");
    res.status(500).json({ error: "Erreur lors de l'analyse antivirus" });
  }
});

/**
 * Analyse antivirus en lot des documents jamais scannes (scanVerdict IS NULL).
 * Traite un lot borne par requete et renvoie le nombre restant pour permettre au
 * client de boucler en affichant la progression — evite les timeouts HTTP sur
 * les organisations avec beaucoup de fichiers, et reprend proprement apres une
 * coupure (chaque lot persiste son verdict immediatement).
 */
router.post("/documents/scan-unscanned", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId || null;
    const rawBatch = parseInt(String(req.body?.batchSize ?? "15"));
    const batchSize = Math.min(Math.max(isNaN(rawBatch) ? 15 : rawBatch, 1), 50);

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
      .limit(batchSize);

    let scanned = 0, safe = 0, dangerous = 0, reusedCount = 0;
    for (const doc of docs) {
      if (!doc.fileContent) continue;
      try {
        const sha256 = crypto.createHash("sha256").update(Buffer.from(doc.fileContent, "base64")).digest("hex");
        const storedScan = await findReusableCleanScan(orgId, sha256);
        const { result: scanResult, reused } = await scanBase64ContentFullCached(doc.fileContent, doc.originalName, storedScan);
        if (reused) reusedCount++;
        const verdict = scanResult.safe ? "safe" : "dangerous";
        await db.update(documentsTable).set({
          scanVerdict: verdict,
          scanEngine: scanResult.engine || null,
          scanDetail: scanResult.engineDetail || null,
          scanSha256: scanResult.sha256 || null,
          scannedAt: new Date(scanResult.scannedAt),
          updatedAt: new Date(),
        }).where(eq(documentsTable.id, doc.id));
        scanned++;
        if (scanResult.safe) safe++;
        else {
          dangerous++;
          const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
          logSecurityEvent("malicious_file_detected", ip, userId, `Analyse en lot du document #${doc.id} (${scanResult.engine}): ${scanResult.threats.join(", ")}`, "critical");
        }
      } catch (scanErr: any) {
        logger.error({ scanErr, docId: doc.id }, "Bulk scan: document scan failed");
      }
    }

    const [remainingRow] = await db.select({
      remaining: sql<number>`count(*) FILTER (WHERE ${documentsTable.scanVerdict} IS NULL AND ${documentsTable.fileContent} IS NOT NULL)::int`,
    }).from(documentsTable).where(eq(documentsTable.organisationId, orgId));
    const remaining = remainingRow?.remaining ?? 0;

    logger.info({ orgId, scanned, safe, dangerous, reused: reusedCount, remaining }, "Bulk document scan batch complete");

    res.json({ success: true, scanned, safe, dangerous, reused: reusedCount, remaining });
  } catch (err: any) {
    logger.error({ err }, "Bulk document scan error");
    res.status(500).json({ error: "Erreur lors de l'analyse antivirus en lot" });
  }
});

/**
 * Demarre un scan antivirus "Tout analyser" en arriere-plan cote serveur.
 * Rend la main immediatement : le travail continue meme si le client quitte la
 * page. La progression est diffusee via SSE (type "security", meta.source =
 * "bulk-scan") et interrogeable via /documents/scan-unscanned/status.
 */
router.post("/documents/scan-unscanned/start", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId || null;
    const job = startBulkScan(orgId, userId);
    res.json({ success: true, job });
  } catch (err: any) {
    logger.error({ err }, "Bulk document scan start error");
    res.status(500).json({ error: "Erreur lors du demarrage de l'analyse antivirus en lot" });
  }
});

/** Renvoie l'etat courant du scan en arriere-plan (pour reattache au refresh). */
router.get("/documents/scan-unscanned/status", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    res.json({ job: getBulkScanStatus(orgId) });
  } catch (err: any) {
    logger.error({ err }, "Bulk document scan status error");
    res.status(500).json({ error: "Erreur lors de la recuperation du statut" });
  }
});

/**
 * Demande l'arret du scan "Tout analyser" en arriere-plan. Le job s'arrete
 * promptement entre deux documents et passe en "cancelled" ; les verdicts deja
 * calcules sont conserves. La fin est diffusee via SSE comme pour une fin
 * normale (meta.source = "bulk-scan").
 */
router.post("/documents/scan-unscanned/cancel", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    res.json({ job: cancelBulkScan(orgId) });
  } catch (err: any) {
    logger.error({ err }, "Bulk document scan cancel error");
    res.status(500).json({ error: "Erreur lors de l'annulation de l'analyse" });
  }
});

router.delete("/documents/:id", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const docId = parseInt(String(req.params.id));
    if (isNaN(docId)) { res.status(400).json({ error: "ID invalide" }); return; }

    const [doc] = await db.select({ id: documentsTable.id }).from(documentsTable)
      .where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));

    if (!doc) { res.status(404).json({ error: "Document introuvable" }); return; }

    await db.delete(documentsTable).where(eq(documentsTable.id, docId));
    res.json({ success: true, message: "Document supprime" });
  } catch (err: any) {
    logger.error({ err }, "Document delete error");
    res.status(500).json({ error: "Erreur lors de la suppression" });
  }
});

router.put("/documents/:id", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const docId = parseInt(String(req.params.id));
    if (isNaN(docId)) { res.status(400).json({ error: "ID invalide" }); return; }

    const [doc] = await db.select({ id: documentsTable.id }).from(documentsTable)
      .where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));

    if (!doc) { res.status(404).json({ error: "Document introuvable" }); return; }

    const updates: any = { updatedAt: new Date() };
    if (req.body.entityType !== undefined) updates.entityType = req.body.entityType;
    if (req.body.entityId !== undefined) updates.entityId = req.body.entityId ? parseInt(String(req.body.entityId)) : null;
    if (req.body.category !== undefined) updates.category = req.body.category;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.tags !== undefined) updates.tags = req.body.tags;

    const [updated] = await db.update(documentsTable).set(updates).where(eq(documentsTable.id, docId)).returning();
    res.json({ success: true, document: { id: updated.id, fileName: updated.originalName, entityType: updated.entityType, entityId: updated.entityId, category: updated.category } });
  } catch (err: any) {
    logger.error({ err }, "Document update error");
    res.status(500).json({ error: "Erreur lors de la mise a jour" });
  }
});

router.get("/documents/export/csv", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const docs = await db.select({
      id: documentsTable.id,
      fileName: documentsTable.fileName,
      originalName: documentsTable.originalName,
      mimeType: documentsTable.mimeType,
      fileSize: documentsTable.fileSize,
      category: documentsTable.category,
      entityType: documentsTable.entityType,
      status: documentsTable.status,
      createdAt: documentsTable.createdAt,
    }).from(documentsTable).where(eq(documentsTable.organisationId, orgId));

    if (docs.length === 0) { res.set("Content-Type", "text/csv").send("id,fileName,originalName,mimeType,fileSize,category,entityType,status,createdAt\n"); return; }
    const headers = ["id", "fileName", "originalName", "mimeType", "fileSize", "category", "entityType", "status", "createdAt"];
    const csvRows = [
      headers.join(","),
      ...docs.map(d => headers.map(h => {
        const val = (d as any)[h];
        if (val === null || val === undefined) return "";
        const str = String(val instanceof Date ? val.toISOString() : val);
        return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(","))
    ];
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="documents_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csvRows.join("\n"));
  } catch (err: any) {
    logger.error({ err }, "Documents export CSV error");
    res.status(500).json({ error: "Erreur export" });
  }
});

// ── MULTI-MODEL AI ANALYZE ───────────────────────────────────────────────────
router.post("/documents/:id/analyze-multi", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const docId = parseInt(String(req.params.id));
    if (isNaN(docId)) { res.status(400).json({ error: "ID invalide" }); return; }

    const [doc] = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));

    if (!doc || !doc.fileContent) {
      res.status(404).json({ error: "Document introuvable ou contenu manquant" }); return;
    }

    const result = await analyzeDocumentMultiModel(doc.fileContent, doc.mimeType, doc.originalName, orgId);

    // Merge multi-model result into existing aiAnalysis
    const existing = (doc.aiAnalysis as Record<string, any>) ?? {};
    const merged = { ...existing, multiModel: result };

    await db.update(documentsTable).set({
      aiProcessed: true,
      aiAnalysis: merged as any,
      updatedAt: new Date(),
    }).where(eq(documentsTable.id, docId));

    res.json({ success: true, documentId: docId, result });
  } catch (err: any) {
    logger.error({ err }, "Document multi-model analysis error");
    res.status(500).json({ error: "Erreur lors de l'analyse multi-modèle" });
  }
});

// ── DOCUMENT Q&A ─────────────────────────────────────────────────────────────
router.post("/documents/:id/ask", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const docId = parseInt(String(req.params.id));
    if (isNaN(docId)) { res.status(400).json({ error: "ID invalide" }); return; }

    const { question, models } = req.body as { question: string; models?: Array<"gemini" | "openai" | "claude"> };
    if (!question?.trim()) { res.status(400).json({ error: "question requise" }); return; }

    const [doc] = await db.select({
      originalName: documentsTable.originalName,
      mimeType: documentsTable.mimeType,
      fileContent: documentsTable.fileContent,
      extractedText: documentsTable.extractedText,
    }).from(documentsTable)
      .where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));

    if (!doc) { res.status(404).json({ error: "Document introuvable" }); return; }

    const selectedModels: Array<"gemini" | "openai" | "claude"> = Array.isArray(models) && models.length > 0
      ? models.filter(m => ["gemini", "openai", "claude"].includes(m))
      : ["gemini", "openai", "claude"];

    const isImage = doc.mimeType?.startsWith("image/");
    const documentContext = doc.extractedText
      || (doc.mimeType === "text/plain" && doc.fileContent ? Buffer.from(doc.fileContent, "base64").toString("utf-8").slice(0, 15000) : "")
      || `Fichier: ${doc.originalName} (${doc.mimeType})`;

    const answers = await askDocumentQuestion(
      question,
      documentContext,
      doc.originalName,
      doc.mimeType,
      selectedModels,
      isImage && doc.fileContent ? doc.fileContent : undefined,
    );

    res.json({ success: true, question, answers });
  } catch (err: any) {
    logger.error({ err }, "Document Q&A error");
    res.status(500).json({ error: "Erreur lors de la question" });
  }
});

// ── IN-APP PREVIEW — returns extractedText + base64 for images ──────────────
router.get("/documents/:id/preview", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const docId = parseInt(String(req.params.id));
    if (isNaN(docId)) { res.status(400).json({ error: "ID invalide" }); return; }

    const [doc] = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, docId), eq(documentsTable.organisationId, orgId)));

    if (!doc) { res.status(404).json({ error: "Document introuvable" }); return; }

    const isImage = doc.mimeType?.startsWith("image/");
    const isText = doc.mimeType === "text/plain" || doc.mimeType === "application/json" || doc.mimeType === "text/xml" || doc.mimeType === "application/xml";

    res.json({
      id: doc.id,
      fileName: doc.originalName,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      entityType: doc.entityType,
      entityId: doc.entityId,
      category: doc.category,
      description: doc.description,
      tags: doc.tags,
      aiProcessed: doc.aiProcessed,
      aiAnalysis: doc.aiAnalysis,
      extractedText: doc.extractedText ?? null,
      extractedData: doc.extractedData ?? null,
      // For images: return the base64 so mobile can display inline
      imageBase64: isImage && doc.fileContent ? `data:${doc.mimeType};base64,${doc.fileContent}` : null,
      // For plain text files: also return decoded text content
      rawText: isText && doc.fileContent ? Buffer.from(doc.fileContent, "base64").toString("utf-8").slice(0, 500000) : null,
      status: doc.status,
      scanVerdict: doc.scanVerdict,
      scanEngine: doc.scanEngine,
      scanDetail: doc.scanDetail,
      scannedAt: doc.scannedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  } catch (err: any) {
    logger.error({ err }, "Document preview error");
    res.status(500).json({ error: "Erreur lors de la preview" });
  }
});

// ── SEARCH ACROSS ENTITY TYPE ────────────────────────────────────────────────
router.get("/documents/by-source", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const entityType = req.query.entityType ? String(req.query.entityType) : undefined;
    const search = req.query.q ? String(req.query.q) : undefined;
    const scanVerdict = req.query.scanVerdict ? String(req.query.scanVerdict) : undefined;
    const limit = Math.min(parseInt(String(req.query.limit || "60")), 200);

    const conditions: any[] = [eq(documentsTable.organisationId, orgId)];
    if (entityType && entityType !== "all") conditions.push(eq(documentsTable.entityType, entityType));
    if (search) conditions.push(sql`(${documentsTable.originalName} ILIKE ${"%" + search + "%"} OR ${documentsTable.description} ILIKE ${"%" + search + "%"})`);
    if (scanVerdict && scanVerdict !== "all") {
      if (scanVerdict === "none") conditions.push(sql`${documentsTable.scanVerdict} IS NULL`);
      else conditions.push(eq(documentsTable.scanVerdict, scanVerdict));
    }

    const docs = await db.select({
      id: documentsTable.id,
      fileName: documentsTable.originalName,
      mimeType: documentsTable.mimeType,
      fileSize: documentsTable.fileSize,
      entityType: documentsTable.entityType,
      entityId: documentsTable.entityId,
      category: documentsTable.category,
      description: documentsTable.description,
      tags: documentsTable.tags,
      aiProcessed: documentsTable.aiProcessed,
      status: documentsTable.status,
      scanVerdict: documentsTable.scanVerdict,
      scanEngine: documentsTable.scanEngine,
      scannedAt: documentsTable.scannedAt,
      uploadedBy: documentsTable.uploadedBy,
      createdAt: documentsTable.createdAt,
      hasText: sql<boolean>`(${documentsTable.extractedText} IS NOT NULL AND length(${documentsTable.extractedText}) > 0)`,
    }).from(documentsTable)
      .where(and(...conditions))
      .orderBy(desc(documentsTable.createdAt))
      .limit(limit);

    // Count by entity type
    const bySource = await db.execute(sql`
      SELECT coalesce(entity_type, 'general') as entity_type, count(*)::int as count
      FROM documents WHERE organisation_id = ${orgId}
      GROUP BY coalesce(entity_type, 'general') ORDER BY count DESC
    `);

    // Count by scan verdict (safe / dangerous / unscanned) across the whole org
    const [scanCounts] = await db.select({
      safe: sql<number>`count(*) FILTER (WHERE ${documentsTable.scanVerdict} = 'safe')::int`,
      dangerous: sql<number>`count(*) FILTER (WHERE ${documentsTable.scanVerdict} = 'dangerous')::int`,
      unscanned: sql<number>`count(*) FILTER (WHERE ${documentsTable.scanVerdict} IS NULL)::int`,
    }).from(documentsTable).where(eq(documentsTable.organisationId, orgId));

    res.json({
      documents: docs.map(d => ({
        ...d,
        fileSizeFormatted: d.fileSize ? (d.fileSize > 1048576 ? `${(d.fileSize / 1048576).toFixed(1)} Mo` : `${Math.ceil(d.fileSize / 1024)} Ko`) : "—",
      })),
      total: docs.length,
      bySource: (bySource as any).rows ?? [],
      byScan: {
        safe: scanCounts?.safe ?? 0,
        dangerous: scanCounts?.dangerous ?? 0,
        unscanned: scanCounts?.unscanned ?? 0,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Documents by-source error");
    res.status(500).json({ error: "Erreur" });
  }
});

export default router;
