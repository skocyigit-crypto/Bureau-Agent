/**
 * daily-digest.ts — Günlük Bilan & Kişisel AI Öneriler
 *
 * GET /api/daily-digest
 *   → Kullanıcının bugünkü tüm faaliyetlerini derler
 *   → Gemini AI ile kişiselleştirilmiş özet + öneriler üretir
 */

import { Router } from "express";
import {
  db,
  callsTable,
  tasksTable,
  calendarEventsTable,
  notesInternesTable,
  auditLogsTable,
  messagesTable,
} from "@workspace/db";
import { eq, and, gte, lte, count, sql, desc, or } from "drizzle-orm";
import { assertAiQuota, AiQuotaExceededError, invalidateQuotaCache } from "../services/ai-quota";
import { buildLearnedContextBlock } from "../services/ai-learning";
import { extractGeminiTokens, recordAiUsage } from "../services/ai-utils";
import { buildAiCacheKey, getCached, setCached, AI_CACHE_TTL } from "../services/ai-cache";
import { logger } from "../lib/logger";

const router = Router();

// ── Tarih yardımcıları ────────────────────────────────────────────────────────

function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfTomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfNextWeek(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ── Gemini AI çağrısı ─────────────────────────────────────────────────────────

async function aiGenerate(orgId: number, prompt: string): Promise<string> {
  await assertAiQuota(orgId);
  const t0 = Date.now();
  const { ai } = await import("@workspace/integrations-gemini-ai");
  const model = "gemini-2.0-flash";
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  const text = response.text ?? "{}";
  const tokens = extractGeminiTokens(response);
  recordAiUsage({
    organisationId: orgId, provider: "gemini", model, route: "/daily-digest",
    inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0,
  }).catch(() => {});
  invalidateQuotaCache(orgId);
  return text;
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    return JSON.parse(match ? match[1] : raw);
  } catch {
    return fallback;
  }
}

// ── Veri toplama ──────────────────────────────────────────────────────────────

async function gatherDailyData(userId: number, orgId: number) {
  const todayStart = startOfDay();
  const todayEnd = endOfDay();
  const now = new Date();

  const [
    callsCreatedToday,
    callsAnsweredToday,
    callsMissedToday,
    tasksCreatedToday,
    tasksCompletedToday,
    overdueTasksResult,
    notesCreatedToday,
    eventsToday,
    upcomingEvents,
    messagesSentToday,
    auditActionsToday,
    recentCompletedTasks,
    recentCalls,
    upcomingTasks,
  ] = await Promise.all([
    // Çağrılar
    db.select({ count: count() }).from(callsTable).where(and(
      eq(callsTable.organisationId, orgId),
      eq(callsTable.createdBy, userId),
      gte(callsTable.createdAt, todayStart),
      lte(callsTable.createdAt, todayEnd)
    )),
    db.select({ count: count() }).from(callsTable).where(and(
      eq(callsTable.organisationId, orgId),
      eq(callsTable.createdBy, userId),
      eq(callsTable.status, "repondu"),
      gte(callsTable.createdAt, todayStart),
      lte(callsTable.createdAt, todayEnd)
    )),
    db.select({ count: count() }).from(callsTable).where(and(
      eq(callsTable.organisationId, orgId),
      eq(callsTable.createdBy, userId),
      eq(callsTable.status, "manque"),
      gte(callsTable.createdAt, todayStart),
      lte(callsTable.createdAt, todayEnd)
    )),
    // Görevler
    db.select({ count: count() }).from(tasksTable).where(and(
      eq(tasksTable.organisationId, orgId),
      eq(tasksTable.createdBy, userId),
      gte(tasksTable.createdAt, todayStart),
      lte(tasksTable.createdAt, todayEnd)
    )),
    db.select({ count: count() }).from(tasksTable).where(and(
      eq(tasksTable.organisationId, orgId),
      eq(tasksTable.createdBy, userId),
      eq(tasksTable.status, "terminee"),
      gte(tasksTable.updatedAt, todayStart),
      lte(tasksTable.updatedAt, todayEnd)
    )),
    db.select({ count: count() }).from(tasksTable).where(and(
      eq(tasksTable.organisationId, orgId),
      eq(tasksTable.createdBy, userId),
      sql`${tasksTable.dueDate} < ${now.toISOString()}`,
      or(eq(tasksTable.status, "en_attente"), eq(tasksTable.status, "en_cours"))
    )),
    // Notlar
    db.select({ count: count() }).from(notesInternesTable).where(and(
      eq(notesInternesTable.organisationId, orgId),
      eq(notesInternesTable.userId, userId),
      gte(notesInternesTable.createdAt, todayStart),
      lte(notesInternesTable.createdAt, todayEnd)
    )),
    // Takvim
    db.select({ count: count() }).from(calendarEventsTable).where(and(
      eq(calendarEventsTable.organisationId, orgId),
      gte(calendarEventsTable.startDate, todayStart),
      lte(calendarEventsTable.startDate, todayEnd)
    )),
    db.select({
      id: calendarEventsTable.id,
      title: calendarEventsTable.title,
      startDate: calendarEventsTable.startDate,
    }).from(calendarEventsTable).where(and(
      eq(calendarEventsTable.organisationId, orgId),
      gte(calendarEventsTable.startDate, startOfTomorrow()),
      lte(calendarEventsTable.startDate, endOfNextWeek())
    )).orderBy(calendarEventsTable.startDate).limit(5),
    // Mesajlar
    db.select({ count: count() }).from(messagesTable).where(and(
      eq(messagesTable.organisationId, orgId),
      gte(messagesTable.createdAt, todayStart),
      lte(messagesTable.createdAt, todayEnd)
    )),
    // Audit
    db.select({ count: count() }).from(auditLogsTable).where(and(
      eq(auditLogsTable.userId, userId),
      gte(auditLogsTable.createdAt, todayStart),
      lte(auditLogsTable.createdAt, todayEnd)
    )),
    // Son tamamlanan görevler
    db.select({ title: tasksTable.title, updatedAt: tasksTable.updatedAt })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organisationId, orgId),
        eq(tasksTable.createdBy, userId),
        eq(tasksTable.status, "terminee"),
        gte(tasksTable.updatedAt, todayStart)
      ))
      .orderBy(desc(tasksTable.updatedAt))
      .limit(5),
    // Son çağrılar
    db.select({ contact: callsTable.contactName, direction: callsTable.direction, status: callsTable.status, duration: callsTable.duration })
      .from(callsTable)
      .where(and(
        eq(callsTable.organisationId, orgId),
        eq(callsTable.createdBy, userId),
        gte(callsTable.createdAt, todayStart)
      ))
      .orderBy(desc(callsTable.createdAt))
      .limit(8),
    // Yaklaşan görevler
    db.select({ title: tasksTable.title, dueDate: tasksTable.dueDate, priority: tasksTable.priority })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organisationId, orgId),
        eq(tasksTable.createdBy, userId),
        or(eq(tasksTable.status, "en_attente"), eq(tasksTable.status, "en_cours")),
        sql`${tasksTable.dueDate} >= ${startOfTomorrow().toISOString()}`,
        sql`${tasksTable.dueDate} <= ${endOfNextWeek().toISOString()}`
      ))
      .orderBy(tasksTable.dueDate)
      .limit(5),
  ]);

  return {
    calls: {
      total: callsCreatedToday[0]?.count ?? 0,
      answered: callsAnsweredToday[0]?.count ?? 0,
      missed: callsMissedToday[0]?.count ?? 0,
      recent: recentCalls,
    },
    tasks: {
      created: tasksCreatedToday[0]?.count ?? 0,
      completed: tasksCompletedToday[0]?.count ?? 0,
      overdue: overdueTasksResult[0]?.count ?? 0,
      recentCompleted: recentCompletedTasks,
      upcoming: upcomingTasks,
    },
    notes: notesCreatedToday[0]?.count ?? 0,
    events: {
      today: eventsToday[0]?.count ?? 0,
      upcoming: upcomingEvents,
    },
    messages: messagesSentToday[0]?.count ?? 0,
    actions: auditActionsToday[0]?.count ?? 0,
  };
}

// ── Endpoint ──────────────────────────────────────────────────────────────────

router.get("/daily-digest", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  const orgId = req.session?.organisationId as number | undefined;
  const prenom: string = req.session?.prenom ?? "Utilisateur";

  if (!userId || !orgId) {
    res.status(401).json({ error: "Non authentifie." });
    return;
  }

  let data: Awaited<ReturnType<typeof gatherDailyData>>;
  try {
    data = await gatherDailyData(userId, orgId);
  } catch (err) {
    req.log?.error({ err }, "[daily-digest] data gather failed");
    res.status(500).json({ error: "Erreur lors de la collecte des donnees." });
    return;
  }

  const today = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const prompt = `Tu es un assistant de bureau IA qui analyse la journee de travail d'un employe.
Aujourd'hui c'est ${today}.
Voici les statistiques de la journee de ${prenom} :

APPELS:
- Total: ${data.calls.total}, Repondus: ${data.calls.answered}, Manques: ${data.calls.missed}
${data.calls.recent.length > 0 ? `- Derniers appels: ${data.calls.recent.map(c => `${c.contact ?? "Inconnu"} (${c.direction}, ${c.status}${c.duration ? ", " + Math.round(c.duration / 60) + "min" : ""})`).join("; ")}` : ""}

TACHES:
- Creees: ${data.tasks.created}, Terminees: ${data.tasks.completed}, En retard: ${data.tasks.overdue}
${data.tasks.recentCompleted.length > 0 ? `- Completes: ${data.tasks.recentCompleted.map(t => t.title).join(", ")}` : ""}
${data.tasks.upcoming.length > 0 ? `- A venir: ${data.tasks.upcoming.map(t => `${t.title} (${t.dueDate ? new Date(t.dueDate).toLocaleDateString("fr-FR") : "?"})`).join("; ")}` : ""}

NOTES: ${data.notes} | EVENEMENTS: ${data.events.today} | MESSAGES: ${data.messages} | ACTIONS: ${data.actions}
${data.events.upcoming.length > 0 ? `Prochains RDV: ${data.events.upcoming.map(e => `${e.title} le ${new Date(e.startDate).toLocaleDateString("fr-FR")}`).join("; ")}` : ""}

Genere un bilan personnalise en JSON (sans markdown, juste JSON brut):
{
  "resume": "Paragraphe court et chaleureux (2-3 phrases) resumant la journee de ${prenom}. Bienveillant et motivant.",
  "humeur": "positif" | "neutre" | "attention",
  "score": <entier 0-100 representant la productivite>,
  "points_forts": ["point 1", "point 2"],
  "suggestions": [
    {
      "type": "action" | "alerte" | "conseil" | "felicitation",
      "texte": "Suggestion claire et actionnable en francais",
      "priorite": "haute" | "moyenne" | "basse"
    }
  ],
  "demain": {
    "message": "Message d'encouragement pour demain (1 phrase).",
    "priorites": ["priorite 1", "priorite 2", "priorite 3"]
  }
}
Regles: 3-5 suggestions max, toutes en francais. Alertes si appels manques ou taches en retard.`;

  let aiResult: {
    resume: string;
    humeur: string;
    score: number;
    points_forts: string[];
    suggestions: { type: string; texte: string; priorite: string }[];
    demain: { message: string; priorites: string[] };
  } | null = null;

  const digestKey = buildAiCacheKey({
    route: "/daily-digest",
    organisationId: orgId,
    userId,
    input: {
      date: today,
      callsTotal: data.calls.total,
      tasksCreated: data.tasks.created,
      tasksCompleted: data.tasks.completed,
      tasksOverdue: data.tasks.overdue,
      events: data.events.today,
      messages: data.messages,
    },
  });
  const digestCached = getCached<typeof aiResult>(digestKey);
  if (digestCached) {
    aiResult = digestCached;
  } else {
    try {
      const raw = await aiGenerate(orgId, (await buildLearnedContextBlock(orgId)) + prompt);
      aiResult = safeJson(raw, null);
      if (aiResult) setCached(digestKey, aiResult, AI_CACHE_TTL.LONG);
    } catch (err) {
      if (err instanceof AiQuotaExceededError) {
        logger.warn({ orgId }, "[daily-digest] AI quota exceeded");
      } else {
        logger.error({ err }, "[daily-digest] AI generation failed");
      }
    }
  }

  res.json({
    date: today,
    prenom,
    stats: data,
    ai: aiResult,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
