import { Router } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, dailyReportsTable } from "@workspace/db";
import { sql, eq, gte, lte, and, count, avg, desc, between } from "drizzle-orm";

const router = Router();

const GOOGLE_SERVICES = [
  { id: "calendar", name: "Google Calendar", scope: "https://www.googleapis.com/auth/calendar" },
  { id: "gmail", name: "Gmail", scope: "https://www.googleapis.com/auth/gmail.modify" },
  { id: "drive", name: "Google Drive", scope: "https://www.googleapis.com/auth/drive" },
  { id: "docs", name: "Google Docs", scope: "https://www.googleapis.com/auth/documents" },
  { id: "sheets", name: "Google Sheets", scope: "https://www.googleapis.com/auth/spreadsheets" },
  { id: "slides", name: "Google Slides", scope: "https://www.googleapis.com/auth/presentations" },
];

const MICROSOFT_SERVICES = [
  { id: "outlook", name: "Microsoft Outlook", scope: "Mail.ReadWrite Calendars.ReadWrite" },
  { id: "teams", name: "Microsoft Teams", scope: "Team.ReadBasic.All Channel.ReadBasic.All" },
  { id: "onedrive", name: "Microsoft OneDrive", scope: "Files.ReadWrite.All" },
  { id: "word", name: "Microsoft Word", scope: "Files.ReadWrite.All" },
  { id: "excel", name: "Microsoft Excel", scope: "Files.ReadWrite.All" },
  { id: "powerpoint", name: "Microsoft PowerPoint", scope: "Files.ReadWrite.All" },
  { id: "sharepoint", name: "Microsoft SharePoint", scope: "Sites.ReadWrite.All" },
  { id: "onenote", name: "Microsoft OneNote", scope: "Notes.ReadWrite.All" },
  { id: "planner", name: "Microsoft Planner", scope: "Tasks.ReadWrite" },
  { id: "power-automate", name: "Power Automate", scope: "Flows.Manage.All" },
  { id: "power-bi", name: "Power BI", scope: "Dataset.ReadWrite.All" },
  { id: "dynamics", name: "Dynamics 365", scope: "user_impersonation" },
  { id: "intune", name: "Microsoft Intune", scope: "DeviceManagementManagedDevices.Read.All" },
  { id: "defender", name: "Microsoft Defender", scope: "ThreatAssessment.ReadWrite.All" },
  { id: "azure-ad", name: "Microsoft Entra ID", scope: "User.ReadWrite.All Directory.ReadWrite.All" },
  { id: "forms", name: "Microsoft Forms", scope: "Forms.Read" },
  { id: "bookings", name: "Microsoft Bookings", scope: "Bookings.ReadWrite.All" },
  { id: "yammer", name: "Viva Engage", scope: "Group.ReadWrite.All" },
  { id: "admin-365", name: "Microsoft 365 Admin", scope: "Organization.ReadWrite.All" },
];

const APPLE_SERVICES = [
  { id: "icloud-mail", name: "iCloud Mail", scope: "email" },
  { id: "icloud-calendar", name: "Calendrier iCloud", scope: "calendar" },
  { id: "icloud-drive", name: "iCloud Drive", scope: "cloudkit" },
  { id: "icloud-contacts", name: "Contacts iCloud", scope: "contacts" },
  { id: "pages", name: "Apple Pages", scope: "documents" },
  { id: "numbers", name: "Apple Numbers", scope: "documents" },
  { id: "keynote", name: "Apple Keynote", scope: "documents" },
  { id: "facetime", name: "FaceTime", scope: "communication" },
  { id: "imessage", name: "iMessage", scope: "messaging" },
  { id: "notes", name: "Apple Notes", scope: "notes" },
  { id: "reminders", name: "Apple Rappels", scope: "reminders" },
  { id: "find-my", name: "Localiser", scope: "location" },
  { id: "apple-business", name: "Apple Business Manager", scope: "mdm" },
];

router.get("/status", (_req, res) => {
  const services = GOOGLE_SERVICES.map(svc => ({
    id: svc.id,
    name: svc.name,
    status: "deconnecte" as const,
    lastSync: null,
    scope: svc.scope,
  }));

  res.json({
    connected: false,
    services,
    syncEnabled: false,
    lastGlobalSync: null,
  });
});

router.get("/platforms", (_req, res) => {
  const mapServices = (svcs: typeof GOOGLE_SERVICES) =>
    svcs.map(svc => ({ id: svc.id, name: svc.name, status: "deconnecte" as const, lastSync: null, scope: svc.scope }));

  res.json({
    platforms: [
      { id: "google", name: "Google Workspace", connected: false, services: mapServices(GOOGLE_SERVICES), totalServices: GOOGLE_SERVICES.length },
      { id: "microsoft", name: "Microsoft 365", connected: false, services: mapServices(MICROSOFT_SERVICES), totalServices: MICROSOFT_SERVICES.length },
      { id: "apple", name: "Apple / iCloud", connected: false, services: mapServices(APPLE_SERVICES), totalServices: APPLE_SERVICES.length },
    ],
    totalServices: GOOGLE_SERVICES.length + MICROSOFT_SERVICES.length + APPLE_SERVICES.length,
  });
});

router.get("/microsoft/status", (_req, res) => {
  const services = MICROSOFT_SERVICES.map(svc => ({
    id: svc.id,
    name: svc.name,
    status: "deconnecte" as const,
    lastSync: null,
    scope: svc.scope,
  }));
  res.json({ connected: false, services, syncEnabled: false, lastGlobalSync: null });
});

router.post("/microsoft/connect/:serviceId", (req, res) => {
  const { serviceId } = req.params;
  const service = MICROSOFT_SERVICES.find(s => s.id === serviceId);
  if (!service) return res.status(404).json({ error: "Service Microsoft inconnu." });
  res.json({
    status: "redirect",
    message: `Redirection vers Microsoft pour autoriser ${service.name}.`,
    authUrl: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?scope=${encodeURIComponent(service.scope)}&response_type=code&client_id=CONFIGURE_CLIENT_ID`,
    service: service.name,
  });
});

router.post("/microsoft/disconnect/:serviceId", (req, res) => {
  const { serviceId } = req.params;
  const service = MICROSOFT_SERVICES.find(s => s.id === serviceId);
  if (!service) return res.status(404).json({ error: "Service Microsoft inconnu." });
  res.json({ status: "deconnecte", message: `${service.name} a ete deconnecte.` });
});

router.get("/apple/status", (_req, res) => {
  const services = APPLE_SERVICES.map(svc => ({
    id: svc.id,
    name: svc.name,
    status: "deconnecte" as const,
    lastSync: null,
    scope: svc.scope,
  }));
  res.json({ connected: false, services, syncEnabled: false, lastGlobalSync: null });
});

router.post("/apple/connect/:serviceId", (req, res) => {
  const { serviceId } = req.params;
  const service = APPLE_SERVICES.find(s => s.id === serviceId);
  if (!service) return res.status(404).json({ error: "Service Apple inconnu." });
  res.json({
    status: "redirect",
    message: `Redirection vers Apple pour autoriser ${service.name}.`,
    authUrl: `https://appleid.apple.com/auth/authorize?scope=${encodeURIComponent(service.scope)}&response_type=code&client_id=CONFIGURE_CLIENT_ID`,
    service: service.name,
  });
});

router.post("/apple/disconnect/:serviceId", (req, res) => {
  const { serviceId } = req.params;
  const service = APPLE_SERVICES.find(s => s.id === serviceId);
  if (!service) return res.status(404).json({ error: "Service Apple inconnu." });
  res.json({ status: "deconnecte", message: `${service.name} a ete deconnecte.` });
});

router.post("/connect/:serviceId", (req, res) => {
  const { serviceId } = req.params;
  const service = GOOGLE_SERVICES.find(s => s.id === serviceId);
  if (!service) {
    return res.status(404).json({ error: "Service inconnu." });
  }

  res.json({
    status: "redirect",
    message: `Redirection vers Google pour autoriser ${service.name}.`,
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?scope=${encodeURIComponent(service.scope)}&response_type=code&client_id=CONFIGURE_CLIENT_ID`,
    service: service.name,
  });
});

router.post("/disconnect/:serviceId", (req, res) => {
  const { serviceId } = req.params;
  const service = GOOGLE_SERVICES.find(s => s.id === serviceId);
  if (!service) {
    return res.status(404).json({ error: "Service inconnu." });
  }

  res.json({
    status: "deconnecte",
    message: `${service.name} a ete deconnecte.`,
  });
});

router.post("/sync", (_req, res) => {
  res.json({
    status: "en_cours",
    message: "Synchronisation lancee. Les donnees seront mises a jour sous peu.",
    startedAt: new Date().toISOString(),
  });
});

router.get("/calendar/events", (_req, res) => {
  res.json({
    events: [],
    message: "Connectez Google Calendar pour voir vos evenements.",
    connected: false,
  });
});

router.get("/gmail/messages", (_req, res) => {
  res.json({
    messages: [],
    message: "Connectez Gmail pour voir vos e-mails.",
    connected: false,
  });
});

router.get("/drive/files", (_req, res) => {
  res.json({
    files: [],
    message: "Connectez Google Drive pour voir vos fichiers.",
    connected: false,
  });
});

router.get("/outlook/messages", (_req, res) => {
  res.json({ messages: [], message: "Connectez Microsoft Outlook pour voir vos e-mails.", connected: false });
});

router.get("/onedrive/files", (_req, res) => {
  res.json({ files: [], message: "Connectez Microsoft OneDrive pour voir vos fichiers.", connected: false });
});

router.get("/teams/channels", (_req, res) => {
  res.json({ channels: [], message: "Connectez Microsoft Teams pour voir vos channels.", connected: false });
});

router.get("/icloud/files", (_req, res) => {
  res.json({ files: [], message: "Connectez iCloud Drive pour voir vos fichiers.", connected: false });
});

async function gatherDailyData(dateStr: string) {
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

  const [
    callsResult,
    answeredCallsResult,
    missedCallsResult,
    avgDurationResult,
    inboundCallsResult,
    outboundCallsResult,
    tasksCompletedResult,
    tasksCreatedResult,
    tasksOverdueResult,
    highPriorityTasksResult,
    messagesResult,
    unreadMessagesResult,
    urgentMessagesResult,
    contactsAddedResult,
    recentCalls,
    recentTasks,
    recentMessages,
    sentimentPositive,
    sentimentNegative,
    sentimentNeutral,
  ] = await Promise.all([
    db.select({ count: count() }).from(callsTable).where(and(gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd))),
    db.select({ count: count() }).from(callsTable).where(and(gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.status, "repondu"))),
    db.select({ count: count() }).from(callsTable).where(and(gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.status, "manque"))),
    db.select({ avg: avg(callsTable.duration) }).from(callsTable).where(and(gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.status, "repondu"))),
    db.select({ count: count() }).from(callsTable).where(and(gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.direction, "entrant"))),
    db.select({ count: count() }).from(callsTable).where(and(gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.direction, "sortant"))),
    db.select({ count: count() }).from(tasksTable).where(and(gte(tasksTable.updatedAt, dayStart), lte(tasksTable.updatedAt, dayEnd), eq(tasksTable.status, "termine"))),
    db.select({ count: count() }).from(tasksTable).where(and(gte(tasksTable.createdAt, dayStart), lte(tasksTable.createdAt, dayEnd))),
    db.select({ count: count() }).from(tasksTable).where(and(eq(tasksTable.status, "en_attente"), eq(tasksTable.priority, "haute"))), // high priority pending
    db.select({ count: count() }).from(tasksTable).where(and(gte(tasksTable.createdAt, dayStart), lte(tasksTable.createdAt, dayEnd), eq(tasksTable.priority, "haute"))),
    db.select({ count: count() }).from(messagesTable).where(and(gte(messagesTable.createdAt, dayStart), lte(messagesTable.createdAt, dayEnd))),
    db.select({ count: count() }).from(messagesTable).where(and(gte(messagesTable.createdAt, dayStart), lte(messagesTable.createdAt, dayEnd), eq(messagesTable.isRead, false))),
    db.select({ count: count() }).from(messagesTable).where(and(gte(messagesTable.createdAt, dayStart), lte(messagesTable.createdAt, dayEnd), eq(messagesTable.priority, "haute"))),
    db.select({ count: count() }).from(contactsTable).where(and(gte(contactsTable.createdAt, dayStart), lte(contactsTable.createdAt, dayEnd))),
    db.select({
      contactName: callsTable.contactName,
      phoneNumber: callsTable.phoneNumber,
      direction: callsTable.direction,
      status: callsTable.status,
      duration: callsTable.duration,
      sentiment: callsTable.sentiment,
      notes: callsTable.notes,
    }).from(callsTable).where(and(gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd))).orderBy(desc(callsTable.createdAt)).limit(15),
    db.select({
      title: tasksTable.title,
      status: tasksTable.status,
      priority: tasksTable.priority,
    }).from(tasksTable).where(and(gte(tasksTable.createdAt, dayStart), lte(tasksTable.createdAt, dayEnd))).orderBy(desc(tasksTable.createdAt)).limit(15),
    db.select({
      content: messagesTable.content,
      type: messagesTable.type,
      priority: messagesTable.priority,
      contactName: messagesTable.contactName,
    }).from(messagesTable).where(and(gte(messagesTable.createdAt, dayStart), lte(messagesTable.createdAt, dayEnd))).orderBy(desc(messagesTable.createdAt)).limit(15),
    db.select({ count: count() }).from(callsTable).where(and(gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.sentiment, "positif"))),
    db.select({ count: count() }).from(callsTable).where(and(gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.sentiment, "negatif"))),
    db.select({ count: count() }).from(callsTable).where(and(gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.sentiment, "neutre"))),
  ]);

  const totalCalls = Number(callsResult[0]?.count ?? 0);
  const answeredCalls = Number(answeredCallsResult[0]?.count ?? 0);
  const missedCalls = Number(missedCallsResult[0]?.count ?? 0);
  const avgDuration = Math.round(Number(avgDurationResult[0]?.avg ?? 0));
  const inboundCalls = Number(inboundCallsResult[0]?.count ?? 0);
  const outboundCalls = Number(outboundCallsResult[0]?.count ?? 0);
  const tasksCompleted = Number(tasksCompletedResult[0]?.count ?? 0);
  const tasksCreated = Number(tasksCreatedResult[0]?.count ?? 0);
  const highPriorityPending = Number(tasksOverdueResult[0]?.count ?? 0);
  const highPriorityTasks = Number(highPriorityTasksResult[0]?.count ?? 0);
  const totalMessages = Number(messagesResult[0]?.count ?? 0);
  const unreadMessages = Number(unreadMessagesResult[0]?.count ?? 0);
  const urgentMessages = Number(urgentMessagesResult[0]?.count ?? 0);
  const contactsAdded = Number(contactsAddedResult[0]?.count ?? 0);
  const answerRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

  return {
    date: dateStr,
    calls: {
      total: totalCalls,
      answered: answeredCalls,
      missed: missedCalls,
      avgDuration,
      inbound: inboundCalls,
      outbound: outboundCalls,
      answerRate,
      sentiment: {
        positif: Number(sentimentPositive[0]?.count ?? 0),
        negatif: Number(sentimentNegative[0]?.count ?? 0),
        neutre: Number(sentimentNeutral[0]?.count ?? 0),
      },
    },
    tasks: {
      completed: tasksCompleted,
      created: tasksCreated,
      highPriorityPending,
      highPriority: highPriorityTasks,
    },
    messages: {
      total: totalMessages,
      unread: unreadMessages,
      urgent: urgentMessages,
    },
    contacts: {
      added: contactsAdded,
    },
    details: {
      recentCalls,
      recentTasks,
      recentMessages,
    },
  };
}

router.post("/daily-report", async (req, res) => {
  try {
    const body = req.body || {};
    const date = typeof body.date === "string" ? body.date.trim() : "";
    const reportDate = date || new Date().toISOString().split("T")[0];

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(reportDate)) {
      return res.status(400).json({ error: "Format de date invalide. Utilisez AAAA-MM-JJ." });
    }

    const dailyData = await gatherDailyData(reportDate);

    const { ai } = await import("@workspace/integrations-gemini-ai");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `Tu es un assistant IA professionnel pour un bureau en France. Genere un rapport journalier complet et detaille en francais pour la date du ${reportDate}.

Voici les donnees de la journee:

APPELS:
- Total: ${dailyData.calls.total} appels
- Repondus: ${dailyData.calls.answered} (${dailyData.calls.answerRate}%)
- Manques: ${dailyData.calls.missed}
- Entrants: ${dailyData.calls.inbound}, Sortants: ${dailyData.calls.outbound}
- Duree moyenne: ${dailyData.calls.avgDuration} secondes
- Sentiment: ${dailyData.calls.sentiment.positif} positif, ${dailyData.calls.sentiment.neutre} neutre, ${dailyData.calls.sentiment.negatif} negatif

TACHES:
- Creees: ${dailyData.tasks.created}
- Terminees: ${dailyData.tasks.completed}
- Haute priorite en attente: ${dailyData.tasks.highPriorityPending}
- Haute priorite du jour: ${dailyData.tasks.highPriority}

MESSAGES:
- Total: ${dailyData.messages.total}
- Non lus: ${dailyData.messages.unread}
- Urgents: ${dailyData.messages.urgent}

CONTACTS:
- Nouveaux: ${dailyData.contacts.added}

DETAILS DES APPELS (anonymises):
${dailyData.details.recentCalls.map((c, i) => `- Appel ${i + 1}: ${c.direction}, ${c.status}, ${c.duration}s, sentiment: ${c.sentiment || "inconnu"}`).join("\n")}

DETAILS DES TACHES (anonymisees):
${dailyData.details.recentTasks.map((t, i) => `- Tache ${i + 1}: ${t.status}, priorite ${t.priority}`).join("\n")}

DETAILS DES MESSAGES (anonymises):
${dailyData.details.recentMessages.map((m, i) => `- Message ${i + 1}: type ${m.type}, priorite ${m.priority}`).join("\n")}

IMPORTANT:
- N'utilise JAMAIS de noms de personnes reelles
- Sois precis et actionnable dans tes recommandations
- Donne un score de performance global de 0 a 100

Reponds en JSON avec cette structure exacte:
{
  "resume": "string (resume executif de la journee en 2-3 phrases)",
  "pointsForts": ["string (point fort 1)", "string (point fort 2)", ...],
  "pointsAttention": ["string (point d'attention 1)", ...],
  "recommandations": [
    {
      "titre": "string (titre court)",
      "description": "string (explication detaillee)",
      "priorite": "haute|moyenne|basse",
      "categorie": "appels|taches|messages|contacts|general"
    }
  ],
  "activites": [
    {
      "heure": "string (plage horaire estimee)",
      "description": "string (activite realisee)",
      "categorie": "appel|tache|message|contact"
    }
  ],
  "scorePerformance": number,
  "tendance": "hausse|stable|baisse",
  "prochainePriorite": "string (action prioritaire pour demain)"
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
      parsed = {
        resume: text,
        pointsForts: [],
        pointsAttention: [],
        recommandations: [],
        activites: [],
        scorePerformance: 0,
        tendance: "stable",
        prochainePriorite: "",
      };
    }

    const [savedReport] = await db.insert(dailyReportsTable).values({
      reportDate,
      summary: parsed.resume || "",
      highlights: parsed.pointsForts || [],
      metrics: {
        calls: dailyData.calls,
        tasks: dailyData.tasks,
        messages: dailyData.messages,
        contacts: dailyData.contacts,
        pointsAttention: parsed.pointsAttention || [],
        tendance: parsed.tendance || "stable",
        prochainePriorite: parsed.prochainePriorite || "",
        activites: parsed.activites || [],
      },
      aiInsights: parsed.resume || "",
      aiRecommendations: parsed.recommandations || [],
      callsCount: dailyData.calls.total,
      tasksCompleted: dailyData.tasks.completed,
      tasksCreated: dailyData.tasks.created,
      messagesCount: dailyData.messages.total,
      contactsAdded: dailyData.contacts.added,
      avgCallDuration: dailyData.calls.avgDuration,
      answerRate: dailyData.calls.answerRate,
      score: parsed.scorePerformance || 0,
      status: "genere",
    }).returning();

    res.json({
      report: savedReport,
      aiAnalysis: parsed,
      rawData: dailyData,
    });
  } catch (error: any) {
    console.error("Daily report error:", error);
    const isProduction = process.env.NODE_ENV === "production";
    res.status(500).json({
      error: "Erreur lors de la generation du rapport journalier",
      ...(isProduction ? {} : { details: error.message }),
    });
  }
});

router.get("/daily-reports", async (req, res) => {
  try {
    const { limit: limitParam, offset: offsetParam } = req.query;
    const limitVal = Math.min(Math.max(parseInt(String(limitParam || "30"), 10) || 30, 1), 100);
    const offsetVal = Math.max(parseInt(String(offsetParam || "0"), 10) || 0, 0);

    const reports = await db.select().from(dailyReportsTable)
      .orderBy(desc(dailyReportsTable.createdAt))
      .limit(limitVal)
      .offset(offsetVal);

    const totalResult = await db.select({ count: count() }).from(dailyReportsTable);
    const total = Number(totalResult[0]?.count ?? 0);

    res.json({
      reports,
      total,
      limit: limitVal,
      offset: offsetVal,
    });
  } catch (error: any) {
    console.error("List daily reports error:", error);
    res.status(500).json({ error: "Erreur lors de la recuperation des rapports." });
  }
});

router.get("/daily-reports/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "ID invalide." });
    }

    const [report] = await db.select().from(dailyReportsTable).where(eq(dailyReportsTable.id, id));
    if (!report) {
      return res.status(404).json({ error: "Rapport non trouve." });
    }

    res.json(report);
  } catch (error: any) {
    console.error("Get daily report error:", error);
    res.status(500).json({ error: "Erreur lors de la recuperation du rapport." });
  }
});

router.delete("/daily-reports/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "ID invalide." });
    }

    const [deleted] = await db.delete(dailyReportsTable).where(eq(dailyReportsTable.id, id)).returning();
    if (!deleted) {
      return res.status(404).json({ error: "Rapport non trouve." });
    }

    res.json({ success: true, message: "Rapport supprime." });
  } catch (error: any) {
    console.error("Delete daily report error:", error);
    res.status(500).json({ error: "Erreur lors de la suppression du rapport." });
  }
});

router.get("/activity-summary", async (req, res) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const dailyData = await gatherDailyData(todayStr);

    const weekReports = await db.select().from(dailyReportsTable)
      .where(gte(dailyReportsTable.createdAt, weekAgo))
      .orderBy(desc(dailyReportsTable.createdAt));

    const weekScores = weekReports.map(r => r.score);
    const avgScore = weekScores.length > 0 ? Math.round(weekScores.reduce((a, b) => a + b, 0) / weekScores.length) : 0;

    res.json({
      today: dailyData,
      weekReports: weekReports.map(r => ({
        id: r.id,
        date: r.reportDate,
        score: r.score,
        callsCount: r.callsCount,
        tasksCompleted: r.tasksCompleted,
        messagesCount: r.messagesCount,
        summary: r.summary,
      })),
      weekStats: {
        avgScore,
        totalReports: weekReports.length,
        bestDay: weekReports.length > 0 ? weekReports.reduce((best, r) => r.score > best.score ? r : best) : null,
        worstDay: weekReports.length > 0 ? weekReports.reduce((worst, r) => r.score < worst.score ? r : worst) : null,
      },
    });
  } catch (error: any) {
    console.error("Activity summary error:", error);
    res.status(500).json({ error: "Erreur lors de la recuperation du resume d'activite." });
  }
});

export default router;
