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
    db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(gte(callsTable.createdAt, todayStart)),
    db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(gte(callsTable.createdAt, todayStart), eq(callsTable.status, "repondu"))),
    db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(gte(callsTable.createdAt, todayStart), eq(callsTable.status, "manque"))),
    db.select({ avg: sql<number>`coalesce(avg(${callsTable.duration}), 0)::float` }).from(callsTable),
    db.select({ count: sql<number>`count(*)::int` }).from(contactsTable),
    db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(eq(tasksTable.status, "en_attente")),
    db.select({ count: sql<number>`count(*)::int` }).from(messagesTable).where(eq(messagesTable.isRead, false)),
    db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(gte(callsTable.createdAt, weekStart)),
    db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(gte(callsTable.createdAt, prevWeekStart), sql`${callsTable.createdAt} < ${weekStart}`)),
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

export default router;
