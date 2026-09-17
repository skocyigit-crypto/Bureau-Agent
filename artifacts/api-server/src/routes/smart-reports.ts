import { Router, type Request, type Response } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, prospectsTable, calendarEventsTable, projetsTable } from "@workspace/db";
import { eq, sql, and, gte, lt, lte, desc } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { logger } from "../lib/logger";
import {
  bornerJours, derniersJours, ecart, FUSEAU, heureLocale, libelleJour,
  pourcent, rangSeverite, scoreGlobal, tauxDeGain, tendance,
} from "../services/rapport-executif";

const router = Router();

router.get("/smart-reports/executive-summary", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const periodDays = bornerJours(req.query.days, 30);

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
      projetsStats,
    ] = await Promise.all([
      db.select({
        total: sql<number>`count(*)::int`,
        answered: sql<number>`count(*) filter (where ${callsTable.status} = 'repondu')::int`,
        missed: sql<number>`count(*) filter (where ${callsTable.status} = 'manque')::int`,
        avgDuration: sql<number>`coalesce(avg(${callsTable.duration}), 0)::int`,
        totalDuration: sql<number>`coalesce(sum(${callsTable.duration}), 0)::int`,
      }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        answered: sql<number>`count(*) filter (where ${callsTable.status} = 'repondu')::int`,
      }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, prevStart), lt(callsTable.createdAt, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        newThisPeriod: sql<number>`count(*) filter (where ${contactsTable.createdAt} >= ${startDate})::int`,
      }).from(contactsTable).where(eq(contactsTable.organisationId, orgId)),

      db.select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'termine')::int`,
        inProgress: sql<number>`count(*) filter (where ${tasksTable.status} = 'en_cours')::int`,
        overdue: sql<number>`count(*) filter (where ${tasksTable.status} != 'termine' and ${tasksTable.dueDate} < now())::int`,
        highPriority: sql<number>`count(*) filter (where ${tasksTable.priority} = 'haute')::int`,
      }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), gte(tasksTable.createdAt, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'termine')::int`,
      }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), gte(tasksTable.createdAt, prevStart), lt(tasksTable.createdAt, startDate))),

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
        lost: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'perdu')::int`,
      }).from(prospectsTable).where(and(eq(prospectsTable.organisationId, orgId), gte(prospectsTable.createdAt, prevStart), lt(prospectsTable.createdAt, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        upcoming: sql<number>`count(*) filter (where ${calendarEventsTable.startDate} > now())::int`,
      }).from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), gte(calendarEventsTable.startDate, startDate))),

      db.select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${projetsTable.status} not in ('termine','annule'))::int`,
        termine: sql<number>`count(*) filter (where ${projetsTable.status} = 'termine')::int`,
        overdue: sql<number>`count(*) filter (where ${projetsTable.endDate} < now() and ${projetsTable.status} not in ('termine','annule'))::int`,
        avgProgress: sql<number>`coalesce(avg(${projetsTable.progress}) filter (where ${projetsTable.status} not in ('annule')), 0)::int`,
      }).from(projetsTable).where(eq(projetsTable.organisationId, orgId)),
    ]);

    const cs = callStats[0];
    const pcs = prevCallStats[0];
    const ts = taskStats[0];
    const pts = prevTaskStats[0];
    const ps = prospectStats[0];
    const pps = prevProspectStats[0];
    const proj = projetsStats[0] ?? { total: 0, active: 0, termine: 0, overdue: 0, avgProgress: 0 };

    // `null` = on ne sait pas. Voir services/rapport-executif.ts.
    const callTrend = tendance(cs.total, pcs.total);
    const responseRate = pourcent(cs.answered, cs.total);
    const prevResponseRate = pourcent(pcs.answered, pcs.total);
    const taskCompletionRate = pourcent(ts.completed, ts.total);
    const prevTaskCompletionRate = pourcent(pts.completed, pts.total);
    const winRate = tauxDeGain(ps.won, ps.lost);
    const prevWinRate = tauxDeGain(pps.won, pps.lost);

    const overallScore = scoreGlobal([responseRate, taskCompletionRate, winRate]);

    const insights: Array<{ type: string; severity: string; message: string; metric?: string }> = [];

    const ecartReponse = ecart(responseRate, prevResponseRate);
    if (responseRate !== null && responseRate < 70) insights.push({ type: "appels", severity: "critique", message: `Taux de reponse faible: ${responseRate}%. Objectif: 85%+`, metric: `${responseRate}%` });
    else if (ecartReponse !== null && ecartReponse > 0) insights.push({ type: "appels", severity: "positif", message: `Taux de reponse en hausse: ${responseRate}% (+${ecartReponse} pts)`, metric: `+${ecartReponse} pts` });

    if (ts.overdue > 5) insights.push({ type: "taches", severity: "alerte", message: `${ts.overdue} taches en retard necessitent attention`, metric: `${ts.overdue}` });
    const ecartTaches = ecart(taskCompletionRate, prevTaskCompletionRate);
    if (ecartTaches !== null && ecartTaches > 5) insights.push({ type: "taches", severity: "positif", message: `Productivite en hausse: ${taskCompletionRate}% de completion (+${ecartTaches} pts)`, metric: `+${ecartTaches} pts` });

    if (Number(ps.wonValue) > 0) insights.push({ type: "prospects", severity: "positif", message: `${ps.won} prospects gagnes pour ${Number(ps.wonValue).toLocaleString("fr-FR")} EUR`, metric: `${Number(ps.wonValue).toLocaleString("fr-FR")} EUR` });
    if (ps.lost > ps.won && ps.won + ps.lost > 5) insights.push({ type: "prospects", severity: "alerte", message: `Plus de prospects perdus (${ps.lost}) que gagnes (${ps.won})`, metric: winRate === null ? "—" : `${winRate}%` });

    if (messageStats[0].unread > 20) insights.push({ type: "messages", severity: "alerte", message: `${messageStats[0].unread} messages non lus en attente`, metric: `${messageStats[0].unread}` });
    if (proj.overdue > 0) insights.push({ type: "projets", severity: proj.overdue > 3 ? "critique" : "alerte", message: `${proj.overdue} projet${proj.overdue > 1 ? "s" : ""} en retard sur planning`, metric: `${proj.overdue}` });
    if (proj.active > 0 && proj.avgProgress > 0) insights.push({ type: "projets", severity: "info", message: `${proj.active} projet${proj.active > 1 ? "s" : ""} actif${proj.active > 1 ? "s" : ""} — avancement moyen ${proj.avgProgress}%`, metric: `${proj.avgProgress}%` });

    res.json({
      period: { days: periodDays, start: startDate.toISOString(), end: new Date().toISOString() },
      score: overallScore,
      calls: { ...cs, trend: callTrend, responseRate, prevResponseRate },
      contacts: contactStats[0],
      tasks: { ...ts, completionRate: taskCompletionRate, prevCompletionRate: prevTaskCompletionRate },
      messages: messageStats[0],
      prospects: { ...ps, winRate, prevWinRate, totalValue: Number(ps.totalValue), wonValue: Number(ps.wonValue) },
      events: eventStats[0],
      projets: proj,
      insights,
      trends: {
        callTrend,
        taskTrend: ecartTaches,
        prospectTrend: ecart(winRate, prevWinRate),
        responseTrend: ecartReponse,
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
    const days = bornerJours(req.query.days, 14);
    const jours = derniersJours(days);
    // Debut du premier jour local, avec marge d'un jour : le filtre fin se fait par date locale.
    const debut = new Date(Date.parse(`${jours[0]}T00:00:00Z`) - 86400000);
    const fin = new Date(Date.parse(`${jours[jours.length - 1]}T00:00:00Z`) + 2 * 86400000);

    // Cinq requetes groupees par jour LOCAL (il y en avait cinq PAR JOUR).
    const parJour = async (table: any, colonne: any) => {
      const expr = sql<string>`to_char(${colonne} at time zone ${FUSEAU}, 'YYYY-MM-DD')`;
      const lignes = await db.select({ d: expr, c: sql<number>`count(*)::int` }).from(table)
        .where(and(eq(table.organisationId, orgId), gte(colonne, debut), lt(colonne, fin)))
        .groupBy(sql`1`);
      return new Map(lignes.map((l: any) => [String(l.d), Number(l.c)]));
    };
    const [calls, tasks, prospects, messages, events] = await Promise.all([
      parJour(callsTable, callsTable.createdAt),
      parJour(tasksTable, tasksTable.createdAt),
      parJour(prospectsTable, prospectsTable.createdAt),
      parJour(messagesTable, messagesTable.createdAt),
      parJour(calendarEventsTable, calendarEventsTable.startDate),
    ]);
    const timeline = jours.map((date) => ({
      date,
      calls: calls.get(date) ?? 0, tasks: tasks.get(date) ?? 0, prospects: prospects.get(date) ?? 0,
      messages: messages.get(date) ?? 0, events: events.get(date) ?? 0,
    }));

    res.json({ timeline });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur timeline:");
    res.status(500).json({ error: "Erreur" });
  }
});

router.get("/smart-reports/reminders", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId;

    const now = new Date();
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const [overdueTasks, upcomingEvents, urgentProspects, missedCalls, overdueProjects] = await Promise.all([
      db.select().from(tasksTable).where(and(
        eq(tasksTable.organisationId, orgId),
        sql`${tasksTable.status} != 'termine'`,
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
        eq(callsTable.status, "manque"),
        gte(callsTable.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      )).orderBy(desc(callsTable.createdAt)).limit(5),

      db.select({
        id: projetsTable.id,
        title: projetsTable.title,
        endDate: projetsTable.endDate,
        status: projetsTable.status,
      }).from(projetsTable).where(and(
        eq(projetsTable.organisationId, orgId),
        sql`${projetsTable.endDate} < now()`,
        sql`${projetsTable.status} NOT IN ('termine', 'annule')`,
      )).orderBy(projetsTable.endDate).limit(5),
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
        description: minutesUntil <= 60 ? `Dans ${minutesUntil} minutes` : `${libelleJour(new Date(e.startDate), now)} a ${heureLocale(new Date(e.startDate))}`,
        time: e.startDate.toISOString(), actionUrl: "/calendrier",
      });
    }

    for (const p of urgentProspects) {
      reminders.push({
        id: `prospect_${p.id}`, type: "prospect", severity: "alerte",
        title: `Prospect a conclure: ${p.title}`,
        description: `Date de cloture prevue: ${p.expectedCloseDate ? new Date(p.expectedCloseDate).toLocaleDateString("fr-FR", { timeZone: FUSEAU }) : "bientot"} - Valeur: ${Number(p.value || 0).toLocaleString("fr-FR")} EUR`,
        time: p.expectedCloseDate?.toISOString() || "", actionUrl: "/prospects",
      });
    }

    for (const c of missedCalls) {
      reminders.push({
        id: `call_${c.id}`, type: "appel", severity: "alerte",
        title: `Appel manque: ${c.contactName || c.phoneNumber || "Inconnu"}`,
        description: `A ${heureLocale(new Date(c.createdAt))}`,
        time: c.createdAt.toISOString(), actionUrl: "/appels",
      });
    }

    for (const p of overdueProjects) {
      const daysLate = Math.ceil((now.getTime() - new Date(p.endDate!).getTime()) / 86400000);
      reminders.push({
        id: `projet_${p.id}`, type: "projet",
        severity: daysLate > 7 ? "critique" : "alerte",
        title: `Projet en retard: ${p.title}`,
        description: `Deadline depassee de ${daysLate} jour${daysLate > 1 ? "s" : ""}`,
        time: new Date(p.endDate!).toISOString(), actionUrl: "/projets",
      });
    }

    reminders.sort((a, b) => {
      return rangSeverite(a.severity) - rangSeverite(b.severity);
    });

    res.json({ reminders, counts: { overdue: overdueTasks.length, upcoming: upcomingEvents.length, urgentProspects: urgentProspects.length, missedCalls: missedCalls.length, overdueProjects: overdueProjects.length } });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur reminders:");
    res.status(500).json({ error: "Erreur" });
  }
});

export default router;
