import { Router } from "express";
import { analyzeDocument, executeDocumentAction, type SuggestedAction } from "../services/document-ai";
import { scanBase64Content, logSecurityEvent } from "../middleware/security";
import { getOrgId } from "../middleware/tenant";
import { logger } from "../lib/logger";

const router = Router();

const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
];

const MAX_FILE_SIZE_MB = 10;

router.post("/document-ai/analyze", async (req, res): Promise<void> => {
  const { fileContent, mimeType, fileName } = req.body;

  if (!fileContent || !mimeType || !fileName) {
    res.status(400).json({ error: "fileContent, mimeType et fileName sont requis." });
    return;
  }

  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    res.status(400).json({
      error: `Type de fichier non supporte: ${mimeType}. Types acceptes: PDF, PNG, JPEG, WebP, GIF, BMP, TIFF.`,
    });
    return;
  }

  const fileSizeBytes = Buffer.from(fileContent, "base64").length;
  if (fileSizeBytes > MAX_FILE_SIZE_MB * 1024 * 1024) {
    res.status(400).json({ error: `Le fichier depasse la taille maximale de ${MAX_FILE_SIZE_MB} Mo.` });
    return;
  }

  const scanResult = scanBase64Content(fileContent, fileName);
  if (!scanResult.safe) {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket?.remoteAddress || "unknown";
    logSecurityEvent("malicious_document_upload", ip, (req.session as any)?.userId, `Document IA bloque: ${scanResult.threats.join(", ")}`, "critical");
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

router.post("/document-ai/execute-action", async (req, res): Promise<void> => {
  const { action, extractedFields } = req.body;

  if (!action || !action.action || !action.module) {
    res.status(400).json({ error: "L'action est requise avec les champs 'action' et 'module'." });
    return;
  }

  const orgId = getOrgId(req);
  const userId = (req.session as any)?.userId;

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

router.post("/document-ai/batch-execute", async (req, res): Promise<void> => {
  const { actions, extractedFields } = req.body;

  if (!Array.isArray(actions) || actions.length === 0) {
    res.status(400).json({ error: "Un tableau d'actions est requis." });
    return;
  }

  const orgId = getOrgId(req);
  const userId = (req.session as any)?.userId;

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
