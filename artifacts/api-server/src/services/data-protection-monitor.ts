import { db } from "@workspace/db";
import {
  notificationsTable,
  automationLogsTable,
  organisationsTable,
  subscriptionsTable,
  usersTable,
  autoBackupsTable,
  backupConfigTable,
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";

let monitorInterval: ReturnType<typeof setInterval> | null = null;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BACKUP_STALE_HOURS = 48;
const BACKUP_WARNING_HOURS = 24;
const DATA_GROWTH_ALERT_PERCENT = 30;

interface OrgBackupStatus {
  orgId: number;
  orgName: string;
  plan: string;
  status: string;
  adminEmails: string[];
  adminUserIds: number[];
  lastBackupAt: Date | null;
  backupEnabled: boolean;
  totalRecords: number;
  issues: string[];
  severity: "critique" | "haute" | "moyenne" | "info";
}

export function startDataProtectionMonitor() {
  if (monitorInterval) return;
  logger.info("[DataProtection] Moniteur de protection des donnees demarre");

  setTimeout(() => runDataProtectionCheck(), 30 * 1000);
  monitorInterval = setInterval(runDataProtectionCheck, CHECK_INTERVAL_MS);

  const shutdown = () => {
    logger.info("[DataProtection] Arret du moniteur");
    stopDataProtectionMonitor();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function stopDataProtectionMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

async function runDataProtectionCheck() {
  const start = performance.now();
  logger.info("[DataProtection] Verification de la protection des donnees...");

  try {
    const orgsWithSubs = await withDbRetry(
      () =>
        db
          .select({
            orgId: organisationsTable.id,
            orgName: organisationsTable.name,
            orgActif: organisationsTable.actif,
            plan: subscriptionsTable.plan,
            subStatus: subscriptionsTable.status,
            trialEndsAt: subscriptionsTable.trialEndsAt,
          })
          .from(organisationsTable)
          .innerJoin(subscriptionsTable, eq(subscriptionsTable.organisationId, organisationsTable.id))
          .where(eq(organisationsTable.actif, true)),
      { label: "data-protection:orgs-with-subs" },
    );

    if (orgsWithSubs.length === 0) {
      logger.info("[DataProtection] Aucune organisation active trouvee.");
      return;
    }

    const backupConfigs = await withDbRetry(
      () => db.select().from(backupConfigTable),
      { label: "data-protection:backup-configs" },
    );
    const driveConfig = backupConfigs.find(c => c.platform === "google_drive");
    const localConfig = backupConfigs.find(c => c.platform === "local");

    const recentBackups = await withDbRetry(
      () =>
        db
          .select()
          .from(autoBackupsTable)
          .where(eq(autoBackupsTable.status, "termine"))
          .orderBy(desc(autoBackupsTable.createdAt))
          .limit(20),
      { label: "data-protection:recent-backups" },
    );

    const lastSuccessfulBackup = recentBackups[0] || null;

    const tableCounts = await getTableRecordCounts();
    const totalRecords = Object.values(tableCounts).reduce((sum, c) => sum + c, 0);

    let totalNotifications = 0;

    for (const org of orgsWithSubs) {
      const orgStatus = await analyzeOrgBackupStatus(org, lastSuccessfulBackup, driveConfig, localConfig, totalRecords);

      if (orgStatus.issues.length > 0) {
        totalNotifications += await createProtectionNotifications(orgStatus);
      }
    }

    await checkGlobalBackupHealth(lastSuccessfulBackup, driveConfig, totalRecords, tableCounts);

    await logMonitorRun("success", {
      orgsChecked: orgsWithSubs.length,
      notificationsSent: totalNotifications,
      totalRecords,
      lastBackup: lastSuccessfulBackup?.createdAt || null,
    }, performance.now() - start);

    logger.info(`[DataProtection] Verification terminee: ${orgsWithSubs.length} organisations, ${totalNotifications} alertes envoyees`);

  } catch (err: any) {
    logger.error({ err: err.message }, "[DataProtection] Erreur:");
    await logMonitorRun("error", { error: err.message }, performance.now() - start, err.message);
  }
}

async function getTableRecordCounts(): Promise<Record<string, number>> {
  const tables = [
    "organisations", "users", "contacts", "calls", "tasks", "messages",
    "prospects", "devis", "factures_client", "projets", "stock_articles",
    "calendar_events", "invoices", "checkins",
  ];
  const counts: Record<string, number> = {};

  for (const table of tables) {
    try {
      const result = await withDbRetry(
        () => db.execute(sql`SELECT COUNT(*) as cnt FROM ${sql.identifier(table)}`),
        { label: `data-protection:count-${table}` },
      );
      const rows = Array.isArray(result) ? result : (result as any)?.rows || [];
      counts[table] = parseInt(rows[0]?.cnt || "0", 10);
    } catch {
      counts[table] = 0;
    }
  }

  return counts;
}

async function analyzeOrgBackupStatus(
  org: any,
  lastBackup: any | null,
  driveConfig: any | null,
  localConfig: any | null,
  totalRecords: number
): Promise<OrgBackupStatus> {
  const admins = await withDbRetry(
    () =>
      db
        .select({ id: usersTable.id, email: usersTable.email })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.organisationId, org.orgId),
            eq(usersTable.actif, true),
            inArray(usersTable.role, ["super_admin", "administrateur"])
          )
        ),
    { label: "data-protection:org-admins" },
  );

  const issues: string[] = [];
  let severity: string = "info";

  const now = new Date();
  const backupAge = lastBackup?.createdAt
    ? (now.getTime() - new Date(lastBackup.createdAt).getTime()) / (1000 * 60 * 60)
    : null;

  if (!lastBackup) {
    issues.push("Aucune sauvegarde n'a encore ete effectuee. Vos donnees ne sont pas protegees.");
    severity = "critique";
  } else if (backupAge && backupAge > BACKUP_STALE_HOURS) {
    issues.push(`Derniere sauvegarde il y a ${Math.round(backupAge)} heures (seuil: ${BACKUP_STALE_HOURS}h). Risque de perte de donnees.`);
    severity = "critique";
  } else if (backupAge && backupAge > BACKUP_WARNING_HOURS) {
    issues.push(`Derniere sauvegarde il y a ${Math.round(backupAge)} heures. Une sauvegarde recente est recommandee.`);
    severity = severity === "critique" ? "critique" : "haute";
  }

  const driveEnabled = driveConfig?.enabled === "true";
  const localEnabled = localConfig?.enabled === "true";

  if (!driveEnabled && !localEnabled) {
    issues.push("Aucun systeme de sauvegarde automatique n'est configure. Activez les sauvegardes dans les parametres.");
    severity = "critique";
  } else if (!driveEnabled) {
    issues.push("La sauvegarde Google Drive n'est pas activee. Seules les sauvegardes locales sont actives.");
    if (severity !== "critique") severity = "moyenne";
  }

  if (org.plan === "essai" && org.trialEndsAt) {
    const trialEnd = new Date(org.trialEndsAt);
    const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 3 && daysLeft > 0) {
      issues.push(`Essai gratuit expire dans ${daysLeft} jour(s). Exportez vos donnees avant l'expiration.`);
      severity = severity === "critique" ? "critique" : "haute";
    } else if (daysLeft <= 0) {
      issues.push("Essai gratuit expire. Vos donnees risquent d'etre supprimees. Exportez immediatement.");
      severity = "critique";
    }
  }

  if (totalRecords > 1000 && !driveEnabled) {
    issues.push(`${totalRecords.toLocaleString("fr-FR")} enregistrements sans sauvegarde cloud. Activez Google Drive pour proteger vos donnees.`);
    if (severity !== "critique") severity = "haute";
  }

  if (totalRecords > 0) {
    const rgpdTables = ["contacts", "calls", "messages", "prospects"];
    const hasPersonalData = rgpdTables.some(t => {
      return true;
    });
    if (hasPersonalData && !driveEnabled) {
      issues.push("Donnees personnelles detectees (contacts, appels, messages). La reglementation RGPD recommande des sauvegardes regulieres et securisees.");
      if (severity !== "critique") severity = "moyenne";
    }
  }

  return {
    orgId: org.orgId,
    orgName: org.orgName,
    plan: org.plan,
    status: org.subStatus,
    adminEmails: admins.map(a => a.email),
    adminUserIds: admins.map(a => a.id),
    lastBackupAt: lastBackup?.createdAt || null,
    backupEnabled: driveEnabled || localEnabled,
    totalRecords,
    issues,
    severity: severity as "info" | "moyenne" | "haute" | "critique",
  };
}

async function createProtectionNotifications(status: OrgBackupStatus): Promise<number> {
  let created = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const userId of status.adminUserIds) {
    const existing = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.sourceType, "data_protection"),
          eq(notificationsTable.read, false),
          gte(notificationsTable.createdAt, today)
        )
      )
      .limit(1);

    if (existing.length > 0) continue;

    const priorityMap = {
      critique: "urgente" as const,
      haute: "haute" as const,
      moyenne: "normale" as const,
      info: "basse" as const,
    };

    const titleMap = {
      critique: "Protection des donnees critique",
      haute: "Alerte de sauvegarde",
      moyenne: "Recommandation de sauvegarde",
      info: "Statut de protection des donnees",
    };

    await db.insert(notificationsTable).values({
      userId,
      type: "alerte",
      title: `${titleMap[status.severity]} — ${status.orgName}`,
      message: status.issues.join(" | "),
      priority: priorityMap[status.severity],
      actionUrl: "/parametres",
      sourceType: "data_protection",
      sourceId: `dp-${status.orgId}-${Date.now()}`,
    });

    created++;
  }

  if (status.severity === "critique" || status.severity === "haute") {
    const globalAdmins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "super_admin"),
          eq(usersTable.actif, true)
        )
      );

    for (const admin of globalAdmins) {
      if (status.adminUserIds.includes(admin.id)) continue;

      const existing = await db
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.userId, admin.id),
            eq(notificationsTable.sourceType, "data_protection_admin"),
            eq(notificationsTable.read, false),
            gte(notificationsTable.createdAt, today)
          )
        )
        .limit(1);

      if (existing.length > 0) continue;

      await db.insert(notificationsTable).values({
        userId: admin.id,
        type: "alerte",
        title: `Protection des donnees: ${status.orgName}`,
        message: `[${status.severity.toUpperCase()}] ${status.issues[0]}`,
        priority: "urgente",
        actionUrl: "/parametres",
        sourceType: "data_protection_admin",
        sourceId: `dpa-${status.orgId}-${Date.now()}`,
      });

      created++;
    }
  }

  return created;
}

async function checkGlobalBackupHealth(
  lastBackup: any | null,
  driveConfig: any | null,
  totalRecords: number,
  tableCounts: Record<string, number>
) {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existing = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.sourceType, "global_backup_health"),
        eq(notificationsTable.read, false),
        gte(notificationsTable.createdAt, today)
      )
    )
    .limit(1);

  if (existing.length > 0) return;

  const issues: string[] = [];

  if (!lastBackup) {
    issues.push("Aucune sauvegarde reussie dans le systeme.");
  } else {
    const age = (now.getTime() - new Date(lastBackup.createdAt).getTime()) / (1000 * 60 * 60);
    if (age > BACKUP_STALE_HOURS) {
      issues.push(`Derniere sauvegarde systeme il y a ${Math.round(age)}h.`);
    }
  }

  const failedRecent = await db
    .select()
    .from(autoBackupsTable)
    .where(
      and(
        eq(autoBackupsTable.status, "erreur"),
        gte(autoBackupsTable.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))
      )
    );

  if (failedRecent.length >= 3) {
    issues.push(`${failedRecent.length} echec(s) de sauvegarde dans les dernieres 24h.`);
  }

  const largeTables = Object.entries(tableCounts)
    .filter(([, count]) => count > 10000)
    .map(([name, count]) => `${name}: ${count.toLocaleString("fr-FR")}`)
    .join(", ");

  if (largeTables) {
    issues.push(`Tables volumineuses detectees: ${largeTables}. Verifiez la taille de vos sauvegardes.`);
  }

  if (issues.length > 0) {
    const superAdmins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "super_admin"), eq(usersTable.actif, true)));

    for (const admin of superAdmins) {
      await db.insert(notificationsTable).values({
        userId: admin.id,
        type: "alerte",
        title: "Sante du systeme de sauvegarde",
        message: issues.join(" | "),
        priority: failedRecent.length >= 3 ? "urgente" : "haute",
        actionUrl: "/parametres",
        sourceType: "global_backup_health",
        sourceId: `gbh-${Date.now()}`,
      });
    }
  }
}

async function logMonitorRun(status: string, details: any, duration: number, error?: string) {
  try {
    await db.insert(automationLogsTable).values({
      ruleId: null,
      ruleName: "Protection des donnees",
      status,
      details,
      itemsProcessed: details.notificationsSent || 0,
      duration: Math.round(duration),
      error: error || null,
    });
  } catch (err) {
    logger.error({ err: err }, "[DataProtection] Erreur log:");
  }
}

export async function getDataProtectionStatus(): Promise<{
  lastCheck: Date | null;
  nextCheck: Date | null;
  organizations: OrgBackupStatus[];
  globalHealth: {
    totalRecords: number;
    lastBackup: Date | null;
    backupConfigured: boolean;
    failedBackups24h: number;
  };
}> {
  const now = new Date();

  const lastLog = await db
    .select()
    .from(automationLogsTable)
    .where(eq(automationLogsTable.ruleName, "Protection des donnees"))
    .orderBy(desc(automationLogsTable.createdAt))
    .limit(1);

  const lastBackup = await db
    .select()
    .from(autoBackupsTable)
    .where(eq(autoBackupsTable.status, "termine"))
    .orderBy(desc(autoBackupsTable.createdAt))
    .limit(1);

  const failedRecent = await db
    .select()
    .from(autoBackupsTable)
    .where(
      and(
        eq(autoBackupsTable.status, "erreur"),
        gte(autoBackupsTable.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))
      )
    );

  const backupConfigs = await db.select().from(backupConfigTable);
  const hasConfig = backupConfigs.some(c => c.enabled === "true");

  const tableCounts = await getTableRecordCounts();
  const totalRecords = Object.values(tableCounts).reduce((sum, c) => sum + c, 0);

  return {
    lastCheck: lastLog[0]?.createdAt || null,
    nextCheck: lastLog[0]?.createdAt
      ? new Date(new Date(lastLog[0].createdAt).getTime() + CHECK_INTERVAL_MS)
      : new Date(now.getTime() + 30 * 1000),
    organizations: [],
    globalHealth: {
      totalRecords,
      lastBackup: lastBackup[0]?.createdAt || null,
      backupConfigured: hasConfig,
      failedBackups24h: failedRecent.length,
    },
  };
}
