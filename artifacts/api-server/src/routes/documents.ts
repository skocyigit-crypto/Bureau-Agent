import { Router, type Request, type Response } from "express";
import { db, documentsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { getOrgId } from "../middleware/tenant";
import { scanBase64Content, logSecurityEvent } from "../middleware/security";
import { logger } from "../lib/logger";
import { analyzeDocument } from "../services/document-ai";

const router = Router();
const requireMinAgent = requireRole("super_admin", "administrateur", "agent");

const ALLOWED_MIME_TYPES = [
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

const EXTENSION_MIME_MAP: Record<string, string> = {
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

const MAX_FILE_SIZE_MB = 25;

const VALID_ENTITY_TYPES = ["contact", "task", "message", "invoice", "devis", "prospect", "project", "stock", "event", "general"];

function resolveMime(fileName: string, provided: string): string {
  if (ALLOWED_MIME_TYPES.includes(provided)) return provided;
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  return EXTENSION_MIME_MAP[ext] || provided;
}

router.post("/documents/upload", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = (req.session as any)?.userId;
    const { fileContent, fileName, mimeType: rawMime, entityType, entityId, category, description, tags, analyzeWithAi } = req.body;

    if (!fileContent || !fileName) {
      res.status(400).json({ error: "fileContent et fileName sont requis" });
      return;
    }

    const mimeType = resolveMime(fileName, rawMime || "application/octet-stream");

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      res.status(400).json({ error: `Type de fichier non autorise: ${mimeType}` });
      return;
    }

    const buffer = Buffer.from(fileContent, "base64");
    if (buffer.length > MAX_FILE_SIZE_MB * 1024 * 1024) {
      res.status(400).json({ error: `Fichier trop volumineux. Maximum: ${MAX_FILE_SIZE_MB} Mo.` });
      return;
    }

    const scanResult = scanBase64Content(fileContent, fileName);
    if (!scanResult.safe) {
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket?.remoteAddress || "unknown";
      logSecurityEvent("malicious_upload_blocked", ip, userId, `Upload bloque: ${scanResult.threats.join(", ")}`, "critical");
      res.status(400).json({ error: "Fichier bloque pour raisons de securite.", threats: scanResult.threats });
      return;
    }

    if (entityType && !VALID_ENTITY_TYPES.includes(entityType)) {
      res.status(400).json({ error: `Type d'entite invalide. Types valides: ${VALID_ENTITY_TYPES.join(", ")}` });
      return;
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._\-\s()àâéèêëïîôùûüÿçÀÂÉÈÊËÏÎÔÙÛÜŸÇ]/g, "_");
    const storedName = `${Date.now()}_${safeName}`;

    const [doc] = await db.insert(documentsTable).values({
      organisationId: orgId,
      uploadedBy: userId || null,
      fileName: storedName,
      originalName: fileName,
      mimeType,
      fileSize: buffer.length,
      fileContent: fileContent,
      entityType: entityType || null,
      entityId: entityId ? parseInt(String(entityId)) : null,
      category: category || "general",
      description: description || null,
      tags: tags || [],
      status: "uploaded",
    }).returning();

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
    const userId = (req.session as any)?.userId;
    const { files, entityType, entityId, category } = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: "Un tableau de fichiers est requis" });
      return;
    }

    if (files.length > 20) {
      res.status(400).json({ error: "Maximum 20 fichiers par lot" });
      return;
    }

    const results: any[] = [];
    for (const file of files) {
      try {
        if (!file.fileContent || !file.fileName) {
          results.push({ fileName: file.fileName || "inconnu", success: false, error: "Contenu ou nom manquant" });
          continue;
        }

        const mimeType = resolveMime(file.fileName, file.mimeType || "application/octet-stream");
        const buffer = Buffer.from(file.fileContent, "base64");

        if (buffer.length > MAX_FILE_SIZE_MB * 1024 * 1024) {
          results.push({ fileName: file.fileName, success: false, error: "Fichier trop volumineux" });
          continue;
        }

        const scanResult = scanBase64Content(file.fileContent, file.fileName);
        if (!scanResult.safe) {
          results.push({ fileName: file.fileName, success: false, error: "Fichier bloque (securite)" });
          continue;
        }

        const storedName = `${Date.now()}_${file.fileName.replace(/[^a-zA-Z0-9._\-\s()]/g, "_")}`;

        const [doc] = await db.insert(documentsTable).values({
          organisationId: orgId,
          uploadedBy: userId || null,
          fileName: storedName,
          originalName: file.fileName,
          mimeType,
          fileSize: buffer.length,
          fileContent: file.fileContent,
          entityType: entityType || file.entityType || null,
          entityId: entityId ? parseInt(String(entityId)) : (file.entityId ? parseInt(String(file.entityId)) : null),
          category: category || file.category || "general",
          description: file.description || null,
          tags: file.tags || [],
          status: "uploaded",
        }).returning();

        results.push({ fileName: file.fileName, success: true, documentId: doc.id, fileSize: buffer.length });
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
    const limit = Math.min(parseInt(String(req.query.limit || "50")), 200);
    const offset = parseInt(String(req.query.offset || "0"));

    const conditions: any[] = [eq(documentsTable.organisationId, orgId)];
    if (entityType) conditions.push(eq(documentsTable.entityType, entityType));
    if (entityId && !isNaN(entityId)) conditions.push(eq(documentsTable.entityId, entityId));
    if (category) conditions.push(eq(documentsTable.category, category));

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

    const [total, byType, byCategory, totalSize] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(documentsTable).where(eq(documentsTable.organisationId, orgId)),
      db.execute(sql`SELECT entity_type, count(*)::int as count FROM documents WHERE organisation_id = ${orgId} AND entity_type IS NOT NULL GROUP BY entity_type ORDER BY count DESC`),
      db.execute(sql`SELECT category, count(*)::int as count FROM documents WHERE organisation_id = ${orgId} GROUP BY category ORDER BY count DESC`),
      db.select({ total: sql<number>`coalesce(sum(file_size), 0)::bigint` }).from(documentsTable).where(eq(documentsTable.organisationId, orgId)),
    ]);

    const totalBytes = Number(totalSize[0]?.total ?? 0);

    res.json({
      totalDocuments: total[0]?.count ?? 0,
      totalSize: totalBytes > 1048576 ? `${(totalBytes / 1048576).toFixed(1)} Mo` : `${(totalBytes / 1024).toFixed(0)} Ko`,
      totalSizeBytes: totalBytes,
      byEntityType: byType.rows,
      byCategory: byCategory.rows,
    });
  } catch (err: any) {
    logger.error({ err }, "Document stats error");
    res.status(500).json({ error: "Erreur" });
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
      status: doc.status,
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
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.originalName)}"`);
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

export default router;
