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
  proactiveSuggestionsTable,
} from "@workspace/db";
import { and, eq, lt, gte, inArray, notInArray, isNotNull, desc } from "drizzle-orm";
import { broadcaster } from "./broadcaster";
import { logger } from "../lib/logger";

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
  relatedEntityType?: string;
  relatedEntityId?: number;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
  dedupeKey: string;
}

// Types gérés par les détecteurs ci-dessous. L'auto-résolution ne s'applique
// qu'à ces types (on ne touche pas aux suggestions d'autres origines futures).
const DETECTOR_TYPES = ["overdue_task", "missed_call_followup", "calendar_conflict"] as const;

function frDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function frTime(d: Date): string {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// --- Détecteur 1 : tâches en retard ---------------------------------------
async function detectOverdueTasks(orgId: number, now: Date): Promise<Candidate[]> {
  const rows = await db
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
    .limit(50);

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
  const calls = await db
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
    .limit(50);

  if (calls.length === 0) return [];

  // Appels déjà suivis d'une tâche liée -> on ne re-suggère pas.
  const callIds = calls.map((c) => c.id);
  const linked = await db
    .select({ relatedCallId: tasksTable.relatedCallId })
    .from(tasksTable)
    .where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.relatedCallId, callIds)));
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
  const events = await db
    .select()
    .from(calendarEventsTable)
    .where(and(eq(calendarEventsTable.organisationId, orgId), gte(calendarEventsTable.endDate, now)))
    .orderBy(calendarEventsTable.startDate)
    .limit(100);

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

/**
 * Exécute tous les détecteurs pour une organisation, déduplique contre les
 * suggestions pending existantes, auto-résout celles qui ne s'appliquent plus,
 * insère les nouvelles et diffuse un événement SSE. Renvoie le nombre créé.
 */
export async function runProactiveForOrg(orgId: number): Promise<number> {
  const now = new Date();
  const candidates: Candidate[] = [
    ...(await detectOverdueTasks(orgId, now)),
    ...(await detectMissedCallFollowups(orgId, now)),
    ...(await detectCalendarConflicts(orgId, now)),
  ];
  const candidateKeys = new Set(candidates.map((c) => c.dedupeKey));

  // Suggestions pending actuelles pour cette org.
  const existing = await db
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
    );
  const existingKeys = new Set(existing.map((e) => e.dedupeKey));

  // Auto-résolution : pending d'un type géré dont la condition a disparu.
  const stale = existing.filter(
    (e) => (DETECTOR_TYPES as readonly string[]).includes(e.type) && !candidateKeys.has(e.dedupeKey),
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

  return toInsert.length;
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
    const orgs = await db
      .select({ id: organisationsTable.id })
      .from(organisationsTable)
      .where(
        and(
          eq(organisationsTable.actif, true),
          eq(organisationsTable.proactiveEngineEnabled, true),
        ),
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
  logger.info("[proactive] moteur d'autonomie démarré — détecteurs déterministes, tick 30 min");
}

export function stopProactiveEngine(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
