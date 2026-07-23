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
  const orgId = req.session?.organisationId as number | undefined;
  const userRole = req.session?.userRole as string | undefined;

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

/**
 * Cache de l'etat de licence par organisation.
 *
 * Sans lui, CHAQUE requete d'un utilisateur non super-admin declenchait deux
 * allers-retours en base (organisation + abonnement) avant meme d'atteindre son
 * handler. Au demarrage, l'application emet une quinzaine de requetes en
 * parallele: cela faisait 45 acquisitions de connexion pour un pool bien plus
 * petit. Le pool saturait, les requetes expiraient au bout de 10 s, React Query
 * les rejouait — l'application restait bloquee plusieurs minutes.
 *
 * Le super-admin n'etait pas touche puisqu'il court-circuite ce controle: d'ou
 * un bug qui ne se voyait que chez les utilisateurs des organisations clientes.
 *
 * TTL court (30 s): une suspension d'abonnement prend effet en moins d'une
 * minute, ce qui est largement suffisant pour un controle d'acces commercial,
 * et `invalidateLicenseCache` permet de le rendre immediat.
 */
const LICENSE_TTL_MS = 30_000;
type LicenseState = { org: typeof organisationsTable.$inferSelect | null; sub: typeof subscriptionsTable.$inferSelect | null };
const licenseCache = new Map<number, { state: LicenseState; at: number }>();

/** A appeler quand un abonnement ou une organisation change (suspension, reactivation). */
export function invalidateLicenseCache(orgId?: number): void {
  if (orgId === undefined) licenseCache.clear();
  else licenseCache.delete(orgId);
}

async function loadLicenseState(orgId: number): Promise<LicenseState> {
  const hit = licenseCache.get(orgId);
  if (hit && Date.now() - hit.at < LICENSE_TTL_MS) return hit.state;

  const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId));
  const state: LicenseState = { org: org ?? null, sub: sub ?? null };

  // Borne de securite: en multi-tenant, un cache non borne grossit avec le
  // nombre d'organisations vues par l'instance.
  if (licenseCache.size > 500) licenseCache.clear();
  licenseCache.set(orgId, { state, at: Date.now() });
  return state;
}

export async function checkLicense(orgId: number, method: string, path: string): Promise<{ allowed: boolean; reason?: string; message?: string }> {
  const { org, sub } = await loadLicenseState(orgId);
  if (!org || !org.actif) {
    return { allowed: false, reason: "org_inactive", message: "Votre organisation est inactive. Contactez l'administrateur." };
  }

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
