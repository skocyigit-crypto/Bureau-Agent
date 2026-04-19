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
import { resolveUserNames, enrichWithUserNames, enrichSingle } from "../helpers/user-tracking";

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

  const userIds = calls.flatMap((c: any) => [c.createdBy, c.updatedBy]);
  const userMap = await resolveUserNames(userIds);
  res.json({ calls: enrichWithUserNames(calls, userMap), total: countResult[0]?.count ?? 0 });
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

  const userId = (req.session as any)?.userId;
  const [call] = await db.insert(callsTable).values({
    ...data,
    tags: data.tags ?? [],
    organisationId: orgId,
    createdBy: userId,
    updatedBy: userId,
  }).returning();

  logAudit((req.session as any)?.userId, (req.session as any)?.userEmail, "create", "call", String(call.id), { contactName: call.contactName, direction: call.direction });

  if (call.status === "repondu" && call.notes && call.notes.trim().length > 5) {
    processCallWithAI(call.id).catch(async (err) => {
      const msg = err?.message || String(err);
      console.error(`[AI] Erreur traitement appel #${call.id}:`, msg);
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
        console.error(`[AI] Impossible de creer la notification d'erreur:`, notifErr);
      }
    });
  }

  res.status(201).json(call);
});

router.post("/calls/:id/process", async (req, res): Promise<void> => {
  const userId = (req.session as any)?.userId;
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
      console.error(`[AI] Impossible de creer la notification d'erreur (manuel):`, notifErr);
    }
    res.status(500).json({ error: msg });
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

  const userMap = await resolveUserNames([call.createdBy, call.updatedBy]);
  res.json(enrichSingle(call, userMap));
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
  const userId = (req.session as any)?.userId;
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

router.post("/calls/ai-agent-respond", async (req, res): Promise<void> => {
    const orgId = getOrgId(req);
    const { phoneNumber, contactId, contactName, contactCompany, contactCategory, conversationHistory, callPhase } = req.body;

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

      const { ai } = await import("@workspace/integrations-gemini-ai");

      const conversationLog = (conversationHistory || []).map((m: any) => `${m.role === "agent" ? "Sophie" : "Client"}: ${m.text}`).join("\n");

      const callCount = recentCalls.length;
      const negativeCallCount = recentCalls.filter(c => c.sentiment === "negatif" || c.sentiment === "tres_negatif").length;
      const lastCallDate = recentCalls[0]?.createdAt ? new Date(recentCalls[0].createdAt).toLocaleDateString("fr-FR") : null;
      const overdueTasks = openTasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date());
      const conversationTurnCount = (conversationHistory || []).length;
      const clientName = contactName || contact?.firstName || "";

      const prompt = `Tu es "Sophie Marchand", une receptionniste IA d'elite dotee d'intelligence emotionnelle avancee pour le bureau professionnel "Agent de Bureau" en France.

  IDENTITE & PERSONNALITE:
  - Sophie Marchand, 28 ans, diplomee en Communication & Gestion
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
  - Tour 0 (greeting): Si client connu et fidele: "Bonjour ${clientName}! C'est Sophie d'Agent de Bureau, ravie de vous retrouver. Que puis-je faire pour vous ?" Sinon: "Bonjour, Sophie a l'accueil d'Agent de Bureau, comment puis-je vous aider ?"
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
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 1024 },
        },
      });

      const aiResponse = JSON.parse(response.text ?? "{}");
      res.json(aiResponse);
    } catch (err: any) {
      console.error("[AI Agent Respond] Erreur:", err?.message);
      res.json({
        response: "Bonjour, je suis Sophie de l'accueil d'Agent de Bureau. Excusez-moi pour ce leger contretemps technique. Puis-je prendre votre nom et votre message ? Je m'assure personnellement qu'on vous rappelle dans les plus brefs delais.",
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
  const { phoneNumber, contactId, contactName, duration, transcript, summary, detectedIntents, suggestedActions, sentiment, satisfactionScore, keyInfoExtracted, nextBestAction } = req.body;

  try {
    const transcriptText = (transcript || []).map((m: any) => `[${m.role === "agent" ? "Sophie" : "Client"}] ${m.text}`).join("\n");
    const enrichedSummary = [
      `[Appel gere par IA Sophie - Score satisfaction: ${satisfactionScore || "N/A"}/10]`,
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
              title: action.type === "escalation" ? `[URGENT] ${action.description}` : action.type === "devis" ? `[DEVIS] ${action.description}` : action.type === "email" ? `[EMAIL] ${action.description}` : action.description || "Tache creee par Sophie",
              description: `Creee automatiquement par Sophie suite a l'appel de ${contactName || phoneNumber}.\nType: ${action.type}\nPriorite: ${action.priority || "moyenne"}\nDelai: ${action.dueInHours ? action.dueInHours + "h" : "non specifie"}\n\n${summary || ""}`,
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
              description: `Planifie par Sophie.\n${summary || ""}`,
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
              content: action.description || "Message de Sophie",
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
      message: `Appel Sophie enregistre. ${result.tasksCreated} tache(s), ${result.appointmentCreated ? "1 RDV" : "0 RDV"}, ${result.messagesCreated} message(s) cree(s).`,
    });
  } catch (err: any) {
    console.error("[AI Agent Save] Erreur:", err?.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement de l'appel IA." });
  }
});

export default router;
