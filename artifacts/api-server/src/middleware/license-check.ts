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

  if (sub.status === "annulee" || sub.status === "cancelled") {
    return { allowed: false, reason: "cancelled", message: "Votre abonnement a ete annule. Souscrivez un nouveau plan pour continuer." };
  }

  if (sub.status === "suspended") {
    return { allowed: false, reason: "suspended", message: "Votre abonnement est suspendu suite a plusieurs echecs de paiement. Mettez a jour votre moyen de paiement dans le portail Stripe." };
  }

  if (sub.plan === "essai" && sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date()) {
    return { allowed: false, reason: "trial_expired", message: "Votre periode d'essai est terminee. Veuillez passer a un plan payant pour continuer." };
  }

  if (sub.status === "past_due") {
    const isReadOrBilling = method === "GET" || READ_ONLY_PATHS_WHEN_PAST_DUE.some(p => path.startsWith(p));
    if (!isReadOrBilling) {
      return { allowed: false, reason: "past_due", message: "Paiement en retard. Reglez votre derniere facture pour retrouver l'acces complet." };
    }
  }

  return { allowed: true };
}
