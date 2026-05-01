import { Router } from "express";
import { google } from "googleapis";
import { db, googleOAuthTokensTable, platformConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

const GOOGLE_APPS = [
  { id: "gmail", name: "Gmail", description: "Messagerie professionnelle", icon: "mail", color: "#EA4335", category: "communication", scopes: ["https://www.googleapis.com/auth/gmail.modify"] },
  { id: "calendar", name: "Google Agenda", description: "Calendrier et rendez-vous", icon: "calendar", color: "#4285F4", category: "productivite", scopes: ["https://www.googleapis.com/auth/calendar"] },
  { id: "drive", name: "Google Drive", description: "Stockage et partage de fichiers", icon: "hard-drive", color: "#0F9D58", category: "stockage", scopes: ["https://www.googleapis.com/auth/drive"] },
  { id: "docs", name: "Google Docs", description: "Traitement de texte collaboratif", icon: "file-text", color: "#4285F4", category: "documents", scopes: ["https://www.googleapis.com/auth/documents"] },
  { id: "sheets", name: "Google Sheets", description: "Tableur collaboratif", icon: "table", color: "#0F9D58", category: "documents", scopes: ["https://www.googleapis.com/auth/spreadsheets"] },
  { id: "slides", name: "Google Slides", description: "Presentations collaboratives", icon: "presentation", color: "#F4B400", category: "documents", scopes: ["https://www.googleapis.com/auth/presentations"] },
  { id: "contacts", name: "Google Contacts", description: "Carnet d'adresses", icon: "users", color: "#4285F4", category: "communication", scopes: ["https://www.googleapis.com/auth/contacts"] },
  { id: "tasks", name: "Google Tasks", description: "Gestion des taches", icon: "check-square", color: "#4285F4", category: "productivite", scopes: ["https://www.googleapis.com/auth/tasks"] },
  { id: "keep", name: "Google Keep", description: "Notes et listes", icon: "sticky-note", color: "#F4B400", category: "productivite", scopes: ["https://www.googleapis.com/auth/keep"] },
  { id: "meet", name: "Google Meet", description: "Visioconference", icon: "video", color: "#00897B", category: "communication", scopes: ["https://www.googleapis.com/auth/calendar.events"] },
  { id: "photos", name: "Google Photos", description: "Photos et albums", icon: "image", color: "#EA4335", category: "stockage", scopes: ["https://www.googleapis.com/auth/photoslibrary"] },
  { id: "youtube", name: "YouTube", description: "Videos et chaines", icon: "play-circle", color: "#FF0000", category: "media", scopes: ["https://www.googleapis.com/auth/youtube.readonly"] },
  { id: "chat", name: "Google Chat", description: "Messagerie instantanee", icon: "message-circle", color: "#00897B", category: "communication", scopes: ["https://www.googleapis.com/auth/chat.spaces.readonly"] },
  { id: "forms", name: "Google Forms", description: "Formulaires et sondages", icon: "clipboard-list", color: "#673AB7", category: "documents", scopes: ["https://www.googleapis.com/auth/forms.body.readonly"] },
];

const CATEGORIES = [
  { id: "all", label: "Toutes", icon: "grid" },
  { id: "communication", label: "Communication", icon: "message-square" },
  { id: "productivite", label: "Productivite", icon: "zap" },
  { id: "documents", label: "Documents", icon: "file-text" },
  { id: "stockage", label: "Stockage", icon: "hard-drive" },
  { id: "media", label: "Media", icon: "play-circle" },
];

async function getAuthClient(userId: number) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const tokens = await db.select().from(googleOAuthTokensTable)
    .where(eq(googleOAuthTokensTable.userId, userId));
  if (tokens.length === 0) return null;

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
    `${process.env.APP_URL || "http://localhost"}/api/google-oauth/callback`;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    access_token: tokens[0].accessToken,
    refresh_token: tokens[0].refreshToken,
  });
  return oauth2Client;
}

router.get("/google-workspace/hub", async (req, res): Promise<void> => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const hasOAuthConfig = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    const configured = hasOAuthConfig;

    const tokens = await db.select().from(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.userId, userId));

    const connections = await db.select().from(platformConnectionsTable)
      .where(eq(platformConnectionsTable.platform, "google"));

    const connMap = new Map(connections.map(c => [c.serviceId, c]));
    const grantedScopes = tokens.length > 0 ? (tokens[0].scope || "").split(" ") : [];

    const apps = GOOGLE_APPS.map(app => {
      const hasOAuthScope = app.scopes.some(s => grantedScopes.includes(s));
      return {
        ...app,
        connected: hasOAuthScope,
        connectionStatus: hasOAuthScope ? "connecte" : connMap.get(app.id)?.status || "deconnecte",
        lastSync: connMap.get(app.id)?.lastSync || null,
        connectionMethod: hasOAuthScope ? "oauth" : "none",
      };
    });

    const connectedCount = apps.filter(a => a.connected).length;

    res.json({
      configured,
      authenticated: tokens.length > 0,
      tokenValid: tokens.length > 0 && tokens[0].expiresAt ? tokens[0].expiresAt > new Date() : false,
      apps,
      categories: CATEGORIES,
      connectionMethod: hasOAuthConfig ? "oauth" : "none",
      stats: {
        totalApps: GOOGLE_APPS.length,
        connectedApps: connectedCount,
        percentage: Math.round((connectedCount / GOOGLE_APPS.length) * 100),
      },
    });
  } catch (error: any) {
    logger.error({ err: error }, "Google Workspace hub error:");
    res.status(500).json({ error: "Erreur" });
  }
});

router.get("/google-workspace/recent-emails", async (req, res): Promise<void> => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const auth = await getAuthClient(userId);
    if (!auth) { res.json({ emails: [], error: "non_connecte" }); return; }

    const gmail = google.gmail({ version: "v1", auth });
    const response = await gmail.users.messages.list({ userId: "me", maxResults: 10, q: "is:inbox" });

    const emails = [];
    for (const msg of (response.data.messages || []).slice(0, 8)) {
      try {
        const detail = await gmail.users.messages.get({ userId: "me", id: msg.id!, format: "metadata", metadataHeaders: ["Subject", "From", "Date"] });
        const headers = detail.data.payload?.headers || [];
        emails.push({
          id: msg.id,
          subject: headers.find(h => h.name === "Subject")?.value || "(Sans objet)",
          from: headers.find(h => h.name === "From")?.value || "",
          date: headers.find(h => h.name === "Date")?.value || "",
          snippet: detail.data.snippet || "",
          unread: (detail.data.labelIds || []).includes("UNREAD"),
        });
      } catch (err) { logger.warn({ err: err }, "[GoogleWorkspace] operation failed:"); }
    }

    res.json({ emails });
  } catch (error: any) {
    logger.error({ err: error }, "Recent emails error:");
    res.json({ emails: [], error: error.message });
  }
});

router.get("/google-workspace/upcoming-events", async (req, res): Promise<void> => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const auth = await getAuthClient(userId);
    if (!auth) { res.json({ events: [], error: "non_connecte" }); return; }

    const calendar = google.calendar({ version: "v3", auth });
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: endDate.toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = (response.data.items || []).map(e => ({
      id: e.id,
      title: e.summary || "(Sans titre)",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      location: e.location || null,
      description: e.description?.substring(0, 200) || null,
      attendees: (e.attendees || []).slice(0, 5).map(a => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
      meetLink: e.hangoutLink || null,
      allDay: !e.start?.dateTime,
    }));

    res.json({ events });
  } catch (error: any) {
    logger.error({ err: error }, "Upcoming events error:");
    res.json({ events: [], error: error.message });
  }
});

router.get("/google-workspace/recent-files", async (req, res): Promise<void> => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const auth = await getAuthClient(userId);
    if (!auth) { res.json({ files: [], error: "non_connecte" }); return; }

    const drive = google.drive({ version: "v3", auth });
    const response = await drive.files.list({
      pageSize: 15,
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink,owners,shared)",
      q: "trashed = false",
    });

    const files = (response.data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      size: f.size ? Number(f.size) : null,
      webViewLink: f.webViewLink,
      iconLink: f.iconLink,
      owner: f.owners?.[0]?.displayName || null,
      shared: f.shared || false,
      type: getMimeTypeLabel(f.mimeType || ""),
    }));

    res.json({ files });
  } catch (error: any) {
    logger.error({ err: error }, "Recent files error:");
    res.json({ files: [], error: error.message });
  }
});

router.get("/google-workspace/tasks", async (req, res): Promise<void> => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const auth = await getAuthClient(userId);
    if (!auth) { res.json({ tasks: [], error: "non_connecte" }); return; }

    const tasksApi = google.tasks({ version: "v1", auth });

    const taskLists = await tasksApi.tasklists.list({ maxResults: 5 });
    const allTasks: any[] = [];

    for (const list of (taskLists.data.items || []).slice(0, 3)) {
      try {
        const tasks = await tasksApi.tasks.list({ tasklist: list.id!, maxResults: 10, showCompleted: false });
        for (const t of (tasks.data.items || [])) {
          allTasks.push({
            id: t.id,
            title: t.title,
            notes: t.notes?.substring(0, 200) || null,
            due: t.due || null,
            status: t.status,
            listName: list.title,
            listId: list.id,
          });
        }
      } catch (err) { logger.warn({ err: err }, "[GoogleWorkspace] operation failed:"); }
    }

    res.json({ tasks: allTasks.slice(0, 15) });
  } catch (error: any) {
    logger.error({ err: error }, "Google tasks error:");
    res.json({ tasks: [], error: error.message });
  }
});

function getMimeTypeLabel(mimeType: string): string {
  const map: Record<string, string> = {
    "application/vnd.google-apps.document": "Google Doc",
    "application/vnd.google-apps.spreadsheet": "Google Sheet",
    "application/vnd.google-apps.presentation": "Google Slides",
    "application/vnd.google-apps.form": "Google Form",
    "application/vnd.google-apps.folder": "Dossier",
    "application/pdf": "PDF",
    "image/jpeg": "Image",
    "image/png": "Image",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  };
  return map[mimeType] || "Fichier";
}

export default router;
