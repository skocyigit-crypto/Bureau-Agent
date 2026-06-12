// Pilier A — Moteur d'autonomie proactive.
//
// Pour chaque organisation active ayant opte (organisations.proactiveEngineEnabled),
// le moteur exécute des "détecteurs" DÉTERMINISTES (aucun coût IA) sur les signaux
// déjà présents en base et produit des SUGGESTIONS actionnables, dédupliquées par
// (organisationId, dedupeKey) tant qu'elles sont "pending".
//
// Le moteur fait aussi l'auto-résolution : si la condition d'une suggestion pending
// n'est plus vraie (tâche terminée, appel rappelé, conflit résolu), la suggestion
// passe en "done" — l'utilisateur garde une liste toujours fraîche.
//
// Tout est fail-soft : une erreur sur une org ne casse jamais le tick global, et le
// moteur ne consomme aucun quota IA (la rédaction IA reste à la demande, pilier B/D).

import {
  db,
  organisationsTable,
  tasksTable,
  callsTable,
  calendarEventsTable,
  contactsTable,
  messagesTable,
  proactiveSuggestionsTable,
} from "@workspace/db";
import { and, eq, lt, gte, inArray, notInArray, isNotNull, isNull, desc } from "drizzle-orm";
import { broadcaster } from "./broadcaster";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { analyzeTreasuryRisk, CASH_CRUNCH_THRESHOLD, CASH_CRUNCH_RESOLVE_THRESHOLD } from "./treasury-risk";
import { getSuppressedSuggestionTypes } from "./ai-learning";
import { runPaymentReminderScanForOrg } from "./payment-reminder";

const DAY_MS = 24 * 60 * 60 * 1000;
// "Toujours en éveil": le veilleur déterministe (sans coût IA) ré-évalue
// fréquemment pour détecter les urgences quasi en temps réel. La salve IA
// coûteuse (autonomous-secretary-cron) reste, elle, à une fois par jour.
// Réglable via PROACTIVE_TICK_MS (défaut 10 min).
const TICK_MS = Number(process.env.PROACTIVE_TICK_MS ?? 10 * 60 * 1000);
const FIRST_RUN_MS = 90 * 1000; // premier passage 90 s après le démarrage
// Borne dure du nombre de suggestions pending par org (anti-explosion).
const MAX_PENDING_PER_ORG = 200;

let timer: NodeJS.Timeout | null = null;

export type Severity = "info" | "warning" | "urgent";

interface Candidate {
  type: string;
  severity: Severity;
  title: string;
  detail?: string;
  // Cible PERSONNELLE (couche d'apprentissage par employé). Renseigné par les
  // détecteurs personnels -> suggestion privée (visible par l'utilisateur + un
  // responsable). Absent -> suggestion à l'échelle de l'org (visible par tous).
  userId?: number;
  relatedEntityType?: string;
  relatedEntityId?: number;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
  dedupeKey: string;
}

// Types gérés par les détecteurs ci-dessous. L'auto-résolution ne s'applique
// qu'à ces types (on ne touche pas aux suggestions d'autres origines futures).
const DETECTOR_TYPES = [
  "overdue_task",
  "missed_call_followup",
  "calendar_conflict",
  "negative_call_followup",
  "urgent_message",
  "meeting_prep",
  "inactive_contact",
  "cash_crunch",
  // SLA de réponse aux messages entrants + clients devenus silencieux.
  "message_sla_breach",
  "quiet_customer",
  // Détecteurs PERSONNELS (couche d'apprentissage par employé) -> suggestion
  // privée portant un userId. Préfixés "my_" par convention.
  "my_tasks_due_today",
] as const;

// Types de détecteurs RETIRÉS. On les garde ici (et non dans DETECTOR_TYPES,
// qui ne pilote plus aucun détecteur actif) uniquement pour l'auto-résolution :
// les anciennes suggestions `pending` de ces types n'ont plus de détecteur pour
// les régénérer, donc le prochain tick les passe en `done` de façon
// déterministe, dans TOUS les environnements (y compris la prod après Publish,
// où aucun SQL manuel n'est exécuté). Ne jamais réutiliser un type listé ici.
// - "vehicle_service": vertical Flotte/Vehicules retiré (logiciel BTP externe).
const RETIRED_DETECTOR_TYPES = ["vehicle_service"] as const;

// Seuil d'inactivité (jours) au-delà duquel un contact client/prospect est
// proposé pour une reprise de contact (détecteur F). Exporté : sert de borne
// haute au réglage « client silencieux » (la fenêtre doit rester [seuil ; 60[).
export const INACTIVE_CONTACT_DAYS = 60;

// --- Réglages : SLA de réponse aux messages entrants (détecteur 9) ---------
// Un message ENTRANT (rédigé par l'extérieur -> createdBy NULL) resté sans
// réponse au-delà de ce délai déclenche une relance. Distinct de
// urgent_message (priorité « haute », non lu, > 2 h) : ici on mesure le TEMPS
// DE RÉPONSE de TOUS les messages entrants non « haute » priorité (partition
// par priorité -> aucun doublon avec urgent_message), résolu par l'envoi d'une
// réponse. Le délai est désormais RÉGLABLE PAR ORG (organisations.messageSlaHours)
// depuis l'UI ; la valeur par défaut reste 8 h (ou PROACTIVE_MESSAGE_SLA_HOURS).
export const DEFAULT_MESSAGE_SLA_HOURS = Number(process.env.PROACTIVE_MESSAGE_SLA_HOURS ?? 8);
// Bornes du réglage (heures) : au moins 1 h, au plus 1 semaine.
export const MESSAGE_SLA_HOURS_MIN = 1;
export const MESSAGE_SLA_HOURS_MAX = 168;
// Fenêtre bornée : un très vieux message non répondu ne doit pas ressurgir
// indéfiniment (au-delà, la suggestion s'auto-résout faute de candidat).
const MESSAGE_SLA_LOOKBACK_DAYS = 14;

// --- Réglages : client devenu silencieux (détecteur 10) --------------------
// Contact client/prospect AYANT ÉTÉ actif (plusieurs appels) puis sans aucun
// appel depuis un délai inhabituel, mais PAS ENCORE « inactif »
// (< INACTIVE_CONTACT_DAYS). Fenêtre [quietCustomerAfterDays ;
// INACTIVE_CONTACT_DAYS[ -> aucun chevauchement avec inactive_contact. Le seuil
// est RÉGLABLE PAR ORG (organisations.quietCustomerAfterDays) depuis l'UI.
export const DEFAULT_QUIET_CUSTOMER_AFTER_DAYS = 21;
// Bornes du réglage (jours) : au moins 1 j, et strictement < INACTIVE_CONTACT_DAYS
// pour garder la fenêtre [seuil ; 60[ non vide et disjointe d'inactive_contact.
export const QUIET_CUSTOMER_AFTER_DAYS_MIN = 1;
export const QUIET_CUSTOMER_AFTER_DAYS_MAX = INACTIVE_CONTACT_DAYS - 1;
const QUIET_CUSTOMER_MIN_CALLS = 2;

// Borne une valeur entière dans [min ; max], en repliant les valeurs invalides
// (NaN/non finies) sur le défaut fourni. Pur -> testable.
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Réglages proactifs résolus pour une org (déjà bornés). Threadés dans les
// détecteurs concernés par runProactiveForOrg pour éviter une relecture par
// détecteur.
export interface OrgProactiveConfig {
  messageSlaHours: number;
  quietCustomerAfterDays: number;
}

// Applique la boucle de feedback au flux déterministe: retire les candidats dont
// le `type` a été nettement et durablement rejeté par le dirigeant (👎), SAUF
// ceux de sévérité « urgent » qui doivent toujours remonter (un type mal noté ne
// doit jamais masquer une urgence réelle : trésorerie, appel tendu, etc.).
// Fonction PURE (sans I/O) pour être testable unitairement.
export function filterSuppressedCandidates(
  candidates: Candidate[],
  suppressed: Set<string>,
): Candidate[] {
  if (suppressed.size === 0) return candidates;
  return candidates.filter((c) => c.severity === "urgent" || !suppressed.has(c.type));
}

function frDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function frTime(d: Date): string {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// --- Détecteur 1 : tâches en retard ---------------------------------------
async function detectOverdueTasks(orgId: number, now: Date): Promise<Candidate[]> {
  const rows = await withDbRetry(
    () => db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.organisationId, orgId),
          notInArray(tasksTable.status, ["termine", "annule"]),
          isNotNull(tasksTable.dueDate),
          lt(tasksTable.dueDate, now),
        ),
      )
      .orderBy(desc(tasksTable.dueDate))
      .limit(50),
    { label: "proactive:overdue-tasks" },
  );

  return rows.map((t) => {
    const due = t.dueDate as Date;
    const daysOverdue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / DAY_MS));
    const severity: Severity = daysOverdue >= 3 ? "urgent" : "warning";
    return {
      type: "overdue_task",
      severity,
      title: `Tâche en retard : ${t.title}`,
      detail:
        daysOverdue >= 1
          ? `Échéance dépassée de ${daysOverdue} jour(s) (prévue le ${frDate(due)}).`
          : `Échéance dépassée aujourd'hui (${frDate(due)}).`,
      relatedEntityType: "task",
      relatedEntityId: t.id,
      actionType: "open_task",
      actionPayload: { taskId: t.id, priority: t.priority },
      dedupeKey: `overdue_task:${t.id}`,
    };
  });
}

// --- Détecteur 2 : appels manqués sans suivi ------------------------------
async function detectMissedCallFollowups(orgId: number, now: Date): Promise<Candidate[]> {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const calls = await withDbRetry(
    () => db
      .select()
      .from(callsTable)
      .where(
        and(
          eq(callsTable.organisationId, orgId),
          eq(callsTable.status, "manque"),
          eq(callsTable.direction, "entrant"),
          gte(callsTable.createdAt, since),
        ),
      )
      .orderBy(desc(callsTable.createdAt))
      .limit(50),
    { label: "proactive:missed-calls" },
  );

  if (calls.length === 0) return [];

  // Appels déjà suivis d'une tâche liée -> on ne re-suggère pas.
  const callIds = calls.map((c) => c.id);
  const linked = await withDbRetry(
    () => db
      .select({ relatedCallId: tasksTable.relatedCallId })
      .from(tasksTable)
      .where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.relatedCallId, callIds))),
    { label: "proactive:missed-calls-linked" },
  );
  const linkedSet = new Set(linked.map((l) => l.relatedCallId));

  return calls
    .filter((c) => !linkedSet.has(c.id))
    .map((c) => {
      const who = c.contactName?.trim() || c.phoneNumber;
      const when = c.createdAt as Date;
      return {
        type: "missed_call_followup",
        severity: "warning" as Severity,
        title: `Rappeler ${who}`,
        detail: `Appel manqué le ${frDate(when)} à ${frTime(when)}. Aucun suivi enregistré.`,
        relatedEntityType: "call",
        relatedEntityId: c.id,
        actionType: "callback",
        actionPayload: {
          callId: c.id,
          contactId: c.contactId ?? null,
          phone: c.phoneNumber,
          name: who,
        },
        dedupeKey: `missed_call:${c.id}`,
      };
    });
}

// --- Détecteur 3 : conflits d'agenda --------------------------------------
async function detectCalendarConflicts(orgId: number, now: Date): Promise<Candidate[]> {
  const events = await withDbRetry(
    () => db
      .select()
      .from(calendarEventsTable)
      .where(and(eq(calendarEventsTable.organisationId, orgId), gte(calendarEventsTable.endDate, now)))
      .orderBy(calendarEventsTable.startDate)
      .limit(100),
    { label: "proactive:calendar-conflicts" },
  );

  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    if (a.allDay) continue;
    const aStart = (a.startDate as Date).getTime();
    const aEnd = (a.endDate as Date).getTime();
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      if (b.allDay) continue;
      const bStart = (b.startDate as Date).getTime();
      // events triés par startDate : si b commence après la fin de a, plus aucun chevauchement possible.
      if (bStart >= aEnd) break;
      const bEnd = (b.endDate as Date).getTime();
      // chevauchement réel
      if (aStart < bEnd && bStart < aEnd) {
        const lo = Math.min(a.id, b.id);
        const hi = Math.max(a.id, b.id);
        const key = `cal_conflict:${lo}:${hi}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          type: "calendar_conflict",
          severity: "urgent",
          title: `Conflit d'agenda : « ${a.title} » et « ${b.title} »`,
          detail: `Le ${frDate(a.startDate as Date)} : « ${a.title} » (${frTime(
            a.startDate as Date,
          )}–${frTime(a.endDate as Date)}) chevauche « ${b.title} » (${frTime(
            b.startDate as Date,
          )}–${frTime(b.endDate as Date)}).`,
          relatedEntityType: "calendar",
          relatedEntityId: lo,
          actionType: "open_calendar",
          actionPayload: { eventIds: [a.id, b.id], date: (a.startDate as Date).toISOString() },
          dedupeKey: key,
        });
      }
    }
  }
  return out;
}

// --- Détecteur 4 : appels au ressenti négatif sans suivi (marifet B) -------
// Tom analyse le ressenti de chaque appel (sentiment). Un appel « negatif » ou
// « tres_negatif » non suivi d'une tâche est un client mécontent qui risque de
// partir : on propose un rappel rapide pour désamorcer.
async function detectNegativeCallFollowups(orgId: number, now: Date): Promise<Candidate[]> {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const calls = await withDbRetry(
    () => db
      .select()
      .from(callsTable)
      .where(
        and(
          eq(callsTable.organisationId, orgId),
          inArray(callsTable.sentiment, ["negatif", "tres_negatif"]),
          gte(callsTable.createdAt, since),
        ),
      )
      .orderBy(desc(callsTable.createdAt))
      .limit(50),
    { label: "proactive:negative-calls" },
  );

  if (calls.length === 0) return [];

  // Appels déjà suivis d'une tâche liée -> on ne re-suggère pas.
  const callIds = calls.map((c) => c.id);
  const linked = await withDbRetry(
    () => db
      .select({ relatedCallId: tasksTable.relatedCallId })
      .from(tasksTable)
      .where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.relatedCallId, callIds))),
    { label: "proactive:negative-calls-linked" },
  );
  const linkedSet = new Set(linked.map((l) => l.relatedCallId));

  return calls
    .filter((c) => !linkedSet.has(c.id))
    .map((c) => {
      const who = c.contactName?.trim() || c.phoneNumber;
      const when = c.createdAt as Date;
      const tres = c.sentiment === "tres_negatif";
      return {
        type: "negative_call_followup",
        severity: "urgent" as Severity,
        title: `Rappeler ${who} — appel ${tres ? "très " : ""}tendu`,
        detail: `Appel au ressenti ${tres ? "très négatif" : "négatif"} le ${frDate(when)} à ${frTime(
          when,
        )}. Un rappel rapide peut désamorcer la situation.`,
        relatedEntityType: "call",
        relatedEntityId: c.id,
        actionType: "callback",
        actionPayload: {
          callId: c.id,
          contactId: c.contactId ?? null,
          phone: c.phoneNumber,
          name: who,
          sentiment: c.sentiment,
        },
        dedupeKey: `negative_call:${c.id}`,
      };
    });
}

// --- Détecteur 5 : messages prioritaires non lus (marifet D) ---------------
// Triage déterministe : un message marqué « haute » priorité, non lu depuis
// plus de 2 h, remonte comme à traiter (la rédaction d'un brouillon de réponse
// reste à la demande, pilier IA).
async function detectUrgentMessages(orgId: number, now: Date): Promise<Candidate[]> {
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const rows = await withDbRetry(
    () => db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.organisationId, orgId),
          eq(messagesTable.isRead, false),
          eq(messagesTable.priority, "haute"),
          lt(messagesTable.createdAt, cutoff),
        ),
      )
      .orderBy(desc(messagesTable.createdAt))
      .limit(30),
    { label: "proactive:urgent-messages" },
  );

  return rows.map((m) => {
    const who = m.contactName?.trim() || m.phoneNumber;
    const when = m.createdAt as Date;
    const content = (m.content || "").trim();
    const snippet = content.slice(0, 120);
    return {
      type: "urgent_message",
      severity: "warning" as Severity,
      title: `Message prioritaire non lu — ${who}`,
      detail: `Reçu le ${frDate(when)} à ${frTime(when)} et toujours non lu. « ${snippet}${
        content.length > 120 ? "…" : ""
      } »`,
      relatedEntityType: "message",
      relatedEntityId: m.id,
      actionType: "open_messages",
      actionPayload: { messageId: m.id, contactId: m.contactId ?? null },
      dedupeKey: `urgent_message:${m.id}`,
    };
  });
}

// --- Détecteur 6 : préparation de réunion (marifet E) ----------------------
// Pour chaque rendez-vous des prochaines 24 h, on rappelle de préparer
// documents / historique / ordre du jour. Auto-résolu dès que l'événement est
// passé (il sort de la fenêtre des candidats).
async function detectMeetingPrep(orgId: number, now: Date): Promise<Candidate[]> {
  const horizon = new Date(now.getTime() + DAY_MS);
  const events = await withDbRetry(
    () => db
      .select()
      .from(calendarEventsTable)
      .where(
        and(
          eq(calendarEventsTable.organisationId, orgId),
          gte(calendarEventsTable.startDate, now),
          lt(calendarEventsTable.startDate, horizon),
        ),
      )
      .orderBy(calendarEventsTable.startDate)
      .limit(30),
    { label: "proactive:meeting-prep" },
  );

  return events
    .filter((e) => !e.allDay && e.status !== "annule")
    .map((e) => {
      const start = e.startDate as Date;
      return {
        type: "meeting_prep",
        severity: "info" as Severity,
        title: `Préparer : ${e.title}`,
        detail: `Rendez-vous le ${frDate(start)} à ${frTime(
          start,
        )}. Préparez les documents, l'historique du contact et l'ordre du jour avant la rencontre.`,
        relatedEntityType: "calendar",
        relatedEntityId: e.id,
        actionType: "open_calendar",
        actionPayload: {
          eventIds: [e.id],
          date: start.toISOString(),
          contactId: e.relatedContactId ?? null,
        },
        dedupeKey: `meeting_prep:${e.id}`,
      };
    });
}

// --- Détecteur 7 : contacts inactifs à relancer (marifet F) ----------------
// Clients / prospects sans aucune activité depuis INACTIVE_CONTACT_DAYS jours.
// On remonte les plus proches du seuil (les plus « récemment perdus »), bornés,
// pour proposer une reprise de contact sans noyer l'utilisateur.
async function detectInactiveContacts(orgId: number, now: Date): Promise<Candidate[]> {
  const cutoff = new Date(now.getTime() - INACTIVE_CONTACT_DAYS * DAY_MS);
  const rows = await withDbRetry(
    () => db
      .select()
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.organisationId, orgId),
          inArray(contactsTable.category, ["client", "prospect"]),
          lt(contactsTable.updatedAt, cutoff),
        ),
      )
      .orderBy(desc(contactsTable.updatedAt))
      .limit(10),
    { label: "proactive:inactive-contacts" },
  );

  return rows.map((c) => {
    const name = `${c.firstName} ${c.lastName}`.trim();
    const last = c.updatedAt as Date;
    const days = Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY_MS));
    return {
      type: "inactive_contact",
      severity: "info" as Severity,
      title: `Renouer avec ${name}`,
      detail: `Aucune activité depuis ${days} jours (${c.category}). Un message de reprise de contact peut raviver la relation.`,
      relatedEntityType: "contact",
      relatedEntityId: c.id,
      actionType: "open_contact",
      actionPayload: { contactId: c.id, email: c.email ?? null, phone: c.phone, name },
      dedupeKey: `inactive_contact:${c.id}`,
    };
  });
}

// --- Détecteur 8 : risque de trésorerie (Radar BTP) -----------------------
// Pilier BTP. Exécute la simulation Monte Carlo de trésorerie (90 jours) sur les
// DONNÉES RÉELLES de l'org (factures + paramètres de trésorerie). N'émet une
// suggestion QUE si l'org a configuré sa trésorerie (sinon pas de probabilité
// inventée) ET que la probabilité de tension dépasse le seuil. Agrégé au niveau
// org (dedupeKey stable "cash_crunch") : une seule alerte pending à la fois,
// auto-résolue par le cron dès que le risque repasse sous le seuil bas
// (hystérésis). Calcul pur, aucun coût IA. 2000 simulations pour limiter le
// bruit d'échantillonnage autour du seuil.
async function detectCashCrunch(orgId: number, _now: Date): Promise<Candidate[]> {
  try {
    const risk = await analyzeTreasuryRisk(orgId, { simulations: 2000 });
    if (!risk.configured) return [];
    const p = risk.simulation.insolvencyProbability;

    // Hystérésis anti-clignotement : on déclenche au-dessus du seuil HAUT, mais
    // une alerte déjà ouverte ne se résout qu'en repassant sous le seuil BAS.
    // Sans cela, le bruit d'échantillonnage Monte Carlo autour du seuil ferait
    // créer/auto-résoudre l'alerte à chaque tick alors que les données réelles
    // n'ont pas bougé.
    const [pending] = await withDbRetry(
      () => db
        .select({ id: proactiveSuggestionsTable.id })
        .from(proactiveSuggestionsTable)
        .where(
          and(
            eq(proactiveSuggestionsTable.organisationId, orgId),
            eq(proactiveSuggestionsTable.type, "cash_crunch"),
            eq(proactiveSuggestionsTable.status, "pending"),
          ),
        )
        .limit(1),
      { label: "proactive:cash-crunch-pending" },
    );
    const alreadyOpen = !!pending;
    const shouldAlert = alreadyOpen ? p >= CASH_CRUNCH_RESOLVE_THRESHOLD : p > CASH_CRUNCH_THRESHOLD;
    if (!shouldAlert) return [];

    const pct = (p * 100).toFixed(1);
    const median = Math.round(risk.simulation.projectedMedian);
    return [
      {
        type: "cash_crunch",
        severity: "urgent",
        title: `Risque de trésorerie : ${pct}% de tension sous 90 jours`,
        detail:
          `Probabilité estimée ${pct}% que la trésorerie passe sous zéro d'ici 90 jours ` +
          `(solde médian projeté ${median.toLocaleString("fr-FR")} €). ` +
          `${risk.overdueCount} facture(s) en retard (${Math.round(risk.overdueTotal).toLocaleString("fr-FR")} € à recouvrer). ` +
          `Échelonnez des paiements sous-traitants, relancez les impayés ou activez une ligne d'affacturage.`,
        actionType: "open_treasury",
        actionPayload: {
          probability: risk.simulation.insolvencyProbability,
          projectedMedian: risk.simulation.projectedMedian,
          overdueCount: risk.overdueCount,
          overdueTotal: risk.overdueTotal,
        },
        dedupeKey: "cash_crunch",
      },
    ];
  } catch (err) {
    logger.warn({ err, orgId }, "[proactive] détecteur trésorerie échoué");
    return [];
  }
}

// --- Détecteur personnel : mes tâches dues aujourd'hui --------------------
// Couche d'apprentissage PAR EMPLOYÉ. Pour chaque tâche due AUJOURD'HUI (pas
// encore en retard) rattachée à un créateur (createdBy non nul), on émet une
// suggestion PRIVÉE à cet utilisateur (userId renseigné). Distinct du détecteur
// org "overdue_task" (qui ne se déclenche qu'APRÈS l'échéance) : aucun doublon.
// dedupeKey préfixé "u<uid>:" -> l'index unique pending (org, dedupeKey) reste
// correct sans modification. Auto-résolu quand la tâche est terminée/annulée ou
// que la journée passe (la tâche sort de la fenêtre des candidats).
async function detectMyTasksDueToday(orgId: number, now: Date): Promise<Candidate[]> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + DAY_MS);
  const rows = await withDbRetry(
    () => db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.organisationId, orgId),
          notInArray(tasksTable.status, ["termine", "annule"]),
          isNotNull(tasksTable.createdBy),
          isNotNull(tasksTable.dueDate),
          gte(tasksTable.dueDate, startOfDay),
          lt(tasksTable.dueDate, endOfDay),
        ),
      )
      .orderBy(desc(tasksTable.dueDate))
      .limit(100),
    { label: "proactive:my-tasks-due-today" },
  );

  return rows.map((t) => {
    const uid = t.createdBy as number;
    const due = t.dueDate as Date;
    return {
      type: "my_tasks_due_today",
      severity: "warning" as Severity,
      userId: uid,
      title: `À faire aujourd'hui : ${t.title}`,
      detail: `Cette tâche est prévue pour aujourd'hui (${frDate(due)}). Pensez à la traiter avant la fin de journée.`,
      relatedEntityType: "task",
      relatedEntityId: t.id,
      actionType: "open_task",
      actionPayload: { taskId: t.id, priority: t.priority },
      dedupeKey: `u${uid}:due_today:${t.id}`,
    };
  });
}

// --- Détecteur 9 : SLA de réponse aux messages entrants -------------------
// Helper PUR (testable) : à partir des messages entrants candidats et de la
// date de la DERNIÈRE réponse sortante connue par numéro, renvoie les entrants
// encore SANS réponse (aucune réponse postérieure à leur réception). Une seule
// réponse plus récente « répond » à tous les entrants antérieurs du même
// numéro -> ils s'auto-résolvent. Comparaison par numéro de téléphone (toujours
// présent), plus robuste que contactId (nullable).
export function selectUnansweredInbound<
  T extends { phoneNumber: string; createdAt: Date },
>(inbound: T[], latestReplyAtByPhone: Map<string, number>): T[] {
  return inbound.filter((m) => {
    const replyAt = latestReplyAtByPhone.get(m.phoneNumber);
    return replyAt === undefined || replyAt <= m.createdAt.getTime();
  });
}

async function detectMessageSlaBreaches(orgId: number, now: Date, slaHours: number): Promise<Candidate[]> {
  const slaCutoff = new Date(now.getTime() - slaHours * 60 * 60 * 1000);
  const lookbackFloor = new Date(now.getTime() - MESSAGE_SLA_LOOKBACK_DAYS * DAY_MS);
  // Entrants candidats : rédigés par l'extérieur (createdBy NULL), assez vieux
  // pour dépasser le SLA, dans la fenêtre bornée, et non « haute » priorité
  // (cette tranche-là est déjà couverte par urgent_message -> aucun doublon).
  const inbound = await withDbRetry(
    () => db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.organisationId, orgId),
          isNull(messagesTable.createdBy),
          notInArray(messagesTable.priority, ["haute"]),
          lt(messagesTable.createdAt, slaCutoff),
          gte(messagesTable.createdAt, lookbackFloor),
        ),
      )
      .orderBy(desc(messagesTable.createdAt))
      .limit(50),
    { label: "proactive:message-sla-inbound" },
  );

  if (inbound.length === 0) return [];

  // Réponses sortantes (createdBy NON NULL = rédigées par un employé) vers ces
  // mêmes numéros, dans la fenêtre : on retient la plus récente par numéro.
  const phones = Array.from(new Set(inbound.map((m) => m.phoneNumber)));
  const replies = await withDbRetry(
    () => db
      .select({ phoneNumber: messagesTable.phoneNumber, createdAt: messagesTable.createdAt })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.organisationId, orgId),
          isNotNull(messagesTable.createdBy),
          inArray(messagesTable.phoneNumber, phones),
          gte(messagesTable.createdAt, lookbackFloor),
        ),
      ),
    { label: "proactive:message-sla-replies" },
  );
  const latestReplyAtByPhone = new Map<string, number>();
  for (const r of replies) {
    const t = (r.createdAt as Date).getTime();
    const prev = latestReplyAtByPhone.get(r.phoneNumber);
    if (prev === undefined || t > prev) latestReplyAtByPhone.set(r.phoneNumber, t);
  }

  return selectUnansweredInbound(
    inbound.map((m) => ({ ...m, createdAt: m.createdAt as Date })),
    latestReplyAtByPhone,
  ).map((m) => {
    const who = m.contactName?.trim() || m.phoneNumber;
    const when = m.createdAt as Date;
    const hours = Math.max(0, Math.floor((now.getTime() - when.getTime()) / (60 * 60 * 1000)));
    const content = (m.content || "").trim();
    const snippet = content.slice(0, 120);
    return {
      type: "message_sla_breach",
      severity: "warning" as Severity,
      title: `Message sans réponse — ${who}`,
      detail:
        `Reçu le ${frDate(when)} à ${frTime(when)} (il y a ~${hours} h) et toujours sans réponse. ` +
        `« ${snippet}${content.length > 120 ? "…" : ""} »`,
      relatedEntityType: "message",
      relatedEntityId: m.id,
      actionType: "open_messages",
      actionPayload: { messageId: m.id, contactId: m.contactId ?? null, phone: m.phoneNumber },
      dedupeKey: `message_sla:${m.id}`,
    };
  });
}

// --- Détecteur 10 : client devenu silencieux ------------------------------
// Contact client/prospect ayant été ACTIF (au moins QUIET_CUSTOMER_MIN_CALLS
// appels) puis sans aucun appel depuis QUIET_CUSTOMER_AFTER_DAYS jours, mais
// pas encore « inactif » (< INACTIVE_CONTACT_DAYS). Distinct d'inactive_contact
// (qui se base sur contacts.updatedAt et un seuil plus long) : ici on capte le
// « refroidissement » d'une relation engagée, pour relancer AVANT la perte.
// S'auto-résout dès qu'un nouvel appel rafraîchit lastCallAt (sort par le bas
// de la fenêtre) ou quand le contact franchit le seuil d'inactivité (par le
// haut -> repris par inactive_contact).
async function detectQuietCustomers(orgId: number, now: Date, afterDays: number): Promise<Candidate[]> {
  const silentSince = new Date(now.getTime() - afterDays * DAY_MS);
  const inactiveFloor = new Date(now.getTime() - INACTIVE_CONTACT_DAYS * DAY_MS);
  const rows = await withDbRetry(
    () => db
      .select()
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.organisationId, orgId),
          inArray(contactsTable.category, ["client", "prospect"]),
          gte(contactsTable.totalCalls, QUIET_CUSTOMER_MIN_CALLS),
          isNotNull(contactsTable.lastCallAt),
          lt(contactsTable.lastCallAt, silentSince),
          gte(contactsTable.lastCallAt, inactiveFloor),
        ),
      )
      .orderBy(desc(contactsTable.lastCallAt))
      .limit(10),
    { label: "proactive:quiet-customers" },
  );

  return rows.map((c) => {
    const name = `${c.firstName} ${c.lastName}`.trim();
    const last = c.lastCallAt as Date;
    const days = Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY_MS));
    return {
      type: "quiet_customer",
      severity: "info" as Severity,
      title: `${name} ne donne plus de nouvelles`,
      detail:
        `Ce ${c.category} était actif (${c.totalCalls} appels) mais n'a plus appelé depuis ${days} jours ` +
        `(dernier échange le ${frDate(last)}). Une relance peut éviter de perdre la relation.`,
      relatedEntityType: "contact",
      relatedEntityId: c.id,
      actionType: "open_contact",
      actionPayload: { contactId: c.id, email: c.email ?? null, phone: c.phone, name },
      dedupeKey: `quiet_customer:${c.id}`,
    };
  });
}

/**
 * Lit les réglages proactifs par org (colonnes organisations.messageSlaHours /
 * quietCustomerAfterDays), bornés sur les valeurs sûres. Fail-soft : toute
 * erreur de lecture replie sur les défauts historiques.
 */
export async function getOrgProactiveConfig(orgId: number): Promise<OrgProactiveConfig> {
  try {
    const [row] = await withDbRetry(
      () => db
        .select({
          messageSlaHours: organisationsTable.messageSlaHours,
          quietCustomerAfterDays: organisationsTable.quietCustomerAfterDays,
        })
        .from(organisationsTable)
        .where(eq(organisationsTable.id, orgId))
        .limit(1),
      { label: "proactive:org-config" },
    );
    return {
      messageSlaHours: clampInt(
        row?.messageSlaHours,
        MESSAGE_SLA_HOURS_MIN,
        MESSAGE_SLA_HOURS_MAX,
        DEFAULT_MESSAGE_SLA_HOURS,
      ),
      quietCustomerAfterDays: clampInt(
        row?.quietCustomerAfterDays,
        QUIET_CUSTOMER_AFTER_DAYS_MIN,
        QUIET_CUSTOMER_AFTER_DAYS_MAX,
        DEFAULT_QUIET_CUSTOMER_AFTER_DAYS,
      ),
    };
  } catch (err) {
    logger.warn({ err, orgId }, "[proactive] lecture réglages org échouée — repli défauts");
    return {
      messageSlaHours: DEFAULT_MESSAGE_SLA_HOURS,
      quietCustomerAfterDays: DEFAULT_QUIET_CUSTOMER_AFTER_DAYS,
    };
  }
}

/**
 * Exécute tous les détecteurs pour une organisation, déduplique contre les
 * suggestions pending existantes, auto-résout celles qui ne s'appliquent plus,
 * insère les nouvelles et diffuse un événement SSE. Renvoie le nombre créé.
 */
export async function runProactiveForOrg(orgId: number): Promise<number> {
  const now = new Date();
  const cfg = await getOrgProactiveConfig(orgId);
  const rawCandidates: Candidate[] = [
    ...(await detectOverdueTasks(orgId, now)),
    ...(await detectMissedCallFollowups(orgId, now)),
    ...(await detectCalendarConflicts(orgId, now)),
    ...(await detectNegativeCallFollowups(orgId, now)),
    ...(await detectUrgentMessages(orgId, now)),
    ...(await detectMeetingPrep(orgId, now)),
    ...(await detectInactiveContacts(orgId, now)),
    ...(await detectCashCrunch(orgId, now)),
    ...(await detectMessageSlaBreaches(orgId, now, cfg.messageSlaHours)),
    ...(await detectQuietCustomers(orgId, now, cfg.quietCustomerAfterDays)),
    // Détecteurs personnels (couche par employé).
    ...(await detectMyTasksDueToday(orgId, now)),
  ];

  // Boucle de feedback (votes 👍/👎): on retire les candidats des types nettement
  // et durablement rejetés par le dirigeant. Les pending déjà existants de ces
  // types ne seront plus régénérés -> ils tombent dans `stale` ci-dessous et sont
  // auto-résolus. Les urgences ne sont jamais supprimées (cf. filterSuppressedCandidates).
  const suppressed = await getSuppressedSuggestionTypes(orgId);
  const candidates = filterSuppressedCandidates(rawCandidates, suppressed);
  const candidateKeys = new Set(candidates.map((c) => c.dedupeKey));

  // Suggestions pending actuelles pour cette org.
  const existing = await withDbRetry(
    () => db
      .select({
        id: proactiveSuggestionsTable.id,
        type: proactiveSuggestionsTable.type,
        dedupeKey: proactiveSuggestionsTable.dedupeKey,
      })
      .from(proactiveSuggestionsTable)
      .where(
        and(
          eq(proactiveSuggestionsTable.organisationId, orgId),
          eq(proactiveSuggestionsTable.status, "pending"),
        ),
      ),
    { label: "proactive:existing-pending" },
  );
  const existingKeys = new Set(existing.map((e) => e.dedupeKey));

  // Auto-résolution : pending d'un type géré dont la condition a disparu, OU
  // d'un type retiré (plus aucun détecteur → toujours considéré obsolète).
  const stale = existing.filter(
    (e) =>
      ((DETECTOR_TYPES as readonly string[]).includes(e.type) ||
        (RETIRED_DETECTOR_TYPES as readonly string[]).includes(e.type)) &&
      !candidateKeys.has(e.dedupeKey),
  );
  if (stale.length > 0) {
    await db
      .update(proactiveSuggestionsTable)
      .set({ status: "done", resolvedAt: now })
      .where(
        and(
          eq(proactiveSuggestionsTable.organisationId, orgId),
          inArray(
            proactiveSuggestionsTable.id,
            stale.map((s) => s.id),
          ),
        ),
      );
  }

  // Insertion des nouvelles (non déjà pending), bornée.
  let toInsert = candidates.filter((c) => !existingKeys.has(c.dedupeKey));
  const room = MAX_PENDING_PER_ORG - (existing.length - stale.length);
  if (room <= 0) toInsert = [];
  else if (toInsert.length > room) toInsert = toInsert.slice(0, room);

  if (toInsert.length > 0) {
    await db.insert(proactiveSuggestionsTable).values(
      toInsert.map((c) => ({
        organisationId: orgId,
        userId: c.userId ?? null,
        type: c.type,
        severity: c.severity,
        title: c.title,
        detail: c.detail ?? null,
        status: "pending",
        relatedEntityType: c.relatedEntityType ?? null,
        relatedEntityId: c.relatedEntityId ?? null,
        actionType: c.actionType ?? null,
        actionPayload: c.actionPayload ?? null,
        dedupeKey: c.dedupeKey,
      })),
    ).onConflictDoNothing();
  }

  if (toInsert.length > 0 || stale.length > 0) {
    try {
      broadcaster.broadcast(orgId, {
        type: "dashboard",
        action: "updated",
        meta: { source: "proactive", created: toInsert.length, resolved: stale.length },
      });
    } catch (err) {
      logger.warn({ err, orgId }, "[proactive] broadcast SSE échoué");
    }
  }

  // Suivi automatique des paiements (Tâche #293) : détecteur de factures clients
  // impayées/en retard, avec son propre cycle de vie (brouillon de relance +
  // envoi humain). Déterministe comme les autres détecteurs -> il tourne au même
  // rythme (cron 10 min + « Analyser maintenant »). Isolé en try/catch : un échec
  // ici ne doit jamais casser le reste du moteur proactif.
  let paymentCreated = 0;
  try {
    const r = await runPaymentReminderScanForOrg(orgId);
    paymentCreated = r.created;
  } catch (err) {
    logger.warn({ err, orgId }, "[proactive] scan relances de paiement échoué");
  }

  return toInsert.length + paymentCreated;
}

/**
 * Crée (de façon idempotente) une suggestion proactive d'alerte sécurité quand
 * un scan antivirus flague un document stocké comme « dangereux ». Contrairement
 * aux détecteurs du cron, c'est événementiel (appelé par les routes de scan) et
 * indépendant de `proactiveEngineEnabled` : une menace doit toujours alerter le
 * propriétaire, même si l'automatisation proactive est désactivée pour l'org.
 *
 * Agrégé au niveau org (dedupeKey stable `document_threat`) pour éviter le spam
 * lors d'un scan groupé : une seule suggestion « pending » à la fois, qui pointe
 * vers la liste filtrée /documents?scan=dangerous. L'auto-résolution du cron ne
 * touche jamais ce type (hors `DETECTOR_TYPES`) : elle reste jusqu'à action de
 * l'utilisateur. Fail-soft : ne casse jamais le flux de scan appelant.
 */
export async function recordDocumentThreatSuggestion(input: {
  orgId: number;
  fileName: string;
  engine?: string | null;
  documentId?: number;
}): Promise<void> {
  try {
    const name = (input.fileName || "Document").slice(0, 120);
    const engineSuffix = input.engine ? ` (${input.engine})` : "";
    const inserted = await db
      .insert(proactiveSuggestionsTable)
      .values({
        organisationId: input.orgId,
        type: "document_threat",
        severity: "urgent",
        title: "Document à risque détecté",
        detail: `Le fichier « ${name} » a été identifié comme dangereux${engineSuffix}. Vérifiez les documents signalés et supprimez la menace.`,
        status: "pending",
        relatedEntityType: "document",
        relatedEntityId: input.documentId ?? null,
        actionType: "open_documents_threats",
        actionPayload: { scan: "dangerous" },
        dedupeKey: "document_threat",
      })
      .onConflictDoNothing()
      .returning({ id: proactiveSuggestionsTable.id });

    if (inserted.length > 0) {
      try {
        broadcaster.broadcast(input.orgId, {
          type: "dashboard",
          action: "updated",
          meta: { source: "proactive", created: 1, resolved: 0, reason: "document_threat" },
        });
      } catch (err) {
        logger.warn({ err, orgId: input.orgId }, "[proactive] broadcast menace document échoué");
      }
    }
  } catch (err) {
    logger.warn({ err, orgId: input.orgId }, "[proactive] enregistrement menace document échoué");
  }
}

/**
 * Tâche #134 — décide si une notification push de menace documentaire doit
 * être émise pour ce scan. La règle est *par document* (et non agrégée au
 * niveau org comme la suggestion proactive) : on notifie uniquement lors d'une
 * transition « pas déjà dangereux » → « dangereux ». Conséquences voulues :
 *  - un nouveau document dangereux notifie une fois ;
 *  - un autre document distinct devenu dangereux notifie aussi ;
 *  - re-scanner un document déjà marqué « dangerous » ne re-notifie pas.
 * La dédup s'appuie sur le verdict persisté en base (pas d'état en mémoire),
 * donc elle survit aux redémarrages serveur.
 */
export function shouldNotifyDocumentThreat(
  previousVerdict: string | null | undefined,
  newVerdict: string,
): boolean {
  return newVerdict === "dangerous" && previousVerdict !== "dangerous";
}

/**
 * Émet l'évènement SSE `security` porteur de la charge de notification que le
 * mobile (UnreadBadgesContext) convertit en notification locale ouvrant la
 * liste filtrée /documents?scan=dangerous. À n'appeler que lorsque
 * `shouldNotifyDocumentThreat` est vrai (dédup par transition de verdict). Les
 * évènements `security` émis par emitSecurityAlert (par fichier, sans `notify`)
 * restent ignorés côté notification pour ne pas spammer. Fail-soft : ne casse
 * jamais le flux de scan appelant.
 */
export function broadcastDocumentThreatNotification(input: {
  orgId: number;
  fileName: string;
  engine?: string | null;
}): void {
  try {
    const name = (input.fileName || "Document").slice(0, 120);
    const engineSuffix = input.engine ? ` (${input.engine})` : "";
    broadcaster.broadcast(input.orgId, {
      type: "security",
      action: "created",
      meta: {
        source: "document_threat",
        notify: true,
        title: "Document à risque détecté",
        body: `Le fichier « ${name} » a été identifié comme dangereux${engineSuffix}.`,
        route: "/documents",
        scan: "dangerous",
      },
    });
  } catch (err) {
    logger.warn({ err, orgId: input.orgId }, "[proactive] broadcast notif menace document échoué");
  }
}

// --- Alerte admin : repli automatique de modele IA (Tâche #189) -----------
//
// L'organisation super-admin (KOBİ exploitant le SaaS) est la seule a pouvoir
// mettre a jour les variables d'environnement de modele (GEMINI_PRO_MODEL /
// GEMINI_FLASH_MODEL). C'est donc elle qu'on alerte quand un repli se declenche.
const SUPER_ADMIN_ORG_SLUG = "agent-de-bureau-sas";

// Garde mémoire des modeles deja signales (par modele retire) : evite d'ecrire
// en base a chaque requete (le repli peut se declencher des dizaines de fois).
// La garde DB (index unique partiel sur dedupe_key) couvre le multi-instance et
// le redemarrage ; cette garde-ci supprime juste le churn par requete.
const alertedFallbackModels = new Set<string>();

let superAdminOrgIdCache: number | null = null;
async function getSuperAdminOrgId(): Promise<number | null> {
  if (superAdminOrgIdCache != null) return superAdminOrgIdCache;
  try {
    const [org] = await db
      .select({ id: organisationsTable.id })
      .from(organisationsTable)
      .where(eq(organisationsTable.slug, SUPER_ADMIN_ORG_SLUG))
      .limit(1);
    if (org) superAdminOrgIdCache = org.id;
    return org?.id ?? null;
  } catch (err) {
    logger.warn({ err }, "[proactive] lookup organisation super-admin échoué");
    return null;
  }
}

/**
 * Tâche #189 — alerte l'administrateur quand un modele IA a ete retire et que
 * le repli automatique (Tâche #186) prend le relais. Sans cela, le repli est
 * totalement silencieux (une seule ligne de log) et personne ne pense a
 * basculer la variable d'environnement vers un modele actuel.
 *
 * Dédup a deux niveaux, comme `recordDocumentThreatSuggestion` :
 *  - en mémoire (`alertedFallbackModels`) pour ne pas marteler la base a chaque
 *    requete sur la duree de vie du process ;
 *  - en base via dedupeKey `model_fallback:<modele_retire>` + index unique
 *    partiel (une seule suggestion « pending » par modele retire et par org).
 * Le type `model_fallback` n'est pas un `DETECTOR_TYPES` : le cron ne l'auto-
 * résout jamais, la suggestion reste jusqu'a action de l'admin. Fail-soft : ne
 * casse jamais l'appel IA appelant.
 */
export async function recordModelFallbackSuggestion(input: {
  from: string;
  to: string;
}): Promise<void> {
  const retired = (input.from || "inconnu").slice(0, 80);
  const fallback = (input.to || "inconnu").slice(0, 80);
  if (alertedFallbackModels.has(retired)) return;
  alertedFallbackModels.add(retired);
  try {
    const orgId = await getSuperAdminOrgId();
    if (!orgId) {
      // Pas d'org cible : re-autoriser une tentative ulterieure.
      alertedFallbackModels.delete(retired);
      return;
    }
    const inserted = await db
      .insert(proactiveSuggestionsTable)
      .values({
        organisationId: orgId,
        type: "model_fallback",
        severity: "warning",
        title: "Modèle IA retiré — repli automatique actif",
        detail:
          `Le modèle « ${retired} » n'est plus disponible (retiré par le fournisseur). ` +
          `Les requêtes basculent automatiquement vers « ${fallback} ». ` +
          `Mettez à jour la variable d'environnement (GEMINI_PRO_MODEL / GEMINI_FLASH_MODEL) ` +
          `vers un modèle actuel pour ne pas dépendre indéfiniment de l'alias générique.`,
        status: "pending",
        actionType: null,
        actionPayload: { retiredModel: retired, fallbackModel: fallback },
        dedupeKey: `model_fallback:${retired}`,
      })
      .onConflictDoNothing()
      .returning({ id: proactiveSuggestionsTable.id });

    if (inserted.length > 0) {
      logger.warn(
        { retired, fallback, orgId },
        "[proactive] alerte admin créée : modèle IA retiré, repli automatique actif",
      );
      try {
        broadcaster.broadcast(orgId, {
          type: "dashboard",
          action: "updated",
          meta: { source: "proactive", created: 1, resolved: 0, reason: "model_fallback" },
        });
      } catch (err) {
        logger.warn({ err, orgId }, "[proactive] broadcast repli modèle échoué");
      }
    }
  } catch (err) {
    // Echec base : re-autoriser une nouvelle tentative au prochain repli.
    alertedFallbackModels.delete(retired);
    logger.warn({ err, from: retired }, "[proactive] enregistrement repli modèle échoué");
  }
}

async function tick(): Promise<void> {
  try {
    const orgs = await withDbRetry(
      () => db
        .select({ id: organisationsTable.id })
        .from(organisationsTable)
        .where(
          and(
            eq(organisationsTable.actif, true),
            eq(organisationsTable.proactiveEngineEnabled, true),
          ),
        ),
      { label: "proactive:tick-orgs" },
    );
    for (const org of orgs) {
      try {
        await runProactiveForOrg(org.id);
      } catch (err) {
        logger.warn({ orgId: org.id, err }, "[proactive] erreur organisation");
      }
    }
  } catch (err) {
    logger.error({ err }, "[proactive] tick failed");
  }
}

export function startProactiveEngine(): void {
  if (timer) return;
  setTimeout(() => {
    void tick();
  }, FIRST_RUN_MS);
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  logger.info(
    { tickMs: TICK_MS },
    "[proactive] moteur d'autonomie démarré — 10 détecteurs déterministes (dont SLA messages, clients silencieux, radar de trésorerie BTP)",
  );
}

export function stopProactiveEngine(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
