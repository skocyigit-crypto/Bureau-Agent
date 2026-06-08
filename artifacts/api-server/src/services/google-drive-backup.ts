import { google } from "googleapis";
import { db, autoBackupsTable, backupConfigTable, googleOAuthTokensTable, usersTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { getOrgGoogleCredentials, getGoogleRedirectUri, decryptToken, ensureTokenRowEncrypted } from "../lib/google-auth";

const DRIVE_FOLDER_NAME = "Agent de Bureau - Sauvegardes";
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// ---------------------------------------------------------------------------
// Google Drive auth — service account or per-user OAuth token
// ---------------------------------------------------------------------------

async function getGoogleDriveAccessToken(): Promise<string | null> {
  // 1. Try service account (GOOGLE_SERVICE_ACCOUNT_KEY_JSON_B64 — base64 encoded JSON)
  const saKeyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON_B64;
  if (saKeyB64) {
    try {
      const keyJson = Buffer.from(saKeyB64, "base64").toString("utf-8");
      const credentials = JSON.parse(keyJson);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/drive"],
      });
      const token = await auth.getAccessToken();
      if (token) return token;
    } catch (err: any) {
      logger.warn({ err: err.message }, "[GoogleDriveBackup] Service account auth failed, trying OAuth fallback:");
    }
  }

  // 2. Try GOOGLE_SERVICE_ACCOUNT_KEY_JSON (plain JSON string — legacy)
  const saKeyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (saKeyJson) {
    try {
      const credentials = JSON.parse(saKeyJson);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/drive"],
      });
      const token = await auth.getAccessToken();
      if (token) return token;
    } catch (err: any) {
      logger.warn({ err: err.message }, "[GoogleDriveBackup] Service account (plain JSON) auth failed:");
    }
  }

  // 3. Fall back to the SUPER-ADMIN's own OAuth token with drive scope.
  //    Isolation multi-tenant : la sauvegarde plateforme ne doit JAMAIS atterrir
  //    dans le Drive d'un client. On joint sur users.role = 'super_admin' pour
  //    n'utiliser que le compte du proprietaire de la plateforme (sinon -> null,
  //    et la sauvegarde echoue proprement plutot que de fuiter chez un client).
  try {
    const tokens = await withDbRetry(
      () => db
        .select({
          id: googleOAuthTokensTable.id,
          accessToken: googleOAuthTokensTable.accessToken,
          refreshToken: googleOAuthTokensTable.refreshToken,
          scope: googleOAuthTokensTable.scope,
          organisationId: googleOAuthTokensTable.organisationId,
        })
        .from(googleOAuthTokensTable)
        .innerJoin(usersTable, eq(usersTable.id, googleOAuthTokensTable.userId))
        .where(eq(usersTable.role, "super_admin"))
        .orderBy(desc(googleOAuthTokensTable.updatedAt))
        .limit(10),
      { label: "drive-backup:super-admin-tokens" },
    );

    const driveToken = tokens.find(t => (t.scope || "").includes("drive"));
    if (!driveToken) return null;

    await ensureTokenRowEncrypted({
      id: driveToken.id,
      accessToken: driveToken.accessToken,
      refreshToken: driveToken.refreshToken,
    });

    const creds = await getOrgGoogleCredentials(driveToken.organisationId, { envOnly: true });
    if (!creds) return null;

    const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, getGoogleRedirectUri());
    oauth2Client.setCredentials({
      access_token: decryptToken(driveToken.accessToken),
      refresh_token: decryptToken(driveToken.refreshToken),
    });

    const { token } = await oauth2Client.getAccessToken();
    return token || null;
  } catch (err: any) {
    logger.warn({ err: err.message }, "[GoogleDriveBackup] OAuth token fallback failed:");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Direct Google Drive API calls (no Replit connector SDK)
// ---------------------------------------------------------------------------

// Defense-in-depth SSRF guard: even though all current callers pass hardcoded
// path strings, lock the absolute-URL branch to the official Google API hosts
// so a future caller cannot accidentally turn this into an open relay (e.g.
// hitting 169.254.169.254 metadata service or internal services).
const GOOGLE_API_HOSTS = new Set([
  "www.googleapis.com",
  "oauth2.googleapis.com",
  "drive.googleapis.com",
  "storage.googleapis.com",
  "content.googleapis.com",
]);

async function googleDriveRequest(accessToken: string, path: string, options: RequestInit = {}): Promise<any> {
  let base: string;
  if (path.startsWith("https://")) {
    let parsed: URL;
    try { parsed = new URL(path); } catch { throw new Error("googleDriveRequest: URL invalide."); }
    if (!GOOGLE_API_HOSTS.has(parsed.host)) {
      throw new Error(`googleDriveRequest: host non autorise (${parsed.host}).`);
    }
    base = parsed.toString();
  } else if (path.startsWith("/")) {
    base = `https://www.googleapis.com${path}`;
  } else {
    throw new Error("googleDriveRequest: chemin invalide (doit commencer par / ou https://).");
  }

  // Hard timeout: an unresponsive Drive endpoint must not pin the request
  // handler indefinitely. 30s covers normal latency + multipart uploads.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(base, {
      ...options,
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers as Record<string, string> || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return {};

  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

let _devBackupKeyWarned = false;
function deriveEncryptionKey(): Buffer {
  let secret = process.env.BACKUP_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("BACKUP_ENCRYPTION_KEY (ou SESSION_SECRET) est requis en production pour chiffrer les sauvegardes.");
    }
    if (!_devBackupKeyWarned) {
      _devBackupKeyWarned = true;
      // eslint-disable-next-line no-console
      console.warn("[Security] BACKUP_ENCRYPTION_KEY non defini — cle ephemere generee (dev uniquement). Les sauvegardes anciennes ne pourront pas etre dechiffrees apres redemarrage.");
    }
    secret = crypto.randomBytes(48).toString("hex");
    process.env.BACKUP_ENCRYPTION_KEY = secret;
  }
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

function decryptData(encryptedBase64: string, iv: string, authTag: string): string {
  const key = deriveEncryptionKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"), { authTagLength: 16 });
  (decipher as any).setAuthTag(Buffer.from(authTag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

// ---------------------------------------------------------------------------
// DB data collection
// ---------------------------------------------------------------------------

async function collectFullBackupData(): Promise<object> {
  const tables = [
    "organisations", "subscriptions", "users", "contacts", "calls",
    "tasks", "messages", "checkins", "stock_articles", "automations",
    "calendar_events", "invoices", "payments", "legal_agreements",
    "audit_logs", "platform_connections",
    "prospects", "devis", "factures_client", "projets",
    "notifications", "google_oauth_tokens",
    "admin_reports", "ai_agent_reports", "daily_reports",
    "performance_reports", "automation_rules", "automation_logs",
    "platform_sync_logs",
  ];

  const snapshot: Record<string, any> = {};
  for (const table of tables) {
    try {
      const rows = await withDbRetry(
        () => db.execute(sql`SELECT * FROM ${sql.identifier(table)}`),
        { label: `drive-backup:dump-${table}` },
      );
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
    version: "3.0",
    encryption: "AES-256-GCM",
    platform: "Agent de Bureau SaaS",
    tables: tables.length,
    tableNames: tables,
    totalRecords: Object.values(snapshot).reduce((sum: number, t: any) => sum + (t?.count || 0), 0),
  };

  return snapshot;
}

// ---------------------------------------------------------------------------
// Drive helpers
// ---------------------------------------------------------------------------

async function findOrCreateDriveFolder(accessToken: string): Promise<string> {
  const searchResult = await googleDriveRequest(
    accessToken,
    `/drive/v3/files?q=name%3D'${encodeURIComponent(DRIVE_FOLDER_NAME)}'%20and%20mimeType%3D'application%2Fvnd.google-apps.folder'%20and%20trashed%3Dfalse&fields=files(id,name)&spaces=drive`,
    { method: "GET" }
  );

  if (searchResult.files && searchResult.files.length > 0) {
    return searchResult.files[0].id;
  }

  const createResult = await googleDriveRequest(accessToken, "/drive/v3/files", {
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

async function uploadFileToDrive(accessToken: string, folderId: string, fileName: string, content: string, description: string): Promise<any> {
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

  return googleDriveRequest(
    accessToken,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );
}

async function cleanupOldDriveBackups(accessToken: string, folderId: string, retentionDays: number) {
  try {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoffDate.toISOString();

    const listResult = await googleDriveRequest(
      accessToken,
      `/drive/v3/files?q='${folderId}'%20in%20parents%20and%20trashed%3Dfalse%20and%20createdTime%20%3C%20'${cutoffStr}'&fields=files(id,name,createdTime)&orderBy=createdTime%20asc&pageSize=50`,
      { method: "GET" }
    );

    const oldFiles = listResult.files || [];
    for (const file of oldFiles) {
      try {
        await googleDriveRequest(accessToken, `/drive/v3/files/${file.id}`, { method: "DELETE" });
        logger.info(`[GoogleDriveBackup] Ancien fichier supprime: ${file.name}`);
      } catch (err) { logger.warn({ err: err }, "[GoogleDriveBackup] operation failed:"); }
    }
    if (oldFiles.length > 0) {
      logger.info(`[GoogleDriveBackup] ${oldFiles.length} ancienne(s) sauvegarde(s) nettoyee(s).`);
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "[GoogleDriveBackup] Erreur nettoyage:");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function isGoogleDriveConnected(): Promise<boolean> {
  try {
    const token = await getGoogleDriveAccessToken();
    if (!token) return false;
    const data = await googleDriveRequest(token, "/drive/v3/about?fields=user", { method: "GET" });
    return !!data?.user;
  } catch {
    return false;
  }
}

/** @deprecated Use isGoogleDriveConnected instead */
export const isConnectorAvailable = isGoogleDriveConnected;

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
    const accessToken = await getGoogleDriveAccessToken();
    if (!accessToken) {
      return { success: false, error: "Google Drive non configure. Ajoutez GOOGLE_SERVICE_ACCOUNT_KEY_JSON_B64 ou connectez-vous via OAuth." };
    }

    logger.info("[GoogleDriveBackup] Collecte des donnees...");
    const backupData = await collectFullBackupData();
    const jsonStr = JSON.stringify(backupData);
    const originalSize = Buffer.byteLength(jsonStr, "utf-8");

    logger.info("[GoogleDriveBackup] Chiffrement AES-256-GCM...");
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

    logger.info("[GoogleDriveBackup] Recherche/creation du dossier Drive...");
    const folderId = await findOrCreateDriveFolder(accessToken);

    const now = new Date();
    const fileName = `backup_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.adb.enc`;

    const description = `Sauvegarde chiffree Agent de Bureau - ${now.toLocaleDateString("fr-FR")} ${now.toLocaleTimeString("fr-FR")} | AES-256-GCM | SHA-256: ${checksumOriginal.substring(0, 16)}`;

    logger.info("[GoogleDriveBackup] Upload vers Google Drive...");
    const uploadRes = await uploadFileToDrive(accessToken, folderId, fileName, envelope, description);

    const duration = Date.now() - startTime;

    const configs = await withDbRetry(
      () => db.select().from(backupConfigTable).where(eq(backupConfigTable.platform, "google")),
      { label: "drive-backup:backup-config" },
    );
    const retentionDays = configs.length > 0 ? configs[0].retentionDays : 90;
    await cleanupOldDriveBackups(accessToken, folderId, retentionDays);

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

    logger.info(`[GoogleDriveBackup] Sauvegarde reussie: ${fileName} (${(envelopeSize / 1024).toFixed(1)} Ko, ${duration}ms)`);

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
    logger.error({ err: error.message }, "[GoogleDriveBackup] Erreur:");

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
    const accessToken = await getGoogleDriveAccessToken();
    if (!accessToken) return { success: false, error: "Google Drive non configure." };

    const folderId = await findOrCreateDriveFolder(accessToken);

    const listResult = await googleDriveRequest(
      accessToken,
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

export async function downloadAndDecryptBackup(fileId: string): Promise<{
  success: boolean;
  data?: any;
  meta?: any;
  error?: string;
}> {
  try {
    const accessToken = await getGoogleDriveAccessToken();
    if (!accessToken) return { success: false, error: "Google Drive non configure." };

    const content = await googleDriveRequest(
      accessToken,
      `/drive/v3/files/${fileId}?alt=media`,
      { method: "GET" }
    );

    let envelope: any;
    if (typeof content === "string") {
      envelope = JSON.parse(content);
    } else if (content && typeof content === "object") {
      envelope = content;
    } else {
      return { success: false, error: "Contenu du fichier invalide." };
    }

    if (!envelope.encryption || !envelope.data) {
      return { success: false, error: "Format de sauvegarde invalide (pas d'enveloppe chiffree)." };
    }

    const decryptedStr = decryptData(
      envelope.data,
      envelope.encryption.iv,
      envelope.encryption.authTag
    );

    const checksum = crypto.createHash("sha256").update(decryptedStr).digest("hex");
    if (envelope.integrity?.originalChecksum && checksum !== envelope.integrity.originalChecksum) {
      return { success: false, error: "Integrite compromise: le checksum ne correspond pas. Fichier possiblement corrompu." };
    }

    const parsed = JSON.parse(decryptedStr);
    return {
      success: true,
      data: parsed,
      meta: {
        ...envelope.metadata,
        integrity: "verified",
        checksum: checksum.substring(0, 16),
        originalSize: envelope.integrity?.originalSize,
        tables: parsed._meta?.tables,
        totalRecords: parsed._meta?.totalRecords,
        version: parsed._meta?.version,
      },
    };
  } catch (error: any) {
    return { success: false, error: `Erreur de dechiffrement: ${error.message}` };
  }
}

export async function verifyBackup(fileId: string): Promise<{
  success: boolean;
  valid?: boolean;
  details?: {
    format: string;
    version: string;
    encryption: string;
    integrityMatch: boolean;
    tablesCount: number;
    totalRecords: number;
    createdAt: string;
    sizeOriginal: number;
    sizeEncrypted: number;
    tableDetails: { name: string; count: number }[];
  };
  error?: string;
}> {
  try {
    const result = await downloadAndDecryptBackup(fileId);
    if (!result.success || !result.data) {
      return { success: false, valid: false, error: result.error };
    }

    const data = result.data;
    const meta = data._meta || {};
    const tableDetails: { name: string; count: number }[] = [];
    let totalRecords = 0;

    for (const [key, value] of Object.entries(data)) {
      if (key === "_meta") continue;
      const tableData = value as any;
      const count = tableData?.count || 0;
      tableDetails.push({ name: key, count });
      totalRecords += count;
    }

    return {
      success: true,
      valid: true,
      details: {
        format: "agent-de-bureau-backup",
        version: meta.version || "unknown",
        encryption: "AES-256-GCM",
        integrityMatch: true,
        tablesCount: tableDetails.length,
        totalRecords,
        createdAt: meta.exportedAt || "unknown",
        sizeOriginal: result.meta?.originalSize || 0,
        sizeEncrypted: 0,
        tableDetails,
      },
    };
  } catch (error: any) {
    return { success: false, valid: false, error: error.message };
  }
}

export async function restoreFromBackup(fileId: string, options: {
  tables?: string[];
  dryRun?: boolean;
  clearBeforeRestore?: boolean;
}): Promise<{
  success: boolean;
  restoredTables?: { name: string; inserted: number; skipped: number; errors: number }[];
  totalRestored?: number;
  dryRun?: boolean;
  error?: string;
  warnings?: string[];
}> {
  try {
    const downloadResult = await downloadAndDecryptBackup(fileId);
    if (!downloadResult.success || !downloadResult.data) {
      return { success: false, error: downloadResult.error };
    }

    const backupData = downloadResult.data;
    const warnings: string[] = [];
    const restoredTables: { name: string; inserted: number; skipped: number; errors: number }[] = [];
    let totalRestored = 0;

    const safeRestoreOrder = [
      "organisations", "subscriptions", "users",
      "contacts", "calls", "tasks", "messages",
      "checkins", "stock_articles", "automations",
      "calendar_events", "invoices", "payments",
      "legal_agreements", "platform_connections",
      "prospects", "devis", "factures_client", "projets",
      "notifications", "google_oauth_tokens",
      "admin_reports", "ai_agent_reports", "daily_reports",
      "performance_reports", "automation_rules", "automation_logs",
      "platform_sync_logs", "audit_logs",
    ];

    const tablesToRestore = options.tables
      ? safeRestoreOrder.filter(t => options.tables!.includes(t))
      : safeRestoreOrder;

    if (options.dryRun) {
      for (const tableName of tablesToRestore) {
        const tableData = backupData[tableName];
        if (!tableData || !tableData.data || tableData.data.length === 0) {
          restoredTables.push({ name: tableName, inserted: 0, skipped: 0, errors: 0 });
          continue;
        }
        restoredTables.push({
          name: tableName,
          inserted: tableData.data.length,
          skipped: 0,
          errors: 0,
        });
        totalRestored += tableData.data.length;
      }
      return { success: true, restoredTables, totalRestored, dryRun: true, warnings };
    }

    for (const tableName of tablesToRestore) {
      const tableData = backupData[tableName];
      if (!tableData || !tableData.data || tableData.data.length === 0) {
        restoredTables.push({ name: tableName, inserted: 0, skipped: 0, errors: 0 });
        continue;
      }

      let inserted = 0;
      let skipped = 0;
      let errors = 0;

      try {
        if (options.clearBeforeRestore) {
          await db.execute(sql`DELETE FROM ${sql.identifier(tableName)}`);
        }

        for (const row of tableData.data) {
          try {
            const columns = Object.keys(row).filter(k => row[k] !== undefined);
            if (columns.length === 0) { skipped++; continue; }

            const colIdentifiers = columns.map(c => sql.identifier(c));
            const valuesArr = columns.map(c => {
              const v = row[c];
              if (v === null || v === undefined) return null;
              if (typeof v === "object") return JSON.stringify(v);
              return v;
            });

            if (options.clearBeforeRestore) {
              await db.execute(
                sql`INSERT INTO ${sql.identifier(tableName)} (${sql.join(colIdentifiers, sql`, `)}) VALUES (${sql.join(valuesArr.map(v => sql`${v}`), sql`, `)})`
              );
            } else {
              await db.execute(
                sql`INSERT INTO ${sql.identifier(tableName)} (${sql.join(colIdentifiers, sql`, `)}) VALUES (${sql.join(valuesArr.map(v => sql`${v}`), sql`, `)}) ON CONFLICT DO NOTHING`
              );
            }
            inserted++;
          } catch (rowErr: any) {
            errors++;
            if (errors <= 3) {
              warnings.push(`${tableName}: erreur ligne - ${rowErr.message?.substring(0, 100)}`);
            }
          }
        }
      } catch (tableErr: any) {
        errors = tableData.data.length;
        warnings.push(`${tableName}: erreur table - ${tableErr.message?.substring(0, 100)}`);
      }

      restoredTables.push({ name: tableName, inserted, skipped, errors });
      totalRestored += inserted;
    }

    await db.insert(autoBackupsTable).values({
      type: "restore",
      status: "termine",
      platform: "google",
      dataSummary: {
        sourceFileId: fileId,
        tablesRestored: restoredTables.filter(t => t.inserted > 0).length,
        totalRecords: totalRestored,
        warnings: warnings.length,
      },
      duration: 0,
    });

    return { success: true, restoredTables, totalRestored, dryRun: false, warnings };
  } catch (error: any) {
    return { success: false, error: `Erreur de restauration: ${error.message}` };
  }
}

export async function exportBackupAsJSON(): Promise<{
  success: boolean;
  data?: string;
  fileName?: string;
  size?: number;
  error?: string;
}> {
  try {
    const backupData = await collectFullBackupData();
    const jsonStr = JSON.stringify(backupData, null, 2);
    const now = new Date();
    const fileName = `backup_local_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.json`;

    return {
      success: true,
      data: jsonStr,
      fileName,
      size: Buffer.byteLength(jsonStr, "utf-8"),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

const DRIVE_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function startGoogleDriveBackupScheduler() {
  const available = await isGoogleDriveConnected();
  if (!available) {
    logger.info("[GoogleDriveBackup] Google Drive non connecte, sauvegarde Drive desactivee.");
    return;
  }

  logger.info(`[GoogleDriveBackup] Planificateur demarre - Intervalle: ${DRIVE_BACKUP_INTERVAL_MS / 3600000}h`);

  intervalHandle = setInterval(async () => {
    if (isRunning) return;
    logger.info("[GoogleDriveBackup] Sauvegarde automatique en cours...");
    const result = await performGoogleDriveBackup();
    logger.info(`[GoogleDriveBackup] Auto: ${result.success ? "OK" : "ERREUR"} ${result.error || ""}`);
  }, DRIVE_BACKUP_INTERVAL_MS);
}

export function stopGoogleDriveBackupScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info("[GoogleDriveBackup] Planificateur arrete.");
  }
}
