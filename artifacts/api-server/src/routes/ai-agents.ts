import { Router } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, checkinsTable, aiAgentReportsTable, stockArticlesTable, invoicesTable, paymentsTable, subscriptionsTable, usersTable, automationRulesTable, notificationsTable, auditLogsTable, calendarEventsTable } from "@workspace/db";
import { sql, eq, gte, lte, and, count, desc, lt, ne, isNull, isNotNull, or, sum, avg } from "drizzle-orm";

const router = Router();

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
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const orgCall = eq(callsTable.organisationId, orgId);
  const orgContact = eq(contactsTable.organisationId, orgId);
  const orgTask = eq(tasksTable.organisationId, orgId);
  const orgMsg = eq(messagesTable.organisationId, orgId);
  const orgCheckin = eq(checkinsTable.organisationId, orgId);

  switch (agentId) {
    case "agent_appels": {
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const [total, missed, answered, avgDuration, noContact, negativeSentiment, noNotes, longCalls, recentCalls, incomingCalls, outgoingCalls, positiveSentiment, shortCalls, todayCalls, callsByDirection] = await Promise.all([
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
      ]);
      const totalW = total[0]?.count ?? 0;
      const answeredW = answered[0]?.count ?? 0;
      const missedW = missed[0]?.count ?? 0;
      return {
        totalThisWeek: totalW, missedThisWeek: missedW, answeredThisWeek: answeredW,
        avgDurationSeconds: avgDuration[0]?.avg ?? 0, callsWithoutContact: noContact[0]?.count ?? 0,
        negativeSentimentThisWeek: negativeSentiment[0]?.count ?? 0, positiveSentimentThisWeek: positiveSentiment[0]?.count ?? 0,
        answeredWithoutNotes: noNotes[0]?.count ?? 0, longCallsOver10min: longCalls[0]?.count ?? 0,
        shortCallsUnder30s: shortCalls[0]?.count ?? 0, totalThisMonth: recentCalls[0]?.count ?? 0,
        todayCalls: todayCalls[0]?.count ?? 0,
        incomingThisWeek: incomingCalls[0]?.count ?? 0, outgoingThisWeek: outgoingCalls[0]?.count ?? 0,
        answerRate: totalW ? Math.round((answeredW / totalW) * 100) : 0,
        missRate: totalW ? Math.round((missedW / totalW) * 100) : 0,
        sentimentRatio: answeredW ? Math.round(((positiveSentiment[0]?.count ?? 0) / answeredW) * 100) : 0,
        documentationRate: answeredW ? Math.round(((answeredW - (noNotes[0]?.count ?? 0)) / answeredW) * 100) : 0,
        avgCallsPerDay: Math.round(totalW / 7),
      };
    }
    case "agent_contacts": {
      const [total, noEmail, noPhone, noCompany, duplicatePhones, inactiveContacts, newContacts, byCategory, withNotes, highCallers] = await Promise.all([
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
      ]);
      const totalC = total[0]?.count ?? 0;
      const noE = noEmail[0]?.count ?? 0;
      const noP = noPhone[0]?.count ?? 0;
      return {
        totalContacts: totalC, withoutEmail: noE, withoutPhone: noP,
        withoutCompany: noCompany[0]?.count ?? 0, duplicatePhoneNumbers: duplicatePhones.length,
        inactiveOver30Days: inactiveContacts[0]?.count ?? 0,
        newContactsThisWeek: newContacts[0]?.count ?? 0,
        contactsWithNotes: withNotes[0]?.count ?? 0,
        highValueContacts: highCallers[0]?.count ?? 0,
        categoryBreakdown: byCategory.map(c => ({ category: c.category, count: c.cnt })),
        dataCompleteness: totalC ? Math.round(((totalC - noE - noP) / (totalC * 2)) * 100) : 0,
        emailCoverage: totalC ? Math.round(((totalC - noE) / totalC) * 100) : 0,
        phoneCoverage: totalC ? Math.round(((totalC - noP) / totalC) * 100) : 0,
        enrichmentRate: totalC ? Math.round(((withNotes[0]?.count ?? 0) / totalC) * 100) : 0,
      };
    }
    case "agent_taches": {
      const [total, pending, inProgress, completed, cancelled, overdue, highPriority, unassigned, completedThisWeek] = await Promise.all([
        db.select({ count: count() }).from(tasksTable).where(orgTask),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "en_attente"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "en_cours"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "annule"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, lt(tasksTable.dueDate, now), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.priority, "haute"), ne(tasksTable.status, "termine"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, isNull(tasksTable.assignedTo), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"), gte(tasksTable.updatedAt, weekAgo))),
      ]);
      return {
        totalTasks: total[0]?.count ?? 0, pending: pending[0]?.count ?? 0, inProgress: inProgress[0]?.count ?? 0,
        completed: completed[0]?.count ?? 0, cancelled: cancelled[0]?.count ?? 0, overdue: overdue[0]?.count ?? 0,
        highPriorityOpen: highPriority[0]?.count ?? 0, unassigned: unassigned[0]?.count ?? 0,
        completedThisWeek: completedThisWeek[0]?.count ?? 0,
        completionRate: total[0]?.count ? Math.round(((completed[0]?.count ?? 0) / total[0].count) * 100) : 0,
      };
    }
    case "agent_messages": {
      const [total, unread, highPriorityUnread, oldUnread, byType] = await Promise.all([
        db.select({ count: count() }).from(messagesTable).where(orgMsg),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false), eq(messagesTable.priority, "haute"))),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false), lt(messagesTable.createdAt, new Date(now.getTime() - 48 * 60 * 60 * 1000)))),
        db.select({ type: messagesTable.type, cnt: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))).groupBy(messagesTable.type),
      ]);
      return {
        totalMessages: total[0]?.count ?? 0, unreadCount: unread[0]?.count ?? 0,
        urgentUnread: highPriorityUnread[0]?.count ?? 0, staleUnreadOver48h: oldUnread[0]?.count ?? 0,
        unreadByType: byType.map(t => ({ type: t.type, count: t.cnt })),
        readRate: total[0]?.count ? Math.round((((total[0]?.count ?? 0) - (unread[0]?.count ?? 0)) / (total[0]?.count || 1)) * 100) : 0,
      };
    }
    case "agent_pointage": {
      const [totalSessions, activeSessions, avgMinutes, lateArrivals, bureauCount, distanceCount, terrainCount, totalBreak] = await Promise.all([
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, or(eq(checkinsTable.status, "present"), eq(checkinsTable.status, "en_pause")))),
        db.select({ avg: sql<number>`coalesce(avg(${checkinsTable.totalMinutes}), 0)::int` }).from(checkinsTable).where(and(orgCheckin, eq(checkinsTable.status, "termine"), gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo), sql`extract(hour from ${checkinsTable.checkInAt}) >= 10`)),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, eq(checkinsTable.type, "bureau"), gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, eq(checkinsTable.type, "distance"), gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, eq(checkinsTable.type, "terrain"), gte(checkinsTable.checkInAt, weekAgo))),
        db.select({ total: sql<number>`coalesce(sum(${checkinsTable.breakMinutes}), 0)::int` }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo))),
      ]);
      return {
        sessionsThisWeek: totalSessions[0]?.count ?? 0, currentlyActive: activeSessions[0]?.count ?? 0,
        avgSessionMinutes: avgMinutes[0]?.avg ?? 0, lateArrivalsThisWeek: lateArrivals[0]?.count ?? 0,
        bureauSessions: bureauCount[0]?.count ?? 0, distanceSessions: distanceCount[0]?.count ?? 0,
        terrainSessions: terrainCount[0]?.count ?? 0, totalBreakMinutes: totalBreak[0]?.total ?? 0,
      };
    }
    case "agent_facturation": {
      const orgInv = eq(invoicesTable.organisationId, orgId);
      const orgPay = eq(paymentsTable.organisationId, orgId);
      const [totalInvoices, unpaidInvoices, overdueInvoices, totalRevenue, totalPayments, matchedPayments, recentInvoices, subscription] = await Promise.all([
        db.select({ count: count() }).from(invoicesTable).where(orgInv),
        db.select({ count: count() }).from(invoicesTable).where(and(orgInv, sql`${invoicesTable.status} IN ('en_attente', 'retard', 'partiel')`)),
        db.select({ count: count() }).from(invoicesTable).where(and(orgInv, eq(invoicesTable.status, "retard"))),
        db.select({ total: sql<number>`coalesce(sum(${invoicesTable.totalAmount}), 0)::numeric` }).from(invoicesTable).where(and(orgInv, eq(invoicesTable.status, "payee"))),
        db.select({ count: count() }).from(paymentsTable).where(orgPay),
        db.select({ count: count() }).from(paymentsTable).where(and(orgPay, eq(paymentsTable.status, "matched"))),
        db.select({ count: count() }).from(invoicesTable).where(and(orgInv, gte(invoicesTable.createdAt, monthAgo))),
        db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)).limit(1),
      ]);
      const sub = subscription[0];
      return {
        totalInvoices: totalInvoices[0]?.count ?? 0,
        unpaidInvoices: unpaidInvoices[0]?.count ?? 0,
        overdueInvoices: overdueInvoices[0]?.count ?? 0,
        totalRevenuePaid: totalRevenue[0]?.total ?? 0,
        totalPayments: totalPayments[0]?.count ?? 0,
        matchedPayments: matchedPayments[0]?.count ?? 0,
        invoicesThisMonth: recentInvoices[0]?.count ?? 0,
        subscription: sub ? { plan: sub.plan, status: sub.status, price: sub.price, billingCycle: sub.billingCycle, trialEndsAt: sub.trialEndsAt, currentPeriodEnd: sub.currentPeriodEnd } : null,
        paymentMatchRate: (totalPayments[0]?.count ?? 0) > 0 ? Math.round(((matchedPayments[0]?.count ?? 0) / (totalPayments[0]?.count ?? 1)) * 100) : 0,
        collectionRate: (totalInvoices[0]?.count ?? 0) > 0 ? Math.round((((totalInvoices[0]?.count ?? 0) - (unpaidInvoices[0]?.count ?? 0)) / (totalInvoices[0]?.count ?? 1)) * 100) : 0,
      };
    }
    case "agent_stock": {
      const orgStock = eq(stockArticlesTable.organisationId, orgId);
      const [totalArticles, lowStock, outOfStock, totalValue, byCategory, recentArticles, noBarcode, noCategory] = await Promise.all([
        db.select({ count: count() }).from(stockArticlesTable).where(orgStock),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, sql`${stockArticlesTable.quantity} <= ${stockArticlesTable.minQuantity}`, sql`${stockArticlesTable.quantity} > 0`)),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, eq(stockArticlesTable.quantity, 0))),
        db.select({ total: sql<number>`coalesce(sum(${stockArticlesTable.quantity} * ${stockArticlesTable.unitPrice}), 0)::numeric` }).from(stockArticlesTable).where(orgStock),
        db.select({ category: stockArticlesTable.category, cnt: count() }).from(stockArticlesTable).where(orgStock).groupBy(stockArticlesTable.category),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, gte(stockArticlesTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, isNull(stockArticlesTable.barcode))),
        db.select({ count: count() }).from(stockArticlesTable).where(and(orgStock, or(isNull(stockArticlesTable.category), eq(stockArticlesTable.category, "")))),
      ]);
      const totalA = totalArticles[0]?.count ?? 0;
      return {
        totalArticles: totalA,
        lowStockAlerts: lowStock[0]?.count ?? 0,
        outOfStock: outOfStock[0]?.count ?? 0,
        totalInventoryValue: totalValue[0]?.total ?? 0,
        categoryBreakdown: byCategory.map(c => ({ category: c.category || "Sans categorie", count: c.cnt })),
        newArticlesThisWeek: recentArticles[0]?.count ?? 0,
        articlesWithoutBarcode: noBarcode[0]?.count ?? 0,
        articlesWithoutCategory: noCategory[0]?.count ?? 0,
        stockHealthRate: totalA ? Math.round(((totalA - (lowStock[0]?.count ?? 0) - (outOfStock[0]?.count ?? 0)) / totalA) * 100) : 0,
        dataQuality: totalA ? Math.round(((totalA - (noBarcode[0]?.count ?? 0) - (noCategory[0]?.count ?? 0)) / totalA) * 100) : 0,
      };
    }
    case "agent_rh": {
      const orgUser = eq(usersTable.organisationId, orgId);
      const [totalUsers, activeUsers, inactiveUsers, mfaEnabled, lockedAccounts, byRole, recentLogins, neverLoggedIn] = await Promise.all([
        db.select({ count: count() }).from(usersTable).where(orgUser),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, eq(usersTable.actif, true))),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, eq(usersTable.actif, false))),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, eq(usersTable.mfaActif, true))),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, isNotNull(usersTable.verrouilleJusqua), gte(usersTable.verrouilleJusqua, now))),
        db.select({ role: usersTable.role, cnt: count() }).from(usersTable).where(orgUser).groupBy(usersTable.role),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, isNotNull(usersTable.dernierAcces), gte(usersTable.dernierAcces, weekAgo))),
        db.select({ count: count() }).from(usersTable).where(and(orgUser, isNull(usersTable.dernierAcces))),
      ]);
      const totalU = totalUsers[0]?.count ?? 0;
      const activeU = activeUsers[0]?.count ?? 0;
      return {
        totalEmployees: totalU,
        activeEmployees: activeU,
        inactiveEmployees: inactiveUsers[0]?.count ?? 0,
        mfaEnabled: mfaEnabled[0]?.count ?? 0,
        lockedAccounts: lockedAccounts[0]?.count ?? 0,
        activeThisWeek: recentLogins[0]?.count ?? 0,
        neverLoggedIn: neverLoggedIn[0]?.count ?? 0,
        roleDistribution: byRole.map(r => ({ role: r.role, count: r.cnt })),
        mfaAdoptionRate: totalU ? Math.round(((mfaEnabled[0]?.count ?? 0) / totalU) * 100) : 0,
        activityRate: activeU ? Math.round(((recentLogins[0]?.count ?? 0) / activeU) * 100) : 0,
        accountHealthRate: totalU ? Math.round(((activeU - (lockedAccounts[0]?.count ?? 0)) / totalU) * 100) : 0,
      };
    }
    case "agent_securite": {
      const orgUserSec = eq(usersTable.organisationId, orgId);
      const [totalContacts, callsWithoutContact, noNotesAnswered, totalCheckins, auditEntries, recentAudits, failedLogins, totalUsers, mfaUsers, notifications] = await Promise.all([
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
      ]);
      const totalU = totalUsers[0]?.count ?? 0;
      return {
        contactsTotal: totalContacts[0]?.count ?? 0,
        unlinkedCalls: callsWithoutContact[0]?.count ?? 0,
        callsWithoutDocumentation: noNotesAnswered[0]?.count ?? 0,
        totalCheckinRecords: totalCheckins[0]?.count ?? 0,
        totalAuditEntries: auditEntries[0]?.count ?? 0,
        auditEntriesThisWeek: recentAudits[0]?.count ?? 0,
        usersWithFailedLogins: failedLogins[0]?.count ?? 0,
        mfaAdoptionRate: totalU ? Math.round(((mfaUsers[0]?.count ?? 0) / totalU) * 100) : 0,
        unreadNotifications: notifications[0]?.count ?? 0,
        tracabilityScore: Math.min(100, (auditEntries[0]?.count ?? 0) > 0 ? 70 + Math.min(30, Math.round((recentAudits[0]?.count ?? 0) / 10)) : 30),
      };
    }
    case "agent_performance": {
      const [totalCalls, answeredCalls, totalTasks, completedTasks, totalContacts, totalMessages, unreadMessages, totalCheckins, overdueT, newContacts, totalStock, lowStock] = await Promise.all([
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
      ]);
      const tCalls = totalCalls[0]?.count ?? 0;
      const tTasks = totalTasks[0]?.count ?? 0;
      return {
        callsThisWeek: tCalls, answerRate: tCalls ? Math.round(((answeredCalls[0]?.count ?? 0) / tCalls) * 100) : 0,
        totalTasks: tTasks, taskCompletionRate: tTasks ? Math.round(((completedTasks[0]?.count ?? 0) / tTasks) * 100) : 0,
        overdueTasks: overdueT[0]?.count ?? 0,
        totalContacts: totalContacts[0]?.count ?? 0, newContactsThisWeek: newContacts[0]?.count ?? 0,
        totalMessages: totalMessages[0]?.count ?? 0, unreadMessages: unreadMessages[0]?.count ?? 0,
        checkinsThisWeek: totalCheckins[0]?.count ?? 0,
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
    agent_appels: `Tu es le Responsable Telephonie IA d'un bureau professionnel en France. Tu geres le standard telephonique comme un employe de bureau senior.

TON ROLE REEL DANS LE BUREAU:
- Tu supervises TOUS les appels entrants et sortants
- Tu identifies les clients mecontents et les rappels urgents a faire
- Tu verifies que chaque appel repondu est correctement documente avec des notes
- Tu detectes les heures de pointe et les periodes creuses pour optimiser les equipes
- Tu t'assures que les appels manques critiques sont rappeles dans l'heure
- Tu analyses le ratio entrant/sortant pour mesurer la proactivite commerciale

ANALYSES DETAILLEES A FOURNIR:
1. Taux de reponse vs objectif (>90% = bon, <70% = critique)
2. Qualite de documentation (appels avec notes / total repondus)
3. Gestion du sentiment client (negatifs traites vs ignores)
4. Performance par direction (entrant vs sortant)
5. Appels courts suspects (<30s = peut-etre raccroche trop vite)
6. Appels longs (>10min = peut-etre probleme non resolu)
7. Orphelins (appels sans contact associe = perte de tracabilite)

Sois concret: "Il y a 12 appels manques cette semaine dont 5 de clients importants non rappeles" plutot que "il y a des appels manques".`,

    agent_contacts: `Tu es le Responsable CRM IA d'un bureau professionnel en France. Tu geres la base clients comme un directeur commercial.

TON ROLE REEL DANS LE BUREAU:
- Tu maintiens une base de contacts propre, complete et a jour
- Tu identifies les doublons, les fiches incompletes et les donnees obsoletes
- Tu segmentes les contacts par categorie et valeur commerciale
- Tu detectes les clients inactifs qui risquent d'etre perdus
- Tu proposes des campagnes de recontact ciblees
- Tu verifies la conformite RGPD des donnees stockees

ANALYSES DETAILLEES A FOURNIR:
1. Qualite des donnees (% de fiches completes avec email + telephone + entreprise)
2. Doublons detectes et impact sur les statistiques faussees
3. Contacts inactifs >30 jours qui necessitent un suivi
4. Repartition par categorie (clients, prospects, fournisseurs, partenaires)
5. Contacts "haute valeur" (>5 appels) vs contacts negliges
6. Taux d'enrichissement (contacts avec notes/historique vs fiches vides)
7. Nouveaux contacts ajoutes cette semaine vs objectif de croissance

Chaque suggestion doit etre actionnable: "Enrichir les 23 contacts sans email en priorite car ils representent 15% de la base".`,

    agent_taches: `Tu es le Directeur de Production IA d'un bureau professionnel en France. Tu pilotes la productivite comme un chef de projet senior.

TON ROLE REEL DANS LE BUREAU:
- Tu supervises TOUTES les taches en cours, en attente et en retard
- Tu detectes les blocages et goulots d'etranglement avant qu'ils ne s'aggravent
- Tu verifies que chaque tache a un responsable et une date limite
- Tu escalade les retards critiques et reorganise les priorites
- Tu analyse la charge de travail pour eviter la surcharge de certains employes
- Tu suit le taux de completion comme un indicateur de sante de l'equipe

ANALYSES DETAILLEES A FOURNIR:
1. Velocity: taches terminees cette semaine vs semaine precedente
2. Retards: nombre et gravite (1-3 jours = attention, >7 jours = critique)
3. Taches non assignees qui trainent sans responsable
4. Balance de charge: est-ce que tout repose sur une seule personne?
5. Ratio taches haute priorite / basse priorite (trop de "urgentes" = mauvaise planification)
6. Taches bloquees depuis >7 jours sans mise a jour
7. Estimation du temps necessaire pour resoudre le backlog actuel

Propose un plan d'action concret: "Reassigner 3 taches de Pierre a Marie qui a de la capacite, et escalader les 2 taches bloquees depuis 10 jours".`,

    agent_messages: `Tu es le Responsable Communication IA d'un bureau professionnel en France. Tu geres les flux de communication comme un office manager.

TON ROLE REEL DANS LE BUREAU:
- Tu t'assures que AUCUN message urgent ne reste sans reponse
- Tu detectes les accumulations de messages non lus (signe de surcharge)
- Tu priorise les messages par urgence et impact business
- Tu identifie les canaux de communication sous-utilises ou surcharges
- Tu analyse les temps de reponse pour ameliorer le service client
- Tu veille a ce que les communications internes soient fluides

ANALYSES DETAILLEES A FOURNIR:
1. Messages non lus par priorite (urgents vs normaux)
2. Anciennete des messages non traites (>48h = alarme)
3. Volume par type de message (email, note, SMS, interne)
4. Tendance: est-ce que le backlog augmente ou diminue?
5. Temps de reponse moyen estime
6. Recommandations de traitement par lots pour eliminer l'arrierre

Sois direct: "15 messages urgents non lus dont 3 datent de plus de 48h - traitement immediat requis".`,

    agent_pointage: `Tu es le Responsable Planning et Presences IA d'un bureau professionnel en France. Tu geres les horaires comme un DRH.

TON ROLE REEL DANS LE BUREAU:
- Tu analyses les horaires de travail et detectes les anomalies
- Tu verifies la ponctualite (arrivees apres 10h = retard)
- Tu controles l'equilibre bureau/teletravail/terrain selon la politique
- Tu surveilles les durees de pause pour detecter les abus
- Tu calcule les heures supplementaires et les sous-horaires
- Tu identifie les patterns de presenteisme ou d'absenteisme

ANALYSES DETAILLEES A FOURNIR:
1. Taux de ponctualite de l'equipe (arrivees avant/apres 10h)
2. Duree moyenne de travail vs 8h cible
3. Repartition bureau/distance/terrain (equilibre sain vs desequilibre)
4. Sessions actuellement actives (qui est au bureau maintenant?)
5. Total des pauses: excessif (>90min/jour) vs insuffisant (<15min = risque burnout)
6. Tendances hebdomadaires: amelioration ou degradation?
7. Recommandations pour optimiser la planification des equipes`,

    agent_facturation: `Tu es le Controleur Financier IA d'un bureau professionnel en France. Tu geres la facturation comme un comptable senior.

TON ROLE REEL DANS LE BUREAU:
- Tu supervises TOUTES les factures emises et leur paiement
- Tu detectes les factures impayees et les retards de paiement
- Tu verifie la coherence entre factures et paiements recus
- Tu analyse la tresorerie et le chiffre d'affaires
- Tu surveille l'abonnement et les limites du plan
- Tu identifie les ecarts et les anomalies comptables

ANALYSES DETAILLEES A FOURNIR:
1. Factures impayees et leur anciennete (procedure de relance?)
2. Taux de recouvrement (factures payees / total emis)
3. Paiements rapproches vs non rapproches (problemes de matching)
4. Chiffre d'affaires du mois vs mois precedent
5. Etat de l'abonnement: limites atteintes? Renouvellement proche?
6. Recommandations pour ameliorer la tresorerie

Sois precis avec les montants: "3 factures impayees pour un total de 2,450 EUR dont 2 en retard de plus de 30 jours".`,

    agent_stock: `Tu es le Responsable Logistique IA d'un bureau professionnel en France. Tu geres les stocks comme un gestionnaire d'entrepot senior.

TON ROLE REEL DANS LE BUREAU:
- Tu surveilles les niveaux de stock et anticipes les ruptures
- Tu detectes les articles en dessous du seuil minimum
- Tu verifie la qualite des donnees inventaire (codes-barres, categories)
- Tu calcule la valeur totale de l'inventaire
- Tu identifie les articles qui ne bougent pas (stock dormant)
- Tu propose les commandes de reapprovisionnement

ANALYSES DETAILLEES A FOURNIR:
1. Alertes de stock bas: quels articles commander en priorite
2. Articles en rupture complete: impact sur l'activite
3. Valeur totale de l'inventaire et repartition par categorie
4. Qualite des donnees: articles sans code-barre, sans categorie
5. Tendance: le stock est-il bien gere ou en degradation?
6. Recommandations de reapprovisionnement avec priorites

Sois concret: "5 articles en rupture dont 2 critiques pour l'activite quotidienne, commande recommandee sous 48h".`,

    agent_rh: `Tu es le Directeur des Ressources Humaines IA d'un bureau professionnel en France. Tu geres le personnel comme un DRH senior.

TON ROLE REEL DANS LE BUREAU:
- Tu supervises les comptes employes et leur etat (actif, inactif, verrouille)
- Tu verifies la securite des comptes (MFA, tentatives echouees)
- Tu analyse l'activite des employes (connexions recentes vs inactifs)
- Tu veille a la bonne repartition des roles dans l'equipe
- Tu detecte les comptes abandonnes ou suspects
- Tu propose des actions d'amelioration pour l'engagement

ANALYSES DETAILLEES A FOURNIR:
1. Etat des comptes: actifs, inactifs, verrouilles (pourquoi?)
2. Securite: taux d'adoption du MFA (objectif: 100%)
3. Activite: qui s'est connecte cette semaine vs comptes dormants
4. Comptes jamais utilises: formation necessaire ou suppression?
5. Repartition des roles: equilibre admin/manager/agent
6. Recommandations RH: formations, desactivations, alertes

Sois direct: "2 comptes verrouilles, 3 employes jamais connectes depuis la creation, et seulement 40% des employes ont active le MFA".`,

    agent_securite: `Tu es le Responsable Securite et Conformite IA d'un bureau professionnel en France. Tu veilles a la securite comme un RSSI.

TON ROLE REEL DANS LE BUREAU:
- Tu audites la tracabilite de TOUTES les actions dans le systeme
- Tu verifies la conformite RGPD (donnees personnelles, droit a l'oubli)
- Tu detectes les failles de securite (comptes non securises, acces suspects)
- Tu analyse les logs d'audit pour identifier les comportements anormaux
- Tu controle que les appels sont documentes (obligation legale)
- Tu verifie que les donnees sensibles sont correctement protegees

ANALYSES DETAILLEES A FOURNIR:
1. Score de tracabilite (actions auditees / actions totales)
2. Appels sans documentation (risque legal en cas de litige)
3. Contacts non lies aux appels (perte de tracabilite client)
4. Taux d'adoption MFA (objectif: 100% des employes)
5. Tentatives de connexion echouees (potentiel brute-force)
6. Notifications non lues (alertes de securite ignorees?)
7. Conformite RGPD: donnees incompletes, droit a l'oubli non respecte
8. Recommandations de securisation par priorite

Classe chaque risque par impact: "CRITIQUE: 5 comptes sans MFA exposent l'organisation a un risque d'intrusion".`,

    agent_performance: `Tu es le Directeur General Adjoint IA d'un bureau professionnel en France. Tu pilotes la performance comme un DGA.

TON ROLE REEL DANS LE BUREAU:
- Tu synthetises TOUS les indicateurs du bureau en un tableau de bord global
- Tu identifies les forces et faiblesses de l'organisation
- Tu calcules un score de performance global base sur des criteres objectifs
- Tu detectes les correlations entre les differents services
- Tu propose des objectifs realistes pour la semaine suivante
- Tu compares les performances actuelles avec les standards du secteur

ANALYSES DETAILLEES A FOURNIR:
1. Score global du bureau (calcule a partir de: appels, taches, contacts, messages, stock)
2. Top 3 des forces: ce qui fonctionne bien
3. Top 3 des faiblesses: ce qui necessite une action immediate
4. Tendances: amelioration ou degradation par rapport a la semaine precedente
5. KPIs cles avec status (bon/attention/critique)
6. Plan d'action prioritaire pour la semaine suivante
7. Benchmark: comparaison avec les objectifs standards d'un bureau performant

Propose un plan d'action concret: "Priorite 1: reduire les 8 taches en retard. Priorite 2: traiter les 15 messages urgents. Priorite 3: reapprovisionner les 5 articles en rupture".`,
  };
  return prompts[agent.id] || "";
}

const AGENT_RESPONSE_FORMAT = `Reponds en JSON avec cette structure exacte:
{
  "score": number (0-100, note globale de sante pour ton domaine),
  "summary": "string (resume en 2-3 phrases de la situation)",
  "errors": [{"titre": "string", "description": "string", "severity": "critique|haute|moyenne", "action": "string (correction recommandee)"}],
  "warnings": [{"titre": "string", "description": "string", "impact": "string"}],
  "suggestions": [{"titre": "string", "description": "string", "priorite": "haute|moyenne|basse", "benefice": "string"}],
  "corrections": [{"element": "string (ce qui doit etre corrige)", "probleme": "string", "solution": "string", "urgence": "haute|moyenne|basse"}],
  "kpis": [{"label": "string", "valeur": "string", "tendance": "hausse|baisse|stable", "status": "bon|attention|critique"}]
}
Genere entre 2 et 5 elements pour chaque categorie. Sois concret et actionnable.`;

async function runSingleAgent(agent: typeof AGENTS[0], orgId: number): Promise<any> {
  const startTime = Date.now();
  const today = new Date().toISOString().split("T")[0];

  try {
    const data = await gatherAgentData(agent.id, orgId);
    const { ai } = await import("@workspace/integrations-gemini-ai");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `${getAgentPrompt(agent)}\n\n${AGENT_RESPONSE_FORMAT}\n\nDonnees actuelles:\n${JSON.stringify(data, null, 2)}`
        }],
      }],
      config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
    });

    const text = response.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { score: 50, summary: text, errors: [], warnings: [], suggestions: [], corrections: [], kpis: [] };
    }

    const executionTimeMs = Date.now() - startTime;

    const [report] = await db.insert(aiAgentReportsTable).values({
      agentId: agent.id,
      agentName: agent.name,
      agentIcon: agent.icon,
      reportDate: today,
      status: "termine",
      score: parsed.score || 50,
      errorsFound: parsed.errors?.length || 0,
      warningsFound: parsed.warnings?.length || 0,
      suggestionsCount: parsed.suggestions?.length || 0,
      summary: parsed.summary || "Aucun resume disponible",
      details: { kpis: parsed.kpis || [], rawData: data },
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
    console.error("OpenAI review error:", error.message);
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
    console.error("Anthropic strategy error:", error.message);
    return { strategieGlobale: "Strategie Anthropic non disponible", prioritesStrategiques: [], risques: [], opportunites: [] };
  }
}

async function runSuperAgent(childReports: any[]): Promise<any> {
  const startTime = Date.now();
  const today = new Date().toISOString().split("T")[0];

  try {
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

router.post("/ai/agents/run", async (_req, res) => {
  try {
    const orgId = (_req.session as any)?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const childReports = await Promise.all(
      AGENTS.map(agent => runSingleAgent(agent, orgId))
    );

    const superReport = await runSuperAgent(childReports);

    res.json({
      superReport,
      agentReports: childReports,
      totalExecutionTimeMs: childReports.reduce((acc, r) => acc + (r.executionTimeMs || 0), 0) + (superReport.executionTimeMs || 0),
    });
  } catch (error: any) {
    console.error("AI Agents run error:", error);
    res.status(500).json({ error: "Erreur lors de l'execution des agents IA", details: error.message });
  }
});

router.post("/ai/agents/run/:agentId", async (req, res) => {
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
    console.error("AI Agent run error:", error);
    res.status(500).json({ error: "Erreur lors de l'execution de l'agent", details: error.message });
  }
});

router.post("/ai/agents/super", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const todayReports = await db.select().from(aiAgentReportsTable)
      .where(and(eq(aiAgentReportsTable.reportDate, today), eq(aiAgentReportsTable.isSuperReport, false)))
      .orderBy(desc(aiAgentReportsTable.createdAt))
      .limit(10);

    if (todayReports.length === 0) {
      res.status(400).json({ error: "Aucun rapport d'agent disponible aujourd'hui. Lancez d'abord les agents." });
      return;
    }

    const superReport = await runSuperAgent(todayReports);
    res.json(superReport);
  } catch (error: any) {
    console.error("Super Agent error:", error);
    res.status(500).json({ error: "Erreur Super Agent", details: error.message });
  }
});

router.get("/ai/agents/reports", async (req, res) => {
  const { date, agentId, superOnly } = req.query as Record<string, string>;
  const conditions = [];

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

router.get("/ai/agents/reports/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID invalide" });
    return;
  }
  const [report] = await db.select().from(aiAgentReportsTable).where(eq(aiAgentReportsTable.id, id));
  if (!report) {
    res.status(404).json({ error: "Rapport introuvable" });
    return;
  }
  res.json(report);
});

router.get("/ai/agents/latest", async (_req, res) => {
  const latestByAgent: Record<string, any> = {};
  const allAgentIds = [...AGENTS.map(a => a.id), "super_agent"];

  for (const agentId of allAgentIds) {
    const [latest] = await db.select().from(aiAgentReportsTable)
      .where(eq(aiAgentReportsTable.agentId, agentId))
      .orderBy(desc(aiAgentReportsTable.createdAt))
      .limit(1);
    if (latest) latestByAgent[agentId] = latest;
  }

  res.json(latestByAgent);
});

router.get("/ai/agents/config", async (_req, res) => {
  res.json({ agents: AGENTS, autoRunEnabled: !!autoRunInterval, autoRunIntervalMinutes: 120 });
});

let autoRunInterval: ReturnType<typeof setInterval> | null = null;

router.post("/ai/agents/auto-start", async (_req, res) => {
  const orgId = (_req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

  if (autoRunInterval) {
    res.json({ message: "L'execution automatique est deja active", status: "active" });
    return;
  }

  autoRunInterval = setInterval(async () => {
    console.log("[AI Agents] Execution automatique demarree:", new Date().toISOString());
    try {
      const childReports = await Promise.all(AGENTS.map(a => runSingleAgent(a, orgId)));
      await runSuperAgent(childReports);
      console.log("[AI Agents] Execution automatique terminee:", new Date().toISOString());
    } catch (error) {
      console.error("[AI Agents] Erreur execution automatique:", error);
    }
  }, 2 * 60 * 60 * 1000);

  const childReports = await Promise.all(AGENTS.map(a => runSingleAgent(a, orgId)));
  const superReport = await runSuperAgent(childReports);

  res.json({
    message: "Execution automatique activee (toutes les 2 heures)",
    status: "active",
    firstRun: { superReport, agentReports: childReports },
  });
});

router.post("/ai/agents/auto-stop", async (_req, res) => {
  if (autoRunInterval) {
    clearInterval(autoRunInterval);
    autoRunInterval = null;
  }
  res.json({ message: "Execution automatique arretee", status: "inactive" });
});

const autopilotState = new Map<number, {
  interval: ReturnType<typeof setInterval> | null;
  log: Array<{ timestamp: string; type: string; message: string; provider?: string; severity?: string }>;
  status: { active: boolean; lastRun?: string; cycleCount: number; fixesApplied: number; issuesFound: number };
}>();

function getOrgAutopilot(orgId: number) {
  if (!autopilotState.has(orgId)) {
    autopilotState.set(orgId, {
      interval: null,
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
        const stuckList = await db.select({ id: tasksTable.id, title: tasksTable.title })
          .from(tasksTable)
          .where(and(orgTask, eq(tasksTable.status, "en_cours"), sql`${tasksTable.updatedAt} < NOW() - INTERVAL '7 days'`))
          .limit(10);

        if (stuckList.length > 0) {
          for (const task of stuckList) {
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
    try { parsedConsensus = consensusSummary ? JSON.parse(consensusSummary) : null; } catch {}

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

router.post("/ai/autopilot/run", async (req, res): Promise<void> => {
  const orgId = (req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }
  try {
    const result = await runAutopilotCycle(orgId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Erreur cycle Oto-Pilot", details: err.message });
  }
});

router.post("/ai/autopilot/start", async (req, res): Promise<void> => {
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
    try {
      await runAutopilotCycle(orgId);
    } catch (e: any) {
      addAutopilotLog(orgId, "error", `Cycle automatique echoue: ${e.message}`, "system", "haute");
    }
  }, 30 * 60 * 1000);

  res.json({
    status: "active",
    message: "Oto-Pilot active - cycles toutes les 30 minutes",
    ...state.status,
    firstCycle: firstResult,
  });
});

router.post("/ai/autopilot/stop", async (req, res): Promise<void> => {
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

router.get("/ai/autopilot/status", async (req, res): Promise<void> => {
  const orgId = (req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

  const state = getOrgAutopilot(orgId);
  res.json({
    ...state.status,
    recentLogs: state.log.slice(-30),
  });
});

router.get("/ai/autopilot/logs", async (req, res): Promise<void> => {
  const orgId = (req.session as any)?.organisationId;
  if (!orgId) { res.status(403).json({ error: "Organisation requise." }); return; }

  const state = getOrgAutopilot(orgId);
  res.json({ logs: state.log, total: state.log.length });
});

export default router;
