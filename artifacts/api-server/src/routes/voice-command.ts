import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { db, callsTable, contactsTable, tasksTable, calendarEventsTable, projetsTable, messagesTable } from "@workspace/db";
import { eq, desc, and, sql, or } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { safeJsonParse, aiCallWithRetry, sanitizePromptInput } from "../services/ai-utils";
import { assertAiQuota, AiQuotaExceededError } from "../services/ai-quota";
import { logger } from "../lib/logger";
import { logAudit } from "./audit";

let ai: any = null;
try {
  const mod = require("@workspace/integrations-gemini-ai");
  ai = mod.ai;
} catch (e) { logger.warn({ err: e }, "[VoiceCommand] Gemini AI not available:"); }

const router: IRouter = Router();

// ───────────────────────── Pending action token ──────────────────────────────
// Write intents are NEVER executed inline. The parsed action is signed into a
// token (HMAC-SHA256, 5-min TTL) and returned to the client; the UI must show
// a confirmation card and call POST /voice/confirm to execute.
const PENDING_TTL_MS = 5 * 60_000;
const WRITE_INTENTS = new Set([
  "create_task",
  "create_contact",
  "schedule_meeting",
  "send_message",
  "log_call",
]);

function getPendingSecret(): string {
  const s = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (or JWT_SECRET) is required in production for voice action signing");
  }
  return "dev-voice-pending-secret-do-not-use-in-prod";
}

// One-shot replay protection: tokens may only be redeemed once within their
// TTL window. Stores token signatures (small) with their expiry; opportunistic
// GC keeps the map bounded.
const usedTokens = new Map<string, number>();
function consumeTokenOnce(sig: string, exp: number): boolean {
  const now = Date.now();
  // GC expired entries; bound size to ~10k.
  if (usedTokens.size > 10_000) {
    for (const [k, e] of usedTokens) if (e < now) usedTokens.delete(k);
  }
  if (usedTokens.has(sig)) return false;
  usedTokens.set(sig, exp);
  return true;
}

function signPendingAction(payload: object): string {
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getPendingSecret()).update(json).digest("base64url");
  return `${json}.${sig}`;
}

function verifyPendingAction(token: string): any | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [json, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", getPendingSecret()).update(json).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// ───────────────────────── Intent parsing ────────────────────────────────────
interface VoiceCommand {
  intent: string;
  entity?: string;
  params?: Record<string, string>;
}

function parseCommandRegex(text: string): VoiceCommand {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  if (t.match(/briefing|resume.*(jour|today)|quoi de neuf|resume/))
    return { intent: "daily_briefing" };
  if (t.match(/combien.*(appel|call)|nombre.*(appel|call)|appels.*aujourd/))
    return { intent: "count_calls" };
  if (t.match(/combien.*(tache|task)|nombre.*(tache|task)|taches.*(attente|pending)/))
    return { intent: "count_tasks" };
  if (t.match(/combien.*(contact)|nombre.*(contact)/))
    return { intent: "count_contacts" };
  if (t.match(/derniers? appels?|appels? recents?|recent.*call/))
    return { intent: "recent_calls" };
  if (t.match(/taches? urgente|taches? haute|taches? priorite|urgent.*task/))
    return { intent: "urgent_tasks" };

  // ── Write intents (require confirmation) ────────────────────────────────
  if (t.match(/(planifie|programme|prend|fixe|reserve).*(rdv|rendez|reunion|meeting|rv)|(rdv|reunion|rendez vous|meeting).*(avec|le|demain|aujourd)/)) {
    const withMatch = text.match(/avec\s+([^,.;]+?)(?:\s+(?:le|demain|aujourd|a\b|à\b|$))/i);
    const titleMatch = text.match(/(?:reunion|rdv|rendez.?vous|meeting)\s+(?:avec\s+)?([^,.;]+)/i);
    return {
      intent: "schedule_meeting",
      params: {
        title: (titleMatch?.[1] || "Nouveau rendez-vous").trim(),
        contactName: (withMatch?.[1] || "").trim(),
        rawText: text,
      },
    };
  }
  if (t.match(/(envoie|envoyer|send).*(sms|message|msg).*(a |au |à )|(sms|message)\s+(a |au |à )/)) {
    const toMatch = text.match(/(?:a |au |à )\s*([A-Za-zÀ-ÿ' -]+?)(?:\s+(?:disant|dis|que|pour|:|$))/i);
    const bodyMatch = text.match(/(?:disant|dis|que|:)\s*(.+)$/i);
    return {
      intent: "send_message",
      params: {
        contactName: (toMatch?.[1] || "").trim(),
        body: (bodyMatch?.[1] || "").trim(),
        rawText: text,
      },
    };
  }
  if (t.match(/(enregistre|note|log|consigne).*(appel|call)|(appel|call).*(enregistre|note|consigne)/)) {
    const withMatch = text.match(/(?:avec|de|à|a)\s+([A-Za-zÀ-ÿ' -]+?)(?:\s+(?:dur|de|sur|:|$))/i);
    const noteMatch = text.match(/(?:note|notes|sujet|à propos|a propos)\s*[:,-]?\s*(.+)$/i);
    return {
      intent: "log_call",
      params: {
        contactName: (withMatch?.[1] || "").trim(),
        note: (noteMatch?.[1] || "").trim(),
        rawText: text,
      },
    };
  }
  if (t.match(/(cre(e|er)|ajoute|nouveau).*(contact)|nouveau client/)) {
    const nameMatch = text.match(/(?:contact|client)\s+(?:nomm(?:e|é|ée)\s+)?([A-Za-zÀ-ÿ' -]+?)(?:\s+(?:tel|telephone|téléphone|email|@|$))/i);
    const phoneMatch = text.match(/(\+?\d[\d\s.-]{7,}\d)/);
    const emailMatch = text.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
    return {
      intent: "create_contact",
      params: {
        name: (nameMatch?.[1] || "Nouveau contact").trim(),
        phone: (phoneMatch?.[1] || "").replace(/[\s.-]/g, ""),
        email: emailMatch?.[1] || "",
        rawText: text,
      },
    };
  }
  if (t.match(/cre(e|er).*tache|nouvelle? tache|ajoute.*tache|new.*task/)) {
    const titleMatch = text.match(/(?:tache|task)\s+(.+)/i);
    return { intent: "create_task", params: { title: (titleMatch?.[1] || "Nouvelle tache").trim() } };
  }

  if (t.match(/appel(le|er)?\s|telephone|call\s/)) {
    const nameMatch = text.match(/(?:appelle|appeler|call)\s+(.+)/i);
    return { intent: "call_contact", params: { name: nameMatch?.[1] || "" } };
  }
  if (t.match(/cherche|recherche|trouve|search|find/)) {
    const queryMatch = text.match(/(?:cherche|recherche|trouve|search|find)\s+(.+)/i);
    return { intent: "search", params: { query: queryMatch?.[1] || "" } };
  }
  if (t.match(/combien.*(projet)|nombre.*(projet)|projets?.*(actif|retard|cours)/))
    return { intent: "count_projets" };
  if (t.match(/projets?.*(retard|late|overdue)|retard.*projet/))
    return { intent: "projets_overdue" };
  if (t.match(/agenda|rendez.?vous|rdv|calendrier|calendar|evenement/))
    return { intent: "calendar" };
  if (t.match(/performance|statistique|stats|kpi/))
    return { intent: "performance" };
  if (t.match(/aide|help|que peux.tu|commande/))
    return { intent: "help" };
  if (t.match(/bonjour|salut|coucou|bonsoir|hello|hi/))
    return { intent: "greeting" };
  if (t.match(/heure|quelle heure|time/))
    return { intent: "time" };
  if (t.match(/merci|thank/))
    return { intent: "thanks" };

  return { intent: "unknown", params: { text } };
}

async function parseCommandAI(text: string): Promise<VoiceCommand> {
  if (!ai) return parseCommandRegex(text);

  const safeText = sanitizePromptInput(text, 1000);
  try {
    const result = await aiCallWithRetry(() => ai!.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [{
        role: "user",
        parts: [{ text: `Tu es un assistant vocal pour un logiciel de gestion de bureau en francais.
Analyse cette commande vocale et retourne un JSON avec "intent" et "params".

Intents possibles:
- daily_briefing
- count_calls / count_tasks / count_contacts / count_projets / projets_overdue
- recent_calls / urgent_tasks
- create_task (params: {title})  ⚠ requiert confirmation
- create_contact (params: {name, phone, email})  ⚠ requiert confirmation
- schedule_meeting (params: {title, contactName, dateText})  ⚠ requiert confirmation
- send_message (params: {contactName, body})  ⚠ requiert confirmation
- log_call (params: {contactName, note, durationSec})  ⚠ requiert confirmation
- call_contact (params: {name})
- search (params: {query})
- calendar / performance / greeting / time / thanks / help
- unknown

Commande: "${safeText}"

Reponds UNIQUEMENT en JSON valide, sans backticks ni explication.` }]
      }],
    }), { label: "voice-command", maxRetries: 1 });

    const parsed = safeJsonParse<VoiceCommand>((result as any).text, { intent: "unknown", params: { text } });
    if (parsed.intent) return parsed;
  } catch (err) {
    logger.warn({ err: err }, "[VoiceCommand] AI parse fallback:");
  }

  return parseCommandRegex(text);
}

// ───────────────────────── Read-intent dispatcher ────────────────────────────
async function dispatchReadIntent(
  command: VoiceCommand,
  orgId: number,
  text: string,
): Promise<{ spoken: string; data: any; action: string | null; navigate: string | null }> {
  let spokenResponse = "";
  let data: any = null;
  let action: string | null = null;
  let navigate: string | null = null;

  switch (command.intent) {
    case "daily_briefing": {
      const [calls, tasks, contacts, events] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(callsTable)
          .where(and(eq(callsTable.organisationId, orgId), sql`DATE(${callsTable.createdAt}) = CURRENT_DATE`)),
        db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
          .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "en_attente"))),
        db.select({ count: sql<number>`count(*)::int` }).from(contactsTable)
          .where(eq(contactsTable.organisationId, orgId)),
        db.select({ count: sql<number>`count(*)::int` }).from(calendarEventsTable)
          .where(and(eq(calendarEventsTable.organisationId, orgId), sql`DATE(${calendarEventsTable.startDate}) = CURRENT_DATE`)),
      ]);
      const c = calls[0]?.count || 0;
      const t = tasks[0]?.count || 0;
      const ct = contacts[0]?.count || 0;
      const ev = events[0]?.count || 0;
      spokenResponse = `Bonjour! Voici votre briefing du jour. Vous avez ${c} appel${c > 1 ? "s" : ""} aujourd'hui, ${t} tache${t > 1 ? "s" : ""} en attente, ${ct} contact${ct > 1 ? "s" : ""} au total, et ${ev} evenement${ev > 1 ? "s" : ""} au calendrier.`;
      data = { calls: c, tasks: t, contacts: ct, events: ev };
      navigate = "/";
      break;
    }
    case "count_calls": {
      const [r] = await db.select({ count: sql<number>`count(*)::int` }).from(callsTable)
        .where(and(eq(callsTable.organisationId, orgId), sql`DATE(${callsTable.createdAt}) = CURRENT_DATE`));
      const n = r?.count || 0;
      spokenResponse = `Vous avez ${n} appel${n > 1 ? "s" : ""} aujourd'hui.`;
      data = { count: n }; navigate = "/appels"; break;
    }
    case "count_tasks": {
      const [r] = await db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
        .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "en_attente")));
      const n = r?.count || 0;
      spokenResponse = `Vous avez ${n} tache${n > 1 ? "s" : ""} en attente.`;
      data = { count: n }; navigate = "/taches"; break;
    }
    case "count_contacts": {
      const [r] = await db.select({ count: sql<number>`count(*)::int` }).from(contactsTable)
        .where(eq(contactsTable.organisationId, orgId));
      const n = r?.count || 0;
      spokenResponse = `Vous avez ${n} contact${n > 1 ? "s" : ""} au total.`;
      data = { count: n }; navigate = "/contacts"; break;
    }
    case "count_projets": {
      const [actifs, total] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(projetsTable)
          .where(and(eq(projetsTable.organisationId, orgId), sql`${projetsTable.status} NOT IN ('termine','annule')`)),
        db.select({ count: sql<number>`count(*)::int` }).from(projetsTable)
          .where(eq(projetsTable.organisationId, orgId)),
      ]);
      const na = actifs[0]?.count || 0;
      const nt = total[0]?.count || 0;
      spokenResponse = `Vous avez ${na} projet${na > 1 ? "s" : ""} actif${na > 1 ? "s" : ""} sur ${nt} au total.`;
      data = { actifs: na, total: nt }; navigate = "/projets"; break;
    }
    case "projets_overdue": {
      const [r] = await db.select({ count: sql<number>`count(*)::int` }).from(projetsTable)
        .where(and(eq(projetsTable.organisationId, orgId), sql`${projetsTable.endDate} < now()`, sql`${projetsTable.status} NOT IN ('termine','annule')`));
      const n = r?.count || 0;
      spokenResponse = n > 0
        ? `Attention: ${n} projet${n > 1 ? "s" : ""} ${n > 1 ? "sont" : "est"} en retard sur le planning.`
        : "Aucun projet n'est en retard. Bravo!";
      data = { overdue: n }; navigate = "/projets"; break;
    }
    case "recent_calls": {
      const calls = await db.select().from(callsTable)
        .where(eq(callsTable.organisationId, orgId)).orderBy(desc(callsTable.createdAt)).limit(5);
      const names = calls.map(c => c.contactName || c.phoneNumber).join(", ");
      spokenResponse = calls.length > 0
        ? `Vos ${calls.length} derniers appels: ${names}.`
        : "Aucun appel recent.";
      data = { calls: calls.map(c => ({ name: c.contactName, phone: c.phoneNumber, status: c.status })) };
      navigate = "/appels"; break;
    }
    case "urgent_tasks": {
      const tasks = await db.select().from(tasksTable)
        .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.priority, "haute"), eq(tasksTable.status, "en_attente")))
        .orderBy(desc(tasksTable.createdAt)).limit(5);
      const titles = tasks.map(t => t.title).join(", ");
      spokenResponse = tasks.length > 0
        ? `Vous avez ${tasks.length} tache${tasks.length > 1 ? "s" : ""} urgente${tasks.length > 1 ? "s" : ""}: ${titles}.`
        : "Aucune tache urgente en attente.";
      data = { tasks: tasks.map(t => ({ id: t.id, title: t.title })) };
      navigate = "/taches"; break;
    }
    case "call_contact": {
      const name = command.params?.name || "";
      if (!name) { spokenResponse = "Quel contact souhaitez-vous appeler?"; break; }
      const useUnaccent = await ensureUnaccentExtension();
      const namePattern = `%${name}%`;
      const [contact] = await db.select().from(contactsTable)
        .where(and(eq(contactsTable.organisationId, orgId), or(
          accentInsensitiveIlike(contactsTable.firstName, namePattern, useUnaccent),
          accentInsensitiveIlike(contactsTable.lastName, namePattern, useUnaccent)
        ))).limit(1);
      if (contact && contact.phone) {
        spokenResponse = `J'ai trouve ${contact.firstName} ${contact.lastName}. Son numero est ${contact.phone}. Lancement de l'appel.`;
        data = { contact: { name: `${contact.firstName} ${contact.lastName}`, phone: contact.phone } };
        action = "initiate_call";
      } else {
        spokenResponse = `Je n'ai pas trouve de contact nomme ${name}.`;
      }
      break;
    }
    case "search": {
      const query = command.params?.query || "";
      if (!query) { spokenResponse = "Que souhaitez-vous rechercher?"; break; }
      const useUnaccent = await ensureUnaccentExtension();
      const qPattern = `%${query}%`;
      const [contacts, tasks] = await Promise.all([
        db.select().from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), or(
          accentInsensitiveIlike(contactsTable.firstName, qPattern, useUnaccent),
          accentInsensitiveIlike(contactsTable.lastName, qPattern, useUnaccent),
          accentInsensitiveIlike(contactsTable.company, qPattern, useUnaccent)
        ))).limit(3),
        db.select().from(tasksTable).where(and(eq(tasksTable.organisationId, orgId),
          accentInsensitiveIlike(tasksTable.title, qPattern, useUnaccent))).limit(3),
      ]);
      const total = contacts.length + tasks.length;
      spokenResponse = total > 0
        ? `J'ai trouve ${total} resultat${total > 1 ? "s" : ""}: ${contacts.length} contact${contacts.length > 1 ? "s" : ""} et ${tasks.length} tache${tasks.length > 1 ? "s" : ""}.`
        : `Aucun resultat pour "${query}".`;
      data = { contacts: contacts.map(c => `${c.firstName} ${c.lastName}`), tasks: tasks.map(t => t.title) };
      break;
    }
    case "calendar": {
      const events = await db.select().from(calendarEventsTable)
        .where(and(eq(calendarEventsTable.organisationId, orgId), sql`DATE(${calendarEventsTable.startDate}) = CURRENT_DATE`))
        .orderBy(calendarEventsTable.startDate).limit(5);
      spokenResponse = events.length > 0
        ? `Vous avez ${events.length} evenement${events.length > 1 ? "s" : ""} aujourd'hui: ${events.map(e => e.title).join(", ")}.`
        : "Aucun evenement prevu aujourd'hui.";
      data = { events: events.map(e => ({ title: e.title, time: e.startDate })) };
      navigate = "/calendrier"; break;
    }
    case "performance": {
      const [calls, tasks] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(callsTable)
          .where(and(eq(callsTable.organisationId, orgId), sql`${callsTable.createdAt} >= now() - interval '7 days'`)),
        db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
          .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "termine"), sql`${tasksTable.updatedAt} >= now() - interval '7 days'`)),
      ]);
      spokenResponse = `Cette semaine: ${calls[0]?.count || 0} appels passes et ${tasks[0]?.count || 0} taches terminees.`;
      data = { weekCalls: calls[0]?.count || 0, weekTasksDone: tasks[0]?.count || 0 };
      navigate = "/analyse"; break;
    }
    case "greeting": {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? "Bonjour" : hour < 18 ? "Bon apres-midi" : "Bonsoir";
      spokenResponse = `${greeting}! Comment puis-je vous aider?`; break;
    }
    case "time": {
      const now = new Date();
      const h = now.getHours(); const m = now.getMinutes();
      spokenResponse = `Il est ${h} heure${h > 1 ? "s" : ""} ${m > 0 ? `et ${m} minute${m > 1 ? "s" : ""}` : ""}.`;
      break;
    }
    case "thanks": {
      spokenResponse = "Je vous en prie! N'hesitez pas si vous avez besoin d'autre chose."; break;
    }
    case "help": {
      spokenResponse = "Vous pouvez me demander: le briefing du jour, compter vos appels/taches/projets, voir les projets en retard, les taches urgentes, creer une tache ou un contact, planifier un rendez-vous, envoyer un message, enregistrer un appel, appeler un contact, chercher dans vos donnees, ou consulter l'agenda. Les actions d'ecriture demandent une confirmation.";
      break;
    }
    default: {
      if (ai) {
        try {
          const result = await ai.models.generateContent({
            model: "gemini-2.5-pro",
            contents: [{ role: "user", parts: [{ text: `Tu es l'assistant vocal "Bureau". L'utilisateur a dit: "${text}". Reponds en francais (2-3 phrases). Si hors sujet, propose les fonctionnalites disponibles.` }] }],
          });
          spokenResponse = (result.text || "").trim() || `Je n'ai pas compris "${text}".`;
        } catch {
          spokenResponse = `Je n'ai pas compris "${text}". Dites "aide".`;
        }
      } else {
        spokenResponse = `Je n'ai pas compris "${text}". Dites "aide".`;
      }
    }
  }
  return { spoken: spokenResponse, data, action, navigate };
}

// ───────────────────────── Pending action summarizer ─────────────────────────
function summarizePendingAction(intent: string, params: Record<string, string>): {
  spoken: string;
  summary: string;
  fields: { label: string; value: string }[];
} {
  switch (intent) {
    case "create_task": {
      const title = params.title || "Sans titre";
      return {
        spoken: `Voulez-vous que je cree la tache "${title}" ? Confirmez pour valider.`,
        summary: `Creer une tache : ${title}`,
        fields: [{ label: "Titre", value: title }, { label: "Priorite", value: "moyenne" }, { label: "Statut", value: "en attente" }],
      };
    }
    case "create_contact": {
      const name = params.name || "Sans nom";
      return {
        spoken: `Voulez-vous que je cree le contact ${name} ? Confirmez pour valider.`,
        summary: `Creer un contact : ${name}`,
        fields: [
          { label: "Nom", value: name },
          { label: "Telephone", value: params.phone || "(non specifie)" },
          { label: "Email", value: params.email || "(non specifie)" },
        ],
      };
    }
    case "schedule_meeting": {
      const title = params.title || "Nouveau rendez-vous";
      const who = params.contactName || "(non specifie)";
      return {
        spoken: `Voulez-vous planifier "${title}" avec ${who} ? Confirmez pour valider.`,
        summary: `Planifier : ${title}`,
        fields: [
          { label: "Titre", value: title },
          { label: "Contact", value: who },
          { label: "Date", value: params.dateText || "demain 10h00 (par defaut)" },
        ],
      };
    }
    case "send_message": {
      const who = params.contactName || "(non specifie)";
      const body = params.body || "(message vide)";
      return {
        spoken: `Voulez-vous envoyer un message a ${who} ? Confirmez pour valider.`,
        summary: `Envoyer un message a ${who}`,
        fields: [{ label: "Destinataire", value: who }, { label: "Contenu", value: body }],
      };
    }
    case "log_call": {
      const who = params.contactName || "(non specifie)";
      return {
        spoken: `Voulez-vous enregistrer un appel avec ${who} ? Confirmez pour valider.`,
        summary: `Enregistrer un appel avec ${who}`,
        fields: [{ label: "Contact", value: who }, { label: "Note", value: params.note || "(aucune)" }],
      };
    }
  }
  return { spoken: "Action a confirmer.", summary: intent, fields: [] };
}

// ───────────────────────── Routes ────────────────────────────────────────────
router.post("/voice/command", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { text } = req.body;

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Texte requis" });
    return;
  }

  try { await assertAiQuota(orgId); } catch (qe) {
    if (qe instanceof AiQuotaExceededError) { res.status(429).json({ error: qe.message, quotaExceeded: true }); return; }
    throw qe;
  }

  const command = await parseCommandAI(text);

  // Write intents are NEVER executed inline. Return a signed pending action.
  if (WRITE_INTENTS.has(command.intent)) {
    const params = (command.params || {}) as Record<string, string>;
    const summary = summarizePendingAction(command.intent, params);
    const token = signPendingAction({
      intent: command.intent,
      params,
      orgId,
      userId: req.session?.userId ?? null,
      exp: Date.now() + PENDING_TTL_MS,
      raw: text.slice(0, 500),
    });
    res.json({
      success: true,
      intent: command.intent,
      requiresConfirmation: true,
      pendingAction: {
        token,
        intent: command.intent,
        summary: summary.summary,
        fields: summary.fields,
        expiresInMs: PENDING_TTL_MS,
      },
      spoken: summary.spoken,
    });
    return;
  }

  try {
    const result = await dispatchReadIntent(command, orgId, text);
    res.json({ success: true, intent: command.intent, ...result });
  } catch (err) {
    logger.error({ err }, "[VoiceCommand] Error:");
    res.status(500).json({ success: false, spoken: "Une erreur est survenue. Veuillez reessayer." });
  }
});

router.post("/voice/confirm", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  const userEmail = req.session?.userEmail;
  const { token } = req.body ?? {};

  const tokenStr = String(token || "");
  const payload = verifyPendingAction(tokenStr);
  if (!payload) {
    res.status(400).json({ success: false, error: "Action expiree ou invalide. Repetez votre commande." });
    return;
  }
  if (payload.orgId !== orgId) {
    res.status(403).json({ success: false, error: "Action refusee : organisation differente." });
    return;
  }
  // Strict user binding: if the original action was created in an authenticated
  // session, the confirmer MUST be the same user (no anonymous bypass).
  if (payload.userId != null) {
    if (!userId || payload.userId !== userId) {
      res.status(403).json({ success: false, error: "Action refusee : utilisateur different." });
      return;
    }
  }
  // Replay protection: each signed token may be confirmed only once.
  const sig = tokenStr.split(".")[1] || tokenStr;
  if (!consumeTokenOnce(sig, payload.exp)) {
    res.status(409).json({ success: false, error: "Cette action a deja ete executee." });
    return;
  }

  const params: Record<string, string> = payload.params || {};
  const ip = req.ip;
  const ua = req.get("user-agent") || undefined;

  try {
    switch (payload.intent) {
      case "create_task": {
        const title = (params.title || "Nouvelle tache vocale").slice(0, 200);
        const [row] = await db.insert(tasksTable).values({
          organisationId: orgId,
          title,
          description: `Cree par commande vocale: "${payload.raw || ""}"`,
          status: "en_attente",
          priority: "moyenne",
          createdBy: userId || null,
        }).returning({ id: tasksTable.id });
        await logAudit(userId, userEmail, "voice_create_task", "task", String(row?.id), { title, raw: payload.raw }, ip, ua, orgId);
        res.json({ success: true, action: "task_created", spoken: `La tache "${title}" a ete creee.`, navigate: "/taches", id: row?.id });
        return;
      }
      case "create_contact": {
        const fullName = (params.name || "Nouveau contact").trim();
        const [first, ...rest] = fullName.split(/\s+/);
        const lastName = rest.join(" ") || "";
        const [row] = await db.insert(contactsTable).values({
          organisationId: orgId,
          firstName: first || fullName,
          lastName: lastName || "",
          phone: params.phone || null,
          email: params.email || null,
          createdBy: userId || null,
        } as any).returning({ id: contactsTable.id });
        await logAudit(userId, userEmail, "voice_create_contact", "contact", String(row?.id), { name: fullName, phone: params.phone, email: params.email }, ip, ua, orgId);
        res.json({ success: true, action: "contact_created", spoken: `Le contact ${fullName} a ete cree.`, navigate: "/contacts", id: row?.id });
        return;
      }
      case "schedule_meeting": {
        const title = (params.title || "Nouveau rendez-vous").slice(0, 200);
        // Default: tomorrow 10:00 → 11:00 local time
        const start = new Date();
        start.setDate(start.getDate() + 1);
        start.setHours(10, 0, 0, 0);
        const end = new Date(start.getTime() + 60 * 60_000);
        const [row] = await db.insert(calendarEventsTable).values({
          organisationId: orgId,
          title,
          description: `Planifie par commande vocale: "${payload.raw || ""}"${params.contactName ? ` - avec ${params.contactName}` : ""}`,
          type: "rendez_vous",
          startDate: start,
          endDate: end,
          contactName: params.contactName || null,
          createdBy: userId || null,
        } as any).returning({ id: calendarEventsTable.id });
        await logAudit(userId, userEmail, "voice_schedule_meeting", "calendar_event", String(row?.id), { title, contactName: params.contactName, startDate: start.toISOString() }, ip, ua, orgId);
        res.json({ success: true, action: "meeting_scheduled", spoken: `Rendez-vous "${title}" planifie pour demain a 10 heures.`, navigate: "/calendrier", id: row?.id });
        return;
      }
      case "send_message": {
        const who = (params.contactName || "").trim();
        const body = (params.body || "").trim();
        if (!body) {
          res.status(400).json({ success: false, error: "Message vide. Veuillez recommencer." });
          return;
        }
        // Resolve contact (best-effort) for phone number
        let phone = "";
        let contactId: number | null = null;
        if (who) {
          const useUnaccent = await ensureUnaccentExtension();
          const namePattern = `%${who}%`;
          const [c] = await db.select().from(contactsTable)
            .where(and(eq(contactsTable.organisationId, orgId), or(
              accentInsensitiveIlike(contactsTable.firstName, namePattern, useUnaccent),
              accentInsensitiveIlike(contactsTable.lastName, namePattern, useUnaccent)
            ))).limit(1);
          if (c) { phone = c.phone || ""; contactId = c.id; }
        }
        if (!phone) {
          res.status(400).json({ success: false, error: `Aucun numero trouve pour ${who || "ce contact"}.` });
          return;
        }
        const [row] = await db.insert(messagesTable).values({
          organisationId: orgId,
          contactId,
          contactName: who || null,
          phoneNumber: phone,
          content: body.slice(0, 1000),
          type: "sms_sortant",
          priority: "moyenne",
          createdBy: userId || null,
        } as any).returning({ id: messagesTable.id });
        await logAudit(userId, userEmail, "voice_send_message", "message", String(row?.id), { contactName: who, phone, body: body.slice(0, 200) }, ip, ua, orgId);
        res.json({ success: true, action: "message_sent", spoken: `Message a ${who || "destinataire"} enregistre.`, navigate: "/messages", id: row?.id });
        return;
      }
      case "log_call": {
        const who = (params.contactName || "").trim();
        let phone = ""; let contactId: number | null = null; let firstName: string | null = null; let lastName: string | null = null;
        if (who) {
          const useUnaccent = await ensureUnaccentExtension();
          const namePattern = `%${who}%`;
          const [c] = await db.select().from(contactsTable)
            .where(and(eq(contactsTable.organisationId, orgId), or(
              accentInsensitiveIlike(contactsTable.firstName, namePattern, useUnaccent),
              accentInsensitiveIlike(contactsTable.lastName, namePattern, useUnaccent)
            ))).limit(1);
          if (c) { phone = c.phone || ""; contactId = c.id; firstName = c.firstName; lastName = c.lastName; }
        }
        const [row] = await db.insert(callsTable).values({
          organisationId: orgId,
          contactId,
          contactName: firstName ? `${firstName} ${lastName ?? ""}`.trim() : (who || null),
          phoneNumber: phone || (params.phone || ""),
          status: "termine",
          notes: (params.note || "").slice(0, 1000),
          createdBy: userId || null,
        } as any).returning({ id: callsTable.id });
        await logAudit(userId, userEmail, "voice_log_call", "call", String(row?.id), { contactName: who, note: params.note }, ip, ua, orgId);
        res.json({ success: true, action: "call_logged", spoken: `Appel avec ${who || "le contact"} enregistre.`, navigate: "/appels", id: row?.id });
        return;
      }
    }
    res.status(400).json({ success: false, error: "Intent non supporte." });
  } catch (err: any) {
    logger.error({ err: err?.message, intent: payload.intent }, "[VoiceCommand/confirm] Error:");
    res.status(500).json({ success: false, error: "Une erreur est survenue lors de l'execution." });
  }
});

router.post("/voice/cancel", async (_req: Request, res: Response): Promise<void> => {
  // Stateless tokens expire on their own; no server-side state to clear.
  res.json({ success: true });
});

router.get("/voice/commands", (_req: Request, res: Response): void => {
  res.json({
    commands: [
      { phrase: "Briefing du jour", description: "Resume complet de la journee" },
      { phrase: "Combien d'appels aujourd'hui", description: "Nombre d'appels du jour" },
      { phrase: "Taches en attente", description: "Nombre de taches en attente" },
      { phrase: "Combien de projets actifs", description: "Nombre de projets en cours" },
      { phrase: "Projets en retard", description: "Projets depasses sur le planning" },
      { phrase: "Derniers appels", description: "Les 5 derniers appels" },
      { phrase: "Taches urgentes", description: "Taches haute priorite" },
      { phrase: "Cree une tache [titre]", description: "Creer une tache (confirmation requise)" },
      { phrase: "Cree un contact [nom] tel [numero]", description: "Creer un contact (confirmation requise)" },
      { phrase: "Planifie un rendez-vous avec [nom]", description: "Planifier un RDV (confirmation requise)" },
      { phrase: "Envoie un message a [nom] : [contenu]", description: "Envoyer un SMS (confirmation requise)" },
      { phrase: "Enregistre un appel avec [nom] note [texte]", description: "Logger un appel (confirmation requise)" },
      { phrase: "Appelle [nom]", description: "Trouver et appeler un contact" },
      { phrase: "Cherche [texte]", description: "Recherche dans contacts et taches" },
      { phrase: "Agenda du jour", description: "Evenements du calendrier" },
      { phrase: "Performance", description: "Stats de la semaine" },
      { phrase: "Quelle heure est-il", description: "Heure actuelle" },
      { phrase: "Aide", description: "Liste des commandes" },
    ],
  });
});

export default router;
