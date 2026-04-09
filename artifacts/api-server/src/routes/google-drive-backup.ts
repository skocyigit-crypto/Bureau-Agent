import { Router, type Request, type Response } from "express";
import { performGoogleDriveBackup, listGoogleDriveBackups, isConnectorAvailable } from "../services/google-drive-backup";
import { db, autoBackupsTable, backupConfigTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router = Router();

const requireSuperAdmin = (req: Request, res: Response, next: Function) => {
  const role = (req.session as any)?.userRole;
  if (role !== "super_admin") {
    res.status(403).json({ error: "Acces reserve au super administrateur." });
    return;
  }
  next();
};

router.use(requireSuperAdmin);

router.post("/google-drive-backup/run", async (_req: Request, res: Response): Promise<void> => {
  const result = await performGoogleDriveBackup();
  if (result.success) {
    res.json({
      message: `Sauvegarde Google Drive reussie : ${result.fileName}`,
      ...result,
    });
  } else {
    res.status(500).json({
      message: `Erreur de sauvegarde : ${result.error}`,
      ...result,
    });
  }
});

router.get("/google-drive-backup/files", async (_req: Request, res: Response): Promise<void> => {
  const result = await listGoogleDriveBackups();
  if (result.success) {
    res.json(result);
  } else {
    res.status(500).json(result);
  }
});

router.get("/google-drive-backup/history", async (_req: Request, res: Response): Promise<void> => {
  const backups = await db.select().from(autoBackupsTable)
    .where(eq(autoBackupsTable.platform, "google"))
    .orderBy(desc(autoBackupsTable.createdAt))
    .limit(50);

  const stats = await db.select({
    total: sql<number>`count(*)::int`,
    success: sql<number>`count(*) filter (where ${autoBackupsTable.status} = 'termine')::int`,
    errors: sql<number>`count(*) filter (where ${autoBackupsTable.status} = 'erreur')::int`,
    totalSize: sql<number>`coalesce(sum(${autoBackupsTable.sizeBytes}), 0)::bigint`,
    lastBackup: sql<string>`max(${autoBackupsTable.createdAt})`,
  }).from(autoBackupsTable).where(eq(autoBackupsTable.platform, "google"));

  res.json({
    backups,
    stats: {
      total: stats[0]?.total || 0,
      success: stats[0]?.success || 0,
      errors: stats[0]?.errors || 0,
      totalSizeBytes: Number(stats[0]?.totalSize || 0),
      lastBackup: stats[0]?.lastBackup || null,
    },
  });
});

router.get("/google-drive-backup/config", async (_req: Request, res: Response): Promise<void> => {
  const configs = await db.select().from(backupConfigTable).where(eq(backupConfigTable.platform, "google"));
  if (configs.length === 0) {
    await db.insert(backupConfigTable).values({
      platform: "google",
      enabled: "true",
      intervalMinutes: 360,
      retentionDays: 90,
      encryptionEnabled: "true",
      storagePath: "Google Drive > Agent de Bureau - Sauvegardes",
    });
    const newConfig = await db.select().from(backupConfigTable).where(eq(backupConfigTable.platform, "google"));
    res.json(newConfig[0]);
    return;
  }
  res.json(configs[0]);
});

router.put("/google-drive-backup/config", async (req: Request, res: Response): Promise<void> => {
  const { enabled, intervalMinutes, retentionDays, encryptionEnabled } = req.body;

  const updates: any = { updatedAt: new Date() };
  if (enabled !== undefined) updates.enabled = String(enabled);
  if (intervalMinutes !== undefined) {
    const mins = Number(intervalMinutes);
    if (mins < 60 || mins > 1440) {
      res.status(400).json({ error: "L'intervalle doit etre entre 60 minutes (1h) et 1440 minutes (24h)." });
      return;
    }
    updates.intervalMinutes = mins;
  }
  if (retentionDays !== undefined) {
    const days = Number(retentionDays);
    if (days < 7 || days > 365) {
      res.status(400).json({ error: "La retention doit etre entre 7 et 365 jours." });
      return;
    }
    updates.retentionDays = days;
  }
  if (encryptionEnabled !== undefined) updates.encryptionEnabled = String(encryptionEnabled);

  const existing = await db.select().from(backupConfigTable).where(eq(backupConfigTable.platform, "google"));
  if (existing.length === 0) {
    await db.insert(backupConfigTable).values({
      platform: "google",
      ...updates,
    });
  } else {
    await db.update(backupConfigTable).set(updates).where(eq(backupConfigTable.platform, "google"));
  }

  const updated = await db.select().from(backupConfigTable).where(eq(backupConfigTable.platform, "google"));
  res.json({ message: "Configuration mise a jour.", config: updated[0] });
});

router.get("/google-drive-backup/status", async (_req: Request, res: Response): Promise<void> => {
  const configured = await isConnectorAvailable();

  const lastBackup = await db.select().from(autoBackupsTable)
    .where(eq(autoBackupsTable.platform, "google"))
    .orderBy(desc(autoBackupsTable.createdAt))
    .limit(1);

  const lastSuccess = await db.select().from(autoBackupsTable)
    .where(sql`${autoBackupsTable.platform} = 'google' AND ${autoBackupsTable.status} = 'termine'`)
    .orderBy(desc(autoBackupsTable.createdAt))
    .limit(1);

  res.json({
    configured,
    schedulerActive: configured,
    intervalHours: 6,
    encryption: "AES-256-GCM",
    lastBackup: lastBackup[0] || null,
    lastSuccessfulBackup: lastSuccess[0] || null,
  });
});

export default router;
