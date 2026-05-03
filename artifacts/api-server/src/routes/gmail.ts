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
