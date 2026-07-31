import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logTenantViolation } from "./tenant-guard";
import { TenantIdentityCache, type TenantIdentity } from "./tenant-identity-cache";

const tenantIdentityCache = new TenantIdentityCache();

export function invalidateTenantIdentityCache(userId: number): void {
  tenantIdentityCache.invalidate(userId);
}

/**
 * Rebind the request to the user's recently verified tenant.
 * Session and bearer claims are authentication hints, not an authorization
 * source: an administrator may move or deactivate a user while an old session
 * is still alive. Trusting that stale organisationId would keep access to the
 * former customer's data. The bounded 5-second cache collapses parallel
 * dashboard requests; user mutations explicitly invalidate it immediately.
 */
export async function requireTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(403).json({ error: "Aucune organisation associee a ce compte." });
    return;
  }

  try {
    const user = await tenantIdentityCache.get(userId, async (): Promise<TenantIdentity | null> => {
      const [current] = await db
        .select({
          organisationId: usersTable.organisationId,
          role: usersTable.role,
          actif: usersTable.actif,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      return current ?? null;
    });

    if (!user?.actif || !user.organisationId) {
      if (req.session?.organisationId) {
        logTenantViolation(req, "stale_tenant_session", "Session tenant no longer matches an active user organisation");
      }
      res.status(403).json({ error: "Aucune organisation active associee a ce compte." });
      return;
    }

    if (req.session.organisationId && req.session.organisationId !== user.organisationId) {
      logTenantViolation(req, "tenant_session_rebound", `Stale org ${req.session.organisationId} replaced by ${user.organisationId}`);
    }

    req.session.organisationId = user.organisationId;
    req.session.userRole = user.role;
    next();
  } catch (error) {
    req.log?.error({ err: error, userId }, "Tenant verification failed");
    res.status(500).json({ error: "Erreur lors de la verification de l'organisation." });
  }
}

export function getOrgId(req: Request): number {
  const orgId = req.session?.organisationId;
  if (!orgId) {
    throw new Error("Organisation manquante dans la session. Appelez requireTenant en amont.");
  }
  return orgId;
}
