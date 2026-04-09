import { Router, type Request, type Response } from "express";
import { performGoogleDriveBackup, listGoogleDriveBackups } from "../services/google-drive-backup";
import { db, autoBackupsTable } from "@workspace/db";
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

router.get("/google-drive-backup/status", async (_req: Request, res: Response): Promise<void> => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const configured = !!(clientId && clientSecret);

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
