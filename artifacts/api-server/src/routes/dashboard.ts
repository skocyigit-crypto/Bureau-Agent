import { Router, type IRouter } from "express";
import { eq, sql, desc, gte, and } from "drizzle-orm";
import { db, callsTable, contactsTable, tasksTable, messagesTable } from "@workspace/db";
import {
  GetCallAnalyticsQueryParams,
  GetRecentActivityQueryParams,
  GetTopContactsQueryParams,
} from "@workspace/api-zod";

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

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const todayStart = getStartOfDay();
  const weekStart = getStartOfWeek();
  const prevWeekStart = getPreviousWeekStart();

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
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(gte(callsTable.createdAt, todayStart)), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(gte(callsTable.createdAt, todayStart), eq(callsTable.status, "repondu"))), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(gte(callsTable.createdAt, todayStart), eq(callsTable.status, "manque"))), defaultCount),
    safeQuery(db.select({ avg: sql<number>`coalesce(avg(${callsTable.duration}), 0)::float` }).from(callsTable), defaultAvg),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(contactsTable), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(eq(tasksTable.status, "en_attente")), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(messagesTable).where(eq(messagesTable.isRead, false)), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(gte(callsTable.createdAt, weekStart)), defaultCount),
    safeQuery(db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(gte(callsTable.createdAt, prevWeekStart), sql`${callsTable.createdAt} < ${weekStart}`)), defaultCount),
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

  const dataPoints = await db
    .select({
      label: sql<string>`${groupExpr}`,
      answered: sql<number>`count(*) filter (where ${callsTable.status} = 'repondu')::int`,
      missed: sql<number>`count(*) filter (where ${callsTable.status} = 'manque')::int`,
      voicemail: sql<number>`count(*) filter (where ${callsTable.status} = 'messagerie')::int`,
      avgDuration: sql<number>`coalesce(avg(${callsTable.duration}), 0)::float`,
    })
    .from(callsTable)
    .where(gte(callsTable.createdAt, startDate))
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
    .where(gte(callsTable.createdAt, startDate));

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
});

router.get("/dashboard/recent-activity", async (req, res): Promise<void> => {
  const query = GetRecentActivityQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const limit = query.data.limit ?? 20;

  const [recentCalls, recentTasks, recentMessages] = await Promise.all([
    db.select().from(callsTable).orderBy(desc(callsTable.createdAt)).limit(limit),
    db.select().from(tasksTable).orderBy(desc(tasksTable.createdAt)).limit(limit),
    db.select().from(messagesTable).orderBy(desc(messagesTable.createdAt)).limit(limit),
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
});

router.get("/dashboard/call-distribution", async (_req, res): Promise<void> => {
  const total = await db.select({ count: sql<number>`count(*)::int` }).from(callsTable);
  const totalCount = total[0]?.count ?? 0;

  const byStatus = await db
    .select({
      status: callsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(callsTable)
    .groupBy(callsTable.status);

  const byDirection = await db
    .select({
      direction: callsTable.direction,
      count: sql<number>`count(*)::int`,
    })
    .from(callsTable)
    .groupBy(callsTable.direction);

  const bySentiment = await db
    .select({
      sentiment: sql<string>`coalesce(${callsTable.sentiment}, 'inconnu')`,
      count: sql<number>`count(*)::int`,
    })
    .from(callsTable)
    .groupBy(sql`coalesce(${callsTable.sentiment}, 'inconnu')`);

  res.json({
    byStatus: byStatus.map((s) => ({
      status: s.status,
      count: s.count,
      percentage: totalCount > 0 ? Math.round((s.count / totalCount) * 1000) / 10 : 0,
    })),
    byDirection: byDirection.map((d) => ({
      direction: d.direction,
      count: d.count,
      percentage: totalCount > 0 ? Math.round((d.count / totalCount) * 1000) / 10 : 0,
    })),
    bySentiment: bySentiment.map((s) => ({
      sentiment: s.sentiment,
      count: s.count,
      percentage: totalCount > 0 ? Math.round((s.count / totalCount) * 1000) / 10 : 0,
    })),
  });
});

router.get("/dashboard/top-contacts", async (req, res): Promise<void> => {
  const query = GetTopContactsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const limit = query.data.limit ?? 5;

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
    .orderBy(desc(contactsTable.totalCalls))
    .limit(limit);

  res.json({ contacts });
});

router.get("/dashboard/hourly-performance", async (_req, res): Promise<void> => {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const result = await db
      .select({
        total: sql<number>`count(*)::int`,
        answered: sql<number>`count(*) filter (where ${callsTable.status} = 'repondu')::int`,
        missed: sql<number>`count(*) filter (where ${callsTable.status} = 'manque')::int`,
      })
      .from(callsTable)
      .where(sql`extract(hour from ${callsTable.createdAt}) = ${h}`);

    hours.push({
      hour: h,
      total: result[0]?.total ?? 0,
      answered: result[0]?.answered ?? 0,
      missed: result[0]?.missed ?? 0,
    });
  }

  res.json({ hours });
});

router.get("/dashboard/task-stats", async (_req, res): Promise<void> => {
  const now = new Date();

  const [total, completed, inProgress, pending, cancelled, overdue, highPriority, byPriority] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(tasksTable),
    db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(eq(tasksTable.status, "termine")),
    db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(eq(tasksTable.status, "en_cours")),
    db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(eq(tasksTable.status, "en_attente")),
    db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(eq(tasksTable.status, "annule")),
    db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(
      and(
        sql`${tasksTable.status} != 'termine'`,
        sql`${tasksTable.status} != 'annule'`,
        sql`${tasksTable.dueDate} < ${now}`
      )
    ),
    db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(
      and(eq(tasksTable.priority, "haute"), sql`${tasksTable.status} != 'termine'`, sql`${tasksTable.status} != 'annule'`)
    ),
    db.select({ priority: tasksTable.priority, count: sql<number>`count(*)::int` }).from(tasksTable).groupBy(tasksTable.priority),
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
});

router.get("/dashboard/weekly-report", async (_req, res): Promise<void> => {
  const weekStart = getStartOfWeek();
  const prevWeekStart = getPreviousWeekStart();
  const prevWeekEnd = weekStart;

  const [
    thisWeekCalls,
    thisWeekAnswered,
    thisWeekMissed,
    thisWeekDuration,
    prevWeekCalls,
    prevWeekAnswered,
    prevWeekDuration,
    newContacts,
    completedTasks,
    messagesReceived,
    peakHourResult,
    peakDayResult,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(gte(callsTable.createdAt, weekStart)),
    db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(gte(callsTable.createdAt, weekStart), eq(callsTable.status, "repondu"))),
    db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(gte(callsTable.createdAt, weekStart), eq(callsTable.status, "manque"))),
    db.select({ avg: sql<number>`coalesce(avg(${callsTable.duration}), 0)::float` }).from(callsTable).where(gte(callsTable.createdAt, weekStart)),
    db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(gte(callsTable.createdAt, prevWeekStart), sql`${callsTable.createdAt} < ${prevWeekEnd}`)),
    db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(gte(callsTable.createdAt, prevWeekStart), sql`${callsTable.createdAt} < ${prevWeekEnd}`, eq(callsTable.status, "repondu"))),
    db.select({ avg: sql<number>`coalesce(avg(${callsTable.duration}), 0)::float` }).from(callsTable).where(and(gte(callsTable.createdAt, prevWeekStart), sql`${callsTable.createdAt} < ${prevWeekEnd}`)),
    db.select({ count: sql<number>`count(*)::int` }).from(contactsTable).where(gte(contactsTable.createdAt, weekStart)),
    db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(gte(tasksTable.updatedAt, weekStart), eq(tasksTable.status, "termine"))),
    db.select({ count: sql<number>`count(*)::int` }).from(messagesTable).where(gte(messagesTable.createdAt, weekStart)),
    db.select({ hour: sql<number>`extract(hour from ${callsTable.createdAt})::int`, count: sql<number>`count(*)::int` }).from(callsTable).where(gte(callsTable.createdAt, weekStart)).groupBy(sql`extract(hour from ${callsTable.createdAt})`).orderBy(sql`count(*) desc`).limit(1),
    db.select({ day: sql<string>`to_char(${callsTable.createdAt}, 'Dy')`, count: sql<number>`count(*)::int` }).from(callsTable).where(gte(callsTable.createdAt, weekStart)).groupBy(sql`to_char(${callsTable.createdAt}, 'Dy')`).orderBy(sql`count(*) desc`).limit(1),
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
});

router.get("/dashboard/notifications", async (_req, res): Promise<void> => {
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

  const missedCalls = await db.select().from(callsTable)
    .where(eq(callsTable.status, "manque"))
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
    .where(eq(messagesTable.isRead, false))
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
    .where(and(eq(tasksTable.priority, "haute"), eq(tasksTable.status, "en_attente")))
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
});

export default router;
