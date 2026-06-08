// Secretaire telephonique IA (entrante) via Twilio Voice.
//
// Flux:
//   - Twilio appelle POST /api/voice/twilio/incoming quand un client appelle le
//     numero Twilio de l'organisation. On identifie l'org via AccountSid (meme
//     pattern que routes/whatsapp.ts), on joue une salutation et on ouvre un
//     <Gather input="speech"> pour ecouter l'appelant.
//   - Chaque tour de parole revient en POST /api/voice/twilio/respond avec
//     SpeechResult (transcription Twilio). On le passe a Gemini avec une persona
//     de secretaire CONTRAINTE (pas l'assistant complet a outils: l'appelant est
//     un visiteur anonyme), qui repond en JSON {say, done, outcome, ...}. On
//     parle la reponse et on reboucle, ou on raccroche.
//   - A la fin, on persiste: un appel (callsTable) + un log telephonie
//     (telephonyCallLogsTable) avec la transcription, et selon l'intention soit
//     un rendez-vous (calendarEventsTable) soit un message (messagesTable),
//     plus une notification pour le patron.
//
// Securite: signature Twilio verifiee par tenant. Le webhook est bypass de CSRF
// et de threatDetection (voir middleware/security.ts) car Twilio n'envoie pas
// d'Origin et la transcription vocale peut contenir des chaines anodines que les
// patterns d'injection signaleraient a tort.
//
// Etat conversationnel: Twilio est sans etat entre les requetes HTTP. On stocke
// la transcription en memoire, indexee par CallSid (TTL 30 min). LIMITATION
// connue: en multi-instance, les tours d'un meme appel doivent tomber sur la
// meme instance. Acceptable pour le mono-process actuel; durcir via DB si besoin.

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  db,
  telephonyProvidersTable,
  telephonyCallLogsTable,
  callsTable,
  messagesTable,
  calendarEventsTable,
  notificationsTable,
  contactsTable,
} from "@workspace/db";
import { ai } from "@workspace/integrations-gemini-ai";
import { callOrgGemini } from "../services/ai-providers";
import {
  GEMINI_FLASH_MODEL,
  geminiActualModel,
  extractGeminiTokens,
  recordAiUsage,
  safeJsonParse,
  sanitizePromptInput,
} from "../services/ai-utils";
import { assertAiQuota, invalidateQuotaCache } from "../services/ai-quota";
import { logger } from "../lib/logger";

export const voiceReceptionistRouter: IRouter = Router();

// --- Langues / voix -------------------------------------------------------

type RecLang = "fr" | "tr" | "en";

const SPEECH_LANG: Record<RecLang, string> = { fr: "fr-FR", tr: "tr-TR", en: "en-US" };
const DEFAULT_VOICE: Record<RecLang, string> = { fr: "Polly.Lea", tr: "Polly.Filiz", en: "Polly.Joanna" };
const LANG_NAME: Record<RecLang, string> = { fr: "francais", tr: "turc", en: "anglais" };

const DEFAULT_GREETING: Record<RecLang, string> = {
  fr: "Bonjour, vous etes en relation avec le secretariat. Comment puis-je vous aider ?",
  tr: "Merhaba, sekreterya ile gorusuyorsunuz. Size nasil yardimci olabilirim?",
  en: "Hello, you have reached the front desk. How may I help you?",
};
const DISABLED_MSG: Record<RecLang, string> = {
  fr: "Bonjour. Notre secretaire vocale n'est pas disponible pour le moment. Merci de rappeler ulterieurement.",
  tr: "Merhaba. Sesli sekreterimiz su anda musait degil. Lutfen daha sonra tekrar arayin.",
  en: "Hello. Our voice assistant is currently unavailable. Please call back later.",
};
const SESSION_LOST_MSG: Record<RecLang, string> = {
  fr: "Desole, notre echange a ete interrompu. Merci de rappeler pour reprendre. Au revoir.",
  tr: "Uzgunum, gorusmemiz kesildi. Devam etmek icin lutfen tekrar arayin. Hosca kalin.",
  en: "Sorry, our conversation was interrupted. Please call back to continue. Goodbye.",
};
const REPROMPT_MSG: Record<RecLang, string> = {
  fr: "Je n'ai pas bien entendu. Pouvez-vous repeter, s'il vous plait ?",
  tr: "Sizi tam duyamadim. Tekrar eder misiniz, lutfen?",
  en: "I didn't quite catch that. Could you please repeat?",
};
const NO_INPUT_BYE: Record<RecLang, string> = {
  fr: "Je n'ai rien entendu. Je vous laisse rappeler. Bonne journee.",
  tr: "Bir sey duyamadim. Tekrar arayabilirsiniz. Iyi gunler.",
  en: "I couldn't hear anything. Feel free to call back. Have a good day.",
};
const AI_ERROR_BYE: Record<RecLang, string> = {
  fr: "Desole, un probleme technique m'empeche de continuer. Votre appel a ete note, on vous rappellera. Au revoir.",
  tr: "Uzgunum, teknik bir sorun nedeniyle devam edemiyorum. Aramaniz kaydedildi, sizi arayacagiz. Hosca kalin.",
  en: "Sorry, a technical issue prevents me from continuing. Your call was noted and we'll call you back. Goodbye.",
};

function normalizeLang(x: unknown): RecLang {
  return x === "tr" || x === "en" || x === "fr" ? x : "fr";
}
function sanitizeVoice(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(v) ? v : null;
}

// --- Etat conversationnel (in-memory, par CallSid) ------------------------

interface Turn {
  role: "user" | "assistant";
  text: string;
}
interface CallSession {
  orgId: number;
  providerId: number;
  callerNumber: string;
  toNumber: string;
  lang: RecLang;
  voice: string;
  orgName: string;
  turns: Turn[];
  fulfilled: boolean;
  startedAt: number;
  emptyCount: number;
  /** Nom du contact connu correspondant au numero appelant (null si inconnu). */
  callerName: string | null;
  /** Nombre d'appels anterieurs deja enregistres pour ce numero. */
  callCount: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, CallSession>();
const finalizedCalls = new Map<string, number>();

function purgeStale(): void {
  const now = Date.now();
  if (sessions.size > 2000) {
    for (const [sid, s] of sessions) {
      if (now - s.startedAt > SESSION_TTL_MS) sessions.delete(sid);
    }
  }
  if (finalizedCalls.size > 5000) {
    for (const [sid, ts] of finalizedCalls) {
      if (now - ts > SESSION_TTL_MS) finalizedCalls.delete(sid);
    }
  }
}

// --- Helpers Twilio -------------------------------------------------------

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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function emptyTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

function gatherTwiml(say: string, lang: RecLang, voice: string): string {
  const speechLang = SPEECH_LANG[lang];
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Gather input="speech" language="${speechLang}" speechTimeout="auto" actionOnEmptyResult="true" ` +
    `action="/api/voice/twilio/respond" method="POST">` +
    `<Say voice="${escapeXml(voice)}" language="${speechLang}">${escapeXml(say)}</Say>` +
    `</Gather>` +
    `</Response>`
  );
}

function hangupTwiml(say: string, lang: RecLang, voice: string): string {
  const speechLang = SPEECH_LANG[lang];
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say voice="${escapeXml(voice)}" language="${speechLang}">${escapeXml(say)}</Say>` +
    `<Hangup/></Response>`
  );
}

// --- Resolution du tenant -------------------------------------------------

interface TenantMatch {
  orgId: number;
  providerId: number;
  authToken: string;
  label: string;
  config: Record<string, unknown>;
}

async function resolveTenants(accountSid: string): Promise<TenantMatch[]> {
  if (!accountSid) return [];
  const rows = await db
    .select({
      orgId: telephonyProvidersTable.organisationId,
      id: telephonyProvidersTable.id,
      label: telephonyProvidersTable.label,
      config: telephonyProvidersTable.config,
    })
    .from(telephonyProvidersTable)
    .where(
      and(
        eq(telephonyProvidersTable.provider, "twilio"),
        eq(telephonyProvidersTable.isActive, true),
        sql`${telephonyProvidersTable.config}->>'accountSid' = ${accountSid}`,
      ),
    )
    // Ordre deterministe: si (cas limite) plusieurs orgs partagent le meme
    // AccountSid Twilio, on resout toujours le meme fournisseur par defaut.
    .orderBy(desc(telephonyProvidersTable.id));
  return rows
    .map((r) => {
      const config = (r.config as Record<string, unknown>) ?? {};
      return {
        orgId: r.orgId as number,
        providerId: r.id,
        authToken: (config.authToken as string) ?? "",
        label: r.label,
        config,
      };
    })
    .filter((r) => r.authToken.length > 0 && r.orgId != null);
}

// --- Reconnaissance de l'appelant -----------------------------------------

interface CallerInfo {
  name: string | null;
  callCount: number;
}

/**
 * Reconnait un appelant connu: on rapproche son numero d'un contact de l'org
 * et on compte ses appels anterieurs. Comparaison sur les 9 derniers chiffres
 * (tolerante aux differences de format / indicatif). Best-effort: toute erreur
 * renvoie un appelant inconnu (la secretaire fonctionne normalement).
 */
async function lookupCaller(orgId: number, phone: string): Promise<CallerInfo> {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 6) return { name: null, callCount: 0 };
  const suffix = digits.slice(-9);
  const like = `%${suffix}`;
  try {
    const [contactRow, countRow] = await Promise.all([
      db
        .select({
          firstName: contactsTable.firstName,
          lastName: contactsTable.lastName,
          company: contactsTable.company,
        })
        .from(contactsTable)
        .where(and(
          eq(contactsTable.organisationId, orgId),
          sql`regexp_replace(coalesce(${contactsTable.phone}, ''), '\D', '', 'g') LIKE ${like}`,
        ))
        .limit(1),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(callsTable)
        .where(and(
          eq(callsTable.organisationId, orgId),
          sql`regexp_replace(coalesce(${callsTable.phoneNumber}, ''), '\D', '', 'g') LIKE ${like}`,
        )),
    ]);
    const c = contactRow[0];
    const name = c
      ? [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || (c.company ?? "").trim() || null
      : null;
    return { name: name || null, callCount: Number(countRow[0]?.c ?? 0) };
  } catch (err) {
    logger.warn({ err, orgId }, "[voice] lookupCaller a echoue — appelant traite comme inconnu");
    return { name: null, callCount: 0 };
  }
}

function personalizedGreeting(lang: RecLang, name: string): string {
  if (lang === "tr") return `Merhaba ${name}, tekrar aradiniz. Size nasil yardimci olabilirim?`;
  if (lang === "en") return `Hello ${name}, good to hear from you again. How may I help you?`;
  return `Bonjour ${name}, ravie de vous reentendre. Comment puis-je vous aider ?`;
}

// --- Moteur IA (persona secretaire contrainte) ----------------------------

interface ReceptionistAppointment {
  name: string;
  reason: string;
  startIso: string | null;
  whenText: string;
}
interface ReceptionistMessage {
  name: string;
  content: string;
}
interface ReceptionistResult {
  say: string;
  done: boolean;
  outcome: "appointment" | "message" | null;
  appointment: ReceptionistAppointment | null;
  message: ReceptionistMessage | null;
}

function buildSystemInstruction(orgName: string, lang: RecLang, caller?: CallerInfo): string {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }).format(now);
  return (
    `Tu es la secretaire telephonique IA de l'entreprise "${orgName}". ` +
    `Tu reponds AU TELEPHONE a un appelant (souvent un client ou un prospect). ` +
    `Parle en ${LANG_NAME[lang]}, de maniere chaleureuse, breve et naturelle: ` +
    `des reponses ORALES de 1 a 2 phrases maximum, sans listes ni emojis ni mise en forme.\n` +
    `Date et heure actuelles (Europe/Paris): ${todayStr}.\n` +
    (caller?.name
      ? `L'appelant est un contact CONNU de l'entreprise: ${caller.name}` +
        (caller.callCount > 0 ? ` (deja ${caller.callCount} appel(s) enregistre(s))` : "") +
        `. Adresse-toi a lui par son nom et NE redemande PAS son nom (tu le connais deja); utilise "${caller.name}" pour remplir le champ "name" d'un rendez-vous ou d'un message.\n`
      : "") +
    `\n` +
    `Ton role est STRICTEMENT limite a l'accueil:\n` +
    `- Saluer et comprendre la demande de l'appelant.\n` +
    `- Prendre un RENDEZ-VOUS: recueille le nom de l'appelant (sauf s'il est deja connu ci-dessus), le motif, et une date/heure souhaitee. Confirme oralement.\n` +
    `- Prendre un MESSAGE: recueille le nom de l'appelant (sauf s'il est deja connu ci-dessus) et le contenu du message.\n` +
    `- Repondre tres brievement aux questions generales; si tu ne connais pas l'info, propose de prendre un message.\n` +
    `Tu ne dois JAMAIS inventer d'informations confidentielles ni garantir une disponibilite precise: ` +
    `pour un rendez-vous, precise qu'il sera "a confirmer".\n\n` +
    `Renvoie UNIQUEMENT un JSON valide, sans aucun texte autour, avec cette structure exacte:\n` +
    `{\n` +
    `  "say": "ce que tu dis a voix haute maintenant",\n` +
    `  "done": false,\n` +
    `  "outcome": null,\n` +
    `  "appointment": { "name": "string", "reason": "string", "startIso": "2026-06-05T14:30:00" ou null, "whenText": "string" },\n` +
    `  "message": { "name": "string", "content": "string" }\n` +
    `}\n` +
    `Regles:\n` +
    `- Tant qu'il te manque une info pour aboutir, garde outcome=null et pose UNE seule question a la fois.\n` +
    `- Quand tu as TOUTES les infos d'un rendez-vous, mets outcome="appointment" et remplis "appointment".\n` +
    `- Quand tu as TOUTES les infos d'un message, mets outcome="message" et remplis "message".\n` +
    `- startIso doit etre une date/heure ISO 8601 si tu peux la determiner a partir de la demande et de la date du jour, sinon null.\n` +
    `- Quand l'appelant n'a plus rien a ajouter, mets done=true et termine poliment.\n` +
    `- Mets outcome une SEULE fois dans l'appel (ne le repete pas aux tours suivants).`
  );
}

async function runReceptionistTurn(session: CallSession): Promise<ReceptionistResult> {
  await assertAiQuota(session.orgId);

  const contents = session.turns.map((t) => ({
    role: t.role === "user" ? ("user" as const) : ("model" as const),
    parts: [{ text: t.text }],
  }));

  const aiStart = Date.now();
  let response: { text?: string };
  try {
    // Client Gemini per-org (BYOK) : cle de l'org si configuree, repli
    // plateforme automatique si la cle org est absente OU invalide a l'exec.
    response = (await callOrgGemini(session.orgId, (client) => client.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: contents as unknown as Parameters<typeof ai.models.generateContent>[0]["contents"],
      config: {
        systemInstruction: buildSystemInstruction(session.orgName, session.lang, {
          name: session.callerName,
          callCount: session.callCount,
        }),
        responseMimeType: "application/json",
        maxOutputTokens: 700,
        temperature: 0.5,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }))) as { text?: string };
  } catch (err) {
    await recordAiUsage({
      organisationId: session.orgId,
      provider: "gemini",
      model: GEMINI_FLASH_MODEL,
      route: "voice-receptionist",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - aiStart,
      status: "error",
      errorMessage: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    throw err;
  }

  const tokens = extractGeminiTokens(response);
  await recordAiUsage({
    organisationId: session.orgId,
    provider: "gemini",
    model: geminiActualModel(response, GEMINI_FLASH_MODEL),
    route: "voice-receptionist",
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    durationMs: Date.now() - aiStart,
    status: "success",
  });
  invalidateQuotaCache(session.orgId);

  const fallback: ReceptionistResult = {
    say: REPROMPT_MSG[session.lang],
    done: false,
    outcome: null,
    appointment: null,
    message: null,
  };
  const parsed = safeJsonParse<Partial<ReceptionistResult>>(response.text, fallback);

  const say =
    typeof parsed.say === "string" && parsed.say.trim()
      ? parsed.say.slice(0, 600)
      : fallback.say;
  const outcome =
    parsed.outcome === "appointment" || parsed.outcome === "message" ? parsed.outcome : null;

  let appointment: ReceptionistAppointment | null = null;
  if (outcome === "appointment" && parsed.appointment && typeof parsed.appointment === "object") {
    const a = parsed.appointment as unknown as Record<string, unknown>;
    appointment = {
      name: typeof a.name === "string" ? a.name.slice(0, 200) : "",
      reason: typeof a.reason === "string" ? a.reason.slice(0, 500) : "",
      startIso: typeof a.startIso === "string" ? a.startIso.slice(0, 40) : null,
      whenText: typeof a.whenText === "string" ? a.whenText.slice(0, 200) : "",
    };
  }
  let message: ReceptionistMessage | null = null;
  if (outcome === "message" && parsed.message && typeof parsed.message === "object") {
    const m = parsed.message as unknown as Record<string, unknown>;
    message = {
      name: typeof m.name === "string" ? m.name.slice(0, 200) : "",
      content: typeof m.content === "string" ? m.content.slice(0, 2000) : "",
    };
  }

  return { say, done: !!parsed.done, outcome, appointment, message };
}

// --- Persistance ----------------------------------------------------------

function transcriptText(session: CallSession): string {
  const userLabel = session.lang === "tr" ? "Arayan" : session.lang === "en" ? "Caller" : "Appelant";
  const botLabel = session.lang === "tr" ? "Sekreter" : session.lang === "en" ? "Receptionist" : "Secretaire";
  return session.turns
    .map((t) => `${t.role === "user" ? userLabel : botLabel}: ${t.text}`)
    .join("\n");
}

async function persistOutcome(session: CallSession, result: ReceptionistResult): Promise<void> {
  if (session.fulfilled || !result.outcome) return;
  const caller = session.callerNumber || "inconnu";

  // `fulfilled` n'est passe a true qu'APRES une ecriture reussie: si un insert
  // echoue, on laisse la porte ouverte a une nouvelle tentative au tour suivant
  // plutot que de perdre silencieusement le rendez-vous / message.
  try {
    if (result.outcome === "appointment" && result.appointment) {
      const a = result.appointment;
      const start = a.startIso ? new Date(a.startIso) : null;
      const validStart = start && !Number.isNaN(start.getTime()) ? start : null;

      if (validStart) {
        const end = new Date(validStart.getTime() + 30 * 60000);
        const [event] = await db
          .insert(calendarEventsTable)
          .values({
            organisationId: session.orgId,
            title: `RDV (appel): ${a.name || caller}`,
            description:
              `Motif: ${a.reason || "non precise"}\n` +
              `Demande via la secretaire telephonique IA.\n` +
              `Horaire demande: ${a.whenText || "—"}\n` +
              `Telephone: ${caller}`,
            type: "rendez_vous",
            startDate: validStart,
            endDate: end,
            color: "#f59e0b",
            reminder: "15min",
            contactName: a.name || null,
            contactPhone: caller,
            status: "a_confirmer",
            priority: "normale",
          })
          .returning({ id: calendarEventsTable.id });

        await db.insert(notificationsTable).values({
          organisationId: session.orgId,
          type: "info",
          title: "Nouveau rendez-vous (secretaire IA)",
          message:
            `${a.name || caller} a demande un rendez-vous (${a.whenText || "horaire a confirmer"}) ` +
            `par telephone. A confirmer.`,
          priority: "haute",
          actionUrl: "/calendrier",
          sourceType: "ai_receptionist_appointment",
          sourceId: event ? String(event.id) : null,
        });
        return;
      }

      // Pas de date exploitable -> on enregistre une demande de rappel (message).
      await db.insert(messagesTable).values({
        organisationId: session.orgId,
        phoneNumber: caller,
        contactName: a.name || null,
        content:
          `Demande de rendez-vous (a planifier).\n` +
          `Motif: ${a.reason || "non precise"}\n` +
          `Horaire souhaite: ${a.whenText || "non precise"}`,
        type: "rappel",
        priority: "haute",
      });
      await db.insert(notificationsTable).values({
        organisationId: session.orgId,
        type: "info",
        title: "Demande de rendez-vous a planifier (secretaire IA)",
        message: `${a.name || caller} souhaite un rendez-vous (${a.whenText || "horaire a preciser"}).`,
        priority: "haute",
        actionUrl: "/messages",
        sourceType: "ai_receptionist_callback",
        sourceId: null,
      });
      return;
    }

    if (result.outcome === "message" && result.message) {
      const m = result.message;
      await db.insert(messagesTable).values({
        organisationId: session.orgId,
        phoneNumber: caller,
        contactName: m.name || null,
        content: m.content || "(message vide)",
        type: "appel",
        priority: "moyenne",
      });
      await db.insert(notificationsTable).values({
        organisationId: session.orgId,
        type: "info",
        title: "Nouveau message telephonique (secretaire IA)",
        message: `${m.name || caller}: ${(m.content || "").slice(0, 140)}`,
        priority: "normale",
        actionUrl: "/messages",
        sourceType: "ai_receptionist_message",
        sourceId: null,
      });
    }
  } catch (err) {
    logger.error({ err, orgId: session.orgId }, "[voice] echec persistance outcome");
  }
}

async function finalizeCall(callSid: string, session: CallSession): Promise<void> {
  if (!callSid || finalizedCalls.has(callSid)) return;
  finalizedCalls.set(callSid, Date.now());
  const caller = session.callerNumber || "inconnu";
  const duration = Math.max(0, Math.round((Date.now() - session.startedAt) / 1000));
  const transcript = transcriptText(session);

  try {
    await db.insert(callsTable).values({
      organisationId: session.orgId,
      phoneNumber: caller,
      contactName: null,
      direction: "entrant",
      status: "termine",
      duration,
      notes: `[Secretaire telephonique IA]\n${transcript}`,
      sentiment: "neutre",
      tags: ["secretaire-ia"],
    });
  } catch (err) {
    logger.error({ err, orgId: session.orgId }, "[voice] echec insertion callsTable");
  }

  try {
    await db.insert(telephonyCallLogsTable).values({
      organisationId: session.orgId,
      providerId: session.providerId,
      providerCallSid: callSid,
      direction: "inbound",
      fromNumber: caller,
      toNumber: session.toNumber || "",
      status: "completed",
      duration,
      transcription: transcript,
      metadata: {
        aiReceptionist: true,
        fulfilled: session.fulfilled,
        turns: session.turns.length,
      },
      startedAt: new Date(session.startedAt),
      endedAt: new Date(),
    });
  } catch (err) {
    logger.error({ err, orgId: session.orgId }, "[voice] echec insertion telephonyCallLogsTable");
  }

  sessions.delete(callSid);
}

// --- Webhooks -------------------------------------------------------------

voiceReceptionistRouter.post("/voice/twilio/incoming", async (req: Request, res: Response): Promise<void> => {
  res.type("text/xml");
  purgeStale();
  const body = (req.body ?? {}) as Record<string, string>;
  const accountSid = body.AccountSid;
  const callSid = body.CallSid;
  if (!accountSid || !callSid) {
    res.status(400).send(emptyTwiml());
    return;
  }

  const tenants = await resolveTenants(accountSid);
  if (tenants.length === 0) {
    logger.warn({ accountSid }, "[voice] AccountSid inconnu");
    res.status(403).send(emptyTwiml());
    return;
  }
  const tenant = tenants.find((t) => validateTwilioSignature(req, t.authToken));
  if (!tenant) {
    logger.warn({ accountSid }, "[voice] signature invalide");
    res.status(403).send(emptyTwiml());
    return;
  }

  const cfg = (tenant.config.aiReceptionist as Record<string, unknown> | undefined) ?? {};
  const lang = normalizeLang(cfg.language);
  const voice = sanitizeVoice(cfg.voice) ?? DEFAULT_VOICE[lang];
  const orgName =
    (typeof cfg.orgName === "string" && cfg.orgName.trim()) || tenant.label || "notre entreprise";

  if (cfg.enabled !== true) {
    res.status(200).send(hangupTwiml(DISABLED_MSG[lang], lang, voice));
    return;
  }

  // Reconnaissance de l'appelant (best-effort): si le numero correspond a un
  // contact connu, on personnalise la salutation et on injecte le nom dans la
  // persona pour eviter de redemander une info deja connue.
  const caller = await lookupCaller(tenant.orgId, body.From ?? "");

  const customGreeting =
    typeof cfg.greeting === "string" && cfg.greeting.trim() ? cfg.greeting.trim() : null;
  const greeting =
    customGreeting ?? (caller.name ? personalizedGreeting(lang, caller.name) : DEFAULT_GREETING[lang]);

  sessions.set(callSid, {
    orgId: tenant.orgId,
    providerId: tenant.providerId,
    callerNumber: body.From ?? "",
    toNumber: body.To ?? "",
    lang,
    voice,
    orgName,
    turns: [{ role: "assistant", text: greeting }],
    fulfilled: false,
    startedAt: Date.now(),
    emptyCount: 0,
    callerName: caller.name,
    callCount: caller.callCount,
  });

  res.status(200).send(gatherTwiml(greeting, lang, voice));
});

voiceReceptionistRouter.post("/voice/twilio/respond", async (req: Request, res: Response): Promise<void> => {
  res.type("text/xml");
  const body = (req.body ?? {}) as Record<string, string>;
  const accountSid = body.AccountSid;
  const callSid = body.CallSid;

  const tenants = await resolveTenants(accountSid);
  const tenant = tenants.find((t) => validateTwilioSignature(req, t.authToken));
  if (!tenant) {
    res.status(403).send(emptyTwiml());
    return;
  }

  const session = callSid ? sessions.get(callSid) : undefined;
  if (!session) {
    const cfg = (tenant.config.aiReceptionist as Record<string, unknown> | undefined) ?? {};
    const lang = normalizeLang(cfg.language);
    const voice = sanitizeVoice(cfg.voice) ?? DEFAULT_VOICE[lang];
    res.status(200).send(hangupTwiml(SESSION_LOST_MSG[lang], lang, voice));
    return;
  }

  // Liaison stricte session<->tenant: une requete signee par un AccountSid
  // partage ne doit jamais piloter la session d'une autre organisation.
  if (session.orgId !== tenant.orgId) {
    logger.warn({ callSid, sessionOrg: session.orgId, tenantOrg: tenant.orgId }, "[voice] mismatch org session/tenant");
    res.status(403).send(emptyTwiml());
    return;
  }

  const speech = (body.SpeechResult ?? "").trim();
  if (!speech) {
    session.emptyCount += 1;
    if (session.emptyCount >= 2) {
      await finalizeCall(callSid, session);
      res.status(200).send(hangupTwiml(NO_INPUT_BYE[session.lang], session.lang, session.voice));
      return;
    }
    res.status(200).send(gatherTwiml(REPROMPT_MSG[session.lang], session.lang, session.voice));
    return;
  }
  session.emptyCount = 0;
  session.turns.push({ role: "user", text: sanitizePromptInput(speech, 1000) || speech });

  let result: ReceptionistResult;
  try {
    result = await runReceptionistTurn(session);
  } catch (err) {
    logger.error({ err, orgId: session.orgId }, "[voice] echec tour IA");
    await finalizeCall(callSid, session);
    res.status(200).send(hangupTwiml(AI_ERROR_BYE[session.lang], session.lang, session.voice));
    return;
  }

  session.turns.push({ role: "assistant", text: result.say });

  if (result.outcome && !session.fulfilled) {
    await persistOutcome(session, result);
  }

  const userTurns = session.turns.filter((t) => t.role === "user").length;
  const done = result.done || userTurns >= 12;
  if (done) {
    await finalizeCall(callSid, session);
    res.status(200).send(hangupTwiml(result.say, session.lang, session.voice));
    return;
  }

  res.status(200).send(gatherTwiml(result.say, session.lang, session.voice));
});

voiceReceptionistRouter.post("/voice/twilio/status", async (req: Request, res: Response): Promise<void> => {
  res.type("text/xml");
  const body = (req.body ?? {}) as Record<string, string>;
  const callSid = body.CallSid;
  const status = body.CallStatus;
  const session = callSid ? sessions.get(callSid) : undefined;
  const terminal = ["completed", "failed", "busy", "no-answer", "canceled"].includes(status ?? "");
  if (session && terminal) {
    const tenants = await resolveTenants(body.AccountSid ?? "");
    const tenant = tenants.find((t) => validateTwilioSignature(req, t.authToken));
    // Signature valide ET meme organisation que la session (anti cross-tenant).
    if (tenant && tenant.orgId === session.orgId) {
      await finalizeCall(callSid, session);
    }
  }
  res.status(200).send(emptyTwiml());
});
