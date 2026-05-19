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

  // 3. Refus media (v1 texte uniquement)
  if (numMedia > 0 && !messageBody) {
    res.status(200).send(
      twimlMessage("Pour l'instant je ne traite que les messages texte. Reformulez votre demande, merci."),
    );
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
