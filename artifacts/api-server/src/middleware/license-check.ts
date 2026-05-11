import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, organisationsTable, subscriptionsTable } from "@workspace/db";

const EXEMPT_PATHS = [
  "/api/auth",
  "/api/health",
  "/api/my-subscription",
  "/api/register",
  "/api/stripe",
  "/api/subscription/portal",
  "/api/subscription/checkout",
];

const READ_ONLY_PATHS_WHEN_PAST_DUE = [
  "/api/subscription",
  "/api/billing",
  "/api/license-management",
];

export function licenseCheck(req: Request, res: Response, next: NextFunction): void {
  const orgId = (req.session as any)?.organisationId as number | undefined;
  const userRole = (req.session as any)?.userRole as string | undefined;

  if (!orgId || userRole === "super_admin") {
    next();
    return;
  }

  const path = req.originalUrl || req.url;
  if (EXEMPT_PATHS.some(p => path.startsWith(p))) {
    next();
    return;
  }

  checkLicense(orgId, req.method, path)
    .then(result => {
      if (result.allowed) {
        next();
      } else {
        res.status(403).json({
          error: "Acces bloque",
          reason: result.reason,
          code: result.reason,
          message: result.message,
          redirectTo: "/abonnement",
        });
      }
    })
    .catch(() => {
      res.status(503).json({
        error: "Verification de licence indisponible",
        message: "Impossible de verifier votre licence. Veuillez reessayer dans quelques instants.",
      });
    });
}

async function checkLicense(orgId: number, method: string, path: string): Promise<{ allowed: boolean; reason?: string; message?: string }> {
  const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
  if (!org || !org.actif) {
    return { allowed: false, reason: "org_inactive", message: "Votre organisation est inactive. Contactez l'administrateur." };
  }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId));
  if (!sub) return { allowed: true };

  // Data protection: GET requests + data export endpoints toujours autorises
  // pour les statuts bloques — l'utilisateur conserve l'acces a ses donnees
  // (lecture/export) meme suspendu/annule/expire (RGPD: droit d'acces & portabilite).
  const isReadOnlyAllowed = method === "GET" || path.startsWith("/api/data-export") || path.startsWith("/api/my-subscription");

  if (sub.status === "annulee" || sub.status === "cancelled") {
    if (isReadOnlyAllowed) return { allowed: true };
    return { allowed: false, reason: "cancelled", message: "Votre abonnement a ete annule. Vos donnees restent accessibles en lecture seule. Souscrivez un nouveau plan pour reprendre l'acces complet." };
  }

  if (sub.status === "suspended") {
    if (isReadOnlyAllowed) return { allowed: true };
    return { allowed: false, reason: "suspended", message: "Votre abonnement est suspendu. Acces en lecture seule preserve. Mettez a jour votre paiement pour reprendre l'ecriture." };
  }

  if (sub.plan === "essai" && sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date()) {
    if (isReadOnlyAllowed) return { allowed: true };
    return { allowed: false, reason: "trial_expired", message: "Votre periode d'essai est terminee. Vos donnees restent accessibles en lecture seule. Souscrivez un plan pour reprendre l'ecriture." };
  }

  if (sub.status === "past_due") {
    const isReadOrBilling = method === "GET" || READ_ONLY_PATHS_WHEN_PAST_DUE.some(p => path.startsWith(p));
    if (!isReadOrBilling) {
      return { allowed: false, reason: "past_due", message: "Paiement en retard. Reglez votre derniere facture pour retrouver l'acces complet." };
    }
  }

  return { allowed: true };
}
