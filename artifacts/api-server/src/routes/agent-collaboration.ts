import { Router, type Request, type Response } from "express";
import { db, aiAgentReportsTable, notificationsTable, tasksTable, callsTable, contactsTable, messagesTable, calendarEventsTable, facturesClientTable } from "@workspace/db";
import { eq, desc, and, gte, ne, lt, isNull, sql, or } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { getOrgId } from "../middleware/tenant";
import { logger } from "../lib/logger";

const router = Router();
const requireMinAgent = requireRole("super_admin", "administrateur", "agent");

const AGENT_RELATIONS: Record<string, string[]> = {
  agent_appels: ["agent_contacts", "agent_taches", "agent_facturation", "agent_messages"],
  agent_contacts: ["agent_appels", "agent_taches", "agent_facturation"],
  agent_taches: ["agent_appels", "agent_contacts", "agent_pointage", "agent_performance"],
  agent_messages: ["agent_appels", "agent_contacts", "agent_taches"],
  agent_pointage: ["agent_taches", "agent_rh", "agent_performance"],
  agent_facturation: ["agent_contacts", "agent_appels", "agent_taches"],
  agent_stock: ["agent_facturation", "agent_taches"],
  agent_rh: ["agent_pointage", "agent_securite", "agent_performance"],
  agent_securite: ["agent_rh", "agent_performance"],
  agent_performance: ["agent_appels", "agent_taches", "agent_facturation", "agent_pointage"],
};

export async function getLatestAgentInsights(orgId: number, agentIds?: string[]): Promise<Record<string, any>> {
  const insights: Record<string, any> = {};
  const targetIds = agentIds || Object.keys(AGENT_RELATIONS);

  for (const agentId of targetIds) {
    const conditions: any[] = [eq(aiAgentReportsTable.agentId, agentId)];
    conditions.push(or(eq(aiAgentReportsTable.organisationId, orgId), isNull(aiAgentReportsTable.organisationId)));
    const [latest] = await db.select().from(aiAgentReportsTable)
      .where(and(...conditions))
      .orderBy(desc(aiAgentReportsTable.createdAt))
      .limit(1);

    if (latest) {
      insights[agentId] = {
        score: latest.score,
        summary: latest.summary,
        status: latest.status,
        reportDate: latest.reportDate,
        errorsFound: latest.errorsFound,
        warningsFound: latest.warningsFound,
        errors: (latest.errors as any[])?.slice(0, 3) || [],
        warnings: (latest.warnings as any[])?.slice(0, 3) || [],
        corrections: (latest.corrections as any[])?.slice(0, 3) || [],
        kpis: ((latest.details as any)?.kpis || []).slice(0, 5),
        predictions: ((latest.details as any)?.predictions || []).slice(0, 3),
      };
    }
  }
  return insights;
}

export async function getContextForContact(orgId: number, contactId?: number, phone?: string, email?: string): Promise<any> {
  const context: any = { agentInsights: {} };

  let contact: any = null;
  if (contactId) {
    const [c] = await db.select().from(contactsTable).where(and(eq(contactsTable.id, contactId), eq(contactsTable.organisationId, orgId)));
    contact = c;
  } else if (phone) {
    const cleanPhone = phone.replace(/\s/g, "");
    const [c] = await db.select().from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), sql`replace(${contactsTable.phone}, ' ', '') = ${cleanPhone}`));
    contact = c;
  } else if (email) {
    const [c] = await db.select().from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), eq(contactsTable.email, email)));
    contact = c;
  }

  if (contact) {
    context.contact = contact;

    const now = new Date();
    const [openTasks, recentCalls, unreadMsgs, overdueInvoices, upcomingEvents] = await Promise.all([
      db.select().from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.relatedContactId, contact.id), ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"))).limit(5),
      db.select().from(callsTable).where(and(eq(callsTable.organisationId, orgId), eq(callsTable.contactId, contact.id))).orderBy(desc(callsTable.createdAt)).limit(5),
      db.select().from(messagesTable).where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.contactId, contact.id), eq(messagesTable.isRead, false))).limit(5),
      db.select().from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), sql`${facturesClientTable.clientEmail} = ${contact.email}`, ne(facturesClientTable.status, "payee"), lt(facturesClientTable.dueDate, now))).limit(5).catch(() => []),
      db.select().from(calendarEventsTable).where(and(eq(calendarEventsTable.organisationId, orgId), eq(calendarEventsTable.relatedContactId, contact.id), gte(calendarEventsTable.startDate, now))).orderBy(calendarEventsTable.startDate).limit(3).catch(() => []),
    ]);

    context.contactActivity = {
      openTasks: openTasks.map(t => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, dueDate: t.dueDate })),
      recentCalls: recentCalls.map(c => ({ id: c.id, date: c.createdAt, status: c.status, sentiment: c.sentiment, notes: c.notes?.slice(0, 100) })),
      unreadMessages: unreadMsgs.length,
      overdueInvoices: overdueInvoices.map((i: any) => ({ id: i.id, reference: i.reference, amount: Number(i.totalAmount) - Number(i.paidAmount), dueDate: i.dueDate })),
      upcomingEvents: upcomingEvents.map(e => ({ id: e.id, title: e.title, date: e.startDate })),
    };
  }

  const relevantAgents = ["agent_appels", "agent_contacts", "agent_taches", "agent_facturation"];
  const agentInsights = await getLatestAgentInsights(orgId, relevantAgents);

  const alerts: string[] = [];
  for (const [agentId, insight] of Object.entries(agentInsights)) {
    if (insight.score < 50) {
      alerts.push(`[${insight.summary?.slice(0, 80)}]`);
    }
    for (const err of (insight.errors || [])) {
      if (err.severity === "critique") {
        alerts.push(`⚠ ${err.titre}: ${err.description?.slice(0, 60)}`);
      }
    }
  }

  context.agentInsights = agentInsights;
  context.criticalAlerts = alerts;

  return context;
}

export function buildCollaborationPrompt(agentInsights: Record<string, any>, currentAgent: string): string {
  const relatedAgents = AGENT_RELATIONS[currentAgent] || [];
  const lines: string[] = [];

  for (const agentId of relatedAgents) {
    const insight = agentInsights[agentId];
    if (!insight) continue;
    lines.push(`--- ${agentId} (score: ${insight.score}/100, date: ${insight.reportDate}) ---`);
    lines.push(`Resume: ${insight.summary?.slice(0, 200)}`);
    if (insight.errors?.length > 0) {
      lines.push(`Erreurs critiques: ${insight.errors.map((e: any) => e.titre).join(", ")}`);
    }
    if (insight.warnings?.length > 0) {
      lines.push(`Alertes: ${insight.warnings.map((w: any) => w.titre).join(", ")}`);
    }
    if (insight.predictions?.length > 0) {
      lines.push(`Predictions: ${insight.predictions.map((p: any) => p.scenario?.slice(0, 60)).join("; ")}`);
    }
    lines.push("");
  }

  if (lines.length === 0) return "";

  return `\n\n=== INTELLIGENCE INTER-AGENTS ===
Tu as acces aux rapports recents des agents lies a ton domaine. Utilise ces informations pour ENRICHIR ton analyse avec des correlations inter-services.
IMPORTANT: Identifie les liens entre tes observations et celles des autres agents. Signale les effets en cascade.

${lines.join("\n")}
=== FIN INTELLIGENCE INTER-AGENTS ===`;
}

export function buildCommandantContextPrompt(agentInsights: Record<string, any>, contactContext?: any): string {
  const lines: string[] = [];

  lines.push("=== CONTEXTE INTELLIGENCE COLLABORATIVE ===");
  lines.push("Les agents IA specialises ont fourni les informations suivantes:");

  for (const [agentId, insight] of Object.entries(agentInsights)) {
    if (!insight) continue;
    const label = {
      agent_appels: "Telephonie",
      agent_contacts: "CRM",
      agent_taches: "Productivite",
      agent_facturation: "Finance",
      agent_messages: "Communication",
      agent_pointage: "Presences",
      agent_stock: "Stock",
      agent_rh: "RH",
      agent_securite: "Securite",
      agent_performance: "Performance",
    }[agentId] || agentId;

    lines.push(`[${label}] Score: ${insight.score}/100 | ${insight.summary?.slice(0, 120)}`);
    for (const err of (insight.errors || []).filter((e: any) => e.severity === "critique")) {
      lines.push(`  ⚠ CRITIQUE: ${err.titre}`);
    }
  }

  if (contactContext?.contactActivity) {
    const act = contactContext.contactActivity;
    lines.push("");
    lines.push("=== CONTEXTE CONTACT ===");
    if (act.openTasks.length > 0) {
      lines.push(`Taches ouvertes: ${act.openTasks.map((t: any) => `${t.title} [${t.priority}]`).join(", ")}`);
    }
    if (act.overdueInvoices.length > 0) {
      lines.push(`⚠ FACTURES IMPAYEES: ${act.overdueInvoices.map((i: any) => `${i.reference} (${i.amount}€)`).join(", ")}`);
    }
    if (act.unreadMessages > 0) {
      lines.push(`Messages non lus: ${act.unreadMessages}`);
    }
    if (act.upcomingEvents.length > 0) {
      lines.push(`Prochains RDV: ${act.upcomingEvents.map((e: any) => e.title).join(", ")}`);
    }
  }

  lines.push("=== FIN CONTEXTE ===");
  lines.push("Utilise ces informations pour fournir une reponse CONTEXTUALISEE et ENRICHIE. Mentionne les alertes pertinentes.");

  return lines.join("\n");
}

export async function createCrossAgentAlert(orgId: number, fromAgent: string, toAgent: string, title: string, message: string, severity: "critique" | "haute" | "moyenne" = "haute") {
  try {
    await db.insert(notificationsTable).values({
      organisationId: orgId,
      userId: 0,
      type: "agent_collab",
      title: `[${fromAgent} → ${toAgent}] ${title}`,
      message: `${message} [from:${fromAgent}|to:${toAgent}|severity:${severity}]`,
      priority: severity === "critique" ? "haute" : "normale",
      sourceType: "cross_agent_alert",
      sourceId: `${fromAgent}_${toAgent}`,
    });
  } catch (err: any) {
    logger.error({ err, fromAgent, toAgent }, "Cross-agent alert failed");
  }
}

export async function detectCrossAgentIssues(orgId: number): Promise<any[]> {
  const insights = await getLatestAgentInsights(orgId);
  const issues: any[] = [];

  const appels = insights.agent_appels;
  const taches = insights.agent_taches;
  const facturation = insights.agent_facturation;
  const contacts = insights.agent_contacts;
  const messages = insights.agent_messages;
  const pointage = insights.agent_pointage;

  if (appels && taches) {
    if (appels.score < 60 && taches.score < 60) {
      issues.push({
        type: "cascade",
        agents: ["agent_appels", "agent_taches"],
        title: "Surcharge detectee: appels + taches en difficulte",
        description: `Telephonie (${appels.score}/100) et productivite (${taches.score}/100) sont simultanement faibles. Risque de degradation du service client.`,
        severity: "critique",
        recommendation: "Renforcer l'equipe temporairement ou prioriser les taches critiques liees aux appels.",
      });
    }
  }

  if (facturation && appels) {
    if (facturation.errorsFound > 0 && appels.errorsFound > 0) {
      issues.push({
        type: "correlation",
        agents: ["agent_facturation", "agent_appels"],
        title: "Factures impayees + appels negatifs",
        description: `${facturation.errorsFound} problemes de facturation detectes. Les clients mecontents pourraient appeler — preparer des reponses.`,
        severity: "haute",
        recommendation: "Preparer les agents telephoniques avec le contexte des factures impayees avant les appels entrants.",
      });
    }
  }

  if (contacts && messages) {
    if (contacts.score < 60 && messages.errorsFound > 0) {
      issues.push({
        type: "correlation",
        agents: ["agent_contacts", "agent_messages"],
        title: "Base CRM incomplete + messages non traites",
        description: `La base de contacts est degradee (${contacts.score}/100) et des messages s'accumulent — risque de perte d'information.`,
        severity: "haute",
        recommendation: "Prioriser l'enrichissement des fiches contacts et le traitement des messages en retard.",
      });
    }
  }

  if (pointage && taches) {
    if (pointage.score < 50 && taches.score < 50) {
      issues.push({
        type: "cascade",
        agents: ["agent_pointage", "agent_taches"],
        title: "Absenteisme + retard de taches",
        description: `Presences faibles (${pointage.score}/100) correlees avec des retards de taches (${taches.score}/100) — indicateur de sous-effectif ou desengagement.`,
        severity: "critique",
        recommendation: "Verifier les plannings et redistribuer les taches urgentes.",
      });
    }
  }

  if (appels && contacts && facturation) {
    const criticalCount = [appels, contacts, facturation].filter(a => a && a.score < 50).length;
    if (criticalCount >= 2) {
      issues.push({
        type: "systemic",
        agents: ["agent_appels", "agent_contacts", "agent_facturation"],
        title: "Alerte systemique: plusieurs services en difficulte",
        description: `${criticalCount} services critiques en dessous de 50/100. Le bureau necessite une intervention immediate.`,
        severity: "critique",
        recommendation: "Reunion d'urgence recommandee. Activer le mode commando sur les services critiques.",
      });
    }
  }

  return issues;
}

router.get("/ai/collaboration/matrix", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const insights = await getLatestAgentInsights(orgId);
    const crossIssues = await detectCrossAgentIssues(orgId);

    const matrix = Object.entries(AGENT_RELATIONS).map(([agent, related]) => ({
      agent,
      relatedAgents: related,
      currentScore: insights[agent]?.score ?? null,
      status: insights[agent]?.status ?? "inconnu",
      lastReport: insights[agent]?.reportDate ?? null,
      activeAlerts: (insights[agent]?.errors || []).filter((e: any) => e.severity === "critique").length,
    }));

    const superAgent = insights["super_agent"];
    const [superReport] = await db.select().from(aiAgentReportsTable)
      .where(and(eq(aiAgentReportsTable.agentId, "super_agent"), or(eq(aiAgentReportsTable.organisationId, orgId), isNull(aiAgentReportsTable.organisationId))))
      .orderBy(desc(aiAgentReportsTable.createdAt))
      .limit(1);

    res.json({
      matrix,
      crossIssues,
      superAgentSummary: superReport ? { score: superReport.score, summary: superReport.summary, date: superReport.reportDate, crossAnalysis: (superReport.details as any)?.crossAnalysis || [] } : null,
      collaborationHealth: {
        totalAgents: matrix.length,
        activeAgents: matrix.filter(m => m.currentScore !== null).length,
        criticalAgents: matrix.filter(m => m.currentScore !== null && m.currentScore < 50).length,
        avgScore: matrix.filter(m => m.currentScore !== null).length > 0
          ? Math.round(matrix.filter(m => m.currentScore !== null).reduce((s, m) => s + (m.currentScore || 0), 0) / matrix.filter(m => m.currentScore !== null).length)
          : 0,
        crossIssueCount: crossIssues.length,
        criticalIssueCount: crossIssues.filter(i => i.severity === "critique").length,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Collaboration matrix error");
    res.status(500).json({ error: "Erreur" });
  }
});

router.get("/ai/collaboration/contact-context/:contactId", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const contactId = parseInt(String(req.params.contactId));
    if (isNaN(contactId)) { res.status(400).json({ error: "ID invalide" }); return; }

    const context = await getContextForContact(orgId, contactId);
    res.json(context);
  } catch (err: any) {
    logger.error({ err }, "Contact context error");
    res.status(500).json({ error: "Erreur" });
  }
});

router.get("/ai/collaboration/insights", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const insights = await getLatestAgentInsights(orgId);
    const crossIssues = await detectCrossAgentIssues(orgId);

    const allCriticalErrors: any[] = [];
    const allPredictions: any[] = [];
    for (const [agentId, insight] of Object.entries(insights)) {
      for (const err of (insight.errors || [])) {
        allCriticalErrors.push({ ...err, agentSource: agentId });
      }
      for (const pred of (insight.predictions || [])) {
        allPredictions.push({ ...pred, agentSource: agentId });
      }
    }

    res.json({
      agentInsights: insights,
      crossIssues,
      criticalErrors: allCriticalErrors.filter(e => e.severity === "critique"),
      predictions: allPredictions,
      lastUpdated: Object.values(insights).reduce((latest, i) => {
        const d = i.reportDate;
        return d && d > (latest || "") ? d : latest;
      }, null as string | null),
    });
  } catch (err: any) {
    logger.error({ err }, "Collaboration insights error");
    res.status(500).json({ error: "Erreur" });
  }
});

export default router;
