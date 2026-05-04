/**
 * tenant-guard.ts
 *
 * Comprehensive multi-tenant security enforcement layer.
 *
 * Protections provided:
 *  - Tenant isolation: ensures queries only touch the caller's organisation
 *  - Role escalation prevention: tenant admins cannot create/assign super_admin role
 *  - User quota enforcement: honours organisations.max_users
 *  - Super-admin protection: tenant users cannot read/modify/delete super_admin accounts
 *  - Suspicious action detection: rate-limits and logs security-sensitive operations
 */

import type { Request, Response, NextFunction } from "express";
import { eq, and, count } from "drizzle-orm";
import { db, usersTable, organisationsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { logSecurityEvent } from "../middleware/security";
import { logAudit } from "../routes/audit";

// ── Role hierarchy ─────────────────────────────────────────────────────────────
const ROLE_HIERARCHY: Record<string, number> = {
  super_admin:   100,
  administrateur: 50,
  agent:          20,
  lecture_seule:   5,
};

/** Roles that tenant-level users are allowed to assign */
const TENANT_ASSIGNABLE_ROLES = new Set(["administrateur", "agent", "lecture_seule"]);

/** The platform owner role — only super_admin can create, modify, or view */
const PROTECTED_ROLE = "super_admin";

// ── Helper: read session fields safely ───────────────────────────────────────
export function getSession(req: Request) {
  const s = req.session as any;
  return {
    userId:         s?.userId         as number | undefined,
    userRole:       s?.userRole       as string | undefined,
    organisationId: s?.organisationId as number | undefined,
    userEmail:      s?.userEmail      as string | undefined,
  };
}

export function isSuperAdmin(req: Request): boolean {
  return getSession(req).userRole === PROTECTED_ROLE;
}

export function isAdminOrSuperAdmin(req: Request): boolean {
  const role = getSession(req).userRole ?? "";
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY["administrateur"];
}

// ── Guard: reject unless super_admin ─────────────────────────────────────────
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isSuperAdmin(req)) {
    logTenantViolation(req, "require_super_admin", "Attempt to access super-admin-only route");
    res.status(403).json({ error: "Accès réservé au super-administrateur de la plateforme." });
    return;
  }
  next();
}

// ── Guard: reject attempts to assign/escalate to super_admin ─────────────────
export function assertRoleAllowed(req: Request, res: Response, targetRole: string | undefined): boolean {
  if (!targetRole) return true;
  if (isSuperAdmin(req)) return true; // super_admin can do anything

  if (!TENANT_ASSIGNABLE_ROLES.has(targetRole)) {
    logTenantViolation(req, "role_escalation_attempt",
      `Admin tried to assign protected role: ${targetRole}`);
    res.status(403).json({
      error: `Le rôle '${targetRole}' ne peut pas être attribué par un administrateur de tenant.`,
      code:  "ROLE_ESCALATION_DENIED",
    });
    return false;
  }
  return true;
}

// ── Guard: caller role must outrank target role ───────────────────────────────
export function assertCallerOutranks(req: Request, res: Response, targetRole: string): boolean {
  if (isSuperAdmin(req)) return true;
  const callerRank = ROLE_HIERARCHY[getSession(req).userRole ?? ""] ?? 0;
  const targetRank = ROLE_HIERARCHY[targetRole] ?? 0;
  if (callerRank <= targetRank) {
    logTenantViolation(req, "privilege_escalation_attempt",
      `Caller (rank ${callerRank}) tried to act on user with rank ${targetRank}`);
    res.status(403).json({
      error: "Vous ne pouvez pas modifier un compte avec un rôle supérieur ou égal au vôtre.",
      code:  "INSUFFICIENT_RANK",
    });
    return false;
  }
  return true;
}

// ── Guard: target user must belong to caller's organisation ──────────────────
export async function assertOrgOwnsUser(
  req: Request,
  res: Response,
  targetUserId: number,
): Promise<{ ok: true; user: typeof usersTable.$inferSelect } | { ok: false }> {
  if (isSuperAdmin(req)) {
    // super_admin bypasses org isolation but we still need the user record
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
    if (!user) {
      res.status(404).json({ error: "Utilisateur non trouvé." });
      return { ok: false };
    }
    return { ok: true, user };
  }

  const { organisationId } = getSession(req);
  if (!organisationId) {
    res.status(403).json({ error: "Aucune organisation associée à cette session." });
    return { ok: false };
  }

  const [user] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, targetUserId), eq(usersTable.organisationId, organisationId)));

  if (!user) {
    // Could be a cross-tenant probe — log it
    logTenantViolation(req, "cross_tenant_user_access",
      `Attempt to access user ${targetUserId} outside org ${organisationId}`);
    res.status(404).json({ error: "Utilisateur non trouvé dans votre organisation." });
    return { ok: false };
  }
  return { ok: true, user };
}

// ── Guard: target user must NOT be super_admin (for non-super_admin callers) ──
export function assertTargetNotSuperAdmin(req: Request, res: Response, targetUser: { role: string; email?: string }): boolean {
  if (isSuperAdmin(req)) return true; // super_admin can manage all
  if (targetUser.role === PROTECTED_ROLE) {
    logTenantViolation(req, "super_admin_modification_attempt",
      `Attempt to modify super_admin account: ${targetUser.email ?? "unknown"}`);
    res.status(403).json({
      error: "Vous ne pouvez pas modifier un compte super-administrateur de la plateforme.",
      code:  "PROTECTED_ACCOUNT",
    });
    return false;
  }
  return true;
}

// ── Guard: user quota check ───────────────────────────────────────────────────
export async function assertUserQuotaNotExceeded(
  req: Request,
  res: Response,
  organisationId: number,
): Promise<boolean> {
  if (isSuperAdmin(req)) return true; // platform admin is exempt

  try {
    const [org] = await db.select({ maxUsers: organisationsTable.maxUsers })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, organisationId));

    if (!org) return true; // org not found — let the caller handle

    const [{ total }] = await db.select({ total: count() })
      .from(usersTable)
      .where(and(eq(usersTable.organisationId, organisationId), eq(usersTable.actif, true)));

    if (total >= org.maxUsers) {
      logTenantViolation(req, "user_quota_exceeded",
        `Org ${organisationId} has ${total}/${org.maxUsers} active users`);
      res.status(403).json({
        error: `Quota d'utilisateurs atteint (${total}/${org.maxUsers}). Veuillez contacter le support pour augmenter votre limite.`,
        code:  "USER_QUOTA_EXCEEDED",
        current: total,
        max: org.maxUsers,
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, "tenant-guard: quota check failed");
    return true; // fail open — don't block on DB error
  }
}

// ── Guard: admin cannot delete their own account ─────────────────────────────
export function assertNotSelf(req: Request, res: Response, targetId: number): boolean {
  const { userId } = getSession(req);
  if (userId === targetId) {
    res.status(400).json({ error: "Vous ne pouvez pas supprimer ou désactiver votre propre compte." });
    return false;
  }
  return true;
}

// ── Input sanitisation for user mutations ────────────────────────────────────
const ALLOWED_PATCH_FIELDS = new Set([
  "nom", "prenom", "departement", "telephone", "actif", "role", "password",
]);
/** Strip any unknown or dangerous fields from a user update payload. */
export function sanitiseUserPatch(body: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(body).filter(([k]) => ALLOWED_PATCH_FIELDS.has(k))
  );
}

// ── Suspicious action logging ─────────────────────────────────────────────────
export function logTenantViolation(req: Request, event: string, detail: string): void {
  const { userId, userRole, organisationId, userEmail } = getSession(req);
  const ip = (req as any).ip ?? "unknown";

  logger.warn({
    security: true,
    event,
    userId,
    userRole,
    organisationId,
    ip,
    path: req.originalUrl,
  }, `[TENANT-GUARD] ${event}: ${detail}`);

  logSecurityEvent(event, ip, userId ?? null, detail, "warning");

  if (userId) {
    logAudit(
      userId,
      userEmail ?? "unknown",
      `security:${event}`,
      "tenant_guard",
      undefined,
      { detail, path: req.originalUrl, userRole, organisationId },
      ip,
      req.get("user-agent"),
    );
  }
}

// ── Rate limiting for sensitive operations ────────────────────────────────────
const sensitiveOpLog = new Map<string, number[]>(); // key → timestamps

/**
 * In-memory rate limiter for sensitive operations.
 * Returns true if allowed, false if rate limit exceeded.
 */
export function checkSensitiveRateLimit(
  req: Request,
  res: Response,
  operation: string,
  maxOps: number = 20,
  windowMs: number = 60_000,
): boolean {
  const { userId } = getSession(req);
  const key = `${userId}:${operation}`;
  const now = Date.now();
  const timestamps = (sensitiveOpLog.get(key) ?? []).filter(t => now - t < windowMs);
  timestamps.push(now);
  sensitiveOpLog.set(key, timestamps);

  if (timestamps.length > maxOps) {
    logTenantViolation(req, "sensitive_rate_limit",
      `Operation '${operation}' exceeded ${maxOps} calls in ${windowMs}ms`);
    res.status(429).json({
      error: `Trop d'opérations '${operation}' en peu de temps. Réessayez plus tard.`,
      code:  "RATE_LIMITED",
    });
    return false;
  }
  return true;
}

// Cleanup stale rate-limit entries every 5 min
setInterval(() => {
  const cutoff = Date.now() - 300_000;
  sensitiveOpLog.forEach((timestamps, key) => {
    const recent = timestamps.filter(t => t > cutoff);
    if (recent.length === 0) sensitiveOpLog.delete(key);
    else sensitiveOpLog.set(key, recent);
  });
}, 300_000);
