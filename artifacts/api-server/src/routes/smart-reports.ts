import { Router, type Request, type Response } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, prospectsTable, calendarEventsTable } from "@workspace/db";
import { eq, sql, and, gte, lte, desc } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { logger } from "../lib/logger";

const router = Router();

router.get("/smart-reports/executive-summary", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const periodDays = parseInt(req.query.days as string) || 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);
    startDate.setHours(0, 0, 0, 0);

    const prevStart = new Date(startDate);
    prevStart.setDate(prevStart.getDate() - periodDays);

    const [
      callStats,
      prevCallStats,
      contactStats,
      taskStats,
      prevTaskStats,
      messageStats,
      prospectStats,
      prevProspectStats,
      eventStats,
    ] = await Promise.all([
      db.select({
        total: sql<number>`count(*)::int`,
        answered: sql<number>`count(*) filter (where ${callsTable.status} = 'answered')::int`,
        missed: sql<number>`count(*) filter (where ${callsTable.status} = 'missed')::int`,
        avgDuration: sql<number>`coalesce(avg(${callsTable.duration}), 0)::int`,
        totalDuration: sql<number>`coalesce(sum(${callsTable.duration}), 0)::int`,
      }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        answered: sql<number>`count(*) filter (where ${callsTable.status} = 'answered')::int`,
      }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, prevStart), lte(callsTable.createdAt, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        newThisPeriod: sql<number>`count(*) filter (where ${contactsTable.createdAt} >= ${startDate})::int`,
      }).from(contactsTable).where(eq(contactsTable.organisationId, orgId)),

      db.select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'terminee')::int`,
        inProgress: sql<number>`count(*) filter (where ${tasksTable.status} = 'en_cours')::int`,
        overdue: sql<number>`count(*) filter (where ${tasksTable.status} != 'terminee' and ${tasksTable.dueDate} < now())::int`,
        highPriority: sql<number>`count(*) filter (where ${tasksTable.priority} = 'haute')::int`,
      }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), gte(tasksTable.createdAt, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'terminee')::int`,
      }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), gte(tasksTable.createdAt, prevStart), lte(tasksTable.createdAt, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        unread: sql<number>`count(*) filter (where ${messagesTable.isRead} = false)::int`,
      }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), gte(messagesTable.createdAt, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        won: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'gagne')::int`,
        lost: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'perdu')::int`,
        totalValue: sql<number>`coalesce(sum(${prospectsTable.value}::numeric), 0)::numeric`,
        wonValue: sql<number>`coalesce(sum(case when ${prospectsTable.stage} = 'gagne' then ${prospectsTable.value}::numeric else 0 end), 0)::numeric`,
        avgProbability: sql<number>`coalesce(avg(${prospectsTable.probability}), 0)::int`,
      }).from(prospectsTable).where(and(eq(prospectsTable.organisationId, orgId), gte(prospectsTable.createdAt, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        won: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'gagne')::int`,
      }).from(prospectsTable).where(and(eq(prospectsTable.organisationId, orgId), gte(prospectsTable.createdAt, prevStart), lte(prospectsTable.createdAt, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        upcoming: sql<number>`count(*) filter (where ${calendarEventsTable.startDate} > now())::int`,
      }).from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), gte(calendarEventsTable.startDate, startDate))),
    ]);

    const cs = callStats[0];
    const pcs = prevCallStats[0];
    const ts = taskStats[0];
    const pts = prevTaskStats[0];
    const ps = prospectStats[0];
    const pps = prevProspectStats[0];

    const callTrend = pcs.total > 0 ? Math.round(((cs.total - pcs.total) / pcs.total) * 100) : 0;
    const responseRate = cs.total > 0 ? Math.round((cs.answered / cs.total) * 100) : 0;
    const prevResponseRate = pcs.total > 0 ? Math.round((pcs.answered / pcs.total) * 100) : 0;
    const taskCompletionRate = ts.total > 0 ? Math.round((ts.completed / ts.total) * 100) : 0;
    const prevTaskCompletionRate = pts.total > 0 ? Math.round((pts.completed / pts.total) * 100) : 0;
    const winRate = ps.total > 0 ? Math.round((ps.won / ps.total) * 100) : 0;
    const prevWinRate = pps.total > 0 ? Math.round((pps.won / pps.total) * 100) : 0;

    const overallScore = Math.round(
      (responseRate * 0.25) +
      (taskCompletionRate * 0.25) +
      (winRate * 0.25) +
      (Math.min(100, (contactStats[0].newThisPeriod / Math.max(1, periodDays)) * 100) * 0.25)
    );

    const insights: Array<{ type: string; severity: string; message: string; metric?: string }> = [];

    if (responseRate < 70) insights.push({ type: "appels", severity: "critique", message: `Taux de reponse faible: ${responseRate}%. Objectif: 85%+`, metric: `${responseRate}%` });
    else if (responseRate > prevResponseRate) insights.push({ type: "appels", severity: "positif", message: `Taux de reponse en hausse: ${responseRate}% (+${responseRate - prevResponseRate}%)`, metric: `+${responseRate - prevResponseRate}%` });

    if (ts.overdue > 5) insights.push({ type: "taches", severity: "alerte", message: `${ts.overdue} taches en retard necessitent attention`, metric: `${ts.overdue}` });
    if (taskCompletionRate > prevTaskCompletionRate + 5) insights.push({ type: "taches", severity: "positif", message: `Productivite en hausse: ${taskCompletionRate}% de completion (+${taskCompletionRate - prevTaskCompletionRate}%)`, metric: `+${taskCompletionRate - prevTaskCompletionRate}%` });

    if (Number(ps.wonValue) > 0) insights.push({ type: "prospects", severity: "positif", message: `${ps.won} prospects gagnes pour ${Number(ps.wonValue).toLocaleString("fr-FR")} EUR`, metric: `${Number(ps.wonValue).toLocaleString("fr-FR")} EUR` });
    if (ps.lost > ps.won && ps.total > 5) insights.push({ type: "prospects", severity: "alerte", message: `Plus de prospects perdus (${ps.lost}) que gagnes (${ps.won})`, metric: `${winRate}%` });

    if (messageStats[0].unread > 20) insights.push({ type: "messages", severity: "alerte", message: `${messageStats[0].unread} messages non lus en attente`, metric: `${messageStats[0].unread}` });

    res.json({
      period: { days: periodDays, start: startDate.toISOString(), end: new Date().toISOString() },
      score: overallScore,
      calls: { ...cs, trend: callTrend, responseRate, prevResponseRate },
      contacts: contactStats[0],
      tasks: { ...ts, completionRate: taskCompletionRate, prevCompletionRate: prevTaskCompletionRate },
      messages: messageStats[0],
      prospects: { ...ps, winRate, prevWinRate, totalValue: Number(ps.totalValue), wonValue: Number(ps.wonValue) },
      events: eventStats[0],
      insights,
      trends: {
        callTrend,
        taskTrend: prevTaskCompletionRate > 0 ? taskCompletionRate - prevTaskCompletionRate : 0,
        prospectTrend: prevWinRate > 0 ? winRate - prevWinRate : 0,
        responseTrend: responseRate - prevResponseRate,
      },
    });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur rapport executif:");
    res.status(500).json({ error: "Erreur lors de la generation du rapport" });
  }
});

router.get("/smart-reports/daily-timeline", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const days = parseInt(req.query.days as string) || 14;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const timeline: Array<{ date: string; calls: number; tasks: number; prospects: number; messages: number; events: number }> = [];

    for (let i = 0; i < days; i++) {
      const day = new Date(startDate);
      day.setDate(day.getDate() + i);
      const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);

      const [calls, tasks, prospects, messages, events] = await Promise.all([
        db.select({ c: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, dayStart), lte(callsTable.createdAt, dayEnd))),
        db.select({ c: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), gte(tasksTable.createdAt, dayStart), lte(tasksTable.createdAt, dayEnd))),
        db.select({ c: sql<number>`count(*)::int` }).from(prospectsTable).where(and(eq(prospectsTable.organisationId, orgId), gte(prospectsTable.createdAt, dayStart), lte(prospectsTable.createdAt, dayEnd))),
        db.select({ c: sql<number>`count(*)::int` }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), gte(messagesTable.createdAt, dayStart), lte(messagesTable.createdAt, dayEnd))),
        db.select({ c: sql<number>`count(*)::int` }).from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), gte(calendarEventsTable.startDate, dayStart), lte(calendarEventsTable.startDate, dayEnd))),
      ]);

      timeline.push({
        date: dayStart.toISOString().slice(0, 10),
        calls: calls[0].c, tasks: tasks[0].c, prospects: prospects[0].c, messages: messages[0].c, events: events[0].c,
      });
    }

    res.json({ timeline });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur timeline:");
    res.status(500).json({ error: "Erreur" });
  }
});

router.get("/smart-reports/reminders", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = (req.session as any)?.userId;

    const now = new Date();
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const [overdueTasks, upcomingEvents, urgentProspects, missedCalls] = await Promise.all([
      db.select().from(tasksTable).where(and(
        eq(tasksTable.organisationId, orgId),
        sql`${tasksTable.status} != 'terminee'`,
        sql`${tasksTable.dueDate} < now()`,
      )).orderBy(desc(tasksTable.dueDate)).limit(10),

      db.select().from(calendarEventsTable).where(and(
        eq(calendarEventsTable.organisationId, orgId),
        gte(calendarEventsTable.startDate, now),
        lte(calendarEventsTable.startDate, in24h),
      )).orderBy(calendarEventsTable.startDate).limit(10),

      db.select().from(prospectsTable).where(and(
        eq(prospectsTable.organisationId, orgId),
        sql`${prospectsTable.stage} NOT IN ('gagne', 'perdu')`,
        sql`${prospectsTable.expectedCloseDate} IS NOT NULL`,
        lte(prospectsTable.expectedCloseDate, in24h),
      )).orderBy(prospectsTable.expectedCloseDate).limit(5),

      db.select().from(callsTable).where(and(
        eq(callsTable.organisationId, orgId),
        eq(callsTable.status, "missed"),
        gte(callsTable.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      )).orderBy(desc(callsTable.createdAt)).limit(5),
    ]);

    const reminders: Array<{ id: string; type: string; severity: string; title: string; description: string; time: string; actionUrl?: string }> = [];

    for (const t of overdueTasks) {
      reminders.push({
        id: `task_${t.id}`, type: "tache", severity: "critique",
        title: `Tache en retard: ${t.title}`,
        description: `Echeance depassee depuis ${Math.ceil((now.getTime() - new Date(t.dueDate!).getTime()) / 86400000)} jours`,
        time: t.dueDate?.toISOString() || "", actionUrl: "/taches",
      });
    }

    for (const e of upcomingEvents) {
      const minutesUntil = Math.ceil((new Date(e.startDate).getTime() - now.getTime()) / 60000);
      reminders.push({
        id: `event_${e.id}`, type: "evenement",
        severity: minutesUntil <= 30 ? "urgent" : minutesUntil <= 120 ? "alerte" : "info",
        title: e.title,
        description: minutesUntil <= 60 ? `Dans ${minutesUntil} minutes` : `Aujourd'hui a ${new Date(e.startDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`,
        time: e.startDate.toISOString(), actionUrl: "/calendrier",
      });
    }

    for (const p of urgentProspects) {
      reminders.push({
        id: `prospect_${p.id}`, type: "prospect", severity: "alerte",
        title: `Prospect a conclure: ${p.title}`,
        description: `Date de cloture prevue: ${p.expectedCloseDate ? new Date(p.expectedCloseDate).toLocaleDateString("fr-FR") : "bientot"} - Valeur: ${Number(p.value || 0).toLocaleString("fr-FR")} EUR`,
        time: p.expectedCloseDate?.toISOString() || "", actionUrl: "/prospects",
      });
    }

    for (const c of missedCalls) {
      reminders.push({
        id: `call_${c.id}`, type: "appel", severity: "alerte",
        title: `Appel manque: ${c.contactName || c.phoneNumber || "Inconnu"}`,
        description: `A ${new Date(c.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`,
        time: c.createdAt.toISOString(), actionUrl: "/appels",
      });
    }

    reminders.sort((a, b) => {
      const severityOrder: Record<string, number> = { critique: 0, urgent: 1, alerte: 2, info: 3 };
      return (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
    });

    res.json({ reminders, counts: { overdue: overdueTasks.length, upcoming: upcomingEvents.length, urgentProspects: urgentProspects.length, missedCalls: missedCalls.length } });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur reminders:");
    res.status(500).json({ error: "Erreur" });
  }
});

export default router;
