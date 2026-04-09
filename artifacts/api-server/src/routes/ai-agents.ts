import { Router } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, checkinsTable, aiAgentReportsTable } from "@workspace/db";
import { sql, eq, gte, lte, and, count, desc, lt, ne, isNull, isNotNull, or } from "drizzle-orm";

const router = Router();

const AGENTS = [
  { id: "agent_appels", name: "Agent Appels", icon: "phone", domain: "Gestion des appels telephoniques" },
  { id: "agent_contacts", name: "Agent Contacts", icon: "users", domain: "Gestion des contacts et relations client" },
  { id: "agent_taches", name: "Agent Taches", icon: "clipboard", domain: "Gestion des taches et productivite" },
  { id: "agent_messages", name: "Agent Messages", icon: "mail", domain: "Gestion des messages et communications" },
  { id: "agent_pointage", name: "Agent Pointage", icon: "clock", domain: "Gestion du temps et presences" },
  { id: "agent_securite", name: "Agent Securite", icon: "shield", domain: "Securite et conformite" },
  { id: "agent_performance", name: "Agent Performance", icon: "trending-up", domain: "Performance globale et KPIs" },
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
      const [total, missed, answered, avgDuration, noContact, negativeSentiment, noNotes, longCalls, recentCalls] = await Promise.all([
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "manque"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
        db.select({ avg: sql<number>`coalesce(avg(${callsTable.duration}), 0)::int` }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo), eq(callsTable.status, "repondu"))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.contactId))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.sentiment, "negatif"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.notes), gte(callsTable.createdAt, weekAgo), eq(callsTable.status, "repondu"))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.duration, 600), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, monthAgo))),
      ]);
      return {
        totalThisWeek: total[0]?.count ?? 0, missedThisWeek: missed[0]?.count ?? 0, answeredThisWeek: answered[0]?.count ?? 0,
        avgDurationSeconds: avgDuration[0]?.avg ?? 0, callsWithoutContact: noContact[0]?.count ?? 0,
        negativeSentimentThisWeek: negativeSentiment[0]?.count ?? 0, answeredWithoutNotes: noNotes[0]?.count ?? 0,
        longCallsOver10min: longCalls[0]?.count ?? 0, totalThisMonth: recentCalls[0]?.count ?? 0,
        answerRate: total[0]?.count ? Math.round(((answered[0]?.count ?? 0) / total[0].count) * 100) : 0,
      };
    }
    case "agent_contacts": {
      const [total, noEmail, noPhone, noCompany, duplicatePhones, inactiveContacts] = await Promise.all([
        db.select({ count: count() }).from(contactsTable).where(orgContact),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.email))),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.phone))),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.company))),
        db.select({ phone: contactsTable.phone, cnt: count() }).from(contactsTable).where(and(orgContact, isNotNull(contactsTable.phone))).groupBy(contactsTable.phone).having(sql`count(*) > 1`),
        db.select({ count: count() }).from(contactsTable).where(and(orgContact, sql`${contactsTable.id} NOT IN (SELECT DISTINCT contact_id FROM calls WHERE contact_id IS NOT NULL AND organisation_id = ${orgId} AND created_at >= ${monthAgo.toISOString()})`)),
      ]);
      return {
        totalContacts: total[0]?.count ?? 0, withoutEmail: noEmail[0]?.count ?? 0, withoutPhone: noPhone[0]?.count ?? 0,
        withoutCompany: noCompany[0]?.count ?? 0, duplicatePhoneNumbers: duplicatePhones.length,
        inactiveOver30Days: inactiveContacts[0]?.count ?? 0,
        dataCompleteness: total[0]?.count ? Math.round(((total[0].count - (noEmail[0]?.count ?? 0) - (noPhone[0]?.count ?? 0)) / (total[0].count * 2)) * 100) : 0,
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
    case "agent_securite": {
      const [totalContacts, callsWithoutContact, noNotesAnswered, totalCheckins] = await Promise.all([
        db.select({ count: count() }).from(contactsTable).where(orgContact),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.contactId))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.notes), eq(callsTable.status, "repondu"))),
        db.select({ count: count() }).from(checkinsTable).where(orgCheckin),
      ]);
      return {
        contactsTotal: totalContacts[0]?.count ?? 0,
        unlinkedCalls: callsWithoutContact[0]?.count ?? 0,
        callsWithoutDocumentation: noNotesAnswered[0]?.count ?? 0,
        totalCheckinRecords: totalCheckins[0]?.count ?? 0,
        securityNotes: "Verification des acces, conformite RGPD, tracabilite des actions",
      };
    }
    case "agent_performance": {
      const [totalCalls, answeredCalls, totalTasks, completedTasks, totalContacts, totalMessages, unreadMessages, totalCheckins] = await Promise.all([
        db.select({ count: count() }).from(callsTable).where(and(orgCall, gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(callsTable).where(and(orgCall, eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
        db.select({ count: count() }).from(tasksTable).where(orgTask),
        db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "termine"))),
        db.select({ count: count() }).from(contactsTable).where(orgContact),
        db.select({ count: count() }).from(messagesTable).where(orgMsg),
        db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))),
        db.select({ count: count() }).from(checkinsTable).where(and(orgCheckin, gte(checkinsTable.checkInAt, weekAgo))),
      ]);
      return {
        callsThisWeek: totalCalls[0]?.count ?? 0, answerRate: totalCalls[0]?.count ? Math.round(((answeredCalls[0]?.count ?? 0) / totalCalls[0].count) * 100) : 0,
        totalTasks: totalTasks[0]?.count ?? 0, taskCompletionRate: totalTasks[0]?.count ? Math.round(((completedTasks[0]?.count ?? 0) / totalTasks[0].count) * 100) : 0,
        totalContacts: totalContacts[0]?.count ?? 0, totalMessages: totalMessages[0]?.count ?? 0,
        unreadMessages: unreadMessages[0]?.count ?? 0, checkinsThisWeek: totalCheckins[0]?.count ?? 0,
      };
    }
    default:
      return {};
  }
}

function getAgentPrompt(agent: typeof AGENTS[0]) {
  const prompts: Record<string, string> = {
    agent_appels: `Tu es un agent IA expert en analyse des appels telephoniques d'un bureau professionnel en France.
Ton role: verifier les erreurs dans les donnees d'appels, identifier les problemes (appels manques non rappeles, sentiment negatif non traite, appels sans notes, contacts non lies) et proposer des actions concretes.
Sois precis avec les chiffres. Identifie les erreurs critiques et les ameliorations possibles.`,
    agent_contacts: `Tu es un agent IA expert en gestion de la base de contacts d'un bureau professionnel en France.
Ton role: verifier la qualite des donnees contacts (doublons, champs manquants), identifier les contacts inactifs, detecter les anomalies et proposer des actions d'enrichissement et de nettoyage.
Sois precis avec les chiffres. Identifie les erreurs de donnees et les ameliorations possibles.`,
    agent_taches: `Tu es un agent IA expert en gestion des taches et productivite d'un bureau professionnel en France.
Ton role: verifier les taches en retard, identifier les blocages, analyser la repartition de charge, detecter les taches non assignees et proposer des priorites et reorganisations.
Sois precis avec les chiffres. Identifie les problemes de productivite et les ameliorations possibles.`,
    agent_messages: `Tu es un agent IA expert en gestion des messages et communications d'un bureau professionnel en France.
Ton role: verifier les messages non lus (surtout urgents), identifier les retards de traitement, detecter les accumulations et proposer une strategie de traitement.
Sois precis avec les chiffres. Identifie les problemes de communication et les ameliorations possibles.`,
    agent_pointage: `Tu es un agent IA expert en gestion du temps et des presences d'un bureau professionnel en France.
Ton role: analyser les horaires, detecter les retards frequents, verifier l'equilibre bureau/distance/terrain, identifier les durees anormales et proposer des optimisations d'organisation.
Sois precis avec les chiffres. Identifie les problemes de ponctualite et les ameliorations possibles.`,
    agent_securite: `Tu es un agent IA expert en securite et conformite d'un bureau professionnel en France.
Ton role: verifier la tracabilite des actions (appels sans documentation, contacts non lies), evaluer la conformite RGPD, identifier les failles de securite potentielles et proposer des corrections.
Sois precis avec les chiffres. Identifie les risques de securite et les corrections necessaires.`,
    agent_performance: `Tu es un agent IA expert en analyse de performance globale d'un bureau professionnel en France.
Ton role: evaluer les KPIs globaux (taux de reponse, taux de completion, activite), identifier les tendances, comparer avec les objectifs et proposer des actions strategiques d'amelioration.
Sois precis avec les chiffres. Identifie les points forts et les axes d'amelioration.`,
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
            text: `Tu es le Super Agent IA, le directeur strategique d'un bureau professionnel en France. Tu recois les rapports de 7 agents IA specialises.

Ton role:
1. ANALYSER tous les rapports et identifier les problemes transversaux
2. PRIORISER les actions les plus critiques a travers tous les domaines
3. CORRIGER les incoherences entre les rapports des agents
4. AJOUTER des recommandations strategiques que les agents individuels ne peuvent pas voir
5. NOTER la performance globale du bureau

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
      .limit(7);

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
  if (autoRunInterval) {
    res.json({ message: "L'execution automatique est deja active", status: "active" });
    return;
  }

  autoRunInterval = setInterval(async () => {
    console.log("[AI Agents] Execution automatique demarree:", new Date().toISOString());
    try {
      const childReports = [];
      for (const agent of AGENTS) {
        const report = await runSingleAgent(agent);
        childReports.push(report);
      }
      await runSuperAgent(childReports);
      console.log("[AI Agents] Execution automatique terminee:", new Date().toISOString());
    } catch (error) {
      console.error("[AI Agents] Erreur execution automatique:", error);
    }
  }, 2 * 60 * 60 * 1000);

  const childReports = [];
  for (const agent of AGENTS) {
    const report = await runSingleAgent(agent);
    childReports.push(report);
  }
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

    const [contactsNoEmail, contactsNoPhone, duplicatePhones, callsNoContact, callsNoNotes, tasksOverdue, tasksStuck, unreadMessages] = await Promise.all([
      db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.email))),
      db.select({ count: count() }).from(contactsTable).where(and(orgContact, isNull(contactsTable.phone))),
      db.select({ phone: contactsTable.phone, cnt: count() }).from(contactsTable).where(and(orgContact, isNotNull(contactsTable.phone))).groupBy(contactsTable.phone).having(sql`count(*) > 1`),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.contactId), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(callsTable).where(and(orgCall, isNull(callsTable.notes), eq(callsTable.status, "repondu"), gte(callsTable.createdAt, weekAgo))),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, ne(tasksTable.status, "termine"), ne(tasksTable.status, "annule"), sql`${tasksTable.dueDate} < NOW()`)),
      db.select({ count: count() }).from(tasksTable).where(and(orgTask, eq(tasksTable.status, "en_cours"), sql`${tasksTable.updatedAt} < NOW() - INTERVAL '7 days'`)),
      db.select({ count: count() }).from(messagesTable).where(and(orgMsg, eq(messagesTable.isRead, false))),
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
            await db.update(tasksTable).set({ notes: sql`COALESCE(${tasksTable.notes}, '') || E'\n[Oto-Pilot] Tache bloquee detectee - necessite attention'` }).where(eq(tasksTable.id, task.id));
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
