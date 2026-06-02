/**
 * Agent d'auto-audit — "Oto-Denetim Ajanı".
 *
 * Tourne en arrière-plan et inspecte l'état de l'application pour chaque
 * organisation : santé, qualité des données, sécurité, usage. Il produit deux
 * types de constats — `eksik` (lacunes/risques) et `yenilik` (idées
 * d'amélioration) — stockés dans `app_audit_findings` (rapport visible par le
 * patron).
 *
 * Lorsqu'un constat est *actionnable* via un outil de l'assistant, l'agent crée
 * AUSSI une proposition dans la file d'approbation (agent_proposals) et la relie
 * via `linkedProposalId`. Il ne modifie jamais les données client tout seul :
 * tout passe par l'approbation du patron (réutilise executeProposal côté queue).
 */
import { db } from "@workspace/db";
import {
  appAuditFindingsTable,
  agentProposalsTable,
  tasksTable,
  callsTable,
  messagesTable,
  contactsTable,
  calendarEventsTable,
  documentsTable,
} from "@workspace/db/schema";
import { and, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getTool, validateArgs } from "./assistant-tools";
import { assertAiQuota, invalidateQuotaCache } from "./ai-quota";
import { extractGeminiTokens, recordAiUsage, geminiActualModel } from "./ai-utils";

/** Outils que l'agent d'audit a le droit de proposer (mêmes que l'agent autonome). */
const ALLOWED_TOOLS = ["create_task", "send_email", "send_sms", "create_calendar_event", "create_contact"] as const;
type AllowedTool = (typeof ALLOWED_TOOLS)[number];

const MAX_FINDINGS_PER_RUN = 8;
const VALID_KINDS = ["eksik", "yenilik"] as const;
const VALID_AREAS = ["sante", "donnees", "securite", "usage", "fonctionnalite", "general"] as const;
const VALID_SEVERITIES = ["basse", "moyenne", "haute", "critique"] as const;

// ── Appel IA (Gemini) ───────────────────────────────────────────────────────

async function aiGenerate(orgId: number, prompt: string): Promise<string> {
  await assertAiQuota(orgId);
  const t0 = Date.now();
  const { ai } = await import("@workspace/integrations-gemini-ai");
  const model = "gemini-2.5-flash";
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  const text = response.text ?? "{}";
  const tokens = extractGeminiTokens(response);
  recordAiUsage({
    organisationId: orgId, provider: "gemini", model: geminiActualModel(response, model), route: "/app-audit/run",
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

// ── Collecte des signaux d'audit ─────────────────────────────────────────────

export interface AuditSignals {
  overdueTasks: number;
  openTasks: number;
  unreadMessages: number;
  missedCallsToday: number;
  inactiveContacts: number;
  totalContacts: number;
  upcomingEvents48h: number;
  pendingProposals: number;
  totalDocuments: number;
  unscannedDocuments: number;
  threatDocuments: number;
  unprocessedDocuments: number;
}

async function count(query: Promise<Array<{ n: number }>>): Promise<number> {
  const rows = await query;
  return rows[0]?.n ?? 0;
}

export async function gatherAuditSignals(orgId: number): Promise<AuditSignals> {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const N = sql<number>`count(*)::int`;

  const [
    overdueTasks, openTasks, unreadMessages, missedCallsToday,
    inactiveContacts, totalContacts, upcomingEvents48h, pendingProposals,
    totalDocuments, unscannedDocuments, threatDocuments, unprocessedDocuments,
  ] = await Promise.all([
    count(db.select({ n: N }).from(tasksTable).where(and(
      eq(tasksTable.organisationId, orgId),
      lte(tasksTable.dueDate, now),
      sql`${tasksTable.status} NOT IN ('terminee', 'annulee')`,
    ))),
    count(db.select({ n: N }).from(tasksTable).where(and(
      eq(tasksTable.organisationId, orgId),
      sql`${tasksTable.status} NOT IN ('terminee', 'annulee')`,
    ))),
    count(db.select({ n: N }).from(messagesTable).where(and(
      eq(messagesTable.organisationId, orgId),
      eq(messagesTable.isRead, false),
      lte(messagesTable.createdAt, oneHourAgo),
    ))),
    count(db.select({ n: N }).from(callsTable).where(and(
      eq(callsTable.organisationId, orgId),
      eq(callsTable.status, "manque"),
      gte(callsTable.createdAt, todayStart),
    ))),
    count(db.select({ n: N }).from(contactsTable).where(and(
      eq(contactsTable.organisationId, orgId),
      lte(contactsTable.updatedAt, thirtyDaysAgo),
    ))),
    count(db.select({ n: N }).from(contactsTable).where(eq(contactsTable.organisationId, orgId))),
    count(db.select({ n: N }).from(calendarEventsTable).where(and(
      eq(calendarEventsTable.organisationId, orgId),
      gte(calendarEventsTable.startDate, now),
      lte(calendarEventsTable.startDate, in48h),
    ))),
    count(db.select({ n: N }).from(agentProposalsTable).where(and(
      eq(agentProposalsTable.organisationId, orgId),
      eq(agentProposalsTable.status, "en_attente"),
    ))),
    count(db.select({ n: N }).from(documentsTable).where(eq(documentsTable.organisationId, orgId))),
    count(db.select({ n: N }).from(documentsTable).where(and(
      eq(documentsTable.organisationId, orgId),
      sql`${documentsTable.scannedAt} IS NULL`,
    ))),
    count(db.select({ n: N }).from(documentsTable).where(and(
      eq(documentsTable.organisationId, orgId),
      sql`${documentsTable.scanVerdict} IN ('malveillant', 'suspect')`,
    ))),
    count(db.select({ n: N }).from(documentsTable).where(and(
      eq(documentsTable.organisationId, orgId),
      eq(documentsTable.aiProcessed, false),
    ))),
  ]);

  return {
    overdueTasks, openTasks, unreadMessages, missedCallsToday,
    inactiveContacts, totalContacts, upcomingEvents48h, pendingProposals,
    totalDocuments, unscannedDocuments, threatDocuments, unprocessedDocuments,
  };
}

function hasSignal(s: AuditSignals): boolean {
  return Object.values(s).some(v => v > 0);
}

// ── Bulgu (constat) interne ──────────────────────────────────────────────────

interface AuditFinding {
  kind: string;
  area: string;
  severity: string;
  title: string;
  detail: string;
  suggestion: string;
  sourceRef: string;
  actionable: boolean;
  toolName: string | null;
  args: Record<string, unknown> | null;
  metric: Record<string, unknown>;
}

// ── Construction du prompt + parsing ─────────────────────────────────────────

function buildPrompt(signals: AuditSignals): string {
  const toolDocs = ALLOWED_TOOLS.map(name => {
    const t = getTool(name);
    return t ? `- ${t.name}: ${t.description}\n  params: ${JSON.stringify(t.parameters.properties)}${t.parameters.required ? `\n  obligatoires: ${t.parameters.required.join(", ")}` : ""}` : "";
  }).filter(Boolean).join("\n");

  return `Tu es un auditeur interne et conseiller produit pour une PME française qui utilise un logiciel d'agent de bureau. Tu inspectes l'état de l'application et tu produis des CONSTATS utiles, sans inventer de données. Tu n'exécutes rien : tu rapportes, et pour les constats traitables tu PROPOSES une action que le patron validera.

SIGNAUX MESURÉS (JSON):
${JSON.stringify(signals)}

OUTILS DISPONIBLES (pour les constats actionnables uniquement):
${toolDocs}

TYPES DE CONSTATS:
- "eksik"   : une lacune, un retard ou un risque concret basé sur les signaux (ex: tâches en retard, messages non lus, documents non scannés, menaces détectées).
- "yenilik" : une idée d'amélioration ou d'innovation pertinente pour cette PME (ex: automatiser une relance, organiser les contacts, mieux utiliser un module sous-exploité).

CONSIGNES:
- Produis au maximum ${MAX_FINDINGS_PER_RUN} constats, classés par importance.
- Chaque constat doit s'appuyer sur les signaux réels. N'invente pas de chiffres.
- "severity" parmi: basse, moyenne, haute, critique. Les menaces sécurité (threatDocuments>0) sont au minimum "haute".
- "area" parmi: sante, donnees, securite, usage, fonctionnalite, general.
- "sourceRef" = clé stable du constat pour éviter les doublons (ex: "overdue-tasks", "unread-messages", "threat-docs", "innov-relance-contacts").
- "actionable": true UNIQUEMENT si le constat peut être traité par un des outils ci-dessus. Dans ce cas remplis "toolName" et "args" valides (en français, professionnel). Pour send_email/send_sms ne mets un destinataire que si tu le connais — sinon préfère create_task. Si tu ne peux pas remplir des args valides, mets actionable=false.
- Les idées "yenilik" qui demandent du développement logiciel restent actionable=false (rapport seulement).

Réponds UNIQUEMENT avec un objet JSON strict de cette forme:
{"findings":[{"kind":"eksik|yenilik","area":"...","severity":"...","title":"...","detail":"...","suggestion":"...","sourceRef":"...","actionable":false,"toolName":null,"args":null}]}`;
}

function normalizeFindings(raw: unknown, signals: AuditSignals): AuditFinding[] {
  const obj = raw as { findings?: unknown };
  const arr = Array.isArray(obj?.findings) ? obj.findings : [];
  const out: AuditFinding[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const title = String(f.title ?? "").trim();
    if (!title) continue;

    const kind = VALID_KINDS.includes(String(f.kind) as (typeof VALID_KINDS)[number]) ? String(f.kind) : "eksik";
    const area = VALID_AREAS.includes(String(f.area) as (typeof VALID_AREAS)[number]) ? String(f.area) : "general";
    let severity = VALID_SEVERITIES.includes(String(f.severity) as (typeof VALID_SEVERITIES)[number]) ? String(f.severity) : "moyenne";

    let actionable = f.actionable === true;
    let toolName: string | null = null;
    let args: Record<string, unknown> | null = null;
    if (actionable) {
      const candidate = String(f.toolName ?? "");
      const tool = ALLOWED_TOOLS.includes(candidate as AllowedTool) ? getTool(candidate) : undefined;
      const rawArgs = (f.args && typeof f.args === "object") ? f.args as Record<string, unknown> : {};
      if (tool) {
        const parsed = validateArgs(tool.fields, rawArgs);
        if (parsed.ok) { toolName = candidate; args = parsed.data; }
        else { actionable = false; }
      } else {
        actionable = false;
      }
    }

    // Plancher de sévérité côté serveur: un constat sécurité avec des menaces
    // réelles ne peut pas être minimisé par le LLM.
    if (area === "securite" && signals.threatDocuments > 0 && (severity === "basse" || severity === "moyenne")) {
      severity = "haute";
    }

    // sourceRef stable même si le LLM l'omet, sinon la déduplication est
    // contournée (chaque run re-signalerait le même constat).
    const sourceRef = (String(f.sourceRef ?? "").trim()
      || `${kind}-${area}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`).slice(0, 120);

    out.push({
      kind,
      area,
      severity,
      title: title.slice(0, 200),
      detail: String(f.detail ?? "").slice(0, 2000),
      suggestion: String(f.suggestion ?? "").slice(0, 2000),
      sourceRef,
      actionable,
      toolName,
      args,
      metric: signals as unknown as Record<string, unknown>,
    });
    if (out.length >= MAX_FINDINGS_PER_RUN) break;
  }
  return out;
}

// ── Génération des constats ──────────────────────────────────────────────────

export interface AuditRunResult {
  runId: string;
  generated: number;
  inserted: number;
  proposalsCreated: number;
  skippedDuplicates: number;
}

export async function runAuditForOrg(orgId: number, runId?: string): Promise<AuditRunResult> {
  const finalRunId = runId ?? `manuel-${Date.now()}`;
  const signals = await gatherAuditSignals(orgId);
  if (!hasSignal(signals)) {
    return { runId: finalRunId, generated: 0, inserted: 0, proposalsCreated: 0, skippedDuplicates: 0 };
  }

  let findings: AuditFinding[];
  try {
    const raw = await aiGenerate(orgId, buildPrompt(signals));
    findings = normalizeFindings(safeJson<{ findings: unknown[] }>(raw, { findings: [] }), signals);
  } catch (err) {
    logger.error({ err, orgId }, "[AppAudit] Échec génération IA");
    throw err;
  }

  if (findings.length === 0) {
    return { runId: finalRunId, generated: 0, inserted: 0, proposalsCreated: 0, skippedDuplicates: 0 };
  }

  // Déduplication: ne pas re-signaler un constat encore actif (nouveau|vu) pour la même source.
  const refs = findings.map(f => f.sourceRef).filter(Boolean);
  const existing = refs.length > 0
    ? await db.select({ sourceRef: appAuditFindingsTable.sourceRef })
        .from(appAuditFindingsTable)
        .where(and(
          eq(appAuditFindingsTable.organisationId, orgId),
          inArray(appAuditFindingsTable.status, ["nouveau", "vu"]),
          inArray(appAuditFindingsTable.sourceRef, refs),
        ))
    : [];
  const existingRefs = new Set(existing.map(e => e.sourceRef));

  let inserted = 0;
  let skipped = 0;
  let proposalsCreated = 0;

  for (const f of findings) {
    if (f.sourceRef && existingRefs.has(f.sourceRef)) { skipped++; continue; }

    let linkedProposalId: number | null = null;
    if (f.actionable && f.toolName && f.args) {
      const proposalRef = `audit:${f.sourceRef || f.title.slice(0, 40)}`;
      const dup = await db.select({ id: agentProposalsTable.id })
        .from(agentProposalsTable)
        .where(and(
          eq(agentProposalsTable.organisationId, orgId),
          eq(agentProposalsTable.status, "en_attente"),
          eq(agentProposalsTable.sourceRef, proposalRef),
        ))
        .limit(1);
      if (dup.length === 0) {
        const [prop] = await db.insert(agentProposalsTable).values({
          organisationId: orgId,
          runId: finalRunId,
          toolName: f.toolName,
          title: f.title,
          summary: f.suggestion || f.detail,
          reason: `Constat d'audit (${f.area}): ${f.detail}`.slice(0, 1000),
          args: f.args,
          category: "autre",
          priority: f.severity === "critique" || f.severity === "haute" ? "haute" : "moyenne",
          confidence: 0,
          sourceType: "app_audit",
          sourceRef: proposalRef,
          status: "en_attente",
        }).returning({ id: agentProposalsTable.id });
        linkedProposalId = prop?.id ?? null;
        if (linkedProposalId) proposalsCreated++;
      } else {
        linkedProposalId = dup[0].id;
      }
    }

    await db.insert(appAuditFindingsTable).values({
      organisationId: orgId,
      runId: finalRunId,
      kind: f.kind,
      area: f.area,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      suggestion: f.suggestion,
      actionable: f.actionable && linkedProposalId !== null,
      linkedProposalId,
      sourceRef: f.sourceRef,
      status: "nouveau",
      metric: f.metric,
    });
    inserted++;
    if (f.sourceRef) existingRefs.add(f.sourceRef);
  }

  logger.info({ orgId, runId: finalRunId, generated: findings.length, inserted, proposalsCreated, skipped }, "[AppAudit] Constats générés");
  return { runId: finalRunId, generated: findings.length, inserted, proposalsCreated, skippedDuplicates: skipped };
}
