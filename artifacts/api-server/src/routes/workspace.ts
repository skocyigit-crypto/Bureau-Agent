import { Router } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, dailyReportsTable, platformConnectionsTable, platformSyncLogsTable, projetsTable } from "@workspace/db";
import { sql, eq, gte, lte, and, count, avg, desc, between, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { GEMINI_PRO_MODEL } from "../services/ai-utils";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

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

router.get("/platforms", async (req, res) => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

    const connections = await db.select().from(platformConnectionsTable)
      .where(eq(platformConnectionsTable.organisationId, orgId));
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
    logger.error({ err: error }, "Platforms status error:");
    res.status(500).json({ error: "Erreur lors de la recuperation des plateformes." });
  }
});

router.get("/status", async (req, res) => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

    const connections = await db.select().from(platformConnectionsTable)
      .where(and(eq(platformConnectionsTable.organisationId, orgId), eq(platformConnectionsTable.platform, "google")));
    const connLookup = new Map(connections.map(c => [c.serviceId, c]));
    const services = GOOGLE_SERVICES.map(svc => {
      const conn = connLookup.get(svc.id);
      return { id: svc.id, name: svc.name, status: conn?.status || "deconnecte", lastSync: conn?.lastSync || null, scope: svc.scope };
    });
    const connectedCount = connections.filter(c => c.status === "connecte").length;
    res.json({ connected: connectedCount > 0, services, syncEnabled: connectedCount > 0, lastGlobalSync: null, connectedCount });
  } catch (error: any) {
    logger.error({ err: error }, "[Workspace] GET /status error:");
    res.status(500).json({ error: "Erreur lors de la verification du statut" });
  }
});

router.post("/connect/:platform/:serviceId", requireRole("administrateur", "super_admin"), async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const platform = String(req.params.platform);
    const serviceId = String(req.params.serviceId);
    const platformServices = ALL_PLATFORM_SERVICES[platform];
    if (!platformServices) { res.status(404).json({ error: "Plateforme inconnue." }); return; }
    const service = platformServices.find(s => s.id === serviceId);
    if (!service) { res.status(404).json({ error: "Service inconnu." }); return; }

    // Microsoft et Apple: aucun flux OAuth n'existe dans l'application. Cette
    // route se contentait d'ecrire status:"connecte" sans le moindre jeton,
    // et l'ecran affichait "Service connecte avec succes" — l'utilisateur
    // croyait sa boite Outlook reliee alors que rien ne l'etait. Pire, l'ecran
    // de decouverte (routes/discovery.ts) relit ces lignes comme preuve qu'un
    // service est actif. On refuse donc de fabriquer cet etat.
    if (platform !== "google") {
      res.status(501).json({
        error: `La connexion ${PLATFORM_NAMES[platform] ?? platform} n'est pas encore disponible : elle necessite une autorisation OAuth qui n'est pas implementee.`,
      });
      return;
    }

    const now = new Date();
    await db.insert(platformConnectionsTable).values({
      organisationId: orgId,
      platform,
      serviceId,
      serviceName: service.name,
      status: "connecte",
      connectedAt: now,
      lastSync: now,
    }).onConflictDoUpdate({
      target: [platformConnectionsTable.organisationId, platformConnectionsTable.platform, platformConnectionsTable.serviceId],
      set: { status: "connecte", connectedAt: now, lastSync: now, updatedAt: now },
    });

    await db.insert(platformSyncLogsTable).values({
      organisationId: orgId,
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
    logger.error({ err: error }, "Connect error:");
    res.status(500).json({ error: "Erreur lors de la connexion." });
  }
});

router.post("/disconnect/:platform/:serviceId", requireRole("administrateur", "super_admin"), async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const platform = String(req.params.platform);
    const serviceId = String(req.params.serviceId);
    const platformServices = ALL_PLATFORM_SERVICES[platform];
    if (!platformServices) { res.status(404).json({ error: "Plateforme inconnue." }); return; }
    const service = platformServices.find(s => s.id === serviceId);
    if (!service) { res.status(404).json({ error: "Service inconnu." }); return; }

    await db.update(platformConnectionsTable)
      .set({ status: "deconnecte", updatedAt: new Date() })
      .where(and(eq(platformConnectionsTable.organisationId, orgId), eq(platformConnectionsTable.platform, platform), eq(platformConnectionsTable.serviceId, serviceId)));

    await db.insert(platformSyncLogsTable).values({
      organisationId: orgId,
      platform,
      serviceId,
      action: "deconnexion",
      status: "succes",
      details: `${service.name} deconnecte.`,
    });

    res.json({ status: "deconnecte", message: `${service.name} a ete deconnecte.` });
  } catch (error: any) {
    logger.error({ err: error }, "Disconnect error:");
    res.status(500).json({ error: "Erreur lors de la deconnexion." });
  }
});

router.post("/connect-all/:platform", requireRole("administrateur", "super_admin"), async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const platform = String(req.params.platform);
    const platformServices = ALL_PLATFORM_SERVICES[platform];
    if (!platformServices) { res.status(404).json({ error: "Plateforme inconnue." }); return; }

    // Meme raison que /connect/:platform/:serviceId: sans OAuth, marquer des
    // dizaines de services "connectes" d'un clic ne relie rien du tout.
    if (platform !== "google") {
      res.status(501).json({
        error: `La connexion ${PLATFORM_NAMES[platform] ?? platform} n'est pas encore disponible : elle necessite une autorisation OAuth qui n'est pas implementee.`,
      });
      return;
    }

    const now = new Date();
    for (const svc of platformServices) {
      await db.insert(platformConnectionsTable).values({
        organisationId: orgId,
        platform, serviceId: svc.id, serviceName: svc.name,
        status: "connecte", connectedAt: now, lastSync: now,
      }).onConflictDoUpdate({
        target: [platformConnectionsTable.organisationId, platformConnectionsTable.platform, platformConnectionsTable.serviceId],
        set: { status: "connecte", connectedAt: now, lastSync: now, updatedAt: now },
      });
    }

    await db.insert(platformSyncLogsTable).values({
      organisationId: orgId,
      platform, serviceId: "all", action: "connexion_globale", status: "succes",
      details: `${platformServices.length} services connectes pour ${PLATFORM_NAMES[platform]}.`,
      itemsProcessed: String(platformServices.length),
    });

    res.json({ status: "connecte", message: `Tous les services ${PLATFORM_NAMES[platform]} ont ete connectes.`, count: platformServices.length });
  } catch (error: any) {
    logger.error({ err: error }, "Connect all error:");
    res.status(500).json({ error: "Erreur lors de la connexion globale." });
  }
});

router.post("/disconnect-all/:platform", requireRole("administrateur", "super_admin"), async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const platform = String(req.params.platform);
    if (!ALL_PLATFORM_SERVICES[platform]) { res.status(404).json({ error: "Plateforme inconnue." }); return; }

    await db.update(platformConnectionsTable)
      .set({ status: "deconnecte", updatedAt: new Date() })
      .where(and(eq(platformConnectionsTable.organisationId, orgId), eq(platformConnectionsTable.platform, platform)));

    await db.insert(platformSyncLogsTable).values({
      organisationId: orgId,
      platform, serviceId: "all", action: "deconnexion_globale", status: "succes",
      details: `Tous les services ${PLATFORM_NAMES[platform]} ont ete deconnectes.`,
    });

    res.json({ status: "deconnecte", message: `Tous les services ${PLATFORM_NAMES[platform]} ont ete deconnectes.` });
  } catch (error: any) {
    logger.error({ err: error }, "Workspace disconnect-all error");
    res.status(500).json({ error: "Erreur lors de la deconnexion globale." });
  }
});

router.post("/sync/:platform", requireRole("administrateur", "super_admin"), async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const platform = String(req.params.platform);
    if (!ALL_PLATFORM_SERVICES[platform]) { res.status(404).json({ error: "Plateforme inconnue." }); return; }

    const now = new Date();
    const connected = await db.select().from(platformConnectionsTable)
      .where(and(eq(platformConnectionsTable.organisationId, orgId), eq(platformConnectionsTable.platform, platform), eq(platformConnectionsTable.status, "connecte")));

    if (connected.length === 0) {
      res.json({ status: "aucune_connexion", message: "Aucun service connecte a synchroniser." });
      return;
    }

    await db.update(platformConnectionsTable)
      .set({ lastSync: now, updatedAt: now })
      .where(and(eq(platformConnectionsTable.organisationId, orgId), eq(platformConnectionsTable.platform, platform), eq(platformConnectionsTable.status, "connecte")));

    // Aucun compteur invente ici.
    //
    // Cette route generait auparavant un nombre d'elements aleatoire par
    // service (Math.random()) et l'ecrivait dans platform_sync_logs, affiche
    // ensuite comme "Journal des connexions". C'etait de la donnee fabriquee
    // presentee comme un historique verifiable — inacceptable dans un journal.
    // Tant qu'aucune synchronisation reelle n'est implementee, on se contente
    // d'horodater et on le dit.
    await db.insert(platformSyncLogsTable).values({
      organisationId: orgId,
      platform, serviceId: "all", action: "synchronisation", status: "succes",
      details: `Horodatage mis a jour pour ${connected.length} service(s) ${PLATFORM_NAMES[platform]}. Aucun transfert de donnees: la synchronisation reelle n'est pas encore implementee.`,
      itemsProcessed: "0",
    });

    res.json({
      status: "termine",
      message: `Horodatage mis a jour pour ${connected.length} service(s). La synchronisation des donnees n'est pas encore disponible.`,
      syncedAt: now,
      servicesSync: connected.length,
      itemCounts: {},
    });
  } catch (error: any) {
    logger.error({ err: error }, "Sync error:");
    res.status(500).json({ error: "Erreur lors de la synchronisation." });
  }
});

router.get("/sync-logs", async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { platform, limit: limitParam } = req.query;
    const limitVal = Math.min(Math.max(parseInt(String(limitParam || "50"), 10) || 50, 1), 200);

    const conds = [eq(platformSyncLogsTable.organisationId, orgId)];
    if (platform) conds.push(eq(platformSyncLogsTable.platform, String(platform)));

    const logs = await db.select().from(platformSyncLogsTable)
      .where(and(...conds))
      .orderBy(desc(platformSyncLogsTable.createdAt))
      .limit(limitVal);

    res.json({ logs });
  } catch (error: any) {
    logger.error({ err: error }, "Workspace sync-logs fetch error");
    res.status(500).json({ error: "Erreur lors de la recuperation des logs." });
  }
});

router.get("/sync-logs/:platform", async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { platform } = req.params;
    const logs = await db.select().from(platformSyncLogsTable)
      .where(and(eq(platformSyncLogsTable.organisationId, orgId), eq(platformSyncLogsTable.platform, platform)))
      .orderBy(desc(platformSyncLogsTable.createdAt))
      .limit(30);
    res.json({ logs });
  } catch (error: any) {
    logger.error({ err: error }, "Workspace sync-logs platform fetch error");
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
    projetsCreatedResult,
    projetsEnRetardResult,
    projetsActifsResult,
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
    db.select({ count: count() }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), gte(projetsTable.createdAt, dayStart), lte(projetsTable.createdAt, dayEnd))),
    db.select({ count: count() }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), lte(projetsTable.endDate, new Date()), sql`${projetsTable.status} NOT IN ('termine', 'annule')`)),
    db.select({ count: count() }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), sql`${projetsTable.status} NOT IN ('termine', 'annule')`)),
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
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), or(eq(callsTable.sentiment, "positif"), eq(callsTable.sentiment, "tres_positif")))),
    db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd), or(eq(callsTable.sentiment, "negatif"), eq(callsTable.sentiment, "tres_negatif")))),
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
  const projetsCreated = Number(projetsCreatedResult[0]?.count ?? 0);
  const projetsEnRetard = Number(projetsEnRetardResult[0]?.count ?? 0);
  const projetsActifs = Number(projetsActifsResult[0]?.count ?? 0);
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
    projets: {
      created: projetsCreated,
      actifs: projetsActifs,
      enRetard: projetsEnRetard,
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
    const orgId = req.session?.organisationId;
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
      model: GEMINI_PRO_MODEL,
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

PROJETS:
- Crees aujourd'hui: ${dailyData.projets.created}
- Actifs au total: ${dailyData.projets.actifs}
- En retard: ${dailyData.projets.enRetard}

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
      logger.warn({ err: parseErr }, "[DailyReport] AI returned invalid JSON, using fallback:");
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
      organisationId: orgId,
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
    logger.error({ err: error }, "Daily report error:");
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

    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

    const reports = await db.select().from(dailyReportsTable)
      .where(eq(dailyReportsTable.organisationId, orgId))
      .orderBy(desc(dailyReportsTable.createdAt))
      .limit(limitVal)
      .offset(offsetVal);

    const totalResult = await db.select({ count: count() }).from(dailyReportsTable)
      .where(eq(dailyReportsTable.organisationId, orgId));
    const total = Number(totalResult[0]?.count ?? 0);

    res.json({
      reports,
      total,
      limit: limitVal,
      offset: offsetVal,
    });
  } catch (error: any) {
    logger.error({ err: error }, "List daily reports error:");
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

    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

    const [report] = await db.select().from(dailyReportsTable)
      .where(and(eq(dailyReportsTable.id, id), eq(dailyReportsTable.organisationId, orgId)));
    if (!report) {
      res.status(404).json({ error: "Rapport non trouve." });
      return;
    }

    res.json(report);
  } catch (error: any) {
    logger.error({ err: error }, "Get daily report error:");
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

    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

    const [deleted] = await db.delete(dailyReportsTable)
      .where(and(eq(dailyReportsTable.id, id), eq(dailyReportsTable.organisationId, orgId)))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Rapport non trouve." });
      return;
    }

    res.json({ success: true, message: "Rapport supprime." });
  } catch (error: any) {
    logger.error({ err: error }, "Delete daily report error:");
    res.status(500).json({ error: "Erreur lors de la suppression du rapport." });
  }
});

router.get("/activity-summary", async (req, res): Promise<void> => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const dailyData = await gatherDailyData(todayStr, orgId);

    const weekReports = await db.select().from(dailyReportsTable)
      .where(and(eq(dailyReportsTable.organisationId, orgId), gte(dailyReportsTable.createdAt, weekAgo)))
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
    logger.error({ err: error }, "Activity summary error:");
    res.status(500).json({ error: "Erreur lors de la recuperation du resume d'activite." });
  }
});

export default router;
