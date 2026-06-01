// Integration WhatsApp via Twilio.
//
// Webhook entrant: POST /api/whatsapp/twilio/inbound
// Twilio envoie chaque message WhatsApp recu sur le numero de l'organisation
// vers cette route. On identifie l'org via AccountSid, l'utilisateur via le
// numero "From", puis on route le texte dans le meme moteur d'assistant que
// l'app web/mobile (runAssistantTurn) et on repond en TwiML.
//
// Securite: signature Twilio verifiee par tenant (meme pattern que
// routes/telephony.ts). En l'absence d'AccountSid valide, on renvoie 403.

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  db,
  telephonyProvidersTable,
  usersTable,
  assistantConversationsTable,
} from "@workspace/db";
import { runAssistantTurn, type StreamEvent } from "../services/assistant-engine";
import { logger } from "../lib/logger";
import { analyzeUrlsBatch, extractUrls, type UrlScanResult } from "../services/url-safety";
import { scanBase64ContentFull } from "../middleware/security";
import { recordSecurityScan } from "../services/security-scans";
import { emitSecurityAlert } from "../services/security-alerts";

export const whatsappRouter: IRouter = Router();

// --- Idempotency ----------------------------------------------------------
//
// Twilio rejoue le webhook en cas de 5xx ou de timeout. Sans garde, chaque
// rejeu reexecute runAssistantTurn -> double consommation de quota IA et
// effets secondaires duplicats (creation de contacts, envois d'emails...).
// Cache in-memory simple : on stocke le MessageSid traite pendant 10 min.
// C'est suffisant car Twilio limite ses rejeus a une fenetre de quelques
// minutes. Pour une durcissement DB (multi-instance), voir TODO en bas du
// fichier WHATSAPP_SETUP.md.
const PROCESSED_MESSAGE_TTL_MS = 10 * 60 * 1000;
const processedMessages = new Map<string, number>();

function isAlreadyProcessed(messageSid: string): boolean {
  if (!messageSid) return false;
  const now = Date.now();
  // Purge opportuniste si la map grossit.
  if (processedMessages.size > 5000) {
    for (const [sid, ts] of processedMessages) {
      if (now - ts > PROCESSED_MESSAGE_TTL_MS) processedMessages.delete(sid);
    }
  }
  const seenAt = processedMessages.get(messageSid);
  if (seenAt && now - seenAt < PROCESSED_MESSAGE_TTL_MS) return true;
  return false;
}

function markProcessed(messageSid: string): void {
  if (messageSid) processedMessages.set(messageSid, Date.now());
}

// --- Helpers --------------------------------------------------------------

function validateTwilioSignature(req: Request, authToken: string): boolean {
  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!signature || !authToken) return false;
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
  const url = `${proto}://${host}${req.originalUrl}`;
  let urlWithParams = url;
  if (req.body && typeof req.body === "object") {
    const body = req.body as Record<string, string>;
    const sortedKeys = Object.keys(body).sort();
    for (const key of sortedKeys) {
      urlWithParams += key + (body[key] ?? "");
    }
  }
  const expected = crypto.createHmac("sha1", authToken).update(urlWithParams).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Normalise un numero pour matching: garde uniquement les chiffres, garde
 *  les 9 derniers (suffisant pour discriminer 06xxxxxxxx vs +33 6xxxxxxxx). */
function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.slice(-9);
}

/** Strippe le prefixe "whatsapp:" envoye par Twilio. */
function stripWhatsAppPrefix(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/^whatsapp:/i, "").trim();
}

/** Resout (orgId, authToken) depuis l'AccountSid Twilio. */
async function resolveTenantFromAccountSid(accountSid: string): Promise<
  Array<{ orgId: number; authToken: string }>
> {
  const matches = await db
    .select({
      orgId: telephonyProvidersTable.organisationId,
      config: telephonyProvidersTable.config,
    })
    .from(telephonyProvidersTable)
    .where(
      and(
        eq(telephonyProvidersTable.provider, "twilio"),
        eq(telephonyProvidersTable.isActive, true),
        sql`${telephonyProvidersTable.config}->>'accountSid' = ${accountSid}`,
      ),
    );
  return matches
    .map((m) => ({
      orgId: m.orgId as number,
      authToken: ((m.config as { authToken?: string } | null)?.authToken) ?? "",
    }))
    .filter((m) => m.authToken.length > 0);
}

/** Cherche un utilisateur de l'org dont le telephone correspond au From. */
async function findUserByPhone(orgId: number, fromPhone: string): Promise<number | null> {
  const target = normalizePhone(fromPhone);
  if (!target) return null;
  // Drizzle ne supporte pas directement le suffix-match cross-format, on charge
  // les utilisateurs actifs de l'org (volume modere) et on filtre cote node.
  const rows = await db
    .select({ id: usersTable.id, telephone: usersTable.telephone })
    .from(usersTable)
    .where(and(eq(usersTable.organisationId, orgId), eq(usersTable.actif, true)));
  for (const r of rows) {
    if (normalizePhone(r.telephone) === target) return r.id;
  }
  return null;
}

/** Trouve la derniere conversation assistant de l'user, ou en cree une. */
async function getOrCreateConversation(orgId: number, userId: number): Promise<number> {
  const [existing] = await db
    .select({ id: assistantConversationsTable.id })
    .from(assistantConversationsTable)
    .where(
      and(
        eq(assistantConversationsTable.organisationId, orgId),
        eq(assistantConversationsTable.userId, userId),
      ),
    )
    .orderBy(desc(assistantConversationsTable.updatedAt))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(assistantConversationsTable)
    .values({
      organisationId: orgId,
      userId,
      title: "WhatsApp",
    })
    .returning({ id: assistantConversationsTable.id });
  return created.id;
}

/** Echappe le XML pour la reponse TwiML. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twimlMessage(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(text)}</Message></Response>`;
}

function twimlEmpty(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

// --- Scanner de securite WhatsApp ----------------------------------------
//
// L'utilisateur peut transferer un lien ou un fichier suspect a son agent et
// recevoir un verdict immediat, AVANT que le message ne soit route vers
// l'assistant IA general. Trois declencheurs:
//   - media joint (image, PDF, doc...) -> antivirus heuristique
//   - message = une seule URL -> analyse de lien
//   - message prefixe par un mot-cle de scan (FR/TR) -> analyse des liens

const SCAN_KEYWORDS = /^(scan|tara|analyse|analyze|verifie|verifié|vérifie|check|guvenli mi|güvenli mi|tehlikeli mi|safe\??)\b/i;

const RISK_EMOJI: Record<UrlScanResult["risk"], string> = {
  safe: "✅",
  suspicious: "⚠️",
  dangerous: "🛑",
};

const RISK_LABEL: Record<UrlScanResult["risk"], string> = {
  safe: "SUR",
  suspicious: "SUSPECT",
  dangerous: "DANGEREUX",
};

function formatUrlVerdict(results: UrlScanResult[]): string {
  const lines: string[] = ["*Analyse de securite des liens*", ""];
  for (const r of results) {
    lines.push(`${RISK_EMOJI[r.risk]} ${RISK_LABEL[r.risk]} — ${r.domain}`);
    if (r.reasons.length > 0) {
      for (const reason of r.reasons.slice(0, 3)) lines.push(`  • ${reason}`);
    } else {
      lines.push("  • Aucun signal de risque detecte");
    }
    lines.push("");
  }
  const worst = results.some(r => r.risk === "dangerous")
    ? "Ne cliquez PAS sur ce lien."
    : results.some(r => r.risk === "suspicious")
      ? "Prudence : verifiez l'expediteur avant de cliquer."
      : "Aucun danger evident detecte, mais restez vigilant.";
  lines.push(worst);
  return lines.join("\n");
}

/** Telecharge un media Twilio (URL protegee, Basic Auth) en base64. */
async function fetchTwilioMediaBase64(
  url: string,
  accountSid: string,
  authToken: string,
): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(url, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 50 * 1024 * 1024) return null;
    return buf.toString("base64");
  } catch {
    return null;
  }
}

/**
 * Tente de traiter le message comme une demande de scan. Renvoie une reponse
 * texte si un scan a ete effectue, sinon null (le message sera route vers
 * l'assistant IA general).
 */
async function tryHandleSecurityScan(
  body: Record<string, string>,
  accountSid: string,
  authToken: string,
  orgId: number,
  userId: number,
): Promise<string | null> {
  const messageBody = (body.Body ?? "").trim();
  const numMedia = parseInt(body.NumMedia ?? "0", 10);

  // 1. Media joint -> antivirus
  if (numMedia > 0) {
    const verdicts: string[] = ["*Analyse antivirus des fichiers*", ""];
    let anyThreat = false;
    for (let i = 0; i < Math.min(numMedia, 5); i++) {
      const mediaUrl = body[`MediaUrl${i}`];
      const contentType = body[`MediaContentType${i}`] ?? "fichier";
      if (!mediaUrl) continue;
      const b64 = await fetchTwilioMediaBase64(mediaUrl, accountSid, authToken);
      if (!b64) {
        verdicts.push(`⚠️ Fichier ${i + 1} (${contentType}) : impossible a telecharger.`);
        continue;
      }
      const ext = contentType.split("/")[1] ?? "bin";
      const result = await scanBase64ContentFull(b64, `whatsapp-media-${i}.${ext}`);
      if (result.safe) {
        verdicts.push(`✅ Fichier ${i + 1} (${contentType}) : aucune menace detectee.`);
      } else {
        anyThreat = true;
        verdicts.push(`🛑 Fichier ${i + 1} (${contentType}) : DANGEREUX — ${result.threats.join(", ")}`);
      }
      recordSecurityScan({
        orgId, userId, kind: "whatsapp", target: `${contentType} (#${i + 1})`,
        verdict: result.safe ? "safe" : "dangerous", details: result.threats.join("; "),
        engine: result.engine,
      });
      // Detection automatique (message entrant) -> alerte temps reel + push
      // WhatsApp aux membres (l'expediteur recoit deja la reponse du bot).
      emitSecurityAlert({
        orgId, kind: "whatsapp", verdict: result.safe ? "safe" : "dangerous",
        target: `${contentType} (#${i + 1})`, detail: result.threats[0],
        notifyWhatsApp: true, excludeUserId: userId,
      });
    }
    verdicts.push("");
    verdicts.push(anyThreat ? "Ne pas ouvrir les fichiers signales." : "Fichiers verifies.");
    return verdicts.join("\n");
  }

  // 2. URL(s) dans le message (avec ou sans mot-cle de scan)
  const urls = extractUrls(messageBody);
  const hasScanKeyword = SCAN_KEYWORDS.test(messageBody);
  // Message qui n'est QU'une URL (eventuellement precedee d'un mot-cle).
  const stripped = messageBody.replace(SCAN_KEYWORDS, "").trim();
  const isOnlyUrl = urls.length > 0 && (stripped === urls[0] || stripped === "");

  if (urls.length > 0 && (hasScanKeyword || isOnlyUrl)) {
    const results = await analyzeUrlsBatch(urls.slice(0, 5));
    for (const r of results) {
      recordSecurityScan({
        orgId, userId, kind: "whatsapp", target: r.displayUrl,
        verdict: r.risk === "safe" ? "safe" : r.risk === "suspicious" ? "suspicious" : "dangerous",
        details: r.reasons.join("; "),
      });
      emitSecurityAlert({
        orgId, kind: "whatsapp", verdict: r.risk === "dangerous" ? "dangerous" : "safe",
        target: r.displayUrl, detail: r.reasons[0],
        notifyWhatsApp: true, excludeUserId: userId,
      });
    }
    return formatUrlVerdict(results);
  }

  return null;
}

// --- Webhook --------------------------------------------------------------

whatsappRouter.post("/whatsapp/twilio/inbound", async (req: Request, res: Response): Promise<void> => {
  res.type("text/xml");

  const body = (req.body ?? {}) as Record<string, string>;
  const accountSid = body.AccountSid;
  const fromRaw = body.From; // "whatsapp:+33612345678"
  const messageBody = (body.Body ?? "").trim();
  const numMedia = parseInt(body.NumMedia ?? "0", 10);
  const messageSid = body.MessageSid ?? body.SmsMessageSid ?? "";

  if (!accountSid || !fromRaw) {
    res.status(400).send(twimlEmpty());
    return;
  }

  // Idempotency : si Twilio rejoue le meme MessageSid, on renvoie 200 vide
  // (l'utilisateur a deja recu la reponse au premier passage).
  if (messageSid && isAlreadyProcessed(messageSid)) {
    res.status(200).send(twimlEmpty());
    return;
  }

  // 1. Tenant + signature
  const tenants = await resolveTenantFromAccountSid(accountSid);
  if (tenants.length === 0) {
    logger.warn({ accountSid }, "[whatsapp] inconnu AccountSid");
    res.status(403).send(twimlEmpty());
    return;
  }
  const tenant = tenants.find((t) => validateTwilioSignature(req, t.authToken));
  if (!tenant) {
    logger.warn({ accountSid }, "[whatsapp] signature invalide");
    res.status(403).send(twimlEmpty());
    return;
  }

  // 2. Identifier l'utilisateur
  const fromPhone = stripWhatsAppPrefix(fromRaw);
  const userId = await findUserByPhone(tenant.orgId, fromPhone);
  if (!userId) {
    logger.info({ orgId: tenant.orgId, fromPhone }, "[whatsapp] expediteur non lie a un utilisateur");
    res.status(200).send(
      twimlMessage(
        "Bonjour. Ce numero WhatsApp n'est pas encore lie a un compte Agent de Bureau. " +
          "Demandez a votre administrateur de renseigner votre numero dans votre profil utilisateur.",
      ),
    );
    return;
  }

  // 3. Scanner de securite (liens & fichiers) — court-circuite l'assistant IA
  //    si le message est une demande de scan ou contient un media/URL.
  try {
    const scanReply = await tryHandleSecurityScan(body, accountSid, tenant.authToken, tenant.orgId, userId);
    if (scanReply !== null) {
      markProcessed(messageSid);
      const MAX_LEN = 1500;
      const out = scanReply.length > MAX_LEN ? scanReply.slice(0, MAX_LEN) + "..." : scanReply;
      res.status(200).send(twimlMessage(out));
      return;
    }
  } catch (scanErr) {
    logger.warn({ err: scanErr, orgId: tenant.orgId }, "[whatsapp] echec scan securite");
  }

  // Si media sans texte exploitable et pas de scan effectue, on s'arrete la.
  if (numMedia > 0 && !messageBody) {
    res.status(200).send(twimlEmpty());
    return;
  }
  if (!messageBody) {
    res.status(200).send(twimlEmpty());
    return;
  }

  // 4. Conversation assistant + execution
  try {
    const conversationId = await getOrCreateConversation(tenant.orgId, userId);
    const textParts: string[] = [];
    let pendingConfirmation: string | null = null;
    let errorMessage: string | null = null;

    const emit = (e: StreamEvent): void => {
      if (e.type === "text") textParts.push(e.text);
      else if (e.type === "pending_action") pendingConfirmation = e.summary;
      else if (e.type === "error") errorMessage = e.error;
    };

    await runAssistantTurn(conversationId, messageBody, { orgId: tenant.orgId, userId }, emit);

    let reply: string;
    if (errorMessage) {
      reply = `Erreur: ${errorMessage}`;
    } else if (pendingConfirmation) {
      // En WhatsApp on ne peut pas faire de UI de confirmation, on demande
      // une reponse OUI/NON et on laisse l'utilisateur reformuler. Pour
      // l'instant on annonce simplement l'action prevue.
      reply =
        textParts.join("").trim() ||
        `J'allais executer: ${pendingConfirmation}. Repondez "oui" pour confirmer ou reformulez.`;
    } else {
      reply = textParts.join("").trim() || "(Pas de reponse generee)";
    }

    // Twilio WhatsApp impose une limite de 1600 caracteres par message.
    const MAX_LEN = 1500;
    const truncated = reply.length > MAX_LEN ? reply.slice(0, MAX_LEN) + "..." : reply;
    markProcessed(messageSid);
    res.status(200).send(twimlMessage(truncated));
  } catch (err) {
    logger.error({ err, orgId: tenant.orgId, userId }, "[whatsapp] echec runAssistantTurn");
    res
      .status(200)
      .send(twimlMessage("Desole, une erreur technique m'empeche de repondre. Reessayez dans un instant."));
  }
});
