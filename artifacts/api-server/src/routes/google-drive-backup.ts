import { Router, type Request, type Response } from "express";
import { performGoogleDriveBackup, listGoogleDriveBackups, isConnectorAvailable, downloadAndDecryptBackup, verifyBackup, restoreFromBackup, exportBackupAsJSON } from "../services/google-drive-backup";
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

  const totalBackups = await db.select({
    total: sql<number>`count(*)::int`,
    totalSize: sql<number>`coalesce(sum(${autoBackupsTable.sizeBytes}), 0)::bigint`,
  }).from(autoBackupsTable).where(eq(autoBackupsTable.platform, "google"));

  res.json({
    configured,
    schedulerActive: configured,
    intervalHours: 6,
    encryption: "AES-256-GCM",
    lastBackup: lastBackup[0] || null,
    lastSuccessfulBackup: lastSuccess[0] || null,
    totalBackups: totalBackups[0]?.total || 0,
    totalStorageBytes: Number(totalBackups[0]?.totalSize || 0),
    backedUpTables: 29,
    features: [
      "AES-256-GCM encryption",
      "SHA-256 integrity verification",
      "29 tables backed up",
      "Auto-schedule every 6 hours",
      "90-day retention policy",
      "Full restore capability",
      "Dry-run restore preview",
      "Per-table selective restore",
      "Local JSON export",
    ],
  });
});

router.post("/google-drive-backup/verify/:fileId", async (req: Request, res: Response): Promise<void> => {
  const fileId = String(req.params.fileId);
  if (!fileId) {
    res.status(400).json({ error: "fileId requis." });
    return;
  }

  const result = await verifyBackup(fileId);
  if (result.success) {
    res.json(result);
  } else {
    res.status(500).json(result);
  }
});

router.post("/google-drive-backup/preview/:fileId", async (req: Request, res: Response): Promise<void> => {
  const fileId = String(req.params.fileId);
  if (!fileId) {
    res.status(400).json({ error: "fileId requis." });
    return;
  }

  const result = await downloadAndDecryptBackup(fileId);
  if (!result.success) {
    res.status(500).json({ error: result.error });
    return;
  }

  const preview: Record<string, any> = {};
  for (const [key, value] of Object.entries(result.data)) {
    if (key === "_meta") {
      preview._meta = value;
      continue;
    }
    const tableData = value as any;
    preview[key] = {
      count: tableData?.count || 0,
      sample: (tableData?.data || []).slice(0, 3),
    };
  }

  res.json({ success: true, preview, meta: result.meta });
});

router.post("/google-drive-backup/restore/:fileId", async (req: Request, res: Response): Promise<void> => {
  const fileId = String(req.params.fileId);
  const { tables, dryRun = true, clearBeforeRestore = false } = req.body;

  if (!fileId) {
    res.status(400).json({ error: "fileId requis." });
    return;
  }

  if (!dryRun && clearBeforeRestore) {
    const confirmCode = req.body.confirmCode;
    if (confirmCode !== "RESTAURER-TOUT") {
      res.status(400).json({
        error: "Pour une restauration destructive, envoyez confirmCode: 'RESTAURER-TOUT'.",
        hint: "Cette operation supprimera les donnees existantes avant la restauration.",
      });
      return;
    }
  }

  const result = await restoreFromBackup(fileId, {
    tables: tables || undefined,
    dryRun: dryRun !== false,
    clearBeforeRestore: clearBeforeRestore === true,
  });

  if (result.success) {
    res.json({
      message: result.dryRun
        ? `Simulation terminee: ${result.totalRestored} enregistrements seraient restaures.`
        : `Restauration terminee: ${result.totalRestored} enregistrements restaures.`,
      ...result,
    });
  } else {
    res.status(500).json(result);
  }
});

router.get("/google-drive-backup/export-local", async (_req: Request, res: Response): Promise<void> => {
  const result = await exportBackupAsJSON();
  if (!result.success) {
    res.status(500).json({ error: result.error });
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
  res.setHeader("Content-Length", String(result.size));
  res.send(result.data);
});

router.get("/google-drive-backup/export-encrypted", async (_req: Request, res: Response): Promise<void> => {
  try {
    const backupResult = await performGoogleDriveBackup();
    if (backupResult.success) {
      res.json({
        message: "Sauvegarde chiffree creee et uploadee sur Google Drive.",
        ...backupResult,
      });
    } else {
      res.status(500).json({ error: backupResult.error });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/google-drive-backup/tables", async (_req: Request, res: Response): Promise<void> => {
  const tables = [
    { name: "organisations", category: "Systeme", description: "Organisations clientes", critical: true },
    { name: "subscriptions", category: "Systeme", description: "Abonnements/licences", critical: true },
    { name: "users", category: "Systeme", description: "Comptes utilisateurs", critical: true },
    { name: "contacts", category: "CRM", description: "Fiches contacts", critical: true },
    { name: "calls", category: "Telephonie", description: "Historique des appels", critical: true },
    { name: "tasks", category: "Productivite", description: "Taches et suivi", critical: true },
    { name: "messages", category: "Communication", description: "Messages SMS/chat", critical: true },
    { name: "checkins", category: "RH", description: "Pointages equipe", critical: false },
    { name: "stock_articles", category: "Stock", description: "Articles en stock", critical: false },
    { name: "automations", category: "Automatisation", description: "Regles d'automatisation", critical: false },
    { name: "calendar_events", category: "Agenda", description: "Evenements agenda", critical: true },
    { name: "invoices", category: "Facturation", description: "Factures systeme", critical: true },
    { name: "payments", category: "Facturation", description: "Paiements", critical: true },
    { name: "legal_agreements", category: "Juridique", description: "Accords legaux", critical: false },
    { name: "audit_logs", category: "Securite", description: "Journal d'audit", critical: false },
    { name: "platform_connections", category: "Integrations", description: "Connexions logiciels", critical: false },
    { name: "prospects", category: "CRM", description: "Pipeline prospects", critical: true },
    { name: "devis", category: "Commercial", description: "Devis clients", critical: true },
    { name: "factures_client", category: "Commercial", description: "Factures clients", critical: true },
    { name: "projets", category: "Projets", description: "Projets en cours", critical: true },
    { name: "notifications", category: "Systeme", description: "Notifications", critical: false },
    { name: "google_oauth_tokens", category: "Integrations", description: "Tokens Google OAuth", critical: false },
    { name: "admin_reports", category: "Administration", description: "Rapports admin", critical: false },
    { name: "ai_agent_reports", category: "IA", description: "Rapports agents IA", critical: false },
    { name: "daily_reports", category: "Rapports", description: "Rapports quotidiens", critical: false },
    { name: "performance_reports", category: "RH", description: "Rapports performance", critical: false },
    { name: "automation_rules", category: "Automatisation", description: "Regles automatisation", critical: false },
    { name: "automation_logs", category: "Automatisation", description: "Logs automatisation", critical: false },
    { name: "platform_sync_logs", category: "Integrations", description: "Logs synchronisation", critical: false },
  ];

  const criticalCount = tables.filter(t => t.critical).length;
  const categories = [...new Set(tables.map(t => t.category))];

  res.json({
    tables,
    summary: {
      total: tables.length,
      critical: criticalCount,
      categories,
    },
  });
});

export default router;
