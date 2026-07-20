import { db } from "@workspace/db";
import {
  automationRulesTable,
  automationLogsTable,
  notificationsTable,
  tasksTable,
  callsTable,
  calendarEventsTable,
  contactsTable,
  messagesTable,
  projetsTable,
  telephonyProvidersTable,
} from "@workspace/db/schema";
import { eq, lte, and, gte, lt, sql, desc, isNull, isNotNull, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { sendEmail } from "./email";
import { broadcaster } from "./broadcaster";
import { sendSms, decryptProviderConfig } from "./telephony-providers";
import { enqueueProposal } from "./proposal-queue";

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startAutomationEngine() {
  if (intervalHandle) return;
  logger.info("[Automation] Moteur d'automatisation demarre");

  runAllAutomations();
  intervalHandle = setInterval(runAllAutomations, 5 * 60 * 1000);

  const shutdown = () => {
    logger.info("[Automation] Arret du moteur d'automatisation");
    stopAutomationEngine();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function stopAutomationEngine() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function runAllAutomations() {
  try {
    await checkOverdueTasks();
    await checkUpcomingCalendarEvents();
    await checkUnreadMessages();
    await checkInactiveContacts();
    await checkMissedCalls();
    await checkOverdueProjects();

    const customRules = await withDbRetry(
      () => db
        .select()
        .from(automationRulesTable)
        .where(
          and(
            eq(automationRulesTable.enabled, true),
            isNotNull(automationRulesTable.organisationId),
            or(
              isNull(automationRulesTable.nextRun),
              lte(automationRulesTable.nextRun, new Date())
            )
          )
        ),
      { label: "automation:runAllAutomations:customRules" },
    );

    for (const rule of customRules) {
      await executeRule(rule);
    }
  } catch (err) {
    logger.error({ err: err }, "[Automation] Erreur:");
  }
}

async function checkOverdueTasks() {
  const now = new Date();
  const start = performance.now();

  const overdueTasks = await withDbRetry(
    () => db
      .select()
      .from(tasksTable)
      .where(
        and(
          lte(tasksTable.dueDate, now),
          sql`${tasksTable.status} NOT IN ('termine', 'annule')`
        )
      ),
    { label: "automation:checkOverdueTasks" },
  );

  if (overdueTasks.length === 0) return;

  for (const task of overdueTasks) {
    const existing = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        // Dedup sur l'EXISTENCE (lu ou non lu). Avec un filtre read=false, des
        // que l'utilisateur marquait le rappel comme lu sans traiter la tache,
        // le tick suivant ne trouvait plus rien et recreait une notification ->
        // spam toutes les 5 min. On ne notifie donc qu'une seule fois par tache.
        and(
          eq(notificationsTable.sourceType, "task_overdue"),
          eq(notificationsTable.sourceId, String(task.id)),
        )
      )
      .limit(1);

    if (existing.length > 0) continue;

    const daysOverdue = Math.ceil((now.getTime() - new Date(task.dueDate!).getTime()) / (1000 * 60 * 60 * 24));
    const notifPriority = daysOverdue > 3 ? "urgente" : "haute";
    const message = `"${task.title}" est en retard de ${daysOverdue} jour(s). Priorite: ${task.priority || "normale"}.`;

    await db.insert(notificationsTable).values({
      ...(task.organisationId ? { organisationId: task.organisationId } : {}),
      type: "alerte",
      title: "Tache en retard",
      message,
      priority: notifPriority,
      actionUrl: "/taches",
      sourceType: "task_overdue",
      sourceId: String(task.id),
    });

    // Tâche #89: pousser un event SSE "reminder" pour que le mobile
    // vibre + (selon préférences) déclenche une notification locale,
    // comme pour les rappels calendrier (Tâche #84). On ne broadcast
    // que pour les tâches en retard à priorité haute/urgente.
    if (task.organisationId) {
      broadcaster.broadcast(task.organisationId, {
        type: "reminder",
        action: "created",
        resourceId: task.id,
        meta: {
          sourceType: "task_overdue",
          priority: notifPriority,
          title: "Tâche en retard",
          body: message,
        },
      });
    }
  }

  await logAutomationRun("Taches en retard", "success", { count: overdueTasks.length }, overdueTasks.length, performance.now() - start);
}

async function checkUpcomingCalendarEvents() {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 60 * 1000);
  const start = performance.now();

  const upcoming = await withDbRetry(
    () => db
      .select()
      .from(calendarEventsTable)
      .where(
        and(
          gte(calendarEventsTable.startDate, now),
          lte(calendarEventsTable.startDate, soon)
        )
      ),
    { label: "automation:checkUpcomingCalendarEvents" },
  );

  for (const event of upcoming) {
    const existing = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        // Dedup sur l'EXISTENCE (lu ou non lu). Sinon, marquer le rappel comme
        // lu avant le debut de l'evenement faisait recreer une notification a
        // chaque tick (toutes les 5 min). Un evenement n'est rappele qu'une fois.
        and(
          eq(notificationsTable.sourceType, "calendar_reminder"),
          eq(notificationsTable.sourceId, String(event.id)),
        )
      )
      .limit(1);

    if (existing.length > 0) continue;

    const minutes = Math.round((new Date(event.startDate).getTime() - now.getTime()) / 60000);

    const message = `"${event.title}" commence dans ${minutes} minute(s)${event.location ? ` - ${event.location}` : ""}.`;

    await db.insert(notificationsTable).values({
      userId: event.createdBy,
      ...(event.organisationId ? { organisationId: event.organisationId } : {}),
      type: "rappel",
      title: "Evenement imminent",
      message,
      priority: "haute",
      actionUrl: "/calendrier",
      sourceType: "calendar_reminder",
      sourceId: String(event.id),
    });

    // Tâche #84: pousser un event SSE "reminder" pour que le mobile
    // puisse vibrer + (selon préférences) déclencher une notification
    // locale, comme pour les nouveaux messages / tâches / appels manqués.
    // On ne broadcast que pour les rappels imminents urgents
    // (priority="haute"), seul cas géré ici.
    if (event.organisationId) {
      broadcaster.broadcast(event.organisationId, {
        type: "reminder",
        action: "created",
        resourceId: event.id,
        meta: {
          sourceType: "calendar_reminder",
          priority: "haute",
          title: "Rappel imminent",
          body: message,
        },
      });
    }
  }

  if (upcoming.length > 0) {
    await logAutomationRun("Rappels calendrier", "success", { count: upcoming.length }, upcoming.length, performance.now() - start);
  }
}

async function checkUnreadMessages() {
  const start = performance.now();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const unread = await withDbRetry(
    () => db
      .select({ count: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.isRead, false),
          lte(messagesTable.createdAt, oneHourAgo)
        )
      ),
    { label: "automation:checkUnreadMessages" },
  );

  const count = unread[0]?.count || 0;
  if (count === 0) return;

  const existing = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.sourceType, "unread_messages"),
        eq(notificationsTable.read, false),
        gte(notificationsTable.createdAt, oneHourAgo)
      )
    )
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(notificationsTable).values({
    type: "info",
    title: "Messages non lus",
    message: `Vous avez ${count} message(s) non lu(s) depuis plus d'une heure.`,
    priority: count > 10 ? "haute" : "normale",
    actionUrl: "/messages",
    sourceType: "unread_messages",
    sourceId: `batch-${Date.now()}`,
  });

  await logAutomationRun("Messages non lus", "success", { count }, count, performance.now() - start);
}

async function checkInactiveContacts() {
  const start = performance.now();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const inactive = await withDbRetry(
    () => db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactsTable)
      .where(lte(contactsTable.updatedAt, thirtyDaysAgo)),
    { label: "automation:checkInactiveContacts" },
  );

  const count = inactive[0]?.count || 0;
  if (count === 0) return;

  const existing = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.sourceType, "inactive_contacts"),
        eq(notificationsTable.read, false)
      )
    )
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(notificationsTable).values({
    type: "suggestion",
    title: "Contacts inactifs",
    message: `${count} contact(s) n'ont pas ete mis a jour depuis 30 jours. Pensez a les recontacter.`,
    priority: "normale",
    actionUrl: "/contacts",
    sourceType: "inactive_contacts",
    sourceId: `batch-${Date.now()}`,
  });

  await logAutomationRun("Contacts inactifs", "success", { count }, count, performance.now() - start);
}

async function checkOverdueProjects() {
  const start = performance.now();
  const now = new Date();

  const overdueProjects = await withDbRetry(
    () => db
      .select({ id: projetsTable.id, title: projetsTable.title, endDate: projetsTable.endDate, organisationId: projetsTable.organisationId })
      .from(projetsTable)
      .where(and(
        lte(projetsTable.endDate, now),
        sql`${projetsTable.status} NOT IN ('termine', 'annule')`,
      ))
      .limit(50),
    { label: "automation:checkOverdueProjects" },
  );

  if (overdueProjects.length === 0) return;

  for (const projet of overdueProjects) {
    const existing = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.sourceType, "projet_en_retard"),
        eq(notificationsTable.sourceId, String(projet.id)),
        eq(notificationsTable.read, false)
      ))
      .limit(1);

    if (existing.length > 0) continue;

    const daysOverdue = Math.ceil((now.getTime() - new Date(projet.endDate!).getTime()) / (1000 * 60 * 60 * 24));
    const notifPriority = daysOverdue > 7 ? "urgente" : "haute";
    const message = `Le projet "${projet.title}" est en retard de ${daysOverdue} jour(s).`;

    await db.insert(notificationsTable).values({
      ...(projet.organisationId ? { organisationId: projet.organisationId } : {}),
      type: "alerte",
      title: "Projet en retard",
      message,
      priority: notifPriority,
      actionUrl: "/projets",
      sourceType: "projet_en_retard",
      sourceId: String(projet.id),
    });

    // Tâche #89: pousser un event SSE "reminder" pour que le mobile
    // vibre + (selon préférences) déclenche une notification locale,
    // alignée avec le comportement des rappels calendrier (Tâche #84).
    if (projet.organisationId) {
      broadcaster.broadcast(projet.organisationId, {
        type: "reminder",
        action: "created",
        resourceId: projet.id,
        meta: {
          sourceType: "projet_en_retard",
          priority: notifPriority,
          title: "Projet en retard",
          body: message,
        },
      });
    }
  }

  await logAutomationRun("Projets en retard", "success", { count: overdueProjects.length }, overdueProjects.length, performance.now() - start);
}

async function checkMissedCalls() {
  const start = performance.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const missed = await withDbRetry(
    () => db
      .select({ count: sql<number>`count(*)::int` })
      .from(callsTable)
      .where(
        and(
          eq(callsTable.status, "manque"),
          gte(callsTable.createdAt, today)
        )
      ),
    { label: "automation:checkMissedCalls" },
  );

  const count = missed[0]?.count || 0;
  if (count === 0) return;

  const existing = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.sourceType, "missed_calls"),
        eq(notificationsTable.read, false),
        gte(notificationsTable.createdAt, today)
      )
    )
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(notificationsTable).values({
    type: "alerte",
    title: "Appels manques",
    message: `${count} appel(s) manque(s) aujourd'hui. Rappel recommande.`,
    priority: count > 5 ? "urgente" : "haute",
    actionUrl: "/appels",
    sourceType: "missed_calls",
    sourceId: `batch-${Date.now()}`,
  });

  await logAutomationRun("Appels manques", "success", { count }, count, performance.now() - start);
}

// ---------------------------------------------------------------------------
// Custom rule execution — evaluates trigger + executes actions
// ---------------------------------------------------------------------------

async function getTriggerItems(rule: any): Promise<any[]> {
  const orgId: number | null = rule.organisationId ?? null;
  const conditions = rule.conditions ?? {};

  switch (rule.trigger) {
    case "schedule":
      // Always fires on schedule — no specific items
      return [{ type: "schedule" }];

    case "missed_call": {
      // Find missed calls in the last execution interval
      const intervalMs = scheduleToMs(rule.schedule) || 5 * 60 * 1000;
      const since = new Date(Date.now() - intervalMs * 2); // 2x interval to avoid gaps
      return await withDbRetry(
        () => db
          .select({ id: callsTable.id, phoneNumber: callsTable.phoneNumber, createdAt: callsTable.createdAt })
          .from(callsTable)
          .where(and(
            eq(callsTable.status, "manque"),
            gte(callsTable.createdAt, since),
            ...(orgId ? [eq(callsTable.organisationId, orgId)] : []),
          ))
          .limit(50),
        { label: "automation:getTriggerItems:missed_call" },
      );
    }

    case "contact_no_activity": {
      const days: number = conditions.inactivityDays ?? 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      return await withDbRetry(
        () => db
          .select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, phone: contactsTable.phone, email: contactsTable.email })
          .from(contactsTable)
          .where(and(
            lte(contactsTable.updatedAt, cutoff),
            ...(orgId ? [eq(contactsTable.organisationId, orgId)] : []),
          ))
          .limit(20),
        { label: "automation:getTriggerItems:contact_no_activity" },
      );
    }

    case "task_overdue": {
      return await withDbRetry(
        () => db
          .select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate })
          .from(tasksTable)
          .where(and(
            lte(tasksTable.dueDate, new Date()),
            sql`${tasksTable.status} NOT IN ('termine', 'annule')`,
            ...(orgId ? [eq(tasksTable.organisationId, orgId)] : []),
          ))
          .limit(20),
        { label: "automation:getTriggerItems:task_overdue" },
      );
    }

    case "projet_overdue": {
      return await withDbRetry(
        () => db
          .select({ id: projetsTable.id, title: projetsTable.title, endDate: projetsTable.endDate, clientName: projetsTable.clientName, status: projetsTable.status })
          .from(projetsTable)
          .where(and(
            lte(projetsTable.endDate, new Date()),
            sql`${projetsTable.status} NOT IN ('termine', 'annule')`,
            ...(orgId ? [eq(projetsTable.organisationId, orgId)] : []),
          ))
          .limit(20),
        { label: "automation:getTriggerItems:projet_overdue" },
      );
    }

    default:
      return [{ type: rule.trigger }];
  }
}

/** Actions dont l'effet sort de l'organisation et atteint un tiers. */
const OUTBOUND_ACTIONS = new Set(["send_sms", "send_email"]);

/**
 * Une action doit-elle etre proposee plutot qu'executee ?
 * Par defaut oui pour les actions sortantes: la regle a beau avoir ete ecrite
 * par un humain, chacun de ses declenchements envoie un message reel a un
 * client sans que personne ne l'ait relu. Les actions internes (notification,
 * tache) restent automatiques — elles ne quittent pas l'organisation.
 */
function needsApproval(actionType: string, requiresApproval: boolean | null): boolean {
  if (requiresApproval === false) return false;
  if (requiresApproval === true) return true;
  return OUTBOUND_ACTIONS.has(actionType);
}

async function executeAction(
  orgId: number | null,
  action: { type: string; params?: Record<string, any> },
  context: Record<string, any>,
  ruleName: string,
  requiresApproval: boolean | null = null,
): Promise<void> {
  const p = action.params ?? {};

  if (orgId && needsApproval(action.type, requiresApproval)) {
    await proposeAction(orgId, action, context, ruleName);
    return;
  }

  switch (action.type) {
    case "send_notification": {
      await db.insert(notificationsTable).values({
        ...(orgId ? { organisationId: orgId } : {}),
        type: p.notifType ?? "info",
        title: interpolate(p.title ?? ruleName, context),
        message: interpolate(p.message ?? `Règle "${ruleName}" déclenchée.`, context),
        priority: p.priority ?? "normale",
        actionUrl: p.actionUrl ?? null,
        sourceType: "automation_rule",
        sourceId: `rule-${Date.now()}`,
      });
      break;
    }

    case "create_task": {
      if (!orgId) break;
      const dueDays: number = p.dueDays ?? 1;
      await db.insert(tasksTable).values({
        organisationId: orgId,
        title: interpolate(p.title ?? `Tâche automatique: ${ruleName}`, context),
        description: p.description ? interpolate(p.description, context) : null,
        status: "en_attente",
        priority: p.priority ?? "moyenne",
        dueDate: new Date(Date.now() + dueDays * 24 * 60 * 60 * 1000),
      });
      break;
    }

    case "send_sms": {
      const to: string = p.to ?? context.phoneNumber ?? context.phone ?? "";
      const body: string = interpolate(p.message ?? `Automatisation: ${ruleName}`, context);

      if (!orgId || !to) {
        logger.warn({ to, orgId }, "[Automation] send_sms: organisation ou numero cible absent");
        break;
      }

      // BYOK: chaque tenant a son propre fournisseur SMS (config saisie via
      // POST /telephony/providers), pas un compte Twilio plateforme partage.
      // Avant, cette action lisait TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER
      // directement depuis l'env — absent en prod, l'action ne faisait jamais
      // rien pour AUCUN tenant, meme ceux ayant configure leur propre Twilio.
      const [provider] = await withDbRetry(
        () => db.select().from(telephonyProvidersTable).where(and(
          eq(telephonyProvidersTable.organisationId, orgId),
          eq(telephonyProvidersTable.isDefault, true),
          eq(telephonyProvidersTable.isActive, true),
        )),
        { label: "automation-engine:send_sms-provider" },
      );

      if (!provider) {
        logger.warn({ orgId, to }, "[Automation] send_sms: aucun fournisseur SMS configure pour cette organisation");
        break;
      }

      try {
        const cfg = decryptProviderConfig(provider.provider, provider.config as Record<string, any>);
        const result = await sendSms(provider.provider, cfg, { to, body });
        if (!result.success) {
          logger.warn({ orgId, error: result.error }, "[Automation] send_sms: echec fournisseur");
        }
      } catch (err) {
        logger.warn({ orgId, err }, "[Automation] send_sms: exception fournisseur");
      }
      break;
    }

    case "send_email": {
      const to: string = p.to ?? context.email ?? "";
      if (!to) {
        logger.warn({ to }, "[Automation] send_email: email cible absent");
        break;
      }
      const subject = interpolate(p.subject ?? ruleName, context);
      const bodyText = interpolate(p.body ?? `Automatisation: ${ruleName}`, context);
      const html = `<p>${bodyText.replace(/\n/g, "<br>")}</p>`;
      const result = await sendEmail(to, subject, html, bodyText, { orgId: orgId ?? undefined });
      if (!result.success) {
        logger.warn({ to, err: result.error }, "[Automation] send_email: echec envoi");
      }
      break;
    }

    default:
      logger.warn({ actionType: action.type }, "[Automation] Type d'action inconnu");
  }
}

/**
 * Depose l'action en file d'approbation au lieu de l'executer. Les valeurs
 * sont interpolees ICI pour que l'humain lise le message final (avec le nom du
 * client, la date, etc.) et non le gabarit avec ses {{jetons}}.
 */
async function proposeAction(
  orgId: number,
  action: { type: string; params?: Record<string, any> },
  context: Record<string, any>,
  ruleName: string,
): Promise<void> {
  const p = action.params ?? {};

  if (action.type === "send_sms") {
    const to: string = p.to ?? context.phoneNumber ?? context.phone ?? "";
    if (!to) return;
    const message = interpolate(p.message ?? `Automatisation: ${ruleName}`, context);
    await enqueueProposal({
      orgId,
      toolName: "send_sms",
      title: `SMS automatique — ${ruleName}`,
      summary: `Envoyer un SMS a ${to}.`,
      reason: `Declenche par la regle d'automatisation "${ruleName}".`,
      args: { to, message },
      category: "sms",
      sourceType: "automation_rule",
      // Meme destinataire + meme regle + meme texte = meme proposition: la
      // regle re-tourne toutes les 5 minutes, sans cela la file se remplirait.
      sourceRef: `auto:${ruleName}:sms:${to}:${hashText(message)}`,
    });
    return;
  }

  if (action.type === "send_email") {
    const to: string = p.to ?? context.email ?? "";
    if (!to) return;
    const subject = interpolate(p.subject ?? ruleName, context);
    const bodyText = interpolate(p.body ?? `Automatisation: ${ruleName}`, context);
    await enqueueProposal({
      orgId,
      toolName: "send_email",
      title: `E-mail automatique — ${ruleName}`,
      summary: `Envoyer un e-mail a ${to} — sujet: « ${subject} »`,
      reason: `Declenche par la regle d'automatisation "${ruleName}".`,
      args: { to, subject, body: bodyText },
      category: "email",
      sourceType: "automation_rule",
      sourceRef: `auto:${ruleName}:email:${to}:${hashText(subject + bodyText)}`,
    });
    return;
  }

  if (action.type === "create_task") {
    const dueDays: number = p.dueDays ?? 1;
    const title = interpolate(p.title ?? `Tâche automatique: ${ruleName}`, context);
    await enqueueProposal({
      orgId,
      toolName: "create_task",
      title: `Tâche automatique — ${ruleName}`,
      summary: `Créer la tâche « ${title} ».`,
      reason: `Declenche par la regle d'automatisation "${ruleName}".`,
      args: {
        title,
        description: p.description ? interpolate(p.description, context) : undefined,
        // L'outil create_task n'accepte que ces trois valeurs; une regle peut
        // en contenir d'autres et ferait rejeter la proposition entiere.
        priority: ["basse", "moyenne", "haute"].includes(p.priority) ? p.priority : "moyenne",
        dueDate: new Date(Date.now() + dueDays * 24 * 60 * 60 * 1000).toISOString(),
      },
      category: "tache",
      sourceType: "automation_rule",
      sourceRef: `auto:${ruleName}:task:${hashText(title)}`,
    });
    return;
  }

  // send_notification et types inconnus: purement internes, rien a proposer.
  logger.warn({ actionType: action.type, ruleName }, "[Automation] Action non proposable, ignoree");
}

/** Empreinte courte et stable d'un texte, pour les cles de deduplication. */
function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/** Replace {{key}} tokens in a string with context values */
function interpolate(template: string, ctx: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(ctx[key] ?? ""));
}

function scheduleToMs(schedule: string | null): number {
  switch (schedule) {
    case "5min": return 5 * 60 * 1000;
    case "15min": return 15 * 60 * 1000;
    case "30min": return 30 * 60 * 1000;
    case "1h": return 60 * 60 * 1000;
    case "6h": return 6 * 60 * 60 * 1000;
    case "12h": return 12 * 60 * 60 * 1000;
    case "24h": return 24 * 60 * 60 * 1000;
    default: return 60 * 60 * 1000;
  }
}

async function executeRule(rule: any) {
  const start = performance.now();
  const orgId: number | null = rule.organisationId ?? null;

  try {
    const nextRun = calculateNextRun(rule.schedule);

    // Evaluate trigger to get items to act on
    const items = await getTriggerItems(rule);

    // Parse actions list
    const actions: Array<{ type: string; params?: Record<string, any> }> =
      Array.isArray(rule.actions) ? rule.actions : [];

    let itemsProcessed = 0;

    for (const item of items) {
      for (const action of actions) {
        try {
          await executeAction(orgId, action, item, rule.name, rule.requiresApproval ?? null);
          itemsProcessed++;
        } catch (actionErr: any) {
          logger.warn({ err: actionErr?.message, action: action.type, rule: rule.name }, "[Automation] Echec action");
        }
      }
    }

    await db.update(automationRulesTable)
      .set({
        lastRun: new Date(),
        nextRun,
        runCount: sql`${automationRulesTable.runCount} + 1`,
      })
      .where(eq(automationRulesTable.id, rule.id));

    await logAutomationRun(
      rule.name,
      "success",
      { ruleId: rule.id, trigger: rule.trigger, itemsFound: items.length, actionsExecuted: itemsProcessed },
      itemsProcessed,
      performance.now() - start,
    );
  } catch (err: any) {
    await db.update(automationRulesTable)
      .set({
        lastRun: new Date(),
        errorCount: sql`${automationRulesTable.errorCount} + 1`,
        lastError: err?.message || "Erreur inconnue",
      })
      .where(eq(automationRulesTable.id, rule.id));

    await logAutomationRun(
      rule.name,
      "error",
      { ruleId: rule.id, error: err?.message },
      0,
      performance.now() - start,
      err?.message,
    );
  }
}

function calculateNextRun(schedule: string | null): Date {
  const now = new Date();
  switch (schedule) {
    case "5min": return new Date(now.getTime() + 5 * 60 * 1000);
    case "15min": return new Date(now.getTime() + 15 * 60 * 1000);
    case "30min": return new Date(now.getTime() + 30 * 60 * 1000);
    case "1h": return new Date(now.getTime() + 60 * 60 * 1000);
    case "6h": return new Date(now.getTime() + 6 * 60 * 60 * 1000);
    case "12h": return new Date(now.getTime() + 12 * 60 * 60 * 1000);
    case "24h": return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    default: return new Date(now.getTime() + 60 * 60 * 1000);
  }
}

async function logAutomationRun(
  ruleName: string,
  status: string,
  details: any,
  itemsProcessed: number,
  duration: number,
  error?: string
) {
  await db.insert(automationLogsTable).values({
    ruleId: null,
    ruleName,
    status,
    details,
    itemsProcessed,
    duration: Math.round(duration),
    error: error || null,
  });
}
