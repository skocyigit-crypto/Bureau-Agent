import { Router } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, checkinsTable, platformConnectionsTable } from "@workspace/db";
import { sql, eq, gte, lte, and, count, avg, desc, asc, lt, ne, isNull, isNotNull } from "drizzle-orm";

const router = Router();

async function gatherAnalyticsData(orgId: number) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const orgCall = eq(callsTable.organisationId, orgId);
  const orgContact = eq(contactsTable.organisationId, orgId);
  const orgTask = eq(tasksTable.organisationId, orgId);
  const orgMsg = eq(messagesTable.organisationId, orgId);

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
    db.select({ count: count() }).from(callsTable).where(orgCall),
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))),
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, twoWeeksAgo), sql`${callsTable.createdAt} < ${weekAgo.toISOString()}`)),
    db.select({ status: callsTable.status, count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, monthAgo))).groupBy(callsTable.status),
    db.select({ sentiment: callsTable.sentiment, count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, monthAgo))).groupBy(callsTable.sentiment),
    db.select({ direction: callsTable.direction, count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, monthAgo))).groupBy(callsTable.direction),
    db.select({ avg: avg(callsTable.duration) }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, monthAgo), eq(callsTable.status, "repondu"))),
    db.select({ count: count() }).from(contactsTable).where(orgContact),
    db.select({ count: count() }).from(tasksTable).where(orgTask),
    db.select({ status: tasksTable.status, count: count() }).from(tasksTable).where(orgTask).groupBy(tasksTable.status),
    db.select({ priority: tasksTable.priority, count: count() }).from(tasksTable).where(orgTask).groupBy(tasksTable.priority),
    db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))),
    db.select({
      contactName: callsTable.contactName,
      status: callsTable.status,
      direction: callsTable.direction,
      sentiment: callsTable.sentiment,
      duration: callsTable.duration,
      createdAt: callsTable.createdAt,
    }).from(callsTable).where(orgCall).orderBy(desc(callsTable.createdAt)).limit(20),
    db.select({
      hour: sql<string>`extract(hour from ${callsTable.createdAt})`.as("hour"),
      count: count(),
    }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))).groupBy(sql`extract(hour from ${callsTable.createdAt})`),
    db.select({
      firstName: contactsTable.firstName,
      lastName: contactsTable.lastName,
      company: contactsTable.company,
      callCount: sql<number>`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id} AND calls.organisation_id = ${orgId})`.as("call_count"),
    }).from(contactsTable).where(orgContact).orderBy(desc(sql`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id} AND calls.organisation_id = ${orgId})`)).limit(5),
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, monthAgo))),
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
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const analyticsData = await gatherAnalyticsData(orgId);

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
  const hasOpenAI = !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
  const hasAnthropic = !!(process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY);
  res.json({
    available: hasGemini || hasOpenAI || hasAnthropic,
    providers: {
      gemini: { available: hasGemini, model: "gemini-2.5-flash", role: "Analyse principale" },
      openai: { available: hasOpenAI, model: "gpt-5.2", role: "Verification et synthese" },
      anthropic: { available: hasAnthropic, model: "claude-sonnet-4-6", role: "Raisonnement avance" },
    },
  });
});

async function gatherContextForPage(page: string, orgId: number) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const orgCall = eq(callsTable.organisationId, orgId);
  const orgContact = eq(contactsTable.organisationId, orgId);
  const orgTask = eq(tasksTable.organisationId, orgId);
  const orgMsg = eq(messagesTable.organisationId, orgId);
  const orgCheckin = eq(checkinsTable.organisationId, orgId);

  switch (page) {
    case "dashboard": {
      const [missedCalls, pendingTasks, overdueTasks, unread, recentNegative] = await Promise.all([
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "en_attente"))),
        db.select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate }).from(tasksTable).where(and(orgTask, lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))).limit(5),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))),
        db.select({ contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber, createdAt: callsTable.createdAt }).from(callsTable).where(and(orgCall, eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, weekAgo))).orderBy(desc(callsTable.createdAt)).limit(5),
      ]);
      return { missedCallsThisWeek: missedCalls[0]?.count ?? 0, pendingTasks: pendingTasks[0]?.count ?? 0, overdueTasks: overdueTasks.map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate })), unreadMessages: unread[0]?.count ?? 0, recentNegativeCalls: recentNegative };
    }
    case "calls": {
      const [missedNoCallback, longCalls, negativeSentiment, noContact] = await Promise.all([
        db.select({ id: callsTable.id, phoneNumber: callsTable.phoneNumber, contactName: callsTable.contactName, createdAt: callsTable.createdAt }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))).orderBy(desc(callsTable.createdAt)).limit(10),
        db.select({ id: callsTable.id, contactName: callsTable.contactName, duration: callsTable.duration }).from(callsTable).where(and(orgCall, gte(callsTable.duration, 600), gte(callsTable.createdAt, weekAgo))).orderBy(desc(callsTable.duration)).limit(5),
        db.select({ id: callsTable.id, contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber }).from(callsTable).where(and(orgCall, eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, weekAgo))).limit(5),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.contactId))),
      ]);
      return { missedCallsNoCallback: missedNoCallback, longCalls, negativeSentimentCalls: negativeSentiment, callsWithoutContact: noContact[0]?.count ?? 0 };
    }
    case "contacts": {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const [noRecentActivity, highCallVolume, noEmail] = await Promise.all([
        db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, company: contactsTable.company }).from(contactsTable).where(and(orgContact, sql`${contactsTable.id} NOT IN (SELECT DISTINCT contact_id FROM calls WHERE contact_id IS NOT NULL AND organisation_id = ${orgId} AND created_at >= ${thirtyDaysAgo.toISOString()})`)).limit(10),
        db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, callCount: sql<number>`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id} AND calls.organisation_id = ${orgId} AND calls.created_at >= ${weekAgo.toISOString()})`.as("cnt") }).from(contactsTable).where(orgContact).orderBy(desc(sql`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id} AND calls.organisation_id = ${orgId} AND calls.created_at >= ${weekAgo.toISOString()})`)).limit(5),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.email))),
      ]);
      return { inactiveContacts: noRecentActivity, highActivityContacts: highCallVolume.filter(c => Number(c.callCount) > 0), contactsWithoutEmail: noEmail[0]?.count ?? 0 };
    }
    case "tasks": {
      const [overdue, highPriorityPending, unassigned, recentlyCompleted] = await Promise.all([
        db.select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate, priority: tasksTable.priority }).from(tasksTable).where(and(orgTask, lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))).orderBy(desc(tasksTable.priority)).limit(10),
        db.select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate }).from(tasksTable).where(and(orgTask, eq(tasksTable.priority, "haute"), eq(tasksTable.status, "en_attente"))).limit(10),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, isNull(tasksTable.assignedTo), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, weekAgo))),
      ]);
      return { overdueTasks: overdue, highPriorityPendingTasks: highPriorityPending, unassignedTasks: unassigned[0]?.count ?? 0, completedThisWeek: recentlyCompleted[0]?.count ?? 0 };
    }
    case "messages": {
      const [unreadHigh, oldUnread, byType] = await Promise.all([
        db.select({ id: messagesTable.id, contactName: messagesTable.contactName, content: messagesTable.content, createdAt: messagesTable.createdAt }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false), eq(messagesTable.priority, "haute"))).orderBy(desc(messagesTable.createdAt)).limit(5),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false), lt(messagesTable.createdAt, new Date(now.getTime() - 48 * 60 * 60 * 1000)))),
        db.select({ type: messagesTable.type, count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))).groupBy(messagesTable.type),
      ]);
      return { urgentUnread: unreadHigh, staleUnreadCount: oldUnread[0]?.count ?? 0, unreadByType: byType };
    }
    case "rapports": {
      const [totalReports, recentReports] = await Promise.all([
        db.select({ count: count() }).from(callsTable).where(orgCall),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"))),
      ]);
      return { totalCalls: totalReports[0]?.count ?? 0, completedTasks: recentReports[0]?.count ?? 0 };
    }
    case "logiciels": {
      const [totalContacts, totalCalls, totalTasks] = await Promise.all([
        db.select({ count: count() }).from(contactsTable).where(orgContact),
        db.select({ count: count() }).from(callsTable).where(orgCall),
        db.select({ count: count() }).from(tasksTable).where(orgTask),
      ]);
      return { totalContacts: totalContacts[0]?.count ?? 0, totalCalls: totalCalls[0]?.count ?? 0, totalTasks: totalTasks[0]?.count ?? 0 };
    }
    case "pointage": {
      const [totalSessions, activeSessions, avgMinutes, lateArrivals] = await Promise.all([
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, eq(checkinsTable.status, "present"))),
        db.select({ avg: sql<number>`coalesce(avg(${checkinsTable.totalMinutes}), 0)::int` }).from(checkinsTable).where(and(orgCheckin, eq(checkinsTable.status, "termine"), gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo), sql`extract(hour from ${checkinsTable.checkInAt}) >= 10`)),
      ]);
      return { sessionsThisWeek: totalSessions[0]?.count ?? 0, currentlyActive: activeSessions[0]?.count ?? 0, avgSessionMinutes: avgMinutes[0]?.avg ?? 0, lateArrivalsThisWeek: lateArrivals[0]?.count ?? 0 };
    }
    case "utilisateurs": {
      const [totalCalls, totalTasks, totalContacts, completedTasks] = await Promise.all([
        db.select({ count: count() }).from(callsTable).where(orgCall),
        db.select({ count: count() }).from(tasksTable).where(orgTask),
        db.select({ count: count() }).from(contactsTable).where(orgContact),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"))),
      ]);
      return { totalCalls: totalCalls[0]?.count ?? 0, totalTasks: totalTasks[0]?.count ?? 0, totalContacts: totalContacts[0]?.count ?? 0, completedTasks: completedTasks[0]?.count ?? 0 };
    }
    default:
      return {};
  }
}

router.post("/ai/suggest", async (req, res) => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { page } = req.body;
    if (!page || !["dashboard", "calls", "contacts", "tasks", "messages", "rapports", "logiciels", "pointage", "utilisateurs"].includes(page)) {
      return res.status(400).json({ error: "Le parametre 'page' est requis." });
    }

    const contextData = await gatherContextForPage(page, orgId);
    const { ai } = await import("@workspace/integrations-gemini-ai");

    const pagePrompts: Record<string, string> = {
      dashboard: `Tu es un assistant IA de bureau intelligent. A partir des donnees suivantes, genere un briefing matinal concis et actionnable pour le gestionnaire de bureau. Identifie les priorites urgentes, les problemes potentiels et les actions a entreprendre immediatement. Sois direct et precis.`,
      calls: `Tu es un assistant IA specialise dans la gestion des appels telephoniques. Analyse les donnees des appels et fournis des recommandations concretes: appels manques a rappeler, tendances de sentiment a surveiller, contacts sans fiche a creer, et optimisations de performance.`,
      contacts: `Tu es un assistant IA specialise dans la gestion de la relation client. Analyse les donnees des contacts et fournis des recommandations: contacts inactifs a relancer, contacts avec forte activite a privilegier, fiches incompletes a enrichir, et strategies de suivi.`,
      tasks: `Tu es un assistant IA specialise dans la gestion des taches de bureau. Analyse les donnees des taches et fournis des recommandations: taches en retard a prioriser, redistribution de charge de travail, et suggestions d'organisation.`,
      messages: `Tu es un assistant IA specialise dans la gestion des messages de bureau. Analyse les messages et fournis des recommandations: messages urgents non lus, messages anciens a traiter, et categorisation automatique.`,
      rapports: `Tu es un assistant IA specialise dans l'analyse des rapports de performance de bureau. Fournis des recommandations sur la frequence de generation des rapports, les tendances de performance a surveiller, et les metriques cles a ameliorer.`,
      logiciels: `Tu es un assistant IA specialise dans l'integration de logiciels professionnels. En fonction des donnees du bureau, recommande quels logiciels connecter en priorite (CRM, communication, gestion de projet, comptabilite) pour maximiser la productivite de l'equipe.`,
      pointage: `Tu es un assistant IA specialise dans la gestion du temps et des presences. Analyse les donnees de pointage et fournis des recommandations: retards frequents a signaler, temps de travail anormalement court ou long, equilibre bureau/distance/terrain, pauses excessives, et optimisations d'organisation des horaires de l'equipe.`,
      utilisateurs: `Tu es un assistant IA specialise dans la gestion des equipes et des licences. Analyse les donnees des utilisateurs et fournis des recommandations: utilisateurs inactifs a desactiver, repartition des roles a optimiser, licences inutilisees a recuperer, securite MFA a renforcer, et productivite par utilisateur a analyser.`,
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
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { entityType, data } = req.body;
    if (!entityType || !data) {
      return res.status(400).json({ error: "Les parametres 'entityType' et 'data' sont requis." });
    }

    let contextInfo = "";

    if (entityType === "contact" && data.phone) {
      const existingContacts = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, phone: contactsTable.phone, email: contactsTable.email }).from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), eq(contactsTable.phone, data.phone))).limit(3);
      if (existingContacts.length > 0) {
        contextInfo += `\nATTENTION: Il existe deja ${existingContacts.length} contact(s) avec ce numero: ${existingContacts.map(c => `${c.firstName} ${c.lastName}`).join(", ")}`;
      }
    }

    if (entityType === "contact" && data.email) {
      const existingEmail = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName }).from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), eq(contactsTable.email, data.email))).limit(3);
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
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { question, currentPage } = req.body;
    if (!question) {
      return res.status(400).json({ error: "Le parametre 'question' est requis." });
    }

    const { detectMathExpressions, analyzeMath, analyzeWithAI } = await import("../services/math-engine");
    const hasMath = detectMathExpressions(question);
    let mathAnalysis = null;

    if (hasMath) {
      mathAnalysis = analyzeMath(question);
      if (mathAnalysis.subComponents.length > 0) {
        try {
          mathAnalysis = await analyzeWithAI(question, mathAnalysis);
        } catch (err) { console.warn("[AIAnalysis] operation failed:", err); }
      }
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const orgCall = eq(callsTable.organisationId, orgId);
    const orgContact = eq(contactsTable.organisationId, orgId);
    const orgTask = eq(tasksTable.organisationId, orgId);
    const orgMsg = eq(messagesTable.organisationId, orgId);

    const [
      callStats,
      contactStats,
      taskStats,
      messageStats,
      recentCalls,
      overdueTasks,
      missedCalls,
    ] = await Promise.all([
      db.select({ total: count(), answered: sql<number>`SUM(CASE WHEN status = 'repondu' THEN 1 ELSE 0 END)`, missed: sql<number>`SUM(CASE WHEN status = 'manque' THEN 1 ELSE 0 END)`, avgDuration: avg(callsTable.duration) }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))),
      db.select({ total: count() }).from(contactsTable).where(orgContact),
      db.select({ total: count(), pending: sql<number>`SUM(CASE WHEN status = 'en_attente' THEN 1 ELSE 0 END)`, inProgress: sql<number>`SUM(CASE WHEN status = 'en_cours' THEN 1 ELSE 0 END)`, completed: sql<number>`SUM(CASE WHEN status = 'termine' THEN 1 ELSE 0 END)` }).from(tasksTable).where(orgTask),
      db.select({ total: count(), unread: sql<number>`SUM(CASE WHEN is_read = false THEN 1 ELSE 0 END)` }).from(messagesTable).where(orgMsg),
      db.select({ contactName: callsTable.contactName, status: callsTable.status, sentiment: callsTable.sentiment, duration: callsTable.duration, createdAt: callsTable.createdAt }).from(callsTable).where(orgCall).orderBy(desc(callsTable.createdAt)).limit(10),
      db.select({ title: tasksTable.title, dueDate: tasksTable.dueDate, priority: tasksTable.priority }).from(tasksTable).where(and(orgTask, lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))).limit(5),
      db.select({ contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber, createdAt: callsTable.createdAt }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))).limit(10),
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

    const mathContext = mathAnalysis && mathAnalysis.detected
      ? `\n\nANALYSE MATHEMATIQUE DETECTEE:\n${JSON.stringify({
          category: mathAnalysis.category,
          summary: mathAnalysis.summary,
          subComponents: mathAnalysis.subComponents.map(c => ({
            expression: c.expression,
            type: c.type,
            result: c.result,
            steps: c.steps,
            unit: c.unit,
          })),
          finalResult: mathAnalysis.finalResult,
        }, null, 2)}\n\nINCLUS les resultats mathematiques dans ta reponse. Presente chaque sous-composant avec ses etapes de resolution. Utilise les resultats exacts calcules ci-dessus.`
      : "";

    const { ai } = await import("@workspace/integrations-gemini-ai");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `Tu es l'assistant IA intelligent du logiciel "Agent de Bureau", un outil de gestion de bureau et centre d'appels en France. Tu reponds aux questions de l'utilisateur en francais, de facon professionnelle, concise et utile. Tu as acces aux donnees en temps reel du bureau.

Tu possedes un moteur mathematique integre capable de:
- Arithmetique (addition, soustraction, multiplication, division)
- Pourcentages (20% de 500, TVA)
- Puissances et racines (2^10, sqrt(144))
- Logarithmes (log, ln)
- Trigonometrie (sin, cos, tan en degres)
- Statistiques (moyenne, somme de series)
- Calculs financiers (HT/TTC, TVA, marges)
- Conversions d'unites (km, kg, litres...)
- Geometrie (aire, perimetre, volume)
- Ratios et proportions

Quand tu detectes des expressions mathematiques, decompose-les en sous-composants et montre la resolution etape par etape.

Page actuelle de l'utilisateur: ${currentPage || "tableau de bord"}

Donnees du bureau en temps reel:
${JSON.stringify(dbContext, null, 2)}${mathContext}

Question de l'utilisateur: "${question}"

Reponds en JSON avec cette structure:
{
  "reponse": "string (reponse principale, claire et concise)",
  "donnees": [{"label": "string", "valeur": "string"}] (donnees chiffrees pertinentes, max 6),
  "actions": [{"label": "string", "description": "string"}] (actions suggerees, max 3),
  "mathDetected": boolean,
  "mathResults": [
    {
      "expression": "string (l'expression originale)",
      "type": "string (arithmetic|percentage|financial|statistics|geometry|conversion|trigonometry|power|root|logarithm|ratio)",
      "result": "string (resultat formate)",
      "steps": ["string (etapes de resolution)"],
      "unit": "string optionnel (unite du resultat)"
    }
  ] (resultats mathematiques, vide si aucune expression detectee)
}

Sois precis, base-toi sur les donnees reelles. Pour les calculs mathematiques, utilise les resultats du moteur integre quand ils sont disponibles.`
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
      parsed = { reponse: text, donnees: [], actions: [], mathDetected: false, mathResults: [] };
    }

    if (mathAnalysis && mathAnalysis.detected && mathAnalysis.subComponents.length > 0) {
      parsed.mathDetected = true;
      parsed.mathResults = mathAnalysis.subComponents.map(c => ({
        expression: c.expression,
        type: c.type,
        result: typeof c.result === "number" ? c.result.toLocaleString("fr-FR") : String(c.result),
        steps: c.steps,
        unit: c.unit,
      }));
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

router.post("/ai/recognize", async (req, res) => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    const orgCall = eq(callsTable.organisationId, orgId);
    const orgContact = eq(contactsTable.organisationId, orgId);
    const orgTask = eq(tasksTable.organisationId, orgId);
    const orgMsg = eq(messagesTable.organisationId, orgId);

    const [
      totalCalls,
      missedCallsThisWeek,
      answeredCallsThisWeek,
      negativeCallsThisWeek,
      callsWithoutContact,
      repeatCallers,
      overdueTasks,
      highPriorityPending,
      unreadMessages,
      urgentUnread,
      inactiveContacts,
      contactsNoEmail,
      vipContacts,
      recentCallPatterns,
      taskCompletionRate,
      avgCallDuration,
      longCallsToday,
    ] = await Promise.all([
      db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.contactId), gte(callsTable.createdAt, weekAgo))),
      db.select({
        phoneNumber: callsTable.phoneNumber,
        contactName: callsTable.contactName,
        callCount: count(),
      }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))).groupBy(callsTable.phoneNumber, callsTable.contactName).having(sql`count(*) >= 3`).orderBy(desc(count())).limit(5),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.priority, "haute"), eq(tasksTable.status, "en_attente"))),
      db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))),
      db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false), eq(messagesTable.priority, "haute"))),
      db.select({ count: count() }).from(contactsTable).where(and(orgContact, sql`${contactsTable.id} NOT IN (SELECT DISTINCT contact_id FROM calls WHERE contact_id IS NOT NULL AND organisation_id = ${orgId} AND created_at >= ${monthAgo.toISOString()})`)),
      db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.email))),
      db.select({
        id: contactsTable.id,
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        company: contactsTable.company,
        category: contactsTable.category,
        callCount: sql<number>`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id} AND calls.organisation_id = ${orgId})`.as("cc"),
      }).from(contactsTable).where(orgContact).orderBy(desc(sql`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id} AND calls.organisation_id = ${orgId})`)).limit(3),
      db.select({
        hour: sql<string>`extract(hour from ${callsTable.createdAt})`.as("hour"),
        count: count(),
      }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, threeDaysAgo))).groupBy(sql`extract(hour from ${callsTable.createdAt})`).orderBy(desc(count())).limit(3),
      db.select({
        total: count(),
        completed: sql<number>`SUM(CASE WHEN status = 'termine' THEN 1 ELSE 0 END)`,
      }).from(tasksTable).where(orgTask),
      db.select({ avg: avg(callsTable.duration) }).from(callsTable).where(and(orgCall, eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, threeDaysAgo), sql`${callsTable.duration} > 600`)),
    ]);

    const totalWeekCalls = Number(totalCalls[0]?.count ?? 0);
    const missedCount = Number(missedCallsThisWeek[0]?.count ?? 0);
    const answeredCount = Number(answeredCallsThisWeek[0]?.count ?? 0);
    const answerRate = totalWeekCalls > 0 ? Math.round((answeredCount / totalWeekCalls) * 100) : 100;
    const overdueCount = Number(overdueTasks[0]?.count ?? 0);
    const unreadCount = Number(unreadMessages[0]?.count ?? 0);
    const urgentCount = Number(urgentUnread[0]?.count ?? 0);
    const negativeCount = Number(negativeCallsThisWeek[0]?.count ?? 0);
    const noContactCount = Number(callsWithoutContact[0]?.count ?? 0);
    const inactiveCount = Number(inactiveContacts[0]?.count ?? 0);
    const noEmailCount = Number(contactsNoEmail[0]?.count ?? 0);
    const highPriCount = Number(highPriorityPending[0]?.count ?? 0);
    const completionTotal = Number(taskCompletionRate[0]?.total ?? 0);
    const completionDone = Number(taskCompletionRate[0]?.completed ?? 0);
    const taskRate = completionTotal > 0 ? Math.round((completionDone / completionTotal) * 100) : 0;
    const avgDur = Math.round(Number(avgCallDuration[0]?.avg ?? 0));
    const longCallCount = Number(longCallsToday[0]?.count ?? 0);

    const detections: {
      id: string;
      categorie: string;
      type: string;
      severite: string;
      titre: string;
      description: string;
      valeur: string;
      icone: string;
      lien?: string;
    }[] = [];

    let detId = 0;
    const addDetection = (categorie: string, type: string, severite: string, titre: string, description: string, valeur: string, icone: string, lien?: string) => {
      detections.push({ id: `det-${++detId}`, categorie, type, severite, titre, description, valeur, icone, lien });
    };

    if (missedCount > 0) {
      const sev = missedCount > 5 ? "critique" : missedCount > 2 ? "alerte" : "info";
      addDetection("appels", "appels_manques", sev, "Appels manques detectes", `${missedCount} appel(s) manque(s) cette semaine necessitant un rappel.`, `${missedCount}`, "phone-missed", "/appels");
    }

    if (negativeCount > 0) {
      addDetection("appels", "sentiment_negatif", negativeCount > 3 ? "alerte" : "attention", "Sentiment negatif detecte", `${negativeCount} appel(s) avec sentiment negatif cette semaine. Suivi recommande.`, `${negativeCount}`, "alert-triangle", "/appels");
    }

    if (noContactCount > 0) {
      addDetection("appels", "sans_contact", "attention", "Appels sans fiche contact", `${noContactCount} appel(s) non associe(s) a un contact existant.`, `${noContactCount}`, "user-x", "/appels");
    }

    if (answerRate < 80) {
      addDetection("performance", "taux_reponse", answerRate < 60 ? "critique" : "alerte", "Taux de reponse faible", `Le taux de reponse est de ${answerRate}%. Objectif: 80% minimum.`, `${answerRate}%`, "trending-down");
    }

    if (avgDur > 0) {
      const avgMin = Math.floor(avgDur / 60);
      const avgSec = avgDur % 60;
      addDetection("performance", "duree_moyenne", "info", "Duree moyenne des appels", `Duree moyenne: ${avgMin}m ${avgSec}s cette semaine.`, `${avgMin}m${avgSec}s`, "clock");
    }

    if (longCallCount > 0) {
      addDetection("performance", "appels_longs", "attention", "Appels prolonges detectes", `${longCallCount} appel(s) de plus de 10 minutes ces 3 derniers jours.`, `${longCallCount}`, "timer");
    }

    repeatCallers.forEach(rc => {
      addDetection("reconnaissance", "appelant_frequent", "info", `Appelant frequent: ${rc.contactName || rc.phoneNumber}`, `${Number(rc.callCount)} appels cette semaine. Contact a privilegier.`, `${rc.callCount}x`, "repeat", "/contacts");
    });

    if (overdueCount > 0) {
      addDetection("taches", "retard", overdueCount > 3 ? "critique" : "alerte", "Taches en retard", `${overdueCount} tache(s) en retard necessitant une action immediate.`, `${overdueCount}`, "alert-circle", "/taches");
    }

    if (highPriCount > 0) {
      addDetection("taches", "haute_priorite", "alerte", "Taches haute priorite en attente", `${highPriCount} tache(s) haute priorite en attente de traitement.`, `${highPriCount}`, "flag", "/taches");
    }

    addDetection("taches", "progression", taskRate >= 80 ? "positif" : taskRate >= 50 ? "info" : "attention", "Progression des taches", `Taux d'achevement global: ${taskRate}%.`, `${taskRate}%`, "check-circle", "/taches");

    if (urgentCount > 0) {
      addDetection("messages", "urgent_non_lu", "critique", "Messages urgents non lus", `${urgentCount} message(s) urgent(s) en attente de lecture.`, `${urgentCount}`, "mail-warning", "/messages");
    }

    if (unreadCount > 3) {
      addDetection("messages", "non_lus", "attention", "Messages en attente", `${unreadCount} message(s) non lu(s) a traiter.`, `${unreadCount}`, "mail", "/messages");
    }

    if (inactiveCount > 5) {
      addDetection("contacts", "inactifs", "attention", "Contacts inactifs", `${inactiveCount} contact(s) sans activite depuis 30 jours. Relance recommandee.`, `${inactiveCount}`, "user-minus", "/contacts");
    }

    if (noEmailCount > 0) {
      addDetection("contacts", "incomplets", "info", "Fiches contacts incompletes", `${noEmailCount} contact(s) sans adresse email renseignee.`, `${noEmailCount}`, "file-warning", "/contacts");
    }

    vipContacts.filter(v => Number(v.callCount) > 3).forEach(vip => {
      addDetection("reconnaissance", "contact_vip", "positif", `Contact VIP: ${vip.firstName} ${vip.lastName}`, `${Number(vip.callCount)} interactions. ${vip.company ? `Entreprise: ${vip.company}.` : ""} Categorie: ${vip.category}.`, `${vip.callCount} appels`, "star", `/contacts/${vip.id}`);
    });

    if (recentCallPatterns.length > 0) {
      const peakH = recentCallPatterns[0];
      addDetection("reconnaissance", "heure_pointe", "info", `Heure de pointe: ${peakH.hour}h00`, `${Number(peakH.count)} appels a cette heure sur 3 jours. Planifiez vos ressources.`, `${peakH.hour}h`, "clock");
    }

    detections.sort((a, b) => {
      const sevOrder: Record<string, number> = { critique: 0, alerte: 1, attention: 2, info: 3, positif: 4 };
      return (sevOrder[a.severite] ?? 5) - (sevOrder[b.severite] ?? 5);
    });

    const scoreBase = 100;
    let penalty = 0;
    penalty += missedCount * 3;
    penalty += overdueCount * 4;
    penalty += urgentCount * 5;
    penalty += negativeCount * 3;
    penalty += noContactCount;
    penalty += (answerRate < 80 ? (80 - answerRate) : 0);
    penalty += (taskRate < 50 ? (50 - taskRate) / 2 : 0);
    const scoreGlobal = Math.max(0, Math.min(100, Math.round(scoreBase - penalty)));

    const niveauSante = scoreGlobal >= 85 ? "excellent" : scoreGlobal >= 70 ? "bon" : scoreGlobal >= 50 ? "moyen" : "critique";

    const resume = {
      scoreGlobal,
      niveauSante,
      totalDetections: detections.length,
      critiques: detections.filter(d => d.severite === "critique").length,
      alertes: detections.filter(d => d.severite === "alerte").length,
      positifs: detections.filter(d => d.severite === "positif").length,
    };

    res.json({ resume, detections });
  } catch (error: any) {
    console.error("AI Recognize error:", error);
    const isProduction = process.env.NODE_ENV === "production";
    res.status(500).json({
      error: "Erreur lors de la reconnaissance IA",
      ...(isProduction ? {} : { details: error.message }),
    });
  }
});

router.post("/ai/draft-email", async (req, res) => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { contactId, contactName, contactEmail, company, category, purpose, tone, language, additionalContext } = req.body;

    if (!purpose) {
      return res.status(400).json({ error: "Le parametre 'purpose' est requis." });
    }

    let contactHistory = "";
    if (contactId) {
      const [recentCalls, recentTasks, contactInfo] = await Promise.all([
        db.select({
          direction: callsTable.direction,
          status: callsTable.status,
          sentiment: callsTable.sentiment,
          duration: callsTable.duration,
          notes: callsTable.notes,
          createdAt: callsTable.createdAt,
        }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.contactId, parseInt(contactId)))).orderBy(desc(callsTable.createdAt)).limit(5),
        db.select({
          title: tasksTable.title,
          status: tasksTable.status,
          priority: tasksTable.priority,
          dueDate: tasksTable.dueDate,
        }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.relatedContactId, parseInt(contactId)))).orderBy(desc(tasksTable.createdAt)).limit(5),
        db.select({
          firstName: contactsTable.firstName,
          lastName: contactsTable.lastName,
          company: contactsTable.company,
          category: contactsTable.category,
          notes: contactsTable.notes,
          email: contactsTable.email,
        }).from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), eq(contactsTable.id, parseInt(contactId)))).limit(1),
      ]);

      if (contactInfo.length > 0) {
        contactHistory += `\nInformations du contact: ${JSON.stringify(contactInfo[0])}`;
      }
      if (recentCalls.length > 0) {
        contactHistory += `\nDerniers appels (${recentCalls.length}): ${JSON.stringify(recentCalls)}`;
      }
      if (recentTasks.length > 0) {
        contactHistory += `\nTaches liees (${recentTasks.length}): ${JSON.stringify(recentTasks)}`;
      }
    }

    const { ai } = await import("@workspace/integrations-gemini-ai");

    const purposeLabels: Record<string, string> = {
      suivi_appel: "Suivi apres un appel telephonique",
      relance_prospect: "Relance commerciale d'un prospect",
      confirmation_rdv: "Confirmation de rendez-vous",
      remerciement: "Remerciement apres une reunion ou un echange",
      rappel_paiement: "Rappel de paiement ou de facture",
      information: "Transmission d'informations ou de documents",
      presentation: "Presentation de services ou de l'entreprise",
      excuses: "Excuses pour un desagrement ou un retard",
      bienvenue: "Message de bienvenue pour un nouveau contact",
      personnalise: "E-mail personnalise selon les instructions",
    };

    const toneLabels: Record<string, string> = {
      formel: "Formel et professionnel",
      cordial: "Cordial et chaleureux",
      direct: "Direct et concis",
      empathique: "Empathique et attentionne",
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `Tu es un assistant IA professionnel specialise dans la redaction d'e-mails d'affaires en francais pour un bureau professionnel en France. 

Redige un e-mail complet et professionnel selon les parametres suivants:

Objectif: ${purposeLabels[purpose] || purpose}
Destinataire: ${contactName || "Non specifie"}
Entreprise du destinataire: ${company || "Non specifiee"}
Categorie du contact: ${category || "Non specifiee"}
Ton souhaite: ${toneLabels[tone] || tone || "Professionnel et cordial"}
Langue: ${language || "Francais"}
${additionalContext ? `Instructions supplementaires: ${additionalContext}` : ""}
${contactHistory ? `\nHistorique avec ce contact:${contactHistory}` : ""}

IMPORTANT: 
- Utilise des noms fictifs si aucun nom n'est fourni
- N'utilise JAMAIS de noms de personnes reelles
- L'e-mail doit etre pret a envoyer
- Inclus une formule de politesse appropriee
- Le contenu doit etre pertinent par rapport a l'historique du contact si disponible

Reponds en JSON avec cette structure exacte:
{
  "objet": "string (sujet de l'e-mail)",
  "corps": "string (corps complet de l'e-mail avec sauts de ligne \\n)",
  "destinataire": "string (nom du destinataire)",
  "tonUtilise": "string",
  "resumeIA": "string (explication courte de pourquoi l'IA a choisi ce contenu)",
  "suggestionsAlternatives": [
    {
      "label": "string (description courte de l'alternative)",
      "objet": "string",
      "corps": "string"
    }
  ]
}`
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
      parsed = { objet: "", corps: text, destinataire: contactName || "", tonUtilise: tone || "cordial", resumeIA: "", suggestionsAlternatives: [] };
    }

    res.json(parsed);
  } catch (error: any) {
    console.error("AI Draft Email error:", error);
    const isProduction = process.env.NODE_ENV === "production";
    res.status(500).json({
      error: "Erreur lors de la generation de l'e-mail IA",
      ...(isProduction ? {} : { details: error.message }),
    });
  }
});

router.post("/ai/discovery", async (req, res) => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      res.status(401).json({ error: "Non authentifie." });
      return;
    }

    const { usersTable } = await import("@workspace/db");

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "Utilisateur introuvable." });
      return;
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const userOrgId = user.organisationId;
    if (!userOrgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

    const orgCall = eq(callsTable.organisationId, userOrgId);
    const orgTask = eq(tasksTable.organisationId, userOrgId);
    const orgMsg = eq(messagesTable.organisationId, userOrgId);
    const orgContact = eq(contactsTable.organisationId, userOrgId);
    const orgCheckin = eq(checkinsTable.organisationId, userOrgId);

    const [
      connectedApps,
      userCallStats,
      userTaskStats,
      userMessageStats,
      userContacts,
      userCheckins,
      allUsers,
    ] = await Promise.all([
      db.select().from(platformConnectionsTable).where(eq(platformConnectionsTable.status, "connecte")),
      db.select({
        total: count(),
        answered: sql<number>`SUM(CASE WHEN status = 'repondu' THEN 1 ELSE 0 END)`,
        missed: sql<number>`SUM(CASE WHEN status = 'manque' THEN 1 ELSE 0 END)`,
        avgDuration: sql<number>`coalesce(avg(duration), 0)::int`,
      }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))),
      db.select({
        total: count(),
        pending: sql<number>`SUM(CASE WHEN status = 'en_attente' THEN 1 ELSE 0 END)`,
        overdue: sql<number>`SUM(CASE WHEN status != 'termine' AND status != 'annule' AND due_date < NOW() THEN 1 ELSE 0 END)`,
      }).from(tasksTable).where(orgTask),
      db.select({
        total: count(),
        unread: sql<number>`SUM(CASE WHEN is_read = false THEN 1 ELSE 0 END)`,
      }).from(messagesTable).where(orgMsg),
      db.select({ count: count() }).from(contactsTable).where(orgContact),
      db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, monthAgo))),
      db.select({ count: count() }).from(usersTable).where(eq(usersTable.organisationId, userOrgId)),
    ]);

    const userProfile = {
      prenom: user.prenom,
      role: user.role,
      departement: user.departement || null,
      organisation: user.organisation || null,
      profilComplet: !!(user.nom && user.prenom && user.email && user.telephone && user.departement),
      champsManquants: [
        !user.telephone ? "telephone" : null,
        !user.departement ? "departement" : null,
      ].filter(Boolean),
      securite: { mfaActif: user.mfaActif },
    };

    const connectedAppsList = connectedApps.map(a => ({
      platform: a.platform,
      service: a.serviceName,
      syncEnabled: a.syncEnabled,
      lastSync: a.lastSync,
    }));

    const activitySnapshot = {
      appels: {
        totalSemaine: Number(userCallStats[0]?.total ?? 0),
        repondus: Number(userCallStats[0]?.answered ?? 0),
        manques: Number(userCallStats[0]?.missed ?? 0),
        dureeMoyenne: Number(userCallStats[0]?.avgDuration ?? 0),
      },
      taches: {
        total: Number(userTaskStats[0]?.total ?? 0),
        enAttente: Number(userTaskStats[0]?.pending ?? 0),
        enRetard: Number(userTaskStats[0]?.overdue ?? 0),
      },
      messages: {
        total: Number(userMessageStats[0]?.total ?? 0),
        nonLus: Number(userMessageStats[0]?.unread ?? 0),
      },
      contacts: Number(userContacts[0]?.count ?? 0),
      pointagesMois: Number(userCheckins[0]?.count ?? 0),
      utilisateursEquipe: Number(allUsers[0]?.count ?? 0),
    };

    const { ai } = await import("@workspace/integrations-gemini-ai");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `Tu es l'Agent IA personnel de l'utilisateur "${userProfile.prenom} ${userProfile.nom}" dans le logiciel Agent de Bureau (gestion de bureau et centre d'appels professionnel en France).

PROFIL UTILISATEUR:
${JSON.stringify(userProfile, null, 2)}

APPLICATIONS CONNECTEES:
${connectedAppsList.length > 0 ? JSON.stringify(connectedAppsList, null, 2) : "Aucune application connectee pour le moment."}

ACTIVITE RECENTE:
${JSON.stringify(activitySnapshot, null, 2)}

APPLICATIONS DISPONIBLES (non connectees):
- Google Workspace: Gmail, Calendar, Drive, Docs, Sheets, Slides, Meet, Chat, Contacts, Tasks, Keep, Forms
- Microsoft 365: Outlook, Teams, OneDrive, Word, Excel, PowerPoint, SharePoint, OneNote, Planner
- Apple/iCloud: iCloud Mail, Calendrier, iCloud Drive, Contacts, Pages, Numbers
- Logiciels tiers: Salesforce, HubSpot, Pipedrive, Slack, Zoom, Trello, Asana, Notion, Jira, Sage, QuickBooks, DocuSign, Dropbox, Mailchimp, Brevo, Zapier, Make, Intercom, Zendesk

TON ROLE:
1. Analyser le profil de l'utilisateur et identifier les champs manquants
2. Examiner les applications connectees et leur utilisation
3. Detecter les habitudes de travail (appels, taches, messages, pointage)
4. Recommander les meilleures applications a connecter selon son role et activite
5. Proposer des actions concretes pour ameliorer sa productivite
6. Si le profil est incomplet, le signaler gentiment

Reponds en JSON avec cette structure exacte:
{
  "salutation": "string (message de bienvenue personnalise avec le prenom, 1-2 phrases, chaleureux et professionnel)",
  "profilStatus": {
    "complet": boolean,
    "champsManquants": ["string (champs a remplir)"],
    "conseil": "string (conseil pour completer le profil si besoin)"
  },
  "appsConnectees": {
    "count": number,
    "resume": "string (resume des apps connectees)",
    "optimisations": ["string (amelioration possible pour chaque app connectee)"]
  },
  "appsRecommandees": [
    {
      "nom": "string",
      "raison": "string (pourquoi cette app serait utile pour cet utilisateur)",
      "priorite": "haute|moyenne|basse",
      "benefice": "string (benefice concret)"
    }
  ],
  "habituesTravail": {
    "resume": "string (resume des habitudes de travail detectees, 2-3 phrases)",
    "points_forts": ["string"],
    "axes_amelioration": ["string"]
  },
  "actionsSuggerees": [
    {
      "titre": "string (action courte)",
      "description": "string (detail)",
      "type": "profil|integration|productivite|securite",
      "priorite": "haute|moyenne|basse",
      "lien": "string (page cible: /parametres, /logiciels, etc)"
    }
  ],
  "question": "string (une question a poser a l'utilisateur pour mieux l'aider, par exemple: Utilisez-vous Google Workspace ou Microsoft 365 au quotidien?)"
}

Sois concret, personnalise, et adapte tes recommandations au role (${userProfile.role}) et departement (${userProfile.departement || 'non renseigne'}) de l'utilisateur. Limite a 3-5 apps recommandees et 3-5 actions.`
        }],
      }],
      config: {
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    });

    const text = response.text ?? "{}";
    const defaultResult = {
      salutation: `Bienvenue ${userProfile.prenom} !`,
      profilStatus: { complet: userProfile.profilComplet, champsManquants: userProfile.champsManquants, conseil: "" },
      appsConnectees: { count: connectedAppsList.length, resume: connectedAppsList.length > 0 ? `${connectedAppsList.length} application(s) connectee(s).` : "Aucune application connectee.", optimisations: [] },
      appsRecommandees: [],
      habituesTravail: { resume: "", points_forts: [], axes_amelioration: [] },
      actionsSuggerees: [],
      question: "",
    };

    let parsed;
    try {
      const raw = JSON.parse(text);
      parsed = {
        salutation: typeof raw.salutation === "string" ? raw.salutation : defaultResult.salutation,
        profilStatus: raw.profilStatus && typeof raw.profilStatus === "object" ? {
          complet: typeof raw.profilStatus.complet === "boolean" ? raw.profilStatus.complet : defaultResult.profilStatus.complet,
          champsManquants: Array.isArray(raw.profilStatus.champsManquants) ? raw.profilStatus.champsManquants : defaultResult.profilStatus.champsManquants,
          conseil: typeof raw.profilStatus.conseil === "string" ? raw.profilStatus.conseil : "",
        } : defaultResult.profilStatus,
        appsConnectees: raw.appsConnectees && typeof raw.appsConnectees === "object" ? {
          count: typeof raw.appsConnectees.count === "number" ? raw.appsConnectees.count : defaultResult.appsConnectees.count,
          resume: typeof raw.appsConnectees.resume === "string" ? raw.appsConnectees.resume : defaultResult.appsConnectees.resume,
          optimisations: Array.isArray(raw.appsConnectees.optimisations) ? raw.appsConnectees.optimisations : [],
        } : defaultResult.appsConnectees,
        appsRecommandees: Array.isArray(raw.appsRecommandees) ? raw.appsRecommandees.slice(0, 5) : [],
        habituesTravail: raw.habituesTravail && typeof raw.habituesTravail === "object" ? {
          resume: typeof raw.habituesTravail.resume === "string" ? raw.habituesTravail.resume : "",
          points_forts: Array.isArray(raw.habituesTravail.points_forts) ? raw.habituesTravail.points_forts : [],
          axes_amelioration: Array.isArray(raw.habituesTravail.axes_amelioration) ? raw.habituesTravail.axes_amelioration : [],
        } : defaultResult.habituesTravail,
        actionsSuggerees: Array.isArray(raw.actionsSuggerees) ? raw.actionsSuggerees.slice(0, 5) : [],
        question: typeof raw.question === "string" ? raw.question : "",
      };
    } catch {
      parsed = defaultResult;
    }

    res.json(parsed);
  } catch (error: any) {
    console.error("AI Discovery error:", error);
    const isProduction = process.env.NODE_ENV === "production";
    res.status(500).json({
      error: "Erreur lors de la decouverte IA",
      ...(isProduction ? {} : { details: error.message }),
    });
  }
});

router.post("/ai/central-intelligence", async (req, res) => {
  try {
    const userId = (req.session as any)?.userId;
    const orgId = (req.session as any)?.organisationId;
    if (!userId) {
      res.status(401).json({ error: "Non authentifie." });
      return;
    }
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const next48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const { stockArticlesTable } = await import("@workspace/db");

    const orgCall = eq(callsTable.organisationId, orgId);
    const orgTask = eq(tasksTable.organisationId, orgId);
    const orgMsg = eq(messagesTable.organisationId, orgId);
    const orgContact = eq(contactsTable.organisationId, orgId);
    const orgCheckin = eq(checkinsTable.organisationId, orgId);
    const orgStock = eq(stockArticlesTable.organisationId, orgId);

    const [
      overdueTasks,
      highPriorityPending,
      upcomingTasks48h,
      unreadMessages,
      missedCallsWeek,
      answeredCallsWeek,
      negativeCallsWeek,
      callsWithoutContact,
      totalCallsWeek,
      callsToday,
      recentMissedCalls,
      staleContacts,
      stockAlerts,
      todayCheckins,
      recentCallPatterns,
      taskCompletionRate,
    ] = await Promise.all([
      db.select({
        id: tasksTable.id,
        title: tasksTable.title,
        priority: tasksTable.priority,
        dueDate: tasksTable.dueDate,
        assignedTo: tasksTable.assignedTo,
        status: tasksTable.status,
      }).from(tasksTable).where(
        and(orgTask, lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))
      ).orderBy(asc(tasksTable.dueDate)).limit(10),

      db.select({
        id: tasksTable.id,
        title: tasksTable.title,
        dueDate: tasksTable.dueDate,
        assignedTo: tasksTable.assignedTo,
      }).from(tasksTable).where(
        and(orgTask, eq(tasksTable.priority, "haute"), eq(tasksTable.status, "en_attente"))
      ).limit(5),

      db.select({
        id: tasksTable.id,
        title: tasksTable.title,
        priority: tasksTable.priority,
        dueDate: tasksTable.dueDate,
      }).from(tasksTable).where(
        and(
          orgTask,
          gte(tasksTable.dueDate, now),
          lt(tasksTable.dueDate, next48h),
          ne(tasksTable.status, "termine"),
          ne(tasksTable.status, "annule")
        )
      ).orderBy(asc(tasksTable.dueDate)).limit(8),

      db.select({
        id: messagesTable.id,
        contactName: messagesTable.contactName,
        phoneNumber: messagesTable.phoneNumber,
        content: messagesTable.content,
        type: messagesTable.type,
        priority: messagesTable.priority,
        createdAt: messagesTable.createdAt,
      }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))).orderBy(desc(messagesTable.createdAt)).limit(15),

      db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.contactId), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, todayStart))),

      db.select({
        id: callsTable.id,
        contactName: callsTable.contactName,
        phoneNumber: callsTable.phoneNumber,
        direction: callsTable.direction,
        notes: callsTable.notes,
        createdAt: callsTable.createdAt,
      }).from(callsTable).where(
        and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))
      ).orderBy(desc(callsTable.createdAt)).limit(5),

      db.select({
        id: contactsTable.id,
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        company: contactsTable.company,
        phone: contactsTable.phone,
        category: contactsTable.category,
        lastCallAt: contactsTable.lastCallAt,
      }).from(contactsTable).where(
        and(
          orgContact,
          isNotNull(contactsTable.lastCallAt),
          lt(contactsTable.lastCallAt, fifteenDaysAgo)
        )
      ).orderBy(asc(contactsTable.lastCallAt)).limit(8),

      db.select({
        id: stockArticlesTable.id,
        name: stockArticlesTable.name,
        reference: stockArticlesTable.reference,
        quantity: stockArticlesTable.quantity,
        minQuantity: stockArticlesTable.minQuantity,
        category: stockArticlesTable.category,
        supplier: stockArticlesTable.supplier,
      }).from(stockArticlesTable).where(
        and(orgStock, sql`${stockArticlesTable.quantity} <= ${stockArticlesTable.minQuantity}`)
      ).limit(8),

      db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, todayStart))),

      db.select({
        hour: sql<string>`extract(hour from ${callsTable.createdAt})`.as("hour"),
        callCount: count(),
      }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))).groupBy(sql`extract(hour from ${callsTable.createdAt})`).orderBy(desc(count())).limit(5),
      db.select({
        total: count(),
        completed: sql<number>`SUM(CASE WHEN status = 'termine' THEN 1 ELSE 0 END)`,
      }).from(tasksTable).where(orgTask),
    ]);

    const totalWeekCalls = Number(totalCallsWeek[0]?.count ?? 0);
    const missedCount = Number(missedCallsWeek[0]?.count ?? 0);
    const answeredCount = Number(answeredCallsWeek[0]?.count ?? 0);
    const negativeCount = Number(negativeCallsWeek[0]?.count ?? 0);
    const noContactCount = Number(callsWithoutContact[0]?.count ?? 0);
    const todayCallCount = Number(callsToday[0]?.count ?? 0);
    const answerRate = totalWeekCalls > 0 ? Math.round((answeredCount / totalWeekCalls) * 100) : 100;
    const completionTotal = Number(taskCompletionRate[0]?.total ?? 0);
    const completionDone = Number(taskCompletionRate[0]?.completed ?? 0);
    const taskRate = completionTotal > 0 ? Math.round((completionDone / completionTotal) * 100) : 0;
    const todayCheckinCount = Number(todayCheckins[0]?.count ?? 0);

    let scoreBase = 100;
    let penalty = 0;
    penalty += missedCount * 3;
    penalty += overdueTasks.length * 4;
    penalty += unreadMessages.filter(m => m.priority === "haute").length * 5;
    penalty += negativeCount * 3;
    penalty += noContactCount;
    penalty += (answerRate < 80 ? (80 - answerRate) : 0);
    penalty += (taskRate < 50 ? (50 - taskRate) / 2 : 0);
    penalty += stockAlerts.length * 2;
    const scoreGlobal = Math.max(0, Math.min(100, Math.round(scoreBase - penalty)));
    const modeCommando = scoreGlobal < 90;

    const maskPhone = (phone: string) => phone.length > 4 ? phone.slice(0, -4).replace(/./g, "*") + phone.slice(-4) : "****";

    const messageIdMap = unreadMessages.map((m, i) => ({ index: i + 1, id: m.id }));

    const contextForAI = {
      scoreSante: scoreGlobal,
      modeCommando,
      tachesEnRetard: overdueTasks.map(t => ({
        titre: t.title,
        priorite: t.priority,
        echeance: t.dueDate,
        assigneA: t.assignedTo || "Non assigne",
        status: t.status,
      })),
      tachesHautePriorite: highPriorityPending.map(t => ({
        titre: t.title,
        echeance: t.dueDate,
        assigneA: t.assignedTo || "Non assigne",
      })),
      tachesProchaines48h: upcomingTasks48h.map(t => ({
        titre: t.title,
        priorite: t.priority,
        echeance: t.dueDate,
      })),
      messagesNonLus: unreadMessages.map((m, i) => ({
        index: i + 1,
        expediteur: m.contactName || "Inconnu",
        resume: m.content.slice(0, 150),
        priorite: m.priority,
        type: m.type,
      })),
      appelsManquesRecents: recentMissedCalls.map(c => ({
        contact: c.contactName || "Inconnu",
        date: c.createdAt,
        direction: c.direction,
      })),
      appels: {
        totalSemaine: totalWeekCalls,
        repondus: answeredCount,
        manques: missedCount,
        negatifs: negativeCount,
        sansContact: noContactCount,
        tauxReponse: answerRate,
        aujourdhui: todayCallCount,
      },
      contactsARelancer: staleContacts.map(c => ({
        nom: `${c.firstName} ${c.lastName}`,
        entreprise: c.company || "N/A",
        categorie: c.category,
        dernierAppel: c.lastCallAt,
      })),
      alertesStock: stockAlerts.map(s => ({
        article: s.name,
        reference: s.reference,
        quantite: s.quantity,
        seuilMin: s.minQuantity,
        categorie: s.category,
      })),
      pointage: {
        arrivesAujourdhui: todayCheckinCount,
      },
      heuresPointe: recentCallPatterns.map(p => ({
        heure: `${p.hour}h`,
        nbAppels: Number(p.callCount),
      })),
      progressionTaches: { tauxAchevement: taskRate, total: completionTotal, terminees: completionDone },
    };

    const currentHour = now.getHours();
    const currentMonth = now.getMonth() + 1;
    const echeancesFiscalesProches: string[] = [];
    const jourDuMois = now.getDate();
    if (jourDuMois >= 10 && jourDuMois <= 20) echeancesFiscalesProches.push("TVA mensuelle (entre le 15 et le 24)");
    if (currentMonth === 1 || currentMonth === 4 || currentMonth === 7 || currentMonth === 10) echeancesFiscalesProches.push("TVA trimestrielle");
    if (jourDuMois >= 1 && jourDuMois <= 10) echeancesFiscalesProches.push("URSSAF (entre le 5 et le 15)");
    if (currentMonth === 5 && jourDuMois <= 20) echeancesFiscalesProches.push("Liasse fiscale (2e quinzaine de mai)");
    if (currentMonth === 12 && jourDuMois >= 15) echeancesFiscalesProches.push("CFE (15 decembre)");

    const { ai } = await import("@workspace/integrations-gemini-ai");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `Tu es l'Assistant Executif d'Aurelie, Comptable & Secretaire en gestion autonome (sans assistant humain).
TON ROLE : Remplacer un assistant humain. Filtrer, prioriser, rediger, anticiper. Zero perte de temps.

PROFIL AURELIE :
- Cumul Comptable + Secretaire (seule au poste)
- Objectif : Reduire la gestion administrative de 4h a 30min/jour
- Planning optimal : Appels et urgences le matin / Saisie comptable et travail de fond l'apres-midi

DONNEES EN TEMPS REEL :
${JSON.stringify(contextForAI, null, 2)}

Heure actuelle : ${currentHour}h | Jour du mois : ${jourDuMois}
Echeances fiscales proches : ${echeancesFiscalesProches.length > 0 ? echeancesFiscalesProches.join(", ") : "Aucune"}

=== MODULE 1 : RECONNAISSANCE IA (GESTION DE CRISE) ===
Score: ${scoreGlobal}/100 | Mode: ${modeCommando ? "COMMANDO" : "NORMAL"}
${modeCommando ? "MODE COMMANDO ACTIF." : ""}

Pour CHAQUE probleme : [PROBLEME] -> [SOLUTION] -> [ACTION]

MISSIONS COMPTABLES (prioritaires) :
- Taches en retard (${overdueTasks.length}) : Si relance paiement ou saisie comptable = CRITIQUE
- Rapprochement : Si pieces manquantes detectees, liste-les
- Echeances fiscales : ${echeancesFiscalesProches.length > 0 ? "ALERTES ACTIVES - Prevenir 5 jours avant, lister documents a preparer" : "RAS"}

MISSIONS SECRETARIAT :
- Messages critiques (${unreadMessages.filter(m => m.priority === "haute").length}) : Brouillon 90% finalise
- Appels manques (${missedCount} semaine) : Fiche de rappel avec script

=== MODULE 2 : COMMUNICATION & CONTACTS ===
TRI EISENHOWER de chaque message + ton adapte :
- Si expediteur contient "client" ou contexte client : Ton professionnel et rassurant
- Si expediteur contient "fournisseur" ou contexte achat : Ton ferme et factuel
- Sinon (interne) : Ton direct et efficace

FILTRE SOLO : Ne presente que ce qui necessite une decision humaine. Les resolutions automatisables = marquer comme "valider" directement.

Periodes 0 appels (${todayCallCount === 0 ? "ACTIF - 0 appels aujourd'hui" : todayCallCount + " appels"}) : Suggere 3 relances strategiques

=== MODULE 3 : LOGISTIQUE & STOCK (ANTICIPATION) ===
- FLUX TENDU : Croise stocks (${stockAlerts.length} alertes) avec taches 48h (${upcomingTasks48h.length})
- Si stock fournitures/timbres baisse : Prepare le panier d'achat SANS ATTENDRE
- Si rupture prevue 48h : Bon de commande pre-rempli
- PLANNING : Si ${currentHour < 12 ? "matin" : "apres-midi"}, verifie que les taches sont adaptees au creneau

=== MODULE 4 : FLASH INFO QUOTIDIEN ===
Genere un resume synthetique :
- Ce qui a ete fait (taches terminees, messages traites)
- Ce qui reste a faire demain
- Evolution du Score de Sante
${echeancesFiscalesProches.length > 0 ? "- ALERTES FISCALES avec documents a preparer" : ""}

=== FORMAT (ZERO BLABLA) ===
Ne demande JAMAIS "Comment puis-je aider". Tableaux pour les chiffres. Listes d'actions pour le reste.

JSON exact :
{
  "scoreSante": number,
  "niveauSante": "critique|alerte|vigilance|bon|excellent",
  "modeCommando": boolean,
  "briefingExecutif": "string (max 5 lignes, style telegraphique)",
  "resolutions": [
    {
      "probleme": "string (1 ligne, factuel)",
      "solution": "string (action concrete, pre-remplie si possible)",
      "categorie": "CRITIQUE|A_PLANIFIER|INFO",
      "module": "comptabilite|secretariat|logistique",
      "lien": "/taches|/appels|/messages|/stock|/contacts|/pointage",
      "actionType": "naviguer|copier|valider"
    }
  ],
  "brouillonsReponses": [
    {
      "index": number,
      "expediteur": "string",
      "eisenhower": "urgent_important|urgent|important|info",
      "tonMessage": "client|fournisseur|interne",
      "brouillon": "string (reponse 90% finalisee, ton adapte au type)",
      "sujetResume": "string (5 mots max)",
      "actionSuggestion": "string (que faire apres envoi)"
    }
  ],
  "fichesRappel": [
    {
      "contact": "string",
      "motif": "string",
      "priorite": "haute|moyenne|basse",
      "scriptAppel": "string (2 phrases d'accroche)",
      "lien": "/appels"
    }
  ],
  "relancesStrategiques": [
    {
      "nom": "string",
      "entreprise": "string",
      "joursDepuisDernierAppel": number,
      "potentiel": "string (pourquoi relancer maintenant)",
      "scriptRelance": "string (1 phrase d'accroche)",
      "prioriteRelance": "haute|moyenne|basse"
    }
  ],
  "alertesStock": [
    {
      "article": "string",
      "quantiteActuelle": number,
      "seuilMin": number,
      "urgence": "CRITIQUE|A_PLANIFIER|INFO",
      "action": "string",
      "rupturePrevue48h": boolean,
      "bonCommande": "string (si rupture: details bon de commande)"
    }
  ],
  "alertesFiscales": [
    {
      "echeance": "string (nom de l'echeance)",
      "dateButoir": "string (date approximative)",
      "documentsAPreparer": ["string"],
      "urgence": "CRITIQUE|A_PLANIFIER|INFO"
    }
  ],
  "optimisationsPlanning": [
    {
      "constat": "string (ecart detecte)",
      "suggestion": "string (optimisation proposee)"
    }
  ],
  "flashInfo": {
    "fait": ["string (taches/actions completees)"],
    "resteDemain": ["string (a faire demain)"],
    "evolutionScore": "string (tendance du score)"
  },
  "metriquesExpress": {
    "tauxReponse": "string (ex: 85%)",
    "tachesEnRetard": number,
    "messagesUrgents": number,
    "contactsARelancer": number,
    "articlesEnAlerte": number
  },
  "directiveStrategique": "string (la priorite numero 1)"
}

IMPORTANT: Tu ES l'assistant d'Aurelie. Agis, ne suggere pas. Chaque resolution = solution prete.`
        }],
      }],
      config: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    });

    const text = response.text ?? "{}";
    const SAFE_LINKS = new Set(["/taches", "/appels", "/messages", "/stock", "/contacts", "/pointage"]);
    const VALID_CATEGORIES = new Set(["CRITIQUE", "A_PLANIFIER", "INFO"]);
    const VALID_EISENHOWER = new Set(["urgent_important", "urgent", "important", "info"]);
    const VALID_ACTION_TYPES = new Set(["naviguer", "copier", "valider"]);
    const VALID_MODULES = new Set(["comptabilite", "secretariat", "logistique"]);
    const VALID_TONS = new Set(["client", "fournisseur", "interne"]);
    let parsed;
    try {
      const raw = JSON.parse(text);

      const sanitizedResolutions = Array.isArray(raw.resolutions) ? raw.resolutions.slice(0, 12).map((r: any) => ({
        probleme: typeof r.probleme === "string" ? r.probleme.slice(0, 200) : "",
        solution: typeof r.solution === "string" ? r.solution.slice(0, 400) : "",
        categorie: VALID_CATEGORIES.has(r.categorie) ? r.categorie : "INFO",
        module: VALID_MODULES.has(r.module) ? r.module : "comptabilite",
        lien: SAFE_LINKS.has(r.lien) ? r.lien : "/taches",
        actionType: VALID_ACTION_TYPES.has(r.actionType) ? r.actionType : "naviguer",
      })) : [];

      const sanitizedDrafts = Array.isArray(raw.brouillonsReponses) ? raw.brouillonsReponses.slice(0, 15).map((d: any) => {
        const idx = typeof d.index === "number" ? d.index : 0;
        const mapped = messageIdMap.find(m => m.index === idx);
        return {
          messageId: mapped ? mapped.id : null,
          expediteur: typeof d.expediteur === "string" ? d.expediteur.slice(0, 100) : "Inconnu",
          eisenhower: VALID_EISENHOWER.has(d.eisenhower) ? d.eisenhower : "info",
          tonMessage: VALID_TONS.has(d.tonMessage) ? d.tonMessage : "interne",
          brouillon: typeof d.brouillon === "string" ? d.brouillon.slice(0, 600) : "",
          sujetResume: typeof d.sujetResume === "string" ? d.sujetResume.slice(0, 80) : "",
          actionSuggestion: typeof d.actionSuggestion === "string" ? d.actionSuggestion.slice(0, 200) : "",
        };
      }) : [];

      const sanitizedFichesRappel = Array.isArray(raw.fichesRappel) ? raw.fichesRappel.slice(0, 5).map((f: any) => ({
        contact: typeof f.contact === "string" ? f.contact.slice(0, 100) : "",
        motif: typeof f.motif === "string" ? f.motif.slice(0, 200) : "",
        priorite: ["haute", "moyenne", "basse"].includes(f.priorite) ? f.priorite : "moyenne",
        scriptAppel: typeof f.scriptAppel === "string" ? f.scriptAppel.slice(0, 300) : "",
        lien: "/appels",
      })) : [];

      const sanitizedRelances = Array.isArray(raw.relancesStrategiques) ? raw.relancesStrategiques.slice(0, 8).map((c: any) => {
        const matchedContact = staleContacts.find(sc =>
          `${sc.firstName} ${sc.lastName}` === c.nom
        );
        return {
          nom: typeof c.nom === "string" ? c.nom.slice(0, 100) : "",
          entreprise: typeof c.entreprise === "string" ? c.entreprise.slice(0, 100) : "",
          telephone: matchedContact ? maskPhone(matchedContact.phone || "") : "",
          joursDepuisDernierAppel: typeof c.joursDepuisDernierAppel === "number" ? c.joursDepuisDernierAppel : 0,
          potentiel: typeof c.potentiel === "string" ? c.potentiel.slice(0, 200) : "",
          scriptRelance: typeof c.scriptRelance === "string" ? c.scriptRelance.slice(0, 300) : "",
          prioriteRelance: ["haute", "moyenne", "basse"].includes(c.prioriteRelance) ? c.prioriteRelance : "moyenne",
        };
      }) : [];

      const sanitizedStock = Array.isArray(raw.alertesStock) ? raw.alertesStock.slice(0, 8).map((s: any) => ({
        article: typeof s.article === "string" ? s.article.slice(0, 100) : "",
        quantiteActuelle: typeof s.quantiteActuelle === "number" ? s.quantiteActuelle : 0,
        seuilMin: typeof s.seuilMin === "number" ? s.seuilMin : 0,
        urgence: VALID_CATEGORIES.has(s.urgence) ? s.urgence : "INFO",
        action: typeof s.action === "string" ? s.action.slice(0, 200) : "",
        rupturePrevue48h: typeof s.rupturePrevue48h === "boolean" ? s.rupturePrevue48h : false,
        bonCommande: typeof s.bonCommande === "string" ? s.bonCommande.slice(0, 300) : "",
      })) : [];

      const sanitizedOptimisations = Array.isArray(raw.optimisationsPlanning) ? raw.optimisationsPlanning.slice(0, 4).map((o: any) => ({
        constat: typeof o.constat === "string" ? o.constat.slice(0, 200) : "",
        suggestion: typeof o.suggestion === "string" ? o.suggestion.slice(0, 300) : "",
      })) : [];

      const sanitizedFiscal = Array.isArray(raw.alertesFiscales) ? raw.alertesFiscales.slice(0, 4).map((a: any) => ({
        echeance: typeof a.echeance === "string" ? a.echeance.slice(0, 100) : "",
        dateButoir: typeof a.dateButoir === "string" ? a.dateButoir.slice(0, 50) : "",
        documentsAPreparer: Array.isArray(a.documentsAPreparer) ? a.documentsAPreparer.filter((d: any) => typeof d === "string").map((d: string) => d.slice(0, 100)).slice(0, 6) : [],
        urgence: VALID_CATEGORIES.has(a.urgence) ? a.urgence : "A_PLANIFIER",
      })) : [];

      const sanitizedFlash = raw.flashInfo && typeof raw.flashInfo === "object" ? {
        fait: Array.isArray(raw.flashInfo.fait) ? raw.flashInfo.fait.filter((f: any) => typeof f === "string").map((f: string) => f.slice(0, 150)).slice(0, 5) : [],
        resteDemain: Array.isArray(raw.flashInfo.resteDemain) ? raw.flashInfo.resteDemain.filter((r: any) => typeof r === "string").map((r: string) => r.slice(0, 150)).slice(0, 5) : [],
        evolutionScore: typeof raw.flashInfo.evolutionScore === "string" ? raw.flashInfo.evolutionScore.slice(0, 150) : "",
      } : { fait: [], resteDemain: [], evolutionScore: "" };

      parsed = {
        scoreSante: typeof raw.scoreSante === "number" ? raw.scoreSante : scoreGlobal,
        niveauSante: ["critique", "alerte", "vigilance", "bon", "excellent"].includes(raw.niveauSante) ? raw.niveauSante : (scoreGlobal >= 90 ? "excellent" : scoreGlobal >= 75 ? "bon" : scoreGlobal >= 50 ? "vigilance" : scoreGlobal >= 30 ? "alerte" : "critique"),
        modeCommando,
        briefingExecutif: typeof raw.briefingExecutif === "string" ? raw.briefingExecutif : "",
        resolutions: sanitizedResolutions,
        brouillonsReponses: sanitizedDrafts,
        fichesRappel: sanitizedFichesRappel,
        relancesStrategiques: sanitizedRelances,
        alertesStock: sanitizedStock,
        alertesFiscales: sanitizedFiscal,
        optimisationsPlanning: sanitizedOptimisations,
        flashInfo: sanitizedFlash,
        metriquesExpress: raw.metriquesExpress && typeof raw.metriquesExpress === "object" ? {
          tauxReponse: String(raw.metriquesExpress.tauxReponse ?? `${answerRate}%`),
          tachesEnRetard: Number(raw.metriquesExpress.tachesEnRetard ?? overdueTasks.length),
          messagesUrgents: Number(raw.metriquesExpress.messagesUrgents ?? unreadMessages.filter(m => m.priority === "haute").length),
          contactsARelancer: Number(raw.metriquesExpress.contactsARelancer ?? staleContacts.length),
          articlesEnAlerte: Number(raw.metriquesExpress.articlesEnAlerte ?? stockAlerts.length),
        } : {
          tauxReponse: `${answerRate}%`,
          tachesEnRetard: overdueTasks.length,
          messagesUrgents: unreadMessages.filter(m => m.priority === "haute").length,
          contactsARelancer: staleContacts.length,
          articlesEnAlerte: stockAlerts.length,
        },
        directiveStrategique: typeof raw.directiveStrategique === "string" ? raw.directiveStrategique : "",
      };
    } catch {
      parsed = {
        scoreSante: scoreGlobal,
        niveauSante: scoreGlobal >= 90 ? "excellent" : scoreGlobal >= 75 ? "bon" : scoreGlobal >= 50 ? "vigilance" : scoreGlobal >= 30 ? "alerte" : "critique",
        modeCommando,
        briefingExecutif: "",
        resolutions: [],
        brouillonsReponses: [],
        fichesRappel: [],
        relancesStrategiques: [],
        alertesStock: [],
        alertesFiscales: [],
        optimisationsPlanning: [],
        flashInfo: { fait: [], resteDemain: [], evolutionScore: "" },
        metriquesExpress: {
          tauxReponse: `${answerRate}%`,
          tachesEnRetard: overdueTasks.length,
          messagesUrgents: unreadMessages.filter(m => m.priority === "haute").length,
          contactsARelancer: staleContacts.length,
          articlesEnAlerte: stockAlerts.length,
        },
        directiveStrategique: "",
      };
    }

    res.json(parsed);
  } catch (error: any) {
    console.error("AI Central Intelligence error:", error);
    const isProduction = process.env.NODE_ENV === "production";
    res.status(500).json({
      error: "Erreur de l'Intelligence Centrale",
      ...(isProduction ? {} : { details: error.message }),
    });
  }
});

router.post("/ai/chat", async (req, res): Promise<void> => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }
    const { message, context, history } = req.body;
    if (!message?.trim()) { res.status(400).json({ error: "Message requis." }); return; }

    const { ai } = await import("@workspace/integrations-gemini-ai");
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const monthAgo = new Date(now.getTime() - 30 * 86400000);
    const orgCall = eq(callsTable.organisationId, orgId);
    const orgContact = eq(contactsTable.organisationId, orgId);
    const orgTask = eq(tasksTable.organisationId, orgId);
    const orgMsg = eq(messagesTable.organisationId, orgId);

    const [
      callStats, contactStats, taskStats, msgStats,
      recentCalls, overdueTasks, unreadMsgs,
      topContacts, urgentTasks,
    ] = await Promise.all([
      db.select({ total: count(), thisWeek: sql<number>`count(*) filter (where ${callsTable.createdAt} >= ${weekAgo.toISOString()})`, missed: sql<number>`count(*) filter (where ${callsTable.status} = 'manque')`, answered: sql<number>`count(*) filter (where ${callsTable.status} = 'repondu')` }).from(callsTable).where(orgCall),
      db.select({ total: count(), newThisWeek: sql<number>`count(*) filter (where ${contactsTable.createdAt} >= ${weekAgo.toISOString()})`, withEmail: sql<number>`count(*) filter (where ${contactsTable.email} is not null)` }).from(contactsTable).where(orgContact),
      db.select({ total: count(), pending: sql<number>`count(*) filter (where ${tasksTable.status} = 'en_attente')`, inProgress: sql<number>`count(*) filter (where ${tasksTable.status} = 'en_cours')`, completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'termine')`, overdue: sql<number>`count(*) filter (where ${tasksTable.dueDate} < now() and ${tasksTable.status} not in ('termine','annule'))` }).from(tasksTable).where(orgTask),
      db.select({ total: count(), unread: sql<number>`count(*) filter (where ${messagesTable.isRead} = false)` }).from(messagesTable).where(orgMsg),
      db.select({ contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber, status: callsTable.status, direction: callsTable.direction, sentiment: callsTable.sentiment, createdAt: callsTable.createdAt, notes: callsTable.notes }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))).orderBy(desc(callsTable.createdAt)).limit(10),
      db.select({ id: tasksTable.id, title: tasksTable.title, priority: tasksTable.priority, dueDate: tasksTable.dueDate, status: tasksTable.status }).from(tasksTable).where(and(orgTask, lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))).orderBy(desc(tasksTable.priority)).limit(10),
      db.select({ id: messagesTable.id, contactName: messagesTable.contactName, content: messagesTable.content, type: messagesTable.type, priority: messagesTable.priority, createdAt: messagesTable.createdAt }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))).orderBy(desc(messagesTable.createdAt)).limit(10),
      db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, company: contactsTable.company, phone: contactsTable.phone, totalCalls: contactsTable.totalCalls }).from(contactsTable).where(orgContact).orderBy(desc(contactsTable.totalCalls)).limit(10),
      db.select({ id: tasksTable.id, title: tasksTable.title, priority: tasksTable.priority, dueDate: tasksTable.dueDate }).from(tasksTable).where(and(orgTask, eq(tasksTable.priority, "haute"), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))).limit(10),
    ]);

    const chatHistory = (history || []).slice(-6).map((h: any) => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.content }],
    }));

    const systemContext = `Tu es l'Assistant IA Elite du bureau "Agent de Bureau" — le cerveau central de toute l'organisation. Tu as acces a TOUTES les donnees en temps reel du bureau.

DONNEES EN TEMPS REEL:
📞 Appels: ${callStats[0]?.total ?? 0} total, ${callStats[0]?.thisWeek ?? 0} cette semaine, ${callStats[0]?.missed ?? 0} manques, ${callStats[0]?.answered ?? 0} repondus
👥 Contacts: ${contactStats[0]?.total ?? 0} total, ${contactStats[0]?.newThisWeek ?? 0} nouveaux cette semaine
📋 Taches: ${taskStats[0]?.total ?? 0} total, ${taskStats[0]?.pending ?? 0} en attente, ${taskStats[0]?.inProgress ?? 0} en cours, ${taskStats[0]?.completed ?? 0} terminees, ${taskStats[0]?.overdue ?? 0} en retard
✉️ Messages: ${msgStats[0]?.total ?? 0} total, ${msgStats[0]?.unread ?? 0} non lus

APPELS RECENTS (7 derniers jours):
${JSON.stringify(recentCalls.slice(0, 5), null, 1)}

TACHES EN RETARD:
${JSON.stringify(overdueTasks.slice(0, 5), null, 1)}

MESSAGES NON LUS PRIORITAIRES:
${JSON.stringify(unreadMsgs.slice(0, 5), null, 1)}

CONTACTS LES PLUS ACTIFS:
${JSON.stringify(topContacts.slice(0, 5), null, 1)}

TACHES URGENTES (haute priorite):
${JSON.stringify(urgentTasks.slice(0, 5), null, 1)}

CONTEXTE UTILISATEUR: ${context ? JSON.stringify(context) : "Tableau de bord principal"}

REGLES:
1. Reponds TOUJOURS en francais avec un ton professionnel mais chaleureux
2. Sois PRECIS — cite des chiffres reels du bureau
3. Quand on te demande "que faire?", donne des ACTIONS CONCRETES numerotees
4. Si tu detectes un probleme, propose des solutions IMMEDIATES
5. Tu peux suggerer des actions automatiques: "Je peux relancer automatiquement les taches en retard si vous le souhaitez."
6. Pour les questions financieres ou de stock, sois factuel et prudent
7. Chaque reponse doit etre ACTIONNABLE — pas juste informative

Reponds en JSON: {"response": "texte", "actions": [{"label": "string", "type": "auto_fix|navigate|reminder", "target": "string", "details": "string"}], "insights": ["string"], "mood": "positif|neutre|alerte|critique"}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: systemContext }] },
        { role: "model", parts: [{ text: '{"response": "Pret a vous aider.", "actions": [], "insights": [], "mood": "positif"}' }] },
        ...chatHistory,
        { role: "user", parts: [{ text: message }] },
      ],
      config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
    });

    let parsed;
    try {
      parsed = JSON.parse(response.text ?? "{}");
    } catch {
      parsed = { response: response.text || "Reponse en cours de traitement...", actions: [], insights: [], mood: "neutre" };
    }

    res.json({
      message: parsed.response || "Je n'ai pas pu generer de reponse.",
      actions: parsed.actions || [],
      insights: parsed.insights || [],
      mood: parsed.mood || "neutre",
      stats: {
        calls: callStats[0],
        contacts: contactStats[0],
        tasks: taskStats[0],
        messages: msgStats[0],
      },
    });
  } catch (error: any) {
    console.error("AI Chat error:", error);
    const isProduction = process.env.NODE_ENV === "production";
    res.status(500).json({ error: "Erreur du chat IA", ...(isProduction ? {} : { details: error.message }) });
  }
});

router.get("/ai/predictions", async (req, res): Promise<void> => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

    const { ai } = await import("@workspace/integrations-gemini-ai");
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
    const threeWeeksAgo = new Date(now.getTime() - 21 * 86400000);
    const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);
    const orgCall = eq(callsTable.organisationId, orgId);
    const orgTask = eq(tasksTable.organisationId, orgId);
    const orgContact = eq(contactsTable.organisationId, orgId);

    const [
      callsWeek1, callsWeek2, callsWeek3, callsWeek4,
      tasksCompletedW1, tasksCompletedW2, tasksCompletedW3, tasksCompletedW4,
      tasksCreatedW1, tasksCreatedW2,
      contactsW1, contactsW2, contactsW3, contactsW4,
      callsByDayOfWeek, callsByHour,
      missedRateW1, missedRateW2,
      sentimentPositive, sentimentNegative,
    ] = await Promise.all([
      db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, threeWeeksAgo), lt(callsTable.createdAt, twoWeeksAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, fourWeeksAgo), lt(callsTable.createdAt, threeWeeksAgo))),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, weekAgo))),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, twoWeeksAgo), lt(tasksTable.updatedAt, weekAgo))),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, threeWeeksAgo), lt(tasksTable.updatedAt, twoWeeksAgo))),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, fourWeeksAgo), lt(tasksTable.updatedAt, threeWeeksAgo))),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, gte(tasksTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, gte(tasksTable.createdAt, twoWeeksAgo), lt(tasksTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(contactsTable).where(and(orgContact, gte(contactsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(contactsTable).where(and(orgContact, gte(contactsTable.createdAt, twoWeeksAgo), lt(contactsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(contactsTable).where(and(orgContact, gte(contactsTable.createdAt, threeWeeksAgo), lt(contactsTable.createdAt, twoWeeksAgo))),
      db.select({ count: count() }).from(contactsTable).where(and(orgContact, gte(contactsTable.createdAt, fourWeeksAgo), lt(contactsTable.createdAt, threeWeeksAgo))),
      db.select({ day: sql<string>`to_char(${callsTable.createdAt}, 'Dy')`, cnt: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, fourWeeksAgo))).groupBy(sql`to_char(${callsTable.createdAt}, 'Dy')`),
      db.select({ hour: sql<string>`extract(hour from ${callsTable.createdAt})::int`, cnt: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, fourWeeksAgo))).groupBy(sql`extract(hour from ${callsTable.createdAt})::int`),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.sentiment, "positif"), gte(callsTable.createdAt, fourWeeksAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, fourWeeksAgo))),
    ]);

    const historicalData = {
      calls: { week1: callsWeek1[0]?.count ?? 0, week2: callsWeek2[0]?.count ?? 0, week3: callsWeek3[0]?.count ?? 0, week4: callsWeek4[0]?.count ?? 0 },
      tasksCompleted: { week1: tasksCompletedW1[0]?.count ?? 0, week2: tasksCompletedW2[0]?.count ?? 0, week3: tasksCompletedW3[0]?.count ?? 0, week4: tasksCompletedW4[0]?.count ?? 0 },
      tasksCreated: { week1: tasksCreatedW1[0]?.count ?? 0, week2: tasksCreatedW2[0]?.count ?? 0 },
      contacts: { week1: contactsW1[0]?.count ?? 0, week2: contactsW2[0]?.count ?? 0, week3: contactsW3[0]?.count ?? 0, week4: contactsW4[0]?.count ?? 0 },
      missedCalls: { week1: missedRateW1[0]?.count ?? 0, week2: missedRateW2[0]?.count ?? 0 },
      sentiment: { positive: sentimentPositive[0]?.count ?? 0, negative: sentimentNegative[0]?.count ?? 0 },
      callsByDay: callsByDayOfWeek.map(d => ({ day: d.day, calls: d.cnt })),
      callsByHour: callsByHour.sort((a, b) => Number(a.hour) - Number(b.hour)).map(h => ({ hour: h.hour, calls: h.cnt })),
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `Tu es le moteur de prediction IA d'un bureau professionnel francais. Analyse les donnees historiques des 4 dernieres semaines et genere des PREDICTIONS PRECISES pour les 7 prochains jours.

DONNEES HISTORIQUES (semaine 4 = la plus recente):
${JSON.stringify(historicalData, null, 2)}

Genere des predictions en JSON avec cette structure:
{
  "callVolume": { "predicted": number, "trend": "hausse|baisse|stable", "confidence": number (0-100), "peakDay": "string", "peakHour": number, "reasoning": "string" },
  "taskCompletion": { "predictedCompleted": number, "predictedCreated": number, "velocityTrend": "acceleration|deceleration|stable", "bottleneckRisk": "faible|moyen|eleve", "reasoning": "string" },
  "contactGrowth": { "predictedNew": number, "trend": "croissance|stagnation|declin", "reasoning": "string" },
  "customerSatisfaction": { "score": number (0-100), "trend": "amelioration|degradation|stable", "riskFactors": ["string"], "reasoning": "string" },
  "operationalRisks": [{ "risk": "string", "probability": "haute|moyenne|faible", "impact": "critique|majeur|mineur", "mitigation": "string" }],
  "opportunities": [{ "opportunity": "string", "potentialImpact": "string", "actionRequired": "string" }],
  "weeklyForecast": [{ "day": "Lundi|Mardi|...", "callsPredicted": number, "tasksPredicted": number, "alertLevel": "vert|jaune|rouge" }],
  "strategicRecommendations": ["string"]
}

Sois PRECIS et base-toi sur les tendances reelles. Chaque prediction doit etre JUSTIFIEE.`
        }],
      }],
      config: { maxOutputTokens: 8192, responseMimeType: "application/json" },
    });

    let parsed;
    try {
      parsed = JSON.parse(response.text ?? "{}");
    } catch {
      parsed = { callVolume: { predicted: 0, trend: "stable", confidence: 50 }, taskCompletion: { predictedCompleted: 0, velocityTrend: "stable" }, contactGrowth: { predictedNew: 0, trend: "stable" }, customerSatisfaction: { score: 70, trend: "stable" }, operationalRisks: [], opportunities: [], weeklyForecast: [], strategicRecommendations: [] };
    }

    res.json({ predictions: parsed, historicalData, generatedAt: new Date().toISOString() });
  } catch (error: any) {
    console.error("AI Predictions error:", error);
    res.status(500).json({ error: "Erreur des predictions IA" });
  }
});

export default router;
