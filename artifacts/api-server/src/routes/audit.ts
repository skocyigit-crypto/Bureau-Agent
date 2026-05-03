import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";
import { desc, eq, gte, lte, and, sql, ilike } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

function requireAdmin(req: Request, res: Response): boolean {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return false; }
  const role = (req.session as any)?.userRole;
  if (role !== "super_admin" && role !== "administrateur") {
    res.status(403).json({ error: "Acces refuse." });
    return false;
  }
  return true;
}

function safeInt(val: any, defaultVal: number, min: number, max: number): number {
  const n = parseInt(val);
  if (isNaN(n) || n < min) return defaultVal;
  return Math.min(n, max);
}

router.get("/audit/logs", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const page = safeInt(req.query.page, 1, 1, 10000);
  const limit = safeInt(req.query.limit, 50, 1, 200);
  const offset = (page - 1) * limit;
  const { action, resource, userId, from, to, userEmail } = req.query;

  let conditions: any[] = [];
  if (action && typeof action === "string") conditions.push(eq(auditLogsTable.action, action));
  if (resource && typeof resource === "string") conditions.push(eq(auditLogsTable.resource, resource));
  if (userId) {
    const uid = safeInt(userId, 0, 1, 999999);
    if (uid > 0) conditions.push(eq(auditLogsTable.userId, uid));
  }
  if (userEmail && typeof userEmail === "string" && userEmail.trim()) {
    conditions.push(ilike(auditLogsTable.userEmail, `%${userEmail.trim()}%`));
  }
  if (from && typeof from === "string") {
    const d = new Date(from);
    if (!isNaN(d.getTime())) conditions.push(gte(auditLogsTable.createdAt, d));
  }
  if (to && typeof to === "string") {
    const d = new Date(to);
    if (!isNaN(d.getTime())) conditions.push(lte(auditLogsTable.createdAt, d));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const logs = await db
    .select()
    .from(auditLogsTable)
    .where(whereClause)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(whereClause);

  res.json({ logs, total: count, page, totalPages: Math.ceil(count / limit) });
});

router.get("/audit/stats", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const [todayStats] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, today));

    const actionBreakdown = await db
      .select({
        action: auditLogsTable.action,
        count: sql<number>`count(*)::int`,
      })
      .from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, today))
      .groupBy(auditLogsTable.action)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const activeUsers = await db
      .select({
        userEmail: auditLogsTable.userEmail,
        count: sql<number>`count(*)::int`,
      })
      .from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, today))
      .groupBy(auditLogsTable.userEmail)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    res.json({
      todayTotal: todayStats?.count || 0,
      actionBreakdown,
      activeUsers,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur statistiques audit");
    res.status(500).json({ error: "Erreur lors de la recuperation des statistiques d'audit." });
  }
});

router.get("/audit/export/csv", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const { action, resource, from, to, userEmail } = req.query;
    const conditions: any[] = [];
    if (action && typeof action === "string") conditions.push(eq(auditLogsTable.action, action));
    if (resource && typeof resource === "string") conditions.push(eq(auditLogsTable.resource, resource));
    if (userEmail && typeof userEmail === "string" && userEmail.trim()) {
      conditions.push(ilike(auditLogsTable.userEmail, `%${userEmail.trim()}%`));
    }
    if (from && typeof from === "string") {
      const d = new Date(from);
      if (!isNaN(d.getTime())) conditions.push(gte(auditLogsTable.createdAt, d));
    }
    if (to && typeof to === "string") {
      const d = new Date(to);
      if (!isNaN(d.getTime())) conditions.push(lte(auditLogsTable.createdAt, d));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db.select().from(auditLogsTable)
      .where(whereClause)
      .orderBy(desc(auditLogsTable.createdAt)).limit(10000);
    const escape = (v: any) => { if (v == null) return ""; const s = String(v).replace(/"/g, '""'); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s; };
    const headers = ["Date", "Utilisateur", "Action", "Ressource", "ID Ressource", "IP"];
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.createdAt ? new Date(r.createdAt).toLocaleString("fr-FR") : ""),
      escape(r.userEmail), escape(r.action), escape(r.resource),
      escape(r.resourceId), escape(r.ipAddress),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export audit CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

export default router;

export async function logAudit(
  userId: number | undefined,
  userEmail: string | undefined,
  action: string,
  resource: string,
  resourceId?: string,
  details?: any,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    await db.insert(auditLogsTable).values({
      userId: userId || null,
      userEmail: userEmail || null,
      action,
      resource,
      resourceId: resourceId || null,
      details: details || null,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    });
  } catch (err: any) {
    logger.error({ err: err.message, action, resource, resourceId }, "[AuditLog] Failed to write audit log");
  }
}
