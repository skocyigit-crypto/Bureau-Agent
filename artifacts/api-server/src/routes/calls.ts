import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and, gte, lte } from "drizzle-orm";
import { db, callsTable, contactsTable, tasksTable, calendarEventsTable, messagesTable } from "@workspace/db";
import {
  ListCallsQueryParams,
  CreateCallBody,
  GetCallParams,
  UpdateCallParams,
  UpdateCallBody,
  DeleteCallParams,
} from "@workspace/api-zod";
import { processCallWithAI } from "../services/call-processor";
import { logAudit } from "./audit";
import { getOrgId } from "../middleware/tenant";

const router: IRouter = Router();

const callSortColumns: Record<string, any> = {
  createdAt: callsTable.createdAt,
  duration: callsTable.duration,
  status: callsTable.status,
  contactName: callsTable.contactName,
};

router.get("/calls", async (req, res): Promise<void> => {
  const query = ListCallsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
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
    conditions.push(
      or(
        ilike(callsTable.phoneNumber, `%${search}%`),
        ilike(callsTable.contactName, `%${search}%`),
        ilike(callsTable.notes, `%${search}%`)
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

  res.json({ calls, total: countResult[0]?.count ?? 0 });
});

router.post("/calls", async (req, res): Promise<void> => {
  const parsed = CreateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const data = parsed.data;

  if (data.contactId) {
    const [contact] = await db.select().from(contactsTable).where(and(eq(contactsTable.id, data.contactId), eq(contactsTable.organisationId, orgId)));
    if (contact) {
      await db.update(contactsTable)
        .set({
          totalCalls: sql`${contactsTable.totalCalls} + 1`,
          lastCallAt: new Date(),
        })
        .where(eq(contactsTable.id, data.contactId));
    }
  }

  const [call] = await db.insert(callsTable).values({
    ...data,
    tags: data.tags ?? [],
    organisationId: orgId,
  }).returning();

  logAudit((req.session as any)?.userId, (req.session as any)?.userEmail, "create", "call", String(call.id), { contactName: call.contactName, direction: call.direction });

  if (call.status === "repondu" && call.notes && call.notes.trim().length > 5) {
    processCallWithAI(call.id).catch((err) => {
      console.error(`[AI] Erreur traitement appel #${call.id}:`, err?.message || err);
    });
  }

  res.status(201).json(call);
});

router.post("/calls/:id/process", async (req, res): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const id = parseInt(req.params.id);
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
    res.status(500).json({ error: err.message || "Erreur lors du traitement IA." });
  }
});

router.get("/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [call] = await db.select().from(callsTable).where(and(eq(callsTable.id, params.data.id), eq(callsTable.organisationId, orgId)));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  res.json(call);
});

router.patch("/calls/:id", async (req, res): Promise<void> => {
  const params = UpdateCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [call] = await db.update(callsTable)
    .set(parsed.data)
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
      model: "gemini-2.5-flash",
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
    console.error("[AI Briefing] Erreur:", err?.message);
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
  const { notes, contactName, phoneNumber, callDuration, contactCategory, previousContext } = req.body;

  if (!notes || notes.trim().length < 3) {
    res.json({ suggestions: ["Continuez a ecouter le client attentivement."], actions: [] });
    return;
  }

  try {
    const { ai } = await import("@workspace/integrations-gemini-ai");

    const prompt = `Tu es un coach IA en temps reel pour un agent de bureau professionnel en France.
L'agent est EN COURS D'APPEL et a pris des notes. Fournis des suggestions IMMEDIATES et CONCRETES.

CONTEXTE DE L'APPEL:
- Contact: ${contactName || "Inconnu"} (${contactCategory || "non classe"})
- Telephone: ${phoneNumber || "N/A"}
- Duree actuelle: ${callDuration || 0} secondes
- Notes prises: "${notes}"
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
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 1024, responseMimeType: "application/json" },
    });

    const coaching = JSON.parse(response.text ?? "{}");
    res.json(coaching);
  } catch (err: any) {
    console.error("[AI Coaching] Erreur:", err?.message);
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

router.delete("/calls/:id", async (req, res): Promise<void> => {
  const params = DeleteCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

export default router;
