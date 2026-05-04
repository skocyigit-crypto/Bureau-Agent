import { Router, type Request, type Response } from "express";
import { google } from "googleapis";
import { db, googleOAuthTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

async function getAuthClient(userId: number) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const tokens = await db.select().from(googleOAuthTokensTable)
    .where(eq(googleOAuthTokensTable.userId, userId));
  if (tokens.length === 0) return null;

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
    `${process.env.APP_URL || "http://localhost"}/api/google-oauth/callback`;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    access_token: tokens[0].accessToken,
    refresh_token: tokens[0].refreshToken,
  });
  return oauth2Client;
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
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.json({ authenticated: false }); return; }
    const gmail = google.gmail({ version: "v1", auth });
    const profile = await gmail.users.getProfile({ userId: "me" });
    res.json({
      authenticated: true,
      email: profile.data.emailAddress,
      messagesTotal: profile.data.messagesTotal,
      threadsTotal: profile.data.threadsTotal,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Gmail profile error");
    res.json({ authenticated: false });
  }
});

router.get("/gmail/inbox", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.json({ emails: [], authenticated: false }); return; }

    const { q = "is:inbox", maxResults = "25", pageToken } = req.query;
    const gmail = google.gmail({ version: "v1", auth });

    const listRes = await gmail.users.messages.list({
      userId: "me",
      maxResults: Math.min(parseInt(String(maxResults)), 50),
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
    logger.error({ err: error }, "Gmail inbox error");
    res.status(500).json({ error: "Erreur lors de la recuperation des emails.", authenticated: false });
  }
});

router.get("/gmail/message/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.status(403).json({ error: "non_connecte" }); return; }

    const msgId = String(req.params.id);
    const gmail = google.gmail({ version: "v1", auth });
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
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.status(403).json({ error: "non_connecte" }); return; }

    const threadId = String(req.params.threadId);
    const gmail = google.gmail({ version: "v1", auth });
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
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.status(403).json({ error: "non_connecte" }); return; }

    const { to, subject, body, cc, bcc, isHtml = true } = req.body;
    if (!to || !subject || !body) {
      res.status(400).json({ error: "Destinataire, objet et corps requis." }); return;
    }

    const gmail = google.gmail({ version: "v1", auth });
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
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.status(403).json({ error: "non_connecte" }); return; }

    const { messageId, threadId, to, subject, body, cc } = req.body;
    if (!to || !body) {
      res.status(400).json({ error: "Destinataire et corps requis." }); return;
    }

    const gmail = google.gmail({ version: "v1", auth });
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
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.status(403).json({ error: "non_connecte" }); return; }

    const id = String(req.params.id);
    const { starred } = req.body;
    const gmail = google.gmail({ version: "v1", auth });

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
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.status(403).json({ error: "non_connecte" }); return; }

    const id = String(req.params.id);
    const { read = true } = req.body;
    const gmail = google.gmail({ version: "v1", auth });

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
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.status(403).json({ error: "non_connecte" }); return; }

    const id = String(req.params.id);
    const gmail = google.gmail({ version: "v1", auth });
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

router.delete("/gmail/message/:id/trash", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.status(403).json({ error: "non_connecte" }); return; }

    const id = String(req.params.id);
    const gmail = google.gmail({ version: "v1", auth });
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
  }>;
  links: UrlScanResult[];
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
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.status(403).json({ error: "non_connecte" }); return; }

    const msgId = String(req.params.id);
    const gmail = google.gmail({ version: "v1", auth });

    // 1. Fetch full message
    const detailRes = await (gmail.users.messages as any).get({ userId: "me", id: msgId, format: "full" });
    const detail = detailRes.data;
    const headers = parseHeaders(detail.payload?.headers || []);
    const { html, plain } = decodeEmailBody(detail.payload);
    const attachmentMeta = getAttachments(detail.payload);

    const bodyText = plain || html.replace(/<[^>]+>/g, " ") || detail.snippet || "";
    const subject = headers["subject"] || "";
    const fromHeader = headers["from"] || "";

    // 2. Scan attachments
    const { scanBase64Content } = await import("../middleware/security.js");
    const scannedAttachments: EmailScanReport["attachments"] = [];

    await Promise.all(attachmentMeta.map(async (att: any) => {
      try {
        const attRes = await (gmail.users.messages.attachments as any).get({
          userId: "me", messageId: msgId, id: att.attachmentId,
        });
        const base64Data: string = attRes.data?.data || "";
        const scanResult = scanBase64Content(base64Data, att.filename);
        scannedAttachments.push({
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          safe: scanResult.safe,
          threats: scanResult.threats,
          sha256: scanResult.sha256,
          fileType: scanResult.fileType,
          scannedAt: scanResult.scannedAt,
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
    const scannedLinks = rawUrls.map(analyzeUrl);

    // 4. AI phishing analysis via Gemini
    let aiAnalysis: EmailScanReport["aiAnalysis"] = null;
    try {
      const { ai } = await import("@workspace/integrations-gemini-ai");
      const prompt = `Tu es un expert en cybersécurité. Analyse cet email pour détecter le phishing, l'ingénierie sociale et les tentatives d'usurpation d'identité.

DE: ${fromHeader}
OBJET: ${subject}
CORPS (extrait): ${bodyText.slice(0, 3000)}

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

      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.1, maxOutputTokens: 512 },
      });

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
      }
    } catch (aiErr: any) {
      logger.warn({ err: aiErr }, "Gmail scan AI analysis failed (non-blocking)");
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
    riskScore = Math.min(100, riskScore);

    let overallRisk: EmailScanReport["overallRisk"] = "safe";
    if (riskScore >= 60 || aiAnalysis?.verdict === "phishing") overallRisk = "dangerous";
    else if (riskScore >= 25 || aiAnalysis?.verdict === "suspect") overallRisk = "suspicious";

    const report: EmailScanReport = {
      messageId: msgId,
      overallRisk,
      riskScore,
      attachments: scannedAttachments,
      links: scannedLinks,
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

    logger.info({ security: true, event: "email_scan", msgId, overallRisk, riskScore }, `Email scan: ${overallRisk}`);
    res.json(report);
  } catch (error: any) {
    logger.error({ err: error }, "Gmail scan error");
    res.status(500).json({ error: "Erreur lors du scan de sécurité." });
  }
});

router.get("/gmail/labels", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const auth = await getAuthClient(userId);
    if (!auth) { res.json({ labels: [], authenticated: false }); return; }

    const gmail = google.gmail({ version: "v1", auth });
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
