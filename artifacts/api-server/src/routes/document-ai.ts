import { Router } from "express";
import { analyzeDocument, executeDocumentAction, type SuggestedAction } from "../services/document-ai";
import { scanBase64ContentFull, logSecurityEvent } from "../middleware/security";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";

const router = Router();
const requireMinAgent = requireRole("super_admin", "administrateur", "agent");

const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "application/rtf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
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
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
};

const MAX_FILE_SIZE_MB = 25;

function resolveMimeType(fileName: string, providedMime: string): string {
  if (SUPPORTED_MIME_TYPES.includes(providedMime)) return providedMime;
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  return EXTENSION_MIME_MAP[ext] || providedMime;
}

router.post("/document-ai/analyze", requireMinAgent, async (req, res): Promise<void> => {
  const { fileContent, mimeType: rawMimeType, fileName } = req.body;

  if (!fileContent || !fileName) {
    res.status(400).json({ error: "fileContent et fileName sont requis." });
    return;
  }

  const mimeType = resolveMimeType(fileName, rawMimeType || "application/octet-stream");

  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    res.status(400).json({
      error: `Type de fichier non supporte: ${mimeType}. Types acceptes: PDF, images, Excel, CSV, Word, PowerPoint, texte.`,
      supportedTypes: Object.keys(EXTENSION_MIME_MAP).join(", "),
    });
    return;
  }

  const fileSizeBytes = Buffer.from(fileContent, "base64").length;
  if (fileSizeBytes > MAX_FILE_SIZE_MB * 1024 * 1024) {
    res.status(400).json({ error: `Le fichier depasse la taille maximale de ${MAX_FILE_SIZE_MB} Mo.` });
    return;
  }

  const scanResult = await scanBase64ContentFull(fileContent, fileName);
  if (!scanResult.safe) {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket?.remoteAddress || "unknown";
    logSecurityEvent("malicious_document_upload", ip, req.session?.userId ?? null, `Document IA bloque (${scanResult.engine}): ${scanResult.threats.join(", ")}`, "critical");
    res.status(400).json({
      error: "Le fichier contient du contenu potentiellement dangereux et a ete bloque.",
      threats: scanResult.threats,
      code: "FILE_THREAT_DETECTED",
    });
    return;
  }

  const orgId = getOrgId(req);

  try {
    const result = await analyzeDocument(fileContent, mimeType, fileName, orgId);
    logger.info({
      orgId,
      fileName,
      mimeType,
      documentType: result.documentType,
      confidence: result.confidence,
      destination: result.destination,
      actionsCount: result.suggestedActions.length,
      relatedEntitiesCount: result.relatedEntities.length,
    }, "Document AI: analyse terminee");

    res.json(result);
  } catch (err: any) {
    logger.error({ err, fileName, orgId }, "Document AI: erreur d'analyse");
    res.status(500).json({ error: "Erreur lors de l'analyse du document." });
  }
});

router.post("/document-ai/execute-action", requireMinAgent, async (req, res): Promise<void> => {
  const { action, extractedFields } = req.body;

  if (!action || !action.action || !action.module) {
    res.status(400).json({ error: "L'action est requise avec les champs 'action' et 'module'." });
    return;
  }

  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  try {
    const result = await executeDocumentAction(
      action as SuggestedAction,
      extractedFields || {},
      orgId,
      userId
    );

    logger.info({
      orgId,
      userId,
      action: action.action,
      module: action.module,
      success: result.success,
      createdId: result.createdId,
    }, "Document AI: action executee");

    res.json(result);
  } catch (err: any) {
    logger.error({ err, action, orgId }, "Document AI: erreur d'execution");
    res.status(500).json({ error: "Erreur lors de l'execution de l'action." });
  }
});

router.post("/document-ai/batch-execute", requireMinAgent, async (req, res): Promise<void> => {
  const { actions, extractedFields } = req.body;

  if (!Array.isArray(actions) || actions.length === 0) {
    res.status(400).json({ error: "Un tableau d'actions est requis." });
    return;
  }
  if (actions.length > 50) {
    res.status(400).json({ error: "Maximum 50 actions par lot." });
    return;
  }

  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const results = [];
  for (const action of actions) {
    try {
      const result = await executeDocumentAction(action, extractedFields || {}, orgId, userId);
      results.push(result);
    } catch (err: any) {
      results.push({
        success: false,
        module: action.module,
        action: action.action,
        message: `Erreur: ${err.message}`,
      });
    }
  }

  logger.info({
    orgId,
    userId,
    totalActions: actions.length,
    successCount: results.filter(r => r.success).length,
  }, "Document AI: batch d'actions executees");

  res.json({ results });
});

export default router;
