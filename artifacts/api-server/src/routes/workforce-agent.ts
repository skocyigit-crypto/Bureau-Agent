/**
 * workforce-agent.ts — Otonom AI Ekip Takip Ajanı
 *
 * Gerçek çok-aşamalı (multi-step) ajan döngüsü:
 *   Phase 1 → SCOUT    : Hızlı tarama, kritik sinyalleri bul
 *   Phase 2 → DIAGNOSE : Scout bulgularına dayalı derin bireysel teşhis
 *   Phase 3 → PRESCRIBE: Teşhise dayalı somut eylem planı
 *   Phase 4 → FORECAST : Geçmiş raporlarla karşılaştırma + haftalık tahmin
 *
 * Her aşama bir sonrakinin bağlamını oluşturur → Gerçek zincir düşünme.
 * Sonuçlar aiAgentReportsTable'a kaydedilir → Geçmişe dayalı öğrenme.
 *
 * GET /api/workforce-agent         → Tüm ajanı çalıştır (tam analiz)
 * GET /api/workforce-agent/history → Son 10 ajan raporu
 */

import { Router } from "express";
import {
  db,
  usersTable,
  callsTable,
  tasksTable,
  notesInternesTable,
  auditLogsTable,
  aiAgentReportsTable,
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
  lt,
} from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  assertAiQuota,
  AiQuotaExceededError,
  invalidateQuotaCache,
} from "../services/ai-quota";
import {
  extractGeminiTokens,
  recordAiUsage,
  aiCallWithRetry,
  safeJsonParse,
  GEMINI_PRO_MODEL,
} from "../services/ai-utils";
import { logger } from "../lib/logger";

const router = Router();

// ── Zaman yardımcıları ────────────────────────────────────────────────────────

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

// ── Gemini çağrısı (retry + kullanım kaydı) ───────────────────────────────────

async function callGemini(orgId: number, prompt: string, phase: string): Promise<string> {
  await assertAiQuota(orgId);
  const t0 = Date.now();
  const { ai } = await import("@workspace/integrations-gemini-ai");
  const model = GEMINI_PRO_MODEL;

  const response = await aiCallWithRetry(
    () =>
      ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    { label: `workforce-agent:${phase}`, maxRetries: 2 }
  );

  const text = response.text ?? "{}";
  const tokens = extractGeminiTokens(response);
  recordAiUsage({
    organisationId: orgId,
    provider: "gemini",
    model,
    route: `/workforce-agent/${phase}`,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    durationMs: Date.now() - t0,
  }).catch(() => {});
  invalidateQuotaCache(orgId);
  return text;
}

// ── Veri toplama ──────────────────────────────────────────────────────────────

async function collectEmployeeData(orgId: number) {
  const since7d = daysAgo(7);
  const since30d = daysAgo(30);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const now = new Date();

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

  if (users.length === 0) return { users: [], metrics: [] };

  const ids = users.map((u) => u.id);

  const [
    calls7d, callsToday,
    tasks7d, tasksCompleted7d, tasksOverdue,
    notes7d, notesMonth,
    actions7d, actionsToday,
    logins7d,
  ] = await Promise.all([
    // Çağrılar (7 gün)
    db.select({
      userId: callsTable.createdBy,
      total: count(),
      answered: sql<number>`sum(case when ${callsTable.status}='repondu' then 1 else 0 end)`,
      missed: sql<number>`sum(case when ${callsTable.status}='manque' then 1 else 0 end)`,
      avgDuration: sql<number>`avg(${callsTable.duration})`,
    }).from(callsTable).where(and(
      eq(callsTable.organisationId, orgId),
      inArray(callsTable.createdBy, ids),
      gte(callsTable.createdAt, since7d)
    )).groupBy(callsTable.createdBy),

    // Çağrılar (bugün)
    db.select({ userId: callsTable.createdBy, total: count() })
      .from(callsTable).where(and(
        eq(callsTable.organisationId, orgId),
        inArray(callsTable.createdBy, ids),
        gte(callsTable.createdAt, todayStart)
      )).groupBy(callsTable.createdBy),

    // Görevler oluşturulan (7 gün)
    db.select({ userId: tasksTable.createdBy, total: count() })
      .from(tasksTable).where(and(
        eq(tasksTable.organisationId, orgId),
        inArray(tasksTable.createdBy, ids),
        gte(tasksTable.createdAt, since7d)
      )).groupBy(tasksTable.createdBy),

    // Görevler tamamlanan (7 gün)
    db.select({ userId: tasksTable.createdBy, total: count() })
      .from(tasksTable).where(and(
        eq(tasksTable.organisationId, orgId),
        inArray(tasksTable.createdBy, ids),
        eq(tasksTable.status, "terminee"),
        gte(tasksTable.updatedAt, since7d)
      )).groupBy(tasksTable.createdBy),

    // Gecikmiş görevler
    db.select({ userId: tasksTable.createdBy, total: count() })
      .from(tasksTable).where(and(
        eq(tasksTable.organisationId, orgId),
        inArray(tasksTable.createdBy, ids),
        or(eq(tasksTable.status, "en_attente"), eq(tasksTable.status, "en_cours")),
        sql`${tasksTable.dueDate} < ${now.toISOString()}`
      )).groupBy(tasksTable.createdBy),

    // Notlar (7 gün)
    db.select({ userId: notesInternesTable.userId, total: count() })
      .from(notesInternesTable).where(and(
        eq(notesInternesTable.organisationId, orgId),
        inArray(notesInternesTable.userId, ids),
        gte(notesInternesTable.createdAt, since7d)
      )).groupBy(notesInternesTable.userId),

    // Notlar (30 gün) — trend için
    db.select({ userId: notesInternesTable.userId, total: count() })
      .from(notesInternesTable).where(and(
        eq(notesInternesTable.organisationId, orgId),
        inArray(notesInternesTable.userId, ids),
        gte(notesInternesTable.createdAt, since30d)
      )).groupBy(notesInternesTable.userId),

    // Audit aksiyonlar (7 gün)
    db.select({ userId: auditLogsTable.userId, total: count() })
      .from(auditLogsTable).where(and(
        inArray(auditLogsTable.userId, ids),
        gte(auditLogsTable.createdAt, since7d)
      )).groupBy(auditLogsTable.userId),

    // Audit aksiyonlar (bugün)
    db.select({ userId: auditLogsTable.userId, total: count() })
      .from(auditLogsTable).where(and(
        inArray(auditLogsTable.userId, ids),
        gte(auditLogsTable.createdAt, todayStart)
      )).groupBy(auditLogsTable.userId),

    // Giriş sayısı (7 gün) — bağlılık göstergesi
    db.select({ userId: auditLogsTable.userId, total: count() })
      .from(auditLogsTable).where(and(
        inArray(auditLogsTable.userId, ids),
        eq(auditLogsTable.action, "login"),
        gte(auditLogsTable.createdAt, since7d)
      )).groupBy(auditLogsTable.userId),
  ]);

  // Lookup map
  const m = <T extends { userId: number | null; total: number }>(rows: T[]) =>
    Object.fromEntries(rows.filter((r) => r.userId != null).map((r) => [r.userId!, Number(r.total)]));

  const callMap = Object.fromEntries(
    calls7d.filter((r) => r.userId != null).map((r) => [r.userId!, {
      total: Number(r.total),
      answered: Number(r.answered ?? 0),
      missed: Number(r.missed ?? 0),
      avgDuration: Math.round(Number(r.avgDuration ?? 0)),
    }])
  );

  const metrics = users.map((u) => {
    const c = callMap[u.id] ?? { total: 0, answered: 0, missed: 0, avgDuration: 0 };
    const tasksCreated = m(tasks7d)[u.id] ?? 0;
    const tasksCompleted = m(tasksCompleted7d)[u.id] ?? 0;
    const overdue = m(tasksOverdue)[u.id] ?? 0;
    const notes = m(notes7d)[u.id] ?? 0;
    const notesM = m(notesMonth)[u.id] ?? 0;
    const actions = m(actions7d)[u.id] ?? 0;
    const actionsNow = m(actionsToday)[u.id] ?? 0;
    const logins = m(logins7d)[u.id] ?? 0;
    const callsNow = m(callsToday)[u.id] ?? 0;

    // Performans skoru hesabı
    const callScore = Math.min(c.total * 3, 30);
    const answerRate = c.total > 0 ? (c.answered / c.total) * 20 : 10;
    const taskScore = Math.min(tasksCompleted * 4, 25);
    const overdueDeduct = Math.min(overdue * 5, 20);
    const noteScore = Math.min(notes * 2, 10);
    const activityScore = Math.min(actions / 10, 15);
    const score = Math.max(0, Math.min(100, Math.round(
      callScore + answerRate + taskScore + noteScore + activityScore - overdueDeduct
    )));

    const isActiveToday = callsNow + actionsNow > 0;
    const daysSinceLastAccess = u.dernierAcces
      ? Math.floor((Date.now() - new Date(u.dernierAcces).getTime()) / 86400000)
      : 999;

    return {
      id: u.id,
      nom: `${u.prenom} ${u.nom}`,
      role: u.role,
      departement: u.departement,
      score,
      calls7d: c.total,
      callsAnswered7d: c.answered,
      callsMissed7d: c.missed,
      avgCallDuration: c.avgDuration,
      tasksCreated7d: tasksCreated,
      tasksCompleted7d: tasksCompleted,
      tasksOverdue: overdue,
      notes7d: notes,
      notes30d: notesM,
      actions7d: actions,
      logins7d: logins,
      isActiveToday,
      daysSinceLastAccess,
    };
  });

  return { users, metrics };
}

// ── Geçmiş raporları getir ────────────────────────────────────────────────────

async function getPastReports(orgId: number, limit = 5) {
  return db
    .select({
      id: aiAgentReportsTable.id,
      reportDate: aiAgentReportsTable.reportDate,
      score: aiAgentReportsTable.score,
      summary: aiAgentReportsTable.summary,
      errorsFound: aiAgentReportsTable.errorsFound,
      warningsFound: aiAgentReportsTable.warningsFound,
      details: aiAgentReportsTable.details,
      createdAt: aiAgentReportsTable.createdAt,
    })
    .from(aiAgentReportsTable)
    .where(and(
      eq(aiAgentReportsTable.organisationId, orgId),
      eq(aiAgentReportsTable.agentId, "workforce-agent")
    ))
    .orderBy(desc(aiAgentReportsTable.createdAt))
    .limit(limit);
}

// ── 4-Aşamalı Ajan Döngüsü ───────────────────────────────────────────────────

interface AgentPhaseLog {
  phase: string;
  label: string;
  durationMs: number;
  result: unknown;
}

interface ScoutResult {
  kritik_sinyaller: string[];
  risk_seviyesi: "kirmizi" | "sari" | "yesil";
  acil_mudahale: string[];
  guclu_yonler: string[];
  ekip_enerjisi: string;
  skor_tahmini: number;
}

interface DiagnoseResult {
  bireysel_teshis: {
    nom: string;
    durum: "kritik" | "dikkat" | "normal" | "mukemmel";
    guc: string;
    zayiflik: string;
    kok_neden: string;
  }[];
  ekip_dinamikleri: string;
  darbogazlar: string[];
}

interface PrescribeResult {
  acil_aksiyonlar: {
    aksiyon: string;
    hedef?: string;
    sure: string;
    etki: "yuksek" | "orta" | "dusuk";
  }[];
  haftalik_plan: string[];
  bireysel_gorusme: string[];
  surec_iyilestirme: string[];
}

interface ForecastResult {
  haftalik_tahmin: string;
  trend: "yukselis" | "stabil" | "dusus";
  risk_faktoru: string;
  firsat: string;
  gecmis_karsilastirma: string;
  oneri_skoru: number;
}

async function runAgentLoop(orgId: number, managerName: string): Promise<{
  agentLog: AgentPhaseLog[];
  scout: ScoutResult | null;
  diagnose: DiagnoseResult | null;
  prescribe: PrescribeResult | null;
  forecast: ForecastResult | null;
  teamScore: number;
  employeeCount: number;
  rawMetrics: ReturnType<typeof collectEmployeeData> extends Promise<infer T> ? T : never;
}> {
  const t0 = Date.now();
  const agentLog: AgentPhaseLog[] = [];

  // Veri & geçmiş paralelde
  const [{ users, metrics }, pastReports] = await Promise.all([
    collectEmployeeData(orgId),
    getPastReports(orgId, 3),
  ]);

  if (metrics.length === 0) {
    return { agentLog, scout: null, diagnose: null, prescribe: null, forecast: null, teamScore: 0, employeeCount: 0, rawMetrics: { users, metrics } as any };
  }

  const teamScore = Math.round(metrics.reduce((s, e) => s + e.score, 0) / metrics.length);
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  // Veri özeti — tüm aşamalarda paylaşılır
  const dataBlock = metrics.map((e) =>
    `• ${e.nom} (${e.role}${e.departement ? ", " + e.departement : ""}): score=${e.score}/100, appels=${e.calls7d}(rep=${e.callsAnswered7d},manq=${e.callsMissed7d}), taches_terminees=${e.tasksCompleted7d}, taches_retard=${e.tasksOverdue}, notes=${e.notes7d}, connexions=${e.logins7d}, actif_auj=${e.isActiveToday ? "oui" : "non"}, jours_sans_acces=${e.daysSinceLastAccess === 999 ? "jamais" : e.daysSinceLastAccess}`
  ).join("\n");

  // ── Phase 1: SCOUT ────────────────────────────────────────────────────────

  const p1Start = Date.now();
  const scoutPrompt = `Tu es un AGENT IA de surveillance RH. Phase 1: RECONNAISSANCE RAPIDE.
Date: ${today} | Manager: ${managerName} | Score equipe: ${teamScore}/100

DONNEES EQUIPE (7 derniers jours):
${dataBlock}

Analyse rapidement et identifie les signaux CRITIQUES. Reponds en JSON brut:
{
  "kritik_sinyaller": ["signal 1", "signal 2", "signal 3"],
  "risk_seviyesi": "kirmizi" | "sari" | "yesil",
  "acil_mudahale": ["personne/situation urgente 1", "personne/situation urgente 2"],
  "guclu_yonler": ["point fort equipe 1", "point fort equipe 2"],
  "ekip_enerjisi": "Description en 1 phrase de l'energie/dynamique de l'equipe",
  "skor_tahmini": <entier 0-100 sante globale>
}
Sois direct et factuel. Max 3 items par liste.`;

  const scoutRaw = await callGemini(orgId, scoutPrompt, "scout");
  const scout = safeJsonParse<ScoutResult | null>(scoutRaw, null);
  agentLog.push({ phase: "SCOUT", label: "Reconnaissance rapide", durationMs: Date.now() - p1Start, result: scout });

  // ── Phase 2: DIAGNOSE ─────────────────────────────────────────────────────

  const p2Start = Date.now();
  const diagnosePrompt = `Tu es un AGENT IA de diagnostic RH. Phase 2: DIAGNOSTIC INDIVIDUEL APPROFONDI.
Contexte Phase 1 (Reconnaissance):
- Risque: ${scout?.risk_seviyesi ?? "inconnu"}
- Signaux critiques: ${scout?.kritik_sinyaller?.join(", ") ?? "aucun"}
- Cas urgents: ${scout?.acil_mudahale?.join(", ") ?? "aucun"}

DONNEES INDIVIDUELLES:
${dataBlock}

Effectue un diagnostic individuel pour CHAQUE collaborateur. Reponds en JSON brut:
{
  "bireysel_teshis": [
    {
      "nom": "Prenom Nom",
      "durum": "kritik" | "dikkat" | "normal" | "mukemmel",
      "guc": "Principale force de cette personne (1 phrase courte)",
      "zayiflik": "Principale faiblesse detectee (1 phrase courte)",
      "kok_neden": "Cause racine probable du statut (1 phrase)"
    }
  ],
  "ekip_dinamikleri": "Analyse de la dynamique d'equipe (2 phrases)",
  "darbogazlar": ["goulot d'etranglement 1", "goulot d'etranglement 2"]
}
Inclure TOUS les collaborateurs dans bireysel_teshis.`;

  const diagnoseRaw = await callGemini(orgId, diagnosePrompt, "diagnose");
  const diagnose = safeJsonParse<DiagnoseResult | null>(diagnoseRaw, null);
  agentLog.push({ phase: "DIAGNOSE", label: "Diagnostic individuel", durationMs: Date.now() - p2Start, result: diagnose });

  // ── Phase 3: PRESCRIBE ────────────────────────────────────────────────────

  const p3Start = Date.now();
  const prescribePrompt = `Tu es un AGENT IA prescripteur RH. Phase 3: PLAN D'ACTION.
Contexte cumule:
- Phase 1 Risque: ${scout?.risk_seviyesi} | Signaux: ${scout?.kritik_sinyaller?.join("; ")}
- Phase 2 Dynamiques: ${diagnose?.ekip_dinamikleri ?? "non analyse"}
- Goulots: ${diagnose?.darbogazlar?.join("; ") ?? "aucun"}
- Cas critiques: ${diagnose?.bireysel_teshis?.filter((t) => t.durum === "kritik").map((t) => t.nom).join(", ") ?? "aucun"}

Genere un PLAN D'ACTION CONCRET ET ACTIONNABLE pour le manager ${managerName}. JSON brut:
{
  "acil_aksiyonlar": [
    {
      "aksiyon": "Action precise a faire AUJOURD'HUI ou CETTE SEMAINE",
      "hedef": "Collaborateur ou groupe concerne (optionnel)",
      "sure": "Aujourd'hui" | "Cette semaine" | "Ce mois",
      "etki": "yuksek" | "orta" | "dusuk"
    }
  ],
  "haftalik_plan": ["Action semaine 1", "Action semaine 2", "Action semaine 3"],
  "bireysel_gorusme": ["Collaborateur a rencontrer en prive 1 + raison", "Collaborateur 2 + raison"],
  "surec_iyilestirme": ["Amelioration de process 1", "Amelioration de process 2"]
}
Max 4 actions urgentes. Prioritise par impact.`;

  const prescribeRaw = await callGemini(orgId, prescribePrompt, "prescribe");
  const prescribe = safeJsonParse<PrescribeResult | null>(prescribeRaw, null);
  agentLog.push({ phase: "PRESCRIBE", label: "Plan d'action", durationMs: Date.now() - p3Start, result: prescribe });

  // ── Phase 4: FORECAST (geçmişe dayalı öğrenme) ───────────────────────────

  const p4Start = Date.now();
  const historyBlock = pastReports.length > 0
    ? pastReports.map((r, i) => `Rapport ${i + 1} (${r.reportDate}): score=${r.score}, resume="${r.summary}", alertes=${r.errorsFound}`).join("\n")
    : "Aucun rapport historique disponible (premier analyse).";

  const forecastPrompt = `Tu es un AGENT IA de prevision RH. Phase 4: FORECAST ET APPRENTISSAGE.
Contexte complet:
- Score actuel equipe: ${teamScore}/100
- Risque Phase 1: ${scout?.risk_seviyesi}
- Energie equipe: ${scout?.ekip_enerjisi ?? "non evaluee"}
- Plan d'action: ${prescribe?.acil_aksiyonlar?.map((a) => a.aksiyon).join("; ") ?? "non etabli"}

HISTORIQUE DES ANALYSES PRECEDENTES:
${historyBlock}

Compare avec l'historique et genere des previsions intelligentes. JSON brut:
{
  "haftalik_tahmin": "Prevision concrete pour la semaine prochaine (2-3 phrases basees sur les donnees)",
  "trend": "yukselis" | "stabil" | "dusus",
  "risk_faktoru": "Principal facteur de risque a surveiller (1 phrase)",
  "firsat": "Principale opportunite a saisir (1 phrase)",
  "gecmis_karsilastirma": "Comparaison avec les analyses precedentes (1-2 phrases). Si c'est la premiere analyse, dis-le.",
  "oneri_skoru": <entier 0-100 probabilite que les recommandations soient suivies d'effets>
}`;

  const forecastRaw = await callGemini(orgId, forecastPrompt, "forecast");
  const forecast = safeJsonParse<ForecastResult | null>(forecastRaw, null);
  agentLog.push({ phase: "FORECAST", label: "Prevision & apprentissage", durationMs: Date.now() - p4Start, result: forecast });

  // Toplam süre
  const totalMs = Date.now() - t0;

  // ── Raporu kaydet ─────────────────────────────────────────────────────────

  const criticalCount = diagnose?.bireysel_teshis?.filter((t) => t.durum === "kritik").length ?? 0;
  const dikkatCount = diagnose?.bireysel_teshis?.filter((t) => t.durum === "dikkat").length ?? 0;
  const summaryText = `${today} — Score equipe: ${teamScore}/100 | Risque: ${scout?.risk_seviyesi ?? "?"} | ${criticalCount} critique(s), ${dikkatCount} en attention | Trend: ${forecast?.trend ?? "?"}`;

  try {
    await db.insert(aiAgentReportsTable).values({
      agentId: "workforce-agent",
      agentName: "Agent Intelligence Equipe",
      agentIcon: "users",
      organisationId: orgId,
      reportDate: today,
      status: "termine",
      score: teamScore,
      errorsFound: criticalCount,
      warningsFound: dikkatCount,
      suggestionsCount: (prescribe?.acil_aksiyonlar?.length ?? 0) + (prescribe?.haftalik_plan?.length ?? 0),
      summary: summaryText,
      details: { scout, diagnose, prescribe, forecast, agentLog } as any,
      errors: (diagnose?.bireysel_teshis?.filter((t) => t.durum === "kritik") ?? []) as any,
      warnings: (diagnose?.bireysel_teshis?.filter((t) => t.durum === "dikkat") ?? []) as any,
      suggestions: (prescribe?.acil_aksiyonlar ?? []) as any,
      corrections: [] as any,
      isSuperReport: false,
      childReportIds: [] as any,
      executionTimeMs: totalMs,
    });
  } catch (err) {
    logger.error({ err }, "[workforce-agent] report save failed");
  }

  return {
    agentLog,
    scout,
    diagnose,
    prescribe,
    forecast,
    teamScore,
    employeeCount: metrics.length,
    rawMetrics: { users, metrics } as any,
  };
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// Ana ajan — tüm 4 aşamayı çalıştır
router.get(
  "/workforce-agent",
  requireAuth,
  requireRole("administrateur", "super_admin"),
  async (req, res): Promise<void> => {
    const orgId = req.session?.organisationId as number | undefined;
    const managerName: string = req.session?.prenom ?? "Responsable";

    if (!orgId) { res.status(401).json({ error: "Non authentifie." }); return; }

    try {
      const result = await runAgentLoop(orgId, managerName);

      res.json({
        agentId: "workforce-agent",
        agentName: "Agent Intelligence Equipe",
        managerName,
        date: new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
        teamScore: result.teamScore,
        employeeCount: result.employeeCount,
        phases: {
          scout: result.scout,
          diagnose: result.diagnose,
          prescribe: result.prescribe,
          forecast: result.forecast,
        },
        agentLog: result.agentLog,
        employees: (result.rawMetrics as any).metrics ?? [],
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof AiQuotaExceededError) {
        res.status(429).json({ error: "Quota IA depasse. Reessayez plus tard." });
      } else {
        req.log?.error({ err }, "[workforce-agent] agent loop failed");
        res.status(500).json({ error: "Erreur lors de l'analyse IA." });
      }
    }
  }
);

// Geçmiş raporlar
router.get(
  "/workforce-agent/history",
  requireAuth,
  requireRole("administrateur", "super_admin"),
  async (req, res): Promise<void> => {
    const orgId = req.session?.organisationId as number | undefined;
    if (!orgId) { res.status(401).json({ error: "Non authentifie." }); return; }

    try {
      const reports = await db
        .select({
          id: aiAgentReportsTable.id,
          reportDate: aiAgentReportsTable.reportDate,
          score: aiAgentReportsTable.score,
          summary: aiAgentReportsTable.summary,
          errorsFound: aiAgentReportsTable.errorsFound,
          warningsFound: aiAgentReportsTable.warningsFound,
          suggestionsCount: aiAgentReportsTable.suggestionsCount,
          executionTimeMs: aiAgentReportsTable.executionTimeMs,
          createdAt: aiAgentReportsTable.createdAt,
        })
        .from(aiAgentReportsTable)
        .where(and(
          eq(aiAgentReportsTable.organisationId, orgId),
          eq(aiAgentReportsTable.agentId, "workforce-agent")
        ))
        .orderBy(desc(aiAgentReportsTable.createdAt))
        .limit(20);

      res.json({ reports });
    } catch (err) {
      req.log?.error({ err }, "[workforce-agent] history fetch failed");
      res.status(500).json({ error: "Erreur historique." });
    }
  }
);

export default router;
