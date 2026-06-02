import { Router, type Request, type Response } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, calendarEventsTable, facturesClientTable, compteClientTable, organisationsTable, prospectsTable, notificationsTable, paymentRemindersTable, licenseAuditLogTable, projetsTable, usersTable, checkinsTable, auditLogsTable, commandantConversationsTable, commandantMessagesTable } from "@workspace/db";
import { eq, sql, and, desc, gte, lte, lt, ne, isNull, isNotNull, or, ilike, count, asc, type Column, type SQL } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { stripAccents, ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { sendEmail } from "../services/email";
import { getContextForContact, getLatestAgentInsights, buildCommandantContextPrompt } from "./agent-collaboration";
import { safeJsonParse, extractGeminiTokens, extractOpenAITokens, extractAnthropicTokens, recordAiUsage, sanitizePromptInput, GEMINI_PRO_MODEL } from "../services/ai-utils";
import { assertAiQuota, invalidateQuotaCache, AiQuotaExceededError } from "../services/ai-quota";
import { buildLearnedContextBlock } from "../services/ai-learning";
import { getOrCompute, buildAiCacheKey, getCached, setCached, withProviderTimeout, AI_CACHE_TTL } from "../services/ai-cache";
import { openSseStream, multiAiGenerateStream, StreamAbortedError } from "../services/ai-stream";
import { logger } from "../lib/logger";
import { scanBase64Content } from "../middleware/security";

function handleCommandantError(err: unknown, res: Response, logLabel: string): void {
  if (err instanceof AiQuotaExceededError) {
    res.status(429).json({ error: err.message, quotaExceeded: true, reason: err.reason, current: err.current, limit: err.limit });
    return;
  }
  logger.error({ err }, logLabel);
  res.status(500).json({ error: "Erreur interne" });
}

const router = Router();

async function getGemini() {
  const { ai } = await import("@workspace/integrations-gemini-ai");
  return ai;
}

async function getOpenAI() {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  return openai;
}

async function getAnthropic() {
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  return anthropic;
}

async function multiAiGenerate(prompt: string, systemPrompt?: string, orgId?: number, route?: string): Promise<string> {
  if (orgId) {
    try { await assertAiQuota(orgId); } catch (e: any) { throw e; }
  }

  const safePrompt = sanitizePromptInput(prompt, 24000);
  const safeSystem = sanitizePromptInput(systemPrompt, 8000);

  const errors: string[] = [];
  const t0 = Date.now();

  try {
    const ai = await getGemini();
    const r = await withProviderTimeout(() => ai.models.generateContent({
      model: GEMINI_PRO_MODEL,
      contents: safeSystem ? [{ role: "user", parts: [{ text: safeSystem + "\n\n" + safePrompt }] }] : safePrompt,
    }), { timeoutMs: 25_000, label: "gemini" });
    const text = typeof r === "object" && r !== null && "text" in r ? String(r.text) : String(r);
    if (text && text.length > 10) {
      if (orgId) {
        const tokens = extractGeminiTokens(r);
        recordAiUsage({ organisationId: orgId, provider: "gemini", model: GEMINI_PRO_MODEL, route: route || "/commandant", inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0 }).catch(() => {});
        invalidateQuotaCache(orgId);
      }
      return text;
    }
  } catch (e: any) {
    if (String(e.message).includes("quota")) throw e;
    errors.push("Gemini: " + e.message);
  }

  try {
    const openai = await getOpenAI();
    const r = await withProviderTimeout(() => openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        ...(safeSystem ? [{ role: "system" as const, content: safeSystem }] : []),
        { role: "user" as const, content: safePrompt },
      ],
    }), { timeoutMs: 25_000, label: "openai" });
    const text = r.choices?.[0]?.message?.content;
    if (text && text.length > 10) {
      if (orgId) {
        const tokens = extractOpenAITokens(r);
        recordAiUsage({ organisationId: orgId, provider: "openai", model: "gpt-5.2", route: route || "/commandant", inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0 }).catch(() => {});
        invalidateQuotaCache(orgId);
      }
      return text;
    }
  } catch (e: any) { errors.push("OpenAI: " + e.message); }

  try {
    const anthropic = await getAnthropic();
    const r = await withProviderTimeout(() => anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      ...(safeSystem ? { system: safeSystem } : {}),
      messages: [{ role: "user", content: safePrompt }],
    }), { timeoutMs: 25_000, label: "anthropic" });
    const text = r.content?.[0]?.type === "text" ? r.content[0].text : "";
    if (text && text.length > 10) {
      if (orgId) {
        const tokens = extractAnthropicTokens(r);
        recordAiUsage({ organisationId: orgId, provider: "anthropic", model: "claude-sonnet-4-6", route: route || "/commandant", inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0 }).catch(() => {});
        invalidateQuotaCache(orgId);
      }
      return text;
    }
  } catch (e: any) { errors.push("Anthropic: " + e.message); }

  return `[AI indisponible] ${errors.join("; ")}`;
}

async function multiAiGenerateCached(
  cacheKey: string,
  ttlMs: number,
  prompt: string,
  systemPrompt: string | undefined,
  orgId: number | undefined,
  route: string | undefined,
): Promise<string> {
  return getOrCompute(cacheKey, ttlMs, () => multiAiGenerate(prompt, systemPrompt, orgId, route));
}

import { escapeHtml } from "../lib/html-escape";

// Stop-words used to filter the user's chat message into useful keyword tokens.
// Kept short and French-focused since the assistant always replies in French.
const CHAT_RETRIEVAL_STOPWORDS = new Set([
  "le","la","les","un","une","des","de","du","au","aux","et","ou","mais","donc","or","ni","car",
  "je","tu","il","elle","on","nous","vous","ils","elles","me","te","se","mon","ma","mes","ton","ta","tes","son","sa","ses","notre","nos","votre","vos","leur","leurs",
  "ce","cet","cette","ces","ca","cela","ceci",
  "qui","que","quoi","quel","quelle","quels","quelles","dont","ou","comment","pourquoi","quand","combien",
  "est","es","suis","sommes","etes","sont","ete","etre","etais","etait","etaient",
  "ai","as","a","avons","avez","ont","avoir","eu",
  "fait","faire","faut","peux","peut","pouvez","pouvons","peuvent",
  "pas","plus","moins","tres","trop","bien","mal","encore","aussi","alors","puis","si","sinon",
  "dans","sur","sous","avec","sans","pour","par","vers","chez","entre","apres","avant","depuis","jusqu","contre",
  "the","and","or","of","to","in","for","on","with","is","are","was","were","be","been","i","you","my","your","me",
  "moi","toi","lui","eux","leur","stp","svp","merci","bonjour","salut","ok","oui","non",
  "show","montre","liste","afficher","donne","dis","peux","voir","voici","pls","please",
]);

// Suffixes ordered longest-first so that the longest applicable French suffix
// is removed (a tiny, deliberately conservative French stemmer). Keeping this
// in-house avoids pulling a heavy NLP dep just for keyword retrieval. We only
// apply if the resulting stem stays >= 4 chars to avoid overstemming.
const FR_SUFFIXES = [
  "issements","issantes","issement","issants","issante","issant",
  "ations","ation","atrice","ateurs","ateur",
  "eraient","erions","eriez","erait","erais","eront","erons","erez","erai","era",
  "iraient","irions","iriez","irait","irais","iront","irons","irez","irai","ira",
  "ssions","ssiez","ssent","ssais","ssait","ssant",
  "aient","aions","aiez","ions","iez",
  "ables","able","ibles","ible",
  "euses","euse","eures","eure","eurs","eur",
  "elles","elle",
  "asses","asse",
  "ees","ee","es","er","ir","re","ai","as","ant","ent","ons","ez","is","it",
  "e","s","x",
];

function stemFr(token: string): string {
  if (token.length < 5) return token;
  for (const suf of FR_SUFFIXES) {
    if (token.length - suf.length >= 4 && token.endsWith(suf)) {
      return token.slice(0, token.length - suf.length);
    }
  }
  return token;
}

function extractKeywordsFromChat(message: string, maxTokens = 4): string[] {
  if (!message) return [];
  const cleaned = stripAccents(message.toLowerCase()).replace(/[^\p{L}\p{N}\s@.+-]/gu, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens) {
    if (raw.length < 3) continue;
    if (CHAT_RETRIEVAL_STOPWORDS.has(raw)) continue;
    const stem = stemFr(raw);
    if (stem.length < 3) continue;
    if (CHAT_RETRIEVAL_STOPWORDS.has(stem)) continue;
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push(stem);
    if (out.length >= maxTokens) break;
  }
  return out;
}

export type RetrievedEntity = {
  id: number;
  type: "contact" | "task" | "event" | "invoice" | "prospect";
  label: string;
  url: string;
};

export type ChatRetrievalResult = {
  context: string;
  entities: RetrievedEntity[];
};

// Lightweight, tenant-isolated retrieval that mirrors /commandant/smart-search.
// Returns a "DONNEES PERTINENTES" markdown block plus the structured list of
// matched entities (so the UI can render clickable chips). Returns empty
// values if no usable keywords were extracted or nothing matched.
async function retrieveRelevantDataForChat(orgId: number, userMessage: string): Promise<ChatRetrievalResult> {
  const empty: ChatRetrievalResult = { context: "", entities: [] };
  const keywords = extractKeywordsFromChat(userMessage);
  if (keywords.length === 0) return empty;

  try {
    const useUnaccent = await ensureUnaccentExtension();
    const il = (col: Column, kw: string): SQL => accentInsensitiveIlike(col, `%${kw}%`, useUnaccent);
    const perKeyword = await Promise.all(keywords.map(async (kw) => {
      const [contacts, tasks, events, invoices, prospects] = await Promise.all([
        db.select().from(contactsTable).where(and(
          eq(contactsTable.organisationId, orgId),
          or(il(contactsTable.firstName, kw), il(contactsTable.lastName, kw), il(contactsTable.email, kw), il(contactsTable.phone, kw), il(contactsTable.company, kw)),
        )).limit(5),
        db.select().from(tasksTable).where(and(
          eq(tasksTable.organisationId, orgId),
          or(il(tasksTable.title, kw), il(tasksTable.description, kw)),
        )).limit(5),
        db.select().from(calendarEventsTable).where(and(
          eq(calendarEventsTable.organisationId, orgId),
          or(il(calendarEventsTable.title, kw), il(calendarEventsTable.description, kw)),
        )).limit(5),
        db.select().from(facturesClientTable).where(and(
          eq(facturesClientTable.organisationId, orgId),
          or(il(facturesClientTable.reference, kw), il(facturesClientTable.clientName, kw)),
        )).limit(5),
        db.select().from(prospectsTable).where(and(
          eq(prospectsTable.organisationId, orgId),
          or(il(prospectsTable.company, kw), il(prospectsTable.contactName, kw), il(prospectsTable.email, kw)),
        )).limit(5),
      ]);
      return { contacts, tasks, events, invoices, prospects };
    }));

    const dedupe = <T extends { id: number }>(arr: T[]): T[] => {
      const seen = new Set<number>();
      const out: T[] = [];
      for (const x of arr) { if (!seen.has(x.id)) { seen.add(x.id); out.push(x); } }
      return out;
    };

    const contacts = dedupe(perKeyword.flatMap(r => r.contacts)).slice(0, 5);
    const tasks = dedupe(perKeyword.flatMap(r => r.tasks)).slice(0, 5);
    const events = dedupe(perKeyword.flatMap(r => r.events)).slice(0, 5);
    const invoices = dedupe(perKeyword.flatMap(r => r.invoices)).slice(0, 5);
    const prospects = dedupe(perKeyword.flatMap(r => r.prospects)).slice(0, 5);

    const total = contacts.length + tasks.length + events.length + invoices.length + prospects.length;
    if (total === 0) return empty;

    const formatDate = (value: Date | string | null | undefined, fallback: string): string => {
      if (!value) return fallback;
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? fallback : d.toLocaleDateString("fr-FR");
    };

    const entities: RetrievedEntity[] = [];
    for (const c of contacts) {
      const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.replace(/\s+/g, " ").trim();
      entities.push({ id: c.id, type: "contact", label: name || c.company || c.email || `Contact #${c.id}`, url: `/contacts/${c.id}` });
    }
    for (const t of tasks) {
      entities.push({ id: t.id, type: "task", label: t.title || `Tache #${t.id}`, url: `/taches?id=${t.id}` });
    }
    for (const e of events) {
      entities.push({ id: e.id, type: "event", label: e.title || `Evenement #${e.id}`, url: `/calendrier?id=${e.id}` });
    }
    for (const f of invoices) {
      entities.push({ id: f.id, type: "invoice", label: f.reference || f.clientName || `Facture #${f.id}`, url: `/abonnement?factureId=${f.id}` });
    }
    for (const p of prospects) {
      entities.push({ id: p.id, type: "prospect", label: p.company || p.contactName || p.title || `Prospect #${p.id}`, url: `/prospects/${p.id}` });
    }

    const lines: string[] = [];
    lines.push(`DONNEES PERTINENTES (recherche: ${keywords.join(", ")}):`);
    if (contacts.length) {
      lines.push("Contacts:");
      for (const c of contacts) {
        lines.push(`  - #${c.id} ${c.firstName ?? ""} ${c.lastName ?? ""}${c.company ? ` (${c.company})` : ""}${c.email ? ` <${c.email}>` : ""}${c.phone ? ` ${c.phone}` : ""}`.replace(/\s+/g, " ").trim());
      }
    }
    if (tasks.length) {
      lines.push("Taches:");
      for (const t of tasks) {
        lines.push(`  - #${t.id} [${t.status}/${t.priority}] ${t.title} (echeance: ${formatDate(t.dueDate, "sans echeance")})`);
      }
    }
    if (events.length) {
      lines.push("Evenements:");
      for (const e of events) {
        lines.push(`  - #${e.id} ${e.title} (${e.type}, ${formatDate(e.startDate, "?")})`);
      }
    }
    if (invoices.length) {
      lines.push("Factures:");
      for (const f of invoices) {
        lines.push(`  - #${f.id} ${f.reference} ${f.clientName ?? ""} ${Number(f.totalAmount ?? 0).toFixed(2)} EUR [${f.status}, echeance ${formatDate(f.dueDate, "?")}]`);
      }
    }
    if (prospects.length) {
      lines.push("Prospects:");
      for (const p of prospects) {
        lines.push(`  - #${p.id} ${p.company ?? p.contactName ?? p.title ?? ""} [${p.stage}${p.source ? `, ${p.source}` : ""}]`);
      }
    }
    return { context: lines.join("\n"), entities };
  } catch (err) {
    logger.warn({ err }, "[Commandant/Conv/Send] retrieval failed");
    return empty;
  }
}

function emailWrap(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<div style="background:linear-gradient(135deg,#0f1729 0%,#1a2744 100%);padding:32px;text-align:center;">
<h1 style="color:#fff;font-size:22px;margin:0;">Agent de Bureau</h1>
<p style="color:#f59e0b;font-size:13px;margin:8px 0 0;">AI Commandant - ${escapeHtml(title)}</p>
</div>
<div style="padding:28px;">${body}</div>
<div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="color:#94a3b8;font-size:11px;margin:0;">&copy; ${new Date().getFullYear()} Agent de Bureau - AI Commandant</p>
</div></div></body></html>`;
}

function htmlToTextCmd(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function sendEmailViaResend(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const result = await sendEmail(to, subject, html, htmlToTextCmd(html));
    if (!result.success) { logger.info(`[Commandant/Email] Echec envoi a ${to}: ${result.error || "inconnu"}`); return false; }
    return true;
  } catch (err: any) {
    logger.error({ err: err.message }, "[Commandant/Email] Erreur:");
    return false;
  }
}

async function createNotification(orgId: number, userId: number | null, title: string, message: string, type: string = "info", actionUrl?: string) {
  try {
    await db.insert(notificationsTable).values({
      organisationId: orgId,
      userId: userId || 0,
      type,
      title,
      message,
      priority: type === "alerte" ? "haute" : "normale",
      actionUrl: actionUrl || null,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[Commandant/Notif]");
  }
}

// ═══════════════════════════════════════════
// 1. GELEN ARAMALARA AKILLI CEVAP
// ═══════════════════════════════════════════
router.post("/commandant/call-smart-response", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { callerPhone, callerName, callNotes, callDirection, callId } = req.body;

    const [contactContext, agentInsights] = await Promise.all([
      getContextForContact(orgId, undefined, callerPhone, undefined),
      getLatestAgentInsights(orgId, ["agent_appels", "agent_contacts", "agent_taches", "agent_facturation"]),
    ]);
    const contact = contactContext.contact;
    const collaborationContext = buildCommandantContextPrompt(agentInsights, contactContext);

    const recentCalls = contact ? await db.select().from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.contactId, contact.id))).orderBy(desc(callsTable.createdAt)).limit(5) : [];
    const openTasks = contactContext.contactActivity?.openTasks || [];
    const upcomingEvents = contactContext.contactActivity?.upcomingEvents || [];
    const overdueInvoices = contactContext.contactActivity?.overdueInvoices || [];
    const contactProjets = contactContext.contactActivity?.projets || [];

    const systemPrompt = `Tu es un assistant telephonique IA d'elite pour "Agent de Bureau", un logiciel de gestion de bureau francais.
Tu dois generer la MEILLEURE reponse possible pour un appel ${callDirection === "entrant" ? "entrant" : "sortant"}.
Tu es extremement professionnel, empathique et intelligent. Tu connais l'historique complet du contact.
Tu as acces aux rapports des agents IA specialises (telephonie, CRM, productivite, finance) pour enrichir ta reponse.
Reponds TOUJOURS en francais. Sois chaleureux mais professionnel.

${collaborationContext}${await buildLearnedContextBlock(orgId)}`;

    const prompt = `APPEL ${callDirection === "entrant" ? "ENTRANT" : "SORTANT"}:
- Appelant: ${callerName || "Inconnu"} (${callerPhone || "Pas de numero"})
${contact ? `- Contact connu: ${contact.firstName} ${contact.lastName} (${contact.category || "Standard"})
- Entreprise: ${contact.company || "N/A"}
- Email: ${contact.email || "N/A"}
- Total appels precedents: ${contact.totalCalls || 0}
- Dernier appel: ${contact.lastCallAt ? new Date(contact.lastCallAt).toLocaleDateString("fr-FR") : "Jamais"}` : "- Contact INCONNU (nouveau)"}
${recentCalls.length > 0 ? `\n- Derniers appels:\n${recentCalls.map(c => `  * ${new Date(c.createdAt).toLocaleDateString("fr-FR")} - ${c.status} - ${c.notes || "Pas de notes"}`).join("\n")}` : ""}
${openTasks.length > 0 ? `\n- Taches en cours pour ce contact:\n${openTasks.map((t: any) => `  * [${t.priority}] ${t.title} (${t.status})`).join("\n")}` : ""}
${overdueInvoices.length > 0 ? `\n- ⚠ FACTURES IMPAYEES:\n${overdueInvoices.map((i: any) => `  * ${i.reference} - ${i.amount}€ (echeance depassee)`).join("\n")}` : ""}
${upcomingEvents.length > 0 ? `\n- Prochains evenements:\n${upcomingEvents.map((e: any) => `  * ${e.title} - ${new Date(e.date).toLocaleDateString("fr-FR")}`).join("\n")}` : ""}
${contactProjets.length > 0 ? `\n- Projets lies:\n${contactProjets.map((p: any) => `  * ${p.title} [${p.status}, ${p.progress ?? 0}%${p.endDate && new Date(p.endDate) < new Date() && p.status !== "termine" ? " ⚠EN RETARD" : ""}]`).join("\n")}` : ""}
${callNotes ? `\n- Notes de l'appel: ${callNotes}` : ""}

Genere un JSON avec:
{
  "greeting": "Phrase d'accueil personnalisee",
  "contextBriefing": "Resume de contexte pour l'agent (historique, alertes, infos des agents IA)",
  "suggestedResponses": ["3-5 reponses suggerees selon le contexte"],
  "detectedIntent": "intention detectee (info, plainte, rdv, devis, suivi, urgence)",
  "sentiment": "positif/neutre/negatif",
  "priority": "basse/moyenne/haute/urgente",
  "recommendedActions": ["actions recommandees apres l'appel"],
  "talkingPoints": ["points importants a aborder"],
  "warningFlags": ["alertes eventuelles (retard de paiement, plainte precedente, etc.)"],
  "agentInsightsSummary": "Resume des informations fournies par les agents IA specialises"
}`;

    const cacheKey = buildAiCacheKey({
      route: "/commandant/call-smart-response",
      organisationId: orgId,
      input: { callId, callerPhone, callerName, callDirection, contactId: contact?.id, openTasks: openTasks.length, overdueInvoices: overdueInvoices.length, recentCalls: recentCalls.length },
    });
    const aiResponse = await multiAiGenerateCached(cacheKey, AI_CACHE_TTL.MEDIUM, prompt, systemPrompt, orgId, req.path);
    const parsed: any = safeJsonParse<any>(aiResponse, { greeting: aiResponse, suggestedResponses: [], recommendedActions: [] });

    const activeAgents = Object.entries(agentInsights).map(([id, insight]) => ({ id, score: insight.score, summary: insight.summary?.slice(0, 80) }));

    res.json({
      success: true,
      contact: contact ? { id: contact.id, name: `${contact.firstName} ${contact.lastName}`, company: contact.company, category: contact.category, totalCalls: contact.totalCalls, email: contact.email } : null,
      aiResponse: parsed,
      context: {
        recentCallsCount: recentCalls.length,
        openTasksCount: openTasks.length,
        upcomingEventsCount: upcomingEvents.length,
        overdueInvoicesCount: overdueInvoices.length,
      },
      collaboration: {
        agentsConsulted: activeAgents,
        criticalAlerts: contactContext.criticalAlerts || [],
        enrichedByAgents: true,
      },
    });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/CallResponse]");
  }
});

// ═══════════════════════════════════════════
// 2. ARAMA SONUÇLARINI DERLEME
// ═══════════════════════════════════════════
router.post("/commandant/call-compile", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { callId, notes, duration, callerName, callerPhone } = req.body;

    const systemPrompt = `Tu es un expert en analyse d'appels telephoniques professionnels. Tu dois analyser et compiler les resultats d'un appel. Sois precis, actionnable et en francais.${await buildLearnedContextBlock(orgId)}`;
    const prompt = `Analyse cet appel et genere un JSON:
- Appelant: ${callerName || "Inconnu"} (${callerPhone || ""})
- Duree: ${duration || "N/A"} secondes
- Notes: ${notes || "Aucune note"}

JSON attendu:
{
  "summary": "Resume concis de l'appel (2-3 phrases)",
  "keyDecisions": ["decisions prises"],
  "actionItems": [{"title": "titre", "priority": "haute/moyenne/basse", "dueInDays": 3, "assignTo": "agent"}],
  "followUpNeeded": true/false,
  "followUpDate": "YYYY-MM-DD si suivi necessaire",
  "sentiment": "positif/neutre/negatif",
  "topics": ["sujets abordes"],
  "appointmentsToCreate": [{"title": "titre", "date": "YYYY-MM-DD", "time": "HH:MM", "type": "rendez_vous/reunion"}],
  "tasksToCreate": [{"title": "titre", "priority": "haute/moyenne/basse", "description": "details"}],
  "urgencyLevel": "normal/eleve/critique"
}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: aiResponse };
    } catch (pe) { logger.warn({ err: pe }, "[Commandant/CallCompile] JSON parse fallback:"); parsed = { summary: aiResponse }; }

    if (callId) {
      try {
        await db.update(callsTable).set({ notes: parsed.summary, sentiment: parsed.sentiment, tags: parsed.topics || [] }).where(and(eq(callsTable.id, parseInt(String(callId))), eq(callsTable.organisationId, orgId)));
      } catch (e) { logger.error({ err: e }, "[Commandant] call update failed:"); }
    }

    const createdTasks: any[] = [];
    if (parsed.tasksToCreate?.length) {
      for (const task of parsed.tasksToCreate) {
        try {
          const dueDate = task.dueInDays ? new Date(Date.now() + task.dueInDays * 86400000) : new Date(Date.now() + 3 * 86400000);
          const [t] = await db.insert(tasksTable).values({
            organisationId: orgId, title: `[Appel] ${task.title}`, description: task.description || parsed.summary, priority: task.priority || "moyenne", status: "en_attente", dueDate,
          }).returning();
          createdTasks.push(t);
        } catch (e) { logger.error({ err: e }, "[Commandant/CallCompile] task insert failed:"); }
      }
    }

    const createdEvents: any[] = [];
    if (parsed.appointmentsToCreate?.length) {
      for (const appt of parsed.appointmentsToCreate) {
        try {
          const startDate = new Date(`${appt.date}T${appt.time || "10:00"}:00`);
          const endDate = new Date(startDate.getTime() + 3600000);
          const [e] = await db.insert(calendarEventsTable).values({
            organisationId: orgId, title: `[Appel] ${appt.title}`, type: appt.type || "rendez_vous", startDate, endDate, status: "confirme",
          }).returning();
          createdEvents.push(e);
        } catch (e) { logger.error({ err: e }, "[Commandant/CallCompile] event insert failed:"); }
      }
    }

    res.json({ success: true, compilation: parsed, createdTasks, createdEvents });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/CallCompile]");
  }
});

// ═══════════════════════════════════════════
// 3 & 4. RANDEVU + GÖREV OLUŞTURMA (Mail/Arama/Toplantıdan)
// ═══════════════════════════════════════════
router.post("/commandant/auto-create-from-interaction", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { interactionType, content, contactId, contactName } = req.body;

    const systemPrompt = `Tu es un expert en productivite de bureau. A partir d'une interaction (email, appel, reunion), tu dois extraire automatiquement les taches et rendez-vous a creer. Sois precis et actionnable.`;
    const prompt = `Analyse cette interaction et extrait les actions:
Type: ${interactionType || "general"} (email/appel/reunion/note)
Contenu: ${content || "Aucun contenu"}
${contactName ? `Contact: ${contactName}` : ""}

JSON attendu:
{
  "tasks": [{"title": "titre clair", "description": "details", "priority": "haute/moyenne/basse", "dueInDays": 3}],
  "appointments": [{"title": "titre", "date": "YYYY-MM-DD", "time": "HH:MM", "duration": 60, "type": "rendez_vous/reunion/appel"}],
  "reminders": [{"title": "titre", "dateInDays": 1, "message": "rappel"}],
  "summary": "resume de ce qui a ete extrait"
}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { tasks: [], appointments: [], reminders: [], summary: aiResponse };
    } catch (pe) { logger.warn({ err: pe }, "[Commandant/AutoCreate] JSON parse fallback:"); parsed = { tasks: [], appointments: [], reminders: [], summary: aiResponse }; }

    const createdTasks: any[] = [];
    for (const task of (parsed.tasks || [])) {
      try {
        const dueDate = new Date(Date.now() + (task.dueInDays || 3) * 86400000);
        const [t] = await db.insert(tasksTable).values({
          organisationId: orgId, title: task.title, description: task.description, priority: task.priority || "moyenne", status: "en_attente", dueDate, relatedContactId: contactId || null,
        }).returning();
        createdTasks.push(t);
      } catch (e) { logger.error({ err: e }, "[Commandant/AutoCreate] task insert failed:"); }
    }

    const createdEvents: any[] = [];
    for (const appt of (parsed.appointments || [])) {
      try {
        const startDate = new Date(`${appt.date}T${appt.time || "10:00"}:00`);
        const endDate = new Date(startDate.getTime() + (appt.duration || 60) * 60000);
        const [e] = await db.insert(calendarEventsTable).values({
          organisationId: orgId, title: appt.title, type: appt.type || "rendez_vous", startDate, endDate, status: "en_attente", relatedContactId: contactId || null,
        }).returning();
        createdEvents.push(e);
      } catch (e) { logger.error({ err: e }, "[Commandant/AutoCreate] event insert failed:"); }
    }

    const userId = req.session?.userId;
    for (const reminder of (parsed.reminders || [])) {
      try {
        await createNotification(orgId, userId ?? null, reminder.title, reminder.message, "rappel");
      } catch (e) { logger.error({ err: e }, "[Commandant/AutoCreate] reminder failed:"); }
    }

    res.json({ success: true, summary: parsed.summary, createdTasks, createdEvents, reminders: parsed.reminders?.length || 0 });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/AutoCreate]");
  }
});

// ═══════════════════════════════════════════
// 5. E-POSTALARA AKILLI CEVAP
// ═══════════════════════════════════════════
router.post("/commandant/email-smart-reply", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { emailFrom, emailSubject, emailBody, tone, contactId } = req.body;

    const [collabContext, agentInsights] = await Promise.all([
      getContextForContact(orgId, contactId || undefined, undefined, emailFrom || undefined),
      getLatestAgentInsights(orgId, ["agent_contacts", "agent_facturation", "agent_messages", "agent_taches"]),
    ]);
    const collaborationPrompt = buildCommandantContextPrompt(agentInsights, collabContext);

    let contactContext = "";
    const contact = collabContext.contact;
    if (contact) {
      contactContext = `\nCONTACT CONNU: ${contact.firstName} ${contact.lastName}, ${contact.company || "Pas d'entreprise"}, ${contact.email}, ${contact.totalCalls || 0} appels`;
      if (collabContext.contactActivity?.openTasks?.length > 0) {
        contactContext += `\nTaches en cours: ${collabContext.contactActivity.openTasks.map((t: any) => `${t.title} [${t.priority}]`).join(", ")}`;
      }
      if (collabContext.contactActivity?.overdueInvoices?.length > 0) {
        contactContext += `\n⚠ FACTURES IMPAYEES: ${collabContext.contactActivity.overdueInvoices.map((i: any) => `${i.reference} (${i.amount}€)`).join(", ")}`;
      }
      if (collabContext.contactActivity?.projets?.length > 0) {
        contactContext += `\nProjets: ${collabContext.contactActivity.projets.map((p: any) => `${p.title} [${p.status}${p.endDate && new Date(p.endDate) < new Date() && p.status !== "termine" ? " ⚠EN RETARD" : ""}]`).join(", ")}`;
      }
    } else if (emailFrom) {
      const contacts = await db.select().from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), eq(contactsTable.email, emailFrom))).limit(1);
      if (contacts[0]) {
        contactContext = `\nCONTACT RECONNU: ${contacts[0].firstName} ${contacts[0].lastName}, ${contacts[0].company || ""}`;
      }
    }

    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));

    const systemPrompt = `Tu es un expert en communication d'entreprise pour "${org?.name || "Agent de Bureau"}". Tu rediges des reponses email professionnelles, pertinentes et efficaces en francais. Tu t'adaptes au ton demande et tu personnalises selon le contexte du contact.
Tu as acces aux rapports des agents IA specialises pour enrichir ta reponse avec du contexte pertinent.

${collaborationPrompt}`;

    const prompt = `Redige une reponse a cet email:
- De: ${emailFrom || "Inconnu"}
- Objet: ${emailSubject || "Sans objet"}
- Corps: ${emailBody || "Pas de contenu"}
- Ton souhaite: ${tone || "professionnel"}
${contactContext}

JSON attendu:
{
  "replySubject": "Re: objet",
  "replyBody": "Corps de la reponse (HTML avec paragraphes)",
  "tone": "ton detecte de l'email original",
  "detectedIntent": "intention (demande_info, plainte, commande, suivi, rdv, devis, remerciement)",
  "urgency": "basse/moyenne/haute",
  "suggestedActions": ["actions a faire apres envoi"],
  "alternativeReplies": [{"tone": "empathique", "body": "version alternative"}],
  "extractedData": {"dates": [], "amounts": [], "phoneNumbers": [], "names": []},
  "agentInsightsSummary": "Resume des informations des agents IA utilisees pour cette reponse"
}`;

    const cacheKey = buildAiCacheKey({
      route: "/commandant/email-smart-reply",
      organisationId: orgId,
      input: { emailFrom, emailSubject, emailBodyHash: (emailBody || "").slice(0, 500), tone, contactId },
    });
    const aiResponse = await multiAiGenerateCached(cacheKey, AI_CACHE_TTL.MEDIUM, prompt, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { replySubject: `Re: ${emailSubject}`, replyBody: aiResponse };
    } catch { parsed = { replySubject: `Re: ${emailSubject}`, replyBody: aiResponse }; }

    const activeAgents = Object.entries(agentInsights).map(([id, insight]) => ({ id, score: insight.score }));
    res.json({ success: true, reply: parsed, collaboration: { agentsConsulted: activeAgents, enrichedByAgents: true } });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/EmailReply]");
  }
});

// ═══════════════════════════════════════════
// 6. E-POSTA OTOMATIK DERLEME
// ═══════════════════════════════════════════
router.post("/commandant/email-compile", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) { res.status(400).json({ error: "Liste d'emails requise" }); return; }

    const systemPrompt = `Tu es un expert en organisation de bureau. Tu dois classer et compiler une liste d'emails en categories claires avec un resume actionnable pour chaque.`;
    const prompt = `Compile et classe ces ${emails.length} emails:
${emails.map((e: any, i: number) => `[${i + 1}] De: ${e.from || "?"} | Objet: ${e.subject || "?"} | Date: ${e.date || "?"} | Extrait: ${(e.body || e.snippet || "").slice(0, 200)}`).join("\n")}

JSON attendu:
{
  "categories": {
    "urgent": [{"index": 1, "summary": "resume", "action": "action requise"}],
    "factures": [...],
    "confirmations": [...],
    "demandes": [...],
    "informations": [...],
    "spam": [...]
  },
  "globalSummary": "Resume global de la boite mail",
  "priorityActions": ["actions prioritaires a faire maintenant"],
  "stats": {"total": 10, "urgent": 2, "needsReply": 5, "informational": 3}
}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { globalSummary: aiResponse };
    } catch { parsed = { globalSummary: aiResponse }; }

    res.json({ success: true, compilation: parsed });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/EmailCompile]");
  }
});

// ═══════════════════════════════════════════
// 7. GECİKMİŞ İŞ HATIRLATMALARI (MAIL + TELEFON)
// ═══════════════════════════════════════════
router.post("/commandant/overdue-reminders", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const now = new Date();

    const overdueTasks = await db.select().from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), lt(tasksTable.dueDate, now))).orderBy(tasksTable.dueDate).limit(50);

    const overdueInvoices = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), ne(facturesClientTable.status, "payee"), ne(facturesClientTable.status, "brouillon"), lt(facturesClientTable.dueDate, now))).limit(30);

    const upcomingEvents = await db.select().from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), gte(calendarEventsTable.startDate, now), lte(calendarEventsTable.startDate, new Date(now.getTime() + 48 * 3600000)))).orderBy(calendarEventsTable.startDate).limit(10);

    const systemPrompt = `Tu es un assistant de gestion ultra-efficace. Tu dois generer des rappels clairs et actionnables pour les taches en retard, factures impayees et evenements a venir. Sois direct et professionnel.`;
    const prompt = `Genere des rappels pour:
TACHES EN RETARD (${overdueTasks.length}):
${overdueTasks.map(t => `- "${t.title}" [${t.priority}] echeance: ${t.dueDate ? new Date(t.dueDate).toLocaleDateString("fr-FR") : "?"} (${Math.ceil((now.getTime() - new Date(t.dueDate!).getTime()) / 86400000)} jours de retard)`).join("\n")}

FACTURES IMPAYEES (${overdueInvoices.length}):
${overdueInvoices.map(f => `- ${f.reference} client: ${f.clientName} montant: ${Number(f.totalAmount) - Number(f.paidAmount)} EUR echeance: ${f.dueDate ? new Date(f.dueDate).toLocaleDateString("fr-FR") : "?"}`).join("\n")}

EVENEMENTS PROCHAINS (${upcomingEvents.length}):
${upcomingEvents.map(e => `- "${e.title}" ${new Date(e.startDate).toLocaleDateString("fr-FR")} ${new Date(e.startDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`).join("\n")}

JSON attendu:
{
  "taskReminders": [{"taskId": 1, "message": "rappel clair", "urgency": "critique/haute/moyenne", "suggestedAction": "action"}],
  "invoiceReminders": [{"invoiceRef": "REF", "clientName": "nom", "amount": 100, "message": "rappel", "emailDraft": "corps email"}],
  "eventReminders": [{"title": "titre", "message": "rappel"}],
  "dailySummary": "Resume de la situation",
  "criticalAlerts": ["alertes critiques"]
}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { dailySummary: aiResponse };
    } catch { parsed = { dailySummary: aiResponse }; }

    let emailsSent = 0;
    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
    if (req.body.sendEmails && parsed.invoiceReminders?.length) {
      for (const reminder of parsed.invoiceReminders) {
        const invoice = overdueInvoices.find(f => f.reference === reminder.invoiceRef || f.clientName === reminder.clientName);
        if (invoice?.clientEmail) {
          const html = emailWrap("Rappel de paiement", `<h2 style="color:#dc2626;">Rappel - ${escapeHtml(invoice.reference)}</h2><p>${escapeHtml(reminder.message)}</p><div style="background:#fef2f2;padding:20px;border-radius:10px;text-align:center;margin:20px 0;"><div style="font-size:24px;font-weight:700;color:#dc2626;">${(Number(invoice.totalAmount) - Number(invoice.paidAmount)).toFixed(2)} EUR</div></div>${org?.bankIban ? `<p style="font-size:12px;color:#64748b;">IBAN: ${escapeHtml(org.bankIban)} | Ref: ${escapeHtml(invoice.reference)}</p>` : ""}`);
          const sent = await sendEmailViaResend(invoice.clientEmail, `Rappel - Facture ${invoice.reference}`, html);
          if (sent) emailsSent++;
        }
      }
    }

    const userId = req.session?.userId;
    for (const alert of (parsed.criticalAlerts || [])) {
      await createNotification(orgId, userId ?? null, "Alerte critique", alert, "alerte");
    }

    res.json({
      success: true,
      overdue: { tasks: overdueTasks.length, invoices: overdueInvoices.length, events: upcomingEvents.length },
      aiAnalysis: parsed,
      emailsSent,
    });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/OverdueReminders]");
  }
});

// ═══════════════════════════════════════════
// 8 & 9. TOPLANTI DERLEME + GÖREV/HATIRLATMA OLUŞTURMA
// ═══════════════════════════════════════════
router.post("/commandant/meeting-compile", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { meetingTitle, participants, notes, duration, meetingType } = req.body;

    const systemPrompt = `Tu es un expert en gestion de reunions d'entreprise. Tu dois compiler les notes de reunion en un compte-rendu structure avec des actions claires, des taches assignables et des rappels. Tu es extremement precis et actionnable.`;
    const prompt = `Compile cette reunion:
- Titre: ${meetingTitle || "Reunion"}
- Type: ${meetingType || "reunion"}
- Participants: ${Array.isArray(participants) ? participants.join(", ") : participants || "Non specifies"}
- Duree: ${duration || "N/A"} minutes
- Notes: ${notes || "Aucune note"}

JSON attendu:
{
  "summary": "Resume executif (3-5 phrases)",
  "keyDecisions": ["decisions prises"],
  "actionItems": [{"title": "titre clair", "assignedTo": "nom", "priority": "haute/moyenne/basse", "dueInDays": 7, "description": "details"}],
  "appointments": [{"title": "suivi reunion", "dateInDays": 14, "participants": ["noms"]}],
  "reminders": [{"title": "rappel", "dateInDays": 3, "forPerson": "nom", "message": "message"}],
  "risks": ["risques identifies"],
  "nextSteps": ["prochaines etapes"],
  "meetingEfficiency": "score 1-10 avec commentaire"
}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: aiResponse };
    } catch { parsed = { summary: aiResponse }; }

    const createdTasks: any[] = [];
    for (const action of (parsed.actionItems || [])) {
      try {
        const dueDate = new Date(Date.now() + (action.dueInDays || 7) * 86400000);
        const [t] = await db.insert(tasksTable).values({
          organisationId: orgId, title: `[Reunion] ${action.title}`, description: `${action.description || ""}\nAssigne a: ${action.assignedTo || "Non assigne"}\nReunion: ${meetingTitle || ""}`, priority: action.priority || "moyenne", status: "en_attente", dueDate,
        }).returning();
        createdTasks.push(t);
      } catch (e) { logger.error({ err: e }, "[Commandant/MeetingCompile] task insert failed:"); }
    }

    const createdEvents: any[] = [];
    for (const appt of (parsed.appointments || [])) {
      try {
        const startDate = new Date(Date.now() + (appt.dateInDays || 14) * 86400000);
        startDate.setHours(10, 0, 0, 0);
        const endDate = new Date(startDate.getTime() + 3600000);
        const [e] = await db.insert(calendarEventsTable).values({
          organisationId: orgId, title: appt.title, type: "reunion", startDate, endDate, status: "en_attente", description: `Participants: ${(appt.participants || []).join(", ")}`,
        }).returning();
        createdEvents.push(e);
      } catch (e) { logger.error({ err: e }, "[Commandant/MeetingCompile] event insert failed:"); }
    }

    const userId = req.session?.userId;
    for (const reminder of (parsed.reminders || [])) {
      await createNotification(orgId, userId ?? null, `[Reunion] ${reminder.title}`, reminder.message, "rappel");
    }

    res.json({ success: true, compilation: parsed, createdTasks, createdEvents, remindersCreated: (parsed.reminders || []).length });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/MeetingCompile]");
  }
});

// ═══════════════════════════════════════════
// 10 & 11. FOTOĞRAF + GPS KONUM + AKTARMA
// ═══════════════════════════════════════════
router.post("/commandant/photo-location", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { photoBase64, latitude, longitude, description, linkedEntity, linkedEntityId } = req.body;

    if (photoBase64 != null) {
      if (typeof photoBase64 !== "string") {
        res.status(400).json({ success: false, error: "photoBase64 doit etre une chaine base64" });
        return;
      }
      if (photoBase64.length > 2_000_000) {
        res.status(413).json({ success: false, error: "Photo trop volumineuse (max ~1.5MB)" });
        return;
      }
      const cleaned = photoBase64.replace(/^data:[^;]+;base64,/, "");
      const scan = scanBase64Content(cleaned, "photo.jpg");
      if (!scan.safe) {
        res.status(400).json({ success: false, error: "Photo refusee par l'antivirus", threats: scan.threats });
        return;
      }
      if (scan.fileType && !["JPEG", "PNG"].includes(scan.fileType)) {
        res.status(400).json({ success: false, error: `Type de fichier non autorise: ${scan.fileType}. Seuls JPEG et PNG sont acceptes.` });
        return;
      }
    }

    let address = "";
    let mapUrl = "";
    // Strict numeric + WGS-84 bounds validation before interpolating into ANY
    // outbound URL. Without this, a string like `1&inject=...` would corrupt
    // the nominatim query (and could be used to DoS via huge payloads). The
    // host is hardcoded so this is defense-in-depth, not a primary SSRF fix.
    const latNum = typeof latitude === "number" ? latitude : Number(latitude);
    const lonNum = typeof longitude === "number" ? longitude : Number(longitude);
    const coordsValid = Number.isFinite(latNum) && Number.isFinite(lonNum)
      && latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
    if (coordsValid) {
      const latStr = latNum.toFixed(6);
      const lonStr = lonNum.toFixed(6);
      mapUrl = `https://www.google.com/maps?q=${latStr},${lonStr}`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5_000);
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${latStr}&lon=${lonStr}&format=json&accept-language=fr`,
          { signal: ac.signal, headers: { "User-Agent": "AgentDeBureau/1.0" } },
        );
        const geoData = await geoRes.json() as any;
        address = geoData?.display_name || `${latStr}, ${lonStr}`;
      } catch {
        address = `${latStr}, ${lonStr}`;
      } finally {
        clearTimeout(timer);
      }
    }

    const metadata = {
      organisationId: orgId,
      timestamp: new Date().toISOString(),
      latitude,
      longitude,
      address,
      mapUrl,
      description: description || "",
      linkedEntity: linkedEntity || null,
      linkedEntityId: linkedEntityId || null,
      hasPhoto: !!photoBase64,
      photoSize: photoBase64 ? Math.round(photoBase64.length * 0.75 / 1024) + " KB" : null,
    };

    if (linkedEntity === "contact" && linkedEntityId) {
      try {
        await db.update(contactsTable).set({ address }).where(and(eq(contactsTable.id, linkedEntityId), eq(contactsTable.organisationId, orgId)));
      } catch (e) { logger.error({ err: e }, "[Commandant/Location] contact address update failed:"); }
    }
    if (linkedEntity === "projet" && linkedEntityId) {
      try {
        const { projetsTable } = await import("@workspace/db");
        await db.update(projetsTable).set({ address }).where(and(eq(projetsTable.id, linkedEntityId), eq(projetsTable.organisationId, orgId)));
      } catch (e) { logger.error({ err: e }, "[Commandant/Location] project address update failed:"); }
    }

    res.json({ success: true, location: { address, latitude, longitude, mapUrl }, metadata });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/PhotoLocation]");
  }
});

// ═══════════════════════════════════════════
// 12 & 13. ÇALIŞAN İSTATİSTİKLERİ + ANALİZ DERLEME
// ═══════════════════════════════════════════
router.get("/commandant/employee-stats", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 86400000);

    const users = await db.execute(sql`SELECT id, prenom, nom, email, role, departement FROM users WHERE organisation_id = ${orgId} AND actif = true`);

    const employeeStats: any[] = [];
    for (const user of (users as any).rows || users || []) {
      const userEmail = (user as any).email || "";
      const [tasksDone] = await db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.assignedTo, userEmail), eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, monthAgo)));
      const [tasksOverdue] = await db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.assignedTo, userEmail), ne(tasksTable.status, "termine"), lt(tasksTable.dueDate, now)));
      const [callsMade] = await db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.contactName, `${(user as any).prenom || ""} ${(user as any).nom || ""}`.trim()), gte(callsTable.createdAt, monthAgo)));
      const [eventsCreated] = await db.select({ c: sql<number>`count(*)::int` }).from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), sql`description ILIKE ${"%" + userEmail + "%"}`, gte(calendarEventsTable.startDate, monthAgo), lte(calendarEventsTable.startDate, now)));

      employeeStats.push({
        id: (user as any).id,
        name: `${(user as any).prenom || ""} ${(user as any).nom || ""}`.trim(),
        email: (user as any).email,
        role: (user as any).role,
        department: (user as any).departement,
        stats: {
          tasksCompleted: tasksDone?.c || 0,
          tasksOverdue: tasksOverdue?.c || 0,
          callsMade: callsMade?.c || 0,
          eventsAttended: eventsCreated?.c || 0,
          productivityScore: Math.min(100, Math.round(((tasksDone?.c || 0) * 10 + (callsMade?.c || 0) * 5 - (tasksOverdue?.c || 0) * 15))),
        },
      });
    }

    const systemPrompt = `Tu es un expert RH et en analyse de performance. Analyse les statistiques des employes et genere un rapport clair avec des recommandations.`;
    const prompt = `Analyse les stats de ${employeeStats.length} employes ce mois:
${employeeStats.map(e => `- ${e.name} (${e.role}): ${e.stats.tasksCompleted} taches, ${e.stats.tasksOverdue} retards, ${e.stats.callsMade} appels, score: ${e.stats.productivityScore}`).join("\n")}

JSON attendu:
{
  "globalScore": 75,
  "topPerformers": [{"name": "nom", "reason": "raison"}],
  "needsAttention": [{"name": "nom", "issue": "probleme", "suggestion": "solution"}],
  "teamInsights": "analyse globale",
  "recommendations": ["recommandations"],
  "trends": "tendances observees"
}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let analysis: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { teamInsights: aiResponse };
    } catch { analysis = { teamInsights: aiResponse }; }

    res.json({ success: true, employees: employeeStats, analysis });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/EmployeeStats]");
  }
});

// ═══════════════════════════════════════════
// 14. ÖDEME/FATURA TAKİBİ + HATIRLATMA
// ═══════════════════════════════════════════
router.get("/commandant/payment-overview", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const now = new Date();

    const allInvoices = await db.select().from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId)).orderBy(desc(facturesClientTable.createdAt)).limit(100);

    const paid = allInvoices.filter(f => f.status === "payee");
    const pending = allInvoices.filter(f => f.status === "envoyee");
    const overdue = allInvoices.filter(f => f.status !== "payee" && f.status !== "brouillon" && f.dueDate && new Date(f.dueDate) < now);
    const draft = allInvoices.filter(f => f.status === "brouillon");

    const totalPaid = paid.reduce((s, f) => s + Number(f.totalAmount), 0);
    const totalPending = pending.reduce((s, f) => s + Number(f.totalAmount) - Number(f.paidAmount), 0);
    const totalOverdue = overdue.reduce((s, f) => s + Number(f.totalAmount) - Number(f.paidAmount), 0);

    const systemPrompt = `Tu es un directeur financier IA. Analyse la situation des paiements et propose des actions concretes.`;
    const prompt = `Situation financiere:
- Factures payees: ${paid.length} (${totalPaid.toFixed(2)} EUR)
- En attente: ${pending.length} (${totalPending.toFixed(2)} EUR)
- En retard: ${overdue.length} (${totalOverdue.toFixed(2)} EUR)
- Brouillons: ${draft.length}

Detail des retards:
${overdue.map(f => `- ${f.reference}: ${f.clientName} - ${(Number(f.totalAmount) - Number(f.paidAmount)).toFixed(2)} EUR - ${Math.ceil((now.getTime() - new Date(f.dueDate!).getTime()) / 86400000)} jours`).join("\n") || "Aucun retard"}

JSON attendu:
{
  "healthScore": 85,
  "summary": "resume financier",
  "criticalActions": ["actions urgentes"],
  "cashFlowForecast": "prevision tresorerie",
  "clientRiskAnalysis": [{"client": "nom", "risk": "eleve/moyen/faible", "totalOwed": 1000, "recommendation": "action"}],
  "automatedEmailDrafts": [{"clientName": "nom", "subject": "objet", "body": "corps email"}]
}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let analysis: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: aiResponse };
    } catch { analysis = { summary: aiResponse }; }

    res.json({
      success: true,
      overview: { totalPaid, totalPending, totalOverdue, paidCount: paid.length, pendingCount: pending.length, overdueCount: overdue.length, draftCount: draft.length },
      overdueInvoices: overdue.map(f => ({ id: f.id, reference: f.reference, clientName: f.clientName, clientEmail: f.clientEmail, totalAmount: Number(f.totalAmount), paidAmount: Number(f.paidAmount), remaining: Number(f.totalAmount) - Number(f.paidAmount), dueDate: f.dueDate, daysOverdue: f.dueDate ? Math.ceil((now.getTime() - new Date(f.dueDate).getTime()) / 86400000) : 0 })),
      analysis,
    });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/PaymentOverview]");
  }
});

// ═══════════════════════════════════════════
// 15-18. GOOGLE WORKSPACE + DRIVE + MAIL ATTACHMENT
// ═══════════════════════════════════════════
router.post("/commandant/drive-send-file", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { recipientEmail, recipientName, subject, message, fileName, fileContent } = req.body;

    if (!recipientEmail || !subject) { res.status(400).json({ error: "Email et sujet requis" }); return; }

    const body = `
      <h2 style="color:#0f1729;font-size:18px;">${escapeHtml(subject)}</h2>
      <p style="color:#64748b;font-size:14px;">Bonjour ${escapeHtml(recipientName || "")},</p>
      <p style="color:#64748b;font-size:14px;">${escapeHtml(message || "Veuillez trouver ci-joint le document demande.")}</p>
      ${fileName ? `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;margin:20px 0;"><p style="margin:0;font-size:13px;color:#0369a1;">📎 Fichier joint: <strong>${escapeHtml(fileName)}</strong></p></div>` : ""}
      <p style="color:#64748b;font-size:13px;">Cordialement,<br><strong>Agent de Bureau</strong></p>`;

    const html = emailWrap("Envoi de document", body);
    const sent = await sendEmailViaResend(recipientEmail, subject, html);

    res.json({ success: sent, message: sent ? `Document envoye a ${recipientEmail}` : "Echec de l'envoi" });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/DriveSendFile]");
  }
});

router.post("/commandant/save-attachment-to-drive", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { fileName, fileContent, mimeType, emailSubject, emailFrom } = req.body;

    if (!fileName || !fileContent) { res.status(400).json({ error: "Nom et contenu du fichier requis" }); return; }

    const metadata = {
      savedAt: new Date().toISOString(),
      originalEmail: { subject: emailSubject || null, from: emailFrom || null },
      fileName,
      mimeType: mimeType || "application/octet-stream",
      size: Math.round(fileContent.length * 0.75 / 1024) + " KB",
      organisationId: orgId,
      status: "saved_locally",
      driveSync: "pending",
    };

    res.json({ success: true, message: `Fichier "${fileName}" prepare pour Google Drive`, metadata });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/SaveAttachment]");
  }
});

// ═══════════════════════════════════════════
// GLOBAL AI BRIEFING (Résumé quotidien complet)
// ═══════════════════════════════════════════
router.get("/commandant/daily-briefing", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);

    const [taskCount, overdueCount, todayEvents, overdueInvoiceCount, recentCalls, agentInsights, projetsActifs, projetsEnRetard] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), ne(tasksTable.status, "termine"))).then(r => r[0]),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), ne(tasksTable.status, "termine"), lt(tasksTable.dueDate, now))).then(r => r[0]),
      db.select().from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), gte(calendarEventsTable.startDate, today), lt(calendarEventsTable.startDate, tomorrow))).orderBy(calendarEventsTable.startDate),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), ne(facturesClientTable.status, "payee"), ne(facturesClientTable.status, "brouillon"), lt(facturesClientTable.dueDate, now))).then(r => r[0]),
      db.select().from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, new Date(now.getTime() - 24 * 3600000)))).orderBy(desc(callsTable.createdAt)).limit(5),
      getLatestAgentInsights(orgId),
      db.select({ c: sql<number>`count(*)::int` }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), ne(projetsTable.status, "termine"), ne(projetsTable.status, "annule"))).then(r => r[0]),
      db.select({ c: sql<number>`count(*)::int` }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), ne(projetsTable.status, "termine"), ne(projetsTable.status, "annule"), lt(projetsTable.endDate, now))).then(r => r[0]),
    ]);

    const collaborationPrompt = buildCommandantContextPrompt(agentInsights);
    const crossIssues = (await import("./agent-collaboration")).detectCrossAgentIssues(orgId);
    const crossIssuesList = await crossIssues;

    const systemPrompt = `Tu es le Commandant IA d'Agent de Bureau — un assistant executif surpuissant qui aide les dirigeants a gerer leur journee. Tu utilises toutes les donnees disponibles ET les rapports des agents IA specialises pour fournir le briefing matinal le plus complet et actionnable possible. Sois concis, clair et strategique. Francais uniquement.

${collaborationPrompt}`;

    const prompt = `Genere le briefing matinal pour aujourd'hui (${now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}):

DONNEES OPERATIONNELLES:
- Taches ouvertes: ${taskCount?.c || 0} (${overdueCount?.c || 0} en retard)
- Evenements aujourd'hui: ${todayEvents.length}
${todayEvents.map((e: any) => `  * ${new Date(e.startDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} - ${e.title} (${e.type})`).join("\n")}
- Factures en retard: ${overdueInvoiceCount?.c || 0}
- Projets actifs: ${projetsActifs?.c || 0}${(projetsEnRetard?.c || 0) > 0 ? ` (⚠ ${projetsEnRetard?.c} en retard sur planning)` : ""}
- Appels derniers 24h: ${recentCalls.length}
${recentCalls.map((c: any) => `  * ${c.contactName || "Inconnu"} - ${c.status} - ${c.notes || "Pas de resume"}`).join("\n")}

ALERTES INTER-AGENTS (${crossIssuesList.length} problemes transversaux detectes):
${crossIssuesList.map((i: any) => `⚠ [${i.severity}] ${i.title}: ${i.description}`).join("\n") || "Aucune alerte transversale"}

JSON attendu:
{
  "greeting": "Bonjour! Voici votre briefing...",
  "priorityScore": 75,
  "todayAgenda": ["element 1 de l'agenda", "element 2"],
  "criticalItems": ["items critiques a traiter immediatement"],
  "recommendations": ["recommandations strategiques"],
  "agentAlerts": ["alertes des agents IA specialises"],
  "crossServiceIssues": ["problemes transversaux detectes entre services"],
  "motivationalNote": "note de motivation personnalisee",
  "weatherOfBusiness": "ensoleille/nuageux/orageux (metaphore business)"
}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { greeting: aiResponse };
    } catch { parsed = { greeting: aiResponse }; }

    const agentScores = Object.entries(agentInsights).map(([id, i]) => ({ id, score: i.score, status: i.status }));

    res.json({
      success: true,
      briefing: parsed,
      rawData: { openTasks: taskCount?.c || 0, overdueTasks: overdueCount?.c || 0, todayEvents: todayEvents.length, overdueInvoices: overdueInvoiceCount?.c || 0, recentCalls: recentCalls.length, projetsActifs: projetsActifs?.c || 0, projetsEnRetard: projetsEnRetard?.c || 0 },
      collaboration: {
        agentScores,
        crossIssues: crossIssuesList,
        enrichedByAgents: true,
      },
    });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/DailyBriefing]");
  }
});

// ═══════════════════════════════════════════
// SEND OVERDUE TASK REMINDER EMAIL
// ═══════════════════════════════════════════
router.post("/commandant/send-task-reminder", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { taskId, recipientEmail, customMessage } = req.body;
    if (!taskId || !recipientEmail) { res.status(400).json({ error: "taskId et recipientEmail requis" }); return; }

    const [task] = await db.select().from(tasksTable).where(and(eq(tasksTable.id, taskId), eq(tasksTable.organisationId, orgId)));
    if (!task) { res.status(404).json({ error: "Tache introuvable" }); return; }

    const daysOverdue = task.dueDate ? Math.ceil((Date.now() - new Date(task.dueDate).getTime()) / 86400000) : 0;
    const body = `
      <h2 style="color:#ea580c;">Rappel - Tache en retard</h2>
      <div style="background:#fff7ed;border:2px solid #ea580c;border-radius:12px;padding:20px;margin:20px 0;">
        <h3 style="margin:0 0 8px;color:#0f1729;">${escapeHtml(task.title)}</h3>
        ${task.description ? `<p style="color:#64748b;font-size:13px;">${escapeHtml(task.description)}</p>` : ""}
        <p style="color:#ea580c;font-weight:700;">Priorite: ${task.priority} | En retard de ${daysOverdue} jour${daysOverdue > 1 ? "s" : ""}</p>
        ${task.dueDate ? `<p style="color:#64748b;font-size:12px;">Echeance: ${new Date(task.dueDate).toLocaleDateString("fr-FR")}</p>` : ""}
      </div>
      ${customMessage ? `<p style="color:#64748b;">${escapeHtml(customMessage)}</p>` : ""}
      <p style="color:#64748b;font-size:13px;">Merci de traiter cette tache dans les meilleurs delais.</p>`;

    const html = emailWrap("Rappel de tache", body);
    const sent = await sendEmailViaResend(recipientEmail, `[RAPPEL] Tache en retard: ${task.title}`, html);

    res.json({ success: sent });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/TaskReminder]");
  }
});

// ═══════════════════════════════════════════
// AI SMART SEARCH (Cross-module intelligent search)
// ═══════════════════════════════════════════
router.post("/commandant/smart-search", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { query } = req.body;
    if (!query || query.length < 2) { res.status(400).json({ error: "Requete trop courte" }); return; }

    // Reuse the chat retriever's accent-stripping + light French stemmer so
    // that queries like "impayé" still match rows like "factures impayées".
    // When no usable keyword can be extracted (e.g. very short / numeric query)
    // we fall back to a single accent-stripped substring pattern.
    const useUnaccent = await ensureUnaccentExtension();
    const keywords = extractKeywordsFromChat(query);
    const patterns = keywords.length > 0
      ? keywords.map(kw => `%${kw}%`)
      : [`%${stripAccents(String(query))}%`];
    const anyMatch = (...cols: Column[]): SQL => {
      const conds = patterns.flatMap(p => cols.map(c => accentInsensitiveIlike(c, p, useUnaccent)));
      return or(...conds) as SQL;
    };

    const dedupeById = <T extends { id: number }>(arr: T[]): T[] => {
      const seen = new Set<number>();
      const out: T[] = [];
      for (const x of arr) { if (!seen.has(x.id)) { seen.add(x.id); out.push(x); } }
      return out;
    };

    const [contactsRaw, tasksRaw, eventsRaw, invoicesRaw, prospectsRaw] = await Promise.all([
      db.select().from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), anyMatch(contactsTable.firstName, contactsTable.lastName, contactsTable.email, contactsTable.phone, contactsTable.company))).limit(10),
      db.select().from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), anyMatch(tasksTable.title, tasksTable.description))).limit(10),
      db.select().from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), anyMatch(calendarEventsTable.title, calendarEventsTable.description))).limit(10),
      db.select().from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), anyMatch(facturesClientTable.reference, facturesClientTable.clientName))).limit(10),
      db.select().from(prospectsTable).where(and(eq(prospectsTable.organisationId, orgId), anyMatch(prospectsTable.company, prospectsTable.contactName, prospectsTable.email))).limit(10),
    ]);
    const contacts = dedupeById(contactsRaw).slice(0, 10);
    const tasks = dedupeById(tasksRaw).slice(0, 10);
    const events = dedupeById(eventsRaw).slice(0, 10);
    const invoices = dedupeById(invoicesRaw).slice(0, 10);
    const prospects = dedupeById(prospectsRaw).slice(0, 10);

    const totalResults = contacts.length + tasks.length + events.length + invoices.length + prospects.length;

    let aiSummary = "";
    if (totalResults > 0) {
      const prompt = `Analyse ces resultats de recherche pour "${query}" et donne un resume utile en francais (2-3 phrases max):
Contacts: ${contacts.length} (${contacts.map(c => `${c.firstName} ${c.lastName}`).join(", ")})
Taches: ${tasks.length} (${tasks.map(t => t.title).join(", ")})
Evenements: ${events.length}
Factures: ${invoices.length}
Prospects: ${prospects.length}
Resume:`;
      try { aiSummary = await multiAiGenerate(prompt, undefined, orgId, req.path); } catch (e) { logger.error({ err: e }, "[Commandant/Search] AI summary failed:"); }
    }

    res.json({
      success: true,
      query,
      totalResults,
      results: {
        contacts: contacts.map(c => ({ id: c.id, type: "contact", title: `${c.firstName} ${c.lastName}`, subtitle: c.company || c.email, phone: c.phone })),
        tasks: tasks.map(t => ({ id: t.id, type: "tache", title: t.title, subtitle: `${t.status} - ${t.priority}`, dueDate: t.dueDate })),
        events: events.map(e => ({ id: e.id, type: "evenement", title: e.title, subtitle: e.type, startDate: e.startDate })),
        invoices: invoices.map(f => ({ id: f.id, type: "facture", title: f.reference, subtitle: `${f.clientName} - ${Number(f.totalAmount).toFixed(2)} EUR`, status: f.status })),
        prospects: prospects.map(p => ({ id: p.id, type: "prospect", title: p.company || p.contactName || p.title, subtitle: `${p.stage} - ${p.source || ""}` })),
      },
      aiSummary,
    });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/SmartSearch]");
  }
});

router.post("/commandant/smart-search/stream", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  const { query } = req.body || {};
  if (!query || typeof query !== "string" || query.length < 2) {
    res.status(400).json({ error: "Requete trop courte" });
    return;
  }

  const stream = openSseStream(res);
  try {
    // Mirror /commandant/smart-search: accent-insensitive ILIKE + light French
    // stemming so streaming results match the blocking endpoint's quality.
    const useUnaccent = await ensureUnaccentExtension();
    const keywords = extractKeywordsFromChat(query);
    const patterns = keywords.length > 0
      ? keywords.map(kw => `%${kw}%`)
      : [`%${stripAccents(String(query))}%`];
    const anyMatch = (...cols: Column[]): SQL => {
      const conds = patterns.flatMap(p => cols.map(c => accentInsensitiveIlike(c, p, useUnaccent)));
      return or(...conds) as SQL;
    };
    const dedupeById = <T extends { id: number }>(arr: T[]): T[] => {
      const seen = new Set<number>();
      const out: T[] = [];
      for (const x of arr) { if (!seen.has(x.id)) { seen.add(x.id); out.push(x); } }
      return out;
    };

    const [contactsRaw, tasksRaw, eventsRaw, invoicesRaw, prospectsRaw] = await Promise.all([
      db.select().from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), anyMatch(contactsTable.firstName, contactsTable.lastName, contactsTable.email, contactsTable.phone, contactsTable.company))).limit(10),
      db.select().from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), anyMatch(tasksTable.title, tasksTable.description))).limit(10),
      db.select().from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), anyMatch(calendarEventsTable.title, calendarEventsTable.description))).limit(10),
      db.select().from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), anyMatch(facturesClientTable.reference, facturesClientTable.clientName))).limit(10),
      db.select().from(prospectsTable).where(and(eq(prospectsTable.organisationId, orgId), anyMatch(prospectsTable.company, prospectsTable.contactName, prospectsTable.email))).limit(10),
    ]);
    const contacts = dedupeById(contactsRaw).slice(0, 10);
    const tasks = dedupeById(tasksRaw).slice(0, 10);
    const events = dedupeById(eventsRaw).slice(0, 10);
    const invoices = dedupeById(invoicesRaw).slice(0, 10);
    const prospects = dedupeById(prospectsRaw).slice(0, 10);

    const totalResults = contacts.length + tasks.length + events.length + invoices.length + prospects.length;
    const results = {
      contacts: contacts.map(c => ({ id: c.id, type: "contact", title: `${c.firstName} ${c.lastName}`, subtitle: c.company || c.email, phone: c.phone })),
      tasks: tasks.map(t => ({ id: t.id, type: "tache", title: t.title, subtitle: `${t.status} - ${t.priority}`, dueDate: t.dueDate })),
      events: events.map(e => ({ id: e.id, type: "evenement", title: e.title, subtitle: e.type, startDate: e.startDate })),
      invoices: invoices.map(f => ({ id: f.id, type: "facture", title: f.reference, subtitle: `${f.clientName} - ${Number(f.totalAmount).toFixed(2)} EUR`, status: f.status })),
      prospects: prospects.map(p => ({ id: p.id, type: "prospect", title: p.company || p.contactName || p.title, subtitle: `${p.stage} - ${p.source || ""}` })),
    };

    stream.send("results", { query, totalResults, results });

    if (totalResults === 0) {
      stream.send("done", { success: true, query, totalResults, results, aiSummary: "" });
      stream.end();
      return;
    }

    const cacheKey = buildAiCacheKey({
      route: "/commandant/smart-search",
      organisationId: orgId,
      userId,
      input: { query, ids: { c: contacts.map(c => c.id), t: tasks.map(t => t.id), e: events.map(e => e.id), i: invoices.map(i => i.id), p: prospects.map(p => p.id) } },
    });
    const cached = getCached<string>(cacheKey);
    if (cached) {
      stream.send("cached", { aiSummary: cached });
      stream.send("done", { success: true, query, totalResults, results, aiSummary: cached, cached: true });
      stream.end();
      return;
    }

    const prompt = `Analyse ces resultats de recherche pour "${query}" et donne un resume utile en francais (2-3 phrases max):
Contacts: ${contacts.length} (${contacts.map(c => `${c.firstName} ${c.lastName}`).join(", ")})
Taches: ${tasks.length} (${tasks.map(t => t.title).join(", ")})
Evenements: ${events.length}
Factures: ${invoices.length}
Prospects: ${prospects.length}
Resume:`;

    const result = await multiAiGenerateStream({
      prompt, organisationId: orgId, route: "/commandant/smart-search",
      signal: stream.signal,
      onToken: (chunk) => stream.send("token", { chunk }),
      maxOutputTokens: 512,
    });

    if (stream.signal.aborted) { stream.end(); return; }
    if (result.fullText && result.fullText.length > 10) setCached(cacheKey, result.fullText, AI_CACHE_TTL.MEDIUM);
    stream.send("done", { success: true, query, totalResults, results, aiSummary: result.fullText, provider: result.provider, model: result.model });
    stream.end();
  } catch (err: any) {
    if (err instanceof StreamAbortedError) {
      stream.send("aborted", { partialText: err.partial.fullText, provider: err.partial.provider, model: err.partial.model });
      stream.end();
      return;
    }
    if (stream.signal.aborted || err?.message === "aborted") { stream.send("aborted", {}); stream.end(); return; }
    if (err instanceof AiQuotaExceededError) {
      stream.send("error", { error: err.message, quotaExceeded: true });
    } else {
      logger.error({ err }, "[Commandant/SmartSearch/stream]");
      stream.send("error", { error: err?.message || "Erreur lors de la recherche" });
    }
    stream.end();
  }
});

// ═══════════════════════════════════════════
// AI TEXT ANALYSIS (Analyze any text with AI)
// ═══════════════════════════════════════════
router.post("/commandant/analyze-text", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { text, analysisType } = req.body;
    if (!text) { res.status(400).json({ error: "Texte requis" }); return; }

    const typePrompts: Record<string, string> = {
      sentiment: "Analyse le sentiment de ce texte. Reponds en JSON: {sentiment: 'positif/neutre/negatif', score: 0-100, emotions: ['joie','colere',...], keyPhrases: ['...'], summary: '...'}",
      summary: "Resume ce texte en 3-5 points cles. JSON: {summary: '...', keyPoints: ['...'], wordCount: N, readingTime: '...', complexity: 'simple/moyen/complexe'}",
      entities: "Extrais toutes les entites de ce texte. JSON: {people: ['...'], companies: ['...'], dates: ['...'], amounts: ['...'], locations: ['...'], emails: ['...'], phones: ['...'], urls: ['...']}",
      action_items: "Extrais les actions et taches de ce texte. JSON: {actions: [{title: '...', priority: 'haute/moyenne/basse', deadline: '...', assignee: '...'}], decisions: ['...'], questions: ['...']}",
      translate: "Traduis ce texte en anglais professionnel. JSON: {translation: '...', sourceLanguage: '...', formalityLevel: 'formel/informel'}",
      rewrite: "Reecris ce texte de maniere plus professionnelle et claire en francais. JSON: {rewritten: '...', improvements: ['...'], tone: '...'}",
    };

    const systemPrompt = "Tu es un expert en analyse de texte. Reponds UNIQUEMENT en JSON valide.";
    const prompt = `${typePrompts[analysisType] || typePrompts.summary}\n\nTexte a analyser:\n${text}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { result: aiResponse };
    } catch { parsed = { result: aiResponse }; }

    res.json({ success: true, analysisType: analysisType || "summary", analysis: parsed });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/AnalyzeText]");
  }
});

router.post("/commandant/analyze-text/stream", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  const { text, analysisType } = req.body || {};
  if (!text || typeof text !== "string") { res.status(400).json({ error: "Texte requis" }); return; }

  const typePrompts: Record<string, string> = {
    sentiment: "Analyse le sentiment de ce texte. Reponds en JSON: {sentiment: 'positif/neutre/negatif', score: 0-100, emotions: ['joie','colere',...], keyPhrases: ['...'], summary: '...'}",
    summary: "Resume ce texte en 3-5 points cles. JSON: {summary: '...', keyPoints: ['...'], wordCount: N, readingTime: '...', complexity: 'simple/moyen/complexe'}",
    entities: "Extrais toutes les entites de ce texte. JSON: {people: ['...'], companies: ['...'], dates: ['...'], amounts: ['...'], locations: ['...'], emails: ['...'], phones: ['...'], urls: ['...']}",
    action_items: "Extrais les actions et taches de ce texte. JSON: {actions: [{title: '...', priority: 'haute/moyenne/basse', deadline: '...', assignee: '...'}], decisions: ['...'], questions: ['...']}",
    translate: "Traduis ce texte en anglais professionnel. JSON: {translation: '...', sourceLanguage: '...', formalityLevel: 'formel/informel'}",
    rewrite: "Reecris ce texte de maniere plus professionnelle et claire en francais. JSON: {rewritten: '...', improvements: ['...'], tone: '...'}",
  };

  const systemPrompt = "Tu es un expert en analyse de texte. Reponds UNIQUEMENT en JSON valide.";
  const prompt = `${typePrompts[analysisType] || typePrompts.summary}\n\nTexte a analyser:\n${text}`;
  const cacheKey = buildAiCacheKey({
    route: "/commandant/analyze-text",
    organisationId: orgId,
    userId,
    input: { analysisType: analysisType || "summary", text },
  });

  const stream = openSseStream(res);
  try {
    const cached = getCached<string>(cacheKey);
    if (cached) {
      stream.send("cached", { text: cached });
      let parsed: any;
      try { parsed = safeJsonParse(cached, { result: cached }); } catch { parsed = { result: cached }; }
      stream.send("done", { success: true, analysisType: analysisType || "summary", analysis: parsed, cached: true });
      stream.end();
      return;
    }

    const result = await multiAiGenerateStream({
      prompt, systemPrompt, organisationId: orgId, route: "/commandant/analyze-text",
      signal: stream.signal,
      onToken: (chunk) => stream.send("token", { chunk }),
      maxOutputTokens: 2048,
    });

    if (stream.signal.aborted) { stream.end(); return; }

    let parsed: any;
    try { parsed = safeJsonParse(result.fullText, { result: result.fullText }); } catch { parsed = { result: result.fullText }; }
    if (result.fullText && result.fullText.length > 10) {
      setCached(cacheKey, result.fullText, AI_CACHE_TTL.MEDIUM);
    }
    stream.send("done", {
      success: true, analysisType: analysisType || "summary", analysis: parsed,
      provider: result.provider, model: result.model,
    });
    stream.end();
  } catch (err: any) {
    if (err instanceof StreamAbortedError) {
      stream.send("aborted", {
        provider: err.partial.provider, model: err.partial.model,
        partialText: err.partial.fullText,
        usage: { inputTokens: err.partial.inputTokens, outputTokens: err.partial.outputTokens },
      });
      stream.end();
      return;
    }
    if (stream.signal.aborted || err?.message === "aborted") {
      stream.send("aborted", {});
      stream.end();
      return;
    }
    if (err instanceof AiQuotaExceededError) {
      stream.send("error", { error: err.message, quotaExceeded: true });
    } else {
      logger.error({ err }, "[Commandant/AnalyzeText/stream]");
      stream.send("error", { error: err?.message || "Erreur lors de l'analyse" });
    }
    stream.end();
  }
});

router.post("/commandant/execute-command", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId;
    const { command } = req.body;
    if (!command || typeof command !== "string" || command.length < 3) {
      res.status(400).json({ error: "Commande requise (minimum 3 caracteres)" });
      return;
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);

    const [taskCount, overdueCount, contactCount, unreadMsgs, missedCalls, overdueInvoiceCount] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), ne(tasksTable.status, "termine"))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), lt(tasksTable.dueDate, now))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(contactsTable).where(eq(contactsTable.organisationId, orgId)).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.isRead, false))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), ne(facturesClientTable.status, "payee"), ne(facturesClientTable.status, "brouillon"), lt(facturesClientTable.dueDate, now))).then(r => r[0]?.c ?? 0),
    ]);

    const agentInsights = await getLatestAgentInsights(orgId);
    const agentSummary = Object.entries(agentInsights).map(([id, i]) => `${id}: score ${i.score}/100`).join(", ");

    const systemPrompt = `Tu es le Commandant IA d'Agent de Bureau. Tu recois des commandes en langage naturel et tu dois les interpreter pour fournir une reponse actionnable.

CONTEXTE ACTUEL DU BUREAU:
- Taches ouvertes: ${taskCount} (${overdueCount} en retard)
- Contacts: ${contactCount}
- Messages non lus: ${unreadMsgs}
- Appels manques cette semaine: ${missedCalls}
- Factures en retard: ${overdueInvoiceCount}
- Scores agents: ${agentSummary || "Aucun rapport disponible"}

Tu peux repondre a des commandes comme:
- "Resume-moi la situation" → briefing rapide
- "Quelles sont les urgences?" → liste des items critiques
- "Comment va le bureau?" → etat general
- "Quelles taches sont en retard?" → liste des taches en retard
- "Analyse les appels" → insights telephonie
- "Previsions pour la semaine" → predictions

Reponds en JSON:
{
  "interpretation": "ce que tu as compris de la commande",
  "response": "ta reponse detaillee en francais",
  "category": "briefing|urgences|analyse|action|recherche|prediction",
  "data": {},
  "suggestedFollowUps": ["commandes de suivi suggerees"],
  "confidence": 0-100
}`;

    const aiResponse = await multiAiGenerate(`Commande utilisateur: "${command}"`, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { interpretation: command, response: aiResponse, category: "general", confidence: 50 };
    } catch {
      parsed = { interpretation: command, response: aiResponse, category: "general", confidence: 50 };
    }

    parsed.context = {
      openTasks: taskCount,
      overdueTasks: overdueCount,
      contacts: contactCount,
      unreadMessages: unreadMsgs,
      missedCalls,
      overdueInvoices: overdueInvoiceCount,
    };

    res.json({ success: true, command, result: parsed });
  } catch (err: any) {
    logger.error({ err: err }, "[Commandant/ExecuteCommand]");
    res.status(500).json({ error: "Erreur lors de l'execution de la commande" });
  }
});

router.post("/commandant/execute-command/stream", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  const { command } = req.body || {};
  if (!command || typeof command !== "string" || command.length < 3) {
    res.status(400).json({ error: "Commande requise (minimum 3 caracteres)" });
    return;
  }

  const stream = openSseStream(res);
  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);

    const [taskCount, overdueCount, contactCount, unreadMsgs, missedCalls, overdueInvoiceCount] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), ne(tasksTable.status, "termine"))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), lt(tasksTable.dueDate, now))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(contactsTable).where(eq(contactsTable.organisationId, orgId)).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.isRead, false))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), ne(facturesClientTable.status, "payee"), ne(facturesClientTable.status, "brouillon"), lt(facturesClientTable.dueDate, now))).then(r => r[0]?.c ?? 0),
    ]);

    const context = {
      openTasks: taskCount, overdueTasks: overdueCount, contacts: contactCount,
      unreadMessages: unreadMsgs, missedCalls, overdueInvoices: overdueInvoiceCount,
    };
    stream.send("context", { context });

    const agentInsights = await getLatestAgentInsights(orgId);
    const agentSummary = Object.entries(agentInsights).map(([id, i]) => `${id}: score ${i.score}/100`).join(", ");

    const systemPrompt = `Tu es le Commandant IA d'Agent de Bureau. Tu recois des commandes en langage naturel et tu dois les interpreter pour fournir une reponse actionnable.

CONTEXTE ACTUEL DU BUREAU:
- Taches ouvertes: ${taskCount} (${overdueCount} en retard)
- Contacts: ${contactCount}
- Messages non lus: ${unreadMsgs}
- Appels manques cette semaine: ${missedCalls}
- Factures en retard: ${overdueInvoiceCount}
- Scores agents: ${agentSummary || "Aucun rapport disponible"}

Tu peux repondre a des commandes comme:
- "Resume-moi la situation" → briefing rapide
- "Quelles sont les urgences?" → liste des items critiques
- "Comment va le bureau?" → etat general
- "Quelles taches sont en retard?" → liste des taches en retard
- "Analyse les appels" → insights telephonie
- "Previsions pour la semaine" → predictions

Reponds en JSON:
{
  "interpretation": "ce que tu as compris de la commande",
  "response": "ta reponse detaillee en francais",
  "category": "briefing|urgences|analyse|action|recherche|prediction",
  "data": {},
  "suggestedFollowUps": ["commandes de suivi suggerees"],
  "confidence": 0-100
}`;

    const cacheKey = buildAiCacheKey({
      route: "/commandant/execute-command",
      organisationId: orgId,
      userId,
      input: { command, ctx: context },
    });
    const cached = getCached<string>(cacheKey);
    if (cached) {
      let parsed: any;
      try { const m = cached.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { interpretation: command, response: cached, category: "general", confidence: 50 }; }
      catch { parsed = { interpretation: command, response: cached, category: "general", confidence: 50 }; }
      parsed.context = context;
      stream.send("cached", { text: cached });
      stream.send("done", { success: true, command, result: parsed, cached: true });
      stream.end();
      return;
    }

    const result = await multiAiGenerateStream({
      prompt: `Commande utilisateur: "${command}"`,
      systemPrompt, organisationId: orgId, route: "/commandant/execute-command",
      signal: stream.signal,
      onToken: (chunk) => stream.send("token", { chunk }),
      maxOutputTokens: 2048,
    });

    if (stream.signal.aborted) { stream.end(); return; }

    let parsed: any;
    try {
      const m = result.fullText.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { interpretation: command, response: result.fullText, category: "general", confidence: 50 };
    } catch {
      parsed = { interpretation: command, response: result.fullText, category: "general", confidence: 50 };
    }
    parsed.context = context;
    if (result.fullText && result.fullText.length > 10) setCached(cacheKey, result.fullText, AI_CACHE_TTL.SHORT);
    stream.send("done", { success: true, command, result: parsed, provider: result.provider, model: result.model });
    stream.end();
  } catch (err: any) {
    if (err instanceof StreamAbortedError) {
      stream.send("aborted", { partialText: err.partial.fullText, provider: err.partial.provider, model: err.partial.model });
      stream.end();
      return;
    }
    if (stream.signal.aborted || err?.message === "aborted") { stream.send("aborted", {}); stream.end(); return; }
    if (err instanceof AiQuotaExceededError) {
      stream.send("error", { error: err.message, quotaExceeded: true });
    } else {
      logger.error({ err }, "[Commandant/ExecuteCommand/stream]");
      stream.send("error", { error: err?.message || "Erreur lors de l'execution" });
    }
    stream.end();
  }
});

router.get("/commandant/weekly-digest", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);

    const [
      tasksCompleted, tasksCreated, tasksOverdue,
      callsTotal, callsMissed, callsAnswered,
      messagesReceived, messagesUnread,
      invoicesCreated, invoicesPaid, invoicesOverdue,
      newContacts, eventsHeld,
      prevCallsTotal, prevCallsMissed, prevTasksCompleted,
    ] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), gte(tasksTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), lt(tasksTable.dueDate, now))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), gte(messagesTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.isRead, false))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), gte(facturesClientTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), eq(facturesClientTable.status, "payee"), gte(facturesClientTable.updatedAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), ne(facturesClientTable.status, "payee"), ne(facturesClientTable.status, "brouillon"), lt(facturesClientTable.dueDate, now))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), gte(contactsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), gte(calendarEventsTable.startDate, weekAgo), lt(calendarEventsTable.startDate, now))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.status, "manque"), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, twoWeeksAgo), lt(tasksTable.updatedAt, weekAgo))).then(r => r[0]?.c ?? 0),
    ]);

    const agentInsights = await getLatestAgentInsights(orgId);
    let crossIssues: any[] = [];
    try {
      const collab = await import("./agent-collaboration");
      crossIssues = await collab.detectCrossAgentIssues(orgId);
    } catch (e) { logger.warn({ err: e }, "[Commandant/Digest] cross-agent issues detection failed:"); }

    const weekData = {
      taches: { terminees: tasksCompleted, creees: tasksCreated, enRetard: tasksOverdue, prevTerminees: prevTasksCompleted },
      appels: { total: callsTotal, manques: callsMissed, repondus: callsAnswered, tauxReponse: callsTotal > 0 ? Math.round((callsAnswered / callsTotal) * 100) : 0, prevTotal: prevCallsTotal, prevManques: prevCallsMissed },
      messages: { recus: messagesReceived, nonLus: messagesUnread },
      factures: { creees: invoicesCreated, payees: invoicesPaid, enRetard: invoicesOverdue },
      contacts: { nouveaux: newContacts },
      evenements: { tenus: eventsHeld },
    };

    const systemPrompt = `Tu es le Commandant IA d'Agent de Bureau. Genere un digest hebdomadaire complet pour le dirigeant. Sois strategique, concret et utilise les chiffres. Francais uniquement.`;
    const prompt = `Genere le digest hebdomadaire (${weekAgo.toLocaleDateString("fr-FR")} au ${now.toLocaleDateString("fr-FR")}):

DONNEES DE LA SEMAINE:
${JSON.stringify(weekData, null, 2)}

SCORES DES AGENTS IA:
${Object.entries(agentInsights).map(([id, i]) => `${id}: ${i.score}/100 - ${i.summary?.slice(0, 80)}`).join("\n") || "Aucun rapport"}

PROBLEMES TRANSVERSAUX: ${crossIssues.length > 0 ? crossIssues.map(i => `[${i.severity}] ${i.title}`).join(", ") : "Aucun"}

JSON attendu:
{
  "weekScore": 0-100,
  "headline": "titre accrocheur du digest",
  "executiveSummary": "resume executif en 3-5 phrases",
  "wins": ["reussites de la semaine"],
  "concerns": ["points de vigilance"],
  "weekOverWeekChanges": [{"metric": "nom", "current": 0, "previous": 0, "change": "+X%", "assessment": "bon/attention/critique"}],
  "topPriorities": ["3 priorites pour la semaine prochaine"],
  "agentHighlights": ["faits saillants des agents IA"],
  "outlook": "perspectives pour la semaine prochaine"
}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { headline: "Digest hebdomadaire", executiveSummary: aiResponse };
    } catch {
      parsed = { headline: "Digest hebdomadaire", executiveSummary: aiResponse };
    }

    res.json({
      success: true,
      period: { from: weekAgo.toISOString(), to: now.toISOString() },
      digest: parsed,
      rawData: weekData,
      agentScores: Object.entries(agentInsights).map(([id, i]) => ({ id, score: i.score, status: i.status })),
      crossIssues: crossIssues.length,
    });
  } catch (err: any) {
    logger.error({ err: err }, "[Commandant/WeeklyDigest]");
    res.status(500).json({ error: "Erreur lors de la generation du digest" });
  }
});

router.post("/commandant/weekly-digest/stream", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userId = req.session?.userId;

  const stream = openSseStream(res);
  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);

    const [
      tasksCompleted, tasksCreated, tasksOverdue,
      callsTotal, callsMissed, callsAnswered,
      messagesReceived, messagesUnread,
      invoicesCreated, invoicesPaid, invoicesOverdue,
      newContacts, eventsHeld,
      prevCallsTotal, prevCallsMissed, prevTasksCompleted,
    ] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), gte(tasksTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), lt(tasksTable.dueDate, now))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), gte(messagesTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.isRead, false))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), gte(facturesClientTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), eq(facturesClientTable.status, "payee"), gte(facturesClientTable.updatedAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), ne(facturesClientTable.status, "payee"), ne(facturesClientTable.status, "brouillon"), lt(facturesClientTable.dueDate, now))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), gte(contactsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), gte(calendarEventsTable.startDate, weekAgo), lt(calendarEventsTable.startDate, now))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.status, "manque"), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, twoWeeksAgo), lt(tasksTable.updatedAt, weekAgo))).then(r => r[0]?.c ?? 0),
    ]);

    const agentInsights = await getLatestAgentInsights(orgId);
    let crossIssues: any[] = [];
    try {
      const collab = await import("./agent-collaboration");
      crossIssues = await collab.detectCrossAgentIssues(orgId);
    } catch (e) { logger.warn({ err: e }, "[Commandant/Digest/stream] cross-agent issues detection failed:"); }

    const weekData = {
      taches: { terminees: tasksCompleted, creees: tasksCreated, enRetard: tasksOverdue, prevTerminees: prevTasksCompleted },
      appels: { total: callsTotal, manques: callsMissed, repondus: callsAnswered, tauxReponse: callsTotal > 0 ? Math.round((callsAnswered / callsTotal) * 100) : 0, prevTotal: prevCallsTotal, prevManques: prevCallsMissed },
      messages: { recus: messagesReceived, nonLus: messagesUnread },
      factures: { creees: invoicesCreated, payees: invoicesPaid, enRetard: invoicesOverdue },
      contacts: { nouveaux: newContacts },
      evenements: { tenus: eventsHeld },
    };

    const period = { from: weekAgo.toISOString(), to: now.toISOString() };
    const agentScores = Object.entries(agentInsights).map(([id, i]) => ({ id, score: i.score, status: i.status }));

    stream.send("metrics", { period, rawData: weekData, agentScores, crossIssues: crossIssues.length });

    // Bucket cache key by ISO day so repeated views within a day reuse the same digest.
    const dayBucket = now.toISOString().slice(0, 10);
    const cacheKey = buildAiCacheKey({
      route: "/commandant/weekly-digest",
      organisationId: orgId,
      userId,
      input: { day: dayBucket, weekData, agentScores, crossIssues: crossIssues.length },
    });
    const cached = getCached<string>(cacheKey);
    if (cached) {
      let parsed: any;
      try { const m = cached.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { headline: "Digest hebdomadaire", executiveSummary: cached }; }
      catch { parsed = { headline: "Digest hebdomadaire", executiveSummary: cached }; }
      stream.send("cached", { text: cached });
      stream.send("done", {
        success: true, period, digest: parsed, rawData: weekData, agentScores,
        crossIssues: crossIssues.length, cached: true,
      });
      stream.end();
      return;
    }

    const systemPrompt = `Tu es le Commandant IA d'Agent de Bureau. Genere un digest hebdomadaire complet pour le dirigeant. Sois strategique, concret et utilise les chiffres. Francais uniquement.`;
    const prompt = `Genere le digest hebdomadaire (${weekAgo.toLocaleDateString("fr-FR")} au ${now.toLocaleDateString("fr-FR")}):

DONNEES DE LA SEMAINE:
${JSON.stringify(weekData, null, 2)}

SCORES DES AGENTS IA:
${Object.entries(agentInsights).map(([id, i]) => `${id}: ${i.score}/100 - ${i.summary?.slice(0, 80)}`).join("\n") || "Aucun rapport"}

PROBLEMES TRANSVERSAUX: ${crossIssues.length > 0 ? crossIssues.map(i => `[${i.severity}] ${i.title}`).join(", ") : "Aucun"}

JSON attendu:
{
  "weekScore": 0-100,
  "headline": "titre accrocheur du digest",
  "executiveSummary": "resume executif en 3-5 phrases",
  "wins": ["reussites de la semaine"],
  "concerns": ["points de vigilance"],
  "weekOverWeekChanges": [{"metric": "nom", "current": 0, "previous": 0, "change": "+X%", "assessment": "bon/attention/critique"}],
  "topPriorities": ["3 priorites pour la semaine prochaine"],
  "agentHighlights": ["faits saillants des agents IA"],
  "outlook": "perspectives pour la semaine prochaine"
}`;

    const result = await multiAiGenerateStream({
      prompt, systemPrompt, organisationId: orgId, route: "/commandant/weekly-digest",
      signal: stream.signal,
      onToken: (chunk) => stream.send("token", { chunk }),
      maxOutputTokens: 3072,
    });

    if (stream.signal.aborted) { stream.end(); return; }

    let parsed: any;
    try {
      const m = result.fullText.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { headline: "Digest hebdomadaire", executiveSummary: result.fullText };
    } catch {
      parsed = { headline: "Digest hebdomadaire", executiveSummary: result.fullText };
    }
    if (result.fullText && result.fullText.length > 10) setCached(cacheKey, result.fullText, AI_CACHE_TTL.LONG);
    stream.send("done", {
      success: true, period, digest: parsed, rawData: weekData, agentScores,
      crossIssues: crossIssues.length, provider: result.provider, model: result.model,
    });
    stream.end();
  } catch (err: any) {
    if (err instanceof StreamAbortedError) {
      stream.send("aborted", { partialText: err.partial.fullText, provider: err.partial.provider, model: err.partial.model });
      stream.end();
      return;
    }
    if (stream.signal.aborted || err?.message === "aborted") { stream.send("aborted", {}); stream.end(); return; }
    if (err instanceof AiQuotaExceededError) {
      stream.send("error", { error: err.message, quotaExceeded: true });
    } else {
      logger.error({ err }, "[Commandant/WeeklyDigest/stream]");
      stream.send("error", { error: err?.message || "Erreur lors de la generation du digest" });
    }
    stream.end();
  }
});

router.get("/commandant/contact-health/:contactId", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const contactId = parseInt(String(req.params.contactId));
    if (isNaN(contactId)) { res.status(400).json({ error: "ID de contact invalide" }); return; }

    const [contact] = await db.select().from(contactsTable).where(and(eq(contactsTable.id, contactId), eq(contactsTable.organisationId, orgId)));
    if (!contact) { res.status(404).json({ error: "Contact introuvable" }); return; }

    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 86400000);
    const threeMonthsAgo = new Date(now.getTime() - 90 * 86400000);

    const [
      totalCalls, recentCalls, missedCalls, negativeCalls,
      openTasks, completedTasks, overdueTasks,
      unreadMessages, totalMessages,
      overdueInvoices, paidInvoices,
      upcomingEvents,
    ] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.contactId, contactId))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.contactId, contactId), gte(callsTable.createdAt, monthAgo))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.contactId, contactId), eq(callsTable.status, "manque"))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.contactId, contactId), or(eq(callsTable.sentiment, "negatif"), eq(callsTable.sentiment, "tres_negatif")))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.relatedContactId, contactId), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.relatedContactId, contactId), eq(tasksTable.status, "termine"))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.relatedContactId, contactId), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), lt(tasksTable.dueDate, now))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.contactId, contactId), eq(messagesTable.isRead, false))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.contactId, contactId))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), sql`${facturesClientTable.clientEmail} = ${contact.email}`, ne(facturesClientTable.status, "payee"), lt(facturesClientTable.dueDate, now))).then(r => r[0]?.c ?? 0).catch(() => 0),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), sql`${facturesClientTable.clientEmail} = ${contact.email}`, eq(facturesClientTable.status, "payee"))).then(r => r[0]?.c ?? 0).catch(() => 0),
      db.select({ c: sql<number>`count(*)::int` }).from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), eq(calendarEventsTable.relatedContactId, contactId), gte(calendarEventsTable.startDate, now))).then(r => r[0]?.c ?? 0).catch(() => 0),
    ]);

    let healthScore = 50;
    const factors: { factor: string; impact: number; detail: string }[] = [];

    if (recentCalls > 0) { healthScore += 10; factors.push({ factor: "activite_recente", impact: 10, detail: `${recentCalls} appels ce mois` }); }
    if (recentCalls === 0 && totalCalls > 0) { healthScore -= 10; factors.push({ factor: "inactivite", impact: -10, detail: "Aucun appel ce mois malgre un historique" }); }
    if (negativeCalls > totalCalls * 0.3 && totalCalls > 0) { healthScore -= 15; factors.push({ factor: "sentiment_negatif", impact: -15, detail: `${negativeCalls}/${totalCalls} appels negatifs` }); }
    if (overdueTasks > 0) { healthScore -= Math.min(overdueTasks * 5, 20); factors.push({ factor: "taches_retard", impact: -Math.min(overdueTasks * 5, 20), detail: `${overdueTasks} taches en retard` }); }
    if (completedTasks > 3) { healthScore += 10; factors.push({ factor: "taches_completees", impact: 10, detail: `${completedTasks} taches realisees` }); }
    if (overdueInvoices > 0) { healthScore -= 20; factors.push({ factor: "factures_impayees", impact: -20, detail: `${overdueInvoices} factures en retard` }); }
    if (paidInvoices > 0) { healthScore += 10; factors.push({ factor: "bon_payeur", impact: 10, detail: `${paidInvoices} factures payees` }); }
    if (unreadMessages > 3) { healthScore -= 10; factors.push({ factor: "messages_ignores", impact: -10, detail: `${unreadMessages} messages non lus` }); }
    if (upcomingEvents > 0) { healthScore += 5; factors.push({ factor: "engagement_futur", impact: 5, detail: `${upcomingEvents} evenements a venir` }); }
    if (contact.email && contact.phone) { healthScore += 5; factors.push({ factor: "fiche_complete", impact: 5, detail: "Email et telephone renseignes" }); }
    if (!contact.email || !contact.phone) { healthScore -= 5; factors.push({ factor: "fiche_incomplete", impact: -5, detail: `${!contact.email ? "Email manquant" : "Telephone manquant"}` }); }

    healthScore = Math.max(0, Math.min(100, healthScore));

    const status = healthScore >= 75 ? "excellent" : healthScore >= 55 ? "bon" : healthScore >= 35 ? "attention" : "critique";

    const risks: string[] = [];
    if (overdueInvoices > 0) risks.push("Factures impayees — risque de perte de revenu");
    if (negativeCalls > 2) risks.push("Historique d'appels negatifs — risque de churn");
    if (recentCalls === 0 && totalCalls > 3) risks.push("Contact inactif — risque de desengagement");
    if (overdueTasks > 2) risks.push("Taches accumulees — risque de mecontentement");

    const opportunities: string[] = [];
    if (completedTasks > 5) opportunities.push("Contact actif — potentiel d'upsell");
    if (paidInvoices > 3 && overdueInvoices === 0) opportunities.push("Bon payeur — offrir des conditions privilegiees");
    if (recentCalls > 3) opportunities.push("Engagement eleve — proposer un suivi personnalise");

    res.json({
      success: true,
      contact: { id: contact.id, name: `${contact.firstName} ${contact.lastName}`, company: contact.company, category: contact.category, email: contact.email, phone: contact.phone },
      healthScore,
      status,
      factors,
      metrics: {
        calls: { total: totalCalls, recent: recentCalls, missed: missedCalls, negative: negativeCalls },
        tasks: { open: openTasks, completed: completedTasks, overdue: overdueTasks },
        messages: { total: totalMessages, unread: unreadMessages },
        invoices: { overdue: overdueInvoices, paid: paidInvoices },
        events: { upcoming: upcomingEvents },
      },
      risks,
      opportunities,
    });
  } catch (err: any) {
    logger.error({ err: err }, "[Commandant/ContactHealth]");
    res.status(500).json({ error: "Erreur lors du calcul de la sante du contact" });
  }
});

// ═══════════════════════════════════════════════════════
// GMAIL AJAN — OTOMATIK TRİAJ
// ═══════════════════════════════════════════════════════
router.post("/commandant/gmail-triage", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      res.status(400).json({ error: "Liste d'emails requise" }); return;
    }

    const [org, agentInsights] = await Promise.all([
      db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId)),
      getLatestAgentInsights(orgId, ["agent_contacts", "agent_facturation", "agent_messages", "agent_taches"]),
    ]);

    const collabPrompt = buildCommandantContextPrompt(agentInsights, {});

    const systemPrompt = `Tu es un assistant IA expert en gestion de messagerie pour "${org[0]?.name || "Agent de Bureau"}". Tu analyses les emails et fournis un triage intelligent et actionnable. Tu connais le contexte metier grace aux rapports des agents IA specialises.

${collabPrompt}

Ta mission: trier, prioriser et identifier les actions a realiser pour chaque email. Sois concis et actionnable.`;

    const emailList = emails.slice(0, 30).map((e: any, i: number) =>
      `[${i + 1}] ID:${e.id || i} | De: ${e.from} | Objet: ${e.subject} | Date: ${e.date} | Non-lu: ${e.unread ? "Oui" : "Non"} | Extrait: ${(e.snippet || "").slice(0, 200)}`
    ).join("\n");

    const prompt = `Analyse et trie ces ${emails.length} emails:

${emailList}

Reponds UNIQUEMENT en JSON valide:
{
  "triage": [
    {
      "emailId": "id",
      "priority": "critique|haute|normale|basse",
      "category": "commercial|client|finance|administratif|spam|information|urgence",
      "needsReply": true,
      "replyDeadline": "maintenant|aujourd_hui|cette_semaine|aucune",
      "summary": "Resume en 1 phrase courte",
      "suggestedAction": "Action concrete a realiser",
      "sentiment": "positif|neutre|negatif|urgent",
      "tags": ["tag1"]
    }
  ],
  "overview": {
    "criticalCount": 0,
    "needsReplyCount": 0,
    "commercialOpportunities": 0,
    "financialItems": 0
  },
  "priorityActions": ["Action 1", "Action 2"],
  "executiveSummary": "Resume executif en 2-3 phrases"
}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { executiveSummary: aiResponse, triage: [], overview: {}, priorityActions: [] };
    } catch {
      parsed = { executiveSummary: aiResponse, triage: [], overview: {}, priorityActions: [] };
    }

    res.json({ success: true, triage: parsed });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/GmailTriage]");
  }
});

// ═══════════════════════════════════════════════════════
// GMAIL AJAN — AKILLI YANIT TASLAGI
// ═══════════════════════════════════════════════════════
router.post("/commandant/gmail-draft-reply", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { from, subject, bodyHtml, bodyPlain, snippet, tone = "professionnel", instructions } = req.body;

    if (!from || !subject) {
      res.status(400).json({ error: "from et subject requis" }); return;
    }

    const senderEmail = from.match(/<(.+?)>/)?.[1] || from;

    const [collabContext, agentInsights, org] = await Promise.all([
      getContextForContact(orgId, undefined, undefined, senderEmail),
      getLatestAgentInsights(orgId, ["agent_contacts", "agent_facturation", "agent_messages", "agent_taches"]),
      db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId)),
    ]);

    const collabPrompt = buildCommandantContextPrompt(agentInsights, collabContext);

    let contactInfo = "";
    if (collabContext.contact) {
      const c = collabContext.contact;
      contactInfo = `\nCONTACT CRM IDENTIFIE: ${c.firstName} ${c.lastName} | Entreprise: ${c.company || "N/A"} | ${c.totalCalls || 0} appels passes`;
      if (collabContext.contactActivity?.openTasks?.length > 0) {
        contactInfo += `\nTaches en cours: ${collabContext.contactActivity.openTasks.slice(0, 3).map((t: any) => t.title).join(", ")}`;
      }
      if (collabContext.contactActivity?.overdueInvoices?.length > 0) {
        contactInfo += `\n⚠ FACTURES IMPAYEES: ${collabContext.contactActivity.overdueInvoices.map((i: any) => `${i.reference} ${i.amount}€`).join(", ")}`;
      }
      if (collabContext.contactActivity?.projets?.length > 0) {
        contactInfo += `\nProjets: ${collabContext.contactActivity.projets.map((p: any) => `${p.title} [${p.status}]`).join(", ")}`;
      }
    }

    const systemPrompt = `Tu es l'assistant email IA de "${org[0]?.name || "Agent de Bureau"}". Tu rediges des reponses email professionnelles, precises et efficaces. Tu utilises le contexte CRM et les rapports des agents pour personnaliser chaque reponse.

Regles:
- Redige en francais sauf si l'email original est dans une autre langue
- Adapte le ton selon la demande
- Sois concis et actionnable
- Signe toujours au nom de l'entreprise

${collabPrompt}`;

    const emailContent = bodyPlain || snippet || "(Contenu non disponible)";
    const prompt = `Redige une reponse professionnelle a cet email:

De: ${from}
Objet: ${subject}
Contenu: ${emailContent.slice(0, 4000)}
${contactInfo}

Ton souhaite: ${tone}
${instructions ? `Instructions specifiques: ${instructions}` : ""}

Reponds UNIQUEMENT en JSON valide:
{
  "replySubject": "Re: ${subject}",
  "replyBodyHtml": "<p>Corps HTML de la reponse...</p>",
  "replyBodyPlain": "Corps en texte brut...",
  "tone": "ton utilise",
  "detectedIntent": "intention de l'email (demande_info|plainte|commande|suivi|rdv|devis|remerciement|commercial)",
  "urgency": "basse|moyenne|haute",
  "suggestedActions": ["action post-envoi 1", "action post-envoi 2"],
  "alternativeReplies": [
    {"label": "Version plus formelle", "bodyHtml": "<p>...</p>"},
    {"label": "Version plus courte", "bodyHtml": "<p>...</p>"}
  ],
  "extractedData": {"dates": [], "amounts": [], "names": []},
  "crmSuggestion": {"suggestContact": false, "suggestTask": false, "taskDescription": ""}
}`;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let parsed: any;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { replyBodyHtml: aiResponse, replySubject: `Re: ${subject}` };
    } catch {
      parsed = { replyBodyHtml: aiResponse, replySubject: `Re: ${subject}` };
    }

    res.json({ success: true, draft: parsed, contactFound: !!collabContext.contact });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/GmailDraftReply]");
  }
});

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE QUALITY & EFFICIENCY DEEP ANALYSIS
// ═══════════════════════════════════════════════════════════════

router.get("/commandant/employee-quality", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const periode = (req.query.periode as string) || "mois";
    const now = new Date();
    let dateDebut: Date;
    if (periode === "semaine") { dateDebut = new Date(now.getTime() - 7 * 86400000); }
    else if (periode === "trimestre") { dateDebut = new Date(now.getTime() - 90 * 86400000); }
    else { dateDebut = new Date(now.getTime() - 30 * 86400000); } // mois

    const users = await db.select({
      id: usersTable.id, prenom: usersTable.prenom, nom: usersTable.nom,
      email: usersTable.email, role: usersTable.role, departement: usersTable.departement,
    }).from(usersTable).where(and(eq(usersTable.actif, true), eq(usersTable.organisationId, orgId)));

    const employees: any[] = [];

    for (const user of users) {
      const fullName = `${user.prenom ?? ""} ${user.nom ?? ""}`.trim();
      const email = user.email ?? "";

      // ── TÂCHES ────────────────────────────────────────────────
      const [tasksAssigned] = await db.select({ c: sql<number>`count(*)::int` }).from(tasksTable)
        .where(and(eq(tasksTable.organisationId, orgId), sql`${tasksTable.assignedTo} ILIKE ${"%" + fullName + "%"}`, gte(tasksTable.createdAt, dateDebut)));

      const [tasksCompleted] = await db.select({ c: sql<number>`count(*)::int` }).from(tasksTable)
        .where(and(eq(tasksTable.organisationId, orgId), sql`${tasksTable.assignedTo} ILIKE ${"%" + fullName + "%"}`, or(eq(tasksTable.status, "termine"), eq(tasksTable.status, "terminee")), gte(tasksTable.updatedAt, dateDebut)));

      const [tasksOverdue] = await db.select({ c: sql<number>`count(*)::int` }).from(tasksTable)
        .where(and(eq(tasksTable.organisationId, orgId), sql`${tasksTable.assignedTo} ILIKE ${"%" + fullName + "%"}`, ne(tasksTable.status, "termine"), ne(tasksTable.status, "terminee"), ne(tasksTable.status, "annule"), lt(tasksTable.dueDate, now)));

      const [tasksPriHaute] = await db.select({ c: sql<number>`count(*)::int` }).from(tasksTable)
        .where(and(eq(tasksTable.organisationId, orgId), sql`${tasksTable.assignedTo} ILIKE ${"%" + fullName + "%"}`, eq(tasksTable.priority, "haute"), or(eq(tasksTable.status, "termine"), eq(tasksTable.status, "terminee")), gte(tasksTable.updatedAt, dateDebut)));

      // ── POINTAGES ─────────────────────────────────────────────
      const pointagesData = await db.select({
        totalMinutes: checkinsTable.totalMinutes, breakMinutes: checkinsTable.breakMinutes, checkInAt: checkinsTable.checkInAt,
      }).from(checkinsTable).where(and(
        eq(checkinsTable.organisationId, orgId),
        sql`${checkinsTable.employeeName} ILIKE ${"%" + fullName + "%"}`,
        gte(checkinsTable.checkInAt, dateDebut),
      ));

      const heuresTravaillees = Math.round(pointagesData.reduce((s, p) => s + (p.totalMinutes ?? 0), 0) / 60 * 10) / 10;
      const pausesMinutes = pointagesData.reduce((s, p) => s + (p.breakMinutes ?? 0), 0);
      const sessionCount = pointagesData.length;

      // Punctuality: average check-in hour vs 9h
      let avgCheckinHour: number | null = null;
      if (pointagesData.length > 0) {
        const hours = pointagesData.map(p => p.checkInAt ? new Date(p.checkInAt).getHours() + new Date(p.checkInAt).getMinutes() / 60 : 9);
        avgCheckinHour = Math.round(hours.reduce((s, h) => s + h, 0) / hours.length * 10) / 10;
      }

      // ── ACTIONS / CONNEXIONS ────────────────────────────────
      const [actionsTotal] = await db.select({ c: sql<number>`count(*)::int` }).from(auditLogsTable)
        .where(and(eq(auditLogsTable.userId, user.id), gte(auditLogsTable.createdAt, dateDebut)));

      const [connexions] = await db.select({ c: sql<number>`count(*)::int` }).from(auditLogsTable)
        .where(and(eq(auditLogsTable.userId, user.id), eq(auditLogsTable.action, "login"), gte(auditLogsTable.createdAt, dateDebut)));

      const [messagesEnvoyes] = await db.select({ c: sql<number>`count(*)::int` }).from(auditLogsTable)
        .where(and(eq(auditLogsTable.userId, user.id), eq(auditLogsTable.action, "create"), eq(auditLogsTable.resource, "message"), gte(auditLogsTable.createdAt, dateDebut)));

      const [appelsTraites] = await db.select({ c: sql<number>`count(*)::int` }).from(auditLogsTable)
        .where(and(eq(auditLogsTable.userId, user.id), eq(auditLogsTable.action, "create"), eq(auditLogsTable.resource, "call"), gte(auditLogsTable.createdAt, dateDebut)));

      const [contactsCrees] = await db.select({ c: sql<number>`count(*)::int` }).from(auditLogsTable)
        .where(and(eq(auditLogsTable.userId, user.id), eq(auditLogsTable.action, "create"), eq(auditLogsTable.resource, "contact"), gte(auditLogsTable.createdAt, dateDebut)));

      // ── SCORES ─────────────────────────────────────────────────
      const ta = tasksAssigned?.c ?? 0;
      const tc = tasksCompleted?.c ?? 0;
      const to = tasksOverdue?.c ?? 0;

      // Completion rate: tasks completed / tasks assigned (min 0, max 100)
      const completionRate = ta > 0 ? Math.min(100, Math.round((tc / ta) * 100)) : (tc > 0 ? 100 : 50);

      // Overdue penalty: overdues relative to assigned
      const overduePenalty = ta > 0 ? Math.min(50, Math.round((to / ta) * 50)) : 0;

      // Punctuality score: 100 if on time (≤9.25h), -10 per 30 min late, +5 if early
      let punctualityScore = 70; // default if no pointages
      if (avgCheckinHour !== null) {
        const lateMins = Math.max(0, (avgCheckinHour - 9.25) * 60);
        const earlyBonus = Math.max(0, (9.0 - avgCheckinHour) * 10);
        punctualityScore = Math.min(100, Math.max(0, Math.round(100 - lateMins / 3 + earlyBonus)));
      }

      // Activity score: actions per working day
      const workingDays = Math.max(1, Math.round((now.getTime() - dateDebut.getTime()) / 86400000 * 5 / 7));
      const actionsPerDay = (actionsTotal?.c ?? 0) / workingDays;
      const activityScore = Math.min(100, Math.round(actionsPerDay * 2.5));

      // Engagement score: connexions regularity
      const expectedConnexions = Math.max(1, Math.round(workingDays * 0.8));
      const engagementScore = Math.min(100, Math.round(((connexions?.c ?? 0) / expectedConnexions) * 100));

      // Quality score = completion(40%) + punctuality(25%) + engagement(20%) - overdue(15%)
      const qualityScore = Math.min(100, Math.max(0, Math.round(
        completionRate * 0.40 + punctualityScore * 0.25 + engagementScore * 0.20 - overduePenalty * 0.15
      )));

      // Efficiency score = output per hour
      const totalOutput = tc * 10 + (appelsTraites?.c ?? 0) * 5 + (messagesEnvoyes?.c ?? 0) * 2 + (contactsCrees?.c ?? 0) * 8;
      const efficiencyScore = heuresTravaillees > 0
        ? Math.min(100, Math.round(totalOutput / heuresTravaillees * 2))
        : Math.min(100, Math.round(totalOutput / 10));

      const overallScore = Math.round(qualityScore * 0.55 + efficiencyScore * 0.45);

      const grade = overallScore >= 85 ? "A" : overallScore >= 70 ? "B" : overallScore >= 55 ? "C" : overallScore >= 40 ? "D" : "F";
      const risk = to >= 5 || overallScore < 40 ? "high" : to >= 2 || overallScore < 60 ? "medium" : "low";

      employees.push({
        id: user.id, name: fullName, email, role: user.role, department: user.departement,
        qualityScore, efficiencyScore, overallScore, grade, risk,
        metrics: {
          tasksAssigned: ta, tasksCompleted: tc, tasksOverdue: to,
          tasksPrioriteHaute: tasksPriHaute?.c ?? 0,
          completionRate, overduePenalty, punctualityScore, activityScore, engagementScore,
          heuresTravaillees, pausesMinutes, sessionCount,
          avgCheckinHour, actionsTotal: actionsTotal?.c ?? 0,
          connexions: connexions?.c ?? 0, messagesEnvoyes: messagesEnvoyes?.c ?? 0,
          appelsTraites: appelsTraites?.c ?? 0, contactsCrees: contactsCrees?.c ?? 0,
        },
      });
    }

    // Sort by overallScore desc
    employees.sort((a, b) => b.overallScore - a.overallScore);

    const teamScore = employees.length > 0 ? Math.round(employees.reduce((s, e) => s + e.overallScore, 0) / employees.length) : 0;
    const teamQuality = employees.length > 0 ? Math.round(employees.reduce((s, e) => s + e.qualityScore, 0) / employees.length) : 0;
    const teamEfficiency = employees.length > 0 ? Math.round(employees.reduce((s, e) => s + e.efficiencyScore, 0) / employees.length) : 0;

    // ── AI ANALYSIS ──────────────────────────────────────────────
    const systemPrompt = `Tu es un expert RH senior spécialisé en performance et qualité de travail. Tu analyses des données objectives et génères des insights actionnables. Sois direct, précis et bienveillant. Réponds UNIQUEMENT en JSON valide.`;
    const prompt = `Analyse de ${employees.length} employés sur la période (${periode}):

${employees.map(e => `${e.name} (${e.role}${e.department ? ", " + e.department : ""}): score global ${e.overallScore}/100 (qualité: ${e.qualityScore}, efficacité: ${e.efficiencyScore}), grade ${e.grade}, risque ${e.risk}
  → tâches: ${e.metrics.tasksCompleted}/${e.metrics.tasksAssigned} terminées, ${e.metrics.tasksOverdue} en retard (taux: ${e.metrics.completionRate}%)
  → présence: ${e.metrics.heuresTravaillees}h travaillées, ${e.metrics.sessionCount} sessions
  → activité: ${e.metrics.actionsTotal} actions, ${e.metrics.appelsTraites} appels, ${e.metrics.messagesEnvoyes} messages`).join("\n")}

Score équipe: ${teamScore}/100 (qualité: ${teamQuality}, efficacité: ${teamEfficiency})

Génère un rapport JSON complet:
{
  "globalInsight": "analyse synthétique de l'équipe en 2-3 phrases",
  "teamHealth": "excellent|bon|moyen|préoccupant",
  "topPerformers": [{"name": "nom", "score": 85, "strengths": ["point fort 1", "point fort 2"], "recognitionMessage": "message d'encouragement personnalisé"}],
  "needsAttention": [{"name": "nom", "score": 45, "issues": ["problème détecté"], "rootCause": "analyse cause probable", "actionPlan": ["action concrète 1", "action concrète 2"]}],
  "perEmployee": [{"name": "nom", "strengths": ["2-3 points forts"], "weaknesses": ["1-2 axes d'amélioration"], "tip": "conseil pratique personnalisé", "riskFlag": "motif si risque élevé ou null"}],
  "teamRecommendations": ["recommandation stratégique 1", "recommandation 2", "recommandation 3"],
  "workloadBalance": "analyse de la répartition de charge",
  "qualityAlert": "alerte qualité si score < 60 ou null"
}`;

    await assertAiQuota(orgId);
    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);
    let analysis: any = {};
    try {
      const m = aiResponse.match(/\{[\s\S]*\}/);
      analysis = m ? JSON.parse(m[0]) : { globalInsight: aiResponse };
    } catch { analysis = { globalInsight: aiResponse }; }

    res.json({ success: true, periode, teamScore, teamQuality, teamEfficiency, employees, analysis });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/EmployeeQuality]");
  }
});

// ═══════════════════════════════════════════════════════
// CONVERSATIONS (Chat persistant avec historique)
// ═══════════════════════════════════════════════════════

const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_CHARS = 12000;

function getUserId(req: Request): number | null {
  const u = req.session?.userId;
  return typeof u === "number" ? u : null;
}

async function ensureConversationOwnership(orgId: number, userId: number, conversationId: number) {
  const [conv] = await db.select().from(commandantConversationsTable)
    .where(and(
      eq(commandantConversationsTable.id, conversationId),
      eq(commandantConversationsTable.organisationId, orgId),
      eq(commandantConversationsTable.userId, userId),
    ));
  return conv || null;
}

router.get("/commandant/conversations", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }
    const rows = await db.select().from(commandantConversationsTable)
      .where(and(
        eq(commandantConversationsTable.organisationId, orgId),
        eq(commandantConversationsTable.userId, userId),
      ))
      .orderBy(desc(commandantConversationsTable.updatedAt))
      .limit(100);
    res.json({ success: true, conversations: rows });
  } catch (err: any) {
    logger.error({ err }, "[Commandant/Conv/List]");
    res.status(500).json({ error: "Erreur interne" });
  }
});

router.get("/commandant/conversations/search", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }
    const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (qRaw.length < 1) { res.json({ success: true, results: [] }); return; }
    const q = qRaw.slice(0, 200);
    // Accent-insensitive substring match: strip diacritics from the user's
    // query and (when available) wrap the column in unaccent() so "impayé"
    // matches stored "impayée". Stemming is intentionally NOT applied here so
    // free-text history search keeps its substring semantics.
    const useUnaccent = await ensureUnaccentExtension();
    const qNorm = stripAccents(q);
    const pattern = `%${qNorm.replace(/[\\%_]/g, m => `\\${m}`)}%`;

    const titleMatches = await db.select({
      id: commandantConversationsTable.id,
      title: commandantConversationsTable.title,
      updatedAt: commandantConversationsTable.updatedAt,
    }).from(commandantConversationsTable)
      .where(and(
        eq(commandantConversationsTable.organisationId, orgId),
        eq(commandantConversationsTable.userId, userId),
        accentInsensitiveIlike(commandantConversationsTable.title, pattern, useUnaccent),
      ))
      .orderBy(desc(commandantConversationsTable.updatedAt))
      .limit(50);

    const messageMatches = await db.select({
      conversationId: commandantMessagesTable.conversationId,
      messageId: commandantMessagesTable.id,
      role: commandantMessagesTable.role,
      content: commandantMessagesTable.content,
      messageCreatedAt: commandantMessagesTable.createdAt,
      title: commandantConversationsTable.title,
      updatedAt: commandantConversationsTable.updatedAt,
    }).from(commandantMessagesTable)
      .innerJoin(commandantConversationsTable, eq(commandantMessagesTable.conversationId, commandantConversationsTable.id))
      .where(and(
        eq(commandantMessagesTable.organisationId, orgId),
        eq(commandantConversationsTable.organisationId, orgId),
        eq(commandantConversationsTable.userId, userId),
        accentInsensitiveIlike(commandantMessagesTable.content, pattern, useUnaccent),
      ))
      .orderBy(desc(commandantMessagesTable.createdAt))
      .limit(100);

    const byConv = new Map<number, any>();
    for (const t of titleMatches) {
      byConv.set(t.id, {
        conversationId: t.id,
        title: t.title,
        updatedAt: t.updatedAt,
        matchType: "title" as const,
        snippet: null as string | null,
      });
    }
    for (const m of messageMatches) {
      const existing = byConv.get(m.conversationId);
      if (existing && existing.snippet) continue;
      // Search the snippet position using the same accent-stripped form so we
      // can locate matches even when the stored content carries diacritics
      // that the user's query did not.
      const haystack = stripAccents(m.content).toLowerCase();
      const needle = qNorm.toLowerCase();
      const idx = needle ? haystack.indexOf(needle) : -1;
      const anchor = idx >= 0 ? idx : 0;
      const start = Math.max(0, anchor - 40);
      const end = Math.min(m.content.length, anchor + (needle.length || 0) + 80);
      const snippet = (start > 0 ? "..." : "") + m.content.slice(start, end) + (end < m.content.length ? "..." : "");
      if (existing) {
        existing.snippet = snippet;
        existing.matchType = existing.matchType === "title" ? "title+message" : "message";
        existing.role = m.role;
        existing.messageId = m.messageId;
      } else {
        byConv.set(m.conversationId, {
          conversationId: m.conversationId,
          title: m.title,
          updatedAt: m.updatedAt,
          matchType: "message" as const,
          snippet,
          role: m.role,
          messageId: m.messageId,
        });
      }
    }

    const results = Array.from(byConv.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 50);
    res.json({ success: true, results });
  } catch (err: any) {
    logger.error({ err }, "[Commandant/Conv/Search]");
    res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/commandant/conversations", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }
    const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim().slice(0, 200) : "Nouvelle conversation";
    const [conv] = await db.insert(commandantConversationsTable)
      .values({ organisationId: orgId, userId, title })
      .returning();
    res.json({ success: true, conversation: conv });
  } catch (err: any) {
    logger.error({ err }, "[Commandant/Conv/Create]");
    res.status(500).json({ error: "Erreur interne" });
  }
});

router.get("/commandant/conversations/:id/messages", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
    const conv = await ensureConversationOwnership(orgId, userId, id);
    if (!conv) { res.status(404).json({ error: "Conversation introuvable" }); return; }
    const msgs = await db.select().from(commandantMessagesTable)
      .where(and(
        eq(commandantMessagesTable.conversationId, id),
        eq(commandantMessagesTable.organisationId, orgId),
      ))
      .orderBy(asc(commandantMessagesTable.createdAt));
    res.json({ success: true, conversation: conv, messages: msgs });
  } catch (err: any) {
    logger.error({ err }, "[Commandant/Conv/Messages]");
    res.status(500).json({ error: "Erreur interne" });
  }
});

router.patch("/commandant/conversations/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
    const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : "";
    if (!title) { res.status(400).json({ error: "Titre requis" }); return; }
    const conv = await ensureConversationOwnership(orgId, userId, id);
    if (!conv) { res.status(404).json({ error: "Conversation introuvable" }); return; }
    const [updated] = await db.update(commandantConversationsTable)
      .set({ title })
      .where(and(
        eq(commandantConversationsTable.id, id),
        eq(commandantConversationsTable.organisationId, orgId),
        eq(commandantConversationsTable.userId, userId),
      ))
      .returning();
    res.json({ success: true, conversation: updated });
  } catch (err: any) {
    logger.error({ err }, "[Commandant/Conv/Rename]");
    res.status(500).json({ error: "Erreur interne" });
  }
});

router.delete("/commandant/conversations/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
    const conv = await ensureConversationOwnership(orgId, userId, id);
    if (!conv) { res.status(404).json({ error: "Conversation introuvable" }); return; }
    await db.delete(commandantConversationsTable)
      .where(and(
        eq(commandantConversationsTable.id, id),
        eq(commandantConversationsTable.organisationId, orgId),
        eq(commandantConversationsTable.userId, userId),
      ));
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "[Commandant/Conv/Delete]");
    res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/commandant/conversations/:id/messages", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
    const userMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!userMessage || userMessage.length < 1) { res.status(400).json({ error: "Message requis" }); return; }
    if (userMessage.length > 8000) { res.status(400).json({ error: "Message trop long (max 8000 caracteres)" }); return; }

    const conv = await ensureConversationOwnership(orgId, userId, id);
    if (!conv) { res.status(404).json({ error: "Conversation introuvable" }); return; }

    // Save user message
    const [savedUser] = await db.insert(commandantMessagesTable)
      .values({ conversationId: id, organisationId: orgId, role: "user", content: userMessage })
      .returning();

    // Build history with token-budget guard: take last N messages, drop from oldest if over budget
    const recent = await db.select().from(commandantMessagesTable)
      .where(and(
        eq(commandantMessagesTable.conversationId, id),
        eq(commandantMessagesTable.organisationId, orgId),
      ))
      .orderBy(desc(commandantMessagesTable.createdAt))
      .limit(MAX_HISTORY_MESSAGES + 1); // include the just-saved user msg

    // recent is desc; reverse to chronological, then trim from the oldest end if over char budget
    let history = recent.slice().reverse();
    let totalChars = history.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    while (history.length > 2 && totalChars > MAX_HISTORY_CHARS) {
      const dropped = history.shift();
      totalChars -= (dropped?.content?.length || 0);
    }

    // Lightweight org context (reuse cheap counts only — keep latency low)
    const now = new Date();
    const [taskCount, overdueCount, unreadMsgs, overdueInvoiceCount] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), ne(tasksTable.status, "termine"))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), lt(tasksTable.dueDate, now))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.isRead, false))).then(r => r[0]?.c ?? 0),
      db.select({ c: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), ne(facturesClientTable.status, "payee"), ne(facturesClientTable.status, "brouillon"), lt(facturesClientTable.dueDate, now))).then(r => r[0]?.c ?? 0),
    ]);

    // Lightweight retrieval: keyword search across core entities (tenant-isolated)
    // Reuses the same approach as /commandant/smart-search to ground replies in real data.
    const retrieved = await retrieveRelevantDataForChat(orgId, userMessage);
    const retrievedDataSection = retrieved.context;

    const systemPrompt = `Tu es le Commandant IA d'Agent de Bureau, un assistant conversationnel pour un dirigeant francais.
Tu reponds de maniere claire, concise et actionnable, TOUJOURS en francais.
Tu te souviens de la conversation precedente et tu fais reference aux echanges anterieurs quand c'est pertinent.
Quand des DONNEES PERTINENTES sont fournies, appuie-toi dessus et cite des references concretes (noms, numeros de facture, dates) plutot que d'inventer.
Tu ne renvoies PAS de JSON: tu ecris une reponse en texte naturel (markdown leger autorise).

CONTEXTE BUREAU (instantane):
- Taches ouvertes: ${taskCount} (${overdueCount} en retard)
- Messages non lus: ${unreadMsgs}
- Factures en retard: ${overdueInvoiceCount}${retrievedDataSection ? `\n\n${retrievedDataSection}` : ""}`;

    // Format the prior conversation as a transcript prepended to the new user message.
    const transcript = history
      .slice(0, -1) // exclude the brand-new user message (we'll send it as the prompt)
      .map(m => `${m.role === "user" ? "Utilisateur" : "Commandant"}: ${m.content}`)
      .join("\n\n");

    const prompt = transcript
      ? `Conversation precedente:\n${transcript}\n\nNouvelle question de l'utilisateur:\n${userMessage}`
      : userMessage;

    const aiResponse = await multiAiGenerate(prompt, systemPrompt, orgId, req.path);

    const assistantMetadata = retrieved.entities.length > 0 ? { retrievedEntities: retrieved.entities } : null;
    const [savedAssistant] = await db.insert(commandantMessagesTable)
      .values({ conversationId: id, organisationId: orgId, role: "assistant", content: aiResponse, metadata: assistantMetadata })
      .returning();

    // Bump conversation updatedAt + auto-title from first user message if still default
    let updatedConv = conv;
    if (conv.title === "Nouvelle conversation") {
      const autoTitle = userMessage.replace(/\s+/g, " ").trim().slice(0, 60);
      const [u] = await db.update(commandantConversationsTable)
        .set({ title: autoTitle || "Nouvelle conversation", updatedAt: new Date() })
        .where(and(
          eq(commandantConversationsTable.id, id),
          eq(commandantConversationsTable.organisationId, orgId),
          eq(commandantConversationsTable.userId, userId),
        ))
        .returning();
      if (u) updatedConv = u;
    } else {
      const [u] = await db.update(commandantConversationsTable)
        .set({ updatedAt: new Date() })
        .where(and(
          eq(commandantConversationsTable.id, id),
          eq(commandantConversationsTable.organisationId, orgId),
          eq(commandantConversationsTable.userId, userId),
        ))
        .returning();
      if (u) updatedConv = u;
    }

    res.json({
      success: true,
      conversation: updatedConv,
      userMessage: savedUser,
      assistantMessage: savedAssistant,
    });
  } catch (err: any) {
    handleCommandantError(err, res, "[Commandant/Conv/Send]");
  }
});

export default router;

