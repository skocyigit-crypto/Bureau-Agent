import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, autoBackupsTable, backupConfigTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import crypto from "crypto";

const DRIVE_FOLDER_NAME = "Agent de Bureau - Sauvegardes";
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let connectorsInstance: ReplitConnectors | null = null;

function getConnectors(): ReplitConnectors {
  if (!connectorsInstance) {
    connectorsInstance = new ReplitConnectors();
  }
  return connectorsInstance;
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

async function driveProxy(path: string, options: any = {}): Promise<any> {
  const connectors = getConnectors();
  const response = await connectors.proxy("google-drive", path, options);
  if (typeof response.json === "function") {
    return response.json();
  }
  return response;
}

async function findOrCreateDriveFolder(): Promise<string> {
  const searchResult = await driveProxy(
    `/drive/v3/files?q=name%3D'${encodeURIComponent(DRIVE_FOLDER_NAME)}'%20and%20mimeType%3D'application%2Fvnd.google-apps.folder'%20and%20trashed%3Dfalse&fields=files(id,name)&spaces=drive`,
    { method: "GET" }
  );

  if (searchResult.files && searchResult.files.length > 0) {
    return searchResult.files[0].id;
  }

  const createResult = await driveProxy("/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
      description: "Sauvegardes securisees de la plateforme Agent de Bureau. Chiffrement AES-256-GCM.",
    }),
  });

  return createResult.id;
}

async function uploadFileToDrive(folderId: string, fileName: string, content: string, description: string): Promise<any> {
  const boundary = "agent_de_bureau_boundary_" + crypto.randomBytes(8).toString("hex");
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
    mimeType: "application/octet-stream",
    description,
  });

  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Type: application/json; charset=UTF-8\r\n\r\n`,
    metadata,
    `\r\n--${boundary}\r\n`,
    `Content-Type: application/octet-stream\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ];
  const body = bodyParts.join("");

  const result = await driveProxy(
    "/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink",
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  return result;
}

async function cleanupOldDriveBackups(folderId: string, retentionDays: number) {
  try {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoffDate.toISOString();

    const listResult = await driveProxy(
      `/drive/v3/files?q='${folderId}'%20in%20parents%20and%20trashed%3Dfalse%20and%20createdTime%20%3C%20'${cutoffStr}'&fields=files(id,name,createdTime)&orderBy=createdTime%20asc&pageSize=50`,
      { method: "GET" }
    );

    const oldFiles = listResult.files || [];
    for (const file of oldFiles) {
      try {
        await driveProxy(`/drive/v3/files/${file.id}`, { method: "DELETE" });
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

export async function isConnectorAvailable(): Promise<boolean> {
  try {
    const connectors = getConnectors();
    const response = await connectors.proxy("google-drive", "/drive/v3/about?fields=user", { method: "GET" });
    const data = typeof response.json === "function" ? await response.json() : response;
    return !!data?.user;
  } catch {
    return false;
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
    const folderId = await findOrCreateDriveFolder();

    const now = new Date();
    const fileName = `backup_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.adb.enc`;

    const description = `Sauvegarde chiffree Agent de Bureau - ${now.toLocaleDateString("fr-FR")} ${now.toLocaleTimeString("fr-FR")} | AES-256-GCM | SHA-256: ${checksumOriginal.substring(0, 16)}`;

    console.log("[GoogleDriveBackup] Upload vers Google Drive...");
    const uploadRes = await uploadFileToDrive(folderId, fileName, envelope, description);

    const duration = Date.now() - startTime;

    const configs = await db.select().from(backupConfigTable).where(eq(backupConfigTable.platform, "google"));
    const retentionDays = configs.length > 0 ? configs[0].retentionDays : 90;
    await cleanupOldDriveBackups(folderId, retentionDays);

    await db.insert(autoBackupsTable).values({
      type: "google_drive",
      status: "termine",
      platform: "google",
      dataSummary: {
        fileId: uploadRes.id,
        fileName,
        folderId,
        originalSize,
        encryptedSize: envelopeSize,
        encryption: "AES-256-GCM",
        integrity: checksumOriginal.substring(0, 16),
        webViewLink: uploadRes.webViewLink,
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
      fileId: uploadRes.id,
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
    const folderId = await findOrCreateDriveFolder();

    const listResult = await driveProxy(
      `/drive/v3/files?q='${folderId}'%20in%20parents%20and%20trashed%3Dfalse&fields=files(id,name,size,createdTime,modifiedTime,webViewLink)&orderBy=createdTime%20desc&pageSize=50`,
      { method: "GET" }
    );

    return {
      success: true,
      files: listResult.files || [],
      folderId,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

const DRIVE_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function startGoogleDriveBackupScheduler() {
  const available = await isConnectorAvailable();
  if (!available) {
    console.log("[GoogleDriveBackup] Google Drive non connecte, sauvegarde Drive desactivee.");
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
