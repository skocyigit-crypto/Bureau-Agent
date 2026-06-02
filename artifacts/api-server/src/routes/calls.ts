import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and, gte, lte } from "drizzle-orm";
import { db, callsTable, contactsTable, tasksTable, calendarEventsTable, messagesTable, organisationsTable } from "@workspace/db";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import {
  ListCallsQueryParams,
  CreateCallBody,
  GetCallParams,
  UpdateCallParams,
  UpdateCallBody,
  DeleteCallParams,
} from "@workspace/api-zod";
import { processCallWithAI } from "../services/call-processor";
import { assertAiQuota, invalidateQuotaCache } from "../services/ai-quota";
import { recordAiUsage, extractGeminiTokens, GEMINI_PRO_MODEL } from "../services/ai-utils";
import { logAudit } from "./audit";
import { getOrgId } from "../middleware/tenant";
import { resolveUserNames, enrichWithUserNames, enrichSingle } from "../helpers/user-tracking";
import { logger } from "../lib/logger";
import { zodErrorResponse } from "../lib/zod-error";

const router: IRouter = Router();

const AI_LIMITS = {
  MAX_FIELD_CHARS: 200,
  MAX_NOTES_CHARS: 4000,
  MAX_CONTEXT_CHARS: 1500,
  MAX_HISTORY_TURNS: 20,
  MAX_HISTORY_MSG_CHARS: 800,
  MAX_TRANSCRIPT_MSGS: 50,
  MAX_TRANSCRIPT_MSG_CHARS: 800,
  MAX_SUMMARY_CHARS: 3000,
};

function sanitizeField(s: unknown, maxLen = AI_LIMITS.MAX_FIELD_CHARS): string {
  if (typeof s !== "string") return "";
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").replace(/`{3,}/g, "```").trim().slice(0, maxLen);
}

function sanitizeHistory(history: unknown): { role: string; text: string }[] {
  if (!Array.isArray(history)) return [];
  return history
    .slice(0, AI_LIMITS.MAX_HISTORY_TURNS)
    .map((m: any) => ({
      role: typeof m?.role === "string" ? m.role.slice(0, 20) : "user",
      text: sanitizeField(m?.text, AI_LIMITS.MAX_HISTORY_MSG_CHARS),
    }))
    .filter(m => m.text.length > 0);
}

function sanitizeTranscript(transcript: unknown): { role: string; text: string }[] {
  if (!Array.isArray(transcript)) return [];
  return transcript
    .slice(0, AI_LIMITS.MAX_TRANSCRIPT_MSGS)
    .map((m: any) => ({
      role: typeof m?.role === "string" ? m.role.slice(0, 20) : "user",
      text: sanitizeField(m?.text, AI_LIMITS.MAX_TRANSCRIPT_MSG_CHARS),
    }))
    .filter(m => m.text.length > 0);
}

const callSortColumns: Record<string, any> = {
  createdAt: callsTable.createdAt,
  duration: callsTable.duration,
  status: callsTable.status,
  contactName: callsTable.contactName,
};

router.get("/calls", async (req, res): Promise<void> => {
  const query = ListCallsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json(zodErrorResponse(query.error));
    return;
  }

  const orgId = getOrgId(req);
  const { status, limit, offset, search, sortBy, sortOrder, dateFrom, dateTo, direction } = query.data;

  const conditions: any[] = [eq(callsTable.organisationId, orgId)];
  if (status && status !== "all") {
    if (status === "answered") conditions.push(eq(callsTable.status, "repondu"));
    else if (status === "missed") conditions.push(eq(callsTable.status, "manque"));
    else if (status === "voicemail") conditions.push(eq(callsTable.status, "messagerie"));
    else if (status === "outgoing") conditions.push(eq(callsTable.direction, "sortant"));
    else conditions.push(eq(callsTable.status, status));
  }
  if (direction && direction !== "all") {
    conditions.push(eq(callsTable.direction, direction));
  }
  if (search) {
    const useUnaccent = await ensureUnaccentExtension();
    const pattern = `%${search}%`;
    conditions.push(
      or(
        accentInsensitiveIlike(callsTable.phoneNumber, pattern, useUnaccent),
        accentInsensitiveIlike(callsTable.contactName, pattern, useUnaccent),
        accentInsensitiveIlike(callsTable.notes, pattern, useUnaccent)
      )!
    );
  }
  if (dateFrom) {
    conditions.push(gte(callsTable.createdAt, new Date(dateFrom)));
  }
  if (dateTo) {
    conditions.push(lte(callsTable.createdAt, new Date(dateTo)));
  }

  const whereClause = and(...conditions);

  const sortCol = callSortColumns[sortBy ?? "createdAt"] ?? callsTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
    const [calls, countResult] = await Promise.all([
      db
        .select()
        .from(callsTable)
        .where(whereClause)
        .orderBy(orderFn(sortCol))
        .limit(limit ?? 50)
        .offset(offset ?? 0),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(callsTable)
        .where(whereClause),
    ]);

    const userIds = calls.flatMap((c: any) => [c.createdBy, c.updatedBy]);
    const userMap = await resolveUserNames(userIds);
    res.json({ calls: enrichWithUserNames(calls, userMap), total: countResult[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste appels");
    res.status(500).json({ error: "Erreur lors de la recuperation des appels." });
  }
});

router.post("/calls", async (req, res): Promise<void> => {
  const parsed = CreateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }

  const orgId = getOrgId(req);
  const data = parsed.data;

  try {
    if (data.contactId) {
      const [contact] = await db.select({ id: contactsTable.id }).from(contactsTable).where(and(eq(contactsTable.id, data.contactId), eq(contactsTable.organisationId, orgId)));
      if (!contact) {
        res.status(403).json({ error: "Contact introuvable ou inaccessible." });
        return;
      }
      await db.update(contactsTable)
        .set({
          totalCalls: sql`${contactsTable.totalCalls} + 1`,
          lastCallAt: new Date(),
        })
        .where(and(eq(contactsTable.id, data.contactId), eq(contactsTable.organisationId, orgId)));
    }

    const userId = req.session?.userId;
    const [call] = await db.insert(callsTable).values({
      ...data,
      tags: data.tags ?? [],
      organisationId: orgId,
      createdBy: userId,
      updatedBy: userId,
    }).returning();

    logAudit(req.session?.userId, req.session?.userEmail, "create", "call", String(call.id), { contactName: call.contactName, direction: call.direction }, req.ip, req.get("user-agent"), req.session?.organisationId);

    if (call.status === "repondu" && call.notes && call.notes.trim().length > 5) {
      processCallWithAI(call.id).catch(async (err) => {
        const msg = err?.message || String(err);
        logger.error({ err: msg }, `[AI] Erreur traitement appel #${call.id}:`);
        try {
          const { notificationsTable } = await import("@workspace/db");
          await db.insert(notificationsTable).values({
            type: "alerte",
            title: "Analyse IA echouee",
            message: `L'analyse automatique de l'appel avec ${call.contactName || call.phoneNumber} n'a pas abouti: ${msg.slice(0, 200)}. Vous pouvez reessayer manuellement depuis le detail de l'appel.`,
            priority: "normale",
            actionUrl: `/appels/${call.id}`,
            sourceType: "ai_error",
            sourceId: String(call.id),
            organisationId: orgId,
          });
        } catch (notifErr) {
          logger.error({ err: notifErr }, `[AI] Impossible de creer la notification d'erreur:`);
        }
      });
    }

    res.status(201).json(call);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation appel");
    res.status(500).json({ error: "Erreur lors de la creation de l'appel." });
  }
});

router.post("/calls/:id/process", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const result = await processCallWithAI(id);
    res.json({
      analysis: result.analysis,
      tasksCreated: result.createdTasks.length,
      tasks: result.createdTasks,
      appointmentCreated: !!result.createdAppointment,
      appointment: result.createdAppointment,
    });
  } catch (err: any) {
    if (err?.name === "AiQuotaExceededError") {
      res.status(429).json({ error: err.message, quotaExceeded: true, reason: err.reason, current: err.current, limit: err.limit });
      return;
    }
    const msg = err?.message || "Erreur lors du traitement IA.";
    try {
      const orgId = getOrgId(req);
      const [c] = await db.select({ contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber }).from(callsTable).where(and(eq(callsTable.id, id), eq(callsTable.organisationId, orgId)));
      if (c) {
        const { notificationsTable } = await import("@workspace/db");
        await db.insert(notificationsTable).values({
          type: "alerte",
          title: "Analyse IA echouee",
          message: `Echec de l'analyse manuelle de l'appel avec ${c.contactName || c.phoneNumber}: ${msg.slice(0, 200)}.`,
          priority: "normale",
          actionUrl: `/appels/${id}`,
          sourceType: "ai_error",
          sourceId: String(id),
          organisationId: orgId,
        });
      }
    } catch (notifErr) {
      logger.error({ err: notifErr }, `[AI] Impossible de creer la notification d'erreur (manuel):`);
    }
    res.status(500).json({ error: msg });
  }
});

router.get("/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const orgId = getOrgId(req);

  try {
    const [call] = await db.select().from(callsTable).where(and(eq(callsTable.id, params.data.id), eq(callsTable.organisationId, orgId)));
    if (!call) {
      res.status(404).json({ error: "Appel introuvable." });
      return;
    }

    const userMap = await resolveUserNames([call.createdBy, call.updatedBy]);
    res.json(enrichSingle(call, userMap));
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation appel");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'appel." });
  }
});

router.patch("/calls/:id", async (req, res): Promise<void> => {
  const params = UpdateCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const parsed = UpdateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }

  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  const [call] = await db.update(callsTable)
    .set({ ...parsed.data, updatedBy: userId })
    .where(and(eq(callsTable.id, params.data.id), eq(callsTable.organisationId, orgId)))
    .returning();

  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  res.json(call);
});

router.post("/calls/ai-briefing", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { phoneNumber, contactId, contactName } = req.body;

  try {
    const history: any[] = [];
    const conditions = [eq(callsTable.organisationId, orgId)];

    if (contactId) {
      conditions.push(eq(callsTable.contactId, contactId));
    } else if (phoneNumber) {
      const clean = phoneNumber.replace(/\s/g, "");
      conditions.push(sql`replace(${callsTable.phoneNumber}, ' ', '') = ${clean}`);
    }

    const recentCalls = await db.select({
      id: callsTable.id,
      direction: callsTable.direction,
      status: callsTable.status,
      duration: callsTable.duration,
      notes: callsTable.notes,
      sentiment: callsTable.sentiment,
      createdAt: callsTable.createdAt,
    }).from(callsTable).where(and(...conditions)).orderBy(desc(callsTable.createdAt)).limit(5);

    const recentTasks = contactId
      ? await db.select({ id: tasksTable.id, title: tasksTable.title, status: tasksTable.status, priority: tasksTable.priority })
          .from(tasksTable).where(and(eq(tasksTable.relatedContactId, contactId), eq(tasksTable.organisationId, orgId))).orderBy(desc(tasksTable.createdAt)).limit(5)
      : [];

    const upcomingEvents = contactId
      ? await db.select({ id: calendarEventsTable.id, title: calendarEventsTable.title, startDate: calendarEventsTable.startDate, type: calendarEventsTable.type })
          .from(calendarEventsTable).where(and(eq(calendarEventsTable.relatedContactId, contactId), gte(calendarEventsTable.startDate, new Date()), eq(calendarEventsTable.organisationId, orgId))).orderBy(asc(calendarEventsTable.startDate)).limit(3)
      : [];

    const contact = contactId
      ? await db.select().from(contactsTable).where(eq(contactsTable.id, contactId)).then(r => r[0])
      : null;

    const { ai } = await import("@workspace/integrations-gemini-ai");

    const prompt = `Tu es l'assistant IA d'un bureau professionnel francais. Un appel entrant arrive.
Prepare un brifing RAPIDE et ACTIONNABLE pour l'agent qui va repondre.

INFORMATIONS DISPONIBLES:
- Contact: ${contactName || contact?.firstName + " " + contact?.lastName || "Inconnu"}
- Telephone: ${phoneNumber || "Non disponible"}
- Entreprise: ${contact?.company || "Non renseignee"}
- Categorie: ${contact?.category || "Inconnue"}
- Derniers appels: ${JSON.stringify(recentCalls.map(c => ({ date: c.createdAt, status: c.status, duree: c.duration + "s", notes: c.notes?.substring(0, 100), sentiment: c.sentiment })))}
- Taches en cours: ${JSON.stringify(recentTasks.map(t => ({ titre: t.title, statut: t.status, priorite: t.priority })))}
- Rendez-vous a venir: ${JSON.stringify(upcomingEvents.map(e => ({ titre: e.title, date: e.startDate, type: e.type })))}

INSTRUCTIONS:
1. Resume la relation en 1-2 phrases.
2. Identifie les points importants a aborder.
3. Suggere 3-4 phrases d'accueil/reponse appropriees.
4. Signale les alertes (taches en retard, rendez-vous proches, sentiment negatif precedent).

Reponds UNIQUEMENT en JSON:
{
  "relationSummary": "string",
  "keyPoints": ["string"],
  "suggestedPhrases": ["string"],
  "alerts": ["string"],
  "callerMood": "positif|neutre|prudent",
  "priority": "haute|moyenne|basse"
}`;

    const response = await ai.models.generateContent({
      model: GEMINI_PRO_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 2048, responseMimeType: "application/json" },
    });

    const briefing = JSON.parse(response.text ?? "{}");

    res.json({
      briefing,
      context: {
        totalCalls: recentCalls.length,
        lastCallDate: recentCalls[0]?.createdAt || null,
        lastSentiment: recentCalls[0]?.sentiment || null,
        openTasks: recentTasks.filter(t => t.status !== "terminee").length,
        upcomingEvents: upcomingEvents.length,
        contactCategory: contact?.category || null,
        contactCompany: contact?.company || null,
      },
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, "[AI Briefing] Erreur:");
    res.json({
      briefing: {
        relationSummary: "Informations non disponibles.",
        keyPoints: [],
        suggestedPhrases: ["Bonjour, comment puis-je vous aider ?"],
        alerts: [],
        callerMood: "neutre",
        priority: "moyenne",
      },
      context: { totalCalls: 0, lastCallDate: null, lastSentiment: null, openTasks: 0, upcomingEvents: 0 },
    });
  }
});

router.post("/calls/ai-coaching", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const rawNotes = sanitizeField(req.body.notes, AI_LIMITS.MAX_NOTES_CHARS);
  const contactName = sanitizeField(req.body.contactName);
  const phoneNumber = sanitizeField(req.body.phoneNumber);
  const contactCategory = sanitizeField(req.body.contactCategory);
  const previousContext = sanitizeField(req.body.previousContext, AI_LIMITS.MAX_CONTEXT_CHARS);
  const callDuration = typeof req.body.callDuration === "number" ? Math.max(0, Math.min(req.body.callDuration, 86400)) : 0;

  if (!rawNotes || rawNotes.length < 3) {
    res.json({ suggestions: ["Continuez a ecouter le client attentivement."], actions: [] });
    return;
  }

  try {
    await assertAiQuota(orgId);
    const { ai } = await import("@workspace/integrations-gemini-ai");
    const t0 = Date.now();

    const prompt = `Tu es un coach IA en temps reel pour un agent de bureau professionnel en France.
L'agent est EN COURS D'APPEL et a pris des notes. Fournis des suggestions IMMEDIATES et CONCRETES.

CONTEXTE DE L'APPEL:
- Contact: ${contactName || "Inconnu"} (${contactCategory || "non classe"})
- Telephone: ${phoneNumber || "N/A"}
- Duree actuelle: ${callDuration} secondes
- Notes prises: "${rawNotes}"
${previousContext ? `- Contexte precedent: ${previousContext}` : ""}

INSTRUCTIONS:
1. Analyse les notes en temps reel.
2. Suggere 2-3 prochaines actions/questions a poser.
3. Detecte si un rendez-vous doit etre propose.
4. Identifie si un devis, une facture ou un rappel est mentionne.
5. Propose des formulations professionnelles adaptees.

Reponds UNIQUEMENT en JSON:
{
  "suggestions": ["string - actions/questions a poser maintenant"],
  "detectedIntents": ["rdv|devis|facture|rappel|reclamation|information|urgence"],
  "proposedResponse": "string - phrase que l'agent peut dire maintenant",
  "actionItems": [{"type": "tache|rdv|rappel|devis", "description": "string"}],
  "urgencyLevel": "basse|normale|haute",
  "tips": "string - conseil de communication"
}`;

    const response = await ai.models.generateContent({
      model: GEMINI_PRO_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 1024, responseMimeType: "application/json" },
    });

    const tokens = extractGeminiTokens(response);
    recordAiUsage({ organisationId: orgId, provider: "gemini", model: GEMINI_PRO_MODEL, route: "/calls/ai-coaching", inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0 }).catch(() => {});
    invalidateQuotaCache(orgId);

    const coaching = JSON.parse(response.text ?? "{}");
    res.json(coaching);
  } catch (err: any) {
    if (err?.message?.includes("quota")) {
      res.status(429).json({ error: err.message, suggestions: [], detectedIntents: [], proposedResponse: "", actionItems: [], urgencyLevel: "normale", tips: "" });
      return;
    }
    logger.error({ err: err?.message }, "[AI Coaching] Erreur:");
    res.json({
      suggestions: ["Continuez la conversation normalement."],
      detectedIntents: [],
      proposedResponse: "",
      actionItems: [],
      urgencyLevel: "normale",
      tips: "",
    });
  }
});

router.get("/calls/export/csv", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select({
      id: callsTable.id, contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber,
      direction: callsTable.direction, status: callsTable.status, duration: callsTable.duration,
      notes: callsTable.notes, createdAt: callsTable.createdAt,
    }).from(callsTable).where(eq(callsTable.organisationId, orgId)).orderBy(desc(callsTable.createdAt)).limit(5000);
    const headers = ["Contact", "Numéro", "Direction", "Statut", "Durée (s)", "Notes", "Date"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "";
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.contactName), escape(r.phoneNumber), escape(r.direction),
      escape(r.status), escape(r.duration), escape(r.notes), escape(fmtDate(r.createdAt)),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="appels_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export appels CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

router.post("/calls/:id/duplicate", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
    const orgId = getOrgId(req);
    const [original] = await db.select().from(callsTable).where(and(eq(callsTable.id, id), eq(callsTable.organisationId, orgId)));
    if (!original) { res.status(404).json({ error: "Appel introuvable" }); return; }
    const userId = req.session?.userId;
    const [copy] = await db.insert(callsTable).values({
      organisationId: orgId,
      contactId: original.contactId,
      contactName: original.contactName,
      phoneNumber: original.phoneNumber,
      direction: original.direction,
      status: "en_cours",
      duration: 0,
      notes: original.notes,
      tags: original.tags ?? [],
      createdBy: userId,
      updatedBy: userId,
    }).returning();
    res.status(201).json(copy);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication appel");
    res.status(500).json({ error: "Erreur lors de la duplication" });
  }
});

router.delete("/calls/:id", async (req, res): Promise<void> => {
  const params = DeleteCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const orgId = getOrgId(req);
  const [call] = await db.delete(callsTable).where(and(eq(callsTable.id, params.data.id), eq(callsTable.organisationId, orgId))).returning();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  await db.delete(tasksTable).where(eq(tasksTable.relatedCallId, params.data.id));

  res.sendStatus(204);
});

router.post("/calls/ai-agent-respond", async (req, res): Promise<void> => {
    const orgId = getOrgId(req);
    const phoneNumber = sanitizeField(req.body.phoneNumber);
    const contactId = typeof req.body.contactId === "number" ? req.body.contactId : (typeof req.body.contactId === "string" ? parseInt(req.body.contactId) || undefined : undefined);
    const contactName = sanitizeField(req.body.contactName);
    const contactCompany = sanitizeField(req.body.contactCompany);
    const contactCategory = sanitizeField(req.body.contactCategory);
    const callPhase = sanitizeField(req.body.callPhase, 50);
    const conversationHistory = sanitizeHistory(req.body.conversationHistory);

    const [orgRespondRow] = await db.select({ aiAgentName: organisationsTable.aiAgentName }).from(organisationsTable).where(eq(organisationsTable.id, orgId));
    const respondAgentName = orgRespondRow?.aiAgentName || "Sophie Marchand";
    const respondAgentFirstName = respondAgentName.split(" ")[0];

    try {
      let contact: any = null;
      if (contactId) {
        contact = await db.select().from(contactsTable).where(and(eq(contactsTable.id, contactId), eq(contactsTable.organisationId, orgId))).then(r => r[0]);
      }

      const recentCalls = await db.select({
        direction: callsTable.direction,
        status: callsTable.status,
        duration: callsTable.duration,
        notes: callsTable.notes,
        sentiment: callsTable.sentiment,
        createdAt: callsTable.createdAt,
      }).from(callsTable).where(and(
        eq(callsTable.organisationId, orgId),
        contactId ? eq(callsTable.contactId, contactId) : sql`replace(${callsTable.phoneNumber}, ' ', '') = ${(phoneNumber || "").replace(/\s/g, "")}`
      )).orderBy(desc(callsTable.createdAt)).limit(10);

      const openTasks = contactId
        ? await db.select({ title: tasksTable.title, status: tasksTable.status, priority: tasksTable.priority, dueDate: tasksTable.dueDate })
            .from(tasksTable).where(and(eq(tasksTable.relatedContactId, contactId), eq(tasksTable.organisationId, orgId), sql`${tasksTable.status} != 'terminee'`)).limit(10)
        : [];

      const recentMessages = contactId
        ? await db.select({ content: messagesTable.content, type: messagesTable.type, createdAt: messagesTable.createdAt })
            .from(messagesTable).where(and(eq(messagesTable.contactId, contactId), eq(messagesTable.organisationId, orgId)))
            .orderBy(desc(messagesTable.createdAt)).limit(5)
        : [];

      const upcomingEvents = contactId
        ? await db.select({ title: calendarEventsTable.title, startDate: calendarEventsTable.startDate, type: calendarEventsTable.type })
            .from(calendarEventsTable).where(and(
              eq(calendarEventsTable.relatedContactId, contactId),
              eq(calendarEventsTable.organisationId, orgId),
              gte(calendarEventsTable.startDate, new Date()),
            )).orderBy(asc(calendarEventsTable.startDate)).limit(3)
        : [];

      await assertAiQuota(orgId);
      const { ai } = await import("@workspace/integrations-gemini-ai");
      const t0Respond = Date.now();

      const conversationLog = (conversationHistory || []).map((m: any) => `${m.role === "agent" ? respondAgentFirstName : "Client"}: ${m.text}`).join("\n");

      const callCount = recentCalls.length;
      const negativeCallCount = recentCalls.filter(c => c.sentiment === "negatif" || c.sentiment === "tres_negatif").length;
      const lastCallDate = recentCalls[0]?.createdAt ? new Date(recentCalls[0].createdAt).toLocaleDateString("fr-FR") : null;
      const overdueTasks = openTasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date());
      const conversationTurnCount = (conversationHistory || []).length;
      const clientName = contactName || contact?.firstName || "";

      const prompt = `Tu es "${respondAgentName}", une receptionniste IA d'elite dotee d'intelligence emotionnelle avancee pour le bureau professionnel "Agent de Bureau" en France.

  IDENTITE & PERSONNALITE:
  - ${respondAgentName}, diplomee en Communication & Gestion
  - Voix chaleureuse, professionnelle mais humaine, jamais robotique
  - Tu t'adaptes au ton de l'appelant: formel avec un directeur, detendu avec un habitue
  - Tu utilises le prenom du client des que tu le connais
  - Tu fais preuve d'empathie sincere, pas de phrases toutes faites
  - Tu retiens les details des conversations precedentes et les mentionnes naturellement

  DETECTION AUTOMATIQUE DE LANGUE:
  - Detecte automatiquement la langue de l'appelant (francais, anglais, turc, allemand, espagnol, arabe)
  - Reponds TOUJOURS dans la langue de l'appelant
  - Si l'appelant change de langue, adapte-toi immediatement
  - Par defaut: francais

  PROFIL CLIENT COMPLET:
  - Nom: ${clientName || "Inconnu"} | Tel: ${phoneNumber || "Numero masque"}
  - Entreprise: ${contactCompany || contact?.company || "Non renseignee"}
  - Categorie: ${contact?.category || contactCategory || "Inconnue"}
  - Email: ${contact?.email || "Non renseigne"}
  - Score VIP: ${callCount >= 5 ? "CLIENT FIDELE ("+callCount+" appels)" : callCount >= 2 ? "Client regulier ("+callCount+" appels)" : "Nouveau contact"}
  - Dernier appel: ${lastCallDate || "Premier contact"}
  - Satisfaction: ${negativeCallCount > 2 ? "ATTENTION - "+negativeCallCount+" interactions negatives" : negativeCallCount > 0 ? "A surveiller" : "Bonne"}
  - Taches en retard: ${overdueTasks.length > 0 ? overdueTasks.length+" tache(s): "+overdueTasks.map(t=>t.title).join(", ") : "Aucune"}
  - RDV a venir: ${upcomingEvents.length > 0 ? upcomingEvents.map(e=> e.title + " le " + new Date(e.startDate!).toLocaleDateString("fr-FR")).join(", ") : "Aucun"}

  HISTORIQUE ENRICHI (MEMOIRE PROFONDE):
  Appels recents (${recentCalls.length}):
  ${recentCalls.length > 0 ? recentCalls.map(c => "  [" + new Date(c.createdAt!).toLocaleDateString("fr-FR") + "] " + c.direction + " | " + c.status + " | " + c.duration + "s | Sentiment: " + (c.sentiment || "?") + " | " + (c.notes?.substring(0, 120) || "Pas de notes")).join("\n") : "  Aucun historique"}

  Messages recents:
  ${recentMessages.length > 0 ? recentMessages.map(m => "  [" + new Date(m.createdAt!).toLocaleDateString("fr-FR") + "] " + m.type + ": " + (m.content?.substring(0, 100) || "")).join("\n") : "  Aucun message"}

  Taches ouvertes:
  ${openTasks.length > 0 ? openTasks.map(t => "  - [" + t.priority + "] " + t.title + " (" + t.status + ")" + (t.dueDate ? " - Echeance: " + new Date(t.dueDate).toLocaleDateString("fr-FR") : "")).join("\n") : "  Aucune"}

  CONVERSATION EN COURS (Tour ${conversationTurnCount}):
  ${conversationLog || "(debut de l'appel)"}

  Phase actuelle: ${callPhase || "greeting"}

  CAPACITES AVANCEES:
  1. INTELLIGENCE EMOTIONNELLE: Detecte frustration, impatience, joie, inquietude. Si client en colere: valider ses emotions d'abord, JAMAIS de confrontation.
  2. GESTION DE CRISE: Probleme urgent -> escalade IMMEDIATE. Client tres mecontent -> propose rappel du responsable dans l'heure.
  3. NEGOCIATION & VENTE: Si devis demande, propose visite ou appel technique. Cross-selling intelligent si contexte le permet.
  4. PROACTIVITE: Mentionne les taches en retard, les RDV a venir, personnalise pour clients fideles.
  5. GESTION MULTI-SUJETS: Traite chaque sujet separement, cree des actions distinctes.
  6. PRISE DE RDV INTELLIGENTE: Propose des creneaux precis (pas "la semaine prochaine" mais "mardi a 14h ou jeudi a 10h"). Heures de bureau 9h-18h, jours feries francais respectes.

  INSTRUCTIONS POUR CETTE REPONSE:
  - Tour 0 (greeting): Si client connu et fidele: "Bonjour ${clientName}! C'est ${respondAgentFirstName} d'Agent de Bureau, ravie de vous retrouver. Que puis-je faire pour vous ?" Sinon: "Bonjour, ${respondAgentFirstName} a l'accueil d'Agent de Bureau, comment puis-je vous aider ?"
  - Tours suivants: reponds avec pertinence, chaleur et precision
  - Maximum 3-4 phrases par reponse
  - Si conversation terminee, fais un resume proactif des actions convenues

  Reponds UNIQUEMENT en JSON:
  {
    "response": "ta reponse parlee au client (naturelle, humaine, jamais robotique)",
    "detectedIntent": "rdv|devis|reclamation|information|urgence|rappel|salutation|remerciement|achat|annulation|suivi_commande|demande_technique|plainte|felicitation|partenariat|autre",
    "sentiment": "tres_positif|positif|neutre|negatif|tres_negatif",
    "sentimentDetails": "description courte de l'etat emotionnel detecte",
    "shouldEscalate": false,
    "escalateReason": null,
    "escalateUrgency": "immediate|dans_heure|dans_journee|null",
    "detectedLanguage": "fr|en|tr|de|es|ar",
    "suggestedActions": [
      {"type": "task|appointment|message|callback|email|devis|escalation", "description": "description precise de l'action", "priority": "critique|haute|moyenne|basse", "dueInHours": 24}
    ],
    "conversationComplete": false,
    "summary": "resume intelligent de la conversation",
    "clientSatisfactionScore": 8,
    "keyInfoExtracted": {"name": null, "email": null, "company": null, "budget": null, "deadline": null, "specificNeeds": []},
    "proactiveInsights": ["observation intelligente sur ce client basee sur l'historique"],
    "nextBestAction": "la meilleure action a entreprendre apres cet appel"
  }`;

      const response = await ai.models.generateContent({
        model: GEMINI_PRO_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 1024 },
        },
      });

      const respondTokens = extractGeminiTokens(response);
      recordAiUsage({ organisationId: orgId, provider: "gemini", model: GEMINI_PRO_MODEL, route: "/calls/ai-agent-respond", inputTokens: respondTokens.input, outputTokens: respondTokens.output, durationMs: Date.now() - t0Respond }).catch(() => {});
      invalidateQuotaCache(orgId);

      const aiResponse = JSON.parse(response.text ?? "{}");
      res.json(aiResponse);
    } catch (err: any) {
      if ((err as any)?.message?.includes("quota")) {
        res.status(429).json({ error: (err as any).message, response: "Service IA temporairement indisponible (quota atteint).", conversationComplete: false });
        return;
      }
      logger.error({ err: err?.message }, "[AI Agent Respond] Erreur:");
      res.json({
        response: `Bonjour, je suis ${respondAgentFirstName} de l'accueil d'Agent de Bureau. Excusez-moi pour ce leger contretemps technique. Puis-je prendre votre nom et votre message ? Je m'assure personnellement qu'on vous rappelle dans les plus brefs delais.`,
        detectedIntent: "autre",
        sentiment: "neutre",
        sentimentDetails: "Erreur technique - mode secours actif",
        shouldEscalate: false,
        escalateReason: null,
        escalateUrgency: null,
        detectedLanguage: "fr",
        suggestedActions: [{ type: "callback", description: "Rappeler le client suite a erreur technique", priority: "haute", dueInHours: 1 }],
        conversationComplete: false,
        summary: "Erreur technique - prise de message en mode secours",
        clientSatisfactionScore: 5,
        keyInfoExtracted: { name: contactName || null, email: null, company: contactCompany || null, budget: null, deadline: null, specificNeeds: [] },
        proactiveInsights: [],
        nextBestAction: "Rappeler le client des que possible",
      });
    }
  });

  router.post("/calls/ai-agent-save", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const phoneNumber = sanitizeField(req.body.phoneNumber);
  const contactId = typeof req.body.contactId === "number" ? req.body.contactId : (typeof req.body.contactId === "string" ? parseInt(req.body.contactId) || undefined : undefined);
  const contactName = sanitizeField(req.body.contactName);
  const duration = typeof req.body.duration === "number" ? Math.max(0, Math.min(req.body.duration, 86400)) : 0;
  const transcript = sanitizeTranscript(req.body.transcript);
  const summary = sanitizeField(req.body.summary, AI_LIMITS.MAX_SUMMARY_CHARS);
  const detectedIntents = Array.isArray(req.body.detectedIntents) ? req.body.detectedIntents.slice(0, 20).map((i: unknown) => sanitizeField(i, 50)) : [];
  const suggestedActions = Array.isArray(req.body.suggestedActions) ? req.body.suggestedActions.slice(0, 10).map((a: any) => ({
    type: sanitizeField(a?.type, 50),
    description: sanitizeField(a?.description, 300),
    priority: sanitizeField(a?.priority, 20),
    dueInHours: typeof a?.dueInHours === "number" ? Math.max(0, Math.min(a.dueInHours, 8760)) : 24,
  })) : [];
  const sentiment = sanitizeField(req.body.sentiment, 30);
  const satisfactionScore = typeof req.body.satisfactionScore === "number" ? Math.max(0, Math.min(req.body.satisfactionScore, 10)) : null;
  const nextBestAction = sanitizeField(req.body.nextBestAction, AI_LIMITS.MAX_CONTEXT_CHARS);
  const rawKei = req.body.keyInfoExtracted || {};
  const keyInfoExtracted = {
    name: sanitizeField(rawKei.name),
    email: sanitizeField(rawKei.email),
    company: sanitizeField(rawKei.company),
    budget: sanitizeField(rawKei.budget, 100),
    deadline: sanitizeField(rawKei.deadline, 100),
    specificNeeds: Array.isArray(rawKei.specificNeeds) ? rawKei.specificNeeds.slice(0, 10).map((n: unknown) => sanitizeField(n, 200)) : [],
  };

  try {
    const [orgSaveRow] = await db.select({ aiAgentName: organisationsTable.aiAgentName }).from(organisationsTable).where(eq(organisationsTable.id, orgId));
    const saveAgentName = orgSaveRow?.aiAgentName || "Sophie Marchand";
    const saveAgentFirstName = saveAgentName.split(" ")[0];

    const transcriptText = transcript.map((m) => `[${m.role === "agent" ? saveAgentFirstName : "Client"}] ${m.text}`).join("\n");
    const enrichedSummary = [
      `[Appel gere par IA ${saveAgentFirstName} - Score satisfaction: ${satisfactionScore || "N/A"}/10]`,
      "",
      `Resume: ${summary || "Pas de resume"}`,
      `Intentions detectees: ${(detectedIntents || []).join(", ") || "Aucune"}`,
      `Sentiment: ${sentiment || "neutre"}`,
      nextBestAction ? `Prochaine action recommandee: ${nextBestAction}` : "",
      keyInfoExtracted?.specificNeeds?.length ? `Besoins specifiques: ${keyInfoExtracted.specificNeeds.join(", ")}` : "",
      keyInfoExtracted?.budget ? `Budget mentionne: ${keyInfoExtracted.budget}` : "",
      keyInfoExtracted?.deadline ? `Echeance mentionnee: ${keyInfoExtracted.deadline}` : "",
      "",
      "Transcription:",
      transcriptText,
    ].filter(Boolean).join("\n");

    if (contactId) {
      const contactExists = await db.select({ id: contactsTable.id }).from(contactsTable)
        .where(and(eq(contactsTable.id, contactId), eq(contactsTable.organisationId, orgId))).then(r => r[0]);
      if (!contactExists) {
        res.status(400).json({ error: "Contact introuvable dans cette organisation." });
        return;
      }
    }

    const result = await db.transaction(async (tx) => {
      const [call] = await tx.insert(callsTable).values({
        phoneNumber: phoneNumber || "Inconnu",
        contactId: contactId || null,
        contactName: contactName || null,
        direction: "entrant",
        status: "repondu",
        duration: duration || 0,
        notes: enrichedSummary,
        sentiment: sentiment || "neutre",
        organisationId: orgId,
      }).returning();

      let tasksCreated = 0;
      let appointmentCreated = false;
      let messagesCreated = 0;

      if (suggestedActions && suggestedActions.length > 0) {
        for (const action of suggestedActions) {
          if (action.type === "task" || action.type === "callback" || action.type === "devis" || action.type === "escalation" || action.type === "email") {
            const priorityMap: Record<string, string> = { critique: "haute", haute: "haute", moyenne: "moyenne", basse: "basse" };
            await tx.insert(tasksTable).values({
              title: action.type === "escalation" ? `[URGENT] ${action.description}` : action.type === "devis" ? `[DEVIS] ${action.description}` : action.type === "email" ? `[EMAIL] ${action.description}` : action.description || `Tache creee par ${saveAgentFirstName}`,
              description: `Creee automatiquement par ${saveAgentFirstName} suite a l'appel de ${contactName || phoneNumber}.\nType: ${action.type}\nPriorite: ${action.priority || "moyenne"}\nDelai: ${action.dueInHours ? action.dueInHours + "h" : "non specifie"}\n\n${summary || ""}`,
              status: "a_faire",
              priority: priorityMap[action.priority] || "moyenne",
              relatedContactId: contactId || null,
              relatedCallId: call.id,
              organisationId: orgId,
            });
            tasksCreated++;
          }
          if (action.type === "appointment") {
            const dueHours = action.dueInHours || 24;
            const appointmentDate = new Date();
            appointmentDate.setHours(appointmentDate.getHours() + dueHours);
            if (appointmentDate.getHours() < 9) appointmentDate.setHours(9, 0, 0, 0);
            if (appointmentDate.getHours() >= 18) {
              appointmentDate.setDate(appointmentDate.getDate() + 1);
              appointmentDate.setHours(10, 0, 0, 0);
            }
            if (appointmentDate.getDay() === 0) appointmentDate.setDate(appointmentDate.getDate() + 1);
            if (appointmentDate.getDay() === 6) appointmentDate.setDate(appointmentDate.getDate() + 2);

            await tx.insert(calendarEventsTable).values({
              title: action.description || `RDV avec ${contactName || "client"}`,
              description: `Planifie par ${saveAgentFirstName}.\n${summary || ""}`,
              startDate: appointmentDate,
              endDate: new Date(appointmentDate.getTime() + 30 * 60000),
              type: "rendez_vous",
              relatedContactId: contactId || null,
              organisationId: orgId,
            });
            appointmentCreated = true;
          }
          if (action.type === "message") {
            await tx.insert(messagesTable).values({
              content: action.description || `Message de ${saveAgentFirstName}`,
              type: "note",
              phoneNumber: phoneNumber || "Inconnu",
              contactId: contactId || null,
              contactName: contactName || null,
              organisationId: orgId,
            });
            messagesCreated++;
          }
        }
      }

      return { callId: call.id, tasksCreated, appointmentCreated, messagesCreated };
    });

    res.json({
      ...result,
      message: `Appel ${saveAgentFirstName} enregistre. ${result.tasksCreated} tache(s), ${result.appointmentCreated ? "1 RDV" : "0 RDV"}, ${result.messagesCreated} message(s) cree(s).`,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, "[AI Agent Save] Erreur:");
    res.status(500).json({ error: "Erreur lors de l'enregistrement de l'appel IA." });
  }
});

export default router;
