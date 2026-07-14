import { Router } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, checkinsTable, aiAgentReportsTable, stockArticlesTable, invoicesTable, paymentsTable, subscriptionsTable, usersTable, automationRulesTable, notificationsTable, auditLogsTable, calendarEventsTable, projetsTable, organisationsTable } from "@workspace/db";
import { sql, eq, gte, lte, and, count, desc, lt, ne, isNull, isNotNull, or, sum, avg, inArray } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { assertAiQuota, AiQuotaExceededError, invalidateQuotaCache, reserveAiCall } from "../services/ai-quota";
import { extractGeminiTokens, extractOpenAITokens, extractAnthropicTokens, recordAiUsage, geminiActualModel, GEMINI_PRO_MODEL, GEMINI_FLASH_MODEL, sanitizePromptInput } from "../services/ai-utils";
import { callOrgGemini, callOrgOpenAI } from "../services/ai-providers";
import { withProviderTimeout, buildAiCacheKey, getCached, setCached, AI_CACHE_TTL } from "../services/ai-cache";
import { openSseStream, multiAiGenerateStream, StreamAbortedError } from "../services/ai-stream";
import { buildLearnedContextBlock } from "../services/ai-learning";
import { logger } from "../lib/logger";
import { EventEmitter } from "events";

const router = Router();

const requireAdmin = requireRole("super_admin", "administrateur");
const requireMinAgent = requireRole("super_admin", "administrateur", "agent");

const AGENTS = [
  { id: "agent_appels", name: "Tom · Agent Appels", icon: "phone", domain: "Gestion des appels telephoniques et suivi client", persona: "Tom", tagline: "Le standardiste IA qui ne rate aucun appel" },
  { id: "agent_contacts", name: "Lea · Agent CRM", icon: "users", domain: "Gestion CRM, contacts et relations commerciales", persona: "Lea", tagline: "La gardienne de vos relations clients" },
  { id: "agent_taches", name: "Max · Agent Productivite", icon: "clipboard", domain: "Gestion des taches, projets et productivite", persona: "Max", tagline: "Le chef d'orchestre de vos taches" },
  { id: "agent_messages", name: "Iris · Agent Communication", icon: "mail", domain: "Gestion des messages, notifications et flux de communication", persona: "Iris", tagline: "La voix de votre equipe" },
  { id: "agent_pointage", name: "Hugo · Agent Presences", icon: "clock", domain: "Gestion du temps, presences et planification RH", persona: "Hugo", tagline: "Le maitre du temps et des presences" },
  { id: "agent_facturation", name: "Clara · Agent Facturation", icon: "receipt", domain: "Facturation, paiements, abonnements et tresorerie", persona: "Clara", tagline: "La fee des finances et de la tresorerie" },
  { id: "agent_stock", name: "Victor · Agent Stock", icon: "package", domain: "Gestion des stocks, inventaire et approvisionnement", persona: "Victor", tagline: "Le gardien de vos stocks" },
  { id: "agent_rh", name: "Rony · Agent RH", icon: "user-cog", domain: "Ressources humaines, comptes employes et conformite", persona: "Rony", tagline: "Le coach RH de votre equipe" },
  { id: "agent_securite", name: "Sentinel · Agent Securite", icon: "shield", domain: "Securite, audit, conformite RGPD et tracabilite", persona: "Sentinel", tagline: "Le veilleur silencieux de votre conformite" },
  { id: "agent_performance", name: "Kai · Agent Performance", icon: "trending-up", domain: "Performance globale, KPIs strategiques et benchmarks", persona: "Kai", tagline: "Le stratege qui decode vos KPIs" },
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
        db.select({ count: count() }).from(callsTable).where(and(orgCall, or(eq(callsTable.sentiment, "negatif"), eq(callsTable.sentiment, "tres_negatif")), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.notes), gte(callsTable.createdAt, weekAgo), eq(callsTable.status, "repondu"))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.duration, 600), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, monthAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.direction, "entrant"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.direction, "sortant"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, or(eq(callsTable.sentiment, "positif"), eq(callsTable.sentiment, "tres_positif")), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, lt(callsTable.duration, 30), eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, dayAgo))),
        db.select({ direction: callsTable.direction, cnt: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))).groupBy(callsTable.direction),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "repondu"), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, or(eq(callsTable.sentiment, "negatif"), eq(callsTable.sentiment, "tres_negatif")), gte(callsTable.createdAt, twoWeeksAgo), lt(callsTable.createdAt, weekAgo))),
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
      const orgProjet = eq(projetsTable.organisationId, orgId);
      const [projetsTotal, projetsActifs, projetsTermines, projetsEnRetard] = await Promise.all([
        db.select({ count: count() }).from(projetsTable).where(orgProjet),
        db.select({ count: count() }).from(projetsTable).where(and(orgProjet, eq(projetsTable.status, "en_cours"))),
        db.select({ count: count() }).from(projetsTable).where(and(orgProjet, eq(projetsTable.status, "termine"))),
        db.select({ count: count() }).from(projetsTable).where(and(orgProjet, lt(projetsTable.endDate, new Date()), ne(projetsTable.status, "termine"), ne(projetsTable.status, "annule"))),
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
        projets: { total: projetsTotal[0]?.count ?? 0, actifs: projetsActifs[0]?.count ?? 0, termines: projetsTermines[0]?.count ?? 0, enRetard: projetsEnRetard[0]?.count ?? 0 },
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
        prevCalls, prevAnswered, prevCompletedTasks, prevCheckins, totalInvoices, unpaidInvoices, totalUsers, activeUsers, negativeSentiment, outOfStock, projetsActifsPerf
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
        db.select({ count: count() }).from(callsTable).where(and(orgCall, or(eq(callsTable.sentiment, "negatif"), eq(callsTable.sentiment, "tres_negatif")), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(stockArticlesTable).where(and(eq(stockArticlesTable.organisationId, orgId), eq(stockArticlesTable.quantity, 0))),
        db.select({ count: count() }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), eq(projetsTable.status, "en_cours"))),
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
        crossDomain: { totalEmployees: totalUsers[0]?.count ?? 0, activeEmployees: activeUsers[0]?.count ?? 0, totalInvoices: totalInvoices[0]?.count ?? 0, unpaidInvoices: unpaidInvoices[0]?.count ?? 0, outOfStockItems: outOfStock[0]?.count ?? 0, projetsActifs: projetsActifsPerf[0]?.count ?? 0 },
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
8. PROJETS: Portefeuille projets (champ "projets" dans les donnees) — actifs/termines/en retard?

Utilise les chiffres: "Velocity en baisse de 30% (5 taches cette semaine vs 7 la precedente). Backlog de 12 taches en retard = 8.5 jours de travail au rythme actuel. 3 projets actifs dont 1 depassant sa deadline".`,

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

// --- Conseil IA (multi-modèles) -------------------------------------------
// Chaque agent peut consulter plusieurs modèles de pointe (Gemini, GPT, Claude)
// EN PARALLÈLE, puis un modèle synthétise les analyses en un consensus. C'est le
// "Conseil IA / Yapay Zeka Ekibi". Repli séquentiel si AI_COUNCIL_DISABLED=1.

type CouncilMember = { text: string; model: string };

// Modele de l'ancre Gemini. Par defaut Flash (rapide ~5-10s) plutot que Pro
// (~35-45s avec budget de reflexion): l'ancre doit produire le rapport "quasi
// instantanement" pour que l'execution autonome reste rapide et fiable. Le
// budget de reflexion reste configurable via env. (Pro restait trop lent meme
// seul -> l'anti-blocage du conseil ne pouvait rien y faire.)
// Lit un entier >= 0 depuis l'env en preservant la valeur 0 explicite
// (contrairement a `Number(x) || def` qui ecrase 0). Sinon -> defaut.
function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

const AGENT_GEMINI_MODEL = process.env.AI_AGENT_GEMINI_MODEL || GEMINI_FLASH_MODEL;
const AGENT_THINKING_BUDGET = envInt("AI_AGENT_THINKING_BUDGET", 512);

async function callGeminiAgent(agentId: string, orgId: number, prompt: string, signal: AbortSignal | undefined, t0: number): Promise<CouncilMember> {
  const { ai } = await import("@workspace/integrations-gemini-ai");
  const response = await withProviderTimeout(() => ai.models.generateContent({
    model: AGENT_GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { maxOutputTokens: 8192, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: AGENT_THINKING_BUDGET }, ...(signal ? { abortSignal: signal } : {}) } as any,
  }), { timeoutMs: 45_000, label: `agent-${agentId}-gemini` });
  const tokens = extractGeminiTokens(response);
  recordAiUsage({ organisationId: orgId, provider: "gemini", model: geminiActualModel(response, AGENT_GEMINI_MODEL), route: `/ai/agents/${agentId}`, inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0 }).catch(() => {});
  invalidateQuotaCache(orgId);
  return { text: response.text ?? "{}", model: "Gemini" };
}

async function callOpenAIAgent(agentId: string, orgId: number, prompt: string, signal: AbortSignal | undefined, t0: number): Promise<CouncilMember> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const resp = await withProviderTimeout(() => openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt + "\n\nReponds UNIQUEMENT en JSON valide." }],
  }, signal ? { signal } as any : undefined), { timeoutMs: 45_000, label: `agent-${agentId}-openai` });
  const ftokens = extractOpenAITokens(resp);
  recordAiUsage({ organisationId: orgId, provider: "openai", model: "gpt-5.2", route: `/ai/agents/${agentId}`, inputTokens: ftokens.input, outputTokens: ftokens.output, durationMs: Date.now() - t0 }).catch(() => {});
  invalidateQuotaCache(orgId);
  return { text: resp.choices?.[0]?.message?.content ?? "{}", model: "GPT (OpenAI)" };
}

async function callAnthropicAgent(agentId: string, orgId: number, prompt: string, signal: AbortSignal | undefined, t0: number): Promise<CouncilMember> {
  const { anthropic, resolveClaudeModelId } = await import("@workspace/integrations-anthropic-ai");
  const resp: any = await withProviderTimeout(() => (anthropic.messages.create as any)({
    model: resolveClaudeModelId("claude-sonnet-4-6"),
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt + "\n\nReponds UNIQUEMENT en JSON valide." }],
  }, signal ? { signal } : undefined), { timeoutMs: 45_000, label: `agent-${agentId}-anthropic` });
  const atokens = extractAnthropicTokens(resp);
  recordAiUsage({ organisationId: orgId, provider: "anthropic", model: "claude-sonnet-4-6", route: `/ai/agents/${agentId}`, inputTokens: atokens.input, outputTokens: atokens.output, durationMs: Date.now() - t0 }).catch(() => {});
  invalidateQuotaCache(orgId);
  const txt = resp.content?.[0]?.type === "text" ? resp.content[0].text : "{}";
  return { text: txt, model: "Claude (Anthropic)" };
}

function isAbortLike(err: any): boolean {
  return err?.message === "aborted" || err?.name === "APIUserAbortError";
}

function buildSynthesisPrompt(members: CouncilMember[]): string {
  const analyses = members.map((m, i) => `### Analyse ${i + 1} — ${m.model}\n${m.text}`).join("\n\n");
  return `Tu es le COORDINATEUR d'un conseil d'experts IA. ${members.length} experts independants (${members.map((m) => m.model).join(", ")}) ont analyse la MEME situation et rendu chacun leur rapport JSON ci-dessous.

Ta mission: produire UNE SEULE analyse consensuelle, la MEILLEURE possible:
- Garde les constats sur lesquels plusieurs experts s'accordent (fiabilite elevee).
- Integre les meilleures idees uniques d'un seul expert si elles sont pertinentes.
- Elimine les doublons, les contradictions et les hallucinations evidentes.
- Reste STRICTEMENT dans le meme format JSON que les rapports recus.

Rapports des experts:
${analyses}

Reponds UNIQUEMENT avec le JSON consensuel final, sans aucun texte avant ou apres.`;
}

async function runAgentReasoning(
  agentId: string,
  orgId: number,
  prompt: string,
  signal: AbortSignal | undefined,
  councilEnabled: boolean,
  t0: number,
): Promise<{ text: string; models: string[]; synthesized: boolean }> {
  const checkAbort = () => { if (signal?.aborted) throw new Error("aborted"); };
  const providers: Array<() => Promise<CouncilMember>> = [
    () => callGeminiAgent(agentId, orgId, prompt, signal, t0),
    () => callOpenAIAgent(agentId, orgId, prompt, signal, t0),
    () => callAnthropicAgent(agentId, orgId, prompt, signal, t0),
  ];

  // Repli séquentiel: premier modèle qui répond gagne (ancien comportement).
  if (!councilEnabled) {
    let lastErr: any;
    for (const call of providers) {
      checkAbort();
      try {
        const m = await call();
        if (m.text && m.text.length > 10) return { text: m.text, models: [m.model], synthesized: false };
      } catch (err: any) {
        if (err instanceof AiQuotaExceededError) throw err;
        if (signal?.aborted || isAbortLike(err)) throw err;
        lastErr = err;
        logger.warn({ err, agentId }, "[council] fournisseur en echec (mode repli)");
      }
    }
    throw new Error(`Tous les fournisseurs IA ont echoue pour ${agentId}: ${lastErr?.message ?? "inconnu"}`);
  }

  // Mode conseil "ancre + enrichissement": Gemini est l'ancre rapide et fiable
  // (seul fournisseur qui termine le rapport complet dans le budget). On lance
  // les 3 modeles en parallele, mais on ne bloque JAMAIS sur les fournisseurs
  // lents: des que l'ancre repond, on accorde une courte fenetre de grace aux
  // autres pour enrichir la synthese, puis on annule les retardataires (latence
  // bornee + economie de quota). Si l'ancre echoue, on attend les autres comme
  // filet de securite. Resultat: rapports en ~temps Gemini (~5-10s), quasi
  // jamais d'echec total, plus d'attente de 45s a vide.
  const providerNames = ["Gemini", "OpenAI", "Anthropic"];
  // Fenetre de grace courte: l'ancre (Gemini) suffit a produire le rapport;
  // OpenAI/Anthropic n'enrichissent QUE s'ils repondent dans ce delai, sinon on
  // n'attend pas (et on les annule). Court par defaut car les secondaires sont
  // lents via le proxy -> sinon c'est de la latence pure. Ajustable via env.
  const graceMs = envInt("AI_COUNCIL_GRACE_MS", 2000);

  // Signal combine: annulation externe (abort utilisateur) OU interne (retardataires).
  const localAbort = new AbortController();
  const onExternalAbort = () => localAbort.abort();
  if (signal) {
    if (signal.aborted) localAbort.abort();
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const provSignal = localAbort.signal;

  const councilProviders: Array<() => Promise<CouncilMember>> = [
    () => callGeminiAgent(agentId, orgId, prompt, provSignal, t0),
    () => callOpenAIAgent(agentId, orgId, prompt, provSignal, t0),
    () => callAnthropicAgent(agentId, orgId, prompt, provSignal, t0),
  ];

  const results: Array<CouncilMember | null> = [null, null, null];
  const errs: any[] = [null, null, null];
  const tasks = councilProviders.map((fn, i) =>
    fn().then(
      (m) => { results[i] = m; },
      (err) => {
        errs[i] = err;
        // Ne pas spammer les logs pour les annulations volontaires (retardataires).
        if (!isAbortLike(err) && !signal?.aborted) {
          logger.warn(
            { agentId, provider: providerNames[i], errMsg: err?.message, errName: err?.name, status: err?.status },
            "[council] fournisseur en echec",
          );
        }
      },
    ),
  );

  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  try {
    // 1) Attendre l'ancre (Gemini) en priorite.
    await tasks[0];
    if (results[0]) {
      // Ancre OK -> courte fenetre de grace pour enrichir avec OpenAI/Anthropic.
      await Promise.race([Promise.allSettled([tasks[1], tasks[2]]), delay(graceMs)]);
    } else {
      // Ancre KO -> filet de securite: on attend les autres jusqu'a leur timeout.
      await Promise.allSettled([tasks[1], tasks[2]]);
    }
  } finally {
    // Annule les retardataires (cout + latence) et nettoie le listener externe.
    localAbort.abort();
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }

  // Propager une eventuelle erreur de quota / annulation utilisateur.
  for (const e of errs) { if (e instanceof AiQuotaExceededError) throw e; }
  checkAbort();

  const members = results.filter(
    (m): m is CouncilMember => !!m && !!m.text && m.text.length > 10,
  );

  if (members.length === 0) {
    const lastErr = errs.find((e) => e);
    throw new Error(`Tous les fournisseurs IA ont echoue pour ${agentId}: ${lastErr?.message ?? "inconnu"}`);
  }
  if (members.length === 1) return { text: members[0].text, models: [members[0].model], synthesized: false };

  // Synthèse: Gemini fusionne les analyses indépendantes en un consensus.
  // (signal externe uniquement: provSignal est deja annule a ce stade.)
  checkAbort();
  try {
    const synth = await callGeminiAgent(agentId, orgId, buildSynthesisPrompt(members), signal, t0);
    if (synth.text && synth.text.length > 10) {
      return { text: synth.text, models: members.map((m) => m.model), synthesized: true };
    }
  } catch (err: any) {
    if (err instanceof AiQuotaExceededError) throw err;
    if (signal?.aborted || isAbortLike(err)) throw err;
    logger.warn({ err, agentId }, "[council] synthese en echec, on garde le meilleur membre");
  }
  // Repli: le membre le plus détaillé.
  const best = members.slice().sort((a, b) => b.text.length - a.text.length)[0];
  return { text: best.text, models: members.map((m) => m.model), synthesized: false };
}

// ---------------------------------------------------------------------------
// Veille / recherche autonome continue.
//
// Chaque agent enrichit son analyse avec une veille web fraiche et sourcee
// (recherche Google via le grounding Gemini, deja filtree antivirus dans
// services/web-search.ts). Pour borner le cout, le resultat est mis en cache
// une fois par jour et par (organisation, agent). Tout echec est silencieux
// (fail-soft) : la veille ne doit JAMAIS casser la generation d'un rapport.
// Desactivable via AI_AGENT_RESEARCH_DISABLED=1.
// ---------------------------------------------------------------------------
const AGENT_RESEARCH_QUERIES: Record<string, string> = {
  agent_appels: "tendances accueil telephonique et relation client PME France bonnes pratiques",
  agent_contacts: "bonnes pratiques CRM, fidelisation et reactivation client PME France",
  agent_taches: "methodes de productivite et gestion de projet en equipe PME France",
  agent_messages: "bonnes pratiques communication client et email professionnel PME France",
  agent_pointage: "reglementation temps de travail et pointage des salaries en France",
  agent_facturation: "facturation electronique obligatoire, recouvrement des impayes et tresorerie PME France",
  agent_stock: "optimisation de la gestion des stocks et de l'approvisionnement PME",
  agent_rh: "actualite du droit du travail et RH pour les PME en France",
  agent_securite: "dernieres menaces cybersecurite et obligations RGPD pour les PME France",
  agent_performance: "indicateurs KPI et benchmarks de performance des PME France",
};

interface AgentResearchPayload {
  query: string;
  answer: string;
  sources: { title: string; url: string; domain: string }[];
  fetchedAt: string;
}

async function buildAgentResearch(
  agent: typeof AGENTS[0],
  orgId: number,
  today: string,
): Promise<{ context: string; payload: AgentResearchPayload | null }> {
  if (process.env.AI_AGENT_RESEARCH_DISABLED === "1") return { context: "", payload: null };

  const year = new Date().getFullYear();
  const baseQuery = AGENT_RESEARCH_QUERIES[agent.id] ?? `${agent.domain} — bonnes pratiques et actualite PME France`;
  const query = `${baseQuery} ${year}`;

  const cacheKey = buildAiCacheKey({
    route: "/ai/agents/research",
    organisationId: orgId,
    input: { day: today, agent: agent.id },
  });
  const cached = getCached<AgentResearchPayload>(cacheKey);
  if (cached) return { context: formatResearchContext(cached), payload: cached };

  try {
    const { searchWebWithSafety } = await import("../services/web-search");
    const res = await searchWebWithSafety(query, orgId, null);
    const safeSources = res.results
      .filter((r) => r.risk !== "dangerous")
      .slice(0, 3)
      .map((r) => ({ title: r.title, url: r.url, domain: r.domain }));
    const answer = (res.answer || "").trim().slice(0, 900);
    if (!answer && safeSources.length === 0) return { context: "", payload: null };
    const payload: AgentResearchPayload = { query, answer, sources: safeSources, fetchedAt: new Date().toISOString() };
    setCached(cacheKey, payload, AI_CACHE_TTL.VERY_LONG);
    return { context: formatResearchContext(payload), payload };
  } catch (err) {
    logger.warn({ err, agentId: agent.id, orgId }, "[AI-Agent] veille web echec (ignore)");
    return { context: "", payload: null };
  }
}

function formatResearchContext(p: AgentResearchPayload): string {
  if (!p.answer && p.sources.length === 0) return "";
  const srcLines = p.sources.map((s) => `  - ${s.title} (${s.domain})`).join("\n");
  return `\n\n=== VEILLE WEB DU JOUR (recherche autonome, sources verifiees) ===
Requete: ${p.query}
Synthese actuelle: ${p.answer}
${srcLines ? `Sources:\n${srcLines}` : ""}
Utilise cette veille pour contextualiser tes alertes et suggestions avec l'actualite et les bonnes pratiques externes, SANS inventer de chiffres. Cite la source quand c'est pertinent.
=== FIN VEILLE ===`;
}

async function runSingleAgent(agent: typeof AGENTS[0], orgId: number, signal?: AbortSignal, goal?: string, userId?: number): Promise<any> {
  const startTime = Date.now();
  const today = new Date().toISOString().split("T")[0];
  const checkAbort = () => { if (signal?.aborted) throw new Error("aborted"); };

  // Reservation IA en vol: ferme la course TOCTOU quand plusieurs agents
  // tournent en parallele (auto-run, concurrence 3). Reserve juste apres le
  // controle de quota, libere dans le finally une fois l'agent termine.
  let releaseQuota: (() => void) | null = null;
  try {
    checkAbort();
    await assertAiQuota(orgId);
    releaseQuota = reserveAiCall(orgId);

    const data = await gatherAgentData(agent.id, orgId);

    let collaborationContext = "";
    let trendContext = "";
    // S004 — auto-correction de performance: l'agent lit sa propre tendance et,
    // s'il se degrade, ajuste sa strategie et emet une note "ce que j'ai change".
    let selfCorrection: {
      trend: "degradation" | "amelioration" | "stable";
      scores: number[];
      delta: number;
      note: string;
    } | null = null;
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
${isDecaying ? "ATTENTION: Tes scores baissent consecutivement. CHANGE de strategie ce cycle: identifie la cause profonde, traite EN PRIORITE tes points faibles recurrents (erreurs/alertes repetees ci-dessous), et resume en une phrase dans trendAnalysis CE QUE TU CHANGES concretement." : ""}
${trendHistory.map(h => `  ${h.reportDate}: score ${h.score}, ${h.errorsFound} erreurs, ${h.warningsFound} alertes`).join("\n")}
=== FIN HISTORIQUE ===`;
        // Note deterministe (sans cout IA) — du plus ancien au plus recent.
        const chrono = [...scores].reverse();
        const delta = (scores[0] ?? 0) - (scores[scores.length - 1] ?? 0);
        const trend: "degradation" | "amelioration" | "stable" =
          isDecaying ? "degradation" : isImproving ? "amelioration" : "stable";
        const note =
          trend === "degradation"
            ? `Mes scores reculent (${chrono.join("→")}). Ce cycle je change d'approche: analyse des causes profondes et priorite absolue sur mes points faibles recurrents.`
            : trend === "amelioration"
              ? `Mes scores progressent (${chrono.join("→")}). Je maintiens la strategie qui fonctionne et je consolide les acquis.`
              : `Mes scores sont stables (${chrono.join("→")}). Je vise des gains marginaux cibles sans casser ce qui marche.`;
        selfCorrection = { trend, scores, delta, note };
      }
    } catch (colErr) { logger.warn({ err: colErr }, `[AI-Agent] ${agent} collaboration context failed`); }

    const cleanGoal = typeof goal === "string" ? goal.trim().slice(0, 500) : "";
    const goalContext = cleanGoal
      ? `\n\n=== OBJECTIF PRIORITAIRE DU DIRIGEANT ===\nLe patron te confie une mission specifique pour cette execution: "${cleanGoal}"\nConcentre ton analyse, tes alertes et tes suggestions en priorite sur cet objectif, tout en restant dans ton domaine de competence. Si l'objectif sort de ton domaine, dis-le clairement et traite ce que tu peux.\n=== FIN OBJECTIF ===`
      : "";

    const learnedContext = await buildLearnedContextBlock(orgId, userId);
    const { context: researchContext, payload: researchPayload } = await buildAgentResearch(agent, orgId, today);
    const fullPrompt = `${getAgentPrompt(agent)}${collaborationContext}${trendContext}${learnedContext}${researchContext}${goalContext}\n\n${AGENT_RESPONSE_FORMAT}\n\nDate du rapport: ${today}\nDonnees actuelles (cette semaine + semaine precedente + patterns):\n${JSON.stringify(data, null, 2)}`;

    let text = "{}";
    let councilModels: string[] = [];
    let councilSynthesized = false;
    const t0 = Date.now();
    const councilEnabled = process.env.AI_COUNCIL_DISABLED !== "1";
    // La clé de cache inclut une empreinte du contexte appris: quand le patron
    // approuve/rejette des propositions, les préférences changent -> le cache est
    // naturellement invalidé pour que l'apprentissage soit pris en compte.
    const agentCacheKey = buildAiCacheKey({
      route: `/ai/agents/${agent.id}`,
      organisationId: orgId,
      input: { day: today, dataHash: JSON.stringify(data).slice(0, 400), goal: cleanGoal, council: councilEnabled, learned: learnedContext, research: researchPayload?.fetchedAt ?? "" },
    });
    const agentCached = getCached<{ text: string; models: string[]; synthesized: boolean }>(agentCacheKey);
    if (agentCached) {
      text = agentCached.text;
      councilModels = agentCached.models;
      councilSynthesized = agentCached.synthesized;
    } else {
      checkAbort();
      const reasoning = await runAgentReasoning(agent.id, orgId, fullPrompt, signal, councilEnabled, t0);
      text = reasoning.text;
      councilModels = reasoning.models;
      councilSynthesized = reasoning.synthesized;
      if (text && text.length > 10) setCached(agentCacheKey, reasoning, AI_CACHE_TTL.MEDIUM);
    }
    checkAbort();
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
        council: { models: councilModels, synthesized: councilSynthesized },
        research: researchPayload ?? null,
        selfCorrection: selfCorrection ?? null,
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
    if (signal?.aborted || error?.message === "aborted" || error?.name === "APIUserAbortError") {
      throw error;
    }
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
  } finally {
    releaseQuota?.();
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
    const { anthropic, resolveClaudeModelId } = await import("@workspace/integrations-anthropic-ai");
    const message = await anthropic.messages.create({
      model: resolveClaudeModelId("claude-sonnet-4-6"),
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
    await assertAiQuota(orgId);

    let crossAgentIssues: any[] = [];
    try {
      const { detectCrossAgentIssues, createCrossAgentAlert } = await import("./agent-collaboration");
      crossAgentIssues = await detectCrossAgentIssues(orgId);
      for (const issue of crossAgentIssues.filter(i => i.severity === "critique")) {
        const fromAgent = issue.agents[0] || "super_agent";
        const toAgent = issue.agents[1] || "super_agent";
        await createCrossAgentAlert(orgId, fromAgent, toAgent, issue.title, issue.description, issue.severity);
      }
    } catch (alertErr) { logger.warn({ err: alertErr }, "[SuperAgent] cross-agent alert creation failed"); }

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
        model: GEMINI_PRO_MODEL,
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
          providersUsed: [GEMINI_PRO_MODEL, "gpt-5.2", "claude-sonnet-4-6"],
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

type StoredEvent = { event: string; data: any };
type JobState = {
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  completedAgents: number;
  totalAgents: number;
  events: StoredEvent[];
  emitter: EventEmitter;
  abortController: AbortController;
  finishedAt?: number;
  cleanupTimer?: NodeJS.Timeout;
};

const runningJobs = new Map<number, JobState>();
const JOB_RETENTION_MS = 5 * 60 * 1000;

function emitJobEvent(job: JobState, event: string, data: any) {
  job.events.push({ event, data });
  job.emitter.emit("event", event, data);
}

function scheduleJobCleanup(orgId: number, job: JobState) {
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  job.cleanupTimer = setTimeout(() => {
    if (runningJobs.get(orgId) === job) runningJobs.delete(orgId);
  }, JOB_RETENTION_MS);
  job.cleanupTimer.unref?.();
}

async function runAgentsJob(orgId: number, job: JobState, userId?: number) {
  const startedAt = job.startedAt;
  const childReports: any[] = [];

  emitJobEvent(job, "start", {
    totalAgents: AGENTS.length,
    agents: AGENTS.map((a, idx) => ({ index: idx, agentId: a.id, agentName: a.name, agentIcon: a.icon })),
  });

  const signal = job.abortController.signal;
  const isAbortError = (err: any) =>
    signal.aborted || err?.message === "aborted" || err?.name === "APIUserAbortError";

  try {
    const CONCURRENCY = 3;
    let nextIndex = 0;

    const runOne = async (agent: typeof AGENTS[0]) => {
      const idx = AGENTS.indexOf(agent);
      emitJobEvent(job, "agent-start", {
        index: idx, agentId: agent.id, agentName: agent.name, agentIcon: agent.icon,
      });
      try {
        const report = await runSingleAgent(agent, orgId, signal, undefined, userId);
        childReports.push(report);
        emitJobEvent(job, "agent-done", {
          index: idx, agentId: agent.id, agentName: agent.name, agentIcon: agent.icon,
          report, score: report?.score ?? 0, executionTimeMs: report?.executionTimeMs ?? 0,
        });
      } catch (err: any) {
        if (isAbortError(err)) {
          emitJobEvent(job, "agent-aborted", { index: idx, agentId: agent.id, agentName: agent.name });
          return;
        }
        logger.error({ err, agentId: agent.id }, `Agent ${agent.id} failed (stream)`);
        emitJobEvent(job, "agent-error", {
          index: idx, agentId: agent.id, agentName: agent.name,
          error: err?.message || "Erreur inconnue",
        });
      } finally {
        job.completedAgents++;
        emitJobEvent(job, "progress", { completedAgents: job.completedAgents, totalAgents: AGENTS.length });
      }
    };

    const worker = async () => {
      while (true) {
        if (signal.aborted) return;
        const i = nextIndex++;
        if (i >= AGENTS.length) return;
        await runOne(AGENTS[i]);
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, AGENTS.length) }, () => worker()));

    if (signal.aborted) {
      job.status = "cancelled";
      emitJobEvent(job, "aborted", {
        completedAgents: job.completedAgents,
        totalAgents: AGENTS.length,
        reportsGenerated: childReports.length,
      });
      return;
    }

    emitJobEvent(job, "super-start", {});
    let superReport: any = null;
    try {
      superReport = await runSuperAgent(childReports, orgId);
      emitJobEvent(job, "super-done", { report: superReport });
    } catch (superErr: any) {
      logger.error({ err: superErr }, "Super Agent failed in stream");
      emitJobEvent(job, "super-error", { error: superErr?.message || "Echec du Super Agent" });
    }

    job.status = "completed";
    emitJobEvent(job, "done", {
      success: true,
      completedAgents: job.completedAgents,
      totalAgents: AGENTS.length,
      executionTimeMs: Date.now() - startedAt,
      hasSuperReport: !!superReport,
    });
  } catch (error: any) {
    if (signal.aborted) {
      job.status = "cancelled";
      emitJobEvent(job, "aborted", {
        completedAgents: job.completedAgents,
        totalAgents: AGENTS.length,
        reportsGenerated: childReports.length,
      });
    } else if (error instanceof AiQuotaExceededError) {
      job.status = "failed";
      emitJobEvent(job, "error", { error: error.message, quotaExceeded: true });
    } else {
      logger.error({ err: error }, "AI Agents stream run error");
      job.status = "failed";
      emitJobEvent(job, "error", { error: error?.message || "Erreur lors de l'execution des agents IA" });
    }
  } finally {
    job.finishedAt = Date.now();
    job.emitter.emit("end");
    scheduleJobCleanup(orgId, job);
  }
}

router.post("/ai/agents/run", requireAdmin, async (_req, res) => {
  try {
    const orgId = _req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

    const existing = runningJobs.get(orgId);
    if (existing && existing.status === "running") {
      res.json({ status: "already_running", message: "Une analyse est deja en cours." });
      return;
    }

    const job: JobState = {
      status: "running",
      startedAt: Date.now(),
      completedAgents: 0,
      totalAgents: AGENTS.length,
      events: [],
      emitter: new EventEmitter(),
      abortController: new AbortController(),
    };
    job.emitter.setMaxListeners(50);
    runningJobs.set(orgId, job);
    runAgentsJob(orgId, job, _req.session?.userId).catch(err => logger.error({ err }, "runAgentsJob failed"));

    res.json({ status: "started", message: "Analyse lancee en arriere-plan.", totalAgents: AGENTS.length });
  } catch (error: any) {
    logger.error({ err: error }, "AI Agents run error");
    res.status(500).json({ error: "Erreur lors de l'execution des agents IA" });
  }
});

router.get("/ai/agents/run/status", requireAdmin, async (req, res) => {
  const orgId = req.session?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
  const job = runningJobs.get(orgId);
  if (!job) {
    res.json({ status: "idle" });
    return;
  }
  res.json({
    status: job.status,
    startedAt: job.startedAt,
    completedAgents: job.completedAgents,
    totalAgents: job.totalAgents,
    finishedAt: job.finishedAt,
  });
});

router.post("/ai/agents/run/cancel", requireAdmin, async (req, res) => {
  const orgId = req.session?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
  const job = runningJobs.get(orgId);
  if (!job || job.status !== "running") {
    res.json({ status: "idle" });
    return;
  }
  try { job.abortController.abort(); } catch {}
  res.json({ status: "cancelling" });
});

router.post("/ai/agents/run/stream", requireAdmin, async (req, res) => {
  const orgId = req.session?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

  let job = runningJobs.get(orgId);
  if (!job || job.status !== "running") {
    job = {
      status: "running",
      startedAt: Date.now(),
      completedAgents: 0,
      totalAgents: AGENTS.length,
      events: [],
      emitter: new EventEmitter(),
      abortController: new AbortController(),
    };
    job.emitter.setMaxListeners(50);
    runningJobs.set(orgId, job);
    runAgentsJob(orgId, job, req.session?.userId).catch(err => logger.error({ err }, "runAgentsJob failed"));
  }

  const stream = openSseStream(res);
  const activeJob = job;

  // Replay buffered events so reattaching clients see current state
  for (const ev of activeJob.events) stream.send(ev.event, ev.data);

  if (activeJob.status !== "running") {
    stream.end();
    return;
  }

  const onEvent = (event: string, data: any) => stream.send(event, data);
  const onEnd = () => stream.end();

  activeJob.emitter.on("event", onEvent);
  activeJob.emitter.once("end", onEnd);

  const detach = () => {
    activeJob.emitter.off("event", onEvent);
    activeJob.emitter.off("end", onEnd);
  };

  // When the request closes (tab switched / navigated away), just detach this
  // subscriber. The background run continues so the user can reattach later.
  stream.signal.addEventListener("abort", detach);
  res.on("close", detach);
});

router.post("/ai/agents/run/:agentId", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const { agentId } = req.params;
    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent introuvable" });
      return;
    }
    const goal = typeof req.body?.goal === "string" ? req.body.goal : undefined;
    const report = await runSingleAgent(agent, orgId, undefined, goal, req.session?.userId);
    res.json(report);
  } catch (error: any) {
    if (error instanceof AiQuotaExceededError) { res.status(429).json({ error: error.message, quotaExceeded: true }); return; }
    logger.error({ err: error }, "AI Agent run error");
    res.status(500).json({ error: "Erreur lors de l'execution de l'agent" });
  }
});

router.post("/ai/agents/run/:agentId/stream", requireAdmin, async (req, res) => {
  const orgId = req.session?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
  const { agentId } = req.params;
  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent) { res.status(404).json({ error: "Agent introuvable" }); return; }

  const stream = openSseStream(res);
  const startTime = Date.now();
  const today = new Date().toISOString().split("T")[0];

  try {
    stream.send("status", { phase: "gathering", agentId, agentName: agent.name });
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
        trendContext = `\n\n=== HISTORIQUE DE TES SCORES ===\nTes ${trendHistory.length} derniers scores: ${scores.join(" → ")}\nTendance: ${isDecaying ? "⚠ EN DEGRADATION CONTINUE" : isImproving ? "✅ EN AMELIORATION" : "Stable"}\n=== FIN HISTORIQUE ===`;
      }
    } catch {}

    const learnedContext = await buildLearnedContextBlock(orgId, req.session?.userId);
    const fullPrompt = `${getAgentPrompt(agent)}${collaborationContext}${trendContext}${learnedContext}\n\n${AGENT_RESPONSE_FORMAT}\n\nDate du rapport: ${today}\nDonnees actuelles (cette semaine + semaine precedente + patterns):\n${JSON.stringify(data, null, 2)}`;

    const cacheKey = buildAiCacheKey({
      route: `/ai/agents/${agent.id}`,
      organisationId: orgId,
      input: { day: today, dataHash: JSON.stringify(data).slice(0, 400), learned: learnedContext },
    });

    let text = "";
    let providerLabel: string | undefined;
    const cached = getCached<string>(cacheKey);
    if (cached) {
      text = cached;
      stream.send("cached", { text: cached });
    } else {
      stream.send("status", { phase: "generating", agentId });
      const result = await multiAiGenerateStream({
        prompt: fullPrompt,
        organisationId: orgId,
        route: `/ai/agents/${agent.id}`,
        signal: stream.signal,
        onToken: (chunk) => stream.send("token", { chunk }),
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      });
      text = result.fullText;
      providerLabel = result.provider;
      if (text && text.length > 10) setCached(cacheKey, text, AI_CACHE_TTL.MEDIUM);
    }

    if (stream.signal.aborted) {
      stream.send("aborted", { agentId });
      stream.end();
      return;
    }

    let parsed: any;
    try { parsed = JSON.parse(text); }
    catch {
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

    stream.send("report", { report });
    stream.send("done", { success: true, provider: providerLabel, executionTimeMs });
    stream.end();
  } catch (error: any) {
    if (error instanceof StreamAbortedError) {
      stream.send("aborted", {
        agentId,
        provider: error.partial.provider,
        model: error.partial.model,
        partialText: error.partial.fullText,
        usage: { inputTokens: error.partial.inputTokens, outputTokens: error.partial.outputTokens },
      });
      stream.end();
      return;
    }
    if (stream.signal.aborted || error?.message === "aborted") {
      stream.send("aborted", { agentId });
      stream.end();
      return;
    }
    if (error instanceof AiQuotaExceededError) {
      stream.send("error", { error: error.message, quotaExceeded: true });
      stream.end();
      return;
    }
    logger.error({ err: error, agentId }, "AI Agent stream run error");
    try {
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
      stream.send("report", { report });
    } catch {}
    stream.send("error", { error: error?.message || "Erreur lors de l'execution de l'agent" });
    stream.end();
  }
});

router.post("/ai/agents/super", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session?.organisationId;
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
    if (error instanceof AiQuotaExceededError) { res.status(429).json({ error: error.message, quotaExceeded: true }); return; }
    logger.error({ err: error }, "Super Agent error");
    res.status(500).json({ error: "Erreur Super Agent" });
  }
});

router.get("/ai/agents/reports", requireMinAgent, async (req, res) => {
  const orgId = req.session?.organisationId;
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
  const orgId = req.session?.organisationId;
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
  const orgId = req.session?.organisationId;
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
  const orgId = req.session?.organisationId;
  let autoRunEnabled = false;
  let autoRunLastRunAt: string | null = null;
  if (orgId) {
    const [org] = await db
      .select({
        enabled: organisationsTable.agentAutoRunEnabled,
        lastRunAt: organisationsTable.agentAutoRunLastRunAt,
      })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, orgId))
      .limit(1);
    autoRunEnabled = org?.enabled ?? false;
    autoRunLastRunAt = org?.lastRunAt ? org.lastRunAt.toISOString() : null;
  }
  res.json({ agents: AGENTS, autoRunEnabled, autoRunLastRunAt, autoRunIntervalMinutes: AUTO_RUN_INTERVAL_MINUTES });
});

// ---------------------------------------------------------------------------
// Execution automatique des agents (autonomie durable).
//
// L'etat "actif/inactif" et la date du dernier cycle sont persistes en base
// (organisations.agent_auto_run_enabled / _last_run_at) afin que l'autonomie
// survive a un redemarrage du serveur. On n'utilise PLUS un setInterval par
// organisation (perdu au reboot) : un planificateur global unique verifie
// periodiquement quelles organisations sont "dues" et lance leur cycle. Le Set
// en memoire ne sert que de garde anti-chevauchement dans le process courant.
// (cf. memoire "cron-cadence-durability".)
// ---------------------------------------------------------------------------
const AUTO_RUN_INTERVAL_MINUTES = 120;
const AUTO_RUN_INTERVAL_MS = AUTO_RUN_INTERVAL_MINUTES * 60 * 1000;
const AUTO_RUN_TICK_MS = 10 * 60 * 1000; // verification toutes les 10 min
const autoRunInFlight = new Set<number>();
let autoRunTicker: ReturnType<typeof setInterval> | null = null;

async function runAutoCycle(orgId: number): Promise<{ superReport: any; agentReports: any[] } | null> {
  if (autoRunInFlight.has(orgId)) return null;
  autoRunInFlight.add(orgId);
  logger.info({ orgId }, "[AI Agents] Execution automatique demarree");
  try {
    const childReports = await Promise.all(AGENTS.map((a) => runSingleAgent(a, orgId)));
    const superReport = await runSuperAgent(childReports, orgId);
    await db
      .update(organisationsTable)
      .set({ agentAutoRunLastRunAt: new Date() })
      .where(eq(organisationsTable.id, orgId));
    logger.info({ orgId }, "[AI Agents] Execution automatique terminee");
    return { superReport, agentReports: childReports };
  } finally {
    autoRunInFlight.delete(orgId);
  }
}

/**
 * Planificateur global d'autonomie. Demarre au boot (index.ts). Toutes les
 * AUTO_RUN_TICK_MS, lance un cycle pour chaque organisation active dont
 * l'autonomie est activee et dont le dernier cycle remonte a plus de la cadence
 * configuree. Etat 100% derive de la base -> durable au redemarrage.
 */
export function startAgentAutoRunScheduler(): void {
  if (autoRunTicker) return;
  const tick = async () => {
    try {
      const cutoff = new Date(Date.now() - AUTO_RUN_INTERVAL_MS);
      // Reclamation atomique: on AVANCE `agentAutoRunLastRunAt` au moment de la
      // selection (et non a la fin du cycle). L'UPDATE ... RETURNING est atomique
      // cote Postgres, donc deux instances (deploiement multi-process) ne peuvent
      // pas reclamer la meme organisation: la seconde ne matchera plus le filtre
      // de cadence. Empeche le double-firing au-dela du simple verrou memoire.
      const claimed = await db
        .update(organisationsTable)
        .set({ agentAutoRunLastRunAt: new Date() })
        .where(
          and(
            eq(organisationsTable.agentAutoRunEnabled, true),
            eq(organisationsTable.actif, true),
            or(
              isNull(organisationsTable.agentAutoRunLastRunAt),
              lt(organisationsTable.agentAutoRunLastRunAt, cutoff),
            ),
          ),
        )
        .returning({ id: organisationsTable.id });
      for (const o of claimed) {
        runAutoCycle(o.id).catch((err) =>
          logger.error({ err, orgId: o.id }, "[AI Agents] Erreur cycle auto-run"),
        );
      }
    } catch (err) {
      logger.error({ err }, "[AI Agents] Erreur planificateur auto-run");
    }
  };
  autoRunTicker = setInterval(tick, AUTO_RUN_TICK_MS);
  autoRunTicker.unref?.();
  setTimeout(tick, 60 * 1000); // premier passage ~60s apres le boot
  logger.info("[AI Agents] planificateur auto-run demarre — verification 10min, cadence 2h, etat durable (DB)");
}

router.post("/ai/agents/auto-start", requireAdmin, async (_req, res) => {
  const orgId = _req.session?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

  await db
    .update(organisationsTable)
    .set({ agentAutoRunEnabled: true })
    .where(eq(organisationsTable.id, orgId));

  try {
    const firstRun = await runAutoCycle(orgId);
    res.json({
      message: "Execution automatique activee (toutes les 2 heures)",
      status: "active",
      firstRun: firstRun ?? undefined,
    });
  } catch (error: any) {
    logger.error({ err: error, orgId }, "[AI Agents] Erreur premier cycle auto-run");
    res.status(500).json({ error: "Erreur lors du premier cycle" });
  }
});

router.post("/ai/agents/auto-stop", requireAdmin, async (_req, res) => {
  const orgId = _req.session?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

  await db
    .update(organisationsTable)
    .set({ agentAutoRunEnabled: false })
    .where(eq(organisationsTable.id, orgId));
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
    try { await assertAiQuota(orgId); } catch (qe) {
      if (qe instanceof AiQuotaExceededError) {
        addAutopilotLog(orgId, "error", `Quota IA atteint: ${qe.message}`, "system", "haute");
        return;
      }
      throw qe;
    }

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
        // JOIN unique au lieu d'un SELECT contact par appel orphelin (N+1).
        const orphanMatches = await db.select({ callId: callsTable.id, contactId: contactsTable.id })
          .from(callsTable)
          .innerJoin(contactsTable, and(
            orgContact,
            sql`replace(${contactsTable.phone}, ' ', '') = replace(${callsTable.phoneNumber}, ' ', '')`,
          ))
          .where(and(orgCall, isNull(callsTable.contactId), gte(callsTable.createdAt, weekAgo)))
          .limit(20);

        let matched = 0;
        if (orphanMatches.length > 0) {
          const callToContact = new Map<number, number>();
          for (const m of orphanMatches) if (!callToContact.has(m.callId)) callToContact.set(m.callId, m.contactId);
          const callIds = [...callToContact.keys()];
          await db.update(callsTable)
            .set({
              contactId: sql`CASE ${callsTable.id} ${sql.join(
                callIds.map(id => sql`WHEN ${id} THEN ${callToContact.get(id)}`),
                sql` `,
              )} ELSE ${callsTable.contactId} END`,
            })
            .where(and(orgCall, inArray(callsTable.id, callIds)));
          matched = callIds.length;
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
        const overdueList = await db.select({ id: tasksTable.id, title: tasksTable.title })
          .from(tasksTable)
          .where(and(
            orgTask, ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"),
            ne(tasksTable.priority, "haute"), ne(tasksTable.priority, "urgente"),
            sql`${tasksTable.dueDate} < NOW()`,
          ))
          .limit(10);

        if (overdueList.length > 0) {
          // Bulk UPDATE au lieu d'un UPDATE par tache.
          await db.update(tasksTable).set({ priority: "haute" })
            .where(and(orgTask, inArray(tasksTable.id, overdueList.map(t => t.id))));
          autoFixes.push({ action: "escalate_overdue", description: `${overdueList.length} taches en retard escaladees en priorite haute`, result: "succes" });
          addAutopilotLog(orgId, "fix", `${overdueList.length} taches en retard escaladees`, "system", "info");
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

        const toFlag = stuckList.filter(task => !task.description || !task.description.includes("[Oto-Pilot] Tache bloquee"));
        if (toFlag.length > 0) {
          // Bulk UPDATE au lieu d'un UPDATE par tache.
          await db.update(tasksTable)
            .set({ description: sql`COALESCE(${tasksTable.description}, '') || E'\n[Oto-Pilot] Tache bloquee detectee - necessite attention'` })
            .where(and(orgTask, inArray(tasksTable.id, toFlag.map(t => t.id))));
          autoFixes.push({ action: "flag_stuck_tasks", description: `${toFlag.length} taches bloquees marquees pour attention`, result: "succes" });
          addAutopilotLog(orgId, "fix", `${toFlag.length} taches bloquees flaggees`, "system", "info");
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
            model: GEMINI_PRO_MODEL,
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
          const { anthropic, resolveClaudeModelId } = await import("@workspace/integrations-anthropic-ai");
          const m = await anthropic.messages.create({
            model: resolveClaudeModelId("claude-sonnet-4-6"),
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
        model: GEMINI_PRO_MODEL,
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
  const orgId = req.session?.organisationId;
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
    logger.error({ err, orgId }, "[Autopilot] Erreur lancement cycle");
    res.status(500).json({ error: "Erreur cycle Oto-Pilot" });
  }
});

router.post("/ai/autopilot/start", requireAdmin, async (req, res): Promise<void> => {
  const orgId = req.session?.organisationId;
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
  const orgId = req.session?.organisationId;
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
  const orgId = req.session?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

  const state = getOrgAutopilot(orgId);
  res.json({
    ...state.status,
    recentLogs: state.log.slice(-30),
  });
});

router.get("/ai/autopilot/logs", requireMinAgent, async (req, res): Promise<void> => {
  const orgId = req.session?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

  const state = getOrgAutopilot(orgId);
  res.json({ logs: state.log, total: state.log.length });
});

router.post("/ai/agents/auto-fix", requireAdmin, async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    const userId = req.session?.userId;
    if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const orgCall = eq(callsTable.organisationId, orgId);
    const orgTask = eq(tasksTable.organisationId, orgId);
    const orgMsg = eq(messagesTable.organisationId, orgId);
    const orgContact = eq(contactsTable.organisationId, orgId);

    const fixes: { type: string; description: string; count: number; details: string }[] = [];

    // Un seul JOIN au lieu d'un SELECT contact par appel orphelin (etait un
    // N+1 : jusqu'a 100 SELECT + 100 UPDATE sequentiels sur cette route
    // synchrone). Le JOIN peut renvoyer plusieurs contacts pour un meme
    // appel si plusieurs contacts partagent le meme numero ; on garde
    // arbitrairement le premier, comme le faisait le `.limit(1)` original.
    const orphanCallMatches = await db.select({ callId: callsTable.id, contactId: contactsTable.id })
      .from(callsTable)
      .innerJoin(contactsTable, and(
        orgContact,
        sql`replace(${contactsTable.phone}, ' ', '') = replace(${callsTable.phoneNumber}, ' ', '')`,
      ))
      .where(and(orgCall, isNull(callsTable.contactId), isNotNull(callsTable.phoneNumber)))
      .limit(100);

    let linkedCount = 0;
    if (orphanCallMatches.length > 0) {
      const callToContact = new Map<number, number>();
      for (const m of orphanCallMatches) if (!callToContact.has(m.callId)) callToContact.set(m.callId, m.contactId);
      const callIds = [...callToContact.keys()];
      await db.update(callsTable)
        .set({
          contactId: sql`CASE ${callsTable.id} ${sql.join(
            callIds.map(id => sql`WHEN ${id} THEN ${callToContact.get(id)}`),
            sql` `,
          )} ELSE ${callsTable.contactId} END`,
        })
        .where(and(orgCall, inArray(callsTable.id, callIds)));
      linkedCount = callIds.length;
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
      // Bulk UPDATE ... WHERE id IN (...) au lieu d'un UPDATE par tache.
      await db.update(tasksTable).set({ priority: "haute" }).where(and(orgTask, inArray(tasksTable.id, overdueIds)));
      fixes.push({ type: "overdue_tasks_escalated", description: "Taches en retard escaladees en haute priorite", count: overdueTasks.length, details: overdueTasks.map(t => t.title).join(", ") });
    }

    const stuckTasks = await db.select({ id: tasksTable.id, title: tasksTable.title })
      .from(tasksTable)
      .where(and(orgTask, eq(tasksTable.status, "en_cours"), lt(tasksTable.updatedAt, weekAgo)))
      .limit(30);

    if (stuckTasks.length > 0) {
      // Bulk INSERT (un seul aller-retour) au lieu d'un INSERT par notification.
      await db.insert(notificationsTable).values(stuckTasks.map(task => ({
        userId: userId,
        organisationId: orgId,
        title: `Tache bloquee: ${task.title}`,
        message: `Cette tache est en cours depuis plus de 7 jours sans mise a jour.`,
        type: "alerte" as const,
        priority: "haute" as const,
      })));
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
    if (contactsNoCategory.length > 0) {
      // Two grouped counts instead of 2 SELECTs per contact (was up to 100
      // queries for 50 contacts).
      const contactIds = contactsNoCategory.map(c => c.id);
      const [callCounts, taskCounts] = await Promise.all([
        db.select({ contactId: callsTable.contactId, count: count() }).from(callsTable)
          .where(and(orgCall, inArray(callsTable.contactId, contactIds)))
          .groupBy(callsTable.contactId),
        db.select({ contactId: tasksTable.relatedContactId, count: count() }).from(tasksTable)
          .where(and(orgTask, inArray(tasksTable.relatedContactId, contactIds)))
          .groupBy(tasksTable.relatedContactId),
      ]);
      const callCountById = new Map(callCounts.map(r => [r.contactId, r.count]));
      const taskCountById = new Map(taskCounts.map(r => [r.contactId, r.count]));

      const clientIds: number[] = [];
      const prospectIds: number[] = [];
      for (const c of contactsNoCategory) {
        const callCount = callCountById.get(c.id) ?? 0;
        const taskCount = taskCountById.get(c.id) ?? 0;
        if (callCount >= 3 || taskCount >= 2) clientIds.push(c.id);
        else if (callCount === 1 || taskCount === 1) prospectIds.push(c.id);
      }
      if (clientIds.length > 0) {
        await db.update(contactsTable).set({ category: "client" }).where(inArray(contactsTable.id, clientIds));
      }
      if (prospectIds.length > 0) {
        await db.update(contactsTable).set({ category: "prospect" }).where(inArray(contactsTable.id, prospectIds));
      }
      categorizedCount = clientIds.length + prospectIds.length;
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
    } catch (e) { logger.warn({ err: e }, "[AIAgents] stock auto-fix skipped"); }

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
    const orgId = req.session?.organisationId;
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

// ═══════════════════════════════════════════════════════════════════
// SUPER AGENT OTONOM — email + chantier + sistem yönetimi
// ═══════════════════════════════════════════════════════════════════

interface SuperAgentLog {
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  source: "email" | "chantier" | "system" | "tache" | "appel";
  message: string;
  detail?: string;
}

interface SuperAgentState {
  running: boolean;
  lastRun?: string;
  logs: SuperAgentLog[];
  stats: {
    tasksCreated: number;
    tasksFixed: number;
    emailsProcessed: number;
    reportsProcessed: number;
    fixesApplied: number;
    cyclesRun: number;
  };
}

const superAgentStates = new Map<number, SuperAgentState>();

function getSuperAgentState(orgId: number): SuperAgentState {
  if (!superAgentStates.has(orgId)) {
    superAgentStates.set(orgId, {
      running: false,
      logs: [],
      stats: { tasksCreated: 0, tasksFixed: 0, emailsProcessed: 0, reportsProcessed: 0, fixesApplied: 0, cyclesRun: 0 },
    });
  }
  return superAgentStates.get(orgId)!;
}

function saLog(orgId: number, level: SuperAgentLog["level"], source: SuperAgentLog["source"], message: string, detail?: string) {
  const state = getSuperAgentState(orgId);
  state.logs.push({ timestamp: new Date().toISOString(), level, source, message, detail });
  if (state.logs.length > 500) state.logs = state.logs.slice(-500);
}

/**
 * `prompt`/`systemPrompt` may embed content from untrusted external sources
 * (e.g. inbound email bodies in the Gmail auto-task cycle below) — callers
 * MUST run any such content through `sanitizePromptInput` before it reaches
 * here. Uses the org's own BYOK Gemini/OpenAI key when configured, falling
 * back to the platform key (matches the rest of the AI routes; previously
 * this always used the platform singleton regardless of org config).
 */
async function superAgentAI(orgId: number, prompt: string, systemPrompt: string): Promise<string> {
  const t0 = Date.now();
  try {
    const response: any = await callOrgGemini(orgId, (ai) =>
      ai.models.generateContent({
        model: GEMINI_FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }],
        config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
      }),
    );
    const text = response.text ?? "{}";
    const tokens = extractGeminiTokens(response);
    recordAiUsage({ organisationId: orgId, provider: "gemini", model: geminiActualModel(response, GEMINI_FLASH_MODEL), route: "/ai/super-agent", inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0 }).catch(() => {});
    invalidateQuotaCache(orgId);
    return text;
  } catch (err: any) {
    // fallback to OpenAI
    try {
      const fb: any = await callOrgOpenAI(orgId, (openai) =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt + "\n\nReponds UNIQUEMENT en JSON valide." }],
          max_tokens: 3000,
        }),
      );
      return fb.choices?.[0]?.message?.content ?? "{}";
    } catch { return "{}"; }
  }
}

async function runSuperAgentCycle(orgId: number, userId: number) {
  const state = getSuperAgentState(orgId);
  state.running = true;
  state.stats.cyclesRun++;
  saLog(orgId, "info", "system", "Démarrage du cycle Super Agent IA");

  try {
    await assertAiQuota(orgId);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const orgTask = eq(tasksTable.organisationId, orgId);
    const orgCall = eq(callsTable.organisationId, orgId);
    const orgContact = eq(contactsTable.organisationId, orgId);

    // ── 1. GMAIL — emails non traités ───────────────────────────────────────
    saLog(orgId, "info", "email", "Analyse de la boîte mail...");
    let emailTasksCreated = 0;
    try {
      const { getGmailForUser } = await import("../lib/google-auth");
      const gmail = await getGmailForUser(userId);
      if (gmail) {

        const listRes = await gmail.users.messages.list({ userId: "me", q: "is:unread is:inbox -category:promotions -category:social", maxResults: 15 }).catch(() => null);
        const messages = listRes?.data?.messages ?? [];

        for (const msg of messages.slice(0, 10)) {
          try {
            // The cycle-level assertAiQuota above is checked once, but this
            // loop can call superAgentAI up to 10 times — re-check (and
            // reserve) per-email so a single cycle can't blow far past the
            // quota gate before the usage records from earlier calls land.
            await assertAiQuota(orgId);
            const detail = await gmail.users.messages.get({ userId: "me", id: msg.id!, format: "full" });
            const headers = (detail.data.payload?.headers ?? []).reduce((acc: any, h: any) => { acc[h.name?.toLowerCase()] = h.value; return acc; }, {} as Record<string, string>);
            const subject = headers["subject"] ?? "(Sans objet)";
            const from = headers["from"] ?? "";
            const snippet = detail.data.snippet ?? "";

            let body = "";
            function walkParts(part: any) {
              if (!part) return;
              if (part.mimeType === "text/plain" && part.body?.data) {
                body = Buffer.from(part.body.data, "base64").toString("utf-8").slice(0, 2000);
              }
              if (part.parts) for (const p of part.parts) walkParts(p);
            }
            walkParts(detail.data.payload);
            if (!body) body = snippet;

            // Inbound email content is fully attacker-controlled (any external
            // sender) — it must be sanitized before it reaches the AI prompt,
            // same as every other user-supplied text fed to the AI routes.
            const safeFrom = sanitizePromptInput(from, 300);
            const safeSubject = sanitizePromptInput(subject, 300);
            const safeBody = sanitizePromptInput(body, 2000);

            const releaseEmailQuota = reserveAiCall(orgId);
            let aiText: string;
            try {
              aiText = await superAgentAI(orgId,
                `Email reçu:\nDe: ${safeFrom}\nObjet: ${safeSubject}\nContenu: ${safeBody}\n\nAnalyse cet email et extrait les tâches/actions requises en JSON:\n{"tasks":[{"title":"string","priority":"haute|moyenne|basse","dueInDays":3,"description":"string"}],"needsReply":true/false,"urgency":"normale|haute|critique","summary":"string"}`,
                `Tu es le Super Agent IA d'Agent de Bureau. Tu analyses les emails professionnels et extrais les actions requises. Sois précis et actionnable. Réponds UNIQUEMENT en JSON valide.`
              );
            } finally {
              releaseEmailQuota();
            }

            let parsed: any = {};
            try { const m = aiText.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; } catch {}

            if (parsed.tasks?.length > 0) {
              for (const t of parsed.tasks) {
                const dueDate = new Date(Date.now() + (t.dueInDays || 3) * 86400000);
                try {
                  await db.insert(tasksTable).values({
                    organisationId: orgId, title: `[Email] ${t.title}`, description: `De: ${safeFrom}\nObjet: ${safeSubject}\n\n${t.description || parsed.summary || ""}`, priority: t.priority || "moyenne", status: "en_attente", dueDate,
                  });
                  emailTasksCreated++;
                  state.stats.tasksCreated++;
                } catch (err: any) {
                  logger.warn({ err: err?.message, orgId, title: t?.title }, "[SuperAgent/Email] echec insertion tache extraite par IA");
                }
              }
              saLog(orgId, "success", "email", `Email traité: "${subject}"`, `${parsed.tasks.length} tâche(s) créée(s) — Urgence: ${parsed.urgency || "normale"}`);
            } else {
              saLog(orgId, "info", "email", `Email analysé: "${subject}"`, `Aucune action requise — ${parsed.summary || from}`);
            }
            state.stats.emailsProcessed++;
          } catch (err) {
            if (err instanceof AiQuotaExceededError) break; // quota exhausted mid-cycle — stop, don't keep trying remaining emails
            /* skip this email */
          }
        }

        if (messages.length === 0) saLog(orgId, "info", "email", "Aucun email non lu dans la boîte");
      } else {
        saLog(orgId, "info", "email", "Gmail non connecté — ignoré");
      }
    } catch (mailErr: any) {
      saLog(orgId, "warning", "email", `Gmail non disponible: ${mailErr.message}`);
    }

    // ── 2. CHANTIERS / PROJETS — tâches en retard ──────────────────────────
    saLog(orgId, "info", "chantier", "Analyse des projets et chantiers...");
    try {
      const projetsList = await db.select({ id: projetsTable.id, title: projetsTable.title, status: projetsTable.status, progress: projetsTable.progress, endDate: projetsTable.endDate })
        .from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), ne(projetsTable.status, "termine"), ne(projetsTable.status, "annule"))).limit(20);

      let overdueProjects = 0;
      // One query for all recent task titles instead of one ILIKE lookup per
      // project (was up to 20 queries/cycle). Snapshotted before the loop, so
      // two projects with overlapping name snippets in the same cycle could
      // both insert a follow-up task - an acceptable trade-off, same as the
      // other batch fixes in this function.
      const recentTaskTitles = (await db.select({ title: tasksTable.title }).from(tasksTable)
        .where(and(orgTask, gte(tasksTable.createdAt, weekAgo))))
        .map(t => t.title.toLowerCase());
      const newProjectTasks: (typeof tasksTable.$inferInsert)[] = [];
      for (const p of projetsList) {
        const isLate = p.endDate && new Date(p.endDate) < now;
        if (isLate || (p.progress ?? 0) < 20) {
          overdueProjects++;
          const needle = p.title.slice(0, 30).toLowerCase();
          const hasExistingTask = recentTaskTitles.some(t => t.includes(needle));
          if (!hasExistingTask) {
            newProjectTasks.push({
              organisationId: orgId, title: `[Chantier] Suivi: ${p.title}`, description: `Projet ${isLate ? "en RETARD" : "peu avancé"} (${p.progress ?? 0}%). Action requise.`, priority: isLate ? "haute" : "moyenne", status: "en_attente", dueDate: new Date(Date.now() + 2 * 86400000),
            });
          }
        }
      }
      if (newProjectTasks.length > 0) {
        await db.insert(tasksTable).values(newProjectTasks).catch(() => {});
        state.stats.tasksCreated += newProjectTasks.length;
      }
      if (overdueProjects > 0) saLog(orgId, "warning", "chantier", `${overdueProjects} projet(s) en retard`, "Tâches de suivi créées automatiquement");
      else saLog(orgId, "success", "chantier", `${projetsList.length} projet(s) en cours — tous dans les délais`);
    } catch (chErr: any) {
      saLog(orgId, "warning", "chantier", `Analyse projets échouée: ${chErr.message}`);
    }

    // ── 3. TÂCHES — priorisation et relance auto ──────────────────────────
    saLog(orgId, "info", "tache", "Analyse des tâches en retard...");
    try {
      const overdueTasks = await db.select({ id: tasksTable.id, title: tasksTable.title, priority: tasksTable.priority, dueDate: tasksTable.dueDate })
        .from(tasksTable).where(and(orgTask, ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), lt(tasksTable.dueDate, now))).limit(50);

      if (overdueTasks.length > 0) {
        // Auto-escalate priority for tasks overdue > 3 days — bulk UPDATE
        // instead of one per task.
        const toEscalate = overdueTasks.filter(t => {
          if (!t.dueDate) return false;
          const daysLate = Math.floor((now.getTime() - new Date(t.dueDate).getTime()) / 86400000);
          return daysLate >= 3 && t.priority !== "haute" && t.priority !== "critique";
        });
        if (toEscalate.length > 0) {
          await db.update(tasksTable).set({ priority: "haute" })
            .where(and(orgTask, inArray(tasksTable.id, toEscalate.map(t => t.id))))
            .catch(() => {});
        }
        const escalated = toEscalate.length;
        state.stats.tasksFixed += escalated;
        saLog(orgId, overdueTasks.length > 5 ? "warning" : "info", "tache", `${overdueTasks.length} tâche(s) en retard`, escalated > 0 ? `${escalated} tâche(s) escaladée(s) en priorité haute` : "Aucune escalade nécessaire");
      } else {
        saLog(orgId, "success", "tache", "Aucune tâche en retard — excellent !");
      }
    } catch (taskErr: any) {
      saLog(orgId, "warning", "tache", `Analyse tâches échouée: ${taskErr.message}`);
    }

    // ── 4. APPELS — liaison orphelins ─────────────────────────────────────
    saLog(orgId, "info", "appel", "Liaison des appels sans contact...");
    try {
      // Single JOIN (both sides normalized the same way: strip spaces, then
      // +33 -> 0) instead of one contact SELECT per orphan call.
      const normalizedPhone = (col: any) => sql`regexp_replace(replace(${col}, ' ', ''), '^\\+33', '0')`;
      const orphanMatches = await db.select({ callId: callsTable.id, contactId: contactsTable.id })
        .from(callsTable)
        .innerJoin(contactsTable, and(
          orgContact,
          eq(normalizedPhone(contactsTable.phone), normalizedPhone(callsTable.phoneNumber)),
        ))
        .where(and(orgCall, isNull(callsTable.contactId), isNotNull(callsTable.phoneNumber)))
        .limit(30);

      let linked = 0;
      if (orphanMatches.length > 0) {
        const callToContact = new Map<number, number>();
        for (const m of orphanMatches) if (!callToContact.has(m.callId)) callToContact.set(m.callId, m.contactId);
        const callIds = [...callToContact.keys()];
        await db.update(callsTable)
          .set({
            contactId: sql`CASE ${callsTable.id} ${sql.join(
              callIds.map(id => sql`WHEN ${id} THEN ${callToContact.get(id)}`),
              sql` `,
            )} ELSE ${callsTable.contactId} END`,
          })
          .where(and(orgCall, inArray(callsTable.id, callIds)))
          .catch(() => {});
        linked = callIds.length;
        state.stats.fixesApplied += linked;
      }
      const [{ total: orphanTotal }] = await db.select({ total: count() }).from(callsTable)
        .where(and(orgCall, isNull(callsTable.contactId), isNotNull(callsTable.phoneNumber)));
      if (orphanTotal > 0) saLog(orgId, linked > 0 ? "success" : "info", "appel", `${orphanTotal} appel(s) sans contact`, linked > 0 ? `${linked} appel(s) liés automatiquement` : "Aucune correspondance trouvée");
      else saLog(orgId, "success", "appel", "Tous les appels sont liés à un contact");
    } catch (callErr: any) {
      saLog(orgId, "warning", "appel", `Analyse appels échouée: ${callErr.message}`);
    }

    state.lastRun = new Date().toISOString();
    saLog(orgId, "success", "system", `Cycle terminé — ${emailTasksCreated} tâches email, ${state.stats.tasksFixed} escalades, ${state.stats.fixesApplied} liaisons`);
  } catch (err: any) {
    if (err instanceof AiQuotaExceededError) {
      saLog(orgId, "error", "system", `Quota IA atteint: ${err.message}`);
    } else {
      saLog(orgId, "error", "system", `Erreur cycle: ${err.message}`);
    }
  } finally {
    state.running = false;
  }
}

router.post("/ai/super-agent/run", requireAdmin, async (req, res): Promise<void> => {
  const orgId = req.session?.organisationId;
  const userId = req.session?.userId;
  if (!orgId || !userId) { res.status(403).json({ error: "Organisation requise." }); return; }

  const state = getSuperAgentState(orgId);
  if (state.running) {
    res.json({ status: "already_running", message: "Cycle déjà en cours." });
    return;
  }

  res.json({ status: "started", message: "Cycle Super Agent lancé en arrière-plan." });
  runSuperAgentCycle(orgId, userId).catch((e) => {
    saLog(orgId, "error", "system", `Cycle échoué: ${e.message}`);
  });
});

router.post("/ai/super-agent/process-report", requireAdmin, async (req, res): Promise<void> => {
  const orgId = req.session?.organisationId;
  const userId = req.session?.userId;
  if (!orgId || !userId) { res.status(403).json({ error: "Organisation requise." }); return; }

  const { report, reportType = "chantier", contactId, projectId } = req.body;
  if (!report || !report.trim()) { res.status(400).json({ error: "Rapport requis." }); return; }

  try {
    await assertAiQuota(orgId);
    saLog(orgId, "info", "chantier", `Traitement rapport ${reportType}...`);

    const safeReport = sanitizePromptInput(report, 8000);
    const aiText = await superAgentAI(orgId,
      `Rapport ${reportType}:\n${safeReport}\n\nAnalyse ce rapport et extrait TOUTES les actions à faire:\n{"tasks":[{"title":"string","priority":"haute|moyenne|basse","dueInDays":3,"description":"string","assignedTo":"string|null"}],"appointments":[{"title":"string","date":"YYYY-MM-DD","time":"HH:MM","type":"rendez_vous|reunion|visite"}],"issues":[{"description":"string","severity":"haute|moyenne|basse"}],"summary":"string","nextStepUrgency":"normal|eleve|critique"}`,
      `Tu es le Super Agent IA d'Agent de Bureau. Tu analyses des rapports de chantier, de visite ou de réunion professionnels. Tu extrais TOUTES les actions concrètes à réaliser. Sois exhaustif et précis. Réponds UNIQUEMENT en JSON valide.`
    );

    let parsed: any = {};
    try { const m = aiText.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; } catch {}

    const createdTasks: any[] = [];
    for (const t of (parsed.tasks ?? [])) {
      try {
        const dueDate = new Date(Date.now() + (t.dueInDays || 3) * 86400000);
        const [inserted] = await db.insert(tasksTable).values({
          organisationId: orgId, title: t.title, description: `${t.description || ""}\n\nSource: Rapport ${reportType}${t.assignedTo ? `\nAssigné à: ${t.assignedTo}` : ""}`.trim(), priority: t.priority || "moyenne", status: "en_attente", dueDate, relatedContactId: contactId || null,
        }).returning();
        createdTasks.push(inserted);
        getSuperAgentState(orgId).stats.tasksCreated++;
      } catch (err: any) {
        logger.warn({ err: err?.message, orgId, title: t?.title }, "[SuperAgent/ProcessReport] echec insertion tache extraite par IA");
      }
    }

    const createdEvents: any[] = [];
    for (const a of (parsed.appointments ?? [])) {
      try {
        const startDate = new Date(`${a.date}T${a.time || "09:00"}:00`);
        const endDate = new Date(startDate.getTime() + 3600000);
        const [inserted] = await db.insert(calendarEventsTable).values({
          organisationId: orgId, title: a.title, type: a.type || "rendez_vous", startDate, endDate, status: "confirme", relatedContactId: contactId || null,
        }).returning();
        createdEvents.push(inserted);
      } catch (err: any) {
        logger.warn({ err: err?.message, orgId, title: a?.title }, "[SuperAgent/ProcessReport] echec insertion RDV extrait par IA");
      }
    }

    getSuperAgentState(orgId).stats.reportsProcessed++;
    saLog(orgId, "success", "chantier", `Rapport traité: ${createdTasks.length} tâche(s), ${createdEvents.length} RDV créés`, parsed.summary);

    res.json({ success: true, summary: parsed.summary, nextStepUrgency: parsed.nextStepUrgency, issues: parsed.issues ?? [], createdTasks, createdEvents, tasksCount: createdTasks.length, eventsCount: createdEvents.length });
  } catch (err: any) {
    if (err instanceof AiQuotaExceededError) { res.status(429).json({ error: err.message, quotaExceeded: true }); return; }
    logger.error({ err }, "[SuperAgent/ProcessReport]");
    res.status(500).json({ error: "Erreur traitement rapport" });
  }
});

router.get("/ai/super-agent/status", requireMinAgent, async (req, res): Promise<void> => {
  const orgId = req.session?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }
  const state = getSuperAgentState(orgId);
  res.json({ running: state.running, lastRun: state.lastRun, stats: state.stats, recentLogs: state.logs.slice(-50) });
});

export default router;
