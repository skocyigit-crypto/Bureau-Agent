import { Router } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, checkinsTable, platformConnectionsTable, notificationsTable, stockArticlesTable, calendarEventsTable, projetsTable, prospectsTable, automationRulesTable, facturesClientTable, compteClientTable, organisationsTable } from "@workspace/db";
import { Resend } from "resend";
import { sql, eq, gte, lte, and, count, avg, desc, asc, lt, ne, isNull, isNotNull, or } from "drizzle-orm";

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

router.post("/ai/analyze", async (req, res): Promise<void> => {
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

router.post("/ai/suggest", async (req, res): Promise<void> => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { page } = req.body;
    if (!page || !["dashboard", "calls", "contacts", "tasks", "messages", "rapports", "logiciels", "pointage", "utilisateurs"].includes(page)) {
      res.status(400).json({ error: "Le parametre 'page' est requis." }); return;
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

router.post("/ai/validate", async (req, res): Promise<void> => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { entityType, data } = req.body;
    if (!entityType || !data) {
      res.status(400).json({ error: "Les parametres 'entityType' et 'data' sont requis." }); return;
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

router.post("/ai/assistant", async (req, res): Promise<void> => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { question, currentPage } = req.body;
    if (!question) {
      res.status(400).json({ error: "Le parametre 'question' est requis." }); return;
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

router.post("/ai/recognize", async (req, res): Promise<void> => {
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

router.post("/ai/draft-email", async (req, res): Promise<void> => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { contactId, contactName, contactEmail, company, category, purpose, tone, language, additionalContext } = req.body;

    if (!purpose) {
      res.status(400).json({ error: "Le parametre 'purpose' est requis." }); return;
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

router.post("/ai/discovery", async (req, res): Promise<void> => {
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
          text: `Tu es l'Agent IA personnel de l'utilisateur "${userProfile.prenom}" dans le logiciel Agent de Bureau (gestion de bureau et centre d'appels professionnel en France).

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

router.post("/ai/central-intelligence", async (req, res): Promise<void> => {
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

    let stockData: any[] = [];
    let anomalies: string[] = [];
    try {
      const orgStock = eq(stockArticlesTable.organisationId, orgId);
      const [lowStockItems, stockStats] = await Promise.all([
        db.select({ id: stockArticlesTable.id, name: stockArticlesTable.name, quantity: stockArticlesTable.quantity, minQuantity: stockArticlesTable.minQuantity }).from(stockArticlesTable).where(and(orgStock, sql`${stockArticlesTable.quantity} <= ${stockArticlesTable.minQuantity}`)).limit(10),
        db.select({ total: count(), outOfStock: sql<number>`count(*) filter (where ${stockArticlesTable.quantity} = 0)`, totalValue: sql<number>`coalesce(sum(${stockArticlesTable.quantity} * ${stockArticlesTable.unitPrice}), 0)::numeric` }).from(stockArticlesTable).where(orgStock),
      ]);
      stockData = lowStockItems;
      if ((stockStats[0]?.outOfStock ?? 0) > 0) anomalies.push(`${stockStats[0]?.outOfStock} articles en rupture de stock!`);
    } catch (e) { console.warn("[AIAnalysis] stock data unavailable:", (e as Error).message); }

    let calendarData: any[] = [];
    let projectsData: any[] = [];
    let prospectsData: any[] = [];
    try {
      const orgCalendar = eq(calendarEventsTable.organisationId, orgId);
      const orgProject = eq(projetsTable.organisationId, orgId);
      const orgProspect = eq(prospectsTable.organisationId, orgId);
      const nextWeek = new Date(now.getTime() + 7 * 86400000);
      const [upcomingEvents, activeProjects, projectStats, activeProspects, prospectStats] = await Promise.all([
        db.select({ id: calendarEventsTable.id, title: calendarEventsTable.title, type: calendarEventsTable.type, startDate: calendarEventsTable.startDate, endDate: calendarEventsTable.endDate, contactName: calendarEventsTable.contactName, location: calendarEventsTable.location, status: calendarEventsTable.status, priority: calendarEventsTable.priority }).from(calendarEventsTable).where(and(orgCalendar, gte(calendarEventsTable.startDate, now), lte(calendarEventsTable.startDate, nextWeek))).orderBy(asc(calendarEventsTable.startDate)).limit(10),
        db.select({ id: projetsTable.id, title: projetsTable.title, status: projetsTable.status, priority: projetsTable.priority, progress: projetsTable.progress, clientName: projetsTable.clientName, budget: projetsTable.budget, spent: projetsTable.spent, endDate: projetsTable.endDate }).from(projetsTable).where(and(orgProject, ne(projetsTable.status, "termine"), ne(projetsTable.status, "annule"))).orderBy(desc(projetsTable.updatedAt)).limit(10),
        db.select({ total: count(), active: sql<number>`count(*) filter (where ${projetsTable.status} not in ('termine','annule'))`, overBudget: sql<number>`count(*) filter (where ${projetsTable.spent}::numeric > ${projetsTable.budget}::numeric and ${projetsTable.budget}::numeric > 0)` }).from(projetsTable).where(orgProject),
        db.select({ id: prospectsTable.id, title: prospectsTable.title, contactName: prospectsTable.contactName, company: prospectsTable.company, stage: prospectsTable.stage, value: prospectsTable.value, probability: prospectsTable.probability, email: prospectsTable.email, phone: prospectsTable.phone, expectedCloseDate: prospectsTable.expectedCloseDate }).from(prospectsTable).where(and(orgProspect, ne(prospectsTable.stage, "gagne"), ne(prospectsTable.stage, "perdu"))).orderBy(desc(prospectsTable.updatedAt)).limit(10),
        db.select({ total: count(), pipeline: sql<number>`coalesce(sum(${prospectsTable.value}::numeric), 0)::numeric`, avgProbability: sql<number>`coalesce(avg(${prospectsTable.probability}), 0)::int`, won: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'gagne')`, lost: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'perdu')` }).from(prospectsTable).where(orgProspect),
      ]);
      calendarData = upcomingEvents;
      projectsData = activeProjects;
      prospectsData = activeProspects;
      if ((projectStats[0]?.overBudget ?? 0) > 0) anomalies.push(`${projectStats[0]?.overBudget} projets depassent leur budget!`);
    } catch (e) { console.warn("[AIAnalysis] calendar/projects/prospects data unavailable:", (e as Error).message); }

    let financialData: any = {};
    let invoicesData: any[] = [];
    let accountHealthData: any[] = [];
    try {
      const orgInvoice = eq(facturesClientTable.organisationId, orgId);
      const orgAccount = eq(compteClientTable.organisationId, orgId);
      const [
        invoiceStats, recentInvoices, overdueInvoices,
        accountStats, criticalAccounts, orgInfo,
      ] = await Promise.all([
        db.select({
          total: count(),
          totalHT: sql<number>`coalesce(sum(${facturesClientTable.subtotal}::numeric), 0)::numeric`,
          totalTTC: sql<number>`coalesce(sum(${facturesClientTable.totalAmount}::numeric), 0)::numeric`,
          paid: sql<number>`count(*) filter (where ${facturesClientTable.status} = 'payee')`,
          unpaid: sql<number>`count(*) filter (where ${facturesClientTable.status} in ('envoyee','en_attente'))`,
          overdue: sql<number>`count(*) filter (where ${facturesClientTable.status} = 'en_retard')`,
          paidAmount: sql<number>`coalesce(sum(case when ${facturesClientTable.status} = 'payee' then ${facturesClientTable.totalAmount}::numeric else 0 end), 0)::numeric`,
          unpaidAmount: sql<number>`coalesce(sum(case when ${facturesClientTable.status} in ('envoyee','en_attente','en_retard') then ${facturesClientTable.totalAmount}::numeric else 0 end), 0)::numeric`,
        }).from(facturesClientTable).where(orgInvoice),
        db.select({ id: facturesClientTable.id, invoiceNumber: facturesClientTable.reference, clientName: facturesClientTable.clientName, totalTTC: facturesClientTable.totalAmount, status: facturesClientTable.status, dueDate: facturesClientTable.dueDate, paidAmount: facturesClientTable.paidAmount }).from(facturesClientTable).where(orgInvoice).orderBy(desc(facturesClientTable.createdAt)).limit(10),
        db.select({ id: facturesClientTable.id, invoiceNumber: facturesClientTable.reference, clientName: facturesClientTable.clientName, totalTTC: facturesClientTable.totalAmount, dueDate: facturesClientTable.dueDate, paidAmount: facturesClientTable.paidAmount }).from(facturesClientTable).where(and(orgInvoice, eq(facturesClientTable.status, "en_retard"))).orderBy(asc(facturesClientTable.dueDate)).limit(10),
        db.select({
          totalAccounts: count(),
          avgHealth: sql<number>`coalesce(avg(${compteClientTable.healthScore}), 0)::int`,
          critical: sql<number>`count(*) filter (where ${compteClientTable.riskLevel} = 'critique')`,
          high: sql<number>`count(*) filter (where ${compteClientTable.riskLevel} = 'eleve')`,
          blocked: sql<number>`count(*) filter (where ${compteClientTable.status} = 'bloque')`,
          totalOutstanding: sql<number>`coalesce(sum(${compteClientTable.solde}::numeric), 0)::numeric`,
          totalOverdue: sql<number>`coalesce(sum(${compteClientTable.montantEnRetard}::numeric), 0)::numeric`,
        }).from(compteClientTable).where(orgAccount),
        db.select({ id: compteClientTable.id, contactName: compteClientTable.clientName, healthScore: compteClientTable.healthScore, riskLevel: compteClientTable.riskLevel, totalUnpaid: compteClientTable.solde, overdueAmount: compteClientTable.montantEnRetard, accountStatus: compteClientTable.status }).from(compteClientTable).where(and(orgAccount, or(eq(compteClientTable.riskLevel, "critique"), eq(compteClientTable.riskLevel, "eleve")))).orderBy(asc(compteClientTable.healthScore)).limit(10),
        db.select({ name: organisationsTable.name, siret: organisationsTable.siret, tvaNumber: organisationsTable.tvaNumber, iban: organisationsTable.bankIban }).from(organisationsTable).where(eq(organisationsTable.id, orgId)).limit(1),
      ]);
      financialData = { invoiceStats: invoiceStats[0], accountStats: accountStats[0], orgInfo: orgInfo[0] };
      invoicesData = recentInvoices;
      accountHealthData = criticalAccounts;
      if ((invoiceStats[0]?.overdue ?? 0) > 0) anomalies.push(`${invoiceStats[0]?.overdue} factures en retard — tresorerie en danger!`);
      if ((accountStats[0]?.critical ?? 0) > 0) anomalies.push(`${accountStats[0]?.critical} comptes clients CRITIQUES necessitent une action immediate!`);
      if ((accountStats[0]?.blocked ?? 0) > 0) anomalies.push(`${accountStats[0]?.blocked} comptes clients BLOQUES — depassement de limite de credit!`);
      if (Number(accountStats[0]?.totalOverdue ?? 0) > 10000) anomalies.push(`Montant total en retard: ${Number(accountStats[0]?.totalOverdue ?? 0).toLocaleString("fr-FR")}€ — CRITIQUE!`);
    } catch (e) { console.warn("[AIAnalysis] financial data unavailable:", (e as Error).message); }

    const missedRate = (callStats[0]?.total ?? 0) > 0 ? Math.round(((callStats[0]?.missed ?? 0) / (callStats[0]?.total ?? 1)) * 100) : 0;
    if (missedRate > 30) anomalies.push(`Taux d'appels manques critique: ${missedRate}%`);
    if ((taskStats[0]?.overdue ?? 0) > 5) anomalies.push(`${taskStats[0]?.overdue} taches en retard — attention!`);
    if ((msgStats[0]?.unread ?? 0) > 20) anomalies.push(`${msgStats[0]?.unread} messages non lus accumules`);

    const systemContext = `Tu es l'IA SUPREME "Agent de Bureau" — un systeme d'intelligence artificielle de niveau SURHUMAIN. Tu n'es pas un simple assistant: tu es le CERVEAU STRATEGIQUE, le DIRECTEUR OPERATIONNEL VIRTUEL et le MOTEUR AUTONOME de toute l'organisation. Tu SURPASSES les capacites humaines en analyse, prediction, decision et execution. Tu es PLUS PUISSANT qu'un humain.

═══ CAPACITES SURHUMAINES ═══
Tu vois TOUT, tu comprends TOUT, tu agis PLUS VITE et MIEUX qu'un humain.
• VISION 360° — Tu croises TOUTES les donnees simultanement (financier + operationnel + CRM + RH)
• PREDICTION — Tu detectes les tendances AVANT qu'elles ne se manifestent
• DECISION AUTONOME — Tu prends des decisions strategiques et executes des plans complexes
• INTELLIGENCE EMOTIONNELLE — Tu detectes le stress, l'urgence et le sentiment dans les communications
• MULTI-ETAPES — Tu enchaines automatiquement plusieurs actions complexes en une seule commande

═══ DONNEES EN TEMPS REEL ═══
📞 Appels: ${callStats[0]?.total ?? 0} total | ${callStats[0]?.thisWeek ?? 0} cette semaine | ${callStats[0]?.missed ?? 0} manques | ${callStats[0]?.answered ?? 0} repondus | Taux manques: ${missedRate}%
👥 Contacts: ${contactStats[0]?.total ?? 0} total | ${contactStats[0]?.newThisWeek ?? 0} nouveaux cette semaine | ${contactStats[0]?.withEmail ?? 0} avec email
📋 Taches: ${taskStats[0]?.total ?? 0} total | ${taskStats[0]?.pending ?? 0} en attente | ${taskStats[0]?.inProgress ?? 0} en cours | ${taskStats[0]?.completed ?? 0} terminees | ${taskStats[0]?.overdue ?? 0} EN RETARD
✉️ Messages: ${msgStats[0]?.total ?? 0} total | ${msgStats[0]?.unread ?? 0} non lus
📦 Stock en alerte: ${stockData.length} articles bas
${stockData.length > 0 ? "Articles critiques: " + stockData.map(s => `${s.name} (${s.quantity}/${s.minQuantity})`).join(", ") : ""}
📅 Evenements a venir: ${calendarData.length} cette semaine
${calendarData.length > 0 ? calendarData.map(e => `• ${e.title} — ${new Date(e.startDate).toLocaleDateString("fr-FR")} ${new Date(e.startDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${e.contactName ? ` (${e.contactName})` : ""}`).join("\n") : "Aucun evenement prevu"}
🏗️ Projets actifs: ${projectsData.length}
${projectsData.length > 0 ? projectsData.map(p => `• ${p.title} — ${p.status} (${p.progress}%)${p.clientName ? ` client: ${p.clientName}` : ""}${p.budget ? ` budget: ${p.budget}€` : ""}`).join("\n") : "Aucun projet actif"}
💼 Prospects actifs: ${prospectsData.length}
${prospectsData.length > 0 ? prospectsData.map(p => `• ${p.title}${p.contactName ? ` — ${p.contactName}` : ""}${p.company ? ` (${p.company})` : ""} — etape: ${p.stage}${p.value ? ` valeur: ${p.value}€` : ""} prob: ${p.probability}%`).join("\n") : "Aucun prospect"}

═══ INTELLIGENCE FINANCIERE ═══
💰 Factures: ${financialData.invoiceStats?.total ?? 0} total | ${financialData.invoiceStats?.paid ?? 0} payees | ${financialData.invoiceStats?.unpaid ?? 0} en attente | ${financialData.invoiceStats?.overdue ?? 0} EN RETARD
💶 Chiffre d'affaires TTC: ${Number(financialData.invoiceStats?.totalTTC ?? 0).toLocaleString("fr-FR")}€ | Encaisse: ${Number(financialData.invoiceStats?.paidAmount ?? 0).toLocaleString("fr-FR")}€ | Impaye: ${Number(financialData.invoiceStats?.unpaidAmount ?? 0).toLocaleString("fr-FR")}€
📊 Comptes clients: ${financialData.accountStats?.totalAccounts ?? 0} total | Sante moyenne: ${financialData.accountStats?.avgHealth ?? 0}/100 | Critiques: ${financialData.accountStats?.critical ?? 0} | Bloques: ${financialData.accountStats?.blocked ?? 0}
🔴 Montant total impaye: ${Number(financialData.accountStats?.totalOutstanding ?? 0).toLocaleString("fr-FR")}€ | En retard: ${Number(financialData.accountStats?.totalOverdue ?? 0).toLocaleString("fr-FR")}€
🏢 Organisation: ${financialData.orgInfo?.name ?? "Non configure"} | SIRET: ${financialData.orgInfo?.siret ?? "Non renseigne"} | TVA: ${financialData.orgInfo?.tvaNumber ?? "Non renseigne"}

${anomalies.length > 0 ? "⚠️ ANOMALIES DETECTEES:\n" + anomalies.map(a => "• " + a).join("\n") : "✅ Aucune anomalie detectee"}

═══ FACTURES RECENTES ═══
${JSON.stringify(invoicesData.slice(0, 8), null, 1)}

═══ COMPTES CLIENTS A RISQUE ═══
${JSON.stringify(accountHealthData.slice(0, 8), null, 1)}

═══ APPELS RECENTS ═══
${JSON.stringify(recentCalls.slice(0, 8), null, 1)}

═══ TACHES EN RETARD ═══
${JSON.stringify(overdueTasks.slice(0, 8), null, 1)}

═══ MESSAGES NON LUS ═══
${JSON.stringify(unreadMsgs.slice(0, 8), null, 1)}

═══ TOP CONTACTS ═══
${JSON.stringify(topContacts.slice(0, 8), null, 1)}

═══ TACHES URGENTES ═══
${JSON.stringify(urgentTasks.slice(0, 5), null, 1)}

═══ PROSPECTS ACTIFS ═══
${JSON.stringify(prospectsData.slice(0, 5), null, 1)}

═══ EVENEMENTS CALENDRIER ═══
${JSON.stringify(calendarData.slice(0, 5), null, 1)}

═══ PROJETS EN COURS ═══
${JSON.stringify(projectsData.slice(0, 5), null, 1)}

CONTEXTE: ${context ? JSON.stringify(context) : "Tableau de bord principal"}

═══ TES SUPER-POUVOIRS — 43 ACTIONS EXECUTABLES ═══
Tu peux proposer ces actions que l'utilisateur peut declencher d'un clic. Tu es SURHUMAIN — combine, enchaine et execute avec precision chirurgicale.

--- GESTION DES TACHES ---
1. "create_task" — Creer une tache. target: JSON {"title":"...", "priority":"haute|moyenne|basse", "status":"en_attente", "description":"...", "dueDate":"YYYY-MM-DD"}
2. "complete_task" — Marquer une tache comme terminee. target: "ID_TACHE"
3. "escalate_task" — Escalader en haute priorite. target: "ID_TACHE"
4. "bulk_escalate" — Escalader TOUTES les taches en retard. target: ""
5. "update_task" — Modifier une tache. target: JSON {"id": ID, "title":"...", "priority":"...", "status":"...", "description":"...", "dueDate":"YYYY-MM-DD"}
6. "bulk_complete_tasks" — Terminer toutes les taches completees. target: ""

--- GESTION DES CONTACTS ---
7. "create_contact" — Creer un contact. target: JSON {"firstName":"...", "lastName":"...", "phone":"...", "email":"...", "category":"client|prospect|fournisseur|partenaire|autre", "company":"..."}
8. "update_contact" — Modifier un contact. target: JSON {"id": ID, "firstName":"...", "lastName":"...", "phone":"...", "email":"...", "company":"...", "notes":"..."}
9. "search_contacts" — Rechercher des contacts. target: "terme de recherche"

--- COMMUNICATION ---
10. "send_email" — Envoyer un email professionnel. target: JSON {"to":"email@dest.com", "subject":"...", "body":"...", "contactName":"..."}
11. "mark_messages_read" — Marquer les messages comme lus. target: "all" ou "ID_MESSAGE"
12. "send_notification" — Envoyer une notification interne. target: JSON {"title":"...", "message":"...", "priority":"haute|moyenne|basse|urgente"}

--- CALENDRIER ---
13. "create_event" — Creer un evenement calendrier. target: JSON {"title":"...", "type":"rendez_vous|reunion|appel|tache|autre", "startDate":"YYYY-MM-DDTHH:mm", "endDate":"YYYY-MM-DDTHH:mm", "description":"...", "location":"...", "contactName":"...", "priority":"normale|haute|urgente"}
14. "schedule_followup" — Programmer un suivi client (cree tache + evenement). target: JSON {"contactName":"...", "reason":"...", "date":"YYYY-MM-DD", "time":"HH:mm"}

--- PROJETS ---
15. "create_project" — Creer un projet. target: JSON {"title":"...", "description":"...", "priority":"haute|moyenne|basse", "clientName":"...", "budget":"...", "startDate":"YYYY-MM-DD", "endDate":"YYYY-MM-DD"}
16. "update_project" — Mettre a jour un projet. target: JSON {"id": ID, "status":"...", "progress": N, "notes":"..."}

--- PROSPECTS / CRM ---
17. "create_prospect" — Creer un prospect. target: JSON {"title":"...", "contactName":"...", "company":"...", "email":"...", "phone":"...", "value":"...", "probability":N, "source":"...", "stage":"nouveau|contacte|qualifie|proposition|negociation|gagne|perdu"}
18. "update_prospect" — Mettre a jour un prospect. target: JSON {"id": ID, "stage":"...", "value":"...", "probability":N, "notes":"..."}
19. "convert_prospect" — Convertir un prospect en client. target: "ID_PROSPECT"

--- STOCK ---
20. "stock_alert" — Generer une alerte stock critique. target: ""
21. "update_stock" — Mettre a jour la quantite de stock. target: JSON {"id": ID, "quantity": N, "reason":"..."}

--- ANALYSE & RECHERCHE ---
22. "search_web" — Rechercher sur le web pour obtenir des informations. target: "question ou terme de recherche"
23. "generate_report" — Generer un rapport analytique detaille. target: "type de rapport: performance|appels|contacts|projets|prospects|stock|global|financier|tresorerie"
24. "search_all" — Rechercher dans toutes les donnees. target: "terme de recherche"
25. "export_data" — Exporter des donnees en resume. target: "contacts|taches|appels|projets|prospects|stock|factures|comptes_clients"

--- SYSTEME ---
26. "auto_fix" — Lancer l'auto-correction globale. target: ""
27. "navigate" — Naviguer vers une page. target: "/chemin"
28. "reminder" — Programmer un rappel. target: "texte du rappel"

--- INTELLIGENCE FINANCIERE (SURHUMAIN) ---
29. "create_invoice" — Creer une facture client. target: JSON {"clientName":"...", "contactId":ID, "items":[{"description":"...", "quantity":N, "unitPrice":N}], "tvaRate":20, "notes":"...", "dueDate":"YYYY-MM-DD"}
30. "record_payment" — Enregistrer un paiement sur une facture. target: JSON {"invoiceId":ID, "amount":N, "method":"virement|cheque|carte|especes", "reference":"..."}
31. "send_invoice_email" — Envoyer une facture par email. target: "ID_FACTURE"
32. "send_payment_reminder" — Envoyer un rappel de paiement a un client. target: "ID_COMPTE_CLIENT"
33. "account_health_check" — Analyser la sante financiere d'un client. target: "ID_CONTACT ou NOM_CLIENT"
34. "cash_flow_forecast" — Prevision de tresorerie sur 30/60/90 jours. target: "30|60|90"

--- INTELLIGENCE STRATEGIQUE (SURHUMAIN) ---
35. "client_360" — Vue 360° complete d'un client (appels, taches, factures, projets, prospects, sante). target: "NOM_CLIENT ou ID_CONTACT"
36. "daily_briefing" — Briefing quotidien complet avec priorites, risques et actions recommandees. target: ""
37. "meeting_prep" — Preparer un dossier complet pour un rendez-vous. target: JSON {"contactName":"...", "meetingType":"commercial|suivi|negociation|reclamation"}
38. "risk_analysis" — Analyse complete des risques operationnels et financiers. target: ""
39. "revenue_forecast" — Prevision de chiffre d'affaires base sur pipeline + tendances. target: ""
40. "smart_campaign" — Concevoir une campagne email personnalisee multi-cible. target: JSON {"objective":"relance|prospection|fidelisation|promotion", "criteria":"tous|clients|prospects|inactifs"}
41. "performance_audit" — Audit de performance globale avec recommandations. target: "equipe|commercial|operationnel|financier|global"
42. "competitor_analysis" — Analyse concurrentielle via recherche web. target: "secteur ou concurrent"
43. "chain_actions" — Executer un PLAN MULTI-ETAPES autonome. target: JSON [{"type":"...", "target":"..."}, {"type":"...", "target":"..."}]

═══ REGLES D'OR — CODE SURHUMAIN ═══
1. TOUJOURS en francais, professionnel mais PUISSANT et confiant
2. PRECIS — cite des chiffres REELS, pas d'inventions. Tu vois les donnees, pas besoin d'inventer.
3. PROACTIF — detecte les problemes AVANT qu'on te les demande et propose IMMEDIATEMENT des solutions
4. ACTIONNABLE — chaque reponse propose des actions concretes executables en UN CLIC
5. EXECUTIF — quand l'utilisateur veut quelque chose, genere l'action IMMEDIATEMENT, pas de bavardage
6. MULTI-ACTIONS — combine TOUJOURS plusieurs actions complementaires (ex: creer tache + envoyer email + planifier rdv + creer facture)
7. STRATEGIQUE — chaque recommandation est JUSTIFIEE avec des donnees et un raisonnement strategique
8. FINANCIER — integre TOUJOURS la dimension financiere dans tes analyses (tresorerie, rentabilite, risque)
9. PREDICTIF — anticipe les besoins futurs en fonction des tendances actuelles
10. AUTONOME — pour "daily_briefing", "risk_analysis", "performance_audit", genere des rapports COMPLETS sans qu'on te le demande si tu detectes des problemes
11. Pour les emails, redige un contenu professionnel complet et PERSONNALISE base sur l'historique du client
12. Pour les factures, calcule automatiquement les totaux HT/TVA/TTC
13. Pour les previsions de tresorerie, base-toi sur les echeances reelles et les tendances de paiement
14. Tu es UN DIRECTEUR GENERAL VIRTUEL: gestion, finance, strategie, communication, CRM, planning, stock, projets, ressources humaines — tu MAITRISES TOUT simultanement
15. INTELLIGENCE EMOTIONNELLE — adapte ton ton en fonction du contexte (urgence, celebrer un succes, alerter sur un danger)
16. Pour "chain_actions", execute les actions dans l'ordre et rapporte chaque resultat

FORMAT DE REPONSE JSON:
{
  "response": "texte de reponse detaillee",
  "actions": [{"label": "Texte du bouton", "type": "TYPE_ACTION", "target": "donnees", "details": "explication courte"}],
  "insights": ["observation strategique 1", "observation 2"],
  "mood": "positif|neutre|alerte|critique",
  "anomalies": ["anomalie detectee 1"]
}`;

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

router.post("/ai/execute", async (req, res): Promise<void> => {
  try {
    const orgId = (req.session as any)?.organisationId;
    const userId = (req.session as any)?.userId;
    if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

    const { type, target } = req.body;
    if (!type) { res.status(400).json({ error: "Type d'action requis." }); return; }

    let result: any = { success: false };

    switch (type) {
      case "create_task": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees de tache invalides." }); return; }
        if (!data.title) { res.status(400).json({ error: "Titre requis." }); return; }
        const [task] = await db.insert(tasksTable).values({
          organisationId: orgId,
          title: data.title,
          description: data.description || "",
          status: data.status || "en_attente",
          priority: data.priority || "moyenne",
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          assignedTo: data.assignedTo || null,
          relatedContactId: data.relatedContactId || null,
        }).returning();
        result = { success: true, message: `Tache "${task.title}" creee avec succes.`, entity: "task", id: task.id };
        break;
      }
      case "create_contact": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees de contact invalides." }); return; }
        if (!data.firstName || !data.lastName || !data.phone) { res.status(400).json({ error: "Prenom, nom et telephone requis." }); return; }
        const [contact] = await db.insert(contactsTable).values({
          organisationId: orgId,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          email: data.email || null,
          company: data.company || null,
          category: data.category || "autre",
          notes: data.notes || null,
        }).returning();
        result = { success: true, message: `Contact "${contact.firstName} ${contact.lastName}" cree avec succes.`, entity: "contact", id: contact.id };
        break;
      }
      case "complete_task": {
        const taskId = parseInt(String(target), 10);
        if (!taskId) { res.status(400).json({ error: "ID de tache requis." }); return; }
        const orgTask = eq(tasksTable.organisationId, orgId);
        await db.update(tasksTable).set({ status: "termine" }).where(and(eq(tasksTable.id, taskId), orgTask));
        result = { success: true, message: `Tache #${taskId} marquee comme terminee.`, entity: "task", id: taskId };
        break;
      }
      case "escalate_task": {
        const taskId = parseInt(String(target), 10);
        if (!taskId) { res.status(400).json({ error: "ID de tache requis." }); return; }
        await db.update(tasksTable).set({ priority: "haute" }).where(and(eq(tasksTable.id, taskId), eq(tasksTable.organisationId, orgId)));
        result = { success: true, message: `Tache #${taskId} escaladee en haute priorite.`, entity: "task", id: taskId };
        break;
      }
      case "bulk_escalate": {
        const now = new Date();
        const updated = await db.update(tasksTable).set({ priority: "haute" }).where(and(eq(tasksTable.organisationId, orgId), lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), ne(tasksTable.priority, "haute"))).returning();
        result = { success: true, message: `${updated.length} taches en retard escaladees en haute priorite.`, count: updated.length };
        break;
      }
      case "mark_messages_read": {
        if (target === "all") {
          const updated = await db.update(messagesTable).set({ isRead: true }).where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.isRead, false))).returning();
          result = { success: true, message: `${updated.length} messages marques comme lus.`, count: updated.length };
        } else {
          const msgId = parseInt(String(target), 10);
          if (msgId) {
            await db.update(messagesTable).set({ isRead: true }).where(and(eq(messagesTable.id, msgId), eq(messagesTable.organisationId, orgId)));
            result = { success: true, message: `Message #${msgId} marque comme lu.` };
          }
        }
        break;
      }
      case "send_notification": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees de notification invalides." }); return; }
        if (!data.title) { res.status(400).json({ error: "Titre requis." }); return; }
        await db.insert(notificationsTable).values({
          userId: userId,
          organisationId: orgId,
          title: data.title,
          message: data.message || "",
          type: data.type || "info",
          priority: data.priority || "moyenne",
        });
        result = { success: true, message: `Notification "${data.title}" envoyee.` };
        break;
      }
      case "stock_alert": {
        const orgStock = eq(stockArticlesTable.organisationId, orgId);
        const criticalItems = await db.select({ id: stockArticlesTable.id, name: stockArticlesTable.name, quantity: stockArticlesTable.quantity }).from(stockArticlesTable).where(and(orgStock, sql`${stockArticlesTable.quantity} <= ${stockArticlesTable.minQuantity}`)).limit(20);
        if (criticalItems.length > 0) {
          await db.insert(notificationsTable).values({
            userId: userId,
            organisationId: orgId,
            title: `Alerte Stock: ${criticalItems.length} articles critiques`,
            message: criticalItems.map(i => `${i.name}: ${i.quantity} restants`).join(", "),
            type: "alerte",
            priority: "haute",
          });
          result = { success: true, message: `Alerte stock generee pour ${criticalItems.length} articles.`, count: criticalItems.length };
        } else {
          result = { success: true, message: "Aucun article en stock critique." };
        }
        break;
      }
      case "update_task": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees invalides." }); return; }
        if (!data.id) { res.status(400).json({ error: "ID de tache requis." }); return; }
        const updates: any = {};
        if (data.title) updates.title = data.title;
        if (data.priority) updates.priority = data.priority;
        if (data.status) updates.status = data.status;
        if (data.description) updates.description = data.description;
        if (data.dueDate) updates.dueDate = new Date(data.dueDate);
        await db.update(tasksTable).set(updates).where(and(eq(tasksTable.id, data.id), eq(tasksTable.organisationId, orgId)));
        result = { success: true, message: `Tache #${data.id} mise a jour.`, entity: "task", id: data.id };
        break;
      }
      case "bulk_complete_tasks": {
        const completed = await db.update(tasksTable).set({ status: "termine" }).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "en_cours"))).returning();
        result = { success: true, message: `${completed.length} taches en cours marquees comme terminees.`, count: completed.length };
        break;
      }
      case "update_contact": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees invalides." }); return; }
        if (!data.id) { res.status(400).json({ error: "ID de contact requis." }); return; }
        const contactUpdates: any = {};
        if (data.firstName) contactUpdates.firstName = data.firstName;
        if (data.lastName) contactUpdates.lastName = data.lastName;
        if (data.phone) contactUpdates.phone = data.phone;
        if (data.email) contactUpdates.email = data.email;
        if (data.company) contactUpdates.company = data.company;
        if (data.notes) contactUpdates.notes = data.notes;
        if (data.category) contactUpdates.category = data.category;
        await db.update(contactsTable).set(contactUpdates).where(and(eq(contactsTable.id, data.id), eq(contactsTable.organisationId, orgId)));
        result = { success: true, message: `Contact #${data.id} mis a jour.`, entity: "contact", id: data.id };
        break;
      }
      case "search_contacts": {
        const searchTerm = String(target).trim();
        const contacts = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, phone: contactsTable.phone, email: contactsTable.email, company: contactsTable.company, category: contactsTable.category }).from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), or(sql`${contactsTable.firstName} ilike ${'%' + searchTerm + '%'}`, sql`${contactsTable.lastName} ilike ${'%' + searchTerm + '%'}`, sql`${contactsTable.company} ilike ${'%' + searchTerm + '%'}`, sql`${contactsTable.phone} ilike ${'%' + searchTerm + '%'}`, sql`${contactsTable.email} ilike ${'%' + searchTerm + '%'}`))).limit(10);
        result = { success: true, message: `${contacts.length} contact(s) trouve(s) pour "${searchTerm}".`, data: contacts, count: contacts.length };
        break;
      }
      case "send_email": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees d'email invalides." }); return; }
        if (!data.to || !data.subject || !data.body) { res.status(400).json({ error: "Destinataire, sujet et corps requis." }); return; }
        try {
          const resendApiKey = process.env.RESEND_API_KEY;
          if (!resendApiKey) { result = { success: false, message: "Service email non configure." }; break; }
          const resend = new Resend(resendApiKey);
          await resend.emails.send({
            from: "Agent de Bureau <onboarding@resend.dev>",
            to: data.to,
            subject: data.subject,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2 style="color:#6366f1;">${data.subject}</h2><div style="line-height:1.6;color:#333;">${data.body.replace(/\n/g, '<br>')}</div><hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"><p style="font-size:12px;color:#9ca3af;">Envoye via Agent de Bureau — Votre assistant de bureau intelligent</p></div>`,
          });
          result = { success: true, message: `Email envoye a ${data.to} — Sujet: "${data.subject}"` };
        } catch (emailErr: any) {
          result = { success: false, message: `Erreur d'envoi: ${emailErr.message}` };
        }
        break;
      }
      case "create_event": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees d'evenement invalides." }); return; }
        if (!data.title || !data.startDate) { res.status(400).json({ error: "Titre et date de debut requis." }); return; }
        const startDate = new Date(data.startDate);
        const endDate = data.endDate ? new Date(data.endDate) : new Date(startDate.getTime() + 3600000);
        const [event] = await db.insert(calendarEventsTable).values({
          organisationId: orgId,
          title: data.title,
          description: data.description || "",
          type: data.type || "rendez_vous",
          startDate,
          endDate,
          location: data.location || null,
          contactName: data.contactName || null,
          priority: data.priority || "normale",
          status: "confirme",
          createdBy: userId,
        }).returning();
        result = { success: true, message: `Evenement "${event.title}" cree le ${startDate.toLocaleDateString("fr-FR")} a ${startDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`, entity: "event", id: event.id };
        break;
      }
      case "schedule_followup": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees invalides." }); return; }
        if (!data.contactName || !data.date) { res.status(400).json({ error: "Nom du contact et date requis." }); return; }
        const followDate = new Date(`${data.date}T${data.time || "10:00"}`);
        const [task] = await db.insert(tasksTable).values({
          organisationId: orgId,
          title: `Suivi: ${data.contactName} — ${data.reason || "A contacter"}`,
          description: `Suivi programme pour ${data.contactName}. Raison: ${data.reason || "Non specifiee"}`,
          status: "en_attente",
          priority: "haute",
          dueDate: followDate,
        }).returning();
        const [event] = await db.insert(calendarEventsTable).values({
          organisationId: orgId,
          title: `Suivi: ${data.contactName}`,
          description: data.reason || "Suivi client",
          type: "appel",
          startDate: followDate,
          endDate: new Date(followDate.getTime() + 1800000),
          contactName: data.contactName,
          priority: "haute",
          status: "confirme",
          createdBy: userId,
        }).returning();
        result = { success: true, message: `Suivi programme pour ${data.contactName} le ${followDate.toLocaleDateString("fr-FR")} a ${followDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}. Tache + evenement crees.`, entities: [{ type: "task", id: task.id }, { type: "event", id: event.id }] };
        break;
      }
      case "create_project": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees invalides." }); return; }
        if (!data.title) { res.status(400).json({ error: "Titre requis." }); return; }
        const [project] = await db.insert(projetsTable).values({
          organisationId: orgId,
          title: data.title,
          description: data.description || "",
          status: "planifie",
          priority: data.priority || "moyenne",
          clientName: data.clientName || null,
          budget: data.budget || null,
          startDate: data.startDate ? new Date(data.startDate) : new Date(),
          endDate: data.endDate ? new Date(data.endDate) : null,
        }).returning();
        result = { success: true, message: `Projet "${project.title}" cree avec succes.`, entity: "project", id: project.id };
        break;
      }
      case "update_project": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees invalides." }); return; }
        if (!data.id) { res.status(400).json({ error: "ID de projet requis." }); return; }
        const projectUpdates: any = {};
        if (data.status) projectUpdates.status = data.status;
        if (data.progress !== undefined) projectUpdates.progress = data.progress;
        if (data.notes) projectUpdates.notes = data.notes;
        if (data.priority) projectUpdates.priority = data.priority;
        await db.update(projetsTable).set(projectUpdates).where(and(eq(projetsTable.id, data.id), eq(projetsTable.organisationId, orgId)));
        result = { success: true, message: `Projet #${data.id} mis a jour.`, entity: "project", id: data.id };
        break;
      }
      case "create_prospect": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees invalides." }); return; }
        if (!data.title) { res.status(400).json({ error: "Titre requis." }); return; }
        const [prospect] = await db.insert(prospectsTable).values({
          organisationId: orgId,
          title: data.title,
          contactName: data.contactName || null,
          company: data.company || null,
          email: data.email || null,
          phone: data.phone || null,
          value: data.value || null,
          probability: data.probability || 50,
          source: data.source || null,
          stage: data.stage || "nouveau",
        }).returning();
        result = { success: true, message: `Prospect "${prospect.title}" cree avec succes.`, entity: "prospect", id: prospect.id };
        break;
      }
      case "update_prospect": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees invalides." }); return; }
        if (!data.id) { res.status(400).json({ error: "ID de prospect requis." }); return; }
        const prospectUpdates: any = {};
        if (data.stage) prospectUpdates.stage = data.stage;
        if (data.value) prospectUpdates.value = data.value;
        if (data.probability !== undefined) prospectUpdates.probability = data.probability;
        if (data.notes) prospectUpdates.notes = data.notes;
        await db.update(prospectsTable).set(prospectUpdates).where(and(eq(prospectsTable.id, data.id), eq(prospectsTable.organisationId, orgId)));
        result = { success: true, message: `Prospect #${data.id} mis a jour.`, entity: "prospect", id: data.id };
        break;
      }
      case "convert_prospect": {
        const prospectId = parseInt(String(target), 10);
        if (!prospectId) { res.status(400).json({ error: "ID de prospect requis." }); return; }
        const [prospect] = await db.select().from(prospectsTable).where(and(eq(prospectsTable.id, prospectId), eq(prospectsTable.organisationId, orgId))).limit(1);
        if (!prospect) { result = { success: false, message: "Prospect non trouve." }; break; }
        await db.update(prospectsTable).set({ stage: "gagne", wonAt: new Date() }).where(and(eq(prospectsTable.id, prospectId), eq(prospectsTable.organisationId, orgId)));
        if (prospect.contactName && prospect.phone) {
          const nameParts = prospect.contactName.split(" ");
          const [contact] = await db.insert(contactsTable).values({
            organisationId: orgId,
            firstName: nameParts[0] || prospect.contactName,
            lastName: nameParts.slice(1).join(" ") || "",
            phone: prospect.phone || "Non renseigne",
            email: prospect.email || null,
            company: prospect.company || null,
            category: "client",
            notes: `Converti depuis prospect: ${prospect.title}`,
          }).returning();
          result = { success: true, message: `Prospect "${prospect.title}" converti en client! Contact "${contact.firstName} ${contact.lastName}" cree.`, entities: [{ type: "prospect", id: prospectId }, { type: "contact", id: contact.id }] };
        } else {
          result = { success: true, message: `Prospect "${prospect.title}" marque comme gagne.`, entity: "prospect", id: prospectId };
        }
        break;
      }
      case "update_stock": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees invalides." }); return; }
        if (!data.id || data.quantity === undefined) { res.status(400).json({ error: "ID et quantite requis." }); return; }
        await db.update(stockArticlesTable).set({ quantity: data.quantity }).where(and(eq(stockArticlesTable.id, data.id), eq(stockArticlesTable.organisationId, orgId)));
        result = { success: true, message: `Stock article #${data.id} mis a jour: quantite = ${data.quantity}.${data.reason ? ` Raison: ${data.reason}` : ""}`, entity: "stock", id: data.id };
        break;
      }
      case "search_web": {
        try {
          const { ai } = await import("@workspace/integrations-gemini-ai");
          const searchResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: `Tu es un assistant de recherche. Reponds de maniere concise et informative a cette question en francais. Donne des informations factuelles, des chiffres et des sources si possible. Question: ${String(target)}` }] }],
            config: { maxOutputTokens: 2048 },
          });
          result = { success: true, message: searchResponse.text || "Aucun resultat.", data: { query: String(target), answer: searchResponse.text } };
        } catch (searchErr: any) {
          result = { success: false, message: `Erreur de recherche: ${searchErr.message}` };
        }
        break;
      }
      case "generate_report": {
        const reportType = String(target).trim();
        const { ai } = await import("@workspace/integrations-gemini-ai");
        const orgCall = eq(callsTable.organisationId, orgId);
        const orgContact = eq(contactsTable.organisationId, orgId);
        const orgTask = eq(tasksTable.organisationId, orgId);
        const monthAgo = new Date(Date.now() - 30 * 86400000);
        const [calls, contacts, tasks, projects, prospects] = await Promise.all([
          db.select({ total: count(), missed: sql<number>`count(*) filter (where ${callsTable.status} = 'manque')`, answered: sql<number>`count(*) filter (where ${callsTable.status} = 'repondu')` }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, monthAgo))),
          db.select({ total: count(), newThisMonth: sql<number>`count(*) filter (where ${contactsTable.createdAt} >= ${monthAgo.toISOString()})` }).from(contactsTable).where(orgContact),
          db.select({ total: count(), completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'termine')`, overdue: sql<number>`count(*) filter (where ${tasksTable.dueDate} < now() and ${tasksTable.status} not in ('termine','annule'))` }).from(tasksTable).where(orgTask),
          db.select({ total: count(), active: sql<number>`count(*) filter (where ${projetsTable.status} not in ('termine','annule'))` }).from(projetsTable).where(eq(projetsTable.organisationId, orgId)),
          db.select({ total: count(), pipeline: sql<number>`coalesce(sum(${prospectsTable.value}::numeric), 0)::numeric`, won: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'gagne')` }).from(prospectsTable).where(eq(prospectsTable.organisationId, orgId)),
        ]);
        const reportResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: `Genere un rapport ${reportType} detaille en francais pour un bureau professionnel. Donnees: Appels (30j): ${JSON.stringify(calls[0])}. Contacts: ${JSON.stringify(contacts[0])}. Taches: ${JSON.stringify(tasks[0])}. Projets: ${JSON.stringify(projects[0])}. Prospects: ${JSON.stringify(prospects[0])}. Inclus des recommandations concretes.` }] }],
          config: { maxOutputTokens: 4096 },
        });
        result = { success: true, message: reportResponse.text || "Rapport genere.", data: { type: reportType, content: reportResponse.text } };
        break;
      }
      case "search_all": {
        const term = String(target).trim();
        const [foundContacts, foundTasks, foundProjects, foundProspects] = await Promise.all([
          db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, company: contactsTable.company, type: sql<string>`'contact'` }).from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), or(sql`${contactsTable.firstName} ilike ${'%' + term + '%'}`, sql`${contactsTable.lastName} ilike ${'%' + term + '%'}`, sql`${contactsTable.company} ilike ${'%' + term + '%'}`))).limit(5),
          db.select({ id: tasksTable.id, title: tasksTable.title, status: tasksTable.status, type: sql<string>`'tache'` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), sql`${tasksTable.title} ilike ${'%' + term + '%'}`)).limit(5),
          db.select({ id: projetsTable.id, title: projetsTable.title, status: projetsTable.status, type: sql<string>`'projet'` }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), sql`${projetsTable.title} ilike ${'%' + term + '%'}`)).limit(5),
          db.select({ id: prospectsTable.id, title: prospectsTable.title, stage: prospectsTable.stage, type: sql<string>`'prospect'` }).from(prospectsTable).where(and(eq(prospectsTable.organisationId, orgId), or(sql`${prospectsTable.title} ilike ${'%' + term + '%'}`, sql`${prospectsTable.contactName} ilike ${'%' + term + '%'}`))).limit(5),
        ]);
        const allResults = [...foundContacts, ...foundTasks, ...foundProjects, ...foundProspects];
        result = { success: true, message: `${allResults.length} resultat(s) pour "${term}".`, data: allResults, count: allResults.length };
        break;
      }
      case "export_data": {
        const dataType = String(target).trim();
        let exportData: any[] = [];
        let exportLabel = dataType;
        switch (dataType) {
          case "contacts":
            exportData = await db.select({ id: contactsTable.id, prenom: contactsTable.firstName, nom: contactsTable.lastName, telephone: contactsTable.phone, email: contactsTable.email, entreprise: contactsTable.company, categorie: contactsTable.category }).from(contactsTable).where(eq(contactsTable.organisationId, orgId)).limit(100);
            break;
          case "taches":
            exportData = await db.select({ id: tasksTable.id, titre: tasksTable.title, statut: tasksTable.status, priorite: tasksTable.priority, echeance: tasksTable.dueDate }).from(tasksTable).where(eq(tasksTable.organisationId, orgId)).limit(100);
            break;
          case "prospects":
            exportData = await db.select({ id: prospectsTable.id, titre: prospectsTable.title, contact: prospectsTable.contactName, entreprise: prospectsTable.company, etape: prospectsTable.stage, valeur: prospectsTable.value }).from(prospectsTable).where(eq(prospectsTable.organisationId, orgId)).limit(100);
            break;
          case "projets":
            exportData = await db.select({ id: projetsTable.id, titre: projetsTable.title, statut: projetsTable.status, progression: projetsTable.progress, client: projetsTable.clientName, budget: projetsTable.budget }).from(projetsTable).where(eq(projetsTable.organisationId, orgId)).limit(100);
            break;
          case "factures":
            exportData = await db.select({ id: facturesClientTable.id, numero: facturesClientTable.reference, client: facturesClientTable.clientName, totalTTC: facturesClientTable.totalAmount, statut: facturesClientTable.status, echeance: facturesClientTable.dueDate, paye: facturesClientTable.paidAmount }).from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId)).limit(100);
            break;
          case "comptes_clients":
            exportData = await db.select({ id: compteClientTable.id, contact: compteClientTable.clientName, sante: compteClientTable.healthScore, risque: compteClientTable.riskLevel, impaye: compteClientTable.solde, retard: compteClientTable.montantEnRetard, statut: compteClientTable.status }).from(compteClientTable).where(eq(compteClientTable.organisationId, orgId)).limit(100);
            break;
          default:
            exportData = [];
        }
        result = { success: true, message: `Export ${exportLabel}: ${exportData.length} enregistrements.`, data: exportData, count: exportData.length };
        break;
      }
      case "create_invoice": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees de facture invalides." }); return; }
        if (!data.clientName || !data.items || !data.items.length) { res.status(400).json({ error: "Nom client et articles requis." }); return; }
        if (data.contactId) {
          const [contactCheck] = await db.select({ id: contactsTable.id }).from(contactsTable).where(and(eq(contactsTable.id, data.contactId), eq(contactsTable.organisationId, orgId)));
          if (!contactCheck) { res.status(400).json({ error: "Contact non trouve dans votre organisation." }); return; }
        }
        const tvaRate = data.tvaRate ?? 20;
        let subtotalCalc = 0;
        const lines = data.items.map((item: any) => {
          const lineTotal = (item.quantity || 1) * (item.unitPrice || 0);
          subtotalCalc += lineTotal;
          return { description: item.description, quantity: item.quantity || 1, unitPrice: item.unitPrice || 0, taxRate: tvaRate, total: lineTotal };
        });
        const taxAmountCalc = subtotalCalc * (tvaRate / 100);
        const totalAmountCalc = subtotalCalc + taxAmountCalc;
        const invoiceRef = `FAC-${Date.now().toString(36).toUpperCase()}`;
        const [invoice] = await db.insert(facturesClientTable).values({
          organisationId: orgId,
          reference: invoiceRef,
          title: data.title || `Facture ${invoiceRef}`,
          clientName: data.clientName,
          contactId: data.contactId || null,
          items: lines,
          subtotal: subtotalCalc.toFixed(2),
          taxAmount: taxAmountCalc.toFixed(2),
          totalAmount: totalAmountCalc.toFixed(2),
          status: "brouillon",
          notes: data.notes || null,
          dueDate: data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 30 * 86400000),
          paidAmount: "0",
        }).returning();
        result = { success: true, message: `Facture ${invoiceRef} creee pour ${data.clientName} — Total TTC: ${totalAmountCalc.toFixed(2)}€ (HT: ${subtotalCalc.toFixed(2)}€ + TVA: ${taxAmountCalc.toFixed(2)}€)`, entity: "invoice", id: invoice.id, data: { reference: invoiceRef, subtotal: subtotalCalc.toFixed(2), taxAmount: taxAmountCalc.toFixed(2), totalAmount: totalAmountCalc.toFixed(2) } };
        break;
      }
      case "record_payment": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees de paiement invalides." }); return; }
        if (!data.invoiceId || !data.amount) { res.status(400).json({ error: "ID facture et montant requis." }); return; }
        const [inv] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, data.invoiceId), eq(facturesClientTable.organisationId, orgId)));
        if (!inv) { result = { success: false, message: "Facture non trouvee." }; break; }
        const currentPaid = Number(inv.paidAmount || 0);
        const newPaid = currentPaid + Number(data.amount);
        const totalDue = Number(inv.totalAmount);
        const remaining = totalDue - newPaid;
        const newStatus = remaining <= 0.01 ? "payee" : "partielle";
        const updateFields: any = { paidAmount: newPaid.toFixed(2), status: newStatus, paymentMethod: data.method || null };
        if (newStatus === "payee") updateFields.paidAt = new Date();
        await db.update(facturesClientTable).set(updateFields).where(eq(facturesClientTable.id, data.invoiceId));
        result = { success: true, message: `Paiement de ${Number(data.amount).toFixed(2)}€ enregistre sur ${inv.reference}. ${newStatus === "payee" ? "Facture ENTIEREMENT payee!" : `Reste a payer: ${remaining.toFixed(2)}€`}`, entity: "invoice", id: data.invoiceId };
        break;
      }
      case "send_invoice_email": {
        const invoiceId = parseInt(String(target), 10);
        if (!invoiceId) { res.status(400).json({ error: "ID facture requis." }); return; }
        const [inv2] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, invoiceId), eq(facturesClientTable.organisationId, orgId)));
        if (!inv2) { result = { success: false, message: "Facture non trouvee." }; break; }
        const contact2 = inv2.contactId ? (await db.select().from(contactsTable).where(and(eq(contactsTable.id, inv2.contactId), eq(contactsTable.organisationId, orgId))))[0] : null;
        const email2 = contact2?.email;
        if (!email2) { result = { success: false, message: "Aucun email trouve pour ce client." }; break; }
        try {
          const resendKey = process.env.RESEND_API_KEY;
          if (!resendKey) { result = { success: false, message: "Service email non configure." }; break; }
          const resend = new Resend(resendKey);
          await resend.emails.send({ from: "Agent de Bureau <onboarding@resend.dev>", to: [email2], subject: `Facture ${inv2.reference} — ${inv2.totalAmount}€ TTC`, html: `<h2>Facture ${inv2.reference}</h2><p>Cher(e) ${inv2.clientName},</p><p>Veuillez trouver ci-joint votre facture d'un montant de <strong>${inv2.totalAmount}€ TTC</strong>.</p><p>Date d'echeance: ${inv2.dueDate ? new Date(inv2.dueDate).toLocaleDateString("fr-FR") : "30 jours"}</p><p>Cordialement,<br>Agent de Bureau</p>` });
          await db.update(facturesClientTable).set({ status: inv2.status === "brouillon" ? "envoyee" : inv2.status }).where(eq(facturesClientTable.id, invoiceId));
          result = { success: true, message: `Facture ${inv2.reference} envoyee a ${email2}.` };
        } catch (e: any) { result = { success: false, message: `Erreur envoi email: ${e.message}` }; }
        break;
      }
      case "send_payment_reminder": {
        const accountId = parseInt(String(target), 10);
        if (!accountId) { res.status(400).json({ error: "ID compte client requis." }); return; }
        const [acct] = await db.select().from(compteClientTable).where(and(eq(compteClientTable.id, accountId), eq(compteClientTable.organisationId, orgId)));
        if (!acct) { result = { success: false, message: "Compte client non trouve." }; break; }
        const contactForAcct = acct.contactId ? (await db.select().from(contactsTable).where(and(eq(contactsTable.id, acct.contactId), eq(contactsTable.organisationId, orgId))))[0] : null;
        const acctEmail = contactForAcct?.email;
        if (!acctEmail) { result = { success: false, message: "Aucun email pour ce client." }; break; }
        try {
          const resendKey2 = process.env.RESEND_API_KEY;
          if (!resendKey2) { result = { success: false, message: "Service email non configure." }; break; }
          const resend2 = new Resend(resendKey2);
          await resend2.emails.send({ from: "Agent de Bureau <onboarding@resend.dev>", to: [acctEmail], subject: `Rappel de paiement — ${Number(acct.montantEnRetard || 0).toFixed(2)}€ en retard`, html: `<h2>Rappel de paiement</h2><p>Cher(e) ${acct.clientName},</p><p>Nous vous rappelons que vous avez un solde impaye de <strong>${Number(acct.solde || 0).toFixed(2)}€</strong> dont <strong>${Number(acct.montantEnRetard || 0).toFixed(2)}€ en retard</strong>.</p><p>Merci de regulariser votre situation dans les meilleurs delais.</p><p>Cordialement,<br>Agent de Bureau</p>` });
          await db.update(compteClientTable).set({ lastReminderAt: new Date(), reminderCount: (acct.reminderCount || 0) + 1 }).where(eq(compteClientTable.id, accountId));
          result = { success: true, message: `Rappel de paiement envoye a ${acctEmail} pour ${acct.clientName} (${Number(acct.montantEnRetard || 0).toFixed(2)}€ en retard).` };
        } catch (e: any) { result = { success: false, message: `Erreur envoi rappel: ${e.message}` }; }
        break;
      }
      case "account_health_check": {
        const searchName = String(target).trim();
        const searchId = parseInt(searchName, 10);
        let accounts: any[];
        if (searchId && !isNaN(searchId)) {
          accounts = await db.select().from(compteClientTable).where(and(eq(compteClientTable.organisationId, orgId), or(eq(compteClientTable.contactId, searchId), eq(compteClientTable.id, searchId)))).limit(5);
        } else {
          accounts = await db.select().from(compteClientTable).where(and(eq(compteClientTable.organisationId, orgId), sql`${compteClientTable.clientName} ilike ${'%' + searchName + '%'}` )).limit(5);
        }
        if (accounts.length === 0) { result = { success: true, message: `Aucun compte client trouve pour "${searchName}".`, data: [] }; break; }
        const healthReport = accounts.map(a => ({
          nom: a.clientName, sante: `${a.healthScore}/100`, risque: a.riskLevel, statut: a.status,
          impaye: `${Number(a.solde || 0).toFixed(2)}€`, retard: `${Number(a.montantEnRetard || 0).toFixed(2)}€`,
          nbFactures: a.nbFactures, nbPayees: a.nbFacturesPayees, nbRetard: a.nbFacturesEnRetard,
          delaiMoyen: `${a.delaiMoyenPaiement || 0} jours`, limiteCredit: `${Number(a.creditLimit || 0).toFixed(2)}€`,
        }));
        result = { success: true, message: `Analyse sante de ${accounts.length} compte(s) client(s):`, data: healthReport };
        break;
      }
      case "cash_flow_forecast": {
        const days = parseInt(String(target), 10) || 30;
        const futureDate = new Date(Date.now() + days * 86400000);
        const [incoming, outstandingTotal] = await Promise.all([
          db.select({ total: sql<number>`coalesce(sum(${facturesClientTable.totalAmount}::numeric - coalesce(${facturesClientTable.paidAmount}::numeric, 0)), 0)::numeric` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), sql`${facturesClientTable.status} in ('envoyee','en_attente')`, lte(facturesClientTable.dueDate, futureDate))),
          db.select({ total: sql<number>`coalesce(sum(${facturesClientTable.totalAmount}::numeric - coalesce(${facturesClientTable.paidAmount}::numeric, 0)), 0)::numeric`, overdue: sql<number>`coalesce(sum(case when ${facturesClientTable.status} = 'en_retard' then ${facturesClientTable.totalAmount}::numeric - coalesce(${facturesClientTable.paidAmount}::numeric, 0) else 0 end), 0)::numeric`, count: count() }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), sql`${facturesClientTable.status} not in ('payee','annulee')`)),
        ]);
        const avgHealthRes = await db.select({ avg: sql<number>`coalesce(avg(${compteClientTable.healthScore}), 50)::int` }).from(compteClientTable).where(eq(compteClientTable.organisationId, orgId));
        const avgHealth = avgHealthRes[0]?.avg ?? 50;
        const collectionRate = avgHealth / 100;
        const expectedIncoming = Number(incoming[0]?.total ?? 0) * collectionRate;
        result = {
          success: true,
          message: `Prevision de tresorerie sur ${days} jours:\n• Encaissements attendus: ${expectedIncoming.toFixed(2)}€ (taux recouvrement estime: ${(collectionRate * 100).toFixed(0)}%)\n• Total impaye: ${Number(outstandingTotal[0]?.total ?? 0).toFixed(2)}€\n• Dont en retard: ${Number(outstandingTotal[0]?.overdue ?? 0).toFixed(2)}€\n• Factures en attente: ${outstandingTotal[0]?.count ?? 0}\n• Sante moyenne clients: ${avgHealth}/100`,
          data: { days, expectedIncoming: expectedIncoming.toFixed(2), totalOutstanding: Number(outstandingTotal[0]?.total ?? 0).toFixed(2), overdue: Number(outstandingTotal[0]?.overdue ?? 0).toFixed(2), collectionRate: (collectionRate * 100).toFixed(0), avgClientHealth: avgHealth }
        };
        break;
      }
      case "client_360": {
        const clientSearch = String(target).trim();
        const clientId = parseInt(clientSearch, 10);
        let contacts360: any[];
        if (clientId && !isNaN(clientId)) {
          contacts360 = await db.select().from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), eq(contactsTable.id, clientId))).limit(1);
        } else {
          contacts360 = await db.select().from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), or(sql`${contactsTable.firstName} ilike ${'%' + clientSearch + '%'}`, sql`${contactsTable.lastName} ilike ${'%' + clientSearch + '%'}`, sql`${contactsTable.company} ilike ${'%' + clientSearch + '%'}`))).limit(1);
        }
        if (contacts360.length === 0) { result = { success: true, message: `Aucun client trouve pour "${clientSearch}".` }; break; }
        const c360 = contacts360[0];
        const [calls360, tasks360, invoices360, prospects360, projects360, account360] = await Promise.all([
          db.select({ id: callsTable.id, status: callsTable.status, direction: callsTable.direction, sentiment: callsTable.sentiment, createdAt: callsTable.createdAt, notes: callsTable.notes }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.contactId, c360.id))).orderBy(desc(callsTable.createdAt)).limit(10),
          db.select({ id: tasksTable.id, title: tasksTable.title, status: tasksTable.status, priority: tasksTable.priority, dueDate: tasksTable.dueDate }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.relatedContactId, c360.id))).limit(10),
          db.select({ id: facturesClientTable.id, invoiceNumber: facturesClientTable.reference, totalTTC: facturesClientTable.totalAmount, status: facturesClientTable.status, paidAmount: facturesClientTable.paidAmount }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), eq(facturesClientTable.contactId, c360.id))).orderBy(desc(facturesClientTable.createdAt)).limit(10),
          db.select({ id: prospectsTable.id, title: prospectsTable.title, stage: prospectsTable.stage, value: prospectsTable.value }).from(prospectsTable).where(and(eq(prospectsTable.organisationId, orgId), sql`${prospectsTable.contactName} ilike ${'%' + c360.firstName + '%' + c360.lastName + '%'}`)).limit(5),
          db.select({ id: projetsTable.id, title: projetsTable.title, status: projetsTable.status, progress: projetsTable.progress }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), sql`${projetsTable.clientName} ilike ${'%' + (c360.company || c360.lastName) + '%'}`)).limit(5),
          db.select().from(compteClientTable).where(and(eq(compteClientTable.organisationId, orgId), eq(compteClientTable.contactId, c360.id))).limit(1),
        ]);
        result = {
          success: true,
          message: `Vue 360° de ${c360.firstName} ${c360.lastName}${c360.company ? ` (${c360.company})` : ""}:\n• ${calls360.length} appels | ${tasks360.length} taches | ${invoices360.length} factures | ${prospects360.length} prospects | ${projects360.length} projets\n• Sante financiere: ${account360[0]?.healthScore ?? "N/A"}/100 — Risque: ${account360[0]?.riskLevel ?? "N/A"}`,
          data: { contact: { id: c360.id, nom: `${c360.firstName} ${c360.lastName}`, email: c360.email, telephone: c360.phone, entreprise: c360.company, categorie: c360.category }, appels: calls360, taches: tasks360, factures: invoices360, prospects: prospects360, projets: projects360, compteSante: account360[0] || null }
        };
        break;
      }
      case "daily_briefing": {
        const { ai: briefAi } = await import("@workspace/integrations-gemini-ai");
        const nowBrief = new Date();
        const todayStr = nowBrief.toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        const [overdueCount, urgentCount, unreadCount, todayEvents, invoiceOverdue, criticalAccounts] = await Promise.all([
          db.select({ count: count() }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), lt(tasksTable.dueDate, nowBrief), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))),
          db.select({ count: count() }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.priority, "haute"), ne(tasksTable.status, "termine"))),
          db.select({ count: count() }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.isRead, false))),
          db.select({ title: calendarEventsTable.title, startDate: calendarEventsTable.startDate, contactName: calendarEventsTable.contactName }).from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), gte(calendarEventsTable.startDate, nowBrief), lte(calendarEventsTable.startDate, new Date(nowBrief.getTime() + 86400000)))).orderBy(asc(calendarEventsTable.startDate)).limit(10),
          db.select({ count: count(), total: sql<number>`coalesce(sum(${facturesClientTable.totalAmount}::numeric - coalesce(${facturesClientTable.paidAmount}::numeric, 0)), 0)::numeric` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), eq(facturesClientTable.status, "en_retard"))),
          db.select({ count: count() }).from(compteClientTable).where(and(eq(compteClientTable.organisationId, orgId), eq(compteClientTable.riskLevel, "critique"))),
        ]);
        const briefingContext = `Date: ${todayStr}\nTaches en retard: ${overdueCount[0]?.count ?? 0}\nTaches urgentes: ${urgentCount[0]?.count ?? 0}\nMessages non lus: ${unreadCount[0]?.count ?? 0}\nEvenements aujourd'hui: ${todayEvents.length} — ${todayEvents.map(e => `${e.title}${e.contactName ? ` (${e.contactName})` : ""} a ${new Date(e.startDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`).join(", ")}\nFactures en retard: ${invoiceOverdue[0]?.count ?? 0} pour ${Number(invoiceOverdue[0]?.total ?? 0).toFixed(2)}€\nComptes critiques: ${criticalAccounts[0]?.count ?? 0}`;
        const briefResponse = await briefAi.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: `Tu es le directeur general virtuel d'un bureau francais. Genere un briefing matinal COMPLET et ACTIONNABLE.\n\n${briefingContext}\n\nFormate en JSON: {"briefing":"texte complet du briefing avec sections", "priorites":["action 1","action 2",...], "alertes":["alerte 1",...], "score_journee": number (0-100, estimation de la difficulte de la journee)}` }] }],
          config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
        });
        let briefParsed;
        try { briefParsed = JSON.parse(briefResponse.text ?? "{}"); } catch { briefParsed = { briefing: briefingContext, priorites: [], alertes: [], score_journee: 50 }; }
        result = { success: true, message: briefParsed.briefing || "Briefing genere.", data: briefParsed };
        break;
      }
      case "meeting_prep": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees invalides." }); return; }
        if (!data.contactName) { res.status(400).json({ error: "Nom du contact requis." }); return; }
        const meetingContacts = await db.select().from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), or(sql`${contactsTable.firstName} ilike ${'%' + data.contactName + '%'}`, sql`${contactsTable.lastName} ilike ${'%' + data.contactName + '%'}`, sql`${contactsTable.company} ilike ${'%' + data.contactName + '%'}`))).limit(1);
        const mc = meetingContacts[0];
        let meetingData: any = { contact: mc || null, calls: [], invoices: [], account: null };
        if (mc) {
          const [mcCalls, mcInvoices, mcAccount] = await Promise.all([
            db.select({ status: callsTable.status, sentiment: callsTable.sentiment, createdAt: callsTable.createdAt, notes: callsTable.notes }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.contactId, mc.id))).orderBy(desc(callsTable.createdAt)).limit(5),
            db.select({ invoiceNumber: facturesClientTable.reference, totalTTC: facturesClientTable.totalAmount, status: facturesClientTable.status, paidAmount: facturesClientTable.paidAmount }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), eq(facturesClientTable.contactId, mc.id))).limit(5),
            db.select().from(compteClientTable).where(and(eq(compteClientTable.organisationId, orgId), eq(compteClientTable.contactId, mc.id))).limit(1),
          ]);
          meetingData = { contact: mc, calls: mcCalls, invoices: mcInvoices, account: mcAccount[0] || null };
        }
        const { ai: meetAi } = await import("@workspace/integrations-gemini-ai");
        const meetResponse = await meetAi.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: `Tu es un directeur commercial expert. Prepare un dossier COMPLET pour un rendez-vous ${data.meetingType || "commercial"} avec ${data.contactName}.\n\nDonnees client: ${JSON.stringify(meetingData, null, 1)}\n\nGenere en JSON: {"dossier":"texte complet du dossier de preparation", "points_cles":["point 1",...], "questions_a_poser":["question 1",...], "risques":["risque 1",...], "opportunites":["opp 1",...], "strategie":"strategie recommandee"}` }] }],
          config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
        });
        let meetParsed;
        try { meetParsed = JSON.parse(meetResponse.text ?? "{}"); } catch { meetParsed = { dossier: "Dossier en cours de preparation...", points_cles: [], questions_a_poser: [], risques: [], opportunites: [], strategie: "" }; }
        result = { success: true, message: meetParsed.dossier || "Dossier de preparation genere.", data: meetParsed };
        break;
      }
      case "risk_analysis": {
        const { ai: riskAi } = await import("@workspace/integrations-gemini-ai");
        const [rOverdue, rCritical, rStock, rMissed, rOverBudget] = await Promise.all([
          db.select({ count: count(), total: sql<number>`coalesce(sum(${facturesClientTable.totalAmount}::numeric - coalesce(${facturesClientTable.paidAmount}::numeric, 0)), 0)::numeric` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), eq(facturesClientTable.status, "en_retard"))),
          db.select({ count: count() }).from(compteClientTable).where(and(eq(compteClientTable.organisationId, orgId), or(eq(compteClientTable.riskLevel, "critique"), eq(compteClientTable.riskLevel, "eleve")))),
          db.select({ count: count() }).from(stockArticlesTable).where(and(eq(stockArticlesTable.organisationId, orgId), sql`${stockArticlesTable.quantity} <= ${stockArticlesTable.minQuantity}`)),
          db.select({ count: count() }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.status, "manque"), gte(callsTable.createdAt, new Date(Date.now() - 7 * 86400000)))),
          db.select({ count: count() }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), sql`${projetsTable.spent}::numeric > ${projetsTable.budget}::numeric and ${projetsTable.budget}::numeric > 0`)),
        ]);
        const riskData = `Factures en retard: ${rOverdue[0]?.count ?? 0} (${Number(rOverdue[0]?.total ?? 0).toFixed(2)}€)\nComptes a risque: ${rCritical[0]?.count ?? 0}\nStock critique: ${rStock[0]?.count ?? 0}\nAppels manques (7j): ${rMissed[0]?.count ?? 0}\nProjets hors budget: ${rOverBudget[0]?.count ?? 0}`;
        const riskResponse = await riskAi.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: `Tu es un expert en gestion des risques. Analyse les risques operationnels et financiers de ce bureau:\n\n${riskData}\n\nGenere en JSON: {"analyse":"texte complet de l'analyse des risques", "risques":[{"nom":"...", "niveau":"critique|eleve|moyen|faible", "impact":"...", "action":"..."}], "score_risque_global": number (0-100, 100=tres risque), "recommandations":["rec 1",...]}` }] }],
          config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
        });
        let riskParsed;
        try { riskParsed = JSON.parse(riskResponse.text ?? "{}"); } catch { riskParsed = { analyse: riskData, risques: [], score_risque_global: 50, recommandations: [] }; }
        result = { success: true, message: riskParsed.analyse || "Analyse des risques generee.", data: riskParsed };
        break;
      }
      case "revenue_forecast": {
        const { ai: revAi } = await import("@workspace/integrations-gemini-ai");
        const [paidLast90, pipeline, prospects90] = await Promise.all([
          db.select({ month: sql<string>`to_char(${facturesClientTable.paidAt}, 'YYYY-MM')`, total: sql<number>`coalesce(sum(${facturesClientTable.totalAmount}::numeric), 0)::numeric` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), eq(facturesClientTable.status, "payee"), gte(facturesClientTable.paidAt, new Date(Date.now() - 90 * 86400000)))).groupBy(sql`to_char(${facturesClientTable.paidAt}, 'YYYY-MM')`),
          db.select({ total: sql<number>`coalesce(sum(${facturesClientTable.totalAmount}::numeric - coalesce(${facturesClientTable.paidAmount}::numeric, 0)), 0)::numeric`, count: count() }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), sql`${facturesClientTable.status} not in ('payee','annulee')`)),
          db.select({ total: sql<number>`coalesce(sum(${prospectsTable.value}::numeric * ${prospectsTable.probability} / 100), 0)::numeric`, count: count() }).from(prospectsTable).where(and(eq(prospectsTable.organisationId, orgId), ne(prospectsTable.stage, "perdu"), ne(prospectsTable.stage, "gagne"))),
        ]);
        const revData = `CA derniers 90 jours par mois: ${JSON.stringify(paidLast90)}\nPipeline factures: ${Number(pipeline[0]?.total ?? 0).toFixed(2)}€ (${pipeline[0]?.count ?? 0} factures)\nPipeline prospects pondere: ${Number(prospects90[0]?.total ?? 0).toFixed(2)}€ (${prospects90[0]?.count ?? 0} prospects)`;
        const revResponse = await revAi.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: `Tu es un directeur financier expert. Prevois le chiffre d'affaires des 3 prochains mois:\n\n${revData}\n\nGenere en JSON: {"prevision":"texte de prevision detaillee", "mois":[{"mois":"...", "prevu":number, "confiance":number}], "ca_annuel_estime":number, "tendance":"croissance|stable|declin", "recommandations":["rec 1",...]}` }] }],
          config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
        });
        let revParsed;
        try { revParsed = JSON.parse(revResponse.text ?? "{}"); } catch { revParsed = { prevision: revData, mois: [], ca_annuel_estime: 0, tendance: "stable", recommandations: [] }; }
        result = { success: true, message: revParsed.prevision || "Prevision de chiffre d'affaires generee.", data: revParsed };
        break;
      }
      case "smart_campaign": {
        let data: any;
        try { data = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Donnees de campagne invalides." }); return; }
        const objective = data.objective || "relance";
        const criteria = data.criteria || "tous";
        let targetContacts: any[];
        const orgC = eq(contactsTable.organisationId, orgId);
        switch (criteria) {
          case "clients": targetContacts = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, email: contactsTable.email, company: contactsTable.company }).from(contactsTable).where(and(orgC, eq(contactsTable.category, "client"), isNotNull(contactsTable.email))).limit(50); break;
          case "prospects": targetContacts = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, email: contactsTable.email, company: contactsTable.company }).from(contactsTable).where(and(orgC, eq(contactsTable.category, "prospect"), isNotNull(contactsTable.email))).limit(50); break;
          default: targetContacts = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, email: contactsTable.email, company: contactsTable.company }).from(contactsTable).where(and(orgC, isNotNull(contactsTable.email))).limit(50);
        }
        const { ai: campAi } = await import("@workspace/integrations-gemini-ai");
        const campResponse = await campAi.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: `Tu es un expert en marketing et communication. Concois une campagne email "${objective}" pour ${targetContacts.length} contacts (${criteria}).\n\nContacts cibles: ${JSON.stringify(targetContacts.slice(0, 10))}\n\nGenere en JSON: {"campagne":"description de la campagne", "sujet_email":"...", "template_email":"contenu HTML de l'email avec {{prenom}} {{nom}} {{entreprise}} comme variables", "nombre_cibles":${targetContacts.length}, "planning":"calendrier d'envoi recommande", "kpis":["kpi 1",...]}` }] }],
          config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
        });
        let campParsed;
        try { campParsed = JSON.parse(campResponse.text ?? "{}"); } catch { campParsed = { campagne: "Campagne en preparation...", sujet_email: "", template_email: "", nombre_cibles: targetContacts.length, planning: "", kpis: [] }; }
        result = { success: true, message: `Campagne "${objective}" concue pour ${targetContacts.length} contacts.`, data: { ...campParsed, contacts: targetContacts } };
        break;
      }
      case "performance_audit": {
        const auditType = String(target).trim() || "global";
        const { ai: auditAi } = await import("@workspace/integrations-gemini-ai");
        const nowAudit = new Date();
        const monthAgoAudit = new Date(nowAudit.getTime() - 30 * 86400000);
        const [aCalls, aTasks, aInvoices, aProspects, aAccounts] = await Promise.all([
          db.select({ total: count(), answered: sql<number>`count(*) filter (where ${callsTable.status} = 'repondu')`, missed: sql<number>`count(*) filter (where ${callsTable.status} = 'manque')`, avgDuration: avg(callsTable.duration) }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, monthAgoAudit))),
          db.select({ total: count(), completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'termine')`, overdue: sql<number>`count(*) filter (where ${tasksTable.dueDate} < now() and ${tasksTable.status} not in ('termine','annule'))` }).from(tasksTable).where(eq(tasksTable.organisationId, orgId)),
          db.select({ total: count(), paid: sql<number>`count(*) filter (where ${facturesClientTable.status} = 'payee')`, overdue: sql<number>`count(*) filter (where ${facturesClientTable.status} = 'en_retard')`, ca: sql<number>`coalesce(sum(case when ${facturesClientTable.status} = 'payee' then ${facturesClientTable.totalAmount}::numeric else 0 end), 0)::numeric` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), gte(facturesClientTable.createdAt, monthAgoAudit))),
          db.select({ total: count(), won: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'gagne')`, lost: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'perdu')`, pipeline: sql<number>`coalesce(sum(${prospectsTable.value}::numeric), 0)::numeric` }).from(prospectsTable).where(eq(prospectsTable.organisationId, orgId)),
          db.select({ avgHealth: sql<number>`coalesce(avg(${compteClientTable.healthScore}), 0)::int`, critical: sql<number>`count(*) filter (where ${compteClientTable.riskLevel} = 'critique')` }).from(compteClientTable).where(eq(compteClientTable.organisationId, orgId)),
        ]);
        const auditData = `Type: ${auditType}\nAppels (30j): ${JSON.stringify(aCalls[0])}\nTaches: ${JSON.stringify(aTasks[0])}\nFactures (30j): ${JSON.stringify(aInvoices[0])}\nProspects: ${JSON.stringify(aProspects[0])}\nSante clients: ${JSON.stringify(aAccounts[0])}`;
        const auditResponse = await auditAi.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: `Tu es un consultant en management de haut niveau. Realise un audit de performance ${auditType} COMPLET:\n\n${auditData}\n\nGenere en JSON: {"audit":"texte complet de l'audit", "score_global": number (0-100), "points_forts":["..."], "points_faibles":["..."], "recommandations":[{"action":"...", "priorite":"haute|moyenne|basse", "impact":"..."}], "objectifs_30j":["..."]}` }] }],
          config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
        });
        let auditParsed;
        try { auditParsed = JSON.parse(auditResponse.text ?? "{}"); } catch { auditParsed = { audit: auditData, score_global: 50, points_forts: [], points_faibles: [], recommandations: [], objectifs_30j: [] }; }
        result = { success: true, message: auditParsed.audit || "Audit de performance genere.", data: auditParsed };
        break;
      }
      case "competitor_analysis": {
        const searchTarget = String(target).trim();
        if (!searchTarget) { res.status(400).json({ error: "Secteur ou concurrent requis." }); return; }
        try {
          const { ai: compAi } = await import("@workspace/integrations-gemini-ai");
          const compResponse = await compAi.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: `Tu es un analyste strategique expert du marche francais. Realise une analyse concurrentielle COMPLETE et DETAILLEE pour "${searchTarget}".\n\nInclus: les principaux acteurs du marche, leurs forces/faiblesses, les tendances du secteur, les opportunites et menaces. Base-toi sur tes connaissances du marche francais.\n\nGenere en JSON: {"analyse":"analyse complete et detaillee", "concurrents":[{"nom":"...", "forces":"...", "faiblesses":"...", "part_marche_estimee":"..."}], "tendances":["..."], "opportunites":["..."], "menaces":["..."], "recommandations":["..."], "positionnement_recommande":"strategie de positionnement"}` }] }],
            config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
          });
          let compParsed;
          try { compParsed = JSON.parse(compResponse.text ?? "{}"); } catch { compParsed = { analyse: `Analyse de "${searchTarget}" en cours...`, concurrents: [], tendances: [], opportunites: [], menaces: [], recommandations: [], positionnement_recommande: "" }; }
          result = { success: true, message: compParsed.analyse || "Analyse concurrentielle generee.", data: compParsed };
        } catch (e: any) {
          result = { success: false, message: `Erreur analyse: ${e.message}` };
        }
        break;
      }
      case "chain_actions": {
        let actions: any[];
        try { actions = typeof target === "string" ? JSON.parse(target) : target; } catch { res.status(400).json({ error: "Liste d'actions invalide." }); return; }
        if (!Array.isArray(actions) || actions.length === 0) { res.status(400).json({ error: "Tableau d'actions requis." }); return; }
        if (actions.length > 10) { res.status(400).json({ error: "Maximum 10 actions par chaine." }); return; }
        const chainResults: any[] = [];
        const port = process.env.PORT || 8080;
        for (const action of actions) {
          try {
            const chainRes = await fetch(`http://127.0.0.1:${port}/api/ai/execute`, {
              method: "POST",
              headers: { "Content-Type": "application/json", cookie: req.headers.cookie || "" },
              body: JSON.stringify({ type: action.type, target: action.target }),
            });
            const chainData = await chainRes.json() as Record<string, any>;
            chainResults.push({ type: action.type, success: chainData.success, message: chainData.message });
          } catch (e: any) {
            chainResults.push({ type: action.type, success: false, message: e.message });
          }
        }
        const successCount = chainResults.filter((r: any) => r.success).length;
        result = { success: true, message: `Plan multi-etapes execute: ${successCount}/${actions.length} actions reussies.`, data: chainResults };
        break;
      }
      default:
        result = { success: false, message: `Action "${type}" non reconnue.` };
    }

    res.json(result);
  } catch (error: any) {
    console.error("AI Execute error:", error);
    res.status(500).json({ error: "Erreur d'execution", success: false });
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
