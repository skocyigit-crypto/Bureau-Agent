import { Router } from "express";
import { db, autoBackupsTable, backupConfigTable } from "@workspace/db";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { performBackup } from "../services/auto-backup";
import { logger } from "../lib/logger";

const router = Router();

router.get("/backups", async (req, res): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const platform = req.query.platform as string | undefined;

    let query = db.select().from(autoBackupsTable).orderBy(desc(autoBackupsTable.createdAt)).limit(limit);

    const backups = platform
      ? await db.select().from(autoBackupsTable).where(eq(autoBackupsTable.platform, platform)).orderBy(desc(autoBackupsTable.createdAt)).limit(limit)
      : await db.select().from(autoBackupsTable).orderBy(desc(autoBackupsTable.createdAt)).limit(limit);

    const stats = await db.select({
      total: sql<number>`count(*)`,
      termine: sql<number>`count(*) filter (where ${autoBackupsTable.status} = 'termine')`,
      erreur: sql<number>`count(*) filter (where ${autoBackupsTable.status} = 'erreur')`,
      totalSize: sql<number>`coalesce(sum(${autoBackupsTable.sizeBytes}), 0)`,
    }).from(autoBackupsTable);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStats = await db.select({
      count: sql<number>`count(*)`,
    }).from(autoBackupsTable).where(gte(autoBackupsTable.createdAt, todayStart));

    const platformStats = await db.select({
      platform: autoBackupsTable.platform,
      count: sql<number>`count(*)`,
      lastBackup: sql<string>`max(${autoBackupsTable.createdAt})`,
    }).from(autoBackupsTable).where(eq(autoBackupsTable.status, "termine")).groupBy(autoBackupsTable.platform);

    res.json({
      backups,
      stats: {
        total: stats[0]?.total || 0,
        termine: stats[0]?.termine || 0,
        erreur: stats[0]?.erreur || 0,
        totalSizeBytes: stats[0]?.totalSize || 0,
        today: todayStats[0]?.count || 0,
        platforms: platformStats,
      },
    });
  } catch (error: any) {
    logger.error({ err: error }, "Backups fetch error:");
    res.status(500).json({ error: "Erreur lors de la recuperation des sauvegardes." });
  }
});

router.get("/backups/config", async (_req, res) => {
  try {
    let configs = await db.select().from(backupConfigTable);

    if (configs.length === 0) {
      const defaults = [
        { platform: "local", enabled: "true", intervalMinutes: 2, retentionDays: 90, encryptionEnabled: "true", storagePath: "/secure/backups/local" },
        { platform: "google", enabled: "true", intervalMinutes: 2, retentionDays: 90, encryptionEnabled: "true", storagePath: "Google Drive > Agent de Bureau > Sauvegardes" },
        { platform: "microsoft", enabled: "true", intervalMinutes: 2, retentionDays: 90, encryptionEnabled: "true", storagePath: "OneDrive > Agent de Bureau > Backups" },
        { platform: "apple", enabled: "true", intervalMinutes: 2, retentionDays: 90, encryptionEnabled: "true", storagePath: "iCloud Drive > Agent de Bureau > Sauvegardes" },
      ];
      for (const d of defaults) {
        const existing = await db.select().from(backupConfigTable).where(eq(backupConfigTable.platform, d.platform));
        if (existing.length === 0) {
          await db.insert(backupConfigTable).values(d);
        }
      }
      configs = await db.select().from(backupConfigTable);
    }

    res.json({ configs });
  } catch (error: any) {
    logger.error({ err: error }, "Backup config error:");
    res.status(500).json({ error: "Erreur lors de la recuperation de la configuration." });
  }
});

router.post("/backups/config/:platform", async (req, res): Promise<void> => {
  try {
    const { platform } = req.params;
    const { enabled, intervalMinutes, retentionDays, encryptionEnabled } = req.body;

    const existing = await db.select().from(backupConfigTable).where(eq(backupConfigTable.platform, platform));

    if (existing.length === 0) {
      const [config] = await db.insert(backupConfigTable).values({
        platform,
        enabled: enabled ?? "true",
        intervalMinutes: intervalMinutes ?? 2,
        retentionDays: retentionDays ?? 90,
        encryptionEnabled: encryptionEnabled ?? "true",
      }).returning();
      res.json({ config, message: "Configuration creee." }); return;
    }

    const [updated] = await db.update(backupConfigTable)
      .set({
        ...(enabled !== undefined && { enabled }),
        ...(intervalMinutes !== undefined && { intervalMinutes }),
        ...(retentionDays !== undefined && { retentionDays }),
        ...(encryptionEnabled !== undefined && { encryptionEnabled }),
        updatedAt: new Date(),
      })
      .where(eq(backupConfigTable.platform, platform))
      .returning();

    res.json({ config: updated, message: `Configuration ${platform} mise a jour.` });
  } catch (error: any) {
    logger.error({ err: error }, "Backup config update error:");
    res.status(500).json({ error: "Erreur lors de la mise a jour de la configuration." });
  }
});

router.post("/backups/manual", async (_req, res) => {
  try {
    const result = await performBackup();
    if (!result.success) {
      logger.warn({ err: result.error }, "Sauvegarde manuelle echouee");
      res.status(500).json({ error: "Erreur lors de la sauvegarde manuelle." });
      return;
    }
    res.json({
      ...result,
      message: `Sauvegarde manuelle terminee en ${result.duration}ms.`,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Manual backup error:");
    res.status(500).json({ error: "Erreur lors de la sauvegarde manuelle." });
  }
});

router.get("/backups/latest", async (_req, res) => {
  try {
    const latest = await db.select().from(autoBackupsTable)
      .where(eq(autoBackupsTable.status, "termine"))
      .orderBy(desc(autoBackupsTable.createdAt))
      .limit(4);

    const nextBackupIn = 2 * 60 * 1000;
    const lastBackup = latest[0]?.createdAt;
    const elapsed = lastBackup ? Date.now() - new Date(lastBackup).getTime() : nextBackupIn;
    const remaining = Math.max(0, nextBackupIn - elapsed);

    res.json({
      latest,
      nextBackupMs: remaining,
      nextBackupAt: new Date(Date.now() + remaining).toISOString(),
      isActive: true,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Erreur backup status:");
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
