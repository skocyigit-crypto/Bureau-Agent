/**
 * Relance d'une organisation qui doit son abonnement A LA PLATEFORME.
 *
 * Mesure du 28/09 : sur les signaux « paiement echoue », « abonnement
 * impaye » et « facture d'abonnement en retard », l'agent SaaS executait
 * `saas_send_invoice_reminder`, qui appelait les relances de l'ORGANISATION
 * vers SES clients (`runAutoRemindersForOrg`). Quand une organisation ne
 * payait pas la plateforme, ce sont ses propres clients qui recevaient une
 * relance pour leurs factures — sans rapport, sans son accord, et en ignorant
 * son reglage d'approbation.
 *
 * La relance va maintenant a qui doit payer : l'adresse de l'organisation et
 * ses administrateurs actifs, pour les factures d'abonnement emises et en
 * retard (meme critere que la vue « a traiter »). Au plus une relance par
 * organisation et par 7 jours, sous verrou (agent SaaS multi-instance,
 * approbation manuelle).
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  db, invoicesTable, licenseAuditLogTable, organisationsTable, subscriptionsTable, usersTable,
} from "@workspace/db";
import { CRON_LOCK_NAMESPACE, tryWithLock } from "../lib/cron-lock";
import { logger } from "../lib/logger";
import { dateHumaine } from "../lib/jour-local";
import { sendEmail, sendInvoiceReminderEmail } from "./email";
import { ATTENTION_THRESHOLDS } from "./saas-attention";

export const ACTION_RELANCE_ABONNEMENT = "platform_payment_reminder";
const ESPACEMENT_JOURS = 7;

export type ResultatRelanceAbonnement =
  | { statut: "envoyee"; destinataires: string[]; factures: string[] }
  | { statut: "deja_relancee" | "rien_a_relancer" | "sans_destinataire" | "en_cours" | "echec"; detail?: string };

/** Adresse de l'organisation + administrateurs actifs, sans doublon. */
export async function destinataires(orgId: number, emailOrg: string | null): Promise<string[]> {
  const admins = await db.select({ email: usersTable.email }).from(usersTable).where(and(
    eq(usersTable.organisationId, orgId), eq(usersTable.role, "administrateur"), eq(usersTable.actif, true),
  ));
  const tous = [emailOrg, ...admins.map((a) => a.email)]
    .map((e) => (e ?? "").trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return [...new Set(tous)];
}

export async function relancerAbonnementPlateforme(orgId: number, maintenant: Date = new Date()): Promise<ResultatRelanceAbonnement> {
  let resultat: ResultatRelanceAbonnement = { statut: "en_cours" };
  const obtenu = await tryWithLock(CRON_LOCK_NAMESPACE.relanceAbonnement, orgId, async () => {
    resultat = await relancerSousVerrou(orgId, maintenant);
  });
  return obtenu ? resultat : { statut: "en_cours" };
}

async function relancerSousVerrou(orgId: number, maintenant: Date): Promise<ResultatRelanceAbonnement> {
  const [org] = await db.select({ name: organisationsTable.name, email: organisationsTable.email })
    .from(organisationsTable).where(eq(organisationsTable.id, orgId));
  if (!org) return { statut: "echec", detail: "Organisation introuvable" };

  const [recente] = await db.select({ id: licenseAuditLogTable.id }).from(licenseAuditLogTable).where(and(
    eq(licenseAuditLogTable.organisationId, orgId),
    eq(licenseAuditLogTable.action, ACTION_RELANCE_ABONNEMENT),
    gte(licenseAuditLogTable.createdAt, new Date(maintenant.getTime() - ESPACEMENT_JOURS * 86400_000)),
  )).limit(1);
  if (recente) return { statut: "deja_relancee" };

  // Meme critere que la vue « a traiter » : une facture non emise n'est
  // jamais en retard (elle n'existe pas juridiquement).
  const limite = new Date(maintenant.getTime() - ATTENTION_THRESHOLDS.invoiceGraceDays * 86400_000);
  const factures = await db.select().from(invoicesTable).where(and(
    eq(invoicesTable.organisationId, orgId),
    sql`${invoicesTable.issuedAt} IS NOT NULL
      AND (${invoicesTable.status} = 'retard'
           OR (${invoicesTable.status} = 'en_attente' AND ${invoicesTable.periodEnd} < ${limite}))`,
  )).orderBy(invoicesTable.periodStart);
  const [abonnement] = await db.select({ status: subscriptionsTable.status, echecs: subscriptionsTable.paymentFailedCount })
    .from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)).orderBy(desc(subscriptionsTable.id)).limit(1);
  const paiementEnEchec = abonnement?.status === "past_due" || (abonnement?.echecs ?? 0) > 0;
  if (factures.length === 0 && !paiementEnEchec) return { statut: "rien_a_relancer" };

  const a = await destinataires(orgId, org.email);
  if (a.length === 0) return { statut: "sans_destinataire" };

  const [precedentes] = await db.select({ n: sql<number>`count(*)::int` }).from(licenseAuditLogTable).where(and(
    eq(licenseAuditLogTable.organisationId, orgId), eq(licenseAuditLogTable.action, ACTION_RELANCE_ABONNEMENT),
  ));
  const numero = (precedentes?.n ?? 0) + 1;

  let envoyes = 0;
  for (const to of a) {
    if (factures.length > 0) {
      for (const f of factures) {
        const r = await sendInvoiceReminderEmail({
          to, clientName: org.name, reference: f.reference ?? `#${f.id}`,
          title: `Abonnement Ajant Bureau — ${f.periodLabel}`,
          amountLabel: `${Number(f.totalTtc || f.totalAmount).toFixed(2)} ${f.currency} TTC`,
          dueDateLabel: dateHumaine(f.periodEnd), isOverdue: true, reminderNumber: numero,
        });
        if (r.success) envoyes++;
      }
    } else {
      const r = await sendEmail(to, `[Ajant Bureau] Paiement de votre abonnement — ${org.name}`,
        `<p>Bonjour,</p><p>Le dernier paiement de l'abonnement Ajant Bureau de <strong>${org.name.replace(/[<>&"]/g, "")}</strong> n'a pas abouti. Merci de verifier votre moyen de paiement depuis votre espace (Abonnement), ou de nous repondre si le reglement a deja ete effectue.</p><p>L'equipe Ajant Bureau — support@agentdebureau.fr</p>`,
        `Bonjour,\n\nLe dernier paiement de l'abonnement Ajant Bureau de ${org.name} n'a pas abouti. Merci de verifier votre moyen de paiement depuis votre espace (Abonnement), ou de nous repondre si le reglement a deja ete effectue.\n\nL'equipe Ajant Bureau — support@agentdebureau.fr`);
      if (r.success) envoyes++;
    }
  }
  if (envoyes === 0) {
    logger.warn({ orgId }, "[RelanceAbonnement] aucun envoi abouti");
    return { statut: "echec", detail: "Aucun envoi n'a abouti." };
  }
  const refs = factures.map((f) => f.reference ?? `#${f.id}`);
  await db.insert(licenseAuditLogTable).values({
    organisationId: orgId, action: ACTION_RELANCE_ABONNEMENT,
    details: factures.length > 0
      ? `Relance n°${numero} des factures d'abonnement ${refs.join(", ")} envoyee a ${a.join(", ")}`
      : `Relance n°${numero} du paiement d'abonnement envoyee a ${a.join(", ")}`,
    metadata: { destinataires: a, factures: refs, numero },
  });
  return { statut: "envoyee", destinataires: a, factures: refs };
}
