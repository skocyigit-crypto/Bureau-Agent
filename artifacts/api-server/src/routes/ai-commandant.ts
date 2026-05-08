import { Router, type Request, type Response } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, calendarEventsTable, facturesClientTable, compteClientTable, organisationsTable, prospectsTable, notificationsTable, paymentRemindersTable, licenseAuditLogTable, projetsTable, usersTable, checkinsTable, auditLogsTable } from "@workspace/db";
import { eq, sql, and, desc, gte, lte, lt, ne, isNull, isNotNull, or, ilike, count } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { Resend } from "resend";
import { getContextForContact, getLatestAgentInsights, buildCommandantContextPrompt } from "./agent-collaboration";
import { safeJsonParse, extractGeminiTokens, extractOpenAITokens, extractAnthropicTokens, recordAiUsage, sanitizePromptInput } from "../services/ai-utils";
import { assertAiQuota, invalidateQuotaCache, AiQuotaExceededError } from "../services/ai-quota";
import { getOrCompute, buildAiCacheKey, withProviderTimeout, AI_CACHE_TTL } from "../services/ai-cache";
import { logger } from "../lib/logger";

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
      model: "gemini-2.5-pro",
      contents: safeSystem ? [{ role: "user", parts: [{ text: safeSystem + "\n\n" + safePrompt }] }] : safePrompt,
    }), { timeoutMs: 25_000, label: "gemini" });
    const text = typeof r === "object" && r !== null && "text" in r ? String(r.text) : String(r);
    if (text && text.length > 10) {
      if (orgId) {
        const tokens = extractGeminiTokens(r);
        recordAiUsage({ organisationId: orgId, provider: "gemini", model: "gemini-2.5-pro", route: route || "/commandant", inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0 }).catch(() => {});
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

function escapeHtml(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

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

async function sendEmailViaResend(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) { logger.info(`[Commandant/Email] Pas de cle Resend. Email pour ${to}`); return false; }
    const resend = new Resend(apiKey);
    await resend.emails.send({ from: "Agent de Bureau <onboarding@resend.dev>", to: [to], subject, html });
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

${collaborationContext}`;

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

    const systemPrompt = `Tu es un expert en analyse d'appels telephoniques professionnels. Tu dois analyser et compiler les resultats d'un appel. Sois precis, actionnable et en francais.`;
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

    const userId = (req.session as any)?.userId;
    for (const reminder of (parsed.reminders || [])) {
      try {
        await createNotification(orgId, userId, reminder.title, reminder.message, "rappel");
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

    const userId = (req.session as any)?.userId;
    for (const alert of (parsed.criticalAlerts || [])) {
      await createNotification(orgId, userId, "Alerte critique", alert, "alerte");
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

    const userId = (req.session as any)?.userId;
    for (const reminder of (parsed.reminders || [])) {
      await createNotification(orgId, userId, `[Reunion] ${reminder.title}`, reminder.message, "rappel");
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

    let address = "";
    let mapUrl = "";
    if (latitude && longitude) {
      mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
      try {
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=fr`);
        const geoData = await geoRes.json() as any;
        address = geoData?.display_name || `${latitude}, ${longitude}`;
      } catch {
        address = `${latitude}, ${longitude}`;
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

    const q = `%${query}%`;
    const [contacts, tasks, events, invoices, prospects] = await Promise.all([
      db.select().from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), or(ilike(contactsTable.firstName, q), ilike(contactsTable.lastName, q), ilike(contactsTable.email, q), ilike(contactsTable.phone, q), ilike(contactsTable.company, q)))).limit(10),
      db.select().from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), or(ilike(tasksTable.title, q), ilike(tasksTable.description, q)))).limit(10),
      db.select().from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), or(ilike(calendarEventsTable.title, q), ilike(calendarEventsTable.description, q)))).limit(10),
      db.select().from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), or(ilike(facturesClientTable.reference, q), ilike(facturesClientTable.clientName, q)))).limit(10),
      db.select().from(prospectsTable).where(and(eq(prospectsTable.organisationId, orgId), or(ilike(prospectsTable.company, q), ilike(prospectsTable.contactName, q), ilike(prospectsTable.email, q)))).limit(10),
    ]);

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

router.post("/commandant/execute-command", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = (req.session as any)?.userId;
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

export default router;

