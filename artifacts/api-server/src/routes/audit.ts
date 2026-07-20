import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";
import { desc, eq, gte, lte, and, sql, lt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { withDbRetry } from "../lib/db-retry";

const router = Router();

const AUDIT_EXPORT_BATCH = 1000;

function requireAdmin(req: Request, res: Response): boolean {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return false; }
  const role = req.session?.userRole;
  if (role !== "super_admin" && role !== "administrateur") {
    res.status(403).json({ error: "Acces refuse." });
    return false;
  }
  return true;
}

// Tenant scoping: super_admin voit tout (avec un ?organisationId= optionnel
// pour filtrer sur une organisation precise depuis la vue globale — meme
// convention que devis.ts/factures-client.ts); administrateur ne voit que
// son organisation, sans pouvoir passer outre via le query param.
function tenantCondition(req: Request) {
  const role = req.session?.userRole;
  const orgId = req.session?.organisationId;
  if (role === "super_admin") {
    const filterOrgId = safeInt(req.query.organisationId, 0, 1, Number.MAX_SAFE_INTEGER);
    return filterOrgId > 0 ? eq(auditLogsTable.organisationId, filterOrgId) : undefined;
  }
  if (!orgId) return eq(auditLogsTable.organisationId, -1); // verrou par defaut
  return eq(auditLogsTable.organisationId, orgId);
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
  const tenant = tenantCondition(req);
  if (tenant) conditions.push(tenant);
  if (action && typeof action === "string") conditions.push(eq(auditLogsTable.action, action));
  if (resource && typeof resource === "string") conditions.push(eq(auditLogsTable.resource, resource));
  if (userId) {
    const uid = safeInt(userId, 0, 1, 999999);
    if (uid > 0) conditions.push(eq(auditLogsTable.userId, uid));
  }
  if (userEmail && typeof userEmail === "string" && userEmail.trim()) {
    const useUnaccent = await ensureUnaccentExtension();
    conditions.push(accentInsensitiveIlike(auditLogsTable.userEmail, `%${userEmail.trim()}%`, useUnaccent));
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
    const tenant = tenantCondition(req);
    const baseWhere = tenant ? and(gte(auditLogsTable.createdAt, today), tenant) : gte(auditLogsTable.createdAt, today);

    const [todayStats] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogsTable)
      .where(baseWhere);

    const actionBreakdown = await db
      .select({
        action: auditLogsTable.action,
        count: sql<number>`count(*)::int`,
      })
      .from(auditLogsTable)
      .where(baseWhere)
      .groupBy(auditLogsTable.action)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const activeUsers = await db
      .select({
        userEmail: auditLogsTable.userEmail,
        count: sql<number>`count(*)::int`,
      })
      .from(auditLogsTable)
      .where(baseWhere)
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
    const tenant = tenantCondition(req);
    if (tenant) conditions.push(tenant);
    if (action && typeof action === "string") conditions.push(eq(auditLogsTable.action, action));
    if (resource && typeof resource === "string") conditions.push(eq(auditLogsTable.resource, resource));
    if (userEmail && typeof userEmail === "string" && userEmail.trim()) {
      const useUnaccent = await ensureUnaccentExtension();
      conditions.push(accentInsensitiveIlike(auditLogsTable.userEmail, `%${userEmail.trim()}%`, useUnaccent));
    }
    if (from && typeof from === "string") {
      const d = new Date(from);
      if (!isNaN(d.getTime())) conditions.push(gte(auditLogsTable.createdAt, d));
    }
    if (to && typeof to === "string") {
      const d = new Date(to);
      if (!isNaN(d.getTime())) conditions.push(lte(auditLogsTable.createdAt, d));
    }
    const baseClause = conditions.length > 0 ? and(...conditions) : undefined;
    const escape = (v: any) => { if (v == null) return ""; const s = String(v).replace(/"/g, '""'); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s; };
    const headers = ["Date", "Utilisateur", "Action", "Ressource", "ID Ressource", "IP"];
    // Export en STREAMING par lots (pagination keyset sur l'id decroissant) au
    // lieu d'un plafond de 10000 lignes charge d'un coup: pas de troncature
    // silencieuse, memoire bornee. 500 propre uniquement si la 1re requete echoue
    // avant tout envoi.
    let lastId = Number.MAX_SAFE_INTEGER;
    let wroteHeader = false;
    for (;;) {
      const rows = await withDbRetry(
        () =>
          db.select().from(auditLogsTable)
            .where(baseClause ? and(baseClause, lt(auditLogsTable.id, lastId)) : lt(auditLogsTable.id, lastId))
            .orderBy(desc(auditLogsTable.id))
            .limit(AUDIT_EXPORT_BATCH),
        { label: "audit.export.batch" },
      );
      if (!wroteHeader) {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="audit_${Date.now()}.csv"`);
        res.write("\uFEFF" + headers.join(",") + "\n");
        wroteHeader = true;
      }
      if (rows.length === 0) break;
      const chunk = rows.map((r) => [
        escape(r.createdAt ? new Date(r.createdAt).toLocaleString("fr-FR") : ""),
        escape(r.userEmail), escape(r.action), escape(r.resource),
        escape(r.resourceId), escape(r.ipAddress),
      ].join(",")).join("\n");
      res.write(chunk + "\n");
      lastId = rows[rows.length - 1].id;
      if (rows.length < AUDIT_EXPORT_BATCH) break;
    }
    res.end();
  } catch (err: any) {
    req.log.error({ err }, "Erreur export audit CSV");
    if (!res.headersSent) {
      res.status(500).json({ error: "Erreur lors de l'export." });
    } else {
      res.end();
    }
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
  userAgent?: string,
  organisationId?: number | null,
) {
  try {
    // L'appelant doit fournir organisationId quand il l'a (req.session.organisationId).
    // Pas de lookup DB ici: logAudit est sur les chemins chauds.
    await db.insert(auditLogsTable).values({
      organisationId: organisationId ?? null,
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
