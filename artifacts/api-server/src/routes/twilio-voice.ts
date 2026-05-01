import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { db, telephonyProvidersTable, organisationsTable, callsTable, contactsTable, telephonyCallLogsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { assertAiQuota } from "../services/ai-quota";
import { recordAiUsage, sanitizePromptInput } from "../services/ai-utils";

export const twilioVoiceRouter: IRouter = Router();

// ---------------------------------------------------------------------------
// In-memory voice session store (keyed by Twilio CallSid)
// ---------------------------------------------------------------------------
interface VoiceSession {
  orgId: number;
  agentName: string;
  companyName: string;
  callDbId: number | null;
  callerNumber: string;
  history: Array<{ role: "caller" | "assistant"; text: string }>;
  expiresAt: number;
}

const sessions = new Map<string, VoiceSession>();

// Prune expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (s.expiresAt < now) sessions.delete(sid);
  }
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// TwiML helpers
// ---------------------------------------------------------------------------
function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twimlSay(text: string): string {
  return `<Say voice="alice" language="fr-FR">${xmlEscape(text)}</Say>`;
}

function twimlGather(actionUrl: string, prompt: string): string {
  return (
    `<Gather input="speech" language="fr-FR" speechTimeout="auto" ` +
    `maxSpeechTime="30" action="${xmlEscape(actionUrl)}" method="POST">` +
    twimlSay(prompt) +
    `</Gather>`
  );
}

function buildResponse(...parts: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${parts.join("")}</Response>`;
}

function sendTwiml(res: Response, ...parts: string[]): void {
  res.set("Content-Type", "text/xml");
  res.send(buildResponse(...parts));
}

// ---------------------------------------------------------------------------
// Twilio webhook signature validation
// ---------------------------------------------------------------------------
function validateTwilioSignature(req: Request, authToken: string): boolean {
  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!signature || !authToken) return false;

  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
  const url = `${proto}://${host}${req.originalUrl}`;

  let urlWithParams = url;
  if (req.body && typeof req.body === "object") {
    const sortedKeys = Object.keys(req.body as Record<string, string>).sort();
    for (const key of sortedKeys) {
      urlWithParams += key + ((req.body as Record<string, string>)[key] ?? "");
    }
  }

  const expected = crypto
    .createHmac("sha1", authToken)
    .update(urlWithParams)
    .digest("base64");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Identify organisation from Twilio "To" number
// ---------------------------------------------------------------------------
async function findSessionForNumber(toNumber: string, fromNumber: string): Promise<VoiceSession | null> {
  try {
    const providers = await db.select().from(telephonyProvidersTable)
      .where(eq(telephonyProvidersTable.provider, "twilio"));

    if (providers.length === 0) return null;

    let matched = providers.find(p => {
      const cfg = p.config as Record<string, string>;
      return cfg?.fromNumber === toNumber || cfg?.phoneNumber === toNumber;
    });

    // Fallback: single Twilio provider
    if (!matched && providers.length === 1) matched = providers[0];

    // Fallback: env phone number
    if (!matched) {
      const envNum = process.env.TWILIO_PHONE_NUMBER;
      if (envNum && (toNumber === envNum || !toNumber)) matched = providers[0];
    }

    if (!matched) return null;

    const orgId = matched.organisationId!;
    const [org] = await db
      .select({ name: organisationsTable.name, aiAgentName: organisationsTable.aiAgentName })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, orgId))
      .limit(1);

    return {
      orgId,
      agentName: org?.aiAgentName || "Sophie",
      companyName: org?.name || "Agent de Bureau",
      callDbId: null,
      callerNumber: fromNumber || "",
      history: [],
      expiresAt: Date.now() + 30 * 60 * 1000,
    };
  } catch (err) {
    logger.error({ err }, "[TwilioVoice] findSessionForNumber error");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Create a call record in DB for tracking
// ---------------------------------------------------------------------------
async function createCallRecord(
  orgId: number,
  callSid: string,
  callerNumber: string,
  providerId: number | null,
): Promise<number | null> {
  try {
    // Try to match caller to a contact by phone number
    const [contact] = callerNumber
      ? await db
          .select({ id: contactsTable.id })
          .from(contactsTable)
          .where(eq(contactsTable.phone, callerNumber))
          .limit(1)
      : [];

    const [row] = await db.insert(callsTable).values({
      organisationId: orgId,
      contactId: contact?.id ?? null,
      phoneNumber: callerNumber || "unknown",
      direction: "inbound",
      status: "ongoing",
      duration: 0,
      notes: JSON.stringify({ callSid, callerNumber, turns: [] }),
    }).returning({ id: callsTable.id });

    // Also log in telephony call logs
    if (row?.id) {
      await db.insert(telephonyCallLogsTable).values({
        organisationId: orgId,
        providerId,
        providerCallSid: callSid,
        direction: "inbound" as const,
        fromNumber: callerNumber || "unknown",
        toNumber: process.env.TWILIO_PHONE_NUMBER || "",
        status: "in-progress",
        duration: 0,
        startedAt: new Date(),
      }).catch(() => {});
    }

    return row?.id ?? null;
  } catch (err) {
    logger.error({ err }, "[TwilioVoice] createCallRecord error");
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI voice response via Gemini
// ---------------------------------------------------------------------------
async function generateVoiceReply(session: VoiceSession, callerSpeech: string): Promise<string> {
  const { ai } = await import("@workspace/integrations-gemini-ai");

  const systemPrompt = sanitizePromptInput(
    `Tu es ${session.agentName}, l'assistante vocale IA de ${session.companyName}. ` +
    `Tu répondas au téléphone de manière professionnelle et chaleureuse, toujours en français. ` +
    `Réponds en 1 à 2 phrases maximum (30 mots max). Sois concise et naturelle à l'oral. ` +
    `Pas de formatage, pas de liste, pas de markdown. Si on te demande de transférer un appel ` +
    `ou de prendre un message, indique poliment que tu le feras noter.`,
    2000,
  );

  const context = session.history
    .slice(-6)
    .map(h => `${h.role === "caller" ? "Client" : session.agentName}: ${h.text}`)
    .join("\n");

  const userPrompt = sanitizePromptInput(
    context ? `${context}\nClient: ${callerSpeech}` : `Client: ${callerSpeech}`,
    4000,
  );

  const t0 = Date.now();

  try {
    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 80,
        temperature: 0.7,
      },
    });

    const text = r.text?.trim();
    const inputTokens = r.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = r.usageMetadata?.candidatesTokenCount ?? 0;

    if (text) {
      recordAiUsage({
        organisationId: session.orgId,
        provider: "gemini",
        model: "gemini-2.5-flash",
        route: "/api/telephony/twilio/gather",
        inputTokens,
        outputTokens,
        durationMs: Date.now() - t0,
      }).catch(() => {});
      return text;
    }
  } catch (err) {
    logger.warn({ err }, "[TwilioVoice] Gemini error");
  }

  return `Je suis désolée, je rencontre une difficulté technique. Pouvez-vous rappeler dans quelques instants?`;
}

// ---------------------------------------------------------------------------
// Append a turn to the DB call record
// ---------------------------------------------------------------------------
async function appendTurn(
  callDbId: number,
  role: "caller" | "assistant",
  text: string,
): Promise<void> {
  try {
    const [row] = await db.select({ notes: callsTable.notes }).from(callsTable).where(eq(callsTable.id, callDbId)).limit(1);
    const parsed = row?.notes ? JSON.parse(row.notes) : { turns: [] };
    if (!Array.isArray(parsed.turns)) parsed.turns = [];
    parsed.turns.push({ role, text, at: new Date().toISOString() });
    await db.update(callsTable).set({ notes: JSON.stringify(parsed), updatedAt: new Date() }).where(eq(callsTable.id, callDbId));
  } catch {
    // Non-critical — don't crash on DB errors mid-call
  }
}

// ---------------------------------------------------------------------------
// Route: Initial incoming voice call
// POST /telephony/twilio/voice
// ---------------------------------------------------------------------------
twilioVoiceRouter.post("/telephony/twilio/voice", async (req: Request, res: Response): Promise<void> => {
  logger.info({ body: JSON.stringify(req.body).slice(0, 300) }, "[TwilioVoice] Incoming call");

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken && !validateTwilioSignature(req, authToken)) {
    logger.warn("[TwilioVoice] Invalid Twilio signature on /voice");
    res.status(403).send("Forbidden");
    return;
  }

  const callSid: string = (req.body as Record<string, string>).CallSid || "";
  const toNumber: string = (req.body as Record<string, string>).To || "";
  const fromNumber: string = (req.body as Record<string, string>).From || "";

  const session = await findSessionForNumber(toNumber, fromNumber);

  if (!session) {
    logger.warn({ toNumber }, "[TwilioVoice] No org found for Twilio number, using generic greeting");
    sendTwiml(
      res,
      twimlSay("Bonjour. Je suis désolée, ce numéro n'est pas configuré. Au revoir."),
    );
    return;
  }

  // Quota check (don't block the call if quota is exceeded, just skip AI)
  let quotaOk = true;
  try {
    await assertAiQuota(session.orgId);
  } catch {
    quotaOk = false;
    logger.warn({ orgId: session.orgId }, "[TwilioVoice] AI quota exceeded, voice AI disabled for this call");
  }

  // Find provider ID for logging
  const [provider] = await db
    .select({ id: telephonyProvidersTable.id })
    .from(telephonyProvidersTable)
    .where(eq(telephonyProvidersTable.provider, "twilio"))
    .limit(1)
    .catch(() => []);

  // Create DB record
  session.callDbId = await createCallRecord(session.orgId, callSid, fromNumber, provider?.id ?? null);

  // Store session
  sessions.set(callSid, { ...session, expiresAt: Date.now() + 30 * 60 * 1000 });

  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
  const gatherUrl = `${proto}://${host}/api/telephony/twilio/gather?callSid=${encodeURIComponent(callSid)}&quotaOk=${quotaOk ? "1" : "0"}`;

  const greeting = `Bonjour, vous avez contacté ${session.companyName}. Je suis ${session.agentName}, votre assistante IA. Comment puis-je vous aider?`;

  sendTwiml(
    res,
    twimlGather(gatherUrl, greeting),
    twimlSay("Je n'ai pas entendu votre réponse. Merci d'avoir appelé. Au revoir."),
  );
});

// ---------------------------------------------------------------------------
// Route: Speech gather result (multi-turn AI conversation)
// POST /telephony/twilio/gather
// ---------------------------------------------------------------------------
twilioVoiceRouter.post("/telephony/twilio/gather", async (req: Request, res: Response): Promise<void> => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken && !validateTwilioSignature(req, authToken)) {
    logger.warn("[TwilioVoice] Invalid Twilio signature on /gather");
    res.status(403).send("Forbidden");
    return;
  }

  const body = req.body as Record<string, string>;
  const querySid = (req.query as Record<string, string>).callSid || "";
  const quotaOk = (req.query as Record<string, string>).quotaOk !== "0";

  const callSid: string = body.CallSid || querySid;
  const speechResult: string = body.SpeechResult || "";
  const confidence: string = body.Confidence || "0";

  logger.info({ callSid, speechResult: speechResult.slice(0, 100), confidence }, "[TwilioVoice] Gather result");

  const session = sessions.get(callSid);

  if (!session) {
    sendTwiml(res, twimlSay("Je suis désolée, je ne retrouve pas le contexte de votre appel. Au revoir."));
    return;
  }

  // Update session TTL
  session.expiresAt = Date.now() + 30 * 60 * 1000;

  if (!speechResult.trim()) {
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
    const gatherUrl = `${proto}://${host}/api/telephony/twilio/gather?callSid=${encodeURIComponent(callSid)}&quotaOk=${quotaOk ? "1" : "0"}`;

    sendTwiml(
      res,
      twimlGather(gatherUrl, "Je n'ai pas bien entendu. Pouvez-vous répéter?"),
      twimlSay("Merci pour votre appel. Au revoir."),
    );
    return;
  }

  // Add caller turn to history
  session.history.push({ role: "caller", text: speechResult });
  if (session.callDbId) await appendTurn(session.callDbId, "caller", speechResult);

  // Generate AI reply
  let aiReply: string;

  if (!quotaOk) {
    aiReply = `Je suis désolée, le service IA est temporairement indisponible. Un conseiller vous rappellera dès que possible.`;
  } else {
    aiReply = await generateVoiceReply(session, speechResult);
  }

  // Detect end-of-call intents
  const endPhrases = ["au revoir", "merci", "c'est tout", "bonne journée", "bonne soirée", "à bientôt", "raccrocher"];
  const isGoodbye = endPhrases.some(p => speechResult.toLowerCase().includes(p));

  // Add assistant turn to history
  session.history.push({ role: "assistant", text: aiReply });
  if (session.callDbId) await appendTurn(session.callDbId, "assistant", aiReply);

  if (isGoodbye || session.history.length >= 20) {
    const farewell = isGoodbye ? aiReply : `${aiReply} Bonne journée.`;
    sendTwiml(res, twimlSay(farewell), `<Hangup/>`);
    sessions.delete(callSid);
    return;
  }

  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
  const gatherUrl = `${proto}://${host}/api/telephony/twilio/gather?callSid=${encodeURIComponent(callSid)}&quotaOk=${quotaOk ? "1" : "0"}`;

  sendTwiml(
    res,
    twimlGather(gatherUrl, aiReply),
    twimlSay("Merci pour votre appel. Au revoir."),
  );
});

// ---------------------------------------------------------------------------
// Route: Call status callback (Twilio calls this when call ends)
// POST /telephony/twilio/status
// ---------------------------------------------------------------------------
twilioVoiceRouter.post("/telephony/twilio/status", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, string>;
  const callSid: string = body.CallSid || "";
  const callStatus: string = body.CallStatus || "";
  const duration: number = parseInt(body.CallDuration || "0", 10);

  logger.info({ callSid, callStatus, duration }, "[TwilioVoice] Status callback");

  const session = sessions.get(callSid);

  try {
    // Update telephony log
    await db.update(telephonyCallLogsTable)
      .set({ status: callStatus, duration, endedAt: new Date() })
      .where(eq(telephonyCallLogsTable.providerCallSid, callSid));

    // Update calls table
    if (session?.callDbId) {
      await db.update(callsTable).set({
        status: callStatus === "completed" ? "completed" : "missed",
        duration,
        updatedAt: new Date(),
      }).where(eq(callsTable.id, session.callDbId));
    }
  } catch (err) {
    logger.error({ err, callSid }, "[TwilioVoice] Status update error");
  }

  // Clean up session
  sessions.delete(callSid);
  res.json({ received: true });
});
