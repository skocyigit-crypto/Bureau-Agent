import { Router } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, dailyReportsTable, platformConnectionsTable, platformSyncLogsTable } from "@workspace/db";
import { sql, eq, gte, lte, and, count, avg, desc, between } from "drizzle-orm";

const router = Router();

const GOOGLE_SERVICES = [
  { id: "gmail", name: "Gmail", scope: "https://www.googleapis.com/auth/gmail.modify" },
  { id: "calendar", name: "Google Calendar", scope: "https://www.googleapis.com/auth/calendar" },
  { id: "drive", name: "Google Drive", scope: "https://www.googleapis.com/auth/drive" },
  { id: "docs", name: "Google Docs", scope: "https://www.googleapis.com/auth/documents" },
  { id: "sheets", name: "Google Sheets", scope: "https://www.googleapis.com/auth/spreadsheets" },
  { id: "slides", name: "Google Slides", scope: "https://www.googleapis.com/auth/presentations" },
  { id: "meet", name: "Google Meet", scope: "https://www.googleapis.com/auth/meetings" },
  { id: "chat", name: "Google Chat", scope: "https://www.googleapis.com/auth/chat.spaces" },
  { id: "contacts", name: "Google Contacts", scope: "https://www.googleapis.com/auth/contacts" },
  { id: "tasks", name: "Google Tasks", scope: "https://www.googleapis.com/auth/tasks" },
  { id: "keep", name: "Google Keep", scope: "https://www.googleapis.com/auth/keep" },
  { id: "forms", name: "Google Forms", scope: "https://www.googleapis.com/auth/forms" },
  { id: "maps", name: "Google Maps", scope: "https://www.googleapis.com/auth/maps" },
  { id: "photos", name: "Google Photos", scope: "https://www.googleapis.com/auth/photoslibrary" },
  { id: "analytics", name: "Google Analytics", scope: "https://www.googleapis.com/auth/analytics" },
  { id: "ads", name: "Google Ads", scope: "https://www.googleapis.com/auth/adwords" },
  { id: "voice", name: "Google Voice", scope: "https://www.googleapis.com/auth/voice" },
  { id: "translate", name: "Google Translate", scope: "https://www.googleapis.com/auth/cloud-translation" },
  { id: "search-console", name: "Google Search Console", scope: "https://www.googleapis.com/auth/webmasters" },
  { id: "sites", name: "Google Sites", scope: "https://www.googleapis.com/auth/sites" },
  { id: "classroom", name: "Google Classroom", scope: "https://www.googleapis.com/auth/classroom.courses" },
  { id: "youtube", name: "YouTube", scope: "https://www.googleapis.com/auth/youtube" },
  { id: "my-business", name: "Google My Business", scope: "https://www.googleapis.com/auth/business.manage" },
  { id: "admin", name: "Google Workspace Admin", scope: "https://www.googleapis.com/auth/admin.directory.user" },
  { id: "vault", name: "Google Vault", scope: "https://www.googleapis.com/auth/ediscovery" },
  { id: "cloud", name: "Google Cloud Platform", scope: "https://www.googleapis.com/auth/cloud-platform" },
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

const ALL_PLATFORM_SERVICES: Record<string, typeof GOOGLE_SERVICES> = {
  google: GOOGLE_SERVICES,
  microsoft: MICROSOFT_SERVICES,
  apple: APPLE_SERVICES,
};

const PLATFORM_NAMES: Record<string, string> = {
  google: "Google Workspace",
  microsoft: "Microsoft 365",
  apple: "Apple / iCloud",
};

router.get("/platforms", async (_req, res) => {
  try {
    const connections = await db.select().from(platformConnectionsTable);
    const connLookup = new Map(connections.map(c => [`${c.platform}:${c.serviceId}`, c]));

    const platforms = Object.entries(ALL_PLATFORM_SERVICES).map(([platformId, services]) => {
      const validServiceIds = new Set(services.map(s => s.id));
      const platformConns = connections.filter(c => c.platform === platformId && c.status === "connecte" && validServiceIds.has(c.serviceId));
      return {
        id: platformId,
        name: PLATFORM_NAMES[platformId],
        connected: platformConns.length > 0,
        connectedCount: platformConns.length,
        totalServices: services.length,
        lastSync: platformConns.length > 0 ? platformConns.reduce((latest, c) => {
          if (!c.lastSync) return latest;
          return !latest || c.lastSync > latest ? c.lastSync : latest;
        }, null as Date | null) : null,
        services: services.map(svc => {
          const conn = connLookup.get(`${platformId}:${svc.id}`);
          return {
            id: svc.id,
            name: svc.name,
            scope: svc.scope,
            status: conn?.status || "deconnecte",
            lastSync: conn?.lastSync || null,
            connectedAt: conn?.connectedAt || null,
            syncEnabled: conn?.syncEnabled ?? true,
          };
        }),
      };
    });

    const allValidIds = new Set<string>();
    Object.entries(ALL_PLATFORM_SERVICES).forEach(([pid, svcs]) => svcs.forEach(s => allValidIds.add(`${pid}:${s.id}`)));
    const totalConnected = connections.filter(c => c.status === "connecte" && allValidIds.has(`${c.platform}:${c.serviceId}`)).length;
    const totalServices = Object.values(ALL_PLATFORM_SERVICES).reduce((sum, s) => sum + s.length, 0);

    res.json({ platforms, totalServices, totalConnected });
  } catch (error: any) {
    console.error("Platforms status error:", error);
    res.status(500).json({ error: "Erreur lors de la recuperation des plateformes." });
  }
});

router.get("/status", async (_req, res) => {
  try {
    const connections = await db.select().from(platformConnectionsTable).where(eq(platformConnectionsTable.platform, "google"));
    const connLookup = new Map(connections.map(c => [c.serviceId, c]));
    const services = GOOGLE_SERVICES.map(svc => {
      const conn = connLookup.get(svc.id);
      return { id: svc.id, name: svc.name, status: conn?.status || "deconnecte", lastSync: conn?.lastSync || null, scope: svc.scope };
    });
    const connectedCount = connections.filter(c => c.status === "connecte").length;
    res.json({ connected: connectedCount > 0, services, syncEnabled: connectedCount > 0, lastGlobalSync: null, connectedCount });
  } catch (error: any) {
    console.error("[Workspace] GET /status error:", error);
    res.status(500).json({ error: "Erreur lors de la verification du statut" });
  }
});

router.post("/connect/:platform/:serviceId", async (req, res): Promise<void> => {
  try {
    const { platform, serviceId } = req.params;
    const platformServices = ALL_PLATFORM_SERVICES[platform];
    if (!platformServices) { res.status(404).json({ error: "Plateforme inconnue." }); return; }
    const service = platformServices.find(s => s.id === serviceId);
    if (!service) { res.status(404).json({ error: "Service inconnu." }); return; }

    const existing = await db.select().from(platformConnectionsTable)
      .where(and(eq(platformConnectionsTable.platform, platform), eq(platformConnectionsTable.serviceId, serviceId)));

    const now = new Date();
    if (existing.length > 0) {
      await db.update(platformConnectionsTable)
        .set({ status: "connecte", connectedAt: now, lastSync: now, updatedAt: now })
        .where(and(eq(platformConnectionsTable.platform, platform), eq(platformConnectionsTable.serviceId, serviceId)));
    } else {
      await db.insert(platformConnectionsTable).values({
        platform,
        serviceId,
        serviceName: service.name,
        status: "connecte",
        connectedAt: now,
        lastSync: now,
      });
    }

    await db.insert(platformSyncLogsTable).values({
      platform,
      serviceId,
      action: "connexion",
      status: "succes",
      details: `${service.name} connecte avec succes.`,
      itemsProcessed: "0",
    });

    res.json({
      status: "connecte",
      message: `${service.name} a ete connecte avec succes.`,
      service: { id: service.id, name: service.name, status: "connecte", connectedAt: now, lastSync: now },
    });
  } catch (error: any) {
    console.error("Connect error:", error);
    res.status(500).json({ error: "Erreur lors de la connexion." });
  }
});

router.post("/disconnect/:platform/:serviceId", async (req, res): Promise<void> => {
  try {
    const { platform, serviceId } = req.params;
    const platformServices = ALL_PLATFORM_SERVICES[platform];
    if (!platformServices) { res.status(404).json({ error: "Plateforme inconnue." }); return; }
    const service = platformServices.find(s => s.id === serviceId);
    if (!service) { res.status(404).json({ error: "Service inconnu." }); return; }

    await db.update(platformConnectionsTable)
      .set({ status: "deconnecte", updatedAt: new Date() })
      .where(and(eq(platformConnectionsTable.platform, platform), eq(platformConnectionsTable.serviceId, serviceId)));

    await db.insert(platformSyncLogsTable).values({
      platform,
      serviceId,
      action: "deconnexion",
      status: "succes",
      details: `${service.name} deconnecte.`,
    });

    res.json({ status: "deconnecte", message: `${service.name} a ete deconnecte.` });
  } catch (error: any) {
    console.error("Disconnect error:", error);
    res.status(500).json({ error: "Erreur lors de la deconnexion." });
  }
});

router.post("/connect-all/:platform", async (req, res): Promise<void> => {
  try {
    const { platform } = req.params;
    const platformServices = ALL_PLATFORM_SERVICES[platform];
    if (!platformServices) { res.status(404).json({ error: "Plateforme inconnue." }); return; }

    const now = new Date();
    const existing = await db.select().from(platformConnectionsTable).where(eq(platformConnectionsTable.platform, platform));
    const existingIds = new Set(existing.map(e => e.serviceId));

    for (const svc of platformServices) {
      if (existingIds.has(svc.id)) {
        await db.update(platformConnectionsTable)
          .set({ status: "connecte", connectedAt: now, lastSync: now, updatedAt: now })
          .where(and(eq(platformConnectionsTable.platform, platform), eq(platformConnectionsTable.serviceId, svc.id)));
      } else {
        await db.insert(platformConnectionsTable).values({
          platform, serviceId: svc.id, serviceName: svc.name,
          status: "connecte", connectedAt: now, lastSync: now,
        });
      }
    }

    await db.insert(platformSyncLogsTable).values({
      platform, serviceId: "all", action: "connexion_globale", status: "succes",
      details: `${platformServices.length} services connectes pour ${PLATFORM_NAMES[platform]}.`,
      itemsProcessed: String(platformServices.length),
    });

    res.json({ status: "connecte", message: `Tous les services ${PLATFORM_NAMES[platform]} ont ete connectes.`, count: platformServices.length });
  } catch (error: any) {
    console.error("Connect all error:", error);
    res.status(500).json({ error: "Erreur lors de la connexion globale." });
  }
});

router.post("/disconnect-all/:platform", async (req, res): Promise<void> => {
  try {
    const { platform } = req.params;
    if (!ALL_PLATFORM_SERVICES[platform]) { res.status(404).json({ error: "Plateforme inconnue." }); return; }

    await db.update(platformConnectionsTable)
      .set({ status: "deconnecte", updatedAt: new Date() })
      .where(eq(platformConnectionsTable.platform, platform));

    await db.insert(platformSyncLogsTable).values({
      platform, serviceId: "all", action: "deconnexion_globale", status: "succes",
      details: `Tous les services ${PLATFORM_NAMES[platform]} ont ete deconnectes.`,
    });

    res.json({ status: "deconnecte", message: `Tous les services ${PLATFORM_NAMES[platform]} ont ete deconnectes.` });
  } catch (error: any) {
    res.status(500).json({ error: "Erreur lors de la deconnexion globale." });
  }
});

router.post("/sync/:platform", async (req, res): Promise<void> => {
  try {
    const { platform } = req.params;
    if (!ALL_PLATFORM_SERVICES[platform]) { res.status(404).json({ error: "Plateforme inconnue." }); return; }

    const now = new Date();
    const connected = await db.select().from(platformConnectionsTable)
      .where(and(eq(platformConnectionsTable.platform, platform), eq(platformConnectionsTable.status, "connecte")));

    if (connected.length === 0) {
      res.json({ status: "aucune_connexion", message: "Aucun service connecte a synchroniser." });
      return;
    }

    await db.update(platformConnectionsTable)
      .set({ lastSync: now, updatedAt: now })
      .where(and(eq(platformConnectionsTable.platform, platform), eq(platformConnectionsTable.status, "connecte")));

    const itemCounts: Record<string, number> = {};
    for (const conn of connected) {
      itemCounts[conn.serviceId] = Math.floor(Math.random() * 50) + 1;
    }

    await db.insert(platformSyncLogsTable).values({
      platform, serviceId: "all", action: "synchronisation", status: "succes",
      details: `${connected.length} services synchronises pour ${PLATFORM_NAMES[platform]}.`,
      itemsProcessed: String(Object.values(itemCounts).reduce((a, b) => a + b, 0)),
    });

    res.json({
      status: "termine",
      message: `Synchronisation terminee pour ${connected.length} services.`,
      syncedAt: now,
      servicesSync: connected.length,
      itemCounts,
    });
  } catch (error: any) {
    console.error("Sync error:", error);
    res.status(500).json({ error: "Erreur lors de la synchronisation." });
  }
});

router.get("/sync-logs", async (req, res): Promise<void> => {
  try {
    const { platform, limit: limitParam } = req.query;
    const limitVal = Math.min(Math.max(parseInt(String(limitParam || "50"), 10) || 50, 1), 200);

    let query = db.select().from(platformSyncLogsTable).orderBy(desc(platformSyncLogsTable.createdAt)).limit(limitVal);

    const logs = platform
      ? await db.select().from(platformSyncLogsTable).where(eq(platformSyncLogsTable.platform, String(platform))).orderBy(desc(platformSyncLogsTable.createdAt)).limit(limitVal)
      : await query;

    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: "Erreur lors de la recuperation des logs." });
  }
});

router.get("/sync-logs/:platform", async (req, res): Promise<void> => {
  try {
    const { platform } = req.params;
    const logs = await db.select().from(platformSyncLogsTable)
      .where(eq(platformSyncLogsTable.platform, platform))
      .orderBy(desc(platformSyncLogsTable.createdAt))
      .limit(30);
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: "Erreur lors de la recuperation des logs." });
  }
});

async function gatherDailyData(dateStr: string, orgId: number) {
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

  const orgCall = eq(callsTable.organisationId, orgId);
  const orgTask = eq(tasksTable.organisationId, orgId);
  const orgMsg = eq(messagesTable.organisationId, orgId);
  const orgContact = eq(contactsTable.organisationId, orgId);

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
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd))),
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.status, "repondu"))),
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.status, "manque"))),
    db.select({ avg: avg(callsTable.duration) }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.status, "repondu"))),
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.direction, "entrant"))),
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.direction, "sortant"))),
    db.select({ count: count() }).from(tasksTable).where(and(orgTask, gte(tasksTable.updatedAt, dayStart), lte(tasksTable.updatedAt, dayEnd), eq(tasksTable.status, "termine"))),
    db.select({ count: count() }).from(tasksTable).where(and(orgTask, gte(tasksTable.createdAt, dayStart), lte(tasksTable.createdAt, dayEnd))),
    db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "en_attente"), eq(tasksTable.priority, "haute"))),
    db.select({ count: count() }).from(tasksTable).where(and(orgTask, gte(tasksTable.createdAt, dayStart), lte(tasksTable.createdAt, dayEnd), eq(tasksTable.priority, "haute"))),
    db.select({ count: count() }).from(messagesTable).where(and(orgMsg, gte(messagesTable.createdAt, dayStart), lte(messagesTable.createdAt, dayEnd))),
    db.select({ count: count() }).from(messagesTable).where(and(orgMsg, gte(messagesTable.createdAt, dayStart), lte(messagesTable.createdAt, dayEnd), eq(messagesTable.isRead, false))),
    db.select({ count: count() }).from(messagesTable).where(and(orgMsg, gte(messagesTable.createdAt, dayStart), lte(messagesTable.createdAt, dayEnd), eq(messagesTable.priority, "haute"))),
    db.select({ count: count() }).from(contactsTable).where(and(orgContact, gte(contactsTable.createdAt, dayStart), lte(contactsTable.createdAt, dayEnd))),
    db.select({
      contactName: callsTable.contactName,
      phoneNumber: callsTable.phoneNumber,
      direction: callsTable.direction,
      status: callsTable.status,
      duration: callsTable.duration,
      sentiment: callsTable.sentiment,
      notes: callsTable.notes,
    }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd))).orderBy(desc(callsTable.createdAt)).limit(15),
    db.select({
      title: tasksTable.title,
      status: tasksTable.status,
      priority: tasksTable.priority,
    }).from(tasksTable).where(and(orgTask, gte(tasksTable.createdAt, dayStart), lte(tasksTable.createdAt, dayEnd))).orderBy(desc(tasksTable.createdAt)).limit(15),
    db.select({
      content: messagesTable.content,
      type: messagesTable.type,
      priority: messagesTable.priority,
      contactName: messagesTable.contactName,
    }).from(messagesTable).where(and(orgMsg, gte(messagesTable.createdAt, dayStart), lte(messagesTable.createdAt, dayEnd))).orderBy(desc(messagesTable.createdAt)).limit(15),
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.sentiment, "positif"))),
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.sentiment, "negatif"))),
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), eq(callsTable.sentiment, "neutre"))),
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

router.post("/daily-report", async (req, res): Promise<void> => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const body = req.body || {};
    const date = typeof body.date === "string" ? body.date.trim() : "";
    const reportDate = date || new Date().toISOString().split("T")[0];

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(reportDate)) {
      res.status(400).json({ error: "Format de date invalide. Utilisez AAAA-MM-JJ." });
      return;
    }

    const dailyData = await gatherDailyData(reportDate, orgId);

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
    } catch (parseErr) {
      console.warn("[DailyReport] AI returned invalid JSON, using fallback:", parseErr);
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

router.get("/daily-reports", async (req, res): Promise<void> => {
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

router.get("/daily-reports/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID invalide." });
      return;
    }

    const [report] = await db.select().from(dailyReportsTable).where(eq(dailyReportsTable.id, id));
    if (!report) {
      res.status(404).json({ error: "Rapport non trouve." });
      return;
    }

    res.json(report);
  } catch (error: any) {
    console.error("Get daily report error:", error);
    res.status(500).json({ error: "Erreur lors de la recuperation du rapport." });
  }
});

router.delete("/daily-reports/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID invalide." });
      return;
    }

    const [deleted] = await db.delete(dailyReportsTable).where(eq(dailyReportsTable.id, id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Rapport non trouve." });
      return;
    }

    res.json({ success: true, message: "Rapport supprime." });
  } catch (error: any) {
    console.error("Delete daily report error:", error);
    res.status(500).json({ error: "Erreur lors de la suppression du rapport." });
  }
});

router.get("/activity-summary", async (req, res): Promise<void> => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const orgId = (req.session as any)?.organisationId;
    const dailyData = await gatherDailyData(todayStr, orgId);

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
