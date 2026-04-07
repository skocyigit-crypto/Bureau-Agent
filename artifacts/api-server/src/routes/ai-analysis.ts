import { Router } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, checkinsTable, platformConnectionsTable } from "@workspace/db";
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
    case "rapports": {
      const [totalReports, recentReports] = await Promise.all([
        db.select({ count: count() }).from(callsTable),
        db.select({ count: count() }).from(tasksTable).where(eq(tasksTable.status, "termine")),
      ]);
      return { totalCalls: totalReports[0]?.count ?? 0, completedTasks: recentReports[0]?.count ?? 0 };
    }
    case "logiciels": {
      const [totalContacts, totalCalls, totalTasks] = await Promise.all([
        db.select({ count: count() }).from(contactsTable),
        db.select({ count: count() }).from(callsTable),
        db.select({ count: count() }).from(tasksTable),
      ]);
      return { totalContacts: totalContacts[0]?.count ?? 0, totalCalls: totalCalls[0]?.count ?? 0, totalTasks: totalTasks[0]?.count ?? 0 };
    }
    case "pointage": {
      const [totalSessions, activeSessions, avgMinutes, lateArrivals] = await Promise.all([
        db.select({ count: count() }).from(checkinsTable).where(gte(checkinsTable.checkInAt, weekAgo)),
        db.select({ count: count() }).from(checkinsTable).where(eq(checkinsTable.status, "present")),
        db.select({ avg: sql<number>`coalesce(avg(${checkinsTable.totalMinutes}), 0)::int` }).from(checkinsTable).where(and(eq(checkinsTable.status, "termine"), gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(gte(checkinsTable.checkInAt, weekAgo), sql`extract(hour from ${checkinsTable.checkInAt}) >= 10`)),
      ]);
      return { sessionsThisWeek: totalSessions[0]?.count ?? 0, currentlyActive: activeSessions[0]?.count ?? 0, avgSessionMinutes: avgMinutes[0]?.avg ?? 0, lateArrivalsThisWeek: lateArrivals[0]?.count ?? 0 };
    }
    case "utilisateurs": {
      const [totalCalls, totalTasks, totalContacts, completedTasks] = await Promise.all([
        db.select({ count: count() }).from(callsTable),
        db.select({ count: count() }).from(tasksTable),
        db.select({ count: count() }).from(contactsTable),
        db.select({ count: count() }).from(tasksTable).where(eq(tasksTable.status, "termine")),
      ]);
      return { totalCalls: totalCalls[0]?.count ?? 0, totalTasks: totalTasks[0]?.count ?? 0, totalContacts: totalContacts[0]?.count ?? 0, completedTasks: completedTasks[0]?.count ?? 0 };
    }
    default:
      return {};
  }
}

router.post("/ai/suggest", async (req, res) => {
  try {
    const { page } = req.body;
    if (!page || !["dashboard", "calls", "contacts", "tasks", "messages", "rapports", "logiciels", "pointage", "utilisateurs"].includes(page)) {
      return res.status(400).json({ error: "Le parametre 'page' est requis." });
    }

    const contextData = await gatherContextForPage(page);
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

router.post("/ai/recognize", async (req, res) => {
  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

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
      db.select({ count: count() }).from(callsTable).where(gte(callsTable.createdAt, weekAgo)),
      db.select({ count: count() }).from(callsTable).where(and(eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(isNull(callsTable.contactId), gte(callsTable.createdAt, weekAgo))),
      db.select({
        phoneNumber: callsTable.phoneNumber,
        contactName: callsTable.contactName,
        callCount: count(),
      }).from(callsTable).where(gte(callsTable.createdAt, weekAgo)).groupBy(callsTable.phoneNumber, callsTable.contactName).having(sql`count(*) >= 3`).orderBy(desc(count())).limit(5),
      db.select({ count: count() }).from(tasksTable).where(and(lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))),
      db.select({ count: count() }).from(tasksTable).where(and(eq(tasksTable.priority, "haute"), eq(tasksTable.status, "en_attente"))),
      db.select({ count: count() }).from(messagesTable).where(eq(messagesTable.isRead, false)),
      db.select({ count: count() }).from(messagesTable).where(and(eq(messagesTable.isRead, false), eq(messagesTable.priority, "haute"))),
      db.select({ count: count() }).from(contactsTable).where(sql`${contactsTable.id} NOT IN (SELECT DISTINCT contact_id FROM calls WHERE contact_id IS NOT NULL AND created_at >= ${monthAgo.toISOString()})`),
      db.select({ count: count() }).from(contactsTable).where(isNull(contactsTable.email)),
      db.select({
        id: contactsTable.id,
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        company: contactsTable.company,
        category: contactsTable.category,
        callCount: sql<number>`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id})`.as("cc"),
      }).from(contactsTable).orderBy(desc(sql`(SELECT COUNT(*) FROM calls WHERE calls.contact_id = ${contactsTable.id})`)).limit(3),
      db.select({
        hour: sql<string>`extract(hour from ${callsTable.createdAt})`.as("hour"),
        count: count(),
      }).from(callsTable).where(gte(callsTable.createdAt, threeDaysAgo)).groupBy(sql`extract(hour from ${callsTable.createdAt})`).orderBy(desc(count())).limit(3),
      db.select({
        total: count(),
        completed: sql<number>`SUM(CASE WHEN status = 'termine' THEN 1 ELSE 0 END)`,
      }).from(tasksTable),
      db.select({ avg: avg(callsTable.duration) }).from(callsTable).where(and(eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(gte(callsTable.createdAt, threeDaysAgo), sql`${callsTable.duration} > 600`)),
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
        }).from(callsTable).where(eq(callsTable.contactId, parseInt(contactId))).orderBy(desc(callsTable.createdAt)).limit(5),
        db.select({
          title: tasksTable.title,
          status: tasksTable.status,
          priority: tasksTable.priority,
          dueDate: tasksTable.dueDate,
        }).from(tasksTable).where(eq(tasksTable.contactId, parseInt(contactId))).orderBy(desc(tasksTable.createdAt)).limit(5),
        db.select({
          firstName: contactsTable.firstName,
          lastName: contactsTable.lastName,
          company: contactsTable.company,
          category: contactsTable.category,
          notes: contactsTable.notes,
          email: contactsTable.email,
        }).from(contactsTable).where(eq(contactsTable.id, parseInt(contactId))).limit(1),
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
      }).from(callsTable).where(gte(callsTable.createdAt, weekAgo)),
      db.select({
        total: count(),
        pending: sql<number>`SUM(CASE WHEN status = 'en_attente' THEN 1 ELSE 0 END)`,
        overdue: sql<number>`SUM(CASE WHEN status != 'termine' AND status != 'annule' AND due_date < NOW() THEN 1 ELSE 0 END)`,
      }).from(tasksTable),
      db.select({
        total: count(),
        unread: sql<number>`SUM(CASE WHEN is_read = false THEN 1 ELSE 0 END)`,
      }).from(messagesTable),
      db.select({ count: count() }).from(contactsTable),
      db.select({ count: count() }).from(checkinsTable).where(gte(checkinsTable.checkInAt, monthAgo)),
      db.select({ count: count() }).from(usersTable),
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

export default router;
