import { Router, type IRouter } from "express";
import { eq, sql, desc, gte, and, lt } from "drizzle-orm";
import { db, callsTable, contactsTable, tasksTable, messagesTable } from "@workspace/db";
import {
  GetCallAnalyticsQueryParams,
  GetRecentActivityQueryParams,
  GetTopContactsQueryParams,
} from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function getStartOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfWeek(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfYear(): Date {
  const d = new Date();
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getPreviousWeekStart(): Date {
  const d = getStartOfWeek();
  d.setDate(d.getDate() - 7);
  return d;
}

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const todayStart = getStartOfDay();
  const weekStart = getStartOfWeek();
  const prevWeekStart = getPreviousWeekStart();

  const oc = eq(callsTable.organisationId, orgId);
  const oContact = eq(contactsTable.organisationId, orgId);
  const oTask = eq(tasksTable.organisationId, orgId);
  const oMsg = eq(messagesTable.organisationId, orgId);

  const safeQuery = <T>(promise: Promise<T>, fallback: T): Promise<T> =>
    promise.catch(() => fallback);

  const defaultCount = [{ count: 0 }];
  const defaultAvg = [{ avg: 0 }];

  const [
    todayCalls,
    answeredToday,
    missedToday,
    avgDuration,
    totalContacts,
    pendingTasks,
    unreadMessages,
    callsThisWeek,
    callsLastWeek,
  ] = await Promise.all([
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, todayStart))), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, todayStart), eq(callsTable.status, "repondu"))), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, todayStart), eq(callsTable.status, "manque"))), defaultCount),
    safeQuery(db.select({ avg: sql<number>`coalesce(avg(${callsTable.duration}), 0)::float` }).from(callsTable).where(oc), defaultAvg),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(contactsTable).where(oContact), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(oTask, eq(tasksTable.status, "en_attente"))), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(messagesTable).where(and(oMsg, eq(messagesTable.isRead, false))), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, weekStart))), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, prevWeekStart), sql`${callsTable.createdAt} < ${weekStart}`)), defaultCount),
  ]);

  const thisWeekCount = callsThisWeek[0]?.count ?? 0;
  const lastWeekCount = callsLastWeek[0]?.count ?? 0;
  const trend = lastWeekCount === 0 ? 0 : ((thisWeekCount - lastWeekCount) / lastWeekCount) * 100;

  res.json({
    totalCallsToday: todayCalls[0]?.count ?? 0,
    answeredCallsToday: answeredToday[0]?.count ?? 0,
    missedCallsToday: missedToday[0]?.count ?? 0,
    avgCallDuration: avgDuration[0]?.avg ?? 0,
    totalContacts: totalContacts[0]?.count ?? 0,
    pendingTasks: pendingTasks[0]?.count ?? 0,
    unreadMessages: unreadMessages[0]?.count ?? 0,
    callsThisWeek: thisWeekCount,
    callsTrend: Math.round(trend * 10) / 10,
  });
});

router.get("/dashboard/call-analytics", async (req, res): Promise<void> => {
  const query = GetCallAnalyticsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const oc = eq(callsTable.organisationId, orgId);
  const period = query.data.period ?? "week";

  let startDate: Date;
  let groupExpr: ReturnType<typeof sql>;
  switch (period) {
    case "today":
      startDate = getStartOfDay();
      groupExpr = sql`to_char(${callsTable.createdAt}, 'HH24:00')`;
      break;
    case "week":
      startDate = getStartOfWeek();
      groupExpr = sql`to_char(${callsTable.createdAt}, 'Dy')`;
      break;
    case "month":
      startDate = getStartOfMonth();
      groupExpr = sql`to_char(${callsTable.createdAt}, 'DD/MM')`;
      break;
    case "year":
      startDate = getStartOfYear();
      groupExpr = sql`to_char(${callsTable.createdAt}, 'Mon')`;
      break;
    default:
      startDate = getStartOfWeek();
      groupExpr = sql`to_char(${callsTable.createdAt}, 'Dy')`;
  }

  try {
    const dataPoints = await db
      .select({
        label: sql<string>`${groupExpr}`,
        answered: sql<number>`count(*) filter (where ${callsTable.status} = 'repondu')::int`,
        missed: sql<number>`count(*) filter (where ${callsTable.status} = 'manque')::int`,
        voicemail: sql<number>`count(*) filter (where ${callsTable.status} = 'messagerie')::int`,
        avgDuration: sql<number>`coalesce(avg(${callsTable.duration}), 0)::float`,
      })
      .from(callsTable)
      .where(and(oc, gte(callsTable.createdAt, startDate)))
      .groupBy(groupExpr)
      .orderBy(sql`min(${callsTable.createdAt})`);

    const totals = await db
      .select({
        totalAnswered: sql<number>`count(*) filter (where ${callsTable.status} = 'repondu')::int`,
        totalMissed: sql<number>`count(*) filter (where ${callsTable.status} = 'manque')::int`,
        totalVoicemail: sql<number>`count(*) filter (where ${callsTable.status} = 'messagerie')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(callsTable)
      .where(and(oc, gte(callsTable.createdAt, startDate)));

    const total = totals[0]?.total ?? 0;
    const totalAnswered = totals[0]?.totalAnswered ?? 0;

    res.json({
      period,
      dataPoints,
      totalAnswered,
      totalMissed: totals[0]?.totalMissed ?? 0,
      totalVoicemail: totals[0]?.totalVoicemail ?? 0,
      answerRate: total > 0 ? Math.round((totalAnswered / total) * 1000) / 10 : 0,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur analytics appels");
    res.status(500).json({ error: "Erreur lors de la recuperation des analytics." });
  }
});

router.get("/dashboard/recent-activity", async (req, res): Promise<void> => {
  const query = GetRecentActivityQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const limit = query.data.limit ?? 20;

  try {
    const [recentCalls, recentTasks, recentMessages] = await Promise.all([
      db.select().from(callsTable).where(eq(callsTable.organisationId, orgId)).orderBy(desc(callsTable.createdAt)).limit(limit),
      db.select().from(tasksTable).where(eq(tasksTable.organisationId, orgId)).orderBy(desc(tasksTable.createdAt)).limit(limit),
      db.select().from(messagesTable).where(eq(messagesTable.organisationId, orgId)).orderBy(desc(messagesTable.createdAt)).limit(limit),
    ]);

    const activities = [
      ...recentCalls.map((c) => ({
        id: c.id,
        type: "appel" as const,
        description: `Appel ${c.direction} ${c.status === "repondu" ? "repondu" : c.status === "manque" ? "manque" : "messagerie"} - ${c.contactName || c.phoneNumber}`,
        timestamp: c.createdAt.toISOString(),
        metadata: { direction: c.direction, status: c.status, duration: c.duration },
      })),
      ...recentTasks.map((t) => ({
        id: t.id + 10000,
        type: "tache" as const,
        description: `Tache: ${t.title} (${t.status})`,
        timestamp: t.createdAt.toISOString(),
        metadata: { status: t.status, priority: t.priority },
      })),
      ...recentMessages.map((m) => ({
        id: m.id + 20000,
        type: "message" as const,
        description: `Message ${m.type}: ${m.content.substring(0, 50)}${m.content.length > 50 ? "..." : ""}`,
        timestamp: m.createdAt.toISOString(),
        metadata: { type: m.type, isRead: m.isRead },
      })),
    ];

    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({ activities: activities.slice(0, limit) });
  } catch (err: any) {
    req.log.error({ err }, "Erreur activite recente");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'activite recente." });
  }
});

router.get("/dashboard/call-distribution", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const oc = eq(callsTable.organisationId, orgId);

  try {
    const total = await db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(oc);
    const totalCount = total[0]?.count ?? 0;

    const byStatus = await db
      .select({ status: callsTable.status, count: sql<number>`count(*)::int` })
      .from(callsTable).where(oc).groupBy(callsTable.status);

    const byDirection = await db
      .select({ direction: callsTable.direction, count: sql<number>`count(*)::int` })
      .from(callsTable).where(oc).groupBy(callsTable.direction);

    const bySentiment = await db
      .select({ sentiment: sql<string>`coalesce(${callsTable.sentiment}, 'inconnu')`, count: sql<number>`count(*)::int` })
      .from(callsTable).where(oc).groupBy(sql`coalesce(${callsTable.sentiment}, 'inconnu')`);

    res.json({
      byStatus: byStatus.map((s) => ({
        status: s.status, count: s.count,
        percentage: totalCount > 0 ? Math.round((s.count / totalCount) * 1000) / 10 : 0,
      })),
      byDirection: byDirection.map((d) => ({
        direction: d.direction, count: d.count,
        percentage: totalCount > 0 ? Math.round((d.count / totalCount) * 1000) / 10 : 0,
      })),
      bySentiment: bySentiment.map((s) => ({
        sentiment: s.sentiment, count: s.count,
        percentage: totalCount > 0 ? Math.round((s.count / totalCount) * 1000) / 10 : 0,
      })),
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur distribution appels");
    res.status(500).json({ error: "Erreur lors de la recuperation de la distribution." });
  }
});

router.get("/dashboard/top-contacts", async (req, res): Promise<void> => {
  const query = GetTopContactsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const limit = query.data.limit ?? 5;

  try {
    const contacts = await db
      .select({
        id: contactsTable.id,
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        company: contactsTable.company,
        totalCalls: contactsTable.totalCalls,
        lastCallAt: contactsTable.lastCallAt,
      })
      .from(contactsTable)
      .where(eq(contactsTable.organisationId, orgId))
      .orderBy(desc(contactsTable.totalCalls))
      .limit(limit);

    res.json({ contacts });
  } catch (err: any) {
    req.log.error({ err }, "Erreur top contacts");
    res.status(500).json({ error: "Erreur lors de la recuperation des contacts." });
  }
});

router.get("/dashboard/hourly-performance", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const oc = eq(callsTable.organisationId, orgId);

  try {
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const result = await db
        .select({
          total: sql<number>`count(*)::int`,
          answered: sql<number>`count(*) filter (where ${callsTable.status} = 'repondu')::int`,
          missed: sql<number>`count(*) filter (where ${callsTable.status} = 'manque')::int`,
        })
        .from(callsTable)
        .where(and(oc, sql`extract(hour from ${callsTable.createdAt}) = ${h}`));

      hours.push({
        hour: h,
        total: result[0]?.total ?? 0,
        answered: result[0]?.answered ?? 0,
        missed: result[0]?.missed ?? 0,
      });
    }

    res.json({ hours });
  } catch (err: any) {
    req.log.error({ err }, "Erreur performance horaire");
    res.status(500).json({ error: "Erreur lors de la recuperation des performances horaires." });
  }
});

router.get("/dashboard/task-stats", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const ot = eq(tasksTable.organisationId, orgId);
  const now = new Date();

  try {
    const [total, completed, inProgress, pending, cancelled, overdue, highPriority, byPriority] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(ot),
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(ot, eq(tasksTable.status, "termine"))),
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(ot, eq(tasksTable.status, "en_cours"))),
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(ot, eq(tasksTable.status, "en_attente"))),
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(ot, eq(tasksTable.status, "annule"))),
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(
        and(ot, sql`${tasksTable.status} != 'termine'`, sql`${tasksTable.status} != 'annule'`, sql`${tasksTable.dueDate} < ${now}`)
      ),
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(
        and(ot, eq(tasksTable.priority, "haute"), sql`${tasksTable.status} != 'termine'`, sql`${tasksTable.status} != 'annule'`)
      ),
      db.select({ priority: tasksTable.priority, count: sql<number>`count(*)::int` }).from(tasksTable).where(ot).groupBy(tasksTable.priority),
    ]);

    const totalCount = total[0]?.count ?? 0;
    const completedCount = completed[0]?.count ?? 0;

    res.json({
      totalTasks: totalCount,
      completedTasks: completedCount,
      inProgressTasks: inProgress[0]?.count ?? 0,
      pendingTasks: pending[0]?.count ?? 0,
      cancelledTasks: cancelled[0]?.count ?? 0,
      completionRate: totalCount > 0 ? Math.round((completedCount / totalCount) * 1000) / 10 : 0,
      overdueTasks: overdue[0]?.count ?? 0,
      highPriorityPending: highPriority[0]?.count ?? 0,
      byPriority,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur stats taches");
    res.status(500).json({ error: "Erreur lors de la recuperation des statistiques des taches." });
  }
});

router.get("/dashboard/weekly-report", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const weekStart = getStartOfWeek();
  const prevWeekStart = getPreviousWeekStart();
  const prevWeekEnd = weekStart;

  const oc = eq(callsTable.organisationId, orgId);
  const oContact = eq(contactsTable.organisationId, orgId);
  const oTask = eq(tasksTable.organisationId, orgId);
  const oMsg = eq(messagesTable.organisationId, orgId);

  try {
    const [
      thisWeekCalls, thisWeekAnswered, thisWeekMissed, thisWeekDuration,
      prevWeekCalls, prevWeekAnswered, prevWeekDuration,
      newContacts, completedTasks, messagesReceived,
      peakHourResult, peakDayResult,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, weekStart))),
      db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, weekStart), eq(callsTable.status, "repondu"))),
      db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, weekStart), eq(callsTable.status, "manque"))),
      db.select({ avg: sql<number>`coalesce(avg(${callsTable.duration}), 0)::float` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, weekStart))),
      db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, prevWeekStart), sql`${callsTable.createdAt} < ${prevWeekEnd}`)),
      db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, prevWeekStart), sql`${callsTable.createdAt} < ${prevWeekEnd}`, eq(callsTable.status, "repondu"))),
      db.select({ avg: sql<number>`coalesce(avg(${callsTable.duration}), 0)::float` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, prevWeekStart), sql`${callsTable.createdAt} < ${prevWeekEnd}`)),
      db.select({ count: sql<number>`count(*)::int` }).from(contactsTable).where(and(oContact, gte(contactsTable.createdAt, weekStart))),
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(oTask, gte(tasksTable.updatedAt, weekStart), eq(tasksTable.status, "termine"))),
      db.select({ count: sql<number>`count(*)::int` }).from(messagesTable).where(and(oMsg, gte(messagesTable.createdAt, weekStart))),
      db.select({ hour: sql<number>`extract(hour from ${callsTable.createdAt})::int`, count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, weekStart))).groupBy(sql`extract(hour from ${callsTable.createdAt})`).orderBy(sql`count(*) desc`).limit(1),
      db.select({ day: sql<string>`to_char(${callsTable.createdAt}, 'Dy')`, count: sql<number>`count(*)::int` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, weekStart))).groupBy(sql`to_char(${callsTable.createdAt}, 'Dy')`).orderBy(sql`count(*) desc`).limit(1),
    ]);

    const twc = thisWeekCalls[0]?.count ?? 0;
    const twa = thisWeekAnswered[0]?.count ?? 0;
    const pwc = prevWeekCalls[0]?.count ?? 0;
    const pwa = prevWeekAnswered[0]?.count ?? 0;
    const twAvg = thisWeekDuration[0]?.avg ?? 0;
    const pwAvg = prevWeekDuration[0]?.avg ?? 0;

    const answerRate = twc > 0 ? Math.round((twa / twc) * 1000) / 10 : 0;
    const prevAnswerRate = pwc > 0 ? Math.round((pwa / pwc) * 1000) / 10 : 0;

    const weekLabel = `Semaine du ${weekStart.toLocaleDateString("fr-FR")}`;

    res.json({
      weekLabel,
      totalCalls: twc,
      answeredCalls: twa,
      missedCalls: thisWeekMissed[0]?.count ?? 0,
      answerRate,
      avgDuration: Math.round(twAvg),
      newContacts: newContacts[0]?.count ?? 0,
      completedTasks: completedTasks[0]?.count ?? 0,
      messagesReceived: messagesReceived[0]?.count ?? 0,
      peakHour: peakHourResult[0]?.hour ?? 9,
      peakDay: peakDayResult[0]?.day ?? "Lun",
      comparisonPrevWeek: {
        callsDiff: pwc === 0 ? 0 : Math.round(((twc - pwc) / pwc) * 1000) / 10,
        answerRateDiff: Math.round((answerRate - prevAnswerRate) * 10) / 10,
        durationDiff: pwAvg === 0 ? 0 : Math.round(((twAvg - pwAvg) / pwAvg) * 1000) / 10,
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur rapport hebdomadaire");
    res.status(500).json({ error: "Erreur lors de la recuperation du rapport hebdomadaire." });
  }
});

router.get("/dashboard/notifications", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const notifications: Array<{
    id: number;
    type: string;
    title: string;
    description: string;
    isRead: boolean;
    relatedId: number | null;
    createdAt: string;
  }> = [];

  let notifId = 1;

  try {
    const missedCalls = await db.select().from(callsTable)
      .where(and(eq(callsTable.organisationId, orgId), eq(callsTable.status, "manque")))
      .orderBy(desc(callsTable.createdAt))
      .limit(5);

    for (const call of missedCalls) {
      notifications.push({
        id: notifId++,
        type: "appel_manque",
        title: "Appel manque",
        description: `Appel manque de ${call.contactName || call.phoneNumber}`,
        isRead: false,
        relatedId: call.id,
        createdAt: call.createdAt.toISOString(),
      });
    }

    const unreadMessages = await db.select().from(messagesTable)
      .where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.isRead, false)))
      .orderBy(desc(messagesTable.createdAt))
      .limit(5);

    for (const msg of unreadMessages) {
      notifications.push({
        id: notifId++,
        type: "message_non_lu",
        title: "Message non lu",
        description: `${msg.type === "messagerie_vocale" ? "Message vocal" : msg.type === "rappel" ? "Rappel" : "Note"} de ${msg.contactName || msg.phoneNumber}`,
        isRead: false,
        relatedId: msg.id,
        createdAt: msg.createdAt.toISOString(),
      });
    }

    const urgentTasks = await db.select().from(tasksTable)
      .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.priority, "haute"), eq(tasksTable.status, "en_attente")))
      .orderBy(desc(tasksTable.createdAt))
      .limit(5);

    for (const task of urgentTasks) {
      notifications.push({
        id: notifId++,
        type: "tache_urgente",
        title: "Tache urgente",
        description: task.title,
        isRead: false,
        relatedId: task.id,
        createdAt: task.createdAt.toISOString(),
      });
    }

    notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur notifications dashboard");
    res.status(500).json({ error: "Erreur lors de la recuperation des notifications." });
  }
});

router.get("/team-status", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const users = await db.execute(sql`
      SELECT id, CONCAT(prenom, ' ', nom) as name, role, 
        CASE 
          WHEN dernier_acces > NOW() - INTERVAL '15 minutes' THEN 'online'
          WHEN dernier_acces > NOW() - INTERVAL '1 hour' THEN 'busy'
          ELSE 'offline'
        END as status,
        COALESCE(dernier_acces, created_at) as last_seen
      FROM users 
      WHERE organisation_id = ${orgId} AND actif = true
      ORDER BY dernier_acces DESC NULLS LAST
      LIMIT 20
    `);
    res.json({ members: users.rows });
  } catch (err) {
    res.json({ members: [] });
  }
});

router.get("/dashboard/week-comparison", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  try {
    const thisWeekStart = getStartOfWeek();
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const thisWeekCalls = await db.execute(sql`
      SELECT EXTRACT(DOW FROM created_at) as dow, COUNT(*)::int as cnt
      FROM calls WHERE organisation_id = ${orgId} AND created_at >= ${thisWeekStart}
      GROUP BY dow ORDER BY dow
    `);

    const lastWeekCalls = await db.execute(sql`
      SELECT EXTRACT(DOW FROM created_at) as dow, COUNT(*)::int as cnt
      FROM calls WHERE organisation_id = ${orgId} 
        AND created_at >= ${lastWeekStart} AND created_at < ${thisWeekStart}
      GROUP BY dow ORDER BY dow
    `);

    const twMap: Record<number, number> = {};
    const lwMap: Record<number, number> = {};
    for (const r of thisWeekCalls.rows as any[]) twMap[r.dow] = r.cnt;
    for (const r of lastWeekCalls.rows as any[]) lwMap[r.dow] = r.cnt;

    const comparison = [1, 2, 3, 4, 5, 6, 0].map((dow, i) => ({
      day: DAYS_FR[i],
      thisWeek: twMap[dow] || 0,
      lastWeek: lwMap[dow] || 0,
    }));

    res.json({ comparison });
  } catch (err) {
    res.json({ comparison: [] });
  }
});

router.get("/dashboard/predictions", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const now = new Date();
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    const weeks: { start: Date; end: Date }[] = [];
    for (let i = 4; i >= 0; i--) {
      const end = new Date(now.getTime() - i * weekMs);
      const start = new Date(end.getTime() - weekMs);
      weeks.push({ start, end });
    }

    const weeklyData: { calls: number; tasks: number; contacts: number; revenue: number }[] = [];
    for (const w of weeks) {
      const [callsResult] = (await db.execute(sql`
        SELECT COUNT(*)::int as cnt FROM calls WHERE organisation_id = ${orgId} AND created_at >= ${w.start.toISOString()} AND created_at < ${w.end.toISOString()}
      `)).rows as any[];
      const [tasksResult] = (await db.execute(sql`
        SELECT COUNT(*)::int as cnt FROM tasks WHERE organisation_id = ${orgId} AND created_at >= ${w.start.toISOString()} AND created_at < ${w.end.toISOString()}
      `)).rows as any[];
      const [contactsResult] = (await db.execute(sql`
        SELECT COUNT(*)::int as cnt FROM contacts WHERE organisation_id = ${orgId} AND created_at >= ${w.start.toISOString()} AND created_at < ${w.end.toISOString()}
      `)).rows as any[];
      const [revenueResult] = (await db.execute(sql`
        SELECT COALESCE(SUM(total_amount), 0)::float as total FROM factures_client WHERE organisation_id = ${orgId} AND status = 'payee' AND created_at >= ${w.start.toISOString()} AND created_at < ${w.end.toISOString()}
      `)).rows as any[];

      weeklyData.push({
        calls: callsResult?.cnt || 0,
        tasks: tasksResult?.cnt || 0,
        contacts: contactsResult?.cnt || 0,
        revenue: revenueResult?.total || 0,
      });
    }

    const predict = (values: number[]) => {
      if (values.length < 2) return values[values.length - 1] || 0;
      const n = values.length;
      const xMean = (n - 1) / 2;
      const yMean = values.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - xMean) * (values[i] - yMean);
        den += (i - xMean) * (i - xMean);
      }
      const slope = den !== 0 ? num / den : 0;
      const intercept = yMean - slope * xMean;
      return Math.max(0, Math.round(slope * n + intercept));
    };

    const callTrend = weeklyData.map(w => w.calls);
    const taskTrend = weeklyData.map(w => w.tasks);
    const contactTrend = weeklyData.map(w => w.contacts);
    const revenueTrend = weeklyData.map(w => w.revenue);

    const predictions = {
      nextWeekCalls: predict(callTrend),
      nextWeekTasks: predict(taskTrend),
      nextWeekContacts: predict(contactTrend),
      nextWeekRevenue: Math.round(predict(revenueTrend) * 100) / 100,
      trends: {
        calls: callTrend,
        tasks: taskTrend,
        contacts: contactTrend,
        revenue: revenueTrend,
      },
      labels: weeks.map(w => {
        const d = new Date(w.end);
        return `${d.getDate()}/${d.getMonth() + 1}`;
      }),
    };

    const insights: string[] = [];
    const lastCalls = callTrend[callTrend.length - 1] || 0;
    const prevCalls = callTrend[callTrend.length - 2] || 0;
    if (lastCalls > prevCalls * 1.2) insights.push("Volume d'appels en forte hausse (+20%)");
    else if (lastCalls < prevCalls * 0.8) insights.push("Baisse du volume d'appels (-20%)");

    const lastRev = revenueTrend[revenueTrend.length - 1] || 0;
    const prevRev = revenueTrend[revenueTrend.length - 2] || 0;
    if (lastRev > prevRev) insights.push("Chiffre d'affaires en croissance");
    if (predictions.nextWeekCalls > lastCalls * 1.1) insights.push("Prevision: augmentation des appels la semaine prochaine");

    res.json({ predictions, insights });
  } catch (err) {
    res.json({ predictions: null, insights: [] });
  }
});

router.get("/dashboard/smart-pulse", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const now = new Date();
    const todayStart = getStartOfDay();
    const weekStart = getStartOfWeek();
    const monthStart = getStartOfMonth();
    const prevWeekStart = getPreviousWeekStart();
    const oc = eq(callsTable.organisationId, orgId);

    const [
      todayCalls, weekCalls, prevWeekCalls,
      todayMissed, weekMissed,
      todayTasks, overdueTasks, completedTasks,
      todayMessages, unreadMessages,
    ] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, todayStart))).then(r => Number(r[0]?.c ?? 0)),
      db.select({ c: sql<number>`count(*)` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, weekStart))).then(r => Number(r[0]?.c ?? 0)),
      db.select({ c: sql<number>`count(*)` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, prevWeekStart), lt(callsTable.createdAt, weekStart))).then(r => Number(r[0]?.c ?? 0)),
      db.select({ c: sql<number>`count(*)` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, todayStart), eq(callsTable.status, "missed"))).then(r => Number(r[0]?.c ?? 0)),
      db.select({ c: sql<number>`count(*)` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, weekStart), eq(callsTable.status, "missed"))).then(r => Number(r[0]?.c ?? 0)),
      db.select({ c: sql<number>`count(*)` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), gte(tasksTable.createdAt, todayStart))).then(r => Number(r[0]?.c ?? 0)),
      db.select({ c: sql<number>`count(*)` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "en_attente"), lt(tasksTable.dueDate, now))).then(r => Number(r[0]?.c ?? 0)),
      db.select({ c: sql<number>`count(*)` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, weekStart))).then(r => Number(r[0]?.c ?? 0)),
      db.select({ c: sql<number>`count(*)` }).from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), gte(messagesTable.createdAt, todayStart))).then(r => Number(r[0]?.c ?? 0)),
      db.execute(sql`SELECT count(*) as c FROM messages WHERE organisation_id = ${orgId} AND is_read = false`).then(r => Number((r as any).rows?.[0]?.c ?? 0)),
    ]);

    const missedRate = todayCalls > 0 ? Math.round((todayMissed / todayCalls) * 100) : 0;
    const weekGrowth = prevWeekCalls > 0 ? Math.round(((weekCalls - prevWeekCalls) / prevWeekCalls) * 100) : 0;

    const anomalies: Array<{ type: string; severity: "critique" | "alerte" | "attention" | "info"; title: string; description: string; metric?: number }> = [];

    if (missedRate > 40) anomalies.push({ type: "calls", severity: "critique", title: "Taux d'appels manques critique", description: `${missedRate}% des appels manques aujourd'hui. Risque de perte de clients.`, metric: missedRate });
    else if (missedRate > 25) anomalies.push({ type: "calls", severity: "alerte", title: "Appels manques eleves", description: `${missedRate}% des appels manques. Surveillez la capacite de l'equipe.`, metric: missedRate });

    if (overdueTasks > 5) anomalies.push({ type: "tasks", severity: "critique", title: "Retard critique des taches", description: `${overdueTasks} taches en retard. Productivite en danger.`, metric: overdueTasks });
    else if (overdueTasks > 2) anomalies.push({ type: "tasks", severity: "alerte", title: "Taches en retard", description: `${overdueTasks} taches depassent leur echeance.`, metric: overdueTasks });

    if (unreadMessages > 20) anomalies.push({ type: "messages", severity: "alerte", title: "Boite de reception saturee", description: `${unreadMessages} messages non lus. Risque de retard de reponse.`, metric: unreadMessages });

    if (weekGrowth < -30) anomalies.push({ type: "activity", severity: "alerte", title: "Chute d'activite", description: `Baisse de ${Math.abs(weekGrowth)}% par rapport a la semaine derniere.`, metric: weekGrowth });
    else if (weekGrowth > 50) anomalies.push({ type: "activity", severity: "info", title: "Pic d'activite", description: `Hausse de ${weekGrowth}% cette semaine. Verifiez la capacite.`, metric: weekGrowth });

    let healthScore = 100;
    anomalies.forEach(a => {
      if (a.severity === "critique") healthScore -= 20;
      else if (a.severity === "alerte") healthScore -= 10;
      else if (a.severity === "attention") healthScore -= 5;
    });
    healthScore = Math.max(0, Math.min(100, healthScore));

    const riskLevel = healthScore >= 80 ? "faible" : healthScore >= 50 ? "moyen" : "eleve";

    const recommendations: string[] = [];
    if (missedRate > 20) recommendations.push("Augmenter le personnel aux heures de pointe pour reduire les appels manques");
    if (overdueTasks > 0) recommendations.push(`Prioriser les ${overdueTasks} taches en retard immediatement`);
    if (unreadMessages > 10) recommendations.push("Traiter les messages non lus pour maintenir la reactivite client");
    if (recommendations.length === 0) recommendations.push("Excellente performance ! Continuez ainsi.");

    const hourlyDistribution: number[] = [];
    try {
      const hourly = await db.select({
        h: sql<number>`extract(hour from ${callsTable.createdAt})`,
        c: sql<number>`count(*)`,
      }).from(callsTable).where(and(oc, gte(callsTable.createdAt, todayStart))).groupBy(sql`extract(hour from ${callsTable.createdAt})`);
      for (let i = 0; i < 24; i++) {
        const found = hourly.find((h: any) => Number(h.h) === i);
        hourlyDistribution.push(found ? Number(found.c) : 0);
      }
    } catch { for (let i = 0; i < 24; i++) hourlyDistribution.push(0); }

    const peakHour = hourlyDistribution.indexOf(Math.max(...hourlyDistribution));

    res.json({
      timestamp: now.toISOString(),
      healthScore,
      riskLevel,
      metrics: {
        todayCalls, weekCalls, prevWeekCalls, weekGrowth,
        todayMissed, weekMissed, missedRate,
        todayTasks, overdueTasks, completedTasks,
        todayMessages, unreadMessages,
        peakHour,
      },
      anomalies: anomalies.sort((a, b) => {
        const sev = { critique: 0, alerte: 1, attention: 2, info: 3 };
        return sev[a.severity] - sev[b.severity];
      }),
      recommendations,
      hourlyDistribution,
    });
  } catch (err) {
    logger.error({ err: err }, "[SmartPulse] error:");
    res.status(500).json({ error: "Erreur smart pulse" });
  }
});

router.get("/dashboard/anomaly-stream", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last1h = new Date(now.getTime() - 60 * 60 * 1000);
    const oc = eq(callsTable.organisationId, orgId);

    const [recentMissed, recentTotal, hourlyMissed, hourlyTotal, repeatedCallers] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, last1h), eq(callsTable.status, "missed"))).then(r => Number(r[0]?.c ?? 0)),
      db.select({ c: sql<number>`count(*)` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, last1h))).then(r => Number(r[0]?.c ?? 0)),
      db.select({ c: sql<number>`count(*)` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, last24h), eq(callsTable.status, "missed"))).then(r => Number(r[0]?.c ?? 0)),
      db.select({ c: sql<number>`count(*)` }).from(callsTable).where(and(oc, gte(callsTable.createdAt, last24h))).then(r => Number(r[0]?.c ?? 0)),
      db.execute(sql`
        SELECT phone_number, count(*) as cnt, max(contact_name) as name 
        FROM calls 
        WHERE organisation_id = ${orgId} 
          AND status = 'missed' 
          AND created_at >= ${last24h}
          AND phone_number IS NOT NULL
        GROUP BY phone_number 
        HAVING count(*) >= 2 
        ORDER BY cnt DESC 
        LIMIT 5
      `).then(r => (r as any).rows ?? []),
    ]);

    const alerts: Array<{ id: string; type: string; severity: string; title: string; description: string; action?: string; timestamp: string }> = [];
    const ts = now.toISOString();

    if (recentTotal > 0 && (recentMissed / recentTotal) > 0.5) {
      alerts.push({ id: "burst-missed", type: "call_burst", severity: "critique", title: "Rafale d'appels manques!", description: `${recentMissed}/${recentTotal} appels manques dans la derniere heure`, action: "Renforcez l'equipe immediatement", timestamp: ts });
    }

    for (const caller of repeatedCallers) {
      alerts.push({ id: `repeat-${caller.phone_number}`, type: "repeated_caller", severity: "alerte", title: `${caller.name || caller.phone_number} insiste`, description: `${caller.cnt} appels manques en 24h. Client potentiellement frustre.`, action: `Rappeler ${caller.phone_number} en priorite`, timestamp: ts });
    }

    const overdueUrgent = await db.execute(sql`
      SELECT count(*) as c, string_agg(title, ', ') as titles
      FROM (SELECT title FROM tasks WHERE organisation_id = ${orgId} AND priority = 'haute' AND status = 'en_attente' AND due_date < ${now} ORDER BY due_date LIMIT 3) sub
    `).then(r => ({ count: Number((r as any).rows?.[0]?.c ?? 0), titles: (r as any).rows?.[0]?.titles || "" }));

    if (overdueUrgent.count > 0) {
      alerts.push({ id: "urgent-overdue", type: "task_overdue", severity: "critique", title: `${overdueUrgent.count} tache(s) urgente(s) en retard`, description: overdueUrgent.titles || "Taches haute priorite non terminees", action: "Traiter immediatement", timestamp: ts });
    }

    const bigInvoices = await db.execute(sql`
      SELECT reference, total_amount, client_name, due_date 
      FROM factures_client 
      WHERE organisation_id = ${orgId} 
        AND status = 'en_retard' 
        AND total_amount > 1000 
      ORDER BY total_amount DESC 
      LIMIT 3
    `).then(r => (r as any).rows ?? []);

    for (const inv of bigInvoices) {
      alerts.push({ id: `invoice-${inv.reference}`, type: "invoice_critical", severity: "alerte", title: `Facture ${inv.reference} impayee`, description: `${Number(inv.total_amount).toLocaleString("fr-FR")} EUR - ${inv.client_name || "Client"}`, action: "Relancer le client", timestamp: ts });
    }

    res.json({
      alerts: alerts.sort((a, b) => {
        const sev: Record<string, number> = { critique: 0, alerte: 1, attention: 2, info: 3 };
        return (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3);
      }),
      summary: {
        critical: alerts.filter(a => a.severity === "critique").length,
        warning: alerts.filter(a => a.severity === "alerte").length,
        total: alerts.length,
      },
    });
  } catch (err) {
    logger.error({ err: err }, "[AnomalyStream] error:");
    res.json({ alerts: [], summary: { critical: 0, warning: 0, total: 0 } });
  }
});

export default router;
