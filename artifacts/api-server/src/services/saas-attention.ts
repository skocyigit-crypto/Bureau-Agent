/**
 * Agregateur d'attention SaaS — la vue "ce qui demande une action" pour le
 * super-admin, sur TOUTES les organisations a la fois.
 *
 * Jusqu'ici, les signaux de gestion SaaS (essais qui expirent, paiements en
 * echec, quotas depasses, factures d'abonnement en retard...) etaient soit
 * calcules org par org dans des crons qui n'envoyaient qu'un e-mail, soit pas
 * calcules du tout. Aucune vue unique ne disait au proprietaire de la
 * plateforme "voici les 12 organisations qui demandent une decision".
 *
 * Ce service produit cette liste, priorisee, en quelques requetes agregees
 * (un GROUP BY par metrique plutot qu'une requete par organisation), sans rien
 * modifier. C'est la couche de SIGNAL: l'agent autonome super-admin (phase 2)
 * s'en servira pour proposer des actions dans la file d'approbation.
 */
import { db } from "@workspace/db";
import {
  organisationsTable,
  subscriptionsTable,
  invoicesTable,
  usersTable,
  contactsTable,
  callsTable,
} from "@workspace/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export type AttentionCategory =
  | "trial_expiring"
  | "trial_expired"
  | "payment_failed"
  | "subscription_past_due"
  | "quota_breach"
  | "overdue_saas_invoice"
  | "suspended";

export type AttentionSeverity = "critique" | "haute" | "moyenne" | "basse";

export interface AttentionItem {
  category: AttentionCategory;
  severity: AttentionSeverity;
  organisationId: number;
  organisationName: string;
  /** Phrase courte lisible: l'etat constate. */
  detail: string;
  /** Action suggeree (informatif en phase 1; l'agent la traduira en proposition en phase 2). */
  suggestedAction: string;
  /** Donnees brutes pour l'UI / l'agent. */
  metric: Record<string, unknown>;
}

export interface SaasAttentionSummary {
  generatedAt: string;
  total: number;
  byCategory: Record<AttentionCategory, number>;
  bySeverity: Record<AttentionSeverity, number>;
  items: AttentionItem[];
}

// Seuils. Regroupes ici pour que l'agent (phase 2) et cette vue partagent
// EXACTEMENT les memes bornes — pas de derive entre "ce qui est affiche" et
// "ce sur quoi une action est proposee".
export const ATTENTION_THRESHOLDS = {
  trialExpiringDays: 3, // essai qui se termine dans <= N jours
  quotaWarnRatio: 0.8, // >= 80% d'un quota
  invoiceGraceDays: 7, // facture d'abonnement en_attente consideree en retard apres N jours
  paymentFailedSuspendAt: 3, // au-dela, l'abonnement est deja suspendu ailleurs (stripe-sync)
} as const;

const PAID_PLANS = new Set(["starter", "professionnel", "entreprise"]);

/** Vue minimale d'une organisation + son abonnement, pour la classification. */
export interface OrgClassificationInput {
  org: { id: number; name: string; actif: boolean };
  sub: {
    plan: string;
    status: string;
    trialEndsAt: Date | string | null;
    paymentFailedCount: number | null;
    suspendedAt: Date | string | null;
    suspensionReason: string | null;
    maxUsers: number | null;
    maxContacts: number | null;
    maxCallsPerMonth: number | null;
  } | null;
  usage: { utilisateurs: number; contacts: number; appels: number };
  overdueInvoices: { count: number; total: number } | null;
}

/**
 * Classe UNE organisation en zero, une ou plusieurs situations d'attention.
 *
 * Fonction PURE (aucune I/O): toute la logique de seuils, categories et
 * severites vit ici, ce qui la rend testable directement et garantit que la
 * vue affichee et les propositions de l'agent (phase 2) appliquent les memes
 * regles. `now` est injecte pour des tests deterministes.
 */
export function classifyOrganisation(input: OrgClassificationInput, now: Date): AttentionItem[] {
  const { org, sub, usage, overdueInvoices } = input;
  const items: AttentionItem[] = [];
  const base = { organisationId: org.id, organisationName: org.name };

  // Organisation suspendue (drapeau actif OU statut d'abonnement): demande une
  // decision (reactiver ou cloturer). Terminal: on ne cumule pas d'autres
  // signaux sur un compte deja suspendu.
  if (!org.actif || sub?.status === "suspended") {
    return [{
      ...base,
      category: "suspended",
      severity: "haute",
      detail: sub?.suspensionReason ? `Suspendu (${sub.suspensionReason})` : "Organisation suspendue",
      suggestedAction: "Réactiver l'abonnement ou clôturer le compte.",
      metric: {
        plan: sub?.plan ?? "inconnu",
        suspendedAt: sub?.suspendedAt ?? null,
        paymentFailedCount: sub?.paymentFailedCount ?? 0,
      },
    }];
  }

  if (!sub) return items;

  // Essai: expiration proche ou deja passee.
  if (sub.plan === "essai" && sub.trialEndsAt) {
    const endsAt = new Date(sub.trialEndsAt);
    const daysLeft = Math.ceil((endsAt.getTime() - now.getTime()) / 86400000);
    if (endsAt <= now) {
      items.push({
        ...base,
        category: "trial_expired",
        severity: "critique",
        detail: `Période d'essai expirée depuis ${Math.abs(daysLeft)} jour(s), compte encore actif.`,
        suggestedAction: "Convertir en offre payante, prolonger l'essai, ou suspendre.",
        metric: { trialEndsAt: sub.trialEndsAt, daysLeft },
      });
    } else if (daysLeft <= ATTENTION_THRESHOLDS.trialExpiringDays) {
      items.push({
        ...base,
        category: "trial_expiring",
        severity: daysLeft <= 1 ? "haute" : "moyenne",
        detail: `Période d'essai se termine dans ${daysLeft} jour(s).`,
        suggestedAction: "Contacter pour conversion, ou prolonger l'essai.",
        metric: { trialEndsAt: sub.trialEndsAt, daysLeft },
      });
    }
  }

  // Abonnement en impaye / echec de paiement (avant suspension automatique).
  if (sub.status === "past_due") {
    items.push({
      ...base,
      category: "subscription_past_due",
      severity: "haute",
      detail: "Abonnement en impayé (past_due).",
      suggestedAction: "Envoyer une relance de paiement, ou suspendre après relance.",
      metric: { paymentFailedCount: sub.paymentFailedCount ?? 0 },
    });
  } else if ((sub.paymentFailedCount ?? 0) > 0) {
    const n = sub.paymentFailedCount ?? 0;
    items.push({
      ...base,
      category: "payment_failed",
      severity: n >= 2 ? "haute" : "moyenne",
      detail: `${n} échec(s) de paiement (suspension automatique à ${ATTENTION_THRESHOLDS.paymentFailedSuspendAt}).`,
      suggestedAction: "Envoyer une relance de paiement.",
      metric: { paymentFailedCount: n },
    });
  }

  // Facture d'abonnement SaaS en retard.
  if (overdueInvoices && overdueInvoices.count > 0) {
    items.push({
      ...base,
      category: "overdue_saas_invoice",
      severity: "haute",
      detail: `${overdueInvoices.count} facture(s) d'abonnement en retard (${overdueInvoices.total.toFixed(2)} EUR).`,
      suggestedAction: "Envoyer une relance de facture d'abonnement.",
      metric: { count: overdueInvoices.count, totalDue: overdueInvoices.total },
    });
  }

  // Dépassement de quota (>= 80%) — uniquement pour les plans payants (un essai
  // qui sature est un signal de conversion, traité via trial_*).
  if (PAID_PLANS.has(sub.plan)) {
    const u = {
      utilisateurs: { used: usage.utilisateurs, max: sub.maxUsers ?? 0 },
      contacts: { used: usage.contacts, max: sub.maxContacts ?? 0 },
      appels: { used: usage.appels, max: sub.maxCallsPerMonth ?? 0 },
    };
    const breached = Object.entries(u)
      .filter(([, v]) => v.max > 0 && v.used / v.max >= ATTENTION_THRESHOLDS.quotaWarnRatio)
      .map(([k, v]) => `${k}: ${v.used}/${v.max} (${Math.round((v.used / v.max) * 100)}%)`);
    if (breached.length > 0) {
      const over = Object.values(u).some((v) => v.max > 0 && v.used > v.max);
      items.push({
        ...base,
        category: "quota_breach",
        severity: over ? "haute" : "moyenne",
        detail: `Quota ${over ? "dépassé" : "proche de la limite"}: ${breached.join(", ")}.`,
        suggestedAction: "Proposer une montée de gamme (plan supérieur).",
        metric: { usage: u },
      });
    }
  }

  return items;
}

/** Compte agrege par organisation, en une seule requete. */
async function countByOrg(
  table: typeof usersTable | typeof contactsTable | typeof callsTable,
  extra?: ReturnType<typeof and>,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      orgId: (table as typeof usersTable).organisationId,
      c: sql<number>`count(*)::int`,
    })
    .from(table as typeof usersTable)
    .where(extra as never)
    .groupBy((table as typeof usersTable).organisationId);
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.orgId as number, Number(r.c));
  return map;
}

export async function gatherSaasAttention(): Promise<SaasAttentionSummary> {
  const now = new Date();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [orgs, subs, usersByOrg, contactsByOrg, callsByOrg, overdueInvoiceRows] =
    await Promise.all([
      db
        .select({
          id: organisationsTable.id,
          name: organisationsTable.name,
          actif: organisationsTable.actif,
        })
        .from(organisationsTable),
      db.select().from(subscriptionsTable),
      countByOrg(usersTable, and(eq(usersTable.actif, true))),
      countByOrg(contactsTable),
      countByOrg(callsTable, and(gte(callsTable.createdAt, monthStart))),
      // Factures d'abonnement SaaS en retard: soit deja marquees `retard`,
      // soit `en_attente` dont la periode est close depuis plus que le delai
      // de grace.
      db
        .select({
          orgId: invoicesTable.organisationId,
          count: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${invoicesTable.totalAmount}), 0)::text`,
        })
        .from(invoicesTable)
        .where(
          sql`${invoicesTable.status} = 'retard'
            OR (${invoicesTable.status} = 'en_attente'
                AND ${invoicesTable.periodEnd} < ${new Date(now.getTime() - ATTENTION_THRESHOLDS.invoiceGraceDays * 86400000)})`,
        )
        .groupBy(invoicesTable.organisationId),
    ]);

  const subByOrg = new Map(subs.map((s) => [s.organisationId, s]));
  const overdueByOrg = new Map(overdueInvoiceRows.map((r) => [r.orgId, r]));

  const items: AttentionItem[] = orgs.flatMap((org) =>
    classifyOrganisation(
      {
        org,
        sub: subByOrg.get(org.id) ?? null,
        usage: {
          utilisateurs: usersByOrg.get(org.id) ?? 0,
          contacts: contactsByOrg.get(org.id) ?? 0,
          appels: callsByOrg.get(org.id) ?? 0,
        },
        overdueInvoices: overdueByOrg.get(org.id)
          ? { count: overdueByOrg.get(org.id)!.count, total: Number(overdueByOrg.get(org.id)!.total) }
          : null,
      },
      now,
    ),
  );

  const severityRank: Record<AttentionSeverity, number> = {
    critique: 0,
    haute: 1,
    moyenne: 2,
    basse: 3,
  };
  items.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  const byCategory = {
    trial_expiring: 0,
    trial_expired: 0,
    payment_failed: 0,
    subscription_past_due: 0,
    quota_breach: 0,
    overdue_saas_invoice: 0,
    suspended: 0,
  } as Record<AttentionCategory, number>;
  const bySeverity = { critique: 0, haute: 0, moyenne: 0, basse: 0 } as Record<AttentionSeverity, number>;
  for (const it of items) {
    byCategory[it.category]++;
    bySeverity[it.severity]++;
  }

  return {
    generatedAt: now.toISOString(),
    total: items.length,
    byCategory,
    bySeverity,
    items,
  };
}

/** Variante fail-soft pour les appelants qui ne doivent jamais planter (crons). */
export async function gatherSaasAttentionSafe(): Promise<SaasAttentionSummary | null> {
  try {
    return await gatherSaasAttention();
  } catch (err) {
    logger.error({ err }, "[SaasAttention] Echec de l'agregation");
    return null;
  }
}
