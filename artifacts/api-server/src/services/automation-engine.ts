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
} from "@workspace/db/schema";
import { eq, lte, and, gte, lt, sql, desc, isNull, or } from "drizzle-orm";
import { logger } from "../lib/logger";

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

    const customRules = await db
      .select()
      .from(automationRulesTable)
      .where(
        and(
          eq(automationRulesTable.enabled, true),
          or(
            isNull(automationRulesTable.nextRun),
            lte(automationRulesTable.nextRun, new Date())
          )
        )
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

  const overdueTasks = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        lte(tasksTable.dueDate, now),
        sql`${tasksTable.status} NOT IN ('terminee', 'annulee')`
      )
    );

  if (overdueTasks.length === 0) return;

  for (const task of overdueTasks) {
    const existing = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.sourceType, "task_overdue"),
          eq(notificationsTable.sourceId, String(task.id)),
          eq(notificationsTable.read, false)
        )
      )
      .limit(1);

    if (existing.length > 0) continue;

    const daysOverdue = Math.ceil((now.getTime() - new Date(task.dueDate!).getTime()) / (1000 * 60 * 60 * 24));

    await db.insert(notificationsTable).values({
      type: "alerte",
      title: "Tache en retard",
      message: `"${task.title}" est en retard de ${daysOverdue} jour(s). Priorite: ${task.priority || "normale"}.`,
      priority: daysOverdue > 3 ? "urgente" : "haute",
      actionUrl: "/taches",
      sourceType: "task_overdue",
      sourceId: String(task.id),
    });
  }

  await logAutomationRun("Taches en retard", "success", { count: overdueTasks.length }, overdueTasks.length, performance.now() - start);
}

async function checkUpcomingCalendarEvents() {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 60 * 1000);
  const start = performance.now();

  const upcoming = await db
    .select()
    .from(calendarEventsTable)
    .where(
      and(
        gte(calendarEventsTable.startDate, now),
        lte(calendarEventsTable.startDate, soon)
      )
    );

  for (const event of upcoming) {
    const existing = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.sourceType, "calendar_reminder"),
          eq(notificationsTable.sourceId, String(event.id)),
          eq(notificationsTable.read, false)
        )
      )
      .limit(1);

    if (existing.length > 0) continue;

    const minutes = Math.round((new Date(event.startDate).getTime() - now.getTime()) / 60000);

    await db.insert(notificationsTable).values({
      userId: event.createdBy,
      type: "rappel",
      title: "Evenement imminent",
      message: `"${event.title}" commence dans ${minutes} minute(s)${event.location ? ` - ${event.location}` : ""}.`,
      priority: "haute",
      actionUrl: "/calendrier",
      sourceType: "calendar_reminder",
      sourceId: String(event.id),
    });
  }

  if (upcoming.length > 0) {
    await logAutomationRun("Rappels calendrier", "success", { count: upcoming.length }, upcoming.length, performance.now() - start);
  }
}

async function checkUnreadMessages() {
  const start = performance.now();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const unread = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.isRead, false),
        lte(messagesTable.createdAt, oneHourAgo)
      )
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

  const inactive = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contactsTable)
    .where(lte(contactsTable.updatedAt, thirtyDaysAgo));

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

async function checkMissedCalls() {
  const start = performance.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const missed = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(callsTable)
    .where(
      and(
        eq(callsTable.status, "manque"),
        gte(callsTable.createdAt, today)
      )
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

async function executeRule(rule: any) {
  const start = performance.now();
  try {
    const nextRun = calculateNextRun(rule.schedule);

    await db.update(automationRulesTable)
      .set({
        lastRun: new Date(),
        nextRun,
        runCount: sql`${automationRulesTable.runCount} + 1`,
      })
      .where(eq(automationRulesTable.id, rule.id));

    await logAutomationRun(rule.name, "success", { ruleId: rule.id }, 1, performance.now() - start);
  } catch (err: any) {
    await db.update(automationRulesTable)
      .set({
        lastRun: new Date(),
        errorCount: sql`${automationRulesTable.errorCount} + 1`,
        lastError: err?.message || "Erreur inconnue",
      })
      .where(eq(automationRulesTable.id, rule.id));

    await logAutomationRun(rule.name, "error", { ruleId: rule.id, error: err?.message }, 0, performance.now() - start, err?.message);
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
    ruleId: 0,
    ruleName,
    status,
    details,
    itemsProcessed,
    duration: Math.round(duration),
    error: error || null,
  });
}
