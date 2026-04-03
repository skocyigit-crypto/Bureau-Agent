import { Router } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable } from "@workspace/db";
import { sql, eq, gte, lte, and, count, avg, desc, lt, ne, isNull, isNotNull } from "drizzle-orm";

const router = Router();

async function gatherAnalyticsData() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalCallsResult,
    thisWeekCalls,
    lastWeekCalls,
    callsByStatus,
    callsBySentiment,
    callsByDirection,
    avgDurationResult,
    totalContactsResult,
    totalTasksResult,
    tasksByStatus,
    tasksByPriority,
    unreadMessagesResult,
    recentCalls,
    hourlyDistribution,
    topContactsList,
    monthlyCallVolume,
  ] = await Promise.all([
    db.select({ count: count() }).from(callsTable),
    db.select({ count: count() }).from(callsTable).where(gte(callsTable.createdAt, weekAgo)),
    db.select({ count: count() }).from(callsTable).where(and(gte(callsTable.createdAt, twoWeeksAgo), sql`${callsTable.createdAt} < ${weekAgo.toISOString()}`)),
    db.select({ status: callsTable.status, count: count() }).from(callsTable).where(gte(callsTable.createdAt, monthAgo)).groupBy(callsTable.status),
    db.select({ sentiment: callsTable.sentiment, count: count() }).from(callsTable).where(gte(callsTable.createdAt, monthAgo)).groupBy(callsTable.sentiment),
    db.select({ direction: callsTable.direction, count: count() }).from(callsTable).where(gte(callsTable.createdAt, monthAgo)).groupBy(callsTable.direction),
    db.select({ avg: avg(callsTable.duration) }).from(callsTable).where(and(gte(callsTable.createdAt, monthAgo), eq(callsTable.status, "repondu"))),
    db.select({ count: count() }).from(contactsTable),
    db.select({ count: count() }).from(tasksTable),
    db.select({ status: tasksTable.status, count: count() }).from(tasksTable).groupBy(tasksTable.status),
    db.select({ priority: tasksTable.priority, count: count() }).from(tasksTable).groupBy(tasksTable.priority),
    db.select({ count: count() }).from(messagesTable).where(eq(messagesTable.isRead, false)),
    db.select({
      contactName: callsTable.contactName,
      status: callsTable.status,
      direction: callsTable.direction,
      sentiment: callsTable.sentiment,
      duration: callsTable.duration,
      createdAt: callsTable.createdAt,
    }).from(callsTable).orderBy(desc(callsTable.createdAt)).limit(20),
    db.select({
      hour: sql<string>`extract(hour from ${callsTable.createdAt})`.as("hour"),
      count: count(),
    }).from(callsTable).where(gte(callsTable.createdAt, weekAgo)).groupBy(sql`extract(hour from ${callsTable.createdAt})`),
    db.select({
      firstName: contactsTable.firstName,
      lastName: contactsTable.lastName,
      company: contactsTable.company,
      callCount: sql<number>`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id})`.as("call_count"),
    }).from(contactsTable).orderBy(desc(sql`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id})`)).limit(5),
    db.select({ count: count() }).from(callsTable).where(gte(callsTable.createdAt, monthAgo)),
  ]);

  const thisWeekCount = thisWeekCalls[0]?.count ?? 0;
  const lastWeekCount = lastWeekCalls[0]?.count ?? 0;
  const weekOverWeekChange = lastWeekCount > 0 ? Math.round(((Number(thisWeekCount) - Number(lastWeekCount)) / Number(lastWeekCount)) * 100) : 0;

  const answeredCalls = callsByStatus.find(s => s.status === "repondu");
  const totalMonthCalls = monthlyCallVolume[0]?.count ?? 0;
  const answerRate = Number(totalMonthCalls) > 0 ? Math.round((Number(answeredCalls?.count ?? 0) / Number(totalMonthCalls)) * 100) : 0;

  const peakHours = [...hourlyDistribution].sort((a, b) => Number(b.count) - Number(a.count)).slice(0, 3);
  const quietHours = [...hourlyDistribution].sort((a, b) => Number(a.count) - Number(b.count)).slice(0, 3);

  return {
    overview: {
      totalCalls: totalCallsResult[0]?.count ?? 0,
      totalContacts: totalContactsResult[0]?.count ?? 0,
      totalTasks: totalTasksResult[0]?.count ?? 0,
      unreadMessages: unreadMessagesResult[0]?.count ?? 0,
    },
    callMetrics: {
      thisWeekCalls: thisWeekCount,
      lastWeekCalls: lastWeekCount,
      weekOverWeekChange: `${weekOverWeekChange}%`,
      answerRate: `${answerRate}%`,
      avgDurationSeconds: Math.round(Number(avgDurationResult[0]?.avg ?? 0)),
      byStatus: callsByStatus.map(s => ({ status: s.status, count: s.count })),
      bySentiment: callsBySentiment.map(s => ({ sentiment: s.sentiment, count: s.count })),
      byDirection: callsByDirection.map(d => ({ direction: d.direction, count: d.count })),
    },
    taskMetrics: {
      byStatus: tasksByStatus.map(s => ({ status: s.status, count: s.count })),
      byPriority: tasksByPriority.map(p => ({ priority: p.priority, count: p.count })),
    },
    patterns: {
      peakHours: peakHours.map(h => ({ hour: `${h.hour}h`, calls: h.count })),
      quietHours: quietHours.map(h => ({ hour: `${h.hour}h`, calls: h.count })),
    },
    recentCalls: recentCalls.map(c => ({
      caller: c.contactName,
      status: c.status,
      direction: c.direction,
      sentiment: c.sentiment,
      duration: c.duration,
      date: c.createdAt,
    })),
    topContacts: topContactsList.map(c => ({
      name: `${c.firstName} ${c.lastName}`,
      company: c.company,
      callCount: c.callCount,
    })),
  };
}

router.post("/ai/analyze", async (req, res) => {
  try {
    const analyticsData = await gatherAnalyticsData();

    const { ai } = await import("@workspace/integrations-gemini-ai");

    const systemPrompt = `Tu es un analyste de bureau expert en gestion de secretariat et centre d'appels en France. Tu analyses les donnees de performance d'un bureau professionnel et fournis des insights actionnables.

Ton analyse doit etre en francais (France) et doit inclure:
1. **Resume executif** (2-3 phrases sur l'etat general)
2. **Points forts** (3 elements positifs avec des chiffres precis)
3. **Points d'attention** (3 domaines a ameliorer avec des recommandations concretes)
4. **Tendances** (evolution semaine/semaine, patterns horaires)
5. **Recommandations prioritaires** (3 actions concretes classees par priorite)

Reponds en JSON avec cette structure exacte:
{
  "resumeExecutif": "string",
  "pointsForts": [{"titre": "string", "detail": "string"}],
  "pointsAttention": [{"titre": "string", "detail": "string", "recommandation": "string"}],
  "tendances": [{"titre": "string", "detail": "string"}],
  "recommandations": [{"priorite": "haute|moyenne|basse", "action": "string", "impact": "string"}],
  "scoreGlobal": number (0-100)
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{
            text: `${systemPrompt}\n\nVoici les donnees du bureau a analyser:\n${JSON.stringify(analyticsData, null, 2)}`
          }],
        },
      ],
      config: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    });

    const text = response.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { resumeExecutif: text, pointsForts: [], pointsAttention: [], tendances: [], recommandations: [], scoreGlobal: 0 };
    }

    res.json(parsed);
  } catch (error: any) {
    console.error("AI Analysis error:", error);
    const isProduction = process.env.NODE_ENV === "production";
    res.status(500).json({
      error: "Erreur lors de l'analyse IA",
      ...(isProduction ? {} : { details: error.message }),
    });
  }
});

router.get("/ai/status", (_req, res) => {
  const hasGemini = !!(process.env.AI_INTEGRATIONS_GEMINI_BASE_URL && process.env.AI_INTEGRATIONS_GEMINI_API_KEY);
  res.json({ available: hasGemini });
});

async function gatherContextForPage(page: string) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  switch (page) {
    case "dashboard": {
      const [missedCalls, pendingTasks, overdueTasks, unread, recentNegative] = await Promise.all([
        db.select({ count: count() }).from(callsTable).where(and(eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(tasksTable).where(eq(tasksTable.status, "en_attente")),
        db.select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate }).from(tasksTable).where(and(lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))).limit(5),
        db.select({ count: count() }).from(messagesTable).where(eq(messagesTable.isRead, false)),
        db.select({ contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber, createdAt: callsTable.createdAt }).from(callsTable).where(and(eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, weekAgo))).orderBy(desc(callsTable.createdAt)).limit(5),
      ]);
      return { missedCallsThisWeek: missedCalls[0]?.count ?? 0, pendingTasks: pendingTasks[0]?.count ?? 0, overdueTasks: overdueTasks.map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate })), unreadMessages: unread[0]?.count ?? 0, recentNegativeCalls: recentNegative };
    }
    case "calls": {
      const [missedNoCallback, longCalls, negativeSentiment, noContact] = await Promise.all([
        db.select({ id: callsTable.id, phoneNumber: callsTable.phoneNumber, contactName: callsTable.contactName, createdAt: callsTable.createdAt }).from(callsTable).where(and(eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))).orderBy(desc(callsTable.createdAt)).limit(10),
        db.select({ id: callsTable.id, contactName: callsTable.contactName, duration: callsTable.duration }).from(callsTable).where(and(gte(callsTable.duration, 600), gte(callsTable.createdAt, weekAgo))).orderBy(desc(callsTable.duration)).limit(5),
        db.select({ id: callsTable.id, contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber }).from(callsTable).where(and(eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, weekAgo))).limit(5),
        db.select({ count: count() }).from(callsTable).where(isNull(callsTable.contactId)),
      ]);
      return { missedCallsNoCallback: missedNoCallback, longCalls, negativeSentimentCalls: negativeSentiment, callsWithoutContact: noContact[0]?.count ?? 0 };
    }
    case "contacts": {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const [noRecentActivity, highCallVolume, noEmail] = await Promise.all([
        db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, company: contactsTable.company }).from(contactsTable).where(sql`${contactsTable.id} NOT IN (SELECT DISTINCT contact_id FROM calls WHERE contact_id IS NOT NULL AND created_at >= ${thirtyDaysAgo.toISOString()})`).limit(10),
        db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, callCount: sql<number>`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id} AND calls.created_at >= ${weekAgo.toISOString()})`.as("cnt") }).from(contactsTable).orderBy(desc(sql`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id} AND calls.created_at >= ${weekAgo.toISOString()})`)).limit(5),
        db.select({ count: count() }).from(contactsTable).where(isNull(contactsTable.email)),
      ]);
      return { inactiveContacts: noRecentActivity, highActivityContacts: highCallVolume.filter(c => Number(c.callCount) > 0), contactsWithoutEmail: noEmail[0]?.count ?? 0 };
    }
    case "tasks": {
      const [overdue, highPriorityPending, unassigned, recentlyCompleted] = await Promise.all([
        db.select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate, priority: tasksTable.priority }).from(tasksTable).where(and(lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))).orderBy(desc(tasksTable.priority)).limit(10),
        db.select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate }).from(tasksTable).where(and(eq(tasksTable.priority, "haute"), eq(tasksTable.status, "en_attente"))).limit(10),
        db.select({ count: count() }).from(tasksTable).where(and(isNull(tasksTable.assignedTo), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))),
        db.select({ count: count() }).from(tasksTable).where(and(eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, weekAgo))),
      ]);
      return { overdueTasks: overdue, highPriorityPendingTasks: highPriorityPending, unassignedTasks: unassigned[0]?.count ?? 0, completedThisWeek: recentlyCompleted[0]?.count ?? 0 };
    }
    case "messages": {
      const [unreadHigh, oldUnread, byType] = await Promise.all([
        db.select({ id: messagesTable.id, contactName: messagesTable.contactName, content: messagesTable.content, createdAt: messagesTable.createdAt }).from(messagesTable).where(and(eq(messagesTable.isRead, false), eq(messagesTable.priority, "haute"))).orderBy(desc(messagesTable.createdAt)).limit(5),
        db.select({ count: count() }).from(messagesTable).where(and(eq(messagesTable.isRead, false), lt(messagesTable.createdAt, new Date(now.getTime() - 48 * 60 * 60 * 1000)))),
        db.select({ type: messagesTable.type, count: count() }).from(messagesTable).where(eq(messagesTable.isRead, false)).groupBy(messagesTable.type),
      ]);
      return { urgentUnread: unreadHigh, staleUnreadCount: oldUnread[0]?.count ?? 0, unreadByType: byType };
    }
    default:
      return {};
  }
}

router.post("/ai/suggest", async (req, res) => {
  try {
    const { page } = req.body;
    if (!page || !["dashboard", "calls", "contacts", "tasks", "messages"].includes(page)) {
      return res.status(400).json({ error: "Le parametre 'page' est requis (dashboard, calls, contacts, tasks, messages)." });
    }

    const contextData = await gatherContextForPage(page);
    const { ai } = await import("@workspace/integrations-gemini-ai");

    const pagePrompts: Record<string, string> = {
      dashboard: `Tu es un assistant IA de bureau intelligent. A partir des donnees suivantes, genere un briefing matinal concis et actionnable pour le gestionnaire de bureau. Identifie les priorites urgentes, les problemes potentiels et les actions a entreprendre immediatement. Sois direct et precis.`,
      calls: `Tu es un assistant IA specialise dans la gestion des appels telephoniques. Analyse les donnees des appels et fournis des recommandations concretes: appels manques a rappeler, tendances de sentiment a surveiller, contacts sans fiche a creer, et optimisations de performance.`,
      contacts: `Tu es un assistant IA specialise dans la gestion de la relation client. Analyse les donnees des contacts et fournis des recommandations: contacts inactifs a relancer, contacts avec forte activite a privilegier, fiches incompletes a enrichir, et strategies de suivi.`,
      tasks: `Tu es un assistant IA specialise dans la gestion des taches de bureau. Analyse les donnees des taches et fournis des recommandations: taches en retard a prioriser, redistribution de charge de travail, et suggestions d'organisation.`,
      messages: `Tu es un assistant IA specialise dans la gestion des messages de bureau. Analyse les messages et fournis des recommandations: messages urgents non lus, messages anciens a traiter, et categorisation automatique.`,
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `${pagePrompts[page]}

Reponds en JSON avec cette structure exacte:
{
  "suggestions": [
    {
      "type": "urgence|amelioration|information|action",
      "titre": "string (court, 5-10 mots)",
      "description": "string (detail en 1-2 phrases)",
      "priorite": "haute|moyenne|basse",
      "actionLabel": "string (texte du bouton d'action, ex: 'Rappeler maintenant')" 
    }
  ],
  "resumeCourt": "string (1 phrase resumant la situation)"
}

Genere entre 3 et 6 suggestions pertinentes, classees par priorite. Sois precis avec les chiffres des donnees fournies.

Donnees:\n${JSON.stringify(contextData, null, 2)}`
        }],
      }],
      config: {
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    });

    const text = response.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { suggestions: [], resumeCourt: text };
    }

    res.json(parsed);
  } catch (error: any) {
    console.error("AI Suggest error:", error);
    const isProduction = process.env.NODE_ENV === "production";
    res.status(500).json({
      error: "Erreur lors de la generation de suggestions IA",
      ...(isProduction ? {} : { details: error.message }),
    });
  }
});

router.post("/ai/validate", async (req, res) => {
  try {
    const { entityType, data } = req.body;
    if (!entityType || !data) {
      return res.status(400).json({ error: "Les parametres 'entityType' et 'data' sont requis." });
    }

    let contextInfo = "";

    if (entityType === "contact" && data.phone) {
      const existingContacts = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, phone: contactsTable.phone, email: contactsTable.email }).from(contactsTable).where(eq(contactsTable.phone, data.phone)).limit(3);
      if (existingContacts.length > 0) {
        contextInfo += `\nATTENTION: Il existe deja ${existingContacts.length} contact(s) avec ce numero: ${existingContacts.map(c => `${c.firstName} ${c.lastName}`).join(", ")}`;
      }
    }

    if (entityType === "contact" && data.email) {
      const existingEmail = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName }).from(contactsTable).where(eq(contactsTable.email, data.email)).limit(3);
      if (existingEmail.length > 0) {
        contextInfo += `\nATTENTION: Il existe deja ${existingEmail.length} contact(s) avec cet email: ${existingEmail.map(c => `${c.firstName} ${c.lastName}`).join(", ")}`;
      }
    }

    if (entityType === "task" && data.dueDate) {
      const dueDate = new Date(data.dueDate);
      const now = new Date();
      if (dueDate < now) {
        contextInfo += `\nATTENTION: La date d'echeance est dans le passe (${dueDate.toLocaleDateString('fr-FR')}).`;
      }
      const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      if (dueDate <= threeDays && data.priority !== "haute") {
        contextInfo += `\nATTENTION: L'echeance est dans moins de 3 jours mais la priorite n'est pas haute.`;
      }
    }

    const { ai } = await import("@workspace/integrations-gemini-ai");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `Tu es un assistant IA de validation de donnees pour un bureau professionnel en France. Analyse les donnees soumises et fournis des retours de validation.

Type d'entite: ${entityType}
Donnees soumises: ${JSON.stringify(data, null, 2)}
${contextInfo ? `\nContexte supplementaire: ${contextInfo}` : ""}

Verifie:
- Format du numero de telephone (doit etre au format francais: +33, 01-09, ou international)
- Coherence des donnees (email valide, noms corrects, dates logiques)
- Doublons potentiels
- Suggestions d'amelioration

Reponds en JSON avec cette structure exacte:
{
  "isValid": boolean,
  "errors": [{"champ": "string", "message": "string"}],
  "warnings": [{"champ": "string", "message": "string"}],
  "suggestions": [{"champ": "string", "suggestion": "string"}]
}

Si tout est correct, errors et warnings seront vides. Sois utile mais pas trop strict.`
        }],
      }],
      config: {
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    });

    const text = response.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { isValid: true, errors: [], warnings: [], suggestions: [] };
    }

    res.json(parsed);
  } catch (error: any) {
    console.error("AI Validate error:", error);
    const isProduction = process.env.NODE_ENV === "production";
    res.status(500).json({
      error: "Erreur lors de la validation IA",
      ...(isProduction ? {} : { details: error.message }),
    });
  }
});

router.post("/ai/assistant", async (req, res) => {
  try {
    const { question, currentPage } = req.body;
    if (!question) {
      return res.status(400).json({ error: "Le parametre 'question' est requis." });
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      callStats,
      contactStats,
      taskStats,
      messageStats,
      recentCalls,
      overdueTasks,
      missedCalls,
    ] = await Promise.all([
      db.select({ total: count(), answered: sql<number>`SUM(CASE WHEN status = 'repondu' THEN 1 ELSE 0 END)`, missed: sql<number>`SUM(CASE WHEN status = 'manque' THEN 1 ELSE 0 END)`, avgDuration: avg(callsTable.duration) }).from(callsTable).where(gte(callsTable.createdAt, weekAgo)),
      db.select({ total: count() }).from(contactsTable),
      db.select({ total: count(), pending: sql<number>`SUM(CASE WHEN status = 'en_attente' THEN 1 ELSE 0 END)`, inProgress: sql<number>`SUM(CASE WHEN status = 'en_cours' THEN 1 ELSE 0 END)`, completed: sql<number>`SUM(CASE WHEN status = 'termine' THEN 1 ELSE 0 END)` }).from(tasksTable),
      db.select({ total: count(), unread: sql<number>`SUM(CASE WHEN is_read = false THEN 1 ELSE 0 END)` }).from(messagesTable),
      db.select({ contactName: callsTable.contactName, status: callsTable.status, sentiment: callsTable.sentiment, duration: callsTable.duration, createdAt: callsTable.createdAt }).from(callsTable).orderBy(desc(callsTable.createdAt)).limit(10),
      db.select({ title: tasksTable.title, dueDate: tasksTable.dueDate, priority: tasksTable.priority }).from(tasksTable).where(and(lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))).limit(5),
      db.select({ contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber, createdAt: callsTable.createdAt }).from(callsTable).where(and(eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))).limit(10),
    ]);

    const dbContext = {
      semaineCourante: {
        appels: { total: callStats[0]?.total ?? 0, repondus: Number(callStats[0]?.answered ?? 0), manques: Number(callStats[0]?.missed ?? 0), dureeMoyenne: Math.round(Number(callStats[0]?.avgDuration ?? 0)) },
        contacts: { total: contactStats[0]?.total ?? 0 },
        taches: { total: taskStats[0]?.total ?? 0, enAttente: Number(taskStats[0]?.pending ?? 0), enCours: Number(taskStats[0]?.inProgress ?? 0), terminees: Number(taskStats[0]?.completed ?? 0) },
        messages: { total: messageStats[0]?.total ?? 0, nonLus: Number(messageStats[0]?.unread ?? 0) },
      },
      derniersAppels: recentCalls,
      tachesEnRetard: overdueTasks,
      appelsManques: missedCalls,
    };

    const { ai } = await import("@workspace/integrations-gemini-ai");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `Tu es l'assistant IA intelligent du logiciel "Agent de Bureau", un outil de gestion de bureau et centre d'appels en France. Tu reponds aux questions de l'utilisateur en francais, de facon professionnelle, concise et utile. Tu as acces aux donnees en temps reel du bureau.

Page actuelle de l'utilisateur: ${currentPage || "tableau de bord"}

Donnees du bureau en temps reel:
${JSON.stringify(dbContext, null, 2)}

Question de l'utilisateur: "${question}"

Reponds en JSON avec cette structure:
{
  "reponse": "string (reponse principale, claire et concise, 2-4 phrases max)",
  "donnees": [{"label": "string", "valeur": "string"}] (donnees chiffrees pertinentes, max 4),
  "actions": [{"label": "string", "description": "string"}] (actions suggerees, max 3)
}

Sois precis, base-toi sur les donnees reelles. Si la question n'a pas de rapport avec le bureau, reponds poliment que tu es specialise dans la gestion de bureau.`
        }],
      }],
      config: {
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    });

    const text = response.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { reponse: text, donnees: [], actions: [] };
    }

    res.json(parsed);
  } catch (error: any) {
    console.error("AI Assistant error:", error);
    const isProduction = process.env.NODE_ENV === "production";
    res.status(500).json({
      error: "Erreur de l'assistant IA",
      ...(isProduction ? {} : { details: error.message }),
    });
  }
});

export default router;
