import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { GEMINI_FLASH_MODEL, sanitizePromptInput } from "../services/ai-utils";
import { analyzeUrlsBatch } from "../services/url-safety";
import { applyDomainListToUrl } from "../services/security-lists";
import { recordSecurityScan } from "../services/security-scans";
import { emitSecurityAlert } from "../services/security-alerts";
import { getInboundMaxSubmitBytes } from "../services/file-malware";
import { getOrgId } from "../middleware/tenant";
import { ingestDocument } from "../services/document-ingest";
import { triggerExpenseCapture } from "../services/expense-capture";
import { getGmailForUser, handleGoogleApiError } from "../lib/google-auth";
import { detectPii, type PiiKind } from "../services/pii-detection";

const router = Router();

// Categories declenchant une confirmation avant envoi. `email` et `phone` sont
// volontairement exclus: tout mail professionnel en contient, les signaler
// rendrait l'avertissement insignifiant. SIRET/SIREN sont des identifiants
// d'entreprise publics, donc non sensibles.
const DLP_SENSITIVE_KINDS = new Set<PiiKind>(["iban", "card", "nir"]);

/**
 * Controle DLP applique a TOUT depart de courrier (envoi comme reponse).
 * Renvoie `true` quand la reponse a deja ete envoyee et que l'appelant doit
 * s'arreter. L'envoi n'est jamais interdit — transmettre un IBAN est parfois
 * legitime — mais il exige une confirmation explicite au lieu de partir en
 * silence, et la tentative est tracee dans le journal de securite.
 */
function dlpBlocksOutgoing(
  req: Request,
  res: Response,
  userId: number,
  to: string,
  subject: string,
  body: string,
): boolean {
  const sensitive = detectPii(`${subject}\n${body}`).findings
    .filter((f) => DLP_SENSITIVE_KINDS.has(f.kind));
  if (sensitive.length === 0) return false;

  const orgId = getOrgId(req);
  const detail = sensitive.map((f) => `${f.label} (${f.count})`).join(", ");
  if (orgId) {
    recordSecurityScan({
      orgId, userId, kind: "email", target: String(to).slice(0, 300),
      verdict: "suspicious", details: `Donnees sensibles sortantes: ${detail}`,
      engine: "DLP",
    });
  }
  if (req.body?.confirmSensitive === true) return false;

  res.status(409).json({
    error: "donnees_sensibles",
    message: `Cet e-mail contient des données sensibles : ${detail}. Confirmez l'envoi si c'est volontaire.`,
    findings: sensitive,
  });
  return true;
}

function decodeEmailBody(payload: any): { html: string; plain: string } {
  let html = "";
  let plain = "";

  function walk(part: any) {
    if (!part) return;
    if (part.mimeType === "text/html" && part.body?.data) {
      html = Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.mimeType === "text/plain" && part.body?.data) {
      plain = Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.body?.data && !html && !plain) {
      plain = Buffer.from(part.body.data, "base64").toString("utf-8");
    }
    if (part.parts) {
      for (const p of part.parts) walk(p);
    }
  }

  walk(payload);
  return { html, plain };
}

function parseHeaders(headers: any[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers || []) {
    result[(h.name as string).toLowerCase()] = h.value as string;
  }
  return result;
}

function getAttachments(payload: any): any[] {
  const attachments: any[] = [];
  function walk(part: any) {
    if (!part) return;
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body?.size || 0,
        attachmentId: part.body.attachmentId,
      });
    }
    if (part.parts) for (const p of part.parts) walk(p);
  }
  walk(payload);
  return attachments;
}

router.get("/gmail/profile", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.json({ authenticated: false }); return; }
    const profile = await gmail.users.getProfile({ userId: "me" });
    res.json({
      authenticated: true,
      email: profile.data.emailAddress,
      messagesTotal: profile.data.messagesTotal,
      threadsTotal: profile.data.threadsTotal,
    });
  } catch (error: any) {
    // Autorisation revoquee : on purge le jeton mort pour que le hub Workspace
    // cesse d'afficher "connecte" alors que plus rien ne fonctionne.
    const userId = req.session?.userId;
    if (userId && await handleGoogleApiError(userId, error, "gmail/profile")) {
      res.json({ authenticated: false, reconnectRequired: true });
      return;
    }
    logger.error({ err: error }, "Gmail profile error");
    res.json({ authenticated: false });
  }
});

router.get("/gmail/inbox", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.json({ emails: [], authenticated: false }); return; }

    const { q = "is:inbox", maxResults = "25", pageToken } = req.query;

    const listRes = await gmail.users.messages.list({
      userId: "me",
      maxResults: Math.min(Math.max(parseInt(String(maxResults)) || 25, 1), 50),
      q: String(q),
      ...(pageToken ? { pageToken: String(pageToken) } : {}),
    });

    const messages = listRes.data.messages || [];
    const emails = await Promise.all(
      messages.map(async (msg) => {
        try {
          const detail = await gmail.users.messages.get({
            userId: "me", id: msg.id!, format: "metadata",
            metadataHeaders: ["Subject", "From", "To", "Date"],
          });
          const headers = parseHeaders(detail.data.payload?.headers || []);
          const labelIds = detail.data.labelIds || [];
          const hasParts = detail.data.payload?.parts || [];
          return {
            id: msg.id,
            threadId: detail.data.threadId,
            subject: headers["subject"] || "(Sans objet)",
            from: headers["from"] || "",
            to: headers["to"] || "",
            date: headers["date"] || "",
            snippet: detail.data.snippet || "",
            unread: labelIds.includes("UNREAD"),
            starred: labelIds.includes("STARRED"),
            hasAttachment: hasParts.some((p: any) => p.filename && p.filename.length > 0),
            labels: labelIds,
          };
        } catch { return null; }
      })
    );

    res.json({
      authenticated: true,
      emails: emails.filter(Boolean),
      nextPageToken: listRes.data.nextPageToken || null,
      resultSizeEstimate: listRes.data.resultSizeEstimate || 0,
    });
  } catch (error: any) {
    // Autorisation revoquee cote Google: on supprime le jeton mort et on le DIT.
    // Sans cela l'interface continuait d'afficher "connecte" avec une boite
    // vide et un simple "Erreur", sans jamais indiquer qu'il fallait
    // reconnecter le compte.
    const userId = req.session?.userId;
    if (userId && await handleGoogleApiError(userId, error, "gmail/inbox")) {
      res.status(401).json({
        error: "L'acces a votre compte Google a expire ou a ete revoque. Reconnectez votre compte Google dans Parametres > Plateformes.",
        authenticated: false,
        reconnectRequired: true,
      });
      return;
    }
    logger.error({ err: error }, "Gmail inbox error");
    res.status(500).json({ error: "Erreur lors de la recuperation des emails.", authenticated: false });
  }
});

router.get("/gmail/message/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(403).json({ error: "non_connecte" }); return; }

    const msgId = String(req.params.id);
    const detailRes = await (gmail.users.messages as any).get({ userId: "me", id: msgId, format: "full" });
    const detail = detailRes.data;
    const headers = parseHeaders(detail.payload?.headers || []);
    const { html, plain } = decodeEmailBody(detail.payload);
    const attachments = getAttachments(detail.payload);
    const labelIds: string[] = detail.labelIds || [];

    if (labelIds.includes("UNREAD")) {
      (gmail.users.messages as any).modify({
        userId: "me", id: msgId,
        requestBody: { removeLabelIds: ["UNREAD"] },
      }).catch(() => {});
    }

    res.json({
      id: detail.id,
      threadId: detail.threadId,
      subject: headers["subject"] || "(Sans objet)",
      from: headers["from"] || "",
      to: headers["to"] || "",
      cc: headers["cc"] || "",
      date: headers["date"] || "",
      messageId: headers["message-id"] || "",
      bodyHtml: html,
      bodyPlain: plain,
      snippet: detail.snippet || "",
      unread: false,
      starred: labelIds.includes("STARRED"),
      attachments,
      labels: labelIds,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Gmail message fetch error");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'email." });
  }
});

router.get("/gmail/thread/:threadId", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(403).json({ error: "non_connecte" }); return; }

    const threadId = String(req.params.threadId);
    const threadRes = await (gmail.users.threads as any).get({ userId: "me", id: threadId, format: "full" });
    const threadData = threadRes.data;

    const messages = ((threadData.messages as any[]) || []).map((msg: any) => {
      const headers = parseHeaders(msg.payload?.headers || []);
      const { html, plain } = decodeEmailBody(msg.payload);
      return {
        id: msg.id,
        threadId: msg.threadId,
        subject: headers["subject"] || "(Sans objet)",
        from: headers["from"] || "",
        to: headers["to"] || "",
        date: headers["date"] || "",
        messageId: headers["message-id"] || "",
        bodyHtml: html,
        bodyPlain: plain,
        snippet: msg.snippet || "",
        unread: (msg.labelIds || []).includes("UNREAD"),
        labels: msg.labelIds || [],
      };
    });

    res.json({ threadId, messages });
  } catch (error: any) {
    logger.error({ err: error }, "Gmail thread error");
    res.status(500).json({ error: "Erreur lors de la recuperation du fil." });
  }
});

router.post("/gmail/send", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(403).json({ error: "non_connecte" }); return; }

    const { to, subject, body, cc, bcc, isHtml = true } = req.body;
    if (!to || !subject || !body) {
      res.status(400).json({ error: "Destinataire, objet et corps requis." }); return;
    }

    if (dlpBlocksOutgoing(req, res, userId, to, subject, body)) return;

    const profile = await gmail.users.getProfile({ userId: "me" });
    const fromEmail = profile.data.emailAddress;
    const contentType = isHtml ? "text/html" : "text/plain";

    const emailLines = [
      `From: ${fromEmail}`,
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      ...(bcc ? [`Bcc: ${bcc}`] : []),
      `Subject: =?utf-8?B?${Buffer.from(subject).toString("base64")}?=`,
      `Content-Type: ${contentType}; charset=utf-8`,
      `MIME-Version: 1.0`,
      "",
      body,
    ];

    const raw = Buffer.from(emailLines.join("\r\n")).toString("base64url");
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    res.json({ success: true, message: "Email envoye avec succes." });
  } catch (error: any) {
    logger.error({ err: error }, "Gmail send error");
    res.status(500).json({ error: "Erreur lors de l'envoi de l'email." });
  }
});

router.post("/gmail/reply", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(403).json({ error: "non_connecte" }); return; }

    const { messageId, threadId, to, subject, body, cc } = req.body;
    if (!to || !body) {
      res.status(400).json({ error: "Destinataire et corps requis." }); return;
    }

    if (dlpBlocksOutgoing(req, res, userId, to, subject || "", body)) return;

    const profile = await gmail.users.getProfile({ userId: "me" });
    const fromEmail = profile.data.emailAddress;
    const replySubject = subject?.startsWith("Re:") ? subject : `Re: ${subject || ""}`;

    const emailLines = [
      `From: ${fromEmail}`,
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: =?utf-8?B?${Buffer.from(replySubject).toString("base64")}?=`,
      ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${messageId}`] : []),
      `Content-Type: text/html; charset=utf-8`,
      `MIME-Version: 1.0`,
      "",
      body,
    ];

    const raw = Buffer.from(emailLines.join("\r\n")).toString("base64url");
    await gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId } });
    res.json({ success: true, message: "Reponse envoyee avec succes." });
  } catch (error: any) {
    logger.error({ err: error }, "Gmail reply error");
    res.status(500).json({ error: "Erreur lors de l'envoi de la reponse." });
  }
});

router.patch("/gmail/message/:id/star", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(403).json({ error: "non_connecte" }); return; }

    const id = String(req.params.id);
    const { starred } = req.body;

    await (gmail.users.messages as any).modify({
      userId: "me", id,
      requestBody: starred ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] },
    });
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ err: error }, "Gmail star error");
    res.status(500).json({ error: "Erreur." });
  }
});

router.patch("/gmail/message/:id/read", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(403).json({ error: "non_connecte" }); return; }

    const id = String(req.params.id);
    const { read = true } = req.body;

    await (gmail.users.messages as any).modify({
      userId: "me", id,
      requestBody: read ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] },
    });
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ err: error }, "Gmail read error");
    res.status(500).json({ error: "Erreur." });
  }
});

router.post("/gmail/message/:id/archive", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(403).json({ error: "non_connecte" }); return; }

    const id = String(req.params.id);
    await (gmail.users.messages as any).modify({
      userId: "me", id,
      requestBody: { removeLabelIds: ["INBOX"] },
    });
    res.json({ success: true, message: "Email archive." });
  } catch (error: any) {
    logger.error({ err: error }, "Gmail archive error");
    res.status(500).json({ error: "Erreur lors de l'archivage." });
  }
});

// Telecharge une piece jointe Gmail. Retourne le binaire avec
// Content-Disposition: attachment, donc le navigateur declenche le
// telechargement directement (pas besoin de manipulation cote client
// au-dela d'un <a download>). On exige les 2 parametres dans l'URL et
// on relit la liste d'attachments du message pour valider l'existence
// + recuperer filename/mimeType. Cela evite qu'un attaquant tape n'importe
// quel attachmentId pour exfiltrer une piece jointe d'un autre message.
router.get("/gmail/message/:id/attachment/:attId", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(403).json({ error: "non_connecte" }); return; }

    const msgId = String(req.params.id);
    const attId = String(req.params.attId);

    // 1) Relit le message pour retrouver l'attachment et son filename.
    const detailRes = await (gmail.users.messages as any).get({ userId: "me", id: msgId, format: "full" });
    const meta = getAttachments(detailRes.data?.payload).find((a: any) => a.attachmentId === attId);
    if (!meta) { res.status(404).json({ error: "Piece jointe introuvable." }); return; }

    // 2) Telecharge le binaire base64url depuis Gmail.
    const attRes = await (gmail.users.messages.attachments as any).get({
      userId: "me", messageId: msgId, id: attId,
    });
    const dataB64 = attRes.data?.data || "";
    const buf = Buffer.from(dataB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");

    // 3) Renvoie le fichier — quote le filename pour gerer les espaces/accents.
    const safeName = meta.filename.replace(/"/g, "");
    res.setHeader("Content-Type", meta.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("Content-Length", String(buf.length));
    res.send(buf);
  } catch (error: any) {
    req.log.error({ err: error }, "Gmail attachment download error");
    res.status(500).json({ error: "Erreur lors du telechargement de la piece jointe." });
  }
});

// Enregistre une piece jointe Gmail dans la bibliotheque de documents et la
// passe par le MEME pipeline d'ingestion/scan que l'upload UI (validation +
// garde heuristique + analyse antivirus en arriere-plan). On relit la liste des
// attachments du message pour valider l'attachmentId (anti-exfiltration) et
// recuperer filename/mimeType avant de telecharger les octets.
router.post("/gmail/message/:id/attachment/:attId/save", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const orgId = getOrgId(req);
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(403).json({ error: "non_connecte" }); return; }

    const msgId = String(req.params.id);
    const attId = String(req.params.attId);

    const detailRes = await (gmail.users.messages as any).get({ userId: "me", id: msgId, format: "full" });
    const payload = detailRes.data?.payload;
    const meta = getAttachments(payload).find((a: any) => a.attachmentId === attId);
    if (!meta) { res.status(404).json({ error: "Piece jointe introuvable." }); return; }

    const headers = parseHeaders(payload?.headers || []);
    const subject = headers["subject"] || "(sans objet)";
    const from = headers["from"] || "";

    const attRes = await (gmail.users.messages.attachments as any).get({
      userId: "me", messageId: msgId, id: attId,
    });
    const dataB64 = attRes.data?.data || "";
    // Gmail renvoie du base64url -> on normalise en base64 standard.
    const buf = Buffer.from(dataB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const fileContent = buf.toString("base64");

    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket?.remoteAddress || "unknown";

    const ingest = await ingestDocument({
      orgId,
      userId,
      fileContent,
      fileName: meta.filename,
      mimeType: meta.mimeType,
      entityType: "message",
      category: "email",
      description: `Piece jointe Gmail — ${subject}${from ? ` (de ${from})` : ""}`,
      source: "gmail",
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

    // Capture automatique des dépenses depuis la pièce jointe e-mail (file
    // d'inspection). Fire-and-forget : n'impacte pas la sauvegarde.
    triggerExpenseCapture({
      docId: ingest.doc.id,
      orgId,
      userId,
      fileContent,
      mimeType: ingest.doc.mimeType,
      fileName: meta.filename,
      source: "gmail",
    });

    res.json({
      success: true,
      document: {
        id: ingest.doc.id,
        fileName: ingest.doc.originalName,
        mimeType: ingest.doc.mimeType,
        fileSize: ingest.doc.fileSize,
      },
    });
  } catch (error: any) {
    req.log.error({ err: error }, "Gmail attachment save error");
    res.status(500).json({ error: "Erreur lors de l'enregistrement de la piece jointe." });
  }
});

router.delete("/gmail/message/:id/trash", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(403).json({ error: "non_connecte" }); return; }

    const id = String(req.params.id);
    await (gmail.users.messages as any).trash({ userId: "me", id });
    res.json({ success: true, message: "Email deplace vers la corbeille." });
  } catch (error: any) {
    logger.error({ err: error }, "Gmail trash error");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

// ── URL phishing analysis helpers ────────────────────────────────────────────
const URL_SHORTENERS = new Set([
  "bit.ly","tinyurl.com","t.co","ow.ly","goo.gl","buff.ly","dlvr.it",
  "is.gd","cli.gs","yfrog.com","migre.me","ff.im","tiny.cc","url4.eu",
  "twit.ac","su.pr","twurl.nl","snipurl.com","short.to","BudURL.com",
  "ping.fm","post.ly","Just.as","bkite.com","snipr.com","fic.kr","loopt.us",
  "doiop.com","short.ie","kl.am","wp.me","rubyurl.com","om.ly","to.ly",
  "cutt.ly","rebrand.ly","shorturl.at","tinycc.com","hyperurl.co",
]);

const SUSPICIOUS_TLDS = new Set([
  ".tk",".ml",".ga",".cf",".gq",".xyz",".top",".club",".work",".date",
  ".review",".stream",".download",".win",".loan",".bid",".racing",".trade",
  ".accountant",".science",".faith",".party",".cricket",".trade",
]);

const SUSPICIOUS_PATTERNS = [
  { pattern: /paypa[1l]/i,       name: "Lookalike 'PayPal'" },
  { pattern: /micros[o0]ft/i,    name: "Lookalike 'Microsoft'" },
  { pattern: /app[1l]e/i,        name: "Lookalike 'Apple'" },
  { pattern: /g[o0]{2}gle/i,     name: "Lookalike 'Google'" },
  { pattern: /amaz[o0]n/i,       name: "Lookalike 'Amazon'" },
  { pattern: /faceb[o0]{2}k/i,   name: "Lookalike 'Facebook'" },
  { pattern: /netf[1l]ix/i,      name: "Lookalike 'Netflix'" },
  { pattern: /[a-z0-9-]+@[a-z0-9-]+\.[a-z]{2,}\.[a-z]{2,}/i, name: "Sous-domaine suspect" },
  { pattern: /secure|verify|update|confirm|login|signin|account|password|credential|urgent|suspend/i, name: "Mot-clé phishing" },
  { pattern: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,           name: "Adresse IP dans l'URL" },
  { pattern: /xn--/,                                            name: "Domaine punycode (Unicode spoofing)" },
];

interface UrlScanResult {
  url: string;
  displayUrl: string;
  domain: string;
  risk: "safe" | "suspicious" | "dangerous";
  reasons: string[];
  isShortener: boolean;
  isHttps: boolean;
  /** Source ayant determine le verdict le plus eleve (heuristique / Safe Browsing). */
  source?: "heuristic" | "safe_browsing";
  /** Types de menace renvoyes par Safe Browsing, si applicable. */
  threatTypes?: string[];
}

// F5: authentification de l'expediteur (anti-usurpation). On lit l'en-tete
// "Authentication-Results" pose par Gmail (SPF/DKIM/DMARC deja verifies cote
// Google) plutot que de refaire la cryptographie nous-memes.
type AuthVerdict =
  | "pass" | "fail" | "softfail" | "neutral" | "none"
  | "temperror" | "permerror" | "unknown";

interface SenderAuth {
  spf: AuthVerdict;
  dkim: AuthVerdict;
  dmarc: AuthVerdict;
  /** true si au moins un mecanisme echoue ou est en erreur (hors pass/neutral/none). */
  suspicious: boolean;
  reasons: string[];
}

const AUTH_VERDICTS: ReadonlySet<AuthVerdict> = new Set<AuthVerdict>([
  "pass", "fail", "softfail", "neutral", "none", "temperror", "permerror",
]);

function parseAuthVerdict(raw: string | undefined, mechanism: string): AuthVerdict {
  if (!raw) return "unknown";
  // RFC 8601: "spf=pass", tolere espaces autour du "=" et la casse. Les
  // en-tetes peuvent etre replies (folded) sur plusieurs lignes -> on
  // normalise les espaces/retours a la ligne en espace simple.
  const normalized = raw.replace(/\s+/g, " ");
  const re = new RegExp(`(?:^|[;\\s])${mechanism}\\s*=\\s*([a-zA-Z]+)`, "i");
  const m = normalized.match(re);
  if (!m) return "unknown";
  const v = m[1].toLowerCase() as AuthVerdict;
  return AUTH_VERDICTS.has(v) ? v : "unknown";
}

/** Un mecanisme est en echec/erreur s'il n'est ni pass, ni neutral/none, ni inconnu. */
function isAuthFailure(v: AuthVerdict): boolean {
  return v === "fail" || v === "softfail" || v === "temperror" || v === "permerror";
}

function analyzeSenderAuth(authResults: string | undefined): SenderAuth {
  const spf = parseAuthVerdict(authResults, "spf");
  const dkim = parseAuthVerdict(authResults, "dkim");
  const dmarc = parseAuthVerdict(authResults, "dmarc");
  const reasons: string[] = [];
  if (isAuthFailure(spf)) reasons.push("SPF en echec (serveur d'envoi non autorise)");
  if (isAuthFailure(dkim)) reasons.push("Signature DKIM invalide ou non verifiable");
  if (isAuthFailure(dmarc)) reasons.push("DMARC en echec (usurpation probable du domaine)");
  if (!authResults) reasons.push("Aucune information d'authentification disponible");
  const suspicious = isAuthFailure(spf) || isAuthFailure(dkim) || isAuthFailure(dmarc);
  return { spf, dkim, dmarc, suspicious, reasons };
}

function analyzeUrl(rawUrl: string): UrlScanResult {
  const reasons: string[] = [];
  let risk: UrlScanResult["risk"] = "safe";

  let parsed: URL | null = null;
  try { parsed = new URL(rawUrl); } catch { /* invalid */ }

  const domain = parsed?.hostname ?? rawUrl.slice(0, 60);
  const displayUrl = rawUrl.length > 80 ? rawUrl.slice(0, 77) + "…" : rawUrl;

  if (!parsed) {
    return { url: rawUrl, displayUrl, domain, risk: "suspicious", reasons: ["URL non parseable"], isShortener: false, isHttps: false };
  }

  const isHttps = parsed.protocol === "https:";
  if (!isHttps && parsed.protocol !== "data:") reasons.push("Connexion non sécurisée (HTTP)");

  const isShortener = URL_SHORTENERS.has(parsed.hostname.replace(/^www\./, ""));
  if (isShortener) reasons.push("Service de raccourcissement d'URL (destination inconnue)");

  const tld = "." + parsed.hostname.split(".").slice(-1)[0];
  if (SUSPICIOUS_TLDS.has(tld)) reasons.push(`TLD gratuit souvent utilisé pour le phishing (${tld})`);

  for (const sp of SUSPICIOUS_PATTERNS) {
    if (sp.pattern.test(rawUrl)) reasons.push(sp.name);
  }

  if (rawUrl.length > 300) reasons.push("URL anormalement longue");
  if ((parsed.hostname.match(/\./g) || []).length > 4) reasons.push("Trop de sous-domaines");

  if (reasons.length === 0) risk = "safe";
  else if (reasons.some(r => r.includes("Lookalike") || r.includes("phishing") || r.includes("IP") || r.includes("punycode"))) risk = "dangerous";
  else risk = "suspicious";

  return { url: rawUrl, displayUrl, domain, risk, reasons, isShortener, isHttps };
}

function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  const re = /https?:\/\/[^\s"'<>)]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const url = m[0].replace(/[.,;!?]+$/, "");
    if (url.length > 10) urls.add(url);
  }
  return [...urls].slice(0, 30);
}

export interface EmailScanReport {
  messageId: string;
  overallRisk: "safe" | "suspicious" | "dangerous";
  riskScore: number; // 0–100
  attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    safe: boolean;
    threats: string[];
    sha256: string;
    fileType: string | null;
    scannedAt: string;
    engine?: string;
    /** Origine d'un verdict externe (lookup d'empreinte vs soumission a chaud). */
    engineSource?: "lookup" | "upload";
  }>;
  links: UrlScanResult[];
  senderAuth: SenderAuth;
  aiAnalysis: {
    phishingScore: number; // 0–10
    socialEngineering: string[];
    impersonation: string | null;
    verdict: "legitime" | "suspect" | "phishing";
    summary: string;
    recommendation: string;
  } | null;
  stats: {
    attachmentsScanned: number;
    attachmentsThreatened: number;
    linksScanned: number;
    linksDangerous: number;
    linksSuspicious: number;
  };
  scannedAt: string;
}

router.post("/gmail/message/:id/scan", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(403).json({ error: "non_connecte" }); return; }

    const msgId = String(req.params.id);

    // 1. Fetch full message
    const detailRes = await (gmail.users.messages as any).get({ userId: "me", id: msgId, format: "full" });
    const detail = detailRes.data;
    const headers = parseHeaders(detail.payload?.headers || []);
    const { html, plain } = decodeEmailBody(detail.payload);
    const attachmentMeta = getAttachments(detail.payload);

    const bodyText = plain || html.replace(/<[^>]+>/g, " ") || detail.snippet || "";
    const subject = headers["subject"] || "";
    const fromHeader = headers["from"] || "";

    // F5: authentification de l'expediteur (SPF/DKIM/DMARC) — anti-usurpation.
    const senderAuth = analyzeSenderAuth(headers["authentication-results"]);

    // 2. Scan attachments
    const { scanBase64ContentFull } = await import("../middleware/security.js");
    const scannedAttachments: EmailScanReport["attachments"] = [];

    await Promise.all(attachmentMeta.map(async (att: any) => {
      try {
        const attRes = await (gmail.users.messages.attachments as any).get({
          userId: "me", messageId: msgId, id: att.attachmentId,
        });
        const base64Data: string = attRes.data?.data || "";
        // Scan profond (heuristique + VirusTotal). La soumission a chaud
        // (upload) est bornee par la taille entrante pour ne pas envoyer de
        // tres gros fichiers (perf + vie privee). Le lookup d'empreinte +
        // heuristique restent actifs quelle que soit la taille.
        const scanResult = await scanBase64ContentFull(base64Data, att.filename, {
          maxSubmitBytes: getInboundMaxSubmitBytes(),
        });
        scannedAttachments.push({
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          safe: scanResult.safe,
          threats: scanResult.threats,
          sha256: scanResult.sha256,
          fileType: scanResult.fileType,
          scannedAt: scanResult.scannedAt,
          engine: scanResult.engine,
          engineSource: scanResult.engineSource,
        });
      } catch (e: any) {
        scannedAttachments.push({
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          safe: false,
          threats: [`Impossible de télécharger la pièce jointe: ${e?.message ?? "erreur"}`],
          sha256: "",
          fileType: null,
          scannedAt: new Date().toISOString(),
        });
      }
    }));

    // 3. Extract & analyze URLs
    const allText = `${subject} ${html} ${plain}`;
    const rawUrls = extractUrls(allText);
    const orgId = req.session?.organisationId ?? null;
    // F5: analyse complete des liens (heuristique + Google Safe Browsing) puis
    // application des listes personnalisees de l'org (override blocage/autorisation).
    let scannedLinks: UrlScanResult[];
    try {
      const batch = await analyzeUrlsBatch(rawUrls);
      scannedLinks = orgId
        ? await Promise.all(batch.map((l) => applyDomainListToUrl(orgId, l)))
        : batch;
    } catch (linkErr: any) {
      logger.warn({ err: linkErr }, "Gmail scan link analysis failed, fallback heuristique");
      scannedLinks = rawUrls.map(analyzeUrl);
    }

    // 4. AI phishing analysis via Gemini (cached per message)
    let aiAnalysis: EmailScanReport["aiAnalysis"] = null;
    const { buildAiCacheKey: _buildKey, getCached: _getC, setCached: _setC, AI_CACHE_TTL: _ttl, withProviderTimeout: _to } = await import("../services/ai-cache");
    const phishingKey = _buildKey({
      route: "/gmail/scan",
      organisationId: orgId,
      userId,
      input: { msgId, subjectHash: subject.slice(0, 200), urlCount: rawUrls.length },
    });
    const phishingCached = _getC<EmailScanReport["aiAnalysis"]>(phishingKey);
    if (phishingCached) {
      aiAnalysis = phishingCached;
    } else {
      try {
        const { ai } = await import("@workspace/integrations-gemini-ai");
        // Every field below is fully attacker-controlled (this route's whole
        // purpose is judging a possibly-malicious email) — sanitize before
        // it reaches the prompt so a crafted email can't inject instructions
        // that suppress its own phishing verdict.
        const safeFromHeader = sanitizePromptInput(fromHeader, 300);
        const safeSubject = sanitizePromptInput(subject, 300);
        const safeBody = sanitizePromptInput(bodyText, 3000);
        const prompt = `Tu es un expert en cybersécurité. Analyse cet email pour détecter le phishing, l'ingénierie sociale et les tentatives d'usurpation d'identité.

DE: ${safeFromHeader}
OBJET: ${safeSubject}
CORPS (extrait): ${safeBody}

URLs détectées: ${rawUrls.slice(0, 10).join(", ")}

Réponds en JSON strict avec ce format:
{
  "phishingScore": <0-10, 0=légitime, 10=phishing confirmé>,
  "socialEngineering": [<liste de tactiques détectées, ex: "urgence artificielle", "menace de suspension", "promesse de gain">],
  "impersonation": <"nom de la marque usurpée ou null">,
  "verdict": <"legitime"|"suspect"|"phishing">,
  "summary": <"explication en 1-2 phrases">,
  "recommendation": <"action recommandée en 1 phrase">
}`;

        const result = await _to(() => ai.models.generateContent({
          model: GEMINI_FLASH_MODEL,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { temperature: 0.1, maxOutputTokens: 512 },
        }), { timeoutMs: 15_000, label: "gmail-scan" });

        const raw = result.text?.trim() ?? "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          aiAnalysis = {
            phishingScore: Math.max(0, Math.min(10, parsed.phishingScore ?? 0)),
            socialEngineering: Array.isArray(parsed.socialEngineering) ? parsed.socialEngineering : [],
            impersonation: parsed.impersonation ?? null,
            verdict: parsed.verdict ?? "legitime",
            summary: parsed.summary ?? "",
            recommendation: parsed.recommendation ?? "",
          };
          _setC(phishingKey, aiAnalysis, _ttl.VERY_LONG);
        }
      } catch (aiErr: any) {
        logger.warn({ err: aiErr }, "Gmail scan AI analysis failed (non-blocking)");
      }
    }

    // 5. Compute overall risk
    const hasUnsafeAttachment = scannedAttachments.some(a => !a.safe);
    const hasDangerousLink = scannedLinks.some(l => l.risk === "dangerous");
    const hasSuspiciousLink = scannedLinks.some(l => l.risk === "suspicious");
    const aiScore = aiAnalysis?.phishingScore ?? 0;

    let riskScore = 0;
    if (hasUnsafeAttachment) riskScore += 60;
    if (hasDangerousLink)    riskScore += 30;
    else if (hasSuspiciousLink) riskScore += 10;
    riskScore += aiScore * 4; // 0–40
    // F5: l'echec d'authentification de l'expediteur est un signal fort
    // d'usurpation (DMARC fail > SPF/DKIM fail).
    if (senderAuth.dmarc === "fail") riskScore += 25;
    else if (senderAuth.suspicious) riskScore += 12;
    riskScore = Math.min(100, riskScore);

    let overallRisk: EmailScanReport["overallRisk"] = "safe";
    if (riskScore >= 60 || aiAnalysis?.verdict === "phishing") overallRisk = "dangerous";
    else if (riskScore >= 25 || aiAnalysis?.verdict === "suspect" || senderAuth.suspicious) overallRisk = "suspicious";

    const report: EmailScanReport = {
      messageId: msgId,
      overallRisk,
      riskScore,
      attachments: scannedAttachments,
      links: scannedLinks,
      senderAuth,
      aiAnalysis,
      stats: {
        attachmentsScanned: scannedAttachments.length,
        attachmentsThreatened: scannedAttachments.filter(a => !a.safe).length,
        linksScanned: scannedLinks.length,
        linksDangerous: scannedLinks.filter(l => l.risk === "dangerous").length,
        linksSuspicious: scannedLinks.filter(l => l.risk === "suspicious").length,
      },
      scannedAt: new Date().toISOString(),
    };

    // F5: surface au Centre de securite (journal + alerte temps reel) lorsque
    // l'email est dangereux. Org-scope; fail-soft pour ne jamais casser le scan.
    if (orgId && overallRisk !== "safe") {
      const verdict = overallRisk === "dangerous" ? "dangerous" : "suspicious";
      const reasonBits = [
        aiAnalysis?.impersonation ? `usurpation ${aiAnalysis.impersonation}` : null,
        hasDangerousLink ? "lien dangereux" : null,
        hasUnsafeAttachment ? "piece jointe dangereuse" : null,
        senderAuth.suspicious ? "authentification expediteur en echec" : null,
      ].filter(Boolean);
      const detail = `Email a risque (${riskScore}/100)${reasonBits.length ? " — " + reasonBits.join(", ") : ""}`;
      try {
        recordSecurityScan({
          orgId, userId, kind: "email",
          target: (subject || fromHeader || msgId).slice(0, 120),
          verdict, details: detail,
        });
        if (verdict === "dangerous") {
          emitSecurityAlert({
            orgId, kind: "email", verdict: "dangerous",
            target: (subject || fromHeader || msgId).slice(0, 120),
            detail, notifyWhatsApp: true, excludeUserId: userId,
          });
        }
      } catch (centerErr: any) {
        logger.warn({ err: centerErr }, "Gmail scan: surface securite echouee (non-bloquant)");
      }
    }

    logger.info({ security: true, event: "email_scan", msgId, overallRisk, riskScore }, `Email scan: ${overallRisk}`);
    res.json(report);
  } catch (error: any) {
    logger.error({ err: error }, "Gmail scan error");
    res.status(500).json({ error: "Erreur lors du scan de sécurité." });
  }
});

router.get("/gmail/labels", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.json({ labels: [], authenticated: false }); return; }

    const labelsRes = await gmail.users.labels.list({ userId: "me" });

    const labels = (labelsRes.data.labels || [])
      .filter((l: any) => !["CHAT", "SPAM", "TRASH"].includes(l.id))
      .map((l: any) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        messagesUnread: l.messagesUnread || 0,
        messagesTotal: l.messagesTotal || 0,
      }));

    res.json({ authenticated: true, labels });
  } catch (error: any) {
    logger.error({ err: error }, "Gmail labels error");
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
