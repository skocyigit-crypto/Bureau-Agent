import { Router } from "express";
import { db, googleOAuthTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getOrgId } from "../middleware/tenant";
import { ingestDocument } from "../services/document-ingest";
import {
  getGmailForUser,
  getCalendarForUser,
  getDriveForUser,
  getTasksForUser,
} from "../lib/google-auth";

const router = Router();

// Types Google natifs (Docs/Sheets/Slides) qui doivent etre EXPORTES vers un
// format binaire telechargeable. Les autres fichiers se telechargent tels quels
// via `?alt=media`.
const GOOGLE_NATIVE_EXPORT: Record<string, { mimeType: string; ext: string }> = {
  "application/vnd.google-apps.document": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: "docx",
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: "pptx",
  },
};

// Client OAuth PAR UTILISATEUR : chaque patron (titulaire de licence) connecte
// SON propre compte Google. Le client est construit a partir des identifiants
// OAuth PROPRES a l'organisation (modele "bring your own credentials"), via
// getAuthClientForUser (lib/google-auth.ts) — meme mecanisme que routes/gmail.ts.

const GOOGLE_APPS = [
  { id: "gmail",    name: "Gmail",            description: "Messagerie professionnelle",       icon: "mail",           color: "#EA4335", category: "communication" },
  { id: "calendar", name: "Google Agenda",    description: "Calendrier et rendez-vous",        icon: "calendar",       color: "#4285F4", category: "productivite" },
  { id: "drive",   name: "Google Drive",      description: "Stockage et partage de fichiers",  icon: "hard-drive",     color: "#0F9D58", category: "stockage" },
  { id: "docs",    name: "Google Docs",        description: "Traitement de texte collaboratif", icon: "file-text",      color: "#4285F4", category: "documents" },
  { id: "sheets",  name: "Google Sheets",      description: "Tableur collaboratif",             icon: "table",          color: "#0F9D58", category: "documents" },
  { id: "slides",  name: "Google Slides",      description: "Presentations collaboratives",     icon: "presentation",   color: "#F4B400", category: "documents" },
  { id: "meet",    name: "Google Meet",        description: "Visioconference",                  icon: "video",          color: "#00897B", category: "communication" },
];

const CATEGORIES = [
  { id: "all",           label: "Toutes",        icon: "grid" },
  { id: "communication", label: "Communication", icon: "message-square" },
  { id: "productivite",  label: "Productivite",  icon: "zap" },
  { id: "documents",     label: "Documents",     icon: "file-text" },
  { id: "stockage",      label: "Stockage",      icon: "hard-drive" },
];

// Scope OAuth requis pour considerer chaque application comme reellement
// connectee. Doit rester aligne avec GOOGLE_SCOPES_MAP de routes/google-oauth.ts.
const APP_REQUIRED_SCOPE: Record<string, string> = {
  gmail: "https://www.googleapis.com/auth/gmail.modify",
  calendar: "https://www.googleapis.com/auth/calendar",
  drive: "https://www.googleapis.com/auth/drive",
  docs: "https://www.googleapis.com/auth/documents",
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  slides: "https://www.googleapis.com/auth/presentations",
  meet: "https://www.googleapis.com/auth/calendar.events",
};

// Etat REEL de connexion, derive des jetons OAuth de l'utilisateur courant.
// Plus aucun statut code en dur : une application n'est "connectee" que si le
// scope correspondant a effectivement ete accorde par l'utilisateur.
router.get("/google-workspace/hub", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const configured = !!(clientId && clientSecret);

    const tokens = await db.select().from(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.userId, userId));
    const hasToken = tokens.length > 0;
    const tokenValid = hasToken && !!tokens[0].expiresAt && tokens[0].expiresAt > new Date();
    const grantedScopes = hasToken ? (tokens[0].scope || "").split(" ").filter(Boolean) : [];
    const lastSync = hasToken ? tokens[0].updatedAt : null;

    const apps = GOOGLE_APPS.map(app => {
      const required = APP_REQUIRED_SCOPE[app.id];
      const connected = hasToken && !!required && grantedScopes.includes(required);
      return {
        ...app,
        connected,
        connectionStatus: connected ? "connecte" : "deconnecte",
        lastSync: connected ? lastSync : null,
        connectionMethod: connected ? "oauth_utilisateur" : "none",
      };
    });

    const connectedCount = apps.filter(a => a.connected).length;

    res.json({
      configured,
      authenticated: hasToken,
      tokenValid,
      apps,
      categories: CATEGORIES,
      connectionMethod: "oauth_utilisateur",
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
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.json({ emails: [], error: "non_connecte" }); return; }

    const listData = (await gmail.users.messages.list({ userId: "me", maxResults: 10, q: "is:inbox" })).data;

    if (!listData.messages) {
      res.json({ emails: [] });
      return;
    }

    const emails: any[] = [];
    for (const msg of (listData.messages || []).slice(0, 8)) {
      try {
        const detail = (await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"],
        })).data;
        const headers = detail.payload?.headers || [];
        emails.push({
          id: msg.id,
          subject: headers.find((h: any) => h.name === "Subject")?.value || "(Sans objet)",
          from: headers.find((h: any) => h.name === "From")?.value || "",
          date: headers.find((h: any) => h.name === "Date")?.value || "",
          snippet: detail.snippet || "",
          unread: (detail.labelIds || []).includes("UNREAD"),
        });
      } catch (err) {
        logger.warn({ err }, "[GoogleWorkspace] email detail fetch failed");
      }
    }

    res.json({ emails });
  } catch (error: any) {
    logger.error({ err: error }, "Erreur emails recents:");
    res.json({ emails: [], error: "non_connecte" });
  }
});

router.get("/google-workspace/upcoming-events", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const calendar = await getCalendarForUser(userId);
    if (!calendar) { res.json({ events: [], error: "non_connecte" }); return; }

    const now = new Date().toISOString();
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const eventsData = (await calendar.events.list({
      calendarId: "primary",
      timeMin: now,
      timeMax: endDate,
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    })).data;

    const events = (eventsData.items || []).map((e: any) => ({
      id: e.id,
      title: e.summary || "(Sans titre)",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      location: e.location || null,
      description: e.description?.substring(0, 200) || null,
      attendees: (e.attendees || []).slice(0, 5).map((a: any) => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
      meetLink: e.hangoutLink || null,
      allDay: !e.start?.dateTime,
    }));

    res.json({ events });
  } catch (error: any) {
    logger.error({ err: error }, "Erreur evenements agenda:");
    res.json({ events: [], error: "non_connecte" });
  }
});

router.get("/google-workspace/recent-files", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const drive = await getDriveForUser(userId);
    if (!drive) { res.json({ files: [], error: "non_connecte" }); return; }

    const filesData = (await drive.files.list({
      pageSize: 15,
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,modifiedTime,size,webViewLink,owners,shared)",
      q: "trashed = false",
    })).data;

    const files = (filesData.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      size: f.size ? Number(f.size) : null,
      webViewLink: f.webViewLink,
      owner: f.owners?.[0]?.displayName || null,
      shared: f.shared || false,
      type: getMimeTypeLabel(f.mimeType || ""),
    }));

    res.json({ files });
  } catch (error: any) {
    logger.error({ err: error }, "Erreur fichiers recents:");
    res.json({ files: [], error: "non_connecte" });
  }
});

router.get("/google-workspace/tasks", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const tasksApi = await getTasksForUser(userId);
    if (!tasksApi) { res.json({ tasks: [], error: "non_connecte" }); return; }

    const lists = (await tasksApi.tasklists.list({ maxResults: 20 })).data;

    const tasks: any[] = [];
    for (const list of (lists.items || []).slice(0, 5)) {
      try {
        const listTasks = (await tasksApi.tasks.list({ tasklist: list.id!, maxResults: 50, showCompleted: true })).data;
        for (const t of (listTasks.items || [])) {
          tasks.push({
            id: t.id,
            title: t.title || "(Sans titre)",
            notes: t.notes || null,
            status: t.status === "completed" ? "completed" : "needsAction",
            due: t.due || null,
            listName: list.title || null,
          });
        }
      } catch (err) {
        logger.warn({ err }, "[GoogleWorkspace] task list fetch failed");
      }
    }

    res.json({ tasks });
  } catch (error: any) {
    // Le compte EST connecte (getAuthClient a renvoye un client) : un echec ici
    // vient le plus souvent du scope Tasks non accorde sur d'anciens jetons. On
    // renvoie une liste vide plutot que "non_connecte" pour ne pas afficher a
    // tort "Connectez votre compte" alors que Gmail/Agenda/Drive fonctionnent.
    logger.warn({ err: error }, "Taches Google indisponibles (scope manquant ?):");
    res.json({ tasks: [] });
  }
});

router.get("/google-workspace/calendar-list", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const calendar = await getCalendarForUser(userId);
    if (!calendar) { res.json({ calendars: [], error: "non_connecte" }); return; }

    const calData = (await calendar.calendarList.list()).data;

    res.json({ calendars: calData.items || [] });
  } catch (error: any) {
    logger.error({ err: error }, "Erreur liste calendriers:");
    res.json({ calendars: [], error: "non_connecte" });
  }
});

router.post("/google-workspace/create-event", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const { title, start, end, description, location } = req.body;
    if (!title || !start || !end) { res.status(400).json({ error: "title, start, end requis" }); return; }

    const calendar = await getCalendarForUser(userId);
    if (!calendar) { res.status(400).json({ error: "Compte Google non connecte." }); return; }

    const event = (await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: title,
        description: description || "",
        location: location || "",
        start: { dateTime: start, timeZone: "Europe/Paris" },
        end: { dateTime: end, timeZone: "Europe/Paris" },
      },
    })).data;

    res.json({ success: true, event: { id: event.id, title: event.summary, start: event.start?.dateTime, link: event.htmlLink } });
  } catch (error: any) {
    logger.error({ err: error }, "Erreur creation evenement:");
    res.status(500).json({ error: "Erreur creation evenement" });
  }
});

router.post("/google-workspace/send-email", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const { to, subject, body } = req.body;
    if (!to || !subject || !body) { res.status(400).json({ error: "to, subject, body requis" }); return; }

    const gmail = await getGmailForUser(userId);
    if (!gmail) { res.status(400).json({ error: "Compte Google non connecte." }); return; }

    const rawMessage = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\n");

    const encoded = Buffer.from(rawMessage).toString("base64url");

    const result = (await gmail.users.messages.send({ userId: "me", requestBody: { raw: encoded } })).data;

    res.json({ success: true, messageId: result.id });
  } catch (error: any) {
    logger.error({ err: error }, "Erreur envoi email:");
    res.status(500).json({ error: "Erreur envoi email" });
  }
});

router.get("/google-workspace/drive-search", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const { q } = req.query;
    if (!q || typeof q !== "string") { res.status(400).json({ error: "Parametre q requis" }); return; }

    const drive = await getDriveForUser(userId);
    if (!drive) { res.json({ files: [], error: "non_connecte" }); return; }

    const filesData = (await drive.files.list({
      q: `name contains '${q.replace(/'/g, "\\'")}' and trashed = false`,
      pageSize: 10,
      fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    })).data;

    res.json({ files: (filesData.files || []).map((f: any) => ({ ...f, type: getMimeTypeLabel(f.mimeType || "") })) });
  } catch (error: any) {
    logger.error({ err: error }, "Erreur recherche Drive:");
    res.json({ files: [], error: "non_connecte" });
  }
});

// Importe un fichier Google Drive dans la bibliotheque de documents en le
// passant par le MEME pipeline d'ingestion/scan que l'upload UI. Les formats
// Google natifs (Docs/Sheets/Slides) sont exportes en docx/xlsx/pptx ; les
// autres sont telecharges tels quels via `?alt=media`. Le scan antivirus
// complet tourne ensuite en arriere-plan.
router.post("/google-workspace/drive-import", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie" }); return; }
    const orgId = getOrgId(req);

    const { fileId } = req.body;
    if (!fileId || typeof fileId !== "string") { res.status(400).json({ error: "fileId requis" }); return; }

    const drive = await getDriveForUser(userId);
    if (!drive) { res.status(400).json({ error: "Compte Google non connecte." }); return; }


    // 1) Metadonnees pour valider l'acces + recuperer nom/type/taille.
    const meta = (await drive.files.get({ fileId, fields: "id,name,mimeType,size" })).data as any;
    if (!meta?.id) { res.status(404).json({ error: "Fichier introuvable." }); return; }

    if (meta.mimeType === "application/vnd.google-apps.folder") {
      res.status(400).json({ error: "Impossible d'importer un dossier." });
      return;
    }

    // 2) Telechargement des octets — export pour les formats Google natifs,
    // sinon download direct.
    let fileName = meta.name as string;
    let arrayBuf: ArrayBuffer;
    const nativeExport = GOOGLE_NATIVE_EXPORT[meta.mimeType];
    if (nativeExport) {
      const exp = await drive.files.export(
        { fileId, mimeType: nativeExport.mimeType },
        { responseType: "arraybuffer" }
      );
      arrayBuf = exp.data as ArrayBuffer;
      if (!/\.[a-z0-9]+$/i.test(fileName)) fileName = `${fileName}.${nativeExport.ext}`;
    } else {
      const dl = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "arraybuffer" }
      );
      arrayBuf = dl.data as ArrayBuffer;
    }

    const fileContent = Buffer.from(arrayBuf).toString("base64");

    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket?.remoteAddress || "unknown";

    const ingest = await ingestDocument({
      orgId,
      userId,
      fileContent,
      fileName,
      mimeType: nativeExport ? nativeExport.mimeType : meta.mimeType,
      category: "drive",
      description: `Importe depuis Google Drive — ${meta.name}`,
      source: "drive",
      ip,
    });

    if (ingest.status === "blocked") {
      res.status(400).json({ error: "Fichier bloque pour raisons de securite.", threats: ingest.threats });
      return;
    }
    if (ingest.status === "rejected") {
      res.status(400).json({ error: ingest.error });
      return;
    }

    res.json({
      success: true,
      document: {
        id: ingest.doc.id,
        fileName: ingest.doc.originalName,
        mimeType: ingest.doc.mimeType,
        fileSize: ingest.doc.fileSize,
      },
    });
  } catch (error: any) {
    logger.error({ err: error }, "Erreur import Drive:");
    res.status(500).json({ error: "Erreur lors de l'import du fichier Drive." });
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
