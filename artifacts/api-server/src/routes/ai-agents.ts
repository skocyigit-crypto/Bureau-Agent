import { Router } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, checkinsTable, aiAgentReportsTable, stockArticlesTable, invoicesTable, paymentsTable, subscriptionsTable, usersTable, automationRulesTable, notificationsTable, auditLogsTable, calendarEventsTable } from "@workspace/db";
import { sql, eq, gte, lte, and, count, desc, lt, ne, isNull, isNotNull, or, sum, avg } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";

const router = Router();

const requireAdmin = requireRole("super_admin", "administrateur");
const requireMinAgent = requireRole("super_admin", "administrateur", "agent");

const AGENTS = [
  { id: "agent_appels", name: "Agent Appels", icon: "phone", domain: "Gestion des appels telephoniques et suivi client" },
  { id: "agent_contacts", name: "Agent CRM", icon: "users", domain: "Gestion CRM, contacts et relations commerciales" },
  { id: "agent_taches", name: "Agent Productivite", icon: "clipboard", domain: "Gestion des taches, projets et productivite" },
  { id: "agent_messages", name: "Agent Communication", icon: "mail", domain: "Gestion des messages, notifications et flux de communication" },
  { id: "agent_pointage", name: "Agent Presences", icon: "clock", domain: "Gestion du temps, presences et planification RH" },
  { id: "agent_facturation", name: "Agent Facturation", icon: "receipt", domain: "Facturation, paiements, abonnements et tresorerie" },
  { id: "agent_stock", name: "Agent Stock", icon: "package", domain: "Gestion des stocks, inventaire et approvisionnement" },
  { id: "agent_rh", name: "Agent RH", icon: "user-cog", domain: "Ressources humaines, comptes employes et conformite" },
  { id: "agent_securite", name: "Agent Securite", icon: "shield", domain: "Securite, audit, conformite RGPD et tracabilite" },
  { id: "agent_performance", name: "Agent Performance", icon: "trending-up", domain: "Performance globale, KPIs strategiques et benchmarks" },
];

async function gatherAgentData(agentId: string, orgId: number) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const orgCall = eq(callsTable.organisationId, orgId);
  const orgContact = eq(contactsTable.organisationId, orgId);
  const orgTask = eq(tasksTable.organisationId, orgId);
  const orgMsg = eq(messagesTable.organisationId, orgId);
  const orgCheckin = eq(checkinsTable.organisationId, orgId);

  switch (agentId) {
    case "agent_appels": {
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const [total, missed, answered, avgDuration, noContact, negativeSentiment, noNotes, longCalls, recentCalls, incomingCalls, outgoingCalls, positiveSentiment, shortCalls, todayCalls, callsByDirection,
        prevTotal, prevMissed, prevAnswered, prevNegSentiment, prevAvgDuration,
        bySentiment, byHour, repeatedCallers
      ] = await Promise.all([
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
        db.select({ avg: sql<number>`coalesce(avg(${callsTable.duration}), 0)::int` }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo), eq(callsTable.status, "repondu"))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.contactId))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.notes), gte(callsTable.createdAt, weekAgo), eq(callsTable.status, "repondu"))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.duration, 600), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, monthAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.direction, "entrant"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.direction, "sortant"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.sentiment, "positif"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, lt(callsTable.duration, 30), eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayAgo))),
        db.select({ direction: callsTable.direction, cnt: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))).groupBy(callsTable.direction),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "repondu"), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
        db.select({ avg: sql<number>`coalesce(avg(${callsTable.duration}), 0)::int` }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo), eq(callsTable.status, "repondu"))),
        db.select({ sentiment: callsTable.sentiment, cnt: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))).groupBy(callsTable.sentiment),
        db.select({ hour: sql<number>`extract(hour from ${callsTable.createdAt})::int`, cnt: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))).groupBy(sql`extract(hour from ${callsTable.createdAt})`),
        db.select({ phone: callsTable.phoneNumber, cnt: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo), eq(callsTable.status, "manque"))).groupBy(callsTable.phoneNumber).having(sql`count(*) >= 2`),
      ]);
      const totalW = total[0]?.count ?? 0;
      const answeredW = answered[0]?.count ?? 0;
      const missedW = missed[0]?.count ?? 0;
      const prevTotalW = prevTotal[0]?.count ?? 0;
      const prevAnsweredW = prevAnswered[0]?.count ?? 0;
      const prevMissedW = prevMissed[0]?.count ?? 0;
      const prevAnswerRate = prevTotalW ? Math.round((prevAnsweredW / prevTotalW) * 100) : 0;
      const currentAnswerRate = totalW ? Math.round((answeredW / totalW) * 100) : 0;
      return {
        thisWeek: { total: totalW, missed: missedW, answered: answeredW, avgDurationSeconds: avgDuration[0]?.avg ?? 0, negativeSentiment: negativeSentiment[0]?.count ?? 0, positiveSentiment: positiveSentiment[0]?.count ?? 0, answeredWithoutNotes: noNotes[0]?.count ?? 0, longCallsOver10min: longCalls[0]?.count ?? 0, shortCallsUnder30s: shortCalls[0]?.count ?? 0, incoming: incomingCalls[0]?.count ?? 0, outgoing: outgoingCalls[0]?.count ?? 0 },
        prevWeek: { total: prevTotalW, missed: prevMissedW, answered: prevAnsweredW, negativeSentiment: prevNegSentiment[0]?.count ?? 0, avgDurationSeconds: prevAvgDuration[0]?.avg ?? 0 },
        trends: {
          volumeChange: prevTotalW ? Math.round(((totalW - prevTotalW) / prevTotalW) * 100) : 0,
          answerRateChange: prevAnswerRate ? currentAnswerRate - prevAnswerRate : 0,
          sentimentChange: (prevNegSentiment[0]?.count ?? 0) > 0 ? Math.round((((negativeSentiment[0]?.count ?? 0) - (prevNegSentiment[0]?.count ?? 0)) / (prevNegSentiment[0]?.count ?? 1)) * 100) : 0,
        },
        patterns: {
          repeatedMissedCallers: repeatedCallers.length,
          peakHours: byHour.sort((a, b) => b.cnt - a.cnt).slice(0, 3).map(h => ({ hour: h.hour, calls: h.cnt })),
          sentimentBreakdown: bySentiment.map(s => ({ sentiment: s.sentiment || "non_evalue", count: s.cnt })),
        },
        callsWithoutContact: noContact[0]?.count ?? 0, totalThisMonth: recentCalls[0]?.count ?? 0, todayCalls: todayCalls[0]?.count ?? 0,
        rates: { answer: currentAnswerRate, miss: totalW ? Math.round((missedW / totalW) * 100) : 0, documentation: answeredW ? Math.round(((answeredW - (noNotes[0]?.count ?? 0)) / answeredW) * 100) : 0, sentiment: answeredW ? Math.round(((positiveSentiment[0]?.count ?? 0) / answeredW) * 100) : 0 },
        avgCallsPerDay: Math.round(totalW / 7),
      };
    }
    case "agent_contacts": {
      const [total, noEmail, noPhone, noCompany, duplicatePhones, inactiveContacts, newContacts, byCategory, withNotes, highCallers,
        prevNewContacts, contactsWithCalls, contactsWithTasks, byCompany
      ] = await Promise.all([
        db.select({ count: count() }).from(contactsTable).where(orgContact),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.email))),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.phone))),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.company))),
        db.select({ phone: contactsTable.phone, cnt: count() }).from(contactsTable).where(and(orgContact, isNotNull(contactsTable.phone))).groupBy(contactsTable.phone).having(sql`count(*) > 1`),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, sql`${contactsTable.id} NOT IN (SELECT DISTINCT contact_id FROM calls WHERE contact_id IS NOT NULL AND organisation_id = ${orgId} AND created_at >= ${monthAgo.toISOString()})`)),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, gte(contactsTable.createdAt, weekAgo))),
        db.select({ category: contactsTable.category, cnt: count() }).from(contactsTable).where(orgContact).groupBy(contactsTable.category),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNotNull(contactsTable.notes))),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, gte(contactsTable.totalCalls, 5))),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, gte(contactsTable.createdAt, twoWeeksAgo), lt(contactsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, sql`${contactsTable.id} IN (SELECT DISTINCT contact_id FROM calls WHERE contact_id IS NOT NULL AND organisation_id = ${orgId} AND created_at >= ${weekAgo.toISOString()})`)),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, sql`${contactsTable.id} IN (SELECT DISTINCT related_contact_id FROM tasks WHERE related_contact_id IS NOT NULL AND organisation_id = ${orgId})`)),
        db.select({ company: contactsTable.company, cnt: count() }).from(contactsTable).where(and(orgContact, isNotNull(contactsTable.company))).groupBy(contactsTable.company).having(sql`count(*) >= 2`),
      ]);
      const totalC = total[0]?.count ?? 0;
      const noE = noEmail[0]?.count ?? 0;
      const noP = noPhone[0]?.count ?? 0;
      const newW = newContacts[0]?.count ?? 0;
      const prevNewW = prevNewContacts[0]?.count ?? 0;
      return {
        thisWeek: { newContacts: newW, contactsWithRecentCalls: contactsWithCalls[0]?.count ?? 0 },
        prevWeek: { newContacts: prevNewW },
        trends: { newContactsChange: prevNewW ? Math.round(((newW - prevNewW) / prevNewW) * 100) : 0, growthRate: totalC ? Math.round((newW / totalC) * 100) : 0 },
        patterns: { topCompanies: byCompany.slice(0, 5).map(c => ({ company: c.company, contacts: c.cnt })), contactsLinkedToTasks: contactsWithTasks[0]?.count ?? 0, orphanContactRate: totalC ? Math.round(((inactiveContacts[0]?.count ?? 0) / totalC) * 100) : 0 },
        totalContacts: totalC, withoutEmail: noE, withoutPhone: noP,
        withoutCompany: noCompany[0]?.count ?? 0, duplicatePhoneNumbers: duplicatePhones.length,
        inactiveOver30Days: inactiveContacts[0]?.count ?? 0,
        contactsWithNotes: withNotes[0]?.count ?? 0,
        highValueContacts: highCallers[0]?.count ?? 0,
        categoryBreakdown: byCategory.map(c => ({ category: c.category, count: c.cnt })),
        rates: { dataCompleteness: totalC ? Math.round(((totalC - noE - noP) / (totalC * 2)) * 100) : 0, email: totalC ? Math.round(((totalC - noE) / totalC) * 100) : 0, phone: totalC ? Math.round(((totalC - noP) / totalC) * 100) : 0, enrichment: totalC ? Math.round(((withNotes[0]?.count ?? 0) / totalC) * 100) : 0 },
      };
    }
    case "agent_taches": {
      const [total, pending, inProgress, completed, cancelled, overdue, highPriority, unassigned, completedThisWeek,
        prevCompletedWeek, createdThisWeek, prevCreatedWeek, byPriority, avgCompletionDays
      ] = await Promise.all([
        db.select({ count: count() }).from(tasksTable).where(orgTask),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "en_attente"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "en_cours"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "annule"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.priority, "haute"), ne(tasksTable.status, "termine"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, isNull(tasksTable.assignedTo), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, weekAgo))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, twoWeeksAgo), lt(tasksTable.updatedAt, weekAgo))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, gte(tasksTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, gte(tasksTable.createdAt, twoWeeksAgo), lt(tasksTable.createdAt, weekAgo))),
        db.select({ priority: tasksTable.priority, cnt: count() }).from(tasksTable).where(and(orgTask, ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))).groupBy(tasksTable.priority),
        db.select({ avg: sql<number>`coalesce(avg(extract(epoch from (${tasksTable.updatedAt} - ${tasksTable.createdAt})) / 86400), 0)::int` }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, monthAgo))),
      ]);
      const compW = completedThisWeek[0]?.count ?? 0;
      const prevCompW = prevCompletedWeek[0]?.count ?? 0;
      const crW = createdThisWeek[0]?.count ?? 0;
      const prevCrW = prevCreatedWeek[0]?.count ?? 0;
      return {
        thisWeek: { completed: compW, created: crW },
        prevWeek: { completed: prevCompW, created: prevCrW },
        trends: { completionChange: prevCompW ? Math.round(((compW - prevCompW) / prevCompW) * 100) : 0, creationChange: prevCrW ? Math.round(((crW - prevCrW) / prevCrW) * 100) : 0, velocity: crW > 0 ? Math.round((compW / crW) * 100) : 0 },
        patterns: { avgCompletionDays: avgCompletionDays[0]?.avg ?? 0, priorityBreakdown: byPriority.map(p => ({ priority: p.priority, count: p.cnt })), overdueRatio: (total[0]?.count ?? 0) > 0 ? Math.round(((overdue[0]?.count ?? 0) / (total[0]?.count ?? 1)) * 100) : 0, backlogGrowth: crW - compW },
        totalTasks: total[0]?.count ?? 0, pending: pending[0]?.count ?? 0, inProgress: inProgress[0]?.count ?? 0,
        completed: completed[0]?.count ?? 0, cancelled: cancelled[0]?.count ?? 0, overdue: overdue[0]?.count ?? 0,
        highPriorityOpen: highPriority[0]?.count ?? 0, unassigned: unassigned[0]?.count ?? 0,
        completionRate: total[0]?.count ? Math.round(((completed[0]?.count ?? 0) / total[0].count) * 100) : 0,
      };
    }
    case "agent_messages": {
      const [total, unread, highPriorityUnread, oldUnread, byType,
        totalThisWeek, totalPrevWeek, unreadPrevWeek, byDay
      ] = await Promise.all([
        db.select({ count: count() }).from(messagesTable).where(orgMsg),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false), eq(messagesTable.priority, "haute"))),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false), lt(messagesTable.createdAt, new Date(now.getTime() - 48 * 60 * 60 * 1000)))),
        db.select({ type: messagesTable.type, cnt: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))).groupBy(messagesTable.type),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, gte(messagesTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, gte(messagesTable.createdAt, twoWeeksAgo), lt(messagesTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false), gte(messagesTable.createdAt, twoWeeksAgo), lt(messagesTable.createdAt, weekAgo))),
        db.select({ day: sql<string>`to_char(${messagesTable.createdAt}, 'Dy')`, cnt: count() }).from(messagesTable).where(and(orgMsg, gte(messagesTable.createdAt, weekAgo))).groupBy(sql`to_char(${messagesTable.createdAt}, 'Dy')`),
      ]);
      const tW = totalThisWeek[0]?.count ?? 0;
      const pW = totalPrevWeek[0]?.count ?? 0;
      const unreadThisWeekOnly = (unread[0]?.count ?? 0);
      const unreadPrevWeekOnly = (unreadPrevWeek[0]?.count ?? 0);
      return {
        thisWeek: { received: tW, currentUnreadTotal: unreadThisWeekOnly },
        prevWeek: { received: pW, unreadAtThatTime: unreadPrevWeekOnly },
        trends: { volumeChange: pW ? Math.round(((tW - pW) / pW) * 100) : 0 },
        patterns: { busiestDays: byDay.sort((a, b) => b.cnt - a.cnt).slice(0, 3).map(d => ({ day: d.day, count: d.cnt })), staleRatio: (unread[0]?.count ?? 0) > 0 ? Math.round(((oldUnread[0]?.count ?? 0) / (unread[0]?.count ?? 1)) * 100) : 0 },
        totalMessages: total[0]?.count ?? 0, unreadCount: unread[0]?.count ?? 0,
        urgentUnread: highPriorityUnread[0]?.count ?? 0, staleUnreadOver48h: oldUnread[0]?.count ?? 0,
        unreadByType: byType.map(t => ({ type: t.type, count: t.cnt })),
        readRate: total[0]?.count ? Math.round((((total[0]?.count ?? 0) - (unread[0]?.count ?? 0)) / (total[0]?.count || 1)) * 100) : 0,
      };
    }
    case "agent_pointage": {
      const [totalSessions, activeSessions, avgMinutes, lateArrivals, bureauCount, distanceCount, terrainCount, totalBreak,
        prevSessions, prevLateArrivals, prevAvgMinutes, byDayOfWeek
      ] = await Promise.all([
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, or(eq(checkinsTable.status, "present"), eq(checkinsTable.status, "en_pause")))),
        db.select({ avg: sql<number>`coalesce(avg(${checkinsTable.totalMinutes}), 0)::int` }).from(checkinsTable).where(and(orgCheckin, eq(checkinsTable.status, "termine"), gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo), sql`extract(hour from ${checkinsTable.checkInAt}) >= 10`)),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, eq(checkinsTable.type, "bureau"), gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, eq(checkinsTable.type, "distance"), gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, eq(checkinsTable.type, "terrain"), gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ total: sql<number>`coalesce(sum(${checkinsTable.breakMinutes}), 0)::int` }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, twoWeeksAgo), lt(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, twoWeeksAgo), lt(checkinsTable.checkInAt, weekAgo), sql`extract(hour from ${checkinsTable.checkInAt}) >= 10`)),
        db.select({ avg: sql<number>`coalesce(avg(${checkinsTable.totalMinutes}), 0)::int` }).from(checkinsTable).where(and(orgCheckin, eq(checkinsTable.status, "termine"), gte(checkinsTable.checkInAt, twoWeeksAgo), lt(checkinsTable.checkInAt, weekAgo))),
        db.select({ day: sql<string>`to_char(${checkinsTable.checkInAt}, 'Dy')`, cnt: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo))).groupBy(sql`to_char(${checkinsTable.checkInAt}, 'Dy')`),
      ]);
      const sessW = totalSessions[0]?.count ?? 0;
      const prevSessW = prevSessions[0]?.count ?? 0;
      const lateW = lateArrivals[0]?.count ?? 0;
      const prevLateW = prevLateArrivals[0]?.count ?? 0;
      return {
        thisWeek: { sessions: sessW, lateArrivals: lateW, avgMinutes: avgMinutes[0]?.avg ?? 0 },
        prevWeek: { sessions: prevSessW, lateArrivals: prevLateW, avgMinutes: prevAvgMinutes[0]?.avg ?? 0 },
        trends: { sessionsChange: prevSessW ? Math.round(((sessW - prevSessW) / prevSessW) * 100) : 0, lateChange: prevLateW ? Math.round(((lateW - prevLateW) / prevLateW) * 100) : 0 },
        patterns: { busiestDays: byDayOfWeek.sort((a, b) => b.cnt - a.cnt).slice(0, 3).map(d => ({ day: d.day, sessions: d.cnt })), workTypeDistribution: { bureau: bureauCount[0]?.count ?? 0, distance: distanceCount[0]?.count ?? 0, terrain: terrainCount[0]?.count ?? 0 }, avgBreakPerSession: sessW ? Math.round((totalBreak[0]?.total ?? 0) / sessW) : 0 },
        currentlyActive: activeSessions[0]?.count ?? 0,
        totalBreakMinutes: totalBreak[0]?.total ?? 0,
      };
    }
    case "agent_facturation": {
      const orgInv = eq(invoicesTable.organisationId, orgId);
      const orgPay = eq(paymentsTable.organisationId, orgId);
      const [totalInvoices, unpaidInvoices, overdueInvoices, totalRevenue, totalPayments, matchedPayments, recentInvoices, subscription,
        unpaidTotal, overdueTotal, partialInvoices, invoicesThisWeek, invoicesPrevWeek, paymentsThisWeek
      ] = await Promise.all([
        db.select({ count: count() }).from(invoicesTable).where(orgInv),
        db.select({ count: count() }).from(invoicesTable).where(and(orgInv, sql`${invoicesTable.status} IN ('en_attente', 'retard', 'partiel')`)),
        db.select({ count: count() }).from(invoicesTable).where(and(orgInv, eq(invoicesTable.status, "retard"))),
        db.select({ total: sql<number>`coalesce(sum(${invoicesTable.totalAmount}), 0)::numeric` }).from(invoicesTable).where(and(orgInv, eq(invoicesTable.status, "payee"))),
        db.select({ count: count() }).from(paymentsTable).where(orgPay),
        db.select({ count: count() }).from(paymentsTable).where(and(orgPay, eq(paymentsTable.status, "matched"))),
        db.select({ count: count() }).from(invoicesTable).where(and(orgInv, gte(invoicesTable.createdAt, monthAgo))),
        db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)).limit(1),
        db.select({ total: sql<number>`coalesce(sum(${invoicesTable.totalAmount}), 0)::numeric` }).from(invoicesTable).where(and(orgInv, sql`${invoicesTable.status} IN ('en_attente', 'retard', 'partiel')`)),
        db.select({ total: sql<number>`coalesce(sum(${invoicesTable.totalAmount}), 0)::numeric` }).from(invoicesTable).where(and(orgInv, eq(invoicesTable.status, "retard"))),
        db.select({ count: count() }).from(invoicesTable).where(and(orgInv, eq(invoicesTable.status, "partiel"))),
        db.select({ count: count() }).from(invoicesTable).where(and(orgInv, gte(invoicesTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(invoicesTable).where(and(orgInv, gte(invoicesTable.createdAt, twoWeeksAgo), lt(invoicesTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(paymentsTable).where(and(orgPay, gte(paymentsTable.createdAt, weekAgo))),
      ]);
      const sub = subscription[0];
      const invW = invoicesThisWeek[0]?.count ?? 0;
      const prevInvW = invoicesPrevWeek[0]?.count ?? 0;
      return {
        thisWeek: { invoicesCreated: invW, paymentsReceived: paymentsThisWeek[0]?.count ?? 0 },
        prevWeek: { invoicesCreated: prevInvW },
        trends: { invoiceVolumeChange: prevInvW ? Math.round(((invW - prevInvW) / prevInvW) * 100) : 0 },
        patterns: { unpaidTotalAmount: unpaidTotal[0]?.total ?? 0, overdueTotalAmount: overdueTotal[0]?.total ?? 0, partialPayments: partialInvoices[0]?.count ?? 0, dsoEstimate: (totalInvoices[0]?.count ?? 0) > 0 ? Math.round(((unpaidInvoices[0]?.count ?? 0) / (totalInvoices[0]?.count ?? 1)) * 30) : 0 },
        totalInvoices: totalInvoices[0]?.count ?? 0,
        unpaidInvoices: unpaidInvoices[0]?.count ?? 0,
        overdueInvoices: overdueInvoices[0]?.count ?? 0,
        totalRevenuePaid: totalRevenue[0]?.total ?? 0,
        totalPayments: totalPayments[0]?.count ?? 0,
        matchedPayments: matchedPayments[0]?.count ?? 0,
        invoicesThisMonth: recentInvoices[0]?.count ?? 0,
        subscription: sub ? { plan: sub.plan, status: sub.status, price: sub.price, billingCycle: sub.billingCycle, trialEndsAt: sub.trialEndsAt, currentPeriodEnd: sub.currentPeriodEnd } : null,
        rates: { paymentMatch: (totalPayments[0]?.count ?? 0) > 0 ? Math.round(((matchedPayments[0]?.count ?? 0) / (totalPayments[0]?.count ?? 1)) * 100) : 0, collection: (totalInvoices[0]?.count ?? 0) > 0 ? Math.round((((totalInvoices[0]?.count ?? 0) - (unpaidInvoices[0]?.count ?? 0)) / (totalInvoices[0]?.count ?? 1)) * 100) : 0 },
      };
    }
    case "agent_stock": {
      const orgStock = eq(stockArticlesTable.organisationId, orgId);
      const [totalArticles, lowStock, outOfStock, totalValue, byCategory, recentArticles, noBarcode, noCategory,
        avgPrice, maxPrice, zeroPrice, prevNewArticles
      ] = await Promise.all([
        db.select({ count: count() }).from(stockArticlesTable).where(orgStock),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, sql`${stockArticlesTable.quantity} <= ${stockArticlesTable.minQuantity}`, sql`${stockArticlesTable.quantity} > 0`)),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, eq(stockArticlesTable.quantity, 0))),
        db.select({ total: sql<number>`coalesce(sum(${stockArticlesTable.quantity} * ${stockArticlesTable.unitPrice}), 0)::numeric` }).from(stockArticlesTable).where(orgStock),
        db.select({ category: stockArticlesTable.category, cnt: count() }).from(stockArticlesTable).where(orgStock).groupBy(stockArticlesTable.category),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, gte(stockArticlesTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, isNull(stockArticlesTable.barcode))),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, or(isNull(stockArticlesTable.category), eq(stockArticlesTable.category, "")))),
        db.select({ avg: sql<number>`coalesce(avg(${stockArticlesTable.unitPrice}), 0)::numeric` }).from(stockArticlesTable).where(orgStock),
        db.select({ max: sql<number>`coalesce(max(${stockArticlesTable.unitPrice}), 0)::numeric` }).from(stockArticlesTable).where(orgStock),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, sql`${stockArticlesTable.unitPrice} = 0`)),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, gte(stockArticlesTable.createdAt, twoWeeksAgo), lt(stockArticlesTable.createdAt, weekAgo))),
      ]);
      const totalA = totalArticles[0]?.count ?? 0;
      const lowS = lowStock[0]?.count ?? 0;
      const outS = outOfStock[0]?.count ?? 0;
      const newW = recentArticles[0]?.count ?? 0;
      const prevNewW = prevNewArticles[0]?.count ?? 0;
      return {
        thisWeek: { newArticles: newW, lowStock: lowS, outOfStock: outS },
        prevWeek: { newArticles: prevNewW },
        trends: { newArticlesChange: prevNewW ? Math.round(((newW - prevNewW) / prevNewW) * 100) : 0 },
        patterns: { criticalRate: totalA ? Math.round(((lowS + outS) / totalA) * 100) : 0, avgUnitPrice: avgPrice[0]?.avg ?? 0, maxUnitPrice: maxPrice[0]?.max ?? 0, zeroPriceArticles: zeroPrice[0]?.count ?? 0 },
        totalArticles: totalA,
        totalInventoryValue: totalValue[0]?.total ?? 0,
        categoryBreakdown: byCategory.map(c => ({ category: c.category || "Sans categorie", count: c.cnt })),
        articlesWithoutBarcode: noBarcode[0]?.count ?? 0,
        articlesWithoutCategory: noCategory[0]?.count ?? 0,
        rates: { stockHealth: totalA ? Math.round(((totalA - lowS - outS) / totalA) * 100) : 0, dataQuality: totalA ? Math.round(((totalA - (noBarcode[0]?.count ?? 0) - (noCategory[0]?.count ?? 0)) / totalA) * 100) : 0 },
      };
    }
    case "agent_rh": {
      const orgUser = eq(usersTable.organisationId, orgId);
      const [totalUsers, activeUsers, inactiveUsers, mfaEnabled, lockedAccounts, byRole, recentLogins, neverLoggedIn,
        prevRecentLogins, failedLoginUsers, totalCheckins, checkinsThisWeek
      ] = await Promise.all([
        db.select({ count: count() }).from(usersTable).where(orgUser),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, eq(usersTable.actif, true))),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, eq(usersTable.actif, false))),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, eq(usersTable.mfaActif, true))),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, isNotNull(usersTable.verrouilleJusqua), gte(usersTable.verrouilleJusqua, now))),
        db.select({ role: usersTable.role, cnt: count() }).from(usersTable).where(orgUser).groupBy(usersTable.role),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, isNotNull(usersTable.dernierAcces), gte(usersTable.dernierAcces, weekAgo))),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, isNull(usersTable.dernierAcces))),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, isNotNull(usersTable.dernierAcces), gte(usersTable.dernierAcces, twoWeeksAgo), lt(usersTable.dernierAcces, weekAgo))),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, sql`${usersTable.tentativesEchouees} > 0`)),
        db.select({ count: count() }).from(checkinsTable).where(orgCheckin),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo))),
      ]);
      const totalU = totalUsers[0]?.count ?? 0;
      const activeU = activeUsers[0]?.count ?? 0;
      const loginW = recentLogins[0]?.count ?? 0;
      const prevLoginW = prevRecentLogins[0]?.count ?? 0;
      return {
        thisWeek: { activeLogins: loginW, checkins: checkinsThisWeek[0]?.count ?? 0 },
        prevWeek: { activeLogins: prevLoginW },
        trends: { activityChange: prevLoginW ? Math.round(((loginW - prevLoginW) / prevLoginW) * 100) : 0 },
        patterns: { failedLoginUsers: failedLoginUsers[0]?.count ?? 0, totalCheckinHistory: totalCheckins[0]?.count ?? 0, ghostAccountRate: totalU ? Math.round(((neverLoggedIn[0]?.count ?? 0) / totalU) * 100) : 0 },
        totalEmployees: totalU, activeEmployees: activeU,
        inactiveEmployees: inactiveUsers[0]?.count ?? 0,
        mfaEnabled: mfaEnabled[0]?.count ?? 0,
        lockedAccounts: lockedAccounts[0]?.count ?? 0,
        neverLoggedIn: neverLoggedIn[0]?.count ?? 0,
        roleDistribution: byRole.map(r => ({ role: r.role, count: r.cnt })),
        rates: { mfaAdoption: totalU ? Math.round(((mfaEnabled[0]?.count ?? 0) / totalU) * 100) : 0, activity: activeU ? Math.round((loginW / activeU) * 100) : 0, accountHealth: totalU ? Math.round(((activeU - (lockedAccounts[0]?.count ?? 0)) / totalU) * 100) : 0 },
      };
    }
    case "agent_securite": {
      const orgUserSec = eq(usersTable.organisationId, orgId);
      const [totalContacts, callsWithoutContact, noNotesAnswered, totalCheckins, auditEntries, recentAudits, failedLogins, totalUsers, mfaUsers, notifications,
        prevAudits, auditByAction, sensitiveActions
      ] = await Promise.all([
        db.select({ count: count() }).from(contactsTable).where(orgContact),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.contactId))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.notes), eq(callsTable.status, "repondu"))),
        db.select({ count: count() }).from(checkinsTable).where(orgCheckin),
        db.select({ count: count() }).from(auditLogsTable).where(sql`${auditLogsTable.userId} IN (SELECT id FROM users WHERE organisation_id = ${orgId})`),
        db.select({ count: count() }).from(auditLogsTable).where(and(gte(auditLogsTable.createdAt, weekAgo), sql`${auditLogsTable.userId} IN (SELECT id FROM users WHERE organisation_id = ${orgId})`)),
        db.select({ count: count() }).from(usersTable).where(and(orgUserSec, sql`${usersTable.tentativesEchouees} > 0`)),
        db.select({ count: count() }).from(usersTable).where(orgUserSec),
        db.select({ count: count() }).from(usersTable).where(and(orgUserSec, eq(usersTable.mfaActif, true))),
        db.select({ count: count() }).from(notificationsTable).where(and(eq(notificationsTable.read, false), sql`${notificationsTable.userId} IN (SELECT id FROM users WHERE organisation_id = ${orgId})`)),
        db.select({ count: count() }).from(auditLogsTable).where(and(gte(auditLogsTable.createdAt, twoWeeksAgo), lt(auditLogsTable.createdAt, weekAgo), sql`${auditLogsTable.userId} IN (SELECT id FROM users WHERE organisation_id = ${orgId})`)),
        db.select({ action: auditLogsTable.action, cnt: count() }).from(auditLogsTable).where(and(gte(auditLogsTable.createdAt, weekAgo), sql`${auditLogsTable.userId} IN (SELECT id FROM users WHERE organisation_id = ${orgId})`)).groupBy(auditLogsTable.action),
        db.select({ count: count() }).from(auditLogsTable).where(and(gte(auditLogsTable.createdAt, weekAgo), sql`${auditLogsTable.action} IN ('delete', 'export', 'role_change', 'password_change')`, sql`${auditLogsTable.userId} IN (SELECT id FROM users WHERE organisation_id = ${orgId})`)),
      ]);
      const totalU = totalUsers[0]?.count ?? 0;
      const audW = recentAudits[0]?.count ?? 0;
      const prevAudW = prevAudits[0]?.count ?? 0;
      return {
        thisWeek: { auditEntries: audW, sensitiveActions: sensitiveActions[0]?.count ?? 0 },
        prevWeek: { auditEntries: prevAudW },
        trends: { auditChange: prevAudW ? Math.round(((audW - prevAudW) / prevAudW) * 100) : 0 },
        patterns: { topActions: auditByAction.sort((a, b) => b.cnt - a.cnt).slice(0, 5).map(a => ({ action: a.action, count: a.cnt })), sensitiveActionRate: audW ? Math.round(((sensitiveActions[0]?.count ?? 0) / audW) * 100) : 0 },
        contactsTotal: totalContacts[0]?.count ?? 0,
        unlinkedCalls: callsWithoutContact[0]?.count ?? 0,
        callsWithoutDocumentation: noNotesAnswered[0]?.count ?? 0,
        totalCheckinRecords: totalCheckins[0]?.count ?? 0,
        totalAuditEntries: auditEntries[0]?.count ?? 0,
        usersWithFailedLogins: failedLogins[0]?.count ?? 0,
        rates: { mfaAdoption: totalU ? Math.round(((mfaUsers[0]?.count ?? 0) / totalU) * 100) : 0, tracability: Math.min(100, (auditEntries[0]?.count ?? 0) > 0 ? 70 + Math.min(30, Math.round(audW / 10)) : 30) },
        unreadNotifications: notifications[0]?.count ?? 0,
      };
    }
    case "agent_performance": {
      const [totalCalls, answeredCalls, totalTasks, completedTasks, totalContacts, totalMessages, unreadMessages, totalCheckins, overdueT, newContacts, totalStock, lowStock,
        prevCalls, prevAnswered, prevCompletedTasks, prevCheckins, totalInvoices, unpaidInvoices, totalUsers, activeUsers, negativeSentiment, outOfStock
      ] = await Promise.all([
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(tasksTable).where(orgTask),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"))),
        db.select({ count: count() }).from(contactsTable).where(orgContact),
        db.select({ count: count() }).from(messagesTable).where(orgMsg),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), sql`${tasksTable.dueDate} < NOW()`)),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, gte(contactsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(stockArticlesTable).where(eq(stockArticlesTable.organisationId, orgId)),
        db.select({ count: count() }).from(stockArticlesTable).where(and(eq(stockArticlesTable.organisationId, orgId), sql`${stockArticlesTable.quantity} <= ${stockArticlesTable.minQuantity}`)),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "repondu"), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, twoWeeksAgo), lt(tasksTable.updatedAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, twoWeeksAgo), lt(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(invoicesTable).where(eq(invoicesTable.organisationId, orgId)),
        db.select({ count: count() }).from(invoicesTable).where(and(eq(invoicesTable.organisationId, orgId), sql`${invoicesTable.status} IN ('en_attente', 'retard', 'partiel')`)),
        db.select({ count: count() }).from(usersTable).where(eq(usersTable.organisationId, orgId)),
        db.select({ count: count() }).from(usersTable).where(and(eq(usersTable.organisationId, orgId), eq(usersTable.actif, true))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(stockArticlesTable).where(and(eq(stockArticlesTable.organisationId, orgId), eq(stockArticlesTable.quantity, 0))),
      ]);
      const tCalls = totalCalls[0]?.count ?? 0;
      const tTasks = totalTasks[0]?.count ?? 0;
      const pCalls = prevCalls[0]?.count ?? 0;
      const ansRate = tCalls ? Math.round(((answeredCalls[0]?.count ?? 0) / tCalls) * 100) : 0;
      const prevAnsRate = pCalls ? Math.round(((prevAnswered[0]?.count ?? 0) / pCalls) * 100) : 0;
      const compRate = tTasks ? Math.round(((completedTasks[0]?.count ?? 0) / tTasks) * 100) : 0;
      return {
        thisWeek: { calls: tCalls, answerRate: ansRate, checkins: totalCheckins[0]?.count ?? 0, negativeSentiment: negativeSentiment[0]?.count ?? 0 },
        prevWeek: { calls: pCalls, answerRate: prevAnsRate, completedTasks: prevCompletedTasks[0]?.count ?? 0, checkins: prevCheckins[0]?.count ?? 0 },
        trends: { callVolumeChange: pCalls ? Math.round(((tCalls - pCalls) / pCalls) * 100) : 0, answerRateChange: prevAnsRate ? ansRate - prevAnsRate : 0 },
        crossDomain: { totalEmployees: totalUsers[0]?.count ?? 0, activeEmployees: activeUsers[0]?.count ?? 0, totalInvoices: totalInvoices[0]?.count ?? 0, unpaidInvoices: unpaidInvoices[0]?.count ?? 0, outOfStockItems: outOfStock[0]?.count ?? 0 },
        totalTasks: tTasks, taskCompletionRate: compRate,
        overdueTasks: overdueT[0]?.count ?? 0,
        totalContacts: totalContacts[0]?.count ?? 0, newContactsThisWeek: newContacts[0]?.count ?? 0,
        totalMessages: totalMessages[0]?.count ?? 0, unreadMessages: unreadMessages[0]?.count ?? 0,
        totalStockArticles: totalStock[0]?.count ?? 0, lowStockAlerts: lowStock[0]?.count ?? 0,
        globalScore: Math.round((
          (tCalls ? ((answeredCalls[0]?.count ?? 0) / tCalls) * 25 : 25) +
          (tTasks ? ((completedTasks[0]?.count ?? 0) / tTasks) * 25 : 25) +
          ((totalMessages[0]?.count ?? 0) > 0 ? (((totalMessages[0]?.count ?? 0) - (unreadMessages[0]?.count ?? 0)) / (totalMessages[0]?.count ?? 1)) * 25 : 25) +
          ((overdueT[0]?.count ?? 0) === 0 ? 25 : Math.max(0, 25 - (overdueT[0]?.count ?? 0) * 3))
        )),
      };
    }
    default:
      return {};
  }
}

function getAgentPrompt(agent: typeof AGENTS[0]) {
  const prompts: Record<string, string> = {
    agent_appels: `Tu es le Responsable Telephonie IA le plus performant d'un bureau professionnel en France. Tu observes et analyses chaque detail comme un expert en intelligence d'affaires.

CAPACITES D'OBSERVATION AVANCEE:
- Tu COMPARES systematiquement cette semaine avec la semaine precedente (donnees "thisWeek" vs "prevWeek")
- Tu DETECTES les patterns dans les heures de pointe ("peakHours") et les appelants repetitifs ("repeatedMissedCallers")
- Tu CORRELES les donnees entre elles (ex: augmentation appels manques + baisse sentiment = probleme de capacite)
- Tu PREDIS les risques a 7 et 30 jours en extrapolant les tendances
- Tu IDENTIFIES les signaux faibles avant qu'ils ne deviennent des crises

TON ROLE REEL DANS LE BUREAU:
- Tu supervises TOUS les appels entrants et sortants avec une vision 360 degres
- Tu detectes AUTOMATIQUEMENT les anomalies: un pic soudain d'appels manques, une chute du sentiment, des appelants qui rappellent sans reponse
- Tu identifies les patterns recurrents: "3 numeros ont appele 2+ fois sans reponse = clients frustres"
- Tu analyses les tendances: "le taux de reponse est passe de 85% a 72% en une semaine = degradation"
- Tu correles les metriques: "les appels longs coincident avec les heures sans personnel = manque d'effectif"

ANALYSES DETAILLEES A FOURNIR:
1. TENDANCE: Taux de reponse cette semaine vs semaine precedente (evolution en %)
2. PATTERN: Heures de pointe identifiees et leur correlation avec les appels manques
3. ANOMALIE: Appelants repetitifs non traites = risque de perte client
4. CORRELATION: Sentiment negatif vs duree d'appel vs heure de la journee
5. PREDICTION: Si le taux de reponse continue a baisser, impact dans 7 jours
6. DOCUMENTATION: Appels repondus sans notes = perte d'information critique
7. SIGNAL FAIBLE: Appels courts (<30s) en augmentation = raccrochage premature?

Utilise les chiffres exacts: "Le taux de reponse a chute de 92% a 78% (-14 points), principalement entre 14h-16h ou 67% des appels manques se concentrent. 3 numeros ont appele 2+ fois sans reponse = risque de perte de 3 clients".`,

    agent_contacts: `Tu es le Directeur Commercial IA le plus perspicace d'un bureau professionnel en France. Tu analyses la base CRM avec une intelligence superieure.

CAPACITES D'OBSERVATION AVANCEE:
- Tu COMPARES la croissance contacts cette semaine vs semaine precedente (donnees "thisWeek" vs "prevWeek")
- Tu DETECTES les patterns: entreprises avec beaucoup de contacts = potentiels grands comptes
- Tu CORRELES contacts actifs (avec appels recents) vs contacts dormants = sante de la relation commerciale
- Tu IDENTIFIES les contacts lies a des taches vs orphelins = niveau d'engagement
- Tu PREDIS le taux de churn en analysant l'inactivite

TON ROLE REEL DANS LE BUREAU:
- Tu analyses la qualite de la base comme un auditeur CRM professionnel
- Tu detectes AUTOMATIQUEMENT: doublons de telephone, fiches incompletes, contacts orphelins sans activite depuis 30+ jours
- Tu identifie les patterns de croissance: "La base a grandi de 15% cette semaine mais 80% des nouveaux n'ont pas d'email"
- Tu correle les donnees: "Les contacts haute valeur (5+ appels) representent seulement 8% mais generent 60% du volume d'appels"
- Tu evalue le ROI potentiel de chaque action d'enrichissement

ANALYSES DETAILLEES A FOURNIR:
1. TENDANCE: Nouveaux contacts cette semaine vs precedente + taux de croissance
2. PATTERN: Top entreprises par nombre de contacts = potentiels grands comptes
3. CORRELATION: Contacts avec appels recents vs contacts dormants = engagement
4. QUALITE: Score de completude (email + telephone + entreprise + notes)
5. PREDICTION: Si le taux d'orphelins continue, perte estimee dans 30 jours
6. SIGNAL FAIBLE: Contacts haute valeur sans activite recente = risque de desengagement
7. ACTIONNABLE: Prioriser l'enrichissement par impact business estime

Utilise les chiffres: "23 contacts sans email (15% de la base), 8 doublons de telephone faussant les stats. Les 5 entreprises top representent 34 contacts actifs = concentrer les efforts commerciaux".`,

    agent_taches: `Tu es le Directeur de Production IA le plus analytique d'un bureau professionnel en France. Tu pilotes la productivite avec une vision predictive.

CAPACITES D'OBSERVATION AVANCEE:
- Tu COMPARES la velocity (taches terminees) cette semaine vs semaine precedente
- Tu DETECTES le ratio creation/completion = le backlog grandit-il ou se reduit-il?
- Tu CORRELES la duree moyenne de completion avec la priorite des taches
- Tu IDENTIFIES les patterns: taches haute priorite non assignees = bombe a retardement
- Tu PREDIS le temps necessaire pour eliminer le backlog au rythme actuel

TON ROLE REEL DANS LE BUREAU:
- Tu analyses la velocity de l'equipe comme un coach agile senior
- Tu detectes AUTOMATIQUEMENT: taches en retard, taches sans responsable, blocages >7 jours
- Tu calcule le "health ratio": si on cree plus qu'on ne complete = surcharge imminente
- Tu identifie les periodes de pic de creation vs completion
- Tu predis quand le backlog sera critique si le rythme actuel continue

ANALYSES DETAILLEES A FOURNIR:
1. VELOCITY: Taches terminees cette semaine vs precedente (evolution en %)
2. FLUX: Ratio creation/completion = equilibre ou dette technique
3. PATTERN: Temps moyen de completion par tache (en jours)
4. BOTTLENECK: Taches haute priorite bloquees depuis combien de temps
5. PREDICTION: Au rythme actuel, combien de jours pour eliminer le retard?
6. ANOMALIE: Taches non assignees = responsabilite diluee
7. SIGNAL FAIBLE: Augmentation des annulations = probleme de planification?

Utilise les chiffres: "Velocity en baisse de 30% (5 taches cette semaine vs 7 la precedente). Backlog de 12 taches en retard = 8.5 jours de travail au rythme actuel".`,

    agent_messages: `Tu es le Directeur Communication IA le plus vigilant d'un bureau professionnel en France. Tu detectes chaque signal de surcharge ou de negligence.

CAPACITES D'OBSERVATION AVANCEE:
- Tu COMPARES le volume de messages cette semaine vs semaine precedente
- Tu DETECTES les jours de pic et les patterns de surcharge
- Tu CORRELES messages non lus anciens (>48h) avec le risque de perte d'information
- Tu IDENTIFIES le ratio messages stales/total = indicateur de negligence
- Tu PREDIS l'accumulation de backlog si le rythme de lecture ne change pas

TON ROLE REEL DANS LE BUREAU:
- Tu surveilles les flux de communication comme un centre de controle
- Tu detectes AUTOMATIQUEMENT: messages urgents ignores, accumulation anormale, pics de volume
- Tu correle les patterns: "80% des messages non lus arrivent le lundi = surcharge post-weekend"
- Tu identifie les risques: messages critiques enterres sous le volume

ANALYSES DETAILLEES A FOURNIR:
1. TENDANCE: Volume cette semaine vs precedente + direction du backlog
2. PATTERN: Jours de pic de messages et correlation avec la capacite de traitement
3. URGENCE: Messages haute priorite non lus = risque business immediat
4. ANOMALIE: Messages >48h non lus = oubli ou surcharge structurelle?
5. PREDICTION: Au rythme actuel, quand le backlog sera-t-il critique?
6. ACTIONNABLE: Plan de traitement par lots avec priorites

Utilise les chiffres: "Volume en hausse de 25% (+15 messages). 8 messages urgents non lus dont 3 depuis 48h+. Le lundi concentre 40% du volume = renforcer le traitement ce jour-la".`,

    agent_pointage: `Tu es le DRH IA le plus precis d'un bureau professionnel en France. Tu analyses les presences avec une acuite statistique superieure.

CAPACITES D'OBSERVATION AVANCEE:
- Tu COMPARES les sessions et retards cette semaine vs semaine precedente
- Tu DETECTES les jours de pic de presence et les patterns d'absence
- Tu CORRELES le type de travail (bureau/distance/terrain) avec la productivite
- Tu IDENTIFIES les patterns: retards chroniques en debut de semaine = probleme d'organisation
- Tu PREDIS les risques RH: burnout (pas de pause), absenteisme (pattern de baisse)

TON ROLE REEL DANS LE BUREAU:
- Tu analyses la presence comme un DRH analytique avec des KPIs precis
- Tu detectes AUTOMATIQUEMENT: retards recurrents, pauses excessives, absence de pointage
- Tu correle les donnees: "Les retards sont 3x plus frequents le lundi = probleme de decompression weekend"
- Tu identifie les signaux de burnout: durees de travail >10h sans pause adequate

ANALYSES DETAILLEES A FOURNIR:
1. TENDANCE: Sessions et retards cette semaine vs precedente (evolution)
2. PATTERN: Jours les plus actifs et distribution bureau/distance/terrain
3. CORRELATION: Duree moyenne vs pauses prises = equilibre travail-repos
4. ANOMALIE: Retards en hausse ou baisse? Cause probable?
5. PREDICTION: Tendance ponctualite sur 30 jours si rien ne change
6. SIGNAL FAIBLE: Employes sans pause (<15min) = risque burnout

Utilise les chiffres: "Retards en hausse de 40% (7 vs 5), concentres le lundi (4/7). Duree moyenne 7h12 vs 8h cible. 3 employes sans pause adequate = risque burnout".`,

    agent_facturation: `Tu es le Controleur Financier IA le plus rigoureux d'un bureau professionnel en France. Tu analyses la tresorerie comme un expert-comptable senior.

CAPACITES D'OBSERVATION AVANCEE:
- Tu COMPARES le volume de facturation cette semaine vs semaine precedente
- Tu DETECTES les patterns de paiement: DSO (delai moyen de paiement), paiements partiels
- Tu CORRELES le taux de recouvrement avec le montant impaye total
- Tu IDENTIFIES les signaux d'alerte: montant impaye en hausse = tension de tresorerie
- Tu PREDIS le cash-flow a 30 jours en extrapolant les tendances

TON ROLE REEL DANS LE BUREAU:
- Tu surveilles la sante financiere avec des indicateurs precis
- Tu detectes AUTOMATIQUEMENT: factures en retard, paiements non rapproches, ecarts comptables
- Tu calcule le DSO estime et le compare aux standards (30 jours = bon, 60+ = critique)
- Tu identifie les risques de tresorerie: montant impaye total vs chiffre d'affaires

ANALYSES DETAILLEES A FOURNIR:
1. TENDANCE: Factures emises cette semaine vs precedente + direction
2. PATTERN: DSO estime (delai moyen de paiement en jours)
3. MONTANTS: Total impaye ventile par statut (en_attente vs retard vs partiel)
4. ANOMALIE: Paiements partiels en augmentation = clients en difficulte?
5. PREDICTION: Cash-flow a 30 jours si les tendances continuent
6. RISQUE: Concentration du risque impaye sur peu de factures = fragilite
7. ACTIONNABLE: Procedure de relance prioritaire avec montants

Utilise les chiffres: "3 factures en retard pour 2,450 EUR (DSO estime: 45 jours). Taux de recouvrement a 72% (-5 points vs mois dernier). 1 paiement partiel de 800 EUR = relance sous 24h".`,

    agent_stock: `Tu es le Directeur Logistique IA le plus anticipe d'un bureau professionnel en France. Tu prevois les ruptures avant qu'elles n'arrivent.

CAPACITES D'OBSERVATION AVANCEE:
- Tu DETECTES le taux critique = % d'articles en alerte ou rupture
- Tu CORRELES la valeur du stock avec la qualite des donnees (articles sans prix = risque)
- Tu IDENTIFIES les patterns: articles a prix zero, sans categorie = desordre inventaire
- Tu PREDIS les prochaines ruptures en analysant les niveaux vs seuils minimums
- Tu CALCULE le cout de l'immobilisation (stock dormant = capital gele)

TON ROLE REEL DANS LE BUREAU:
- Tu geres l'inventaire comme un controleur de gestion logistique
- Tu detectes AUTOMATIQUEMENT: ruptures, stocks bas, anomalies de prix, donnees manquantes
- Tu priorise les commandes par urgence et impact sur l'activite
- Tu identifie le stock dormant: articles qui ne bougent pas = capital gele inutilement

ANALYSES DETAILLEES A FOURNIR:
1. URGENCE: Articles en rupture et leur impact sur l'activite quotidienne
2. ALERTE: Articles sous seuil minimum = commande dans les 48h
3. PATTERN: Prix moyen vs max = detection d'anomalies de prix
4. QUALITE: Articles sans barre-code/categorie = desordre inventaire en %
5. PREDICTION: Prochaines ruptures estimees si pas de reapprovisionnement
6. VALEUR: Repartition de la valeur par categorie + stock dormant
7. ACTIONNABLE: Liste de commande prioritaire avec quantites recommandees

Utilise les chiffres: "5 articles en rupture (12% du stock), 3 sous seuil minimum. Valeur totale: 45,200 EUR dont 8,400 EUR de stock dormant. Commande urgente: 8 references pour 2,100 EUR".`,

    agent_rh: `Tu es le DRH IA le plus strategique d'un bureau professionnel en France. Tu anticipes les problemes de personnel avant qu'ils n'emergent.

CAPACITES D'OBSERVATION AVANCEE:
- Tu COMPARES l'activite des connexions cette semaine vs semaine precedente
- Tu DETECTES les comptes "fantomes" (crees mais jamais utilises) = gaspillage de licence
- Tu CORRELES le taux d'adoption MFA avec les tentatives de connexion echouees = vulnerabilite
- Tu IDENTIFIES les patterns d'engagement: qui se connecte regulierement vs qui decroche
- Tu PREDIS les risques de turnover en analysant les signaux de desengagement

TON ROLE REEL DANS LE BUREAU:
- Tu geres le capital humain avec des indicateurs precis et predictifs
- Tu detectes AUTOMATIQUEMENT: comptes verrouilles, MFA non active, inactivite prolongee
- Tu correle les donnees RH avec les donnees de pointage pour une vue complete
- Tu identifie les signaux de desengagement: baisse de connexion, pas de pointage

ANALYSES DETAILLEES A FOURNIR:
1. TENDANCE: Activite des connexions cette semaine vs precedente
2. PATTERN: Comptes fantomes et taux d'adoption de la plateforme
3. SECURITE: MFA non active + tentatives echouees = surface d'attaque
4. CORRELATION: Connexion vs pointage = coherence de l'engagement
5. PREDICTION: Risque de desengagement si tendances continuent
6. ANOMALIE: Comptes verrouilles = cause et action corrective
7. ACTIONNABLE: Plan d'onboarding pour comptes jamais utilises

Utilise les chiffres: "Activite en baisse de 20% (4 connexions vs 5). 3 comptes fantomes = 3 licences gaspillees. MFA a 40% = 60% de la surface d'attaque non protegee".`,

    agent_securite: `Tu es le RSSI IA le plus vigilant d'un bureau professionnel en France. Tu detectes chaque menace avec une precision chirurgicale.

CAPACITES D'OBSERVATION AVANCEE:
- Tu COMPARES les entries d'audit cette semaine vs precedente = activite normale ou anormale?
- Tu DETECTES les actions sensibles (delete, export, role_change) = operations a risque
- Tu CORRELES MFA non active + tentatives echouees = surface d'attaque ouverte
- Tu IDENTIFIES les patterns d'actions: pic soudain d'exports = possible exfiltration
- Tu PREDIS les risques de securite en extrapolant les tendances

TON ROLE REEL DANS LE BUREAU:
- Tu protege l'organisation comme un centre de securite operationnel
- Tu detectes AUTOMATIQUEMENT: tentatives d'intrusion, actions suspectes, failles de conformite
- Tu analyse les patterns d'audit: "Pic de 15 exports en une heure = comportement anormal a investiguer"
- Tu correle les indicateurs: "3 comptes sans MFA + 5 tentatives echouees = alerte de securite"

ANALYSES DETAILLEES A FOURNIR:
1. TENDANCE: Volume d'audit cette semaine vs precedente = activite normale?
2. PATTERN: Top 5 actions et concentration = activite normale ou suspecte?
3. MENACE: Actions sensibles (delete, export, role_change) en pourcentage
4. CORRELATION: MFA non active + echecs de connexion = risque d'intrusion
5. ANOMALIE: Pics d'activite anormaux a investiguer
6. CONFORMITE: Appels non documentes = risque legal, contacts sans trace
7. PREDICTION: Evolution de la surface d'attaque si rien ne change

Classe par criticite: "CRITIQUE: 60% des comptes sans MFA + 3 tentatives echouees cette semaine = risque d'intrusion actif. HAUTE: 45 appels sans documentation = non-conformite legale".`,

    agent_performance: `Tu es le Directeur General IA le plus strategique d'un bureau professionnel en France. Tu analyses l'ensemble du bureau avec une vision a 360 degres et des capacites predictives.

CAPACITES D'OBSERVATION AVANCEE:
- Tu COMPARES TOUT: appels, taches, presence, facturation cette semaine vs precedente
- Tu DETECTES les correlations INTER-DEPARTEMENTS: baisse appels + hausse taches en retard = equipe surchargee
- Tu CORRELES les KPIs financiers (impaye) avec les KPIs operationnels (productivite)
- Tu IDENTIFIES les signaux faibles CROISES: sentiment negatif + retards + stock bas = crise imminente
- Tu PREDIS la trajectoire globale du bureau a 7 et 30 jours
- Tu SYNTHETISES les forces et faiblesses en actions concretes

TON ROLE REEL DANS LE BUREAU:
- Tu es le chef d'orchestre qui voit ce qu'aucun agent individuel ne peut voir
- Tu detectes les CORRELATIONS entre services: "Les appels manques augmentent les jours ou il y a le plus de retards taches = manque d'effectif"
- Tu identifie les CASCADES: "Stock en rupture → appels mecontents → sentiment negatif → image degradee"
- Tu propose un plan d'action PRIORISE par impact business global

ANALYSES DETAILLEES A FOURNIR:
1. TENDANCE GLOBALE: Score du bureau cette semaine vs precedente (chaque metrique)
2. TOP 3 CORRELATIONS: Liens detectes entre services (cause → effet)
3. FORCES: Top 3 indicateurs performants avec chiffres
4. FAIBLESSES: Top 3 indicateurs critiques avec cause racine
5. CASCADE: Risques d'effet domino entre departements
6. PREDICTION: Trajectoire du bureau a 7 et 30 jours
7. PLAN D'ACTION: Priorite 1/2/3 avec impact estime et responsable

Utilise les chiffres croises: "Le bureau score 72/100 (+3 vs semaine precedente). Forces: taux de reponse 92%. Faiblesses: 8 taches en retard causant 3 appels mecontents. Cascade detectee: 2 articles en rupture → 5 appels de reclamation cette semaine".`,
  };
  return prompts[agent.id] || "";
}

const AGENT_RESPONSE_FORMAT = `METHODE D'ANALYSE (applique ces etapes dans l'ordre):
1. OBSERVER: Lis attentivement chaque chiffre. Que vois-tu exactement?
2. COMPARER: Compare cette semaine avec la semaine precedente. Quelles sont les tendances?
3. DETECTER: Y a-t-il des patterns anormaux? Des correlations suspectes? Des signaux faibles?
4. DIAGNOSTIQUER: Quelle est la cause racine de chaque probleme?
5. PRESCRIRE: Quelle action concrete resoudrait chaque probleme? En combien de temps?
6. PREDIRE: Si rien ne change, que se passera-t-il dans 7 jours? Dans 30 jours?

Reponds en JSON avec cette structure exacte:
{
  "score": number (0-100, note globale calculee objectivement: 0-30 si problemes critiques, 30-60 si attention requise, 60-80 si bon, 80-100 si excellent),
  "summary": "string (resume en 3-4 phrases: situation actuelle + tendance + action la plus urgente)",
  "trendAnalysis": "string (comparaison cette semaine vs semaine precedente: amelioration/degradation de X% et pourquoi)",
  "detectedPatterns": [{"pattern": "string (description du pattern detecte)", "evidence": "string (les chiffres qui prouvent ce pattern)", "risk": "string (quel risque cela represente)", "recommendation": "string (quoi faire)"}],
  "errors": [{"titre": "string", "description": "string", "severity": "critique|haute|moyenne", "action": "string (correction precise et immediate)", "rootCause": "string (cause racine identifiee)", "deadline": "string (delai recommande: immediat|24h|48h|1_semaine)"}],
  "warnings": [{"titre": "string", "description": "string", "impact": "string (impact mesurable sur le business)", "threshold": "string (a quel seuil cela devient critique?)"}],
  "suggestions": [{"titre": "string", "description": "string", "priorite": "haute|moyenne|basse", "benefice": "string (gain mesurable attendu)", "effort": "string (faible|moyen|important)", "roi": "string (estimation du retour sur investissement)"}],
  "corrections": [{"element": "string", "probleme": "string", "solution": "string", "urgence": "haute|moyenne|basse", "responsable": "string (qui devrait s'en occuper: admin|manager|agent)"}],
  "kpis": [{"label": "string", "valeur": "string", "tendance": "hausse|baisse|stable", "status": "bon|attention|critique", "objectif": "string (valeur cible ideale)", "ecart": "string (difference avec l'objectif)"}],
  "predictions": [{"scenario": "string (si rien ne change...)", "horizon": "7_jours|30_jours", "probabilite": "haute|moyenne|basse", "impact": "string (consequence concrete)", "prevention": "string (action pour eviter ce scenario)"}],
  "automations": [{"action": "string (ce qui pourrait etre automatise)", "gain": "string (temps/effort economise)", "faisabilite": "haute|moyenne|basse"}]
}
IMPORTANT: Genere 3-6 elements pertinents pour chaque categorie. Sois ULTRA concret avec les chiffres. Chaque erreur doit avoir une cause racine. Chaque suggestion doit avoir un ROI estime. Chaque prediction doit etre basee sur les tendances observees.`;

async function runSingleAgent(agent: typeof AGENTS[0], orgId: number): Promise<any> {
  const startTime = Date.now();
  const today = new Date().toISOString().split("T")[0];

  try {
    const data = await gatherAgentData(agent.id, orgId);

    let collaborationContext = "";
    let trendContext = "";
    try {
      const { getLatestAgentInsights, buildCollaborationPrompt, getAgentTrendHistory } = await import("./agent-collaboration");
      const [insights, trendHistory] = await Promise.all([
        getLatestAgentInsights(orgId),
        getAgentTrendHistory(orgId, agent.id, 5),
      ]);
      collaborationContext = buildCollaborationPrompt(insights, agent.id);
      if (trendHistory.length > 1) {
        const scores = trendHistory.map(h => h.score ?? 0);
        const isDecaying = scores.length >= 3 && scores[0] < scores[1] && scores[1] < scores[2];
        const isImproving = scores.length >= 3 && scores[0] > scores[1] && scores[1] > scores[2];
        trendContext = `\n\n=== HISTORIQUE DE TES SCORES ===
Tes ${trendHistory.length} derniers scores: ${scores.join(" → ")}
Tendance: ${isDecaying ? "⚠ EN DEGRADATION CONTINUE" : isImproving ? "✅ EN AMELIORATION" : "Stable"}
${isDecaying ? "ATTENTION: Tes scores baissent consecutivement. Analyse POURQUOI et propose des corrections urgentes." : ""}
${trendHistory.map(h => `  ${h.reportDate}: score ${h.score}, ${h.errorsFound} erreurs, ${h.warningsFound} alertes`).join("\n")}
=== FIN HISTORIQUE ===`;
      }
    } catch (colErr) { console.warn(`[AI-Agent] ${agent} collaboration context failed:`, colErr); }

    const { ai } = await import("@workspace/integrations-gemini-ai");
    const fullPrompt = `${getAgentPrompt(agent)}${collaborationContext}${trendContext}\n\n${AGENT_RESPONSE_FORMAT}\n\nDate du rapport: ${today}\nDonnees actuelles (cette semaine + semaine precedente + patterns):\n${JSON.stringify(data, null, 2)}`;

    let text = "{}";
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        config: { maxOutputTokens: 8192, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 2048 } },
      });
      text = response.text ?? "{}";
    } catch (geminiErr: any) {
      logger.warn({ err: geminiErr, agentId: agent.id }, "Gemini failed, trying OpenAI fallback");
      try {
        const { openai } = await import("@workspace/integrations-openai-ai-server");
        const fallback = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: fullPrompt + "\n\nReponds UNIQUEMENT en JSON valide." }],
        });
        text = fallback.choices?.[0]?.message?.content ?? "{}";
      } catch (openaiErr: any) {
        logger.warn({ err: openaiErr, agentId: agent.id }, "OpenAI fallback failed, trying Anthropic");
        try {
          const { anthropic } = await import("@workspace/integrations-anthropic-ai");
          const fallback2 = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 8192,
            messages: [{ role: "user", content: fullPrompt + "\n\nReponds UNIQUEMENT en JSON valide." }],
          });
          text = fallback2.content?.[0]?.type === "text" ? fallback2.content[0].text : "{}";
        } catch (anthropicErr: any) {
          logger.error({ err: anthropicErr, agentId: agent.id }, "All AI providers failed");
          throw new Error(`Tous les fournisseurs IA ont echoue pour ${agent.id}`);
        }
      }
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { score: 50, summary: text, errors: [], warnings: [], suggestions: [], corrections: [], kpis: [], detectedPatterns: [], predictions: [], automations: [], trendAnalysis: "" };
    }

    const executionTimeMs = Date.now() - startTime;

    const [report] = await db.insert(aiAgentReportsTable).values({
      agentId: agent.id,
      agentName: agent.name,
      agentIcon: agent.icon,
      organisationId: orgId,
      reportDate: today,
      status: "termine",
      score: parsed.score || 50,
      errorsFound: parsed.errors?.length || 0,
      warningsFound: parsed.warnings?.length || 0,
      suggestionsCount: parsed.suggestions?.length || 0,
      summary: parsed.summary || "Aucun resume disponible",
      details: {
        kpis: parsed.kpis || [],
        rawData: data,
        trendAnalysis: parsed.trendAnalysis || "",
        detectedPatterns: parsed.detectedPatterns || [],
        predictions: parsed.predictions || [],
        automations: parsed.automations || [],
      },
      errors: parsed.errors || [],
      warnings: parsed.warnings || [],
      suggestions: parsed.suggestions || [],
      corrections: parsed.corrections || [],
      isSuperReport: false,
      childReportIds: [],
      executionTimeMs,
    }).returning();

    return report;
  } catch (error: any) {
    const executionTimeMs = Date.now() - startTime;
    const [report] = await db.insert(aiAgentReportsTable).values({
      agentId: agent.id,
      agentName: agent.name,
      agentIcon: agent.icon,
      organisationId: orgId,
      reportDate: today,
      status: "erreur",
      score: 0,
      errorsFound: 1,
      summary: `Erreur lors de l'execution: ${error.message}`,
      details: {},
      errors: [{ titre: "Erreur d'execution", description: error.message, severity: "critique", action: "Verifier la configuration IA" }],
      warnings: [],
      suggestions: [],
      corrections: [],
      executionTimeMs,
    }).returning();
    return report;
  }
}

async function getOpenAIReview(reportsSummary: any[]): Promise<any> {
  try {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system",
          content: `Tu es un verificateur IA senior. Tu recois les rapports d'agents IA et tu dois les verifier pour detecter les incoherences, les erreurs de raisonnement et les points manques. Reponds en JSON: {"verification": "string (resume de ta verification)", "incoherences": [{"description": "string", "agents": ["string"]}], "pointsManques": [{"description": "string", "importance": "haute|moyenne"}]}`,
        },
        {
          role: "user",
          content: `Verifie ces rapports d'agents IA:\n${JSON.stringify(reportsSummary, null, 2)}`,
        },
      ],
    });
    const text = response.choices[0]?.message?.content ?? "{}";
    return JSON.parse(text);
  } catch (error: any) {
    logger.error({ err: error, context: "openai_review" }, "OpenAI review error");
    return { verification: "Verification OpenAI non disponible", incoherences: [], pointsManques: [] };
  }
}

async function getAnthropicStrategy(reportsSummary: any[]): Promise<any> {
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Tu es un stratege IA senior pour un bureau professionnel en France. A partir des rapports suivants, fournis des recommandations strategiques de haut niveau. Reponds en JSON: {"strategieGlobale": "string (3-5 phrases)", "prioritesStrategiques": [{"titre": "string", "description": "string", "impact": "fort|moyen|faible", "delai": "string"}], "risques": [{"description": "string", "probabilite": "haute|moyenne|basse", "mitigation": "string"}], "opportunites": [{"description": "string", "benefice": "string"}]}

Rapports:\n${JSON.stringify(reportsSummary, null, 2)}`,
        },
      ],
    });
    const block = message.content[0];
    const text = block.type === "text" ? block.text : "{}";
    return JSON.parse(text);
  } catch (error: any) {
    logger.error({ err: error, context: "anthropic_strategy" }, "Anthropic strategy error");
    return { strategieGlobale: "Strategie Anthropic non disponible", prioritesStrategiques: [], risques: [], opportunites: [] };
  }
}

async function runSuperAgent(childReports: any[], orgId: number): Promise<any> {
  const startTime = Date.now();
  const today = new Date().toISOString().split("T")[0];

  try {
    let crossAgentIssues: any[] = [];
    try {
      const { detectCrossAgentIssues, createCrossAgentAlert } = await import("./agent-collaboration");
      crossAgentIssues = await detectCrossAgentIssues(orgId);
      for (const issue of crossAgentIssues.filter(i => i.severity === "critique")) {
        const fromAgent = issue.agents[0] || "super_agent";
        const toAgent = issue.agents[1] || "super_agent";
        await createCrossAgentAlert(orgId, fromAgent, toAgent, issue.title, issue.description, issue.severity);
      }
    } catch (alertErr) { console.warn("[SuperAgent] cross-agent alert creation failed:", alertErr); }

    const { ai } = await import("@workspace/integrations-gemini-ai");

    const reportsSummary = childReports.map(r => ({
      agent: r.agentName,
      score: r.score,
      status: r.status,
      summary: r.summary,
      errorsCount: r.errorsFound,
      warningsCount: r.warningsFound,
      suggestionsCount: r.suggestionsCount,
      errors: r.errors,
      warnings: r.warnings,
      suggestions: r.suggestions,
      corrections: r.corrections,
    }));

    const [geminiResponse, openaiReview, anthropicStrategy] = await Promise.all([
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          role: "user",
          parts: [{
            text: `Tu es le Super Agent IA, le Directeur General d'un bureau professionnel en France. Tu recois les rapports de 10 agents IA specialises qui couvrent TOUS les aspects du bureau: telephonie, CRM, productivite, communication, presences, facturation, stock, RH, securite et performance.

Ton role de DG:
1. SYNTHETISER les rapports de tes 10 agents en une vision strategique unifiee
2. IDENTIFIER les problemes transversaux entre services (ex: appels manques + messages non lus = service client defaillant)
3. PRIORISER les actions les plus impactantes pour le business
4. DETECTER les correlations cachees (ex: retards de taches + absenteisme = probleme d'equipe)
5. NOTER la performance globale du bureau sur des criteres objectifs
6. PROPOSER un plan d'action executive avec responsables et delais

Reponds en JSON avec cette structure exacte:
{
  "score": number (0-100, note globale du bureau),
  "summary": "string (synthese executive en 3-5 phrases)",
  "errors": [{"titre": "string", "description": "string", "severity": "critique|haute|moyenne", "action": "string", "agentSource": "string"}],
  "warnings": [{"titre": "string", "description": "string", "impact": "string", "agentSource": "string"}],
  "suggestions": [{"titre": "string", "description": "string", "priorite": "haute|moyenne|basse", "benefice": "string", "agentSource": "string"}],
  "corrections": [{"element": "string", "probleme": "string", "solution": "string", "urgence": "haute|moyenne|basse"}],
  "actionPlan": [{"etape": number, "action": "string", "responsable": "string", "delai": "string", "impact": "string"}],
  "crossAnalysis": [{"observation": "string", "agentsConcernes": ["string"], "recommandation": "string"}],
  "agentScores": [{"agent": "string", "score": number, "commentaire": "string"}]
}

Sois strategique, concret et actionnable. Identifie les correlations entre les differents domaines.

Rapports des agents:\n${JSON.stringify(reportsSummary, null, 2)}`
          }],
        }],
        config: { maxOutputTokens: 16384, responseMimeType: "application/json" },
      }),
      getOpenAIReview(reportsSummary),
      getAnthropicStrategy(reportsSummary),
    ]);

    const text = geminiResponse.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
      if (typeof parsed.summary === "object") {
        parsed.summary = JSON.stringify(parsed.summary);
      }
    } catch {
      let extractedSummary = "Analyse terminee - voir les rapports individuels pour les details.";
      let extractedScore = 50;
      const summaryMatch = text.match(/"summary"\s*:\s*"([^"]+)"/);
      if (summaryMatch) extractedSummary = summaryMatch[1];
      const scoreMatch = text.match(/"score"\s*:\s*(\d+)/);
      if (scoreMatch) extractedScore = parseInt(scoreMatch[1], 10);
      const errorsArray: any[] = [];
      const errTitleMatches = text.match(/"titre"\s*:\s*"([^"]+)"/g);
      if (errTitleMatches) {
        for (const m of errTitleMatches.slice(0, 5)) {
          const t = m.match(/"titre"\s*:\s*"([^"]+)"/);
          if (t) errorsArray.push({ titre: t[1], description: "Voir le rapport complet", severity: "haute", action: "Consulter les agents" });
        }
      }
      parsed = { score: extractedScore, summary: extractedSummary, errors: errorsArray, warnings: [], suggestions: [], corrections: [], actionPlan: [], crossAnalysis: [], agentScores: [] };
    }

    const executionTimeMs = Date.now() - startTime;

    const [report] = await db.insert(aiAgentReportsTable).values({
      agentId: "super_agent",
      agentName: "Super Agent IA",
      agentIcon: "crown",
      organisationId: orgId,
      reportDate: today,
      status: "termine",
      score: parsed.score || 50,
      errorsFound: parsed.errors?.length || 0,
      warningsFound: parsed.warnings?.length || 0,
      suggestionsCount: parsed.suggestions?.length || 0,
      summary: parsed.summary || "Aucun resume disponible",
      details: {
        actionPlan: parsed.actionPlan || [],
        crossAnalysis: parsed.crossAnalysis || [],
        agentScores: parsed.agentScores || [],
        crossAgentIssues: crossAgentIssues,
        multiAI: {
          openaiVerification: openaiReview,
          anthropicStrategie: anthropicStrategy,
          providersUsed: ["gemini-2.5-flash", "gpt-5.2", "claude-sonnet-4-6"],
        },
      },
      errors: parsed.errors || [],
      warnings: parsed.warnings || [],
      suggestions: parsed.suggestions || [],
      corrections: parsed.corrections || [],
      isSuperReport: true,
      childReportIds: childReports.map(r => r.id),
      executionTimeMs,
    }).returning();

    return report;
  } catch (error: any) {
    const executionTimeMs = Date.now() - startTime;
    const [report] = await db.insert(aiAgentReportsTable).values({
      agentId: "super_agent",
      agentName: "Super Agent IA",
      agentIcon: "crown",
      organisationId: orgId,
      reportDate: today,
      status: "erreur",
      score: 0,
      errorsFound: 1,
      summary: `Erreur Super Agent: ${error.message}`,
      details: {},
      errors: [{ titre: "Erreur d'execution", description: error.message, severity: "critique", action: "Verifier la configuration" }],
      warnings: [],
      suggestions: [],
      corrections: [],
      isSuperReport: true,
      childReportIds: childReports.map(r => r.id),
      executionTimeMs,
    }).returning();
    return report;
  }
}

const runningJobs = new Map<number, { status: string; startedAt: number; completedAgents: number; totalAgents: number }>();

router.post("/ai/agents/run", requireAdmin, async (_req, res) => {
  try {
    const orgId = (_req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

    if (runningJobs.has(orgId) && runningJobs.get(orgId)!.status === "running") {
      res.json({ status: "already_running", message: "Une analyse est deja en cours." });
      return;
    }

    const jobState = { status: "running", startedAt: Date.now(), completedAgents: 0, totalAgents: AGENTS.length };
    runningJobs.set(orgId, jobState);

    res.json({ status: "started", message: "Analyse lancee en arriere-plan.", totalAgents: AGENTS.length });

    (async () => {
      try {
        const BATCH_SIZE = 3;
        const childReports: any[] = [];
        for (let i = 0; i < AGENTS.length; i += BATCH_SIZE) {
          const batch = AGENTS.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.allSettled(batch.map(agent => runSingleAgent(agent, orgId)));
          for (let j = 0; j < batchResults.length; j++) {
            const result = batchResults[j];
            if (result.status === "fulfilled") {
              childReports.push(result.value);
            } else {
              logger.error({ err: result.reason, agentId: batch[j].id }, `Agent ${batch[j].id} failed`);
              childReports.push({ id: 0, agentName: batch[j].name, score: 0, status: "erreur", errorsFound: 1, executionTimeMs: 0 });
            }
            jobState.completedAgents++;
          }
        }
        await runSuperAgent(childReports, orgId);
        jobState.status = "completed";
      } catch (err: any) {
        logger.error({ err }, "AI Agents background run error");
        jobState.status = "failed";
      } finally {
        setTimeout(() => runningJobs.delete(orgId), 60000);
      }
    })();
  } catch (error: any) {
    logger.error({ err: error }, "AI Agents run error");
    res.status(500).json({ error: "Erreur lors de l'execution des agents IA", details: error.message });
  }
});

router.get("/ai/agents/run/status", requireAdmin, async (req, res) => {
  const orgId = (req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
  const job = runningJobs.get(orgId);
  if (!job) {
    res.json({ status: "idle" });
    return;
  }
  res.json(job);
});

router.post("/ai/agents/run/:agentId", requireAdmin, async (req, res) => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { agentId } = req.params;
    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent introuvable" });
      return;
    }
    const report = await runSingleAgent(agent, orgId);
    res.json(report);
  } catch (error: any) {
    logger.error({ err: error }, "AI Agent run error");
    res.status(500).json({ error: "Erreur lors de l'execution de l'agent", details: error.message });
  }
});

router.post("/ai/agents/super", requireAdmin, async (req, res) => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const today = new Date().toISOString().split("T")[0];
    const todayReports = await db.select().from(aiAgentReportsTable)
      .where(and(eq(aiAgentReportsTable.reportDate, today), eq(aiAgentReportsTable.isSuperReport, false), eq(aiAgentReportsTable.organisationId, orgId)))
      .orderBy(desc(aiAgentReportsTable.createdAt))
      .limit(10);

    if (todayReports.length === 0) {
      res.status(400).json({ error: "Aucun rapport d'agent disponible aujourd'hui. Lancez d'abord les agents." });
      return;
    }

    const superReport = await runSuperAgent(todayReports, orgId);
    res.json(superReport);
  } catch (error: any) {
    logger.error({ err: error }, "Super Agent error");
    res.status(500).json({ error: "Erreur Super Agent", details: error.message });
  }
});

router.get("/ai/agents/reports", requireMinAgent, async (req, res) => {
  const orgId = (req.session as any)?.organisationId;
  const { date, agentId, superOnly } = req.query as Record<string, string>;
  const conditions = [];

  if (orgId) conditions.push(or(eq(aiAgentReportsTable.organisationId, orgId), isNull(aiAgentReportsTable.organisationId)));
  if (date) conditions.push(eq(aiAgentReportsTable.reportDate, date));
  if (agentId) conditions.push(eq(aiAgentReportsTable.agentId, agentId));
  if (superOnly === "true") conditions.push(eq(aiAgentReportsTable.isSuperReport, true));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const reports = await db.select().from(aiAgentReportsTable)
    .where(where)
    .orderBy(desc(aiAgentReportsTable.createdAt))
    .limit(50);

  res.json(reports);
});

router.get("/ai/agents/reports/:id", requireMinAgent, async (req, res): Promise<void> => {
  const orgId = (req.session as any)?.organisationId;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "ID invalide" });
    return;
  }
  const conditions: any[] = [eq(aiAgentReportsTable.id, id)];
  if (orgId) conditions.push(or(eq(aiAgentReportsTable.organisationId, orgId), isNull(aiAgentReportsTable.organisationId)));
  const [report] = await db.select().from(aiAgentReportsTable).where(and(...conditions));
  if (!report) {
    res.status(404).json({ error: "Rapport introuvable" });
    return;
  }
  res.json(report);
});

router.get("/ai/agents/latest", requireMinAgent, async (req, res) => {
  const orgId = (req.session as any)?.organisationId;
  const latestByAgent: Record<string, any> = {};
  const allAgentIds = [...AGENTS.map(a => a.id), "super_agent"];

  for (const agentId of allAgentIds) {
    const conditions: any[] = [eq(aiAgentReportsTable.agentId, agentId)];
    if (orgId) conditions.push(or(eq(aiAgentReportsTable.organisationId, orgId), isNull(aiAgentReportsTable.organisationId)));
    const [latest] = await db.select().from(aiAgentReportsTable)
      .where(and(...conditions))
      .orderBy(desc(aiAgentReportsTable.createdAt))
      .limit(1);
    if (latest) latestByAgent[agentId] = latest;
  }

  res.json(latestByAgent);
});

router.get("/ai/agents/config", requireMinAgent, async (req, res) => {
  const orgId = (req.session as any)?.organisationId;
  res.json({ agents: AGENTS, autoRunEnabled: orgId ? autoRunState.has(orgId) : false, autoRunIntervalMinutes: 120 });
});

const autoRunState = new Map<number, { interval: ReturnType<typeof setInterval>; running: boolean }>();

router.post("/ai/agents/auto-start", requireAdmin, async (_req, res) => {
  const orgId = (_req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

  const existing = autoRunState.get(orgId);
  if (existing) {
    res.json({ message: "L'execution automatique est deja active", status: "active" });
    return;
  }

  const interval = setInterval(async () => {
    const state = autoRunState.get(orgId);
    if (state?.running) return;
    if (state) state.running = true;
    logger.info({ orgId }, "[AI Agents] Execution automatique demarree");
    try {
      const childReports = await Promise.all(AGENTS.map(a => runSingleAgent(a, orgId)));
      await runSuperAgent(childReports, orgId);
      logger.info({ orgId }, "[AI Agents] Execution automatique terminee");
    } catch (error) {
      logger.error({ err: error, orgId }, "[AI Agents] Erreur execution automatique");
    } finally {
      const s = autoRunState.get(orgId);
      if (s) s.running = false;
    }
  }, 2 * 60 * 60 * 1000);

  autoRunState.set(orgId, { interval, running: true });

  try {
    const childReports = await Promise.all(AGENTS.map(a => runSingleAgent(a, orgId)));
    const superReport = await runSuperAgent(childReports, orgId);
    const state = autoRunState.get(orgId);
    if (state) state.running = false;

    res.json({
      message: "Execution automatique activee (toutes les 2 heures)",
      status: "active",
      firstRun: { superReport, agentReports: childReports },
    });
  } catch (error: any) {
    const state = autoRunState.get(orgId);
    if (state) state.running = false;
    res.status(500).json({ error: "Erreur lors du premier cycle", details: error.message });
  }
});

router.post("/ai/agents/auto-stop", requireAdmin, async (_req, res) => {
  const orgId = (_req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

  const state = autoRunState.get(orgId);
  if (state) {
    clearInterval(state.interval);
    autoRunState.delete(orgId);
  }
  res.json({ message: "Execution automatique arretee", status: "inactive" });
});

const autopilotState = new Map<number, {
  interval: ReturnType<typeof setInterval> | null;
  running: boolean;
  log: Array<{ timestamp: string; type: string; message: string; provider?: string; severity?: string }>;
  status: { active: boolean; lastRun?: string; cycleCount: number; fixesApplied: number; issuesFound: number };
}>();

function getOrgAutopilot(orgId: number) {
  if (!autopilotState.has(orgId)) {
    autopilotState.set(orgId, {
      interval: null,
      running: false,
      log: [],
      status: { active: false, cycleCount: 0, fixesApplied: 0, issuesFound: 0 },
    });
  }
  return autopilotState.get(orgId)!;
}

function addAutopilotLog(orgId: number, type: string, message: string, provider?: string, severity?: string) {
  const state = getOrgAutopilot(orgId);
  state.log.push({ timestamp: new Date().toISOString(), type, message, provider, severity });
  if (state.log.length > 200) state.log = state.log.slice(-200);
}

async function runAutopilotCycle(orgId: number) {
  const cycleStart = Date.now();
  addAutopilotLog(orgId, "cycle", "Demarrage du cycle Oto-Pilot");

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const orgContact = eq(contactsTable.organisationId, orgId);
    const orgCall = eq(callsTable.organisationId, orgId);
    const orgTask = eq(tasksTable.organisationId, orgId);
    const orgMsg = eq(messagesTable.organisationId, orgId);

    const orgStock = eq(stockArticlesTable.organisationId, orgId);
    const orgInv = eq(invoicesTable.organisationId, orgId);
    const orgUser = eq(usersTable.organisationId, orgId);

    const [contactsNoEmail, contactsNoPhone, duplicatePhones, callsNoContact, callsNoNotes, tasksOverdue, tasksStuck, unreadMessages, lowStockItems, outOfStockItems, unpaidInvoices, lockedUsers, noMfaUsers] = await Promise.all([
      db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.email))),
      db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.phone))),
      db.select({ phone: contactsTable.phone, cnt: count() }).from(contactsTable).where(and(orgContact, isNotNull(contactsTable.phone))).groupBy(contactsTable.phone).having(sql`count(*) > 1`),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.contactId), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.notes), eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), sql`${tasksTable.dueDate} < NOW()`)),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "en_cours"), sql`${tasksTable.updatedAt} < NOW() - INTERVAL '7 days'`)),
      db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))),
      db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, sql`${stockArticlesTable.quantity} <= ${stockArticlesTable.minQuantity}`, sql`${stockArticlesTable.quantity} > 0`)),
      db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, eq(stockArticlesTable.quantity, 0))),
      db.select({ count: count() }).from(invoicesTable).where(and(orgInv, eq(invoicesTable.status, "retard"))),
      db.select({ count: count() }).from(usersTable).where(and(orgUser, isNotNull(usersTable.verrouilleJusqua), gte(usersTable.verrouilleJusqua, now))),
      db.select({ count: count() }).from(usersTable).where(and(orgUser, eq(usersTable.actif, true), eq(usersTable.mfaActif, false))),
    ]);

    const systemHealth = {
      contactsWithoutEmail: contactsNoEmail[0]?.count ?? 0,
      contactsWithoutPhone: contactsNoPhone[0]?.count ?? 0,
      duplicatePhoneNumbers: duplicatePhones.length,
      callsWithoutContact: callsNoContact[0]?.count ?? 0,
      answeredCallsWithoutNotes: callsNoNotes[0]?.count ?? 0,
      overdueTasks: tasksOverdue[0]?.count ?? 0,
      stuckTasks: tasksStuck[0]?.count ?? 0,
      unreadMessages: unreadMessages[0]?.count ?? 0,
      lowStockItems: lowStockItems[0]?.count ?? 0,
      outOfStockItems: outOfStockItems[0]?.count ?? 0,
      unpaidOverdueInvoices: unpaidInvoices[0]?.count ?? 0,
      lockedUserAccounts: lockedUsers[0]?.count ?? 0,
      usersWithoutMfa: noMfaUsers[0]?.count ?? 0,
    };

    const issues: Array<{ category: string; title: string; count: number; severity: "critique" | "haute" | "moyenne" | "basse"; autoFixable: boolean }> = [];
    const autoFixes: Array<{ action: string; description: string; result: string }> = [];

    if (systemHealth.duplicatePhoneNumbers > 0) issues.push({ category: "contacts", title: "Numeros de telephone en doublon", count: systemHealth.duplicatePhoneNumbers, severity: "haute", autoFixable: false });
    if (systemHealth.contactsWithoutEmail > 10) issues.push({ category: "contacts", title: "Contacts sans email", count: systemHealth.contactsWithoutEmail, severity: "moyenne", autoFixable: false });
    if (systemHealth.contactsWithoutPhone > 10) issues.push({ category: "contacts", title: "Contacts sans telephone", count: systemHealth.contactsWithoutPhone, severity: "moyenne", autoFixable: false });
    if (systemHealth.callsWithoutContact > 5) issues.push({ category: "appels", title: "Appels sans contact associe", count: systemHealth.callsWithoutContact, severity: "haute", autoFixable: true });
    if (systemHealth.answeredCallsWithoutNotes > 3) issues.push({ category: "appels", title: "Appels repondus sans notes", count: systemHealth.answeredCallsWithoutNotes, severity: "moyenne", autoFixable: false });
    if (systemHealth.overdueTasks > 0) issues.push({ category: "taches", title: "Taches en retard", count: systemHealth.overdueTasks, severity: "critique", autoFixable: true });
    if (systemHealth.stuckTasks > 0) issues.push({ category: "taches", title: "Taches bloquees (>7j sans mise a jour)", count: systemHealth.stuckTasks, severity: "haute", autoFixable: true });
    if (systemHealth.unreadMessages > 20) issues.push({ category: "messages", title: "Messages non lus accumules", count: systemHealth.unreadMessages, severity: "moyenne", autoFixable: false });
    if (systemHealth.outOfStockItems > 0) issues.push({ category: "stock", title: "Articles en rupture de stock", count: systemHealth.outOfStockItems, severity: "critique", autoFixable: false });
    if (systemHealth.lowStockItems > 0) issues.push({ category: "stock", title: "Articles sous le seuil minimum", count: systemHealth.lowStockItems, severity: "haute", autoFixable: false });
    if (systemHealth.unpaidOverdueInvoices > 0) issues.push({ category: "facturation", title: "Factures impayees en retard", count: systemHealth.unpaidOverdueInvoices, severity: "critique", autoFixable: false });
    if (systemHealth.lockedUserAccounts > 0) issues.push({ category: "rh", title: "Comptes employes verrouilles", count: systemHealth.lockedUserAccounts, severity: "haute", autoFixable: false });
    if (systemHealth.usersWithoutMfa > 3) issues.push({ category: "securite", title: "Employes actifs sans MFA", count: systemHealth.usersWithoutMfa, severity: "haute", autoFixable: false });

    if (systemHealth.callsWithoutContact > 0) {
      try {
        const orphanCalls = await db.select({ id: callsTable.id, phoneNumber: callsTable.phoneNumber })
          .from(callsTable)
          .where(and(orgCall, isNull(callsTable.contactId), gte(callsTable.createdAt, weekAgo)))
          .limit(20);

        let matched = 0;
        for (const call of orphanCalls) {
          if (!call.phoneNumber) continue;
          const cleanPhone = call.phoneNumber.replace(/\s/g, "");
          const [contact] = await db.select({ id: contactsTable.id }).from(contactsTable)
            .where(and(orgContact, sql`replace(${contactsTable.phone}, ' ', '') = ${cleanPhone}`))
            .limit(1);
          if (contact) {
            await db.update(callsTable).set({ contactId: contact.id }).where(eq(callsTable.id, call.id));
            matched++;
          }
        }
        if (matched > 0) {
          autoFixes.push({ action: "auto_link_calls", description: `${matched} appels associes automatiquement a leurs contacts`, result: "succes" });
          addAutopilotLog(orgId, "fix", `${matched} appels orphelins associes a leurs contacts`, "system", "info");
        }
      } catch (e: any) {
        addAutopilotLog(orgId, "error", `Echec association appels: ${e.message}`, "system", "haute");
      }
    }

    if (systemHealth.overdueTasks > 0) {
      try {
        const overdueList = await db.select({ id: tasksTable.id, title: tasksTable.title, priority: tasksTable.priority })
          .from(tasksTable)
          .where(and(orgTask, ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), sql`${tasksTable.dueDate} < NOW()`))
          .limit(10);

        let escalated = 0;
        for (const task of overdueList) {
          if (task.priority !== "haute" && task.priority !== "urgente") {
            await db.update(tasksTable).set({ priority: "haute" }).where(eq(tasksTable.id, task.id));
            escalated++;
          }
        }
        if (escalated > 0) {
          autoFixes.push({ action: "escalate_overdue", description: `${escalated} taches en retard escaladees en priorite haute`, result: "succes" });
          addAutopilotLog(orgId, "fix", `${escalated} taches en retard escaladees`, "system", "info");
        }
      } catch (e: any) {
        addAutopilotLog(orgId, "error", `Echec escalade taches: ${e.message}`, "system", "haute");
      }
    }

    if (systemHealth.stuckTasks > 0) {
      try {
        const stuckList = await db.select({ id: tasksTable.id, title: tasksTable.title, description: tasksTable.description })
          .from(tasksTable)
          .where(and(orgTask, eq(tasksTable.status, "en_cours"), sql`${tasksTable.updatedAt} < NOW() - INTERVAL '7 days'`))
          .limit(10);

        if (stuckList.length > 0) {
          for (const task of stuckList) {
            if (task.description && task.description.includes("[Oto-Pilot] Tache bloquee")) continue;
            await db.update(tasksTable).set({ description: sql`COALESCE(${tasksTable.description}, '') || E'\n[Oto-Pilot] Tache bloquee detectee - necessite attention'` }).where(eq(tasksTable.id, task.id));
          }
          autoFixes.push({ action: "flag_stuck_tasks", description: `${stuckList.length} taches bloquees marquees pour attention`, result: "succes" });
          addAutopilotLog(orgId, "fix", `${stuckList.length} taches bloquees flaggees`, "system", "info");
        }
      } catch (e: any) {
        addAutopilotLog(orgId, "error", `Echec marquage taches: ${e.message}`, "system", "haute");
      }
    }

    let geminiDiag: any = null;
    let openaiDiag: any = null;
    let anthropicDiag: any = null;

    const diagPrompt = `Tu es un diagnostic IA pour un systeme de bureau professionnel.
Analyse cet etat du systeme et donne des recommandations specifiques. Reponds en JSON:
{
  "healthScore": number (0-100),
  "diagnosis": "string (resume en 2-3 phrases)",
  "criticalActions": [{"action": "string", "reason": "string", "priority": "critique|haute|moyenne"}],
  "improvements": [{"area": "string", "suggestion": "string", "impact": "fort|moyen|faible"}],
  "predictions": [{"trend": "string", "probability": "haute|moyenne|basse", "recommendation": "string"}]
}

Etat du systeme:\n${JSON.stringify({ ...systemHealth, issuesCount: issues.length, autoFixesApplied: autoFixes.length }, null, 2)}`;

    try {
      const [geminiRes, openaiRes, anthropicRes] = await Promise.allSettled([
        (async () => {
          const { ai } = await import("@workspace/integrations-gemini-ai");
          const r = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: diagPrompt + "\n\nFocus: detection d'anomalies et patterns de donnees" }] }],
            config: { maxOutputTokens: 2048, responseMimeType: "application/json" },
          });
          return JSON.parse(r.text ?? "{}");
        })(),
        (async () => {
          const { openai } = await import("@workspace/integrations-openai-ai-server");
          const r = await openai.chat.completions.create({
            model: "gpt-5.2",
            max_completion_tokens: 2048,
            messages: [
              { role: "system", content: "Tu es un expert en optimisation de processus metier. Reponds en JSON." },
              { role: "user", content: diagPrompt + "\n\nFocus: optimisation des processus et amelioration continue" },
            ],
          });
          return JSON.parse(r.choices[0]?.message?.content ?? "{}");
        })(),
        (async () => {
          const { anthropic } = await import("@workspace/integrations-anthropic-ai");
          const m = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            messages: [
              { role: "user", content: diagPrompt + "\n\nFocus: risques strategiques et recommandations de securite" },
            ],
          });
          const block = m.content[0];
          return JSON.parse(block.type === "text" ? block.text : "{}");
        })(),
      ]);

      geminiDiag = geminiRes.status === "fulfilled" ? geminiRes.value : null;
      openaiDiag = openaiRes.status === "fulfilled" ? openaiRes.value : null;
      anthropicDiag = anthropicRes.status === "fulfilled" ? anthropicRes.value : null;

      if (geminiDiag) addAutopilotLog(orgId, "ai", `Gemini: score ${geminiDiag.healthScore}/100 - ${geminiDiag.diagnosis?.substring(0, 80)}`, "gemini");
      if (openaiDiag) addAutopilotLog(orgId, "ai", `OpenAI: score ${openaiDiag.healthScore}/100 - ${openaiDiag.diagnosis?.substring(0, 80)}`, "openai");
      if (anthropicDiag) addAutopilotLog(orgId, "ai", `Anthropic: score ${anthropicDiag.healthScore}/100 - ${anthropicDiag.diagnosis?.substring(0, 80)}`, "anthropic");
    } catch (e: any) {
      addAutopilotLog(orgId, "error", `Erreur diagnostic multi-AI: ${e.message}`, "system", "haute");
    }

    const scores = [geminiDiag?.healthScore, openaiDiag?.healthScore, anthropicDiag?.healthScore].filter((s): s is number => typeof s === "number" && s > 0);
    const consensusScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 50;

    const allActions = [
      ...(geminiDiag?.criticalActions || []).map((a: any) => ({ ...a, source: "Gemini" })),
      ...(openaiDiag?.criticalActions || []).map((a: any) => ({ ...a, source: "OpenAI" })),
      ...(anthropicDiag?.criticalActions || []).map((a: any) => ({ ...a, source: "Anthropic" })),
    ];
    const allImprovements = [
      ...(geminiDiag?.improvements || []).map((i: any) => ({ ...i, source: "Gemini" })),
      ...(openaiDiag?.improvements || []).map((i: any) => ({ ...i, source: "OpenAI" })),
      ...(anthropicDiag?.improvements || []).map((i: any) => ({ ...i, source: "Anthropic" })),
    ];
    const allPredictions = [
      ...(geminiDiag?.predictions || []).map((p: any) => ({ ...p, source: "Gemini" })),
      ...(openaiDiag?.predictions || []).map((p: any) => ({ ...p, source: "OpenAI" })),
      ...(anthropicDiag?.predictions || []).map((p: any) => ({ ...p, source: "Anthropic" })),
    ];

    let consensusSummary = "";
    try {
      const { ai } = await import("@workspace/integrations-gemini-ai");
      const consensusRes = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: `Tu es le coordinateur de 3 IA (Gemini, OpenAI, Anthropic) qui analysent un systeme de bureau.

Synthétise leurs diagnostics en un rapport de consensus. Identifie:
1. Les points d'accord (tous recommandent la meme chose)
2. Les points de divergence (opinions differentes)
3. La synthese finale et les 3 actions prioritaires

Gemini dit: ${JSON.stringify(geminiDiag?.diagnosis || "non disponible")}
OpenAI dit: ${JSON.stringify(openaiDiag?.diagnosis || "non disponible")}
Anthropic dit: ${JSON.stringify(anthropicDiag?.diagnosis || "non disponible")}

Actions Gemini: ${JSON.stringify(geminiDiag?.criticalActions?.slice(0, 3) || [])}
Actions OpenAI: ${JSON.stringify(openaiDiag?.criticalActions?.slice(0, 3) || [])}
Actions Anthropic: ${JSON.stringify(anthropicDiag?.criticalActions?.slice(0, 3) || [])}

Reponds en JSON:
{
  "consensus": "synthese en 3-4 phrases",
  "agreements": ["point d'accord 1", "point d'accord 2"],
  "divergences": [{"topic": "sujet", "gemini": "avis", "openai": "avis", "anthropic": "avis"}],
  "topActions": [{"action": "string", "agreedBy": ["Gemini", "OpenAI", "Anthropic"], "urgency": "immediate|court_terme|moyen_terme"}],
  "nextCycleRecommendation": "ce que le prochain cycle devrait verifier"
}` }] }],
        config: { maxOutputTokens: 2048, responseMimeType: "application/json" },
      });
      consensusSummary = consensusRes.text || "";
    } catch (e: any) {
      addAutopilotLog(orgId, "error", `Erreur consensus: ${e.message}`, "gemini", "moyenne");
    }

    let parsedConsensus: any = null;
    try { parsedConsensus = consensusSummary ? JSON.parse(consensusSummary) : null; } catch (err) { logger.warn({ err }, "Failed to parse consensus JSON"); }

    const orgState = getOrgAutopilot(orgId);
    orgState.status.cycleCount++;
    orgState.status.fixesApplied += autoFixes.length;
    orgState.status.issuesFound += issues.length;
    orgState.status.lastRun = new Date().toISOString();

    const cycleResult = {
      cycleNumber: orgState.status.cycleCount,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - cycleStart,
      systemHealth,
      issues,
      autoFixes,
      aiDiagnostics: {
        gemini: geminiDiag ? { score: geminiDiag.healthScore, diagnosis: geminiDiag.diagnosis, actions: geminiDiag.criticalActions?.length || 0, improvements: geminiDiag.improvements?.length || 0 } : null,
        openai: openaiDiag ? { score: openaiDiag.healthScore, diagnosis: openaiDiag.diagnosis, actions: openaiDiag.criticalActions?.length || 0, improvements: openaiDiag.improvements?.length || 0 } : null,
        anthropic: anthropicDiag ? { score: anthropicDiag.healthScore, diagnosis: anthropicDiag.diagnosis, actions: anthropicDiag.criticalActions?.length || 0, improvements: anthropicDiag.improvements?.length || 0 } : null,
      },
      consensusScore,
      consensus: parsedConsensus,
      allActions: allActions.slice(0, 10),
      allImprovements: allImprovements.slice(0, 10),
      allPredictions: allPredictions.slice(0, 8),
    };

    addAutopilotLog(orgId, "cycle", `Cycle termine - Score: ${consensusScore}/100, ${issues.length} problemes, ${autoFixes.length} corrections`, "system");
    return cycleResult;
  } catch (err: any) {
    addAutopilotLog(orgId, "error", `Erreur critique cycle: ${err.message}`, "system", "critique");
    throw err;
  }
}

const runningAutopilotJobs = new Map<number, boolean>();

router.post("/ai/autopilot/run", requireAdmin, async (req, res): Promise<void> => {
  const orgId = (req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

  if (runningAutopilotJobs.get(orgId)) {
    res.json({ status: "already_running", message: "Un cycle Oto-Pilot est deja en cours." });
    return;
  }

  try {
    runningAutopilotJobs.set(orgId, true);
    res.json({ status: "started", message: "Cycle Oto-Pilot lance en arriere-plan." });

    runAutopilotCycle(orgId).catch((err: any) => {
      logger.error({ err }, "Autopilot background run error");
      addAutopilotLog(orgId, "error", `Cycle echoue: ${err.message}`, "system", "haute");
    }).finally(() => {
      runningAutopilotJobs.delete(orgId);
    });
  } catch (err: any) {
    runningAutopilotJobs.delete(orgId);
    res.status(500).json({ error: "Erreur cycle Oto-Pilot", details: err.message });
  }
});

router.post("/ai/autopilot/start", requireAdmin, async (req, res): Promise<void> => {
  const orgId = (req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

  const state = getOrgAutopilot(orgId);
  if (state.interval) {
    res.json({ status: "active", message: "Oto-Pilot deja actif", ...state.status });
    return;
  }

  state.status.active = true;
  addAutopilotLog(orgId, "system", "Oto-Pilot active - mode surveillance continue");

  const firstResult = await runAutopilotCycle(orgId).catch((e) => {
    addAutopilotLog(orgId, "error", `Premier cycle echoue: ${e.message}`, "system", "haute");
    return null;
  });

  state.interval = setInterval(async () => {
    const s = getOrgAutopilot(orgId);
    if (s.running) return;
    s.running = true;
    try {
      await runAutopilotCycle(orgId);
    } catch (e: any) {
      addAutopilotLog(orgId, "error", `Cycle automatique echoue: ${e.message}`, "system", "haute");
    } finally {
      s.running = false;
    }
  }, 30 * 60 * 1000);

  res.json({
    status: "active",
    message: "Oto-Pilot active - cycles toutes les 30 minutes",
    ...state.status,
    firstCycle: firstResult,
  });
});

router.post("/ai/autopilot/stop", requireAdmin, async (req, res): Promise<void> => {
  const orgId = (req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

  const state = getOrgAutopilot(orgId);
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }
  state.status.active = false;
  addAutopilotLog(orgId, "system", "Oto-Pilot desactive");
  res.json({ status: "inactive", message: "Oto-Pilot desactive", ...state.status });
});

router.get("/ai/autopilot/status", requireMinAgent, async (req, res): Promise<void> => {
  const orgId = (req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

  const state = getOrgAutopilot(orgId);
  res.json({
    ...state.status,
    recentLogs: state.log.slice(-30),
  });
});

router.get("/ai/autopilot/logs", requireMinAgent, async (req, res): Promise<void> => {
  const orgId = (req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

  const state = getOrgAutopilot(orgId);
  res.json({ logs: state.log, total: state.log.length });
});

router.post("/ai/agents/auto-fix", requireAdmin, async (req, res): Promise<void> => {
  try {
    const orgId = (req.session as any)?.organisationId;
    const userId = (req.session as any)?.userId;
    if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const orgCall = eq(callsTable.organisationId, orgId);
    const orgTask = eq(tasksTable.organisationId, orgId);
    const orgMsg = eq(messagesTable.organisationId, orgId);
    const orgContact = eq(contactsTable.organisationId, orgId);

    const fixes: { type: string; description: string; count: number; details: string }[] = [];

    const orphanCalls = await db.select({ id: callsTable.id, phoneNumber: callsTable.phoneNumber })
      .from(callsTable)
      .where(and(orgCall, isNull(callsTable.contactId), isNotNull(callsTable.phoneNumber)))
      .limit(100);

    let linkedCount = 0;
    for (const call of orphanCalls) {
      if (!call.phoneNumber) continue;
      const clean = call.phoneNumber.replace(/\s/g, "");
      const [contact] = await db.select({ id: contactsTable.id })
        .from(contactsTable)
        .where(and(orgContact, sql`replace(${contactsTable.phone}, ' ', '') = ${clean}`))
        .limit(1);
      if (contact) {
        await db.update(callsTable).set({ contactId: contact.id }).where(eq(callsTable.id, call.id));
        linkedCount++;
      }
    }
    if (linkedCount > 0) {
      fixes.push({ type: "orphan_calls_linked", description: "Appels orphelins lies a leurs contacts", count: linkedCount, details: `${linkedCount} appels retrouves par numero de telephone` });
    }

    const overdueTasks = await db.select({ id: tasksTable.id, title: tasksTable.title, priority: tasksTable.priority })
      .from(tasksTable)
      .where(and(orgTask, lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), ne(tasksTable.priority, "haute")))
      .limit(50);

    if (overdueTasks.length > 0) {
      const overdueIds = overdueTasks.map(t => t.id);
      for (const id of overdueIds) {
        await db.update(tasksTable).set({ priority: "haute" }).where(eq(tasksTable.id, id));
      }
      fixes.push({ type: "overdue_tasks_escalated", description: "Taches en retard escaladees en haute priorite", count: overdueTasks.length, details: overdueTasks.map(t => t.title).join(", ") });
    }

    const stuckTasks = await db.select({ id: tasksTable.id, title: tasksTable.title })
      .from(tasksTable)
      .where(and(orgTask, eq(tasksTable.status, "en_cours"), lt(tasksTable.updatedAt, weekAgo)))
      .limit(30);

    if (stuckTasks.length > 0) {
      for (const task of stuckTasks) {
        await db.insert(notificationsTable).values({
          userId: userId,
          organisationId: orgId,
          title: `Tache bloquee: ${task.title}`,
          message: `Cette tache est en cours depuis plus de 7 jours sans mise a jour.`,
          type: "alerte",
          priority: "haute",
        });
      }
      fixes.push({ type: "stuck_tasks_notified", description: "Notifications envoyees pour les taches bloquees", count: stuckTasks.length, details: stuckTasks.map(t => t.title).join(", ") });
    }

    const staleMessages = await db.select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(orgMsg, eq(messagesTable.isRead, false), eq(messagesTable.priority, "haute"), lt(messagesTable.createdAt, new Date(now.getTime() - 48 * 3600000))))
      .limit(20);

    if (staleMessages.length > 0) {
      for (const msg of staleMessages) {
        await db.insert(notificationsTable).values({
          userId: userId,
          organisationId: orgId,
          title: "Message urgent non lu depuis 48h",
          message: `Un message prioritaire attend votre attention.`,
          type: "rappel",
          priority: "urgente",
        });
      }
      fixes.push({ type: "stale_messages_alerted", description: "Alertes pour messages urgents non lus depuis 48h+", count: staleMessages.length, details: `${staleMessages.length} messages urgents en attente` });
    }

    const contactsNoEmail = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, phone: contactsTable.phone })
      .from(contactsTable)
      .where(and(orgContact, isNull(contactsTable.email), isNotNull(contactsTable.phone), isNotNull(contactsTable.firstName)))
      .limit(20);

    const contactsNoPhone = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, email: contactsTable.email })
      .from(contactsTable)
      .where(and(orgContact, isNull(contactsTable.phone), isNotNull(contactsTable.email), isNotNull(contactsTable.firstName)))
      .limit(20);

    const incompleteContacts = contactsNoEmail.length + contactsNoPhone.length;
    if (incompleteContacts > 0) {
      fixes.push({ type: "incomplete_contacts_flagged", description: "Contacts avec donnees incompletes signales", count: incompleteContacts, details: `${contactsNoEmail.length} sans email, ${contactsNoPhone.length} sans telephone` });
    }

    const duplicatePhones = await db.execute(sql`
      SELECT phone, count(*) as cnt 
      FROM contacts 
      WHERE organisation_id = ${orgId} AND phone IS NOT NULL AND phone != ''
      GROUP BY phone 
      HAVING count(*) > 1 
      LIMIT 20
    `);
    const dupCount = Array.isArray(duplicatePhones.rows) ? duplicatePhones.rows.length : 0;
    if (dupCount > 0) {
      const dupDetails = duplicatePhones.rows.map((r: any) => `${r.phone} (${r.cnt}x)`).join(", ");
      for (const dup of duplicatePhones.rows.slice(0, 5)) {
        await db.insert(notificationsTable).values({
          userId: userId,
          organisationId: orgId,
          title: `Contact en double: ${(dup as any).phone}`,
          message: `${(dup as any).cnt} contacts partagent le numero ${(dup as any).phone}. Verifiez et fusionnez si necessaire.`,
          type: "alerte",
          priority: "moyenne",
        });
      }
      fixes.push({ type: "duplicate_contacts_flagged", description: "Doublons de contacts detectes par numero de telephone", count: dupCount, details: dupDetails });
    }

    const contactsNoCategory = await db.select({ id: contactsTable.id })
      .from(contactsTable)
      .where(and(orgContact, or(isNull(contactsTable.category), eq(contactsTable.category, "autre"))))
      .limit(50);
    let categorizedCount = 0;
    for (const c of contactsNoCategory) {
      const [callInfo] = await db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.contactId, c.id)));
      const [taskInfo] = await db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.relatedContactId, c.id)));
      const callCount = callInfo?.count ?? 0;
      const taskCount = taskInfo?.count ?? 0;
      if (callCount >= 3 || taskCount >= 2) {
        await db.update(contactsTable).set({ category: "client" }).where(eq(contactsTable.id, c.id));
        categorizedCount++;
      } else if (callCount === 1 || taskCount === 1) {
        await db.update(contactsTable).set({ category: "prospect" }).where(eq(contactsTable.id, c.id));
        categorizedCount++;
      }
    }
    if (categorizedCount > 0) {
      fixes.push({ type: "contacts_auto_categorized", description: "Contacts categorises automatiquement selon activite", count: categorizedCount, details: `${categorizedCount} contacts recategorises (client/prospect) selon leur historique d'appels et taches` });
    }

    let zeroQuantityFixed = 0;
    try {
      const orgStock = eq(stockArticlesTable.organisationId, orgId);
      const negativeStock = await db.select({ id: stockArticlesTable.id })
        .from(stockArticlesTable)
        .where(and(orgStock, sql`${stockArticlesTable.quantity} < 0`))
        .limit(50);
      for (const item of negativeStock) {
        await db.update(stockArticlesTable).set({ quantity: 0 }).where(eq(stockArticlesTable.id, item.id));
        zeroQuantityFixed++;
      }
      if (zeroQuantityFixed > 0) {
        fixes.push({ type: "negative_stock_fixed", description: "Quantites de stock negatives corrigees a zero", count: zeroQuantityFixed, details: `${zeroQuantityFixed} articles avaient des quantites negatives` });
      }
    } catch (e) { console.warn("[AIAgents] stock auto-fix skipped:", (e as Error).message); }

    await db.insert(auditLogsTable).values({
      userId: userId,
      action: "ai_auto_fix",
      resource: "system",
      resourceId: "auto-fix",
      details: { fixes, totalFixes: fixes.reduce((s, f) => s + f.count, 0), executedAt: now.toISOString() },
    });

    res.json({
      success: true,
      totalFixes: fixes.reduce((s, f) => s + f.count, 0),
      fixes,
      executedAt: now.toISOString(),
    });
  } catch (error: any) {
    logger.error({ err: error }, "AI auto-fix error");
    res.status(500).json({ error: "Erreur lors de l'auto-correction" });
  }
});

router.get("/ai/anomalies", requireMinAgent, async (req, res): Promise<void> => {
  try {
    const orgId = (req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
    const dayAgo = new Date(now.getTime() - 86400000);
    const orgCall = eq(callsTable.organisationId, orgId);
    const orgTask = eq(tasksTable.organisationId, orgId);
    const orgMsg = eq(messagesTable.organisationId, orgId);
    const orgStock = eq(stockArticlesTable.organisationId, orgId);
    const orgUser = eq(usersTable.organisationId, orgId);

    const anomalies: { type: string; severity: "critique" | "haute" | "moyenne" | "basse"; title: string; description: string; metric?: string; suggestedAction?: string }[] = [];

    const [
      callsThisWeek, callsPrevWeek,
      missedToday,
      tasksOverdue, stuckTasks,
      unreadMsgs, urgentUnread,
      outOfStock, lowStock,
      inactiveUsers, noMfaAdmins,
    ] = await Promise.all([
      db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, dayAgo))),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "en_cours"), lt(tasksTable.updatedAt, weekAgo))),
      db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))),
      db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false), eq(messagesTable.priority, "haute"))),
      db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, eq(stockArticlesTable.quantity, 0))),
      db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, sql`${stockArticlesTable.quantity} <= ${stockArticlesTable.minQuantity}`, sql`${stockArticlesTable.quantity} > 0`)),
      db.select({ count: count() }).from(usersTable).where(and(orgUser, eq(usersTable.actif, true), or(isNull(usersTable.dernierAcces), lt(usersTable.dernierAcces, twoWeeksAgo)))),
      db.select({ count: count() }).from(usersTable).where(and(orgUser, eq(usersTable.actif, true), or(eq(usersTable.role, "super_admin"), eq(usersTable.role, "administrateur")), eq(usersTable.mfaActif, false))),
    ]);

    const curCalls = callsThisWeek[0]?.count ?? 0;
    const prevCalls = callsPrevWeek[0]?.count ?? 0;
    if (prevCalls > 0 && curCalls < prevCalls * 0.6) {
      anomalies.push({ type: "volume_drop", severity: "haute", title: "Chute du volume d'appels", description: `${curCalls} appels cette semaine vs ${prevCalls} la semaine precedente (-${Math.round((1 - curCalls / prevCalls) * 100)}%)`, metric: `${curCalls}/${prevCalls}`, suggestedAction: "Verifier les canaux de communication et les horaires de l'equipe" });
    }
    if (prevCalls > 0 && curCalls > prevCalls * 1.5) {
      anomalies.push({ type: "volume_spike", severity: "moyenne", title: "Pic d'appels inhabituel", description: `${curCalls} appels cette semaine vs ${prevCalls} la semaine precedente (+${Math.round((curCalls / prevCalls - 1) * 100)}%)`, metric: `${curCalls}/${prevCalls}`, suggestedAction: "Verifier si une campagne ou un evenement a genere un afflux" });
    }

    const missedCount = missedToday[0]?.count ?? 0;
    if (missedCount > 5) {
      anomalies.push({ type: "missed_calls", severity: missedCount > 10 ? "critique" : "haute", title: "Trop d'appels manques aujourd'hui", description: `${missedCount} appels manques aujourd'hui`, metric: `${missedCount}`, suggestedAction: "Augmenter les effectifs ou revoir les plages horaires" });
    }

    const overdueCount = tasksOverdue[0]?.count ?? 0;
    if (overdueCount > 0) {
      anomalies.push({ type: "overdue_tasks", severity: overdueCount > 10 ? "critique" : overdueCount > 5 ? "haute" : "moyenne", title: `${overdueCount} taches en retard`, description: `${overdueCount} taches ont depasse leur echeance sans etre terminees`, metric: `${overdueCount}`, suggestedAction: "Escalader les taches critiques et replanifier les autres" });
    }

    const stuckCount = stuckTasks[0]?.count ?? 0;
    if (stuckCount > 0) {
      anomalies.push({ type: "stuck_tasks", severity: stuckCount > 5 ? "haute" : "moyenne", title: `${stuckCount} taches bloquees`, description: `${stuckCount} taches "en cours" sans mise a jour depuis plus de 7 jours`, metric: `${stuckCount}`, suggestedAction: "Contacter les responsables et debloquer les obstacles" });
    }

    const unreadCount = unreadMsgs[0]?.count ?? 0;
    const urgentCount = urgentUnread[0]?.count ?? 0;
    if (urgentCount > 0) {
      anomalies.push({ type: "urgent_messages", severity: urgentCount > 3 ? "critique" : "haute", title: `${urgentCount} messages urgents non lus`, description: `${urgentCount} messages de haute priorite attendent une reponse`, metric: `${urgentCount}`, suggestedAction: "Traiter immediatement les messages urgents" });
    }
    if (unreadCount > 20) {
      anomalies.push({ type: "message_backlog", severity: "moyenne", title: `${unreadCount} messages non lus accumules`, description: `L'accumulation de messages non lus indique un probleme de traitement`, metric: `${unreadCount}`, suggestedAction: "Organiser une session de traitement des messages" });
    }

    const oos = outOfStock[0]?.count ?? 0;
    const ls = lowStock[0]?.count ?? 0;
    if (oos > 0) {
      anomalies.push({ type: "out_of_stock", severity: "critique", title: `${oos} articles en rupture de stock`, description: `${oos} articles ont un stock a zero — commandes impossibles`, metric: `${oos}`, suggestedAction: "Commander immediatement les articles en rupture" });
    }
    if (ls > 3) {
      anomalies.push({ type: "low_stock", severity: "haute", title: `${ls} articles en stock bas`, description: `${ls} articles sont en dessous du seuil minimum`, metric: `${ls}`, suggestedAction: "Planifier un reapprovisionnement preventif" });
    }

    const inactive = inactiveUsers[0]?.count ?? 0;
    if (inactive > 0) {
      anomalies.push({ type: "inactive_users", severity: "basse", title: `${inactive} utilisateurs inactifs`, description: `${inactive} utilisateurs actifs ne se sont pas connectes depuis 2 semaines`, metric: `${inactive}`, suggestedAction: "Verifier les comptes et desactiver si necessaire" });
    }

    const noMfa = noMfaAdmins[0]?.count ?? 0;
    if (noMfa > 0) {
      anomalies.push({ type: "security_risk", severity: "haute", title: `${noMfa} admins sans MFA`, description: `${noMfa} comptes administrateurs n'ont pas active l'authentification a deux facteurs`, metric: `${noMfa}`, suggestedAction: "Forcer l'activation du MFA pour tous les administrateurs" });
    }

    anomalies.sort((a, b) => {
      const sev = { critique: 0, haute: 1, moyenne: 2, basse: 3 };
      return (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3);
    });

    const globalSeverity = anomalies.length === 0 ? "ok" : anomalies[0].severity;

    res.json({
      anomalies,
      summary: {
        total: anomalies.length,
        critique: anomalies.filter(a => a.severity === "critique").length,
        haute: anomalies.filter(a => a.severity === "haute").length,
        moyenne: anomalies.filter(a => a.severity === "moyenne").length,
        basse: anomalies.filter(a => a.severity === "basse").length,
      },
      globalSeverity,
      checkedAt: now.toISOString(),
    });
  } catch (error: any) {
    logger.error({ err: error }, "Anomaly detection error");
    res.status(500).json({ error: "Erreur lors de la detection d'anomalies" });
  }
});

export default router;
