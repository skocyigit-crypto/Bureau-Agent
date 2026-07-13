/**
 * Suivi automatique des paiements (Tâche #293) — détecteur de factures clients
 * impayées/en retard branché sur le moteur proactif.
 *
 * Pour chaque organisation, ce service inspecte les factures clients
 * (`factures_client`) restant dues après leur échéance et dépose, pour chacune,
 * une SUGGESTION proactive (`payment_reminder`) accompagnée d'un BROUILLON de
 * relance prêt à envoyer (e-mail ou SMS), pré-rempli avec le montant restant, la
 * référence de la facture et la date d'échéance. Le brouillon est déposé dans la
 * file d'approbation (actionPayload), exactement comme la boîte e-mail autonome
 * (Tâche #290).
 *
 * RÈGLE D'OR : aucun envoi autonome. L'envoi se fait UNIQUEMENT à la demande
 * explicite de l'humain (route /proactive/suggestions/:id/send-reminder), qui
 * peut d'abord éditer le brouillon. C'est le SEUL chemin d'envoi.
 *
 * Ton ESCALADANT selon le retard (courtois → ferme → pressant) et ESPACEMENT
 * (hystérésis) pour ne JAMAIS marteler le même client : on ne re-propose une
 * relance pour une facture que si aucune relance n'a été envoyée ET aucune
 * suggestion n'a été créée pour elle depuis `MIN_INTERVAL_DAYS`.
 *
 * Boucle de feedback : les votes 👍/👎 et l'envoi alimentent l'apprentissage
 * (comme tous les types), MAIS — recouvrement critique — ce type n'est JAMAIS
 * mis en sourdine par la suppression apprise (cf. moteur proactif). On
 * n'applique donc volontairement PAS getSuppressedSuggestionTypes ici.
 *
 * Déterministe (aucun appel IA) : cohérent avec les détecteurs du moteur
 * proactif (coût nul), et le montant/référence/échéance sont des données
 * factuelles qui n'ont pas besoin de génération IA.
 */
import {
  db,
  facturesClientTable,
  compteClientTable,
  proactiveSuggestionsTable,
} from "@workspace/db";
import { and, eq, inArray, lt, gt, ne, notInArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { broadcaster } from "./broadcaster";

/** Type porté par ce service (hors DETECTOR_TYPES du moteur déterministe : son
 * cycle de vie — création, auto-résolution, envoi — est géré ICI). */
export const PAYMENT_REMINDER_SUGGESTION_TYPE = "payment_reminder";

const DAY_MS = 24 * 60 * 60 * 1000;

// Espacement minimal entre deux relances pour une MÊME facture (anti-spam /
// hystérésis). On ne re-propose pas tant qu'on est dans cette fenêtre, qu'une
// relance ait été ENVOYÉE (factures_client.lastReminderAt) ou simplement
// PROPOSÉE puis rejetée (suggestion récente).
const MIN_INTERVAL_DAYS = clampEnv(process.env.PAYMENT_REMINDER_MIN_INTERVAL_DAYS, 7, 1, 90);
// Seuils de bascule de ton (en jours de retard).
const FIRM_AFTER_DAYS = clampEnv(process.env.PAYMENT_REMINDER_FIRM_AFTER_DAYS, 15, 2, 120);
const FINAL_AFTER_DAYS = clampEnv(process.env.PAYMENT_REMINDER_FINAL_AFTER_DAYS, 31, FIRM_AFTER_DAYS + 1, 365);
// Borne le nombre de nouveaux brouillons créés par passage et par org.
const MAX_PER_SCAN = clampEnv(process.env.PAYMENT_REMINDER_MAX_PER_SCAN, 20, 1, 100);

// Statuts de facture NON recouvrables : ni brouillon (pas encore émise), ni
// payée, ni annulée. Tout le reste avec un solde > 0 et échue est relançable.
const NON_COLLECTIBLE_STATUSES = ["brouillon", "payee", "annulee"] as const;

type Stage = "gentle" | "firm" | "final";

export interface PaymentReminderScanResult {
  candidates: number;
  created: number;
  resolved: number;
  skipped: boolean;
  reason?: string;
}

function clampEnv(raw: string | undefined, def: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.round(n), min), max);
}

function stageFor(daysOverdue: number, reminderCount: number): Stage {
  if (daysOverdue >= FINAL_AFTER_DAYS || reminderCount >= 3) return "final";
  if (daysOverdue >= FIRM_AFTER_DAYS || reminderCount >= 1) return "firm";
  return "gentle";
}

function severityFor(stage: Stage): "urgent" | "warning" {
  return stage === "final" ? "urgent" : "warning";
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || "EUR"}`;
  }
}

interface DraftInput {
  stage: Stage;
  channel: "email" | "sms";
  clientName: string;
  reference: string;
  title: string;
  amountLabel: string;
  dueDateLabel: string | null;
  daysOverdue: number;
  reminderNumber: number;
}

interface Draft {
  subject: string;
  bodyPlain: string;
}

// Brouillon déterministe, ton escaladant. Le client édite ce texte avant envoi.
function buildDraft(input: DraftInput): Draft {
  const { stage, channel, clientName, reference, title, amountLabel, dueDateLabel, daysOverdue } = input;
  const greeting = `Bonjour ${clientName},`;
  const factLine = dueDateLabel
    ? `la facture ${reference} (${title}), d'un montant restant dû de ${amountLabel}, était échue le ${dueDateLabel}`
    : `la facture ${reference} (${title}), d'un montant restant dû de ${amountLabel}, demeure impayée`;

  if (channel === "sms") {
    let body: string;
    if (stage === "gentle") {
      body = `Bonjour ${clientName}, sauf erreur, ${factLine}. Merci de procéder au règlement dès que possible. Cordialement, l'équipe.`;
    } else if (stage === "firm") {
      body = `Bonjour ${clientName}, ${factLine} depuis ${daysOverdue} jours. Merci de régulariser rapidement ou de nous contacter. Cordialement.`;
    } else {
      body = `Bonjour ${clientName}, ${factLine} depuis ${daysOverdue} jours et reste impayée malgré nos relances. Merci de régulariser sans délai. Cordialement.`;
    }
    return { subject: "", bodyPlain: body.slice(0, 1500) };
  }

  let subject: string;
  let lines: string[];
  if (stage === "gentle") {
    subject = `Rappel — Facture ${reference}`;
    lines = [
      greeting,
      "",
      `Sauf erreur de notre part, ${factLine}.`,
      "",
      "Si le règlement a déjà été effectué, merci de ne pas tenir compte de ce message. Dans le cas contraire, nous vous serions reconnaissants de bien vouloir procéder au paiement dès que possible.",
      "",
      "Pour toute question, n'hésitez pas à nous répondre directement.",
      "",
      "Avec nos remerciements,",
      "L'équipe",
    ];
  } else if (stage === "firm") {
    subject = `Relance — Facture ${reference} en retard`;
    lines = [
      greeting,
      "",
      `Nous revenons vers vous au sujet de ${factLine}, soit un retard de ${daysOverdue} jours.`,
      "",
      "Nous vous remercions de bien vouloir régulariser cette situation dans les meilleurs délais. Si un point bloque le règlement, contactez-nous afin de trouver une solution ensemble.",
      "",
      "Dans l'attente de votre retour,",
      "L'équipe",
    ];
  } else {
    subject = `Relance urgente — Facture ${reference} impayée`;
    lines = [
      greeting,
      "",
      `Malgré nos précédentes relances, ${factLine} depuis ${daysOverdue} jours et demeure impayée.`,
      "",
      "Nous vous demandons de procéder au règlement sans délai. À défaut, et faute de prise de contact de votre part, nous serons contraints d'envisager les suites nécessaires au recouvrement de cette créance.",
      "",
      "Nous restons à votre disposition pour convenir d'un règlement.",
      "",
      "Cordialement,",
      "L'équipe",
    ];
  }
  return { subject, bodyPlain: lines.join("\n") };
}

/**
 * Scan d'une organisation : auto-résout les suggestions dont la facture est
 * réglée/annulée/plus échue, puis crée de nouveaux brouillons de relance pour
 * les factures échues impayées (espacement + ton escaladant). Idempotent.
 */
export async function runPaymentReminderScanForOrg(orgId: number): Promise<PaymentReminderScanResult> {
  const now = new Date();
  const empty: PaymentReminderScanResult = { candidates: 0, created: 0, resolved: 0, skipped: false };

  // Factures échues et impayées : solde restant > 0, échéance dépassée, statut
  // recouvrable. Aucun échantillonnage -> l'absence d'une facture de cette liste
  // signifie de façon fiable « plus à relancer » (auto-résolution sûre).
  const overdue = await withDbRetry(
    () =>
      db
        .select({
          id: facturesClientTable.id,
          contactId: facturesClientTable.contactId,
          reference: facturesClientTable.reference,
          title: facturesClientTable.title,
          clientName: facturesClientTable.clientName,
          clientEmail: facturesClientTable.clientEmail,
          clientPhone: facturesClientTable.clientPhone,
          totalAmount: facturesClientTable.totalAmount,
          paidAmount: facturesClientTable.paidAmount,
          currency: facturesClientTable.currency,
          status: facturesClientTable.status,
          dueDate: facturesClientTable.dueDate,
          reminderCount: facturesClientTable.reminderCount,
          lastReminderAt: facturesClientTable.lastReminderAt,
        })
        .from(facturesClientTable)
        .where(
          and(
            eq(facturesClientTable.organisationId, orgId),
            notInArray(facturesClientTable.status, NON_COLLECTIBLE_STATUSES as unknown as string[]),
            lt(facturesClientTable.dueDate, now),
            gt(
              sql`(${facturesClientTable.totalAmount} - ${facturesClientTable.paidAmount})`,
              sql`0`,
            ),
          ),
        ),
    { label: "payment-reminder:overdue" },
  );

  // Suggestions payment_reminder pending de l'org (pour dédup + auto-résolution).
  const pending = await withDbRetry(
    () =>
      db
        .select({
          id: proactiveSuggestionsTable.id,
          relatedEntityId: proactiveSuggestionsTable.relatedEntityId,
          dedupeKey: proactiveSuggestionsTable.dedupeKey,
        })
        .from(proactiveSuggestionsTable)
        .where(
          and(
            eq(proactiveSuggestionsTable.organisationId, orgId),
            eq(proactiveSuggestionsTable.type, PAYMENT_REMINDER_SUGGESTION_TYPE),
            eq(proactiveSuggestionsTable.status, "pending"),
          ),
        ),
    { label: "payment-reminder:pending" },
  );

  const overdueIds = new Set(overdue.map((f) => f.id));
  const pendingInvoiceIds = new Set(
    pending.map((p) => p.relatedEntityId).filter((x): x is number => typeof x === "number"),
  );

  // Auto-résolution : une suggestion pending dont la facture n'est plus dans la
  // liste « échue impayée » (réglée, annulée, supprimée, ou échéance repoussée).
  const staleIds = pending
    .filter((p) => p.relatedEntityId == null || !overdueIds.has(p.relatedEntityId))
    .map((p) => p.id);
  let resolved = 0;
  if (staleIds.length > 0) {
    await db
      .update(proactiveSuggestionsTable)
      .set({ status: "done", resolvedAt: now })
      .where(
        and(
          eq(proactiveSuggestionsTable.organisationId, orgId),
          inArray(proactiveSuggestionsTable.id, staleIds),
        ),
      );
    resolved = staleIds.length;
  }

  // Espacement (hystérésis) couvrant le REJET : les factures pour lesquelles une
  // suggestion payment_reminder a été créée récemment (toute statut) ne sont pas
  // re-proposées avant MIN_INTERVAL_DAYS.
  const sinceWindow = new Date(now.getTime() - MIN_INTERVAL_DAYS * DAY_MS);
  const recent = await withDbRetry(
    () =>
      db
        .select({ relatedEntityId: proactiveSuggestionsTable.relatedEntityId })
        .from(proactiveSuggestionsTable)
        .where(
          and(
            eq(proactiveSuggestionsTable.organisationId, orgId),
            eq(proactiveSuggestionsTable.type, PAYMENT_REMINDER_SUGGESTION_TYPE),
            gt(proactiveSuggestionsTable.createdAt, sinceWindow),
          ),
        ),
    { label: "payment-reminder:recent" },
  );
  const recentlyProposed = new Set(
    recent.map((r) => r.relatedEntityId).filter((x): x is number => typeof x === "number"),
  );

  // Comptes clients ayant DÉSACTIVÉ les relances auto (par contact).
  const optedOut = new Set<number>();
  const contactIds = overdue.map((f) => f.contactId).filter((x): x is number => typeof x === "number");
  if (contactIds.length > 0) {
    const accounts = await withDbRetry(
      () =>
        db
          .select({ contactId: compteClientTable.contactId, autoReminderEnabled: compteClientTable.autoReminderEnabled })
          .from(compteClientTable)
          .where(
            and(
              eq(compteClientTable.organisationId, orgId),
              eq(compteClientTable.autoReminderEnabled, false),
              inArray(compteClientTable.contactId, Array.from(new Set(contactIds))),
            ),
          ),
      { label: "payment-reminder:opted-out" },
    );
    for (const a of accounts) if (a.contactId != null) optedOut.add(a.contactId);
  }

  // Construction des candidats à créer.
  let created = 0;
  let candidateCount = 0;
  for (const f of overdue) {
    if (pendingInvoiceIds.has(f.id)) continue; // déjà une suggestion en attente
    if (recentlyProposed.has(f.id)) continue; // proposée récemment (anti-spam)
    if (f.contactId != null && optedOut.has(f.contactId)) continue; // relances désactivées
    if (f.lastReminderAt) {
      const elapsed = now.getTime() - new Date(f.lastReminderAt).getTime();
      if (elapsed < MIN_INTERVAL_DAYS * DAY_MS) continue; // relance envoyée récemment
    }

    const total = parseFloat(f.totalAmount || "0");
    const paid = parseFloat(f.paidAmount || "0");
    const remaining = Math.max((Number.isFinite(total) ? total : 0) - (Number.isFinite(paid) ? paid : 0), 0);
    if (remaining <= 0) continue;

    const email = f.clientEmail?.trim() || "";
    const phone = f.clientPhone?.trim() || "";
    const channel: "email" | "sms" | null = email ? "email" : phone ? "sms" : null;
    if (!channel) continue; // aucun moyen de contacter le client
    const recipient = channel === "email" ? email : phone;

    candidateCount++;
    if (created >= MAX_PER_SCAN) continue;

    const dueMs = f.dueDate ? new Date(f.dueDate).getTime() : now.getTime();
    const daysOverdue = Math.max(1, Math.floor((now.getTime() - dueMs) / DAY_MS));
    const reminderCount = f.reminderCount ?? 0;
    const stage = stageFor(daysOverdue, reminderCount);
    const amountLabel = formatAmount(remaining, f.currency || "EUR");
    const dueDateLabel = f.dueDate ? new Date(f.dueDate).toLocaleDateString("fr-FR") : null;
    const reminderNumber = reminderCount + 1;

    const draft = buildDraft({
      stage,
      channel,
      clientName: f.clientName,
      reference: f.reference,
      title: f.title,
      amountLabel,
      dueDateLabel,
      daysOverdue,
      reminderNumber,
    });

    const channelLabel = channel === "email" ? "e-mail" : "SMS";
    const stageLabel = stage === "final" ? "Relance urgente" : stage === "firm" ? "Relance" : "Rappel";

    const inserted = await db
      .insert(proactiveSuggestionsTable)
      .values({
        organisationId: orgId,
        userId: null,
        type: PAYMENT_REMINDER_SUGGESTION_TYPE,
        severity: severityFor(stage),
        title: `${stageLabel} — ${f.clientName} doit ${amountLabel}`.slice(0, 200),
        detail:
          `Facture ${f.reference} en retard de ${daysOverdue} jour(s). ` +
          `Brouillon de relance par ${channelLabel} prêt à envoyer.`.slice(0, 500),
        status: "pending",
        relatedEntityType: "facture_client",
        relatedEntityId: f.id,
        actionType: "send_payment_reminder",
        actionPayload: {
          invoiceId: f.id,
          reference: f.reference,
          clientName: f.clientName,
          channel,
          recipient,
          amountLabel,
          dueDateLabel,
          daysOverdue,
          stage,
          reminderNumber,
          draftSubject: draft.subject,
          draftBodyPlain: draft.bodyPlain,
        },
        dedupeKey: `payment_reminder:${f.id}`,
      })
      .onConflictDoNothing()
      .returning({ id: proactiveSuggestionsTable.id });
    if (inserted.length > 0) created++;
  }

  if (created > 0 || resolved > 0) {
    try {
      broadcaster.broadcast(orgId, {
        type: "dashboard",
        action: "updated",
        meta: { source: "payment-reminder", created, resolved },
      });
    } catch (err) {
      logger.warn({ err, orgId }, "[payment-reminder] broadcast SSE échoué");
    }
  }

  return { candidates: candidateCount, created, resolved, skipped: false };
}
