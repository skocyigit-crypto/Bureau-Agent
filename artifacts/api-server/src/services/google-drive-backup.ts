import { google } from "googleapis";
import { db, googleOAuthTokensTable, autoBackupsTable, backupConfigTable, usersTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import crypto from "crypto";
import { Readable } from "stream";

const DRIVE_FOLDER_NAME = "Agent de Bureau - Sauvegardes";
const ENCRYPTION_ALGORITHM = "aes-256-cbc";
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPL_SLUG + ".repl.co";
  const redirectUri = `https://${domain}/api/google-oauth/callback`;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function deriveEncryptionKey(): Buffer {
  const secret = process.env.BACKUP_ENCRYPTION_KEY || process.env.SESSION_SECRET || "agent-de-bureau-backup-key-2025";
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptData(data: string): { encrypted: Buffer; iv: string; authTag: string } {
  const iv = crypto.randomBytes(16);
  const key = deriveEncryptionKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = (cipher as any).getAuthTag().toString("hex");
  return { encrypted, iv: iv.toString("hex"), authTag };
}

async function collectFullBackupData(): Promise<object> {
  const tables = [
    "organisations", "subscriptions", "users", "contacts", "calls",
    "tasks", "messages", "checkins", "stock_articles", "automations",
    "calendar_events", "invoices", "payments", "legal_agreements",
    "audit_logs", "platform_connections",
  ];

  const snapshot: Record<string, any> = {};
  for (const table of tables) {
    try {
      const rows = await db.execute(sql.raw(`SELECT * FROM ${table}`));
      snapshot[table] = {
        count: Array.isArray(rows) ? rows.length : (rows as any)?.rows?.length || 0,
        data: Array.isArray(rows) ? rows : (rows as any)?.rows || [],
      };
    } catch {
      snapshot[table] = { count: 0, data: [], error: "table_not_found" };
    }
  }

  snapshot._meta = {
    exportedAt: new Date().toISOString(),
    version: "2.0",
    encryption: "AES-256-GCM",
    platform: "Agent de Bureau SaaS",
    tables: tables.length,
  };

  return snapshot;
}

async function findOrCreateDriveFolder(drive: any): Promise<string> {
  const listRes = await drive.files.list({
    q: `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    spaces: "drive",
  });

  if (listRes.data.files && listRes.data.files.length > 0) {
    return listRes.data.files[0].id;
  }

  const createRes = await drive.files.create({
    requestBody: {
      name: DRIVE_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
      description: "Sauvegardes securisees de la plateforme Agent de Bureau. Chiffrement AES-256-GCM.",
    },
    fields: "id",
  });

  return createRes.data.id;
}

async function cleanupOldDriveBackups(drive: any, folderId: string, retentionDays: number) {
  try {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoffDate.toISOString();

    const listRes = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false and createdTime < '${cutoffStr}'`,
      fields: "files(id, name, createdTime)",
      orderBy: "createdTime asc",
      pageSize: 50,
    });

    const oldFiles = listRes.data.files || [];
    for (const file of oldFiles) {
      try {
        await drive.files.delete({ fileId: file.id });
        console.log(`[GoogleDriveBackup] Ancien fichier supprime: ${file.name}`);
      } catch {}
    }
    if (oldFiles.length > 0) {
      console.log(`[GoogleDriveBackup] ${oldFiles.length} ancienne(s) sauvegarde(s) nettoyee(s).`);
    }
  } catch (err: any) {
    console.error("[GoogleDriveBackup] Erreur nettoyage:", err.message);
  }
}

export async function performGoogleDriveBackup(): Promise<{
  success: boolean;
  fileId?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  error?: string;
  encryptionHash?: string;
}> {
  if (isRunning) {
    return { success: false, error: "Sauvegarde deja en cours." };
  }
  isRunning = true;
  const startTime = Date.now();

  try {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) {
      return { success: false, error: "Google OAuth non configure. Ajoutez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET." };
    }

    const superAdmins = await db.select().from(usersTable).where(eq(usersTable.role, "super_admin"));
    if (superAdmins.length === 0) {
      return { success: false, error: "Aucun super administrateur trouve." };
    }

    let tokenRecord = null;
    for (const admin of superAdmins) {
      const tokens = await db.select().from(googleOAuthTokensTable)
        .where(eq(googleOAuthTokensTable.userId, admin.id));
      if (tokens.length > 0 && tokens[0].scope.includes("drive")) {
        tokenRecord = tokens[0];
        break;
      }
    }

    if (!tokenRecord) {
      return { success: false, error: "Aucun token Google Drive valide. Un super administrateur doit connecter Google Drive dans les parametres." };
    }

    oauth2Client.setCredentials({
      access_token: tokenRecord.accessToken,
      refresh_token: tokenRecord.refreshToken,
    });

    if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
      if (!tokenRecord.refreshToken) {
        return { success: false, error: "Token Google expire et aucun refresh token disponible. Reconnectez Google Drive." };
      }
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);
        await db.update(googleOAuthTokensTable).set({
          accessToken: credentials.access_token!,
          expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3600000),
          updatedAt: new Date(),
        }).where(eq(googleOAuthTokensTable.id, tokenRecord.id));
      } catch (refreshErr: any) {
        return { success: false, error: `Erreur rafraichissement token: ${refreshErr.message}` };
      }
    }

    const drive = google.drive({ version: "v3", auth: oauth2Client });

    console.log("[GoogleDriveBackup] Collecte des donnees...");
    const backupData = await collectFullBackupData();
    const jsonStr = JSON.stringify(backupData);
    const originalSize = Buffer.byteLength(jsonStr, "utf-8");

    console.log("[GoogleDriveBackup] Chiffrement AES-256-GCM...");
    const { encrypted, iv, authTag } = encryptData(jsonStr);

    const checksumOriginal = crypto.createHash("sha256").update(jsonStr).digest("hex");
    const checksumEncrypted = crypto.createHash("sha256").update(encrypted).digest("hex");

    const envelope = JSON.stringify({
      format: "agent-de-bureau-backup",
      version: "2.0",
      encryption: {
        algorithm: "AES-256-GCM",
        iv,
        authTag,
        keyDerivation: "SHA-256",
      },
      integrity: {
        originalChecksum: checksumOriginal,
        encryptedChecksum: checksumEncrypted,
        originalSize,
        encryptedSize: encrypted.length,
      },
      metadata: {
        createdAt: new Date().toISOString(),
        platform: "Agent de Bureau SaaS",
      },
      data: encrypted.toString("base64"),
    });

    const envelopeSize = Buffer.byteLength(envelope, "utf-8");

    console.log("[GoogleDriveBackup] Recherche/creation du dossier Drive...");
    const folderId = await findOrCreateDriveFolder(drive);

    const now = new Date();
    const fileName = `backup_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.adb.enc`;

    console.log("[GoogleDriveBackup] Upload vers Google Drive...");
    const stream = new Readable();
    stream.push(envelope);
    stream.push(null);

    const uploadRes = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
        mimeType: "application/octet-stream",
        description: `Sauvegarde chiffree Agent de Bureau - ${now.toLocaleDateString("fr-FR")} ${now.toLocaleTimeString("fr-FR")} | AES-256-GCM | SHA-256: ${checksumOriginal.substring(0, 16)}`,
      },
      media: {
        mimeType: "application/octet-stream",
        body: stream,
      },
      fields: "id, name, size, webViewLink",
    });

    const duration = Date.now() - startTime;

    const configs = await db.select().from(backupConfigTable).where(eq(backupConfigTable.platform, "google"));
    const retentionDays = configs.length > 0 ? configs[0].retentionDays : 90;
    await cleanupOldDriveBackups(drive, folderId, retentionDays);

    await db.insert(autoBackupsTable).values({
      type: "google_drive",
      status: "termine",
      platform: "google",
      dataSummary: {
        fileId: uploadRes.data.id,
        fileName,
        folderId,
        originalSize,
        encryptedSize: envelopeSize,
        encryption: "AES-256-GCM",
        integrity: checksumOriginal.substring(0, 16),
        webViewLink: uploadRes.data.webViewLink,
      },
      sizeBytes: envelopeSize,
      encryptionHash: checksumOriginal,
      duration,
    });

    await db.update(backupConfigTable).set({
      lastBackupAt: now,
      updatedAt: now,
    }).where(eq(backupConfigTable.platform, "google"));

    console.log(`[GoogleDriveBackup] Sauvegarde reussie: ${fileName} (${(envelopeSize / 1024).toFixed(1)} Ko, ${duration}ms)`);

    return {
      success: true,
      fileId: uploadRes.data.id,
      fileName,
      fileSize: envelopeSize,
      duration,
      encryptionHash: checksumOriginal,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error("[GoogleDriveBackup] Erreur:", error.message);

    await db.insert(autoBackupsTable).values({
      type: "google_drive",
      status: "erreur",
      platform: "google",
      dataSummary: { error: error.message },
      duration,
      errorMessage: error.message,
    });

    return { success: false, error: error.message, duration };
  } finally {
    isRunning = false;
  }
}

export async function listGoogleDriveBackups(): Promise<{
  success: boolean;
  files?: any[];
  folderId?: string;
  error?: string;
}> {
  try {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) return { success: false, error: "Google OAuth non configure." };

    const superAdmins = await db.select().from(usersTable).where(eq(usersTable.role, "super_admin"));
    let tokenRecord = null;
    for (const admin of superAdmins) {
      const tokens = await db.select().from(googleOAuthTokensTable)
        .where(eq(googleOAuthTokensTable.userId, admin.id));
      if (tokens.length > 0 && tokens[0].scope.includes("drive")) {
        tokenRecord = tokens[0];
        break;
      }
    }

    if (!tokenRecord) return { success: false, error: "Aucun token Google Drive valide." };

    oauth2Client.setCredentials({
      access_token: tokenRecord.accessToken,
      refresh_token: tokenRecord.refreshToken,
    });

    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const folderId = await findOrCreateDriveFolder(drive);

    const listRes = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "files(id, name, size, createdTime, modifiedTime, webViewLink)",
      orderBy: "createdTime desc",
      pageSize: 50,
    });

    return {
      success: true,
      files: listRes.data.files || [],
      folderId,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

const DRIVE_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startGoogleDriveBackupScheduler() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.log("[GoogleDriveBackup] Google OAuth non configure, sauvegarde Drive desactivee.");
    return;
  }

  console.log(`[GoogleDriveBackup] Planificateur demarre - Intervalle: ${DRIVE_BACKUP_INTERVAL_MS / 3600000}h`);

  intervalHandle = setInterval(async () => {
    if (isRunning) return;
    console.log("[GoogleDriveBackup] Sauvegarde automatique en cours...");
    const result = await performGoogleDriveBackup();
    console.log(`[GoogleDriveBackup] Auto: ${result.success ? "OK" : "ERREUR"} ${result.error || ""}`);
  }, DRIVE_BACKUP_INTERVAL_MS);
}

export function stopGoogleDriveBackupScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[GoogleDriveBackup] Planificateur arrete.");
  }
}
