/**
 * workforce-intelligence.ts — Tüm Çalışan Takip & AI Ekip Analizi
 *
 * GET /api/workforce-intelligence
 *   → Org'daki tüm çalışanların son 7 günlük verisini toplar
 *   → Gemini AI ile ekip sağlığı, performans profilleri ve öneri üretir
 *   → Sadece administrateur / super_admin erişebilir
 *
 * GET /api/workforce-intelligence/employees
 *   → AI olmadan sadece ham çalışan istatistiklerini döndürür (daha hızlı)
 */

import { Router } from "express";
import {
  db,
  usersTable,
  callsTable,
  tasksTable,
  notesInternesTable,
  auditLogsTable,
} from "@workspace/db";
import {
  eq,
  and,
  gte,
  count,
  sql,
  or,
  desc,
  inArray,
} from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { assertAiQuota, AiQuotaExceededError, invalidateQuotaCache } from "../services/ai-quota";
import { extractGeminiTokens, recordAiUsage, geminiActualModel, GEMINI_PRO_MODEL } from "../services/ai-utils";
import { logger } from "../lib/logger";

const router = Router();

// ── Zaman yardımcıları ────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── AI çağrısı ────────────────────────────────────────────────────────────────

async function runGemini(orgId: number, prompt: string): Promise<string> {
  await assertAiQuota(orgId);
  const t0 = Date.now();
  const { ai } = await import("@workspace/integrations-gemini-ai");
  const model = GEMINI_PRO_MODEL;
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  const text = response.text ?? "{}";
  const tokens = extractGeminiTokens(response);
  recordAiUsage({
    organisationId: orgId,
    provider: "gemini",
    model: geminiActualModel(response, model),
    route: "/workforce-intelligence",
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    durationMs: Date.now() - t0,
  }).catch(() => {});
  invalidateQuotaCache(orgId);
  return text;
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

// ── Veri toplama ──────────────────────────────────────────────────────────────

interface EmployeeStats {
  id: number;
  nom: string;
  prenom: string;
  email: string;
  role: string;
  departement: string | null;
  dernierAcces: Date | null;
  // 7 günlük
  calls7d: number;
  callsAnswered7d: number;
  callsMissed7d: number;
  tasksCreated7d: number;
  tasksCompleted7d: number;
  tasksOverdue: number;
  notes7d: number;
  actions7d: number;
  // Bugün
  callsToday: number;
  tasksCompletedToday: number;
  notesToday: number;
}

async function gatherEmployeeStats(orgId: number): Promise<EmployeeStats[]> {
  const since7d = daysAgo(7);
  const todayStart = startOfToday();
  const now = new Date();

  // 1. Org'daki tüm aktif kullanıcılar
  const users = await db
    .select({
      id: usersTable.id,
      nom: usersTable.nom,
      prenom: usersTable.prenom,
      email: usersTable.email,
      role: usersTable.role,
      departement: usersTable.departement,
      dernierAcces: usersTable.dernierAcces,
    })
    .from(usersTable)
    .where(and(eq(usersTable.organisationId, orgId), eq(usersTable.actif, true)));

  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);

  // 2. Aggregate queries — tüm kullanıcılar için tek sorguda
  const [
    callStats7d,
    callStatsToday,
    taskCreated7d,
    taskCompleted7d,
    taskCompletedToday,
    taskOverdue,
    noteStats7d,
    noteStatsToday,
    auditStats7d,
  ] = await Promise.all([
    // Çağrı istatistikleri (7 gün)
    db
      .select({
        userId: callsTable.createdBy,
        total: count(),
        answered: sql<number>`sum(case when ${callsTable.status} = 'repondu' then 1 else 0 end)`,
        missed: sql<number>`sum(case when ${callsTable.status} = 'manque' then 1 else 0 end)`,
      })
      .from(callsTable)
      .where(and(
        eq(callsTable.organisationId, orgId),
        inArray(callsTable.createdBy, userIds),
        gte(callsTable.createdAt, since7d)
      ))
      .groupBy(callsTable.createdBy),

    // Çağrı istatistikleri (bugün)
    db
      .select({ userId: callsTable.createdBy, total: count() })
      .from(callsTable)
      .where(and(
        eq(callsTable.organisationId, orgId),
        inArray(callsTable.createdBy, userIds),
        gte(callsTable.createdAt, todayStart)
      ))
      .groupBy(callsTable.createdBy),

    // Görev oluşturulan (7 gün)
    db
      .select({ userId: tasksTable.createdBy, total: count() })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organisationId, orgId),
        inArray(tasksTable.createdBy, userIds),
        gte(tasksTable.createdAt, since7d)
      ))
      .groupBy(tasksTable.createdBy),

    // Görev tamamlanan (7 gün)
    db
      .select({ userId: tasksTable.createdBy, total: count() })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organisationId, orgId),
        inArray(tasksTable.createdBy, userIds),
        eq(tasksTable.status, "terminee"),
        gte(tasksTable.updatedAt, since7d)
      ))
      .groupBy(tasksTable.createdBy),

    // Görev tamamlanan (bugün)
    db
      .select({ userId: tasksTable.createdBy, total: count() })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organisationId, orgId),
        inArray(tasksTable.createdBy, userIds),
        eq(tasksTable.status, "terminee"),
        gte(tasksTable.updatedAt, todayStart)
      ))
      .groupBy(tasksTable.createdBy),

    // Gecikmiş görevler (hâlâ açık ve tarihi geçmiş)
    db
      .select({ userId: tasksTable.createdBy, total: count() })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organisationId, orgId),
        inArray(tasksTable.createdBy, userIds),
        or(eq(tasksTable.status, "en_attente"), eq(tasksTable.status, "en_cours")),
        sql`${tasksTable.dueDate} < ${now.toISOString()}`
      ))
      .groupBy(tasksTable.createdBy),

    // Notlar (7 gün)
    db
      .select({ userId: notesInternesTable.userId, total: count() })
      .from(notesInternesTable)
      .where(and(
        eq(notesInternesTable.organisationId, orgId),
        inArray(notesInternesTable.userId, userIds),
        gte(notesInternesTable.createdAt, since7d)
      ))
      .groupBy(notesInternesTable.userId),

    // Notlar (bugün)
    db
      .select({ userId: notesInternesTable.userId, total: count() })
      .from(notesInternesTable)
      .where(and(
        eq(notesInternesTable.organisationId, orgId),
        inArray(notesInternesTable.userId, userIds),
        gte(notesInternesTable.createdAt, todayStart)
      ))
      .groupBy(notesInternesTable.userId),

    // Audit aksiyonlar (7 gün)
    db
      .select({ userId: auditLogsTable.userId, total: count() })
      .from(auditLogsTable)
      .where(and(
        inArray(auditLogsTable.userId, userIds),
        gte(auditLogsTable.createdAt, since7d)
      ))
      .groupBy(auditLogsTable.userId),
  ]);

  // 3. Lookup map'leri oluştur
  const byId = <T extends { userId: number | null; total: number }>(rows: T[]) =>
    Object.fromEntries(rows.filter((r) => r.userId != null).map((r) => [r.userId!, r.total]));

  const callMap7d = Object.fromEntries(
    callStats7d.filter((r) => r.userId != null).map((r) => [r.userId!, {
      total: Number(r.total),
      answered: Number(r.answered ?? 0),
      missed: Number(r.missed ?? 0),
    }])
  );
  const callMapToday = byId(callStatsToday);
  const taskCreated = byId(taskCreated7d);
  const taskCompleted = byId(taskCompleted7d);
  const taskCompletedTodayMap = byId(taskCompletedToday);
  const taskOverdueMap = byId(taskOverdue);
  const noteMap7d = byId(noteStats7d);
  const noteTodayMap = byId(noteStatsToday);
  const auditMap = byId(auditStats7d);

  // 4. Birleştir
  return users.map((u) => ({
    id: u.id,
    nom: u.nom,
    prenom: u.prenom,
    email: u.email,
    role: u.role,
    departement: u.departement,
    dernierAcces: u.dernierAcces,
    calls7d: callMap7d[u.id]?.total ?? 0,
    callsAnswered7d: callMap7d[u.id]?.answered ?? 0,
    callsMissed7d: callMap7d[u.id]?.missed ?? 0,
    tasksCreated7d: taskCreated[u.id] ?? 0,
    tasksCompleted7d: taskCompleted[u.id] ?? 0,
    tasksOverdue: taskOverdueMap[u.id] ?? 0,
    notes7d: noteMap7d[u.id] ?? 0,
    actions7d: auditMap[u.id] ?? 0,
    callsToday: callMapToday[u.id] ?? 0,
    tasksCompletedToday: taskCompletedTodayMap[u.id] ?? 0,
    notesToday: noteTodayMap[u.id] ?? 0,
  }));
}

// ── Bireysel performans skoru hesapla ─────────────────────────────────────────

function computeScore(emp: EmployeeStats): number {
  const callScore = Math.min(emp.calls7d * 3, 30);
  const answerRate = emp.calls7d > 0 ? (emp.callsAnswered7d / emp.calls7d) * 20 : 10;
  const taskScore = Math.min(emp.tasksCompleted7d * 4, 25);
  const overdueDeduct = Math.min(emp.tasksOverdue * 5, 20);
  const noteScore = Math.min(emp.notes7d * 2, 10);
  const activityScore = Math.min(emp.actions7d / 10, 15);
  const raw = callScore + answerRate + taskScore + noteScore + activityScore - overdueDeduct;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// Ham istatistik (AI olmadan, hızlı)
router.get(
  "/workforce-intelligence/employees",
  requireAuth,
  requireRole("administrateur", "super_admin"),
  async (req, res): Promise<void> => {
    const orgId = req.session?.organisationId as number | undefined;
    if (!orgId) { res.status(401).json({ error: "Non authentifie." }); return; }

    try {
      const employees = await gatherEmployeeStats(orgId);
      const withScores = employees.map((e) => ({ ...e, score: computeScore(e) }));
      res.json({ employees: withScores, generatedAt: new Date().toISOString() });
    } catch (err) {
      req.log?.error({ err }, "[workforce-intelligence] employees fetch failed");
      res.status(500).json({ error: "Erreur lors de la collecte des donnees." });
    }
  }
);

// Tam AI analizi
router.get(
  "/workforce-intelligence",
  requireAuth,
  requireRole("administrateur", "super_admin"),
  async (req, res): Promise<void> => {
    const orgId = req.session?.organisationId as number | undefined;
    const managerName: string = req.session?.prenom ?? "Responsable";
    if (!orgId) { res.status(401).json({ error: "Non authentifie." }); return; }

    // 1. Çalışan verisi
    let employees: EmployeeStats[];
    try {
      employees = await gatherEmployeeStats(orgId);
    } catch (err) {
      req.log?.error({ err }, "[workforce-intelligence] data gather failed");
      res.status(500).json({ error: "Erreur lors de la collecte des donnees." });
      return;
    }

    const withScores = employees.map((e) => ({ ...e, score: computeScore(e) }));
    const teamAvgScore = withScores.length > 0
      ? Math.round(withScores.reduce((s, e) => s + e.score, 0) / withScores.length)
      : 0;

    // 2. AI prompt
    const today = new Date().toLocaleDateString("fr-FR", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

    const employeeLines = withScores
      .map((e) => `- ${e.prenom} ${e.nom} (${e.role}${e.departement ? ", " + e.departement : ""}): score=${e.score}/100, appels_7j=${e.calls7d} (repondus=${e.callsAnswered7d}, manques=${e.callsMissed7d}), taches_terminees_7j=${e.tasksCompleted7d}, taches_en_retard=${e.tasksOverdue}, notes_7j=${e.notes7d}, actions_7j=${e.actions7d}, actif_aujourd_hui=${e.callsToday + e.tasksCompletedToday + e.notesToday > 0 ? "oui" : "non"}, dernier_acces=${e.dernierAcces ? new Date(e.dernierAcces).toLocaleDateString("fr-FR") : "inconnu"}`)
      .join("\n");

    const prompt = `Tu es un assistant RH IA specialise dans l'analyse de performance d'equipes en centre d'appels/bureau.
Aujourd'hui: ${today}
Manager: ${managerName}
Score moyen equipe: ${teamAvgScore}/100
Nombre de collaborateurs: ${employees.length}

DONNEES PAR COLLABORATEUR (7 derniers jours):
${employeeLines}

Analyse ces donnees et genere un rapport JSON complet (sans markdown, JSON brut uniquement):
{
  "sante_equipe": <entier 0-100>,
  "tendance": "hausse" | "stable" | "baisse",
  "message_manager": "Message bref et professionnel pour ${managerName} (2-3 phrases). Synthetise l'etat de l'equipe.",
  "top_performeurs": [
    { "nom": "Prenom Nom", "score": <entier>, "raison": "Raison concise (1 phrase)" }
  ],
  "en_difficulte": [
    { "nom": "Prenom Nom", "score": <entier>, "probleme": "Probleme identifie", "action_recommandee": "Action concrete pour le manager" }
  ],
  "alertes": [
    { "type": "absence" | "surcharge" | "qualite" | "retard" | "inactivite", "collaborateur": "Prenom Nom", "message": "Description de l'alerte", "urgence": "haute" | "moyenne" | "basse" }
  ],
  "recommandations": [
    { "action": "Action concrete et actionnable pour le manager", "impact": "Impact attendu", "priorite": "haute" | "moyenne" | "basse" }
  ],
  "previsions": "Courte prevision pour la semaine prochaine basee sur les tendances (2 phrases)."
}
Regles:
- top_performeurs: max 3, uniquement si score >= 60
- en_difficulte: max 3, uniquement si score < 45 ou taches_en_retard >= 2 ou inactif
- alertes: max 5, seulement les plus importantes
- recommandations: 3 a 5, tres concises et actionnables
- Tout en francais professionnel`;

    // 3. Gemini çağrısı
    let aiResult: {
      sante_equipe: number;
      tendance: string;
      message_manager: string;
      top_performeurs: { nom: string; score: number; raison: string }[];
      en_difficulte: { nom: string; score: number; probleme: string; action_recommandee: string }[];
      alertes: { type: string; collaborateur: string; message: string; urgence: string }[];
      recommandations: { action: string; impact: string; priorite: string }[];
      previsions: string;
    } | null = null;

    try {
      const raw = await runGemini(orgId, prompt);
      aiResult = safeJson(raw, null);
    } catch (err) {
      if (err instanceof AiQuotaExceededError) {
        logger.warn({ orgId }, "[workforce-intelligence] AI quota exceeded");
      } else {
        logger.error({ err }, "[workforce-intelligence] AI failed");
      }
    }

    res.json({
      date: today,
      managerName,
      teamSize: employees.length,
      teamAvgScore,
      employees: withScores,
      ai: aiResult,
      generatedAt: new Date().toISOString(),
    });
  }
);

export default router;
