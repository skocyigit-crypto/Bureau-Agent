import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, telephonyProvidersTable, organisationsTable, callsTable, contactsTable, telephonyCallLogsTable, telephonySmsLogsTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { assertAiQuota } from "../services/ai-quota";
import { recordAiUsage, geminiActualModel, sanitizePromptInput, GEMINI_PRO_MODEL } from "../services/ai-utils";
import { sendSms, type TelephonyProviderConfig } from "../services/telephony-providers";
import { sendEmail } from "../services/email";
import { broadcaster } from "../services/broadcaster";
import { notifyOrgUsers, maskPhone } from "../services/whatsapp-notify";
import { evaluatePhoneReputation, phoneRiskLabel } from "../services/phone-reputation";
import { recordSecurityScan } from "../services/security-scans";
import { emitSecurityAlert } from "../services/security-alerts";
import { checkPhoneList } from "../services/security-lists";

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
  callerFirstName: string | null;
  callerLastName: string | null;
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

// <Record> verb. We deliberately set transcribe="false" because Twilio's
// built-in transcription is English-biased and being deprecated; we run our
// own Gemini transcription on the recording URL in /recording-complete.
function twimlRecord(actionUrl: string, prompt: string): string {
  return (
    twimlSay(prompt) +
    `<Record action="${xmlEscape(actionUrl)}" method="POST" ` +
    `maxLength="120" timeout="5" finishOnKey="#" playBeep="true" ` +
    `transcribe="false" trim="trim-silence"/>`
  );
}

// callerIdNumber MUST be a number we own/verified on Twilio (typically the
// org's inbound Twilio number). targetNumber is the human conseiller. The
// `actionUrl` receives DialCallStatus and lets us branch to voicemail only
// on no-answer/busy/failed — never after a successful conversation.
function twimlDial(targetNumber: string, callerIdNumber: string, actionUrl: string, intro?: string): string {
  return (
    (intro ? twimlSay(intro) : "") +
    `<Dial timeout="20" callerId="${xmlEscape(callerIdNumber)}" ` +
    `action="${xmlEscape(actionUrl)}" method="POST">${xmlEscape(targetNumber)}</Dial>`
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
// Each tenant can bring their own Twilio account (config saved via
// POST /telephony/providers), signed with THEIR OWN auth token — not the
// platform's. Validating every webhook against a single platform-wide
// TWILIO_AUTH_TOKEN meant a tenant's own Twilio number never worked (403
// on every inbound call/SMS) unless the platform itself also had Twilio
// configured. Resolve the auth token per-request from the "To" number
// (same lookup as findSessionForNumber), falling back to the platform env
// var only when no tenant claims that number.
//
// Centralised webhook auth guard. Returns true if the request was rejected
// (caller should return immediately). All Twilio webhook routes use this so
// behaviour stays consistent: fail closed in production whenever no signing
// token (tenant or platform) is available or the signature fails to verify.
async function rejectIfBadTwilioRequest(req: Request, res: Response, route: string): Promise<boolean> {
  const toNumber = (req.body as Record<string, string> | undefined)?.To || "";
  const tenantAuthToken = await resolveTenantTwilioAuthToken(toNumber);
  const authToken = tenantAuthToken || process.env.TWILIO_AUTH_TOKEN;

  if (!authToken) {
    if (process.env.NODE_ENV === "production") {
      logger.error({ route }, "[TwilioVoice] No Twilio auth token (tenant or platform) — refusing webhook in production");
      res.status(403).send("Forbidden");
      return true;
    }
    return false;
  }
  if (!validateTwilioSignature(req, authToken)) {
    logger.warn({ route }, "[TwilioVoice] Invalid Twilio signature");
    res.status(403).send("Forbidden");
    return true;
  }
  return false;
}

// Only fetch recordings from Twilio's official media domains. Prevents an
// attacker who reached an unauthenticated /recording-complete from steering
// our server-side fetch at internal services (SSRF).
function isAllowedTwilioRecordingUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    // Twilio recording URLs come from api.twilio.com and the regional API
    // hosts (api.<region>.twilio.com), with media occasionally served from
    // media.twiliocdn.com after redirect handling.
    return (
      host === "api.twilio.com" ||
      /^api\.[a-z0-9-]+\.twilio\.com$/.test(host) ||
      host === "media.twiliocdn.com"
    );
  } catch {
    return false;
  }
}

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

// Shared by the signature guard and session lookup below — both need to
// answer "which tenant's Twilio provider owns this number?".
async function findTwilioProviderForNumber(toNumber: string) {
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

  return matched ?? null;
}

async function resolveTenantTwilioAuthToken(toNumber: string): Promise<string | null> {
  try {
    const matched = await findTwilioProviderForNumber(toNumber);
    const cfg = matched?.config as Record<string, string> | undefined;
    return cfg?.authToken || null;
  } catch {
    return null;
  }
}

async function findSessionForNumber(toNumber: string, fromNumber: string): Promise<VoiceSession | null> {
  try {
    const matched = await findTwilioProviderForNumber(toNumber);
    if (!matched) return null;

    const orgId = matched.organisationId!;
    const [org] = await db
      .select({ name: organisationsTable.name, aiAgentName: organisationsTable.aiAgentName })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, orgId))
      .limit(1);

    // Try to identify the caller by phone number so we can greet them by
    // name. Scope to the tenant identified by the matched Twilio number to
    // avoid PII disclosure across organisations (the same phone may exist
    // in another tenant's contact book).
    let callerFirstName: string | null = null;
    let callerLastName: string | null = null;
    if (fromNumber) {
      try {
        const [c] = await db
          .select({ firstName: contactsTable.firstName, lastName: contactsTable.lastName })
          .from(contactsTable)
          .where(and(
            eq(contactsTable.organisationId, orgId),
            eq(contactsTable.phone, fromNumber),
          ))
          .limit(1);
        if (c) {
          callerFirstName = c.firstName ?? null;
          callerLastName = c.lastName ?? null;
        }
      } catch {
        // Non-critical — fall back to anonymous greeting.
      }
    }

    return {
      orgId,
      agentName: org?.aiAgentName || "Sophie",
      companyName: org?.name || "Agent de Bureau",
      callDbId: null,
      callerNumber: fromNumber || "",
      callerFirstName,
      callerLastName,
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
    // Try to match caller to a contact by phone number, scoped to the
    // tenant that owns this Twilio number — never link a call to a contact
    // belonging to another organisation.
    const [contact] = callerNumber
      ? await db
          .select({ id: contactsTable.id })
          .from(contactsTable)
          .where(and(
            eq(contactsTable.organisationId, orgId),
            eq(contactsTable.phone, callerNumber),
          ))
          .limit(1)
      : [];

    const [row] = await db.insert(callsTable).values({
      organisationId: orgId,
      contactId: contact?.id ?? null,
      phoneNumber: callerNumber || "unknown",
      direction: "entrant",
      status: "en_cours",
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
      model: GEMINI_PRO_MODEL,
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
        model: geminiActualModel(r, GEMINI_PRO_MODEL),
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
// Telephony provider helpers (Wave 2: voicemail, missed-call SMS, routing)
// ---------------------------------------------------------------------------

interface BusinessHours {
  // tz: IANA tz like "Europe/Paris". If absent we default to it.
  tz?: string;
  // For each day key (mon..sun), an inclusive [openHour, closeHour] window
  // in 24h local time. Missing key means closed all day.
  days?: Partial<Record<"mon"|"tue"|"wed"|"thu"|"fri"|"sat"|"sun", [number, number]>>;
}

interface TwilioProviderConfigShape {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  phoneNumber?: string;
  // Wave 2 toggles & customisations (all optional, safe defaults).
  autoSmsOnMissed?: boolean;          // default true
  autoSmsTemplate?: string;           // default FR template, supports {name} {time}
  emailRecapEnabled?: boolean;        // default true
  voicemailWhenBusy?: boolean;        // default true
  forwardToNumber?: string;           // if set, prefer Dial-forward over voicemail when unavailable
  businessHours?: BusinessHours;      // if absent => always available
  // F4: protection automatique contre les appels frauduleux.
  //   "off"       => comportement historique, aucun filtrage (defaut)
  //   "voicemail" => appel suspect/bloque redirige vers messagerie
  //   "reject"    => appel suspect/bloque rejete immediatement
  fraudAction?: "off" | "voicemail" | "reject";
}

async function getDefaultTwilioProviderForOrg(orgId: number): Promise<{ id: number; config: TwilioProviderConfigShape; phoneNumbers: string[] } | null> {
  try {
    const [p] = await db
      .select({ id: telephonyProvidersTable.id, config: telephonyProvidersTable.config, phoneNumbers: telephonyProvidersTable.phoneNumbers })
      .from(telephonyProvidersTable)
      .where(and(
        eq(telephonyProvidersTable.organisationId, orgId),
        eq(telephonyProvidersTable.provider, "twilio"),
        eq(telephonyProvidersTable.isActive, true),
      ))
      .orderBy(sql`${telephonyProvidersTable.isDefault} DESC, ${telephonyProvidersTable.id} ASC`)
      .limit(1);
    if (!p) return null;
    return { id: p.id, config: (p.config as TwilioProviderConfigShape) || {}, phoneNumbers: p.phoneNumbers || [] };
  } catch (err) {
    logger.warn({ err, orgId }, "[TwilioVoice] getDefaultTwilioProviderForOrg error");
    return null;
  }
}

// F4: TwiML de rejet immediat d'un appel frauduleux.
function twimlReject(): string {
  return `<Reject reason="rejected"/>`;
}

interface InboundFraudDecision {
  fraud: boolean;       // l'appel doit-il etre traite comme frauduleux ?
  reason: string;       // motif (liste de blocage / reputation)
}

// F4: evalue un appel entrant. L'allow-list court-circuite toute analyse
// (numero de confiance). Sinon: block-list => fraude immediate; puis
// reputation Twilio (high) => fraude. Fail-soft: en cas d'erreur on ne
// bloque jamais un appelant legitime.
async function evaluateInboundFraud(orgId: number, phone: string): Promise<InboundFraudDecision> {
  if (!phone) return { fraud: false, reason: "" };
  try {
    const listed = await checkPhoneList(orgId, phone);
    if (listed === "allow") return { fraud: false, reason: "" };
    if (listed === "block") {
      return { fraud: true, reason: "Numero present dans votre liste de blocage" };
    }
    const rep = await evaluatePhoneReputation(orgId, phone);
    if (rep.risk === "high") {
      return { fraud: true, reason: rep.reasons[0] ?? "Reputation a risque eleve" };
    }
  } catch (err) {
    logger.warn({ err, orgId }, "[TwilioVoice] evaluateInboundFraud error (fail-open)");
  }
  return { fraud: false, reason: "" };
}

const DAY_KEYS: Array<keyof NonNullable<BusinessHours["days"]>> = ["sun","mon","tue","wed","thu","fri","sat"];

// Pure: decide if we should accept this incoming call right now based on
// the optional businessHours config. If no businessHours configured, we
// always say "available" (preserves current behaviour for orgs that didn't
// opt into routing).
function isWithinBusinessHours(hours: BusinessHours | undefined, now: Date): boolean {
  if (!hours || !hours.days || Object.keys(hours.days).length === 0) return true;
  // We use the host TZ if not provided. The Replit container is UTC, so
  // orgs that care about "Europe/Paris" should set tz explicitly. We
  // approximate by computing the local time via Intl.
  const tz = hours.tz || "Europe/Paris";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
    }).formatToParts(now);
  } catch {
    return true; // bad tz config -> fail open, never block legit callers
  }
  const wd = (parts.find(p => p.type === "weekday")?.value || "").toLowerCase().slice(0,3);
  const hr = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
  const dayKey = DAY_KEYS.find(k => k === wd);
  if (!dayKey) return true;
  const window = hours.days[dayKey as keyof typeof hours.days];
  if (!window) return false;
  const [open, close] = window;
  return hr >= open && hr < close;
}

function formatCallerName(first: string | null, last: string | null): string {
  const v = [first, last].filter((s) => s && s.trim().length > 0).join(" ").trim();
  return v;
}

// Send the auto-SMS to a missed inbound caller. Best-effort, never throws.
async function sendMissedCallSmsForOrg(args: {
  orgId: number;
  callerNumber: string;
  callerName: string | null;
  callSid: string;
}): Promise<void> {
  try {
    if (!args.callerNumber || !args.callerNumber.startsWith("+")) return; // skip anonymous/withheld
    const provider = await getDefaultTwilioProviderForOrg(args.orgId);
    if (!provider) return;
    const cfg = provider.config;
    if (cfg.autoSmsOnMissed === false) return;
    const fromNumber = cfg.fromNumber || cfg.phoneNumber || provider.phoneNumbers[0] || "";
    if (!fromNumber) return;

    const name = (args.callerName || "").trim();
    const tz = cfg.businessHours?.tz || "Europe/Paris";
    let timeStr = "";
    try {
      timeStr = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date());
    } catch { timeStr = new Date().toISOString().slice(11, 16); }

    const tpl = cfg.autoSmsTemplate || "Bonjour{name_comma}, nous avons manqué votre appel à {time}. Nous vous rappelons rapidement. — Agent de Bureau";
    const body = tpl
      .replace("{name}", name)
      .replace("{name_comma}", name ? ` ${name}` : "")
      .replace("{time}", timeStr);

    const result = await sendSms("twilio", cfg as TelephonyProviderConfig, {
      to: args.callerNumber,
      from: fromNumber,
      body,
    });

    await db.insert(telephonySmsLogsTable).values({
      organisationId: args.orgId,
      providerId: provider.id,
      providerMessageSid: result.messageSid || null,
      direction: "outbound",
      fromNumber,
      toNumber: args.callerNumber,
      body,
      status: result.success ? (result.status || "sent") : "failed",
      metadata: { callSid: args.callSid, reason: "missed-call-auto-sms", error: result.error || null },
    }).catch(() => {});

    logger.info({ orgId: args.orgId, callSid: args.callSid, ok: result.success }, "[TwilioVoice] Missed-call SMS sent");
  } catch (err) {
    logger.warn({ err, orgId: args.orgId, callSid: args.callSid }, "[TwilioVoice] Missed-call SMS failed");
  }
}

// Download a Twilio recording and transcribe it via Gemini multimodal.
// Returns null on any failure (fail-open: caller falls back to "no transcript").
async function transcribeTwilioRecording(recordingUrl: string, accountSid: string, authToken: string): Promise<string | null> {
  try {
    // SSRF guard: even though /recording-complete is signature-protected,
    // defense-in-depth — never let a forged RecordingUrl steer this fetch
    // at internal endpoints. Allowlist Twilio's own media domains only.
    if (!isAllowedTwilioRecordingUrl(recordingUrl)) {
      logger.warn({ recordingUrl }, "[TwilioVoice] Rejecting non-Twilio RecordingUrl");
      return null;
    }
    // Twilio recording URLs require basic auth + we ask for mp3 (smaller, FR-supported).
    const url = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;
    const audioResp = await fetch(url, {
      redirect: "manual",
      headers: { Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64") },
    });
    if (!audioResp.ok) return null;
    const arr = await audioResp.arrayBuffer();
    const b64 = Buffer.from(arr).toString("base64");
    if (b64.length === 0) return null;

    const { ai } = await import("@workspace/integrations-gemini-ai");
    const t0 = Date.now();
    const r = await ai.models.generateContent({
      model: GEMINI_PRO_MODEL,
      contents: [{
        role: "user",
        parts: [
          { text: "Transcris ce message vocal en français. Retourne uniquement le texte parlé, sans préambule ni guillemets. Si le message est vide ou inaudible, réponds exactement: VIDE." },
          { inlineData: { mimeType: "audio/mpeg", data: b64 } },
        ],
      }],
      config: { temperature: 0.1, maxOutputTokens: 800 },
    });
    const transcript = (r.text || "").trim();
    if (!transcript || transcript === "VIDE") return null;
    logger.info({ ms: Date.now() - t0, len: transcript.length }, "[TwilioVoice] Voicemail transcribed");
    return transcript;
  } catch (err) {
    logger.warn({ err: (err as any)?.message || err }, "[TwilioVoice] Voicemail transcription failed");
    return null;
  }
}

// Send a post-call recap email to all active users of the organisation.
async function sendCallRecapEmail(args: {
  orgId: number;
  callDbId: number;
  callerNumber: string;
  callerName: string | null;
  summary?: string | null;
  sentiment?: string | null;
  urgency?: string | null;
  tasksCreated?: number;
  appointmentCreated?: boolean;
  voicemailTranscript?: string | null;
  transcriptSnippet?: string | null;
}): Promise<void> {
  try {
    const provider = await getDefaultTwilioProviderForOrg(args.orgId);
    if (provider && provider.config.emailRecapEnabled === false) return;

    const recipients = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.organisationId, args.orgId))
      .limit(20);
    const emails = recipients.map(r => r.email).filter((e): e is string => !!e);
    if (emails.length === 0) return;

    const [org] = await db
      .select({ name: organisationsTable.name })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, args.orgId))
      .limit(1);
    const orgName = org?.name || "Agent de Bureau";

    const who = args.callerName || args.callerNumber || "Inconnu";
    const subject = `Résumé d'appel — ${who} — ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}`;

    const lines: string[] = [];
    lines.push(`<h2 style="margin:0 0 12px 0;font-family:system-ui,sans-serif;">Appel reçu</h2>`);
    lines.push(`<p style="font-family:system-ui,sans-serif;color:#374151;">De: <strong>${escapeHtml(who)}</strong> (${escapeHtml(args.callerNumber || "—")})</p>`);
    if (args.summary) lines.push(`<p><strong>Résumé:</strong><br>${escapeHtml(args.summary)}</p>`);
    if (args.sentiment || args.urgency) {
      lines.push(`<p style="color:#6b7280;">Sentiment: ${escapeHtml(args.sentiment || "—")} · Urgence: ${escapeHtml(args.urgency || "—")}</p>`);
    }
    if (args.tasksCreated && args.tasksCreated > 0) {
      lines.push(`<p>✓ <strong>${args.tasksCreated}</strong> tâche${args.tasksCreated > 1 ? "s" : ""} créée${args.tasksCreated > 1 ? "s" : ""} automatiquement.</p>`);
    }
    if (args.appointmentCreated) lines.push(`<p>✓ Rendez-vous ajouté à votre agenda.</p>`);
    if (args.voicemailTranscript) {
      lines.push(`<p><strong>Message vocal:</strong><br><em>"${escapeHtml(args.voicemailTranscript)}"</em></p>`);
    } else if (args.transcriptSnippet) {
      lines.push(`<p><strong>Extrait:</strong><br><em>${escapeHtml(args.transcriptSnippet)}</em></p>`);
    }
    lines.push(`<p style="margin-top:16px;color:#9ca3af;font-size:12px;">— ${escapeHtml(orgName)} via Agent de Bureau</p>`);
    const html = `<div style="max-width:560px;margin:0 auto;padding:16px;">${lines.join("")}</div>`;

    const text = [
      `Appel de ${who} (${args.callerNumber || "-"})`,
      args.summary ? `Resume: ${args.summary}` : "",
      args.sentiment || args.urgency ? `Sentiment: ${args.sentiment || "-"} | Urgence: ${args.urgency || "-"}` : "",
      args.tasksCreated ? `${args.tasksCreated} tache(s) creee(s).` : "",
      args.appointmentCreated ? `Rendez-vous ajoute a l'agenda.` : "",
      args.voicemailTranscript ? `Message vocal: "${args.voicemailTranscript}"` : "",
    ].filter(Boolean).join("\n");

    // Send to each recipient (BCC pattern would require provider support; we keep it explicit per-user).
    for (const to of emails) {
      sendEmail(to, subject, html, text, { orgId: args.orgId }).catch(() => {});
    }
    logger.info({ orgId: args.orgId, callDbId: args.callDbId, recipients: emails.length }, "[TwilioVoice] Call recap emails dispatched");
  } catch (err) {
    logger.warn({ err, orgId: args.orgId, callDbId: args.callDbId }, "[TwilioVoice] sendCallRecapEmail failed");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Route: Initial incoming voice call
// POST /telephony/twilio/voice
// ---------------------------------------------------------------------------
twilioVoiceRouter.post("/telephony/twilio/voice", async (req: Request, res: Response): Promise<void> => {
  const _twBody = (req.body ?? {}) as Record<string, string>;
  const _maskTel = (n: string | undefined): string => {
    if (!n) return "";
    const s = String(n);
    return s.length <= 4 ? "***" : `${s.slice(0, 3)}***${s.slice(-2)}`;
  };
  logger.info({
    callSid: _twBody.CallSid,
    from: _maskTel(_twBody.From),
    to: _maskTel(_twBody.To),
    direction: _twBody.Direction,
    callStatus: _twBody.CallStatus,
  }, "[TwilioVoice] Incoming call");

  if (await rejectIfBadTwilioRequest(req, res, "/voice")) return;

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

  // F4: protection automatique contre les appels frauduleux. On lit le
  // reglage de l'org; "off" (defaut) preserve le comportement historique et
  // evite tout appel synchrone (latence) au service de reputation.
  const fraudProvider = await getDefaultTwilioProviderForOrg(session.orgId);
  const fraudAction = fraudProvider?.config.fraudAction ?? "off";
  if (fraudAction !== "off") {
    const decision = await evaluateInboundFraud(session.orgId, fromNumber);
    if (decision.fraud) {
      const masked = maskPhone(fromNumber);
      logger.warn({ orgId: session.orgId, callSid, fraudAction }, "[TwilioVoice] Appel frauduleux detecte");
      recordSecurityScan({
        orgId: session.orgId, userId: null, kind: "call", target: masked,
        verdict: "dangerous", details: decision.reason,
      });
      // Une seule voie de notification: emitSecurityAlert gere SSE +
      // WhatsApp/push (avec throttle anti-rafale). On enrichit le detail avec
      // l'action appliquee pour ne pas perdre l'info "rejete/messagerie".
      const fraudOutcome = fraudAction === "reject" ? "appel rejete" : "redirige vers messagerie";
      emitSecurityAlert({
        orgId: session.orgId, kind: "call", verdict: "dangerous",
        target: masked, detail: `${decision.reason} (${fraudOutcome})`, notifyWhatsApp: true,
      });

      if (fraudAction === "reject") {
        sendTwiml(res, twimlReject());
        return;
      }
      // fraudAction === "voicemail"
      const fProto = (req.headers["x-forwarded-proto"] as string) || "https";
      const fHost = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
      const fRecordUrl = `${fProto}://${fHost}/api/telephony/twilio/recording-complete?callSid=${encodeURIComponent(callSid)}`;
      sendTwiml(
        res,
        twimlRecord(
          fRecordUrl,
          "Bonjour. Pour des raisons de securite, votre appel ne peut aboutir directement. Laissez un message apres le bip, nous vous rappellerons si necessaire. Appuyez sur diese pour terminer.",
        ),
      );
      return;
    }
  }

  // Quota check (don't block the call if quota is exceeded, just skip AI)
  let quotaOk = true;
  try {
    await assertAiQuota(session.orgId);
  } catch {
    quotaOk = false;
    logger.warn({ orgId: session.orgId }, "[TwilioVoice] AI quota exceeded, voice AI disabled for this call");
  }

  // Find provider ID for logging — scoped to the tenant identified by the
  // called Twilio number, so we never attach a call log to another org's
  // provider row when multiple tenants share the "twilio" provider name.
  const [callProvider] = await db
    .select({ id: telephonyProvidersTable.id })
    .from(telephonyProvidersTable)
    .where(and(
      eq(telephonyProvidersTable.organisationId, session.orgId),
      eq(telephonyProvidersTable.provider, "twilio"),
    ))
    .orderBy(sql`${telephonyProvidersTable.isDefault} DESC, ${telephonyProvidersTable.id} ASC`)
    .limit(1)
    .catch(() => []);

  // Create DB record
  session.callDbId = await createCallRecord(session.orgId, callSid, fromNumber, callProvider?.id ?? null);

  // Notification WhatsApp aux membres opt-in (kind="call"). Fail-soft :
  // toute erreur (pas de provider, pas d'utilisateur opt-in, etc.) est
  // simplement loggee et ne bloque jamais la prise d'appel.
  try {
    const callerName = formatCallerName(session.callerFirstName, session.callerLastName);
    const masked = maskPhone(fromNumber);
    const who = callerName ? `${callerName} (n°${masked})` : `numero finissant par ${masked}`;
    // On enrichit la notif avec la reputation du numero (Twilio Lookup). Le
    // tout reste dans un IIFE async detache pour ne JAMAIS retarder la reponse
    // TwiML (la prise d'appel doit rester instantanee). La reputation a son
    // propre timeout interne (4s) et est fail-soft.
    void (async () => {
      let suffix = "";
      try {
        if (fromNumber && !callerName) {
          const rep = await evaluatePhoneReputation(session.orgId, fromNumber);
          if (rep.risk === "high") {
            suffix = ` ⚠️ Reputation: ${phoneRiskLabel(rep.risk)} (${rep.reasons[0] ?? "signal suspect"}). Soyez prudent.`;
            recordSecurityScan({
              orgId: session.orgId, userId: null, kind: "call", target: masked,
              verdict: "dangerous", details: rep.reasons.join("; "),
            });
            // notifyWhatsApp:false -> la notif d'appel ci-dessous porte deja
            // l'avertissement de reputation; on evite un double message.
            emitSecurityAlert({
              orgId: session.orgId, kind: "call", verdict: "dangerous",
              target: masked, detail: rep.reasons[0], notifyWhatsApp: false,
            });
          } else if (rep.risk === "medium") {
            suffix = ` Reputation: ${phoneRiskLabel(rep.risk)} (${rep.reasons[0] ?? ""}).`;
            recordSecurityScan({
              orgId: session.orgId, userId: null, kind: "call", target: masked,
              verdict: "suspicious", details: rep.reasons.join("; "),
            });
          }
        }
      } catch (repErr) {
        logger.warn({ err: repErr, orgId: session.orgId }, "[TwilioVoice] reputation lookup failed");
      }
      await notifyOrgUsers(
        session.orgId,
        `Bureau IA - Appel entrant de ${who}.${suffix}`,
        "call",
      );
    })().catch((err) => logger.warn({ err }, "[TwilioVoice] notifyOrgUsers rejection"));
  } catch (notifyErr) {
    logger.warn({ err: notifyErr, orgId: session.orgId }, "[TwilioVoice] notify call failed");
  }

  // Store session
  sessions.set(callSid, { ...session, expiresAt: Date.now() + 30 * 60 * 1000 });

  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
  const gatherUrl = `${proto}://${host}/api/telephony/twilio/gather?callSid=${encodeURIComponent(callSid)}&quotaOk=${quotaOk ? "1" : "0"}`;
  const recordUrl = `${proto}://${host}/api/telephony/twilio/recording-complete?callSid=${encodeURIComponent(callSid)}`;

  // Personalized greeting if the caller is a known contact.
  const callerName = formatCallerName(session.callerFirstName, session.callerLastName);
  const personalSalutation = callerName ? `Bonjour ${callerName}, ` : "Bonjour, ";

  // Wave 2: conditional routing. If the org configured business hours and
  // we're outside them (or quota is exhausted), prefer either:
  //   1. Forwarding the call to a human number (provider.config.forwardToNumber), or
  //   2. Recording a voicemail that we transcribe later.
  // Default behaviour (no businessHours configured) is unchanged: we greet
  // and start the AI conversation immediately.
  const orgProvider = await getDefaultTwilioProviderForOrg(session.orgId);
  const cfg = orgProvider?.config || {};
  const available = isWithinBusinessHours(cfg.businessHours, new Date()) && quotaOk;

  if (!available) {
    if (cfg.forwardToNumber) {
      // callerId must be a number we own. Use the same Twilio number that
      // received the call (toNumber) so the conseiller's screen shows
      // their own line, not the caller's number.
      const ownedCallerId = cfg.fromNumber || cfg.phoneNumber || toNumber || (orgProvider?.phoneNumbers[0] || "");
      const dialActionUrl = `${proto}://${host}/api/telephony/twilio/dial-complete?callSid=${encodeURIComponent(callSid)}`;
      logger.info({ orgId: session.orgId, callSid }, "[TwilioVoice] Forwarding call (unavailable)");
      // We do NOT append <Record> here — that would always run after the
      // dial ends, even on a successful conversation. /dial-complete
      // inspects DialCallStatus and returns voicemail TwiML only on
      // no-answer/busy/failed.
      sendTwiml(
        res,
        twimlDial(cfg.forwardToNumber, ownedCallerId, dialActionUrl, `${personalSalutation}je vous mets en relation avec un conseiller. Un instant je vous prie.`),
      );
      return;
    }
    if (cfg.voicemailWhenBusy !== false) {
      const reason = quotaOk
        ? "nous sommes actuellement fermés"
        : "le service est temporairement indisponible";
      logger.info({ orgId: session.orgId, callSid, quotaOk }, "[TwilioVoice] Routing to voicemail (unavailable)");
      sendTwiml(
        res,
        twimlRecord(
          recordUrl,
          `${personalSalutation}vous avez contacté ${session.companyName}. ${reason}. Laissez votre message après le bip, nous vous rappellerons. Appuyez sur dièse pour terminer.`,
        ),
      );
      return;
    }
    // Else: explicit opt-out of voicemail -> polite hangup
    sendTwiml(res, twimlSay(`${personalSalutation}vous avez contacté ${session.companyName}. Nous sommes actuellement fermés. Merci de rappeler plus tard.`));
    return;
  }

  // Available -> normal AI conversation flow.
  const greeting = `${personalSalutation}vous avez contacté ${session.companyName}. Je suis ${session.agentName}, votre assistante IA. Comment puis-je vous aider?`;
  sendTwiml(
    res,
    twimlGather(gatherUrl, greeting),
    // No-speech fallback: offer a voicemail rather than just hanging up.
    twimlRecord(recordUrl, "Je n'ai pas entendu votre réponse. Si vous le souhaitez, laissez votre message après le bip."),
  );
});

// ---------------------------------------------------------------------------
// Route: Speech gather result (multi-turn AI conversation)
// POST /telephony/twilio/gather
// ---------------------------------------------------------------------------
twilioVoiceRouter.post("/telephony/twilio/gather", async (req: Request, res: Response): Promise<void> => {
  if (await rejectIfBadTwilioRequest(req, res, "/gather")) return;

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
  // /status triggers DB writes, missed-call SMS, AI processing and recap
  // emails — it MUST be authenticated. Fail closed in production when the
  // signing token is unavailable.
  if (await rejectIfBadTwilioRequest(req, res, "/status")) return;

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
        status: callStatus === "completed" ? "repondu" : "manque",
        duration,
        updatedAt: new Date(),
      }).where(eq(callsTable.id, session.callDbId));
    }

    // Notify the org in real-time when a call ends without being answered.
    // The mobile app (Tâche #80) listens for this event and triggers a
    // haptic + local notification so the secrétaire is alerted as fast as
    // for a new message or task. The web sidebar uses the same channel.
    if (session?.orgId && callStatus !== "completed") {
      broadcaster.broadcast(session.orgId, {
        type: "call",
        action: "created",
        resourceId: session.callDbId ?? undefined,
      });
    }
  } catch (err) {
    logger.error({ err, callSid }, "[TwilioVoice] Status update error");
  }

  // Wave 2: missed-call auto-SMS. Twilio reports these statuses when the
  // call did NOT reach a meaningful conversation: no-answer, busy, failed,
  // canceled. We text the caller back from the same Twilio number so they
  // know we noticed. Best-effort; logged for observability.
  const missedStatuses = new Set(["no-answer", "busy", "failed", "canceled"]);
  if (missedStatuses.has(callStatus)) {
    void (async () => {
      try {
        // Resolve org from telephony log (session may be missing on restart).
        let orgId = session?.orgId ?? null;
        let callerNumber = session?.callerNumber ?? "";
        let callerName = formatCallerName(session?.callerFirstName ?? null, session?.callerLastName ?? null);
        if (orgId == null || !callerNumber) {
          const [logRow] = await db
            .select({
              orgId: telephonyCallLogsTable.organisationId,
              fromNumber: telephonyCallLogsTable.fromNumber,
            })
            .from(telephonyCallLogsTable)
            .where(eq(telephonyCallLogsTable.providerCallSid, callSid))
            .limit(1);
          if (!logRow?.orgId) return;
          orgId = logRow.orgId;
          callerNumber = callerNumber || logRow.fromNumber;
          if (!callerName && callerNumber) {
            const [c] = await db.select({ firstName: contactsTable.firstName, lastName: contactsTable.lastName })
              .from(contactsTable)
              .where(and(eq(contactsTable.organisationId, orgId), eq(contactsTable.phone, callerNumber)))
              .limit(1);
            if (c) callerName = formatCallerName(c.firstName ?? null, c.lastName ?? null);
          }
        }
        // Idempotency: if we already wrote a missed-call SMS row for this
        // CallSid (Twilio re-delivers /status freely), skip. Postgres jsonb
        // -> text comparison via @> is the cheapest equality check here.
        const dupe = await db
          .select({ id: telephonySmsLogsTable.id })
          .from(telephonySmsLogsTable)
          .where(and(
            eq(telephonySmsLogsTable.organisationId, orgId),
            sql`${telephonySmsLogsTable.metadata} @> ${JSON.stringify({ callSid, reason: "missed-call-auto-sms" })}::jsonb`,
          ))
          .limit(1)
          .catch(() => [] as Array<{ id: number }>);
        if (dupe.length > 0) {
          logger.info({ callSid, orgId }, "[TwilioVoice] Missed-call SMS already sent — skipping duplicate");
          return;
        }
        await sendMissedCallSmsForOrg({ orgId, callerNumber, callerName: callerName || null, callSid });
      } catch (err) {
        logger.warn({ err, callSid }, "[TwilioVoice] Missed-call SMS pipeline error");
      }
    })();
  }

  // Fire-and-forget AI post-call analysis: extracts summary, sentiment,
  // urgency, action-item tasks and any requested appointment, then writes
  // them back to the call + creates the related tasks/calendar event.
  //
  // We do NOT depend on the in-memory session being present (it can be
  // gone after a process restart, TTL expiry, or because /gather already
  // deleted it on goodbye). Instead we resolve the call record from the
  // telephony log table by Twilio CallSid, then check the persisted
  // notes JSON for at least one conversational turn.
  if (callStatus === "completed") {
    void (async () => {
      try {
        let callDbId: number | null = session?.callDbId ?? null;
        let turnsCount = session?.history.length ?? 0;

        if (callDbId == null || turnsCount === 0) {
          // Resolve from DB. telephony_call_logs stores the Twilio CallSid.
          const [logRow] = await db
            .select({ orgId: telephonyCallLogsTable.organisationId })
            .from(telephonyCallLogsTable)
            .where(eq(telephonyCallLogsTable.providerCallSid, callSid))
            .limit(1);
          if (!logRow?.orgId) return;

          // Find the corresponding calls row by scanning notes for the CallSid.
          // The createCallRecord writer stores `{ callSid, ... }` as JSON in notes.
          const [callRow] = await db
            .select({ id: callsTable.id, notes: callsTable.notes })
            .from(callsTable)
            .where(and(
              eq(callsTable.organisationId, logRow.orgId),
              sql`${callsTable.notes} LIKE ${"%" + callSid + "%"}`,
            ))
            .limit(1);
          if (!callRow?.id) return;

          callDbId = callRow.id;
          try {
            const parsed = callRow.notes ? JSON.parse(callRow.notes) : null;
            turnsCount = Array.isArray(parsed?.turns) ? parsed.turns.length : 0;
          } catch {
            turnsCount = 0;
          }
        }

        if (callDbId == null || turnsCount === 0) return;

        const { processCallWithAI } = await import("../services/call-processor");
        const result = await processCallWithAI(callDbId);
        logger.info(
          {
            callSid,
            callDbId,
            tasksCreated: result.createdTasks.length,
            appointmentCreated: !!result.createdAppointment,
            sentiment: result.analysis.sentiment,
            urgency: result.analysis.urgency,
          },
          "[TwilioVoice] Post-call AI analysis completed",
        );

        // Option B: post-call recap email. Best-effort.
        try {
          const [callRow] = await db
            .select({
              orgId: callsTable.organisationId,
              phoneNumber: callsTable.phoneNumber,
              contactId: callsTable.contactId,
              notes: callsTable.notes,
            })
            .from(callsTable)
            .where(eq(callsTable.id, callDbId))
            .limit(1);
          if (callRow?.orgId) {
            let callerName: string | null = null;
            if (callRow.contactId) {
              const [c] = await db
                .select({ firstName: contactsTable.firstName, lastName: contactsTable.lastName })
                .from(contactsTable)
                .where(eq(contactsTable.id, callRow.contactId))
                .limit(1);
              if (c) callerName = formatCallerName(c.firstName ?? null, c.lastName ?? null) || null;
            }
            let voicemailTranscript: string | null = null;
            let transcriptSnippet: string | null = null;
            try {
              const parsed = callRow.notes ? JSON.parse(callRow.notes) : null;
              voicemailTranscript = parsed?.voicemail?.transcript || null;
              if (Array.isArray(parsed?.turns) && parsed.turns.length > 0) {
                transcriptSnippet = parsed.turns
                  .slice(0, 6)
                  .map((t: any) => `${t.role === "caller" ? "Client" : "Sophie"}: ${t.text}`)
                  .join(" — ")
                  .slice(0, 600);
              }
            } catch { /* ignore parse errors */ }
            await sendCallRecapEmail({
              orgId: callRow.orgId,
              callDbId,
              callerNumber: callRow.phoneNumber || "",
              callerName,
              summary: result.analysis.summary || null,
              sentiment: result.analysis.sentiment || null,
              urgency: result.analysis.urgency || null,
              tasksCreated: result.createdTasks.length,
              appointmentCreated: !!result.createdAppointment,
              voicemailTranscript,
              transcriptSnippet,
            });
          }
        } catch (mailErr) {
          logger.warn({ err: (mailErr as any)?.message || mailErr, callSid, callDbId }, "[TwilioVoice] Recap email skipped");
        }
      } catch (err: any) {
        // Non-fatal: the call already ended successfully. Common skip reasons
        // are quota exceeded, "déjà traité" (re-delivery from Twilio), or
        // advisory-lock contention with a concurrent /process invocation.
        logger.warn(
          { err: err?.message || err, callSid },
          "[TwilioVoice] Post-call AI analysis skipped",
        );
      }
    })();
  }

  // Clean up session
  sessions.delete(callSid);
  res.json({ received: true });
});

// ---------------------------------------------------------------------------
// Route: Dial completion (Twilio posts here after <Dial> ends).
// We only fall back to voicemail if the dial actually failed — otherwise
// the conseiller had a successful conversation and we want to hang up.
// POST /telephony/twilio/dial-complete
// ---------------------------------------------------------------------------
twilioVoiceRouter.post("/telephony/twilio/dial-complete", async (req: Request, res: Response): Promise<void> => {
  if (await rejectIfBadTwilioRequest(req, res, "/dial-complete")) return;
  const body = req.body as Record<string, string>;
  const querySid = (req.query as Record<string, string>).callSid || "";
  const callSid = body.CallSid || querySid;
  const dialStatus = body.DialCallStatus || "";
  logger.info({ callSid, dialStatus }, "[TwilioVoice] Dial complete");

  // Twilio statuses: completed | answered | busy | no-answer | failed | canceled
  const failedStatuses = new Set(["busy", "no-answer", "failed", "canceled"]);
  if (failedStatuses.has(dialStatus)) {
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
    const recordUrl = `${proto}://${host}/api/telephony/twilio/recording-complete?callSid=${encodeURIComponent(callSid)}`;
    sendTwiml(
      res,
      twimlRecord(recordUrl, "Le conseiller n'est pas joignable. Laissez votre message après le bip, puis raccrochez ou appuyez sur dièse."),
    );
    return;
  }
  // Successful conversation — hang up cleanly.
  sendTwiml(res, `<Hangup/>`);
});

// ---------------------------------------------------------------------------
// Route: Recording complete (Twilio posts here when <Record> finishes).
// Downloads the recording, transcribes via Gemini, persists everything and
// creates a follow-up task so the secrétaire never misses a voicemail.
// POST /telephony/twilio/recording-complete
// ---------------------------------------------------------------------------
twilioVoiceRouter.post("/telephony/twilio/recording-complete", async (req: Request, res: Response): Promise<void> => {
  if (await rejectIfBadTwilioRequest(req, res, "/recording-complete")) return;

  const body = req.body as Record<string, string>;
  const querySid = (req.query as Record<string, string>).callSid || "";
  const callSid = body.CallSid || querySid;
  const recordingUrl = body.RecordingUrl || "";
  const recordingDuration = parseInt(body.RecordingDuration || "0", 10);

  logger.info({ callSid, recordingDuration, hasUrl: !!recordingUrl }, "[TwilioVoice] Recording complete");

  // Always respond fast with empty TwiML so Twilio considers the call done.
  // The heavy work (download + transcribe + DB) runs in the background.
  sendTwiml(res, twimlSay("Merci, votre message a bien été enregistré. Au revoir."));

  if (!recordingUrl || !callSid) return;

  void (async () => {
    try {
      // Resolve org + call from the telephony log.
      const [logRow] = await db
        .select({
          orgId: telephonyCallLogsTable.organisationId,
          providerId: telephonyCallLogsTable.providerId,
          fromNumber: telephonyCallLogsTable.fromNumber,
        })
        .from(telephonyCallLogsTable)
        .where(eq(telephonyCallLogsTable.providerCallSid, callSid))
        .limit(1);
      if (!logRow?.orgId) {
        logger.warn({ callSid }, "[TwilioVoice] No telephony log for recording");
        return;
      }
      const orgId = logRow.orgId;

      // Persist the recording URL on the log immediately (so the recording
      // is reachable in the UI even if transcription fails).
      await db.update(telephonyCallLogsTable)
        .set({ recordingUrl })
        .where(eq(telephonyCallLogsTable.providerCallSid, callSid))
        .catch(() => {});

      // Resolve the calls.id row by scanning notes for the callSid (same
      // pattern as the AI fallback path).
      const [callRow] = await db
        .select({ id: callsTable.id, notes: callsTable.notes, contactId: callsTable.contactId, phoneNumber: callsTable.phoneNumber })
        .from(callsTable)
        .where(and(
          eq(callsTable.organisationId, orgId),
          sql`${callsTable.notes} LIKE ${"%" + callSid + "%"}`,
        ))
        .limit(1);
      if (!callRow?.id) return;

      // Idempotency: if we already processed a voicemail for this call
      // (Twilio re-deliveries, retries), bail out before re-transcribing,
      // re-creating tasks or re-sending recap email. We key on RecordingSid
      // when available, otherwise on the recordingUrl itself.
      const recordingSid = body.RecordingSid || "";
      try {
        const existing = callRow.notes ? JSON.parse(callRow.notes) : null;
        const vm = existing?.voicemail;
        if (vm && (
          (recordingSid && vm.recordingSid === recordingSid) ||
          (vm.url && vm.url === recordingUrl)
        )) {
          logger.info({ callSid, recordingSid }, "[TwilioVoice] Voicemail already processed — skipping duplicate");
          return;
        }
      } catch { /* fall through and process */ }

      // Pull credentials from the org's Twilio provider for the audio fetch
      // (Twilio recording URLs require basic auth).
      const provider = await getDefaultTwilioProviderForOrg(orgId);
      const accountSid = provider?.config.accountSid || process.env.TWILIO_ACCOUNT_SID || "";
      const auth = provider?.config.authToken || process.env.TWILIO_AUTH_TOKEN || "";

      let transcript: string | null = null;
      if (accountSid && auth) {
        // Twilio finalises the recording asynchronously; brief wait avoids
        // a 404 race on the very first poll.
        await new Promise(r => setTimeout(r, 1500));
        transcript = await transcribeTwilioRecording(recordingUrl, accountSid, auth);
      }

      // Update notes JSON with the voicemail block.
      try {
        const parsed = callRow.notes ? JSON.parse(callRow.notes) : {};
        parsed.voicemail = {
          url: recordingUrl,
          recordingSid: body.RecordingSid || null,
          transcript: transcript || null,
          durationSec: recordingDuration,
          at: new Date().toISOString(),
        };
        // Mark this call as a voicemail so the UI can render a distinctive
        // pill ("Message vocal") even when status=manque.
        if (Array.isArray(parsed.tags)) {
          if (!parsed.tags.includes("voicemail")) parsed.tags.push("voicemail");
        }
        await db.update(callsTable)
          .set({ notes: JSON.stringify(parsed), updatedAt: new Date() })
          .where(eq(callsTable.id, callRow.id));
      } catch (err) {
        logger.warn({ err, callSid }, "[TwilioVoice] Failed to persist voicemail notes");
      }

      // Mirror transcript into the dedicated column for analytics/search.
      if (transcript) {
        await db.update(telephonyCallLogsTable)
          .set({ transcription: transcript })
          .where(eq(telephonyCallLogsTable.providerCallSid, callSid))
          .catch(() => {});
      }

      // Create a follow-up task. We import lazily so the cold path stays cheap.
      try {
        const { tasksTable } = await import("@workspace/db");
        let callerName: string | null = null;
        if (callRow.contactId) {
          const [c] = await db
            .select({ firstName: contactsTable.firstName, lastName: contactsTable.lastName })
            .from(contactsTable)
            .where(eq(contactsTable.id, callRow.contactId))
            .limit(1);
          if (c) callerName = formatCallerName(c.firstName ?? null, c.lastName ?? null) || null;
        }
        const who = callerName || callRow.phoneNumber || "inconnu";
        const snippet = transcript ? transcript.slice(0, 240) : "(transcription indisponible — écouter l'enregistrement)";
        await db.insert(tasksTable).values({
          organisationId: orgId,
          title: `Rappeler ${who} — message vocal`,
          description: snippet,
          status: "en_attente" as any,
          priority: "haute" as any,
          dueDate: new Date(Date.now() + 24 * 3600 * 1000),
          callId: callRow.id,
        } as any).catch((err: any) => {
          logger.warn({ err: err?.message, callSid }, "[TwilioVoice] Voicemail task insert failed (schema mismatch?)");
        });
      } catch (err) {
        logger.warn({ err, callSid }, "[TwilioVoice] Voicemail task creation failed");
      }

      // Email recap with the voicemail transcript.
      try {
        await sendCallRecapEmail({
          orgId,
          callDbId: callRow.id,
          callerNumber: callRow.phoneNumber || "",
          callerName: null,
          voicemailTranscript: transcript,
        });
      } catch { /* already swallowed inside */ }

      logger.info({ callSid, callDbId: callRow.id, transcribed: !!transcript }, "[TwilioVoice] Voicemail processed");
    } catch (err) {
      logger.error({ err, callSid }, "[TwilioVoice] /recording-complete pipeline error");
    }
  })();
});
