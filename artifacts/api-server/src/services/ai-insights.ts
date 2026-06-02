import {
  db,
  aiInsightsTable,
  organisationsTable,
  callsTable,
  tasksTable,
  facturesClientTable,
  contactsTable,
  projetsTable,
  prospectsTable,
} from "@workspace/db";
import { and, eq, gte, lte, sql, count, lt, isNull, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { assertAiQuota, AiQuotaExceededError, invalidateQuotaCache } from "./ai-quota";
import { extractGeminiTokens, recordAiUsage, safeJsonParse, GEMINI_FLASH_MODEL } from "./ai-utils";
import { buildAiCacheKey, getOrCompute, AI_CACHE_TTL, withProviderTimeout } from "./ai-cache";
import { buildLearnedContextBlock } from "./ai-learning";

interface RawSignals {
  overdueTasks: number;
  overdueInvoices: number;
  overdueInvoicesAmount: number;
  missedCallsToday: number;
  unrespondedCallsLastWeek: number;
  newProspectsThisWeek: number;
  idleProspects: number;
  projetsEnRetard: number;
  projetsActifs: number;
  contactsSansActiviteRecente: number;
}

async function gatherSignals(orgId: number): Promise<RawSignals> {
  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  const [
    overdueTasksRow,
    overdueInvoicesRow,
    missedCallsRow,
    unrespondedCallsRow,
    newProspectsRow,
    idleProspectsRow,
    projetsEnRetardRow,
    projetsActifsRow,
    contactsIdleRow,
  ] = await Promise.all([
    db.select({ c: count() }).from(tasksTable).where(and(
      eq(tasksTable.organisationId, orgId),
      sql`${tasksTable.dueDate} < ${now.toISOString()}`,
      or(eq(tasksTable.status, "en_attente"), eq(tasksTable.status, "en_cours")),
    )),
    db.select({ c: count(), s: sql<string>`COALESCE(SUM(${facturesClientTable.totalAmount}::numeric), 0)::text` }).from(facturesClientTable).where(and(
      eq(facturesClientTable.organisationId, orgId),
      sql`${facturesClientTable.dueDate} < ${now.toISOString()}`,
      sql`${facturesClientTable.status} in ('envoyee','en_attente','en_retard')`,
    )),
    db.select({ c: count() }).from(callsTable).where(and(
      eq(callsTable.organisationId, orgId),
      eq(callsTable.status, "manque"),
      gte(callsTable.createdAt, startToday),
      lte(callsTable.createdAt, endToday),
    )),
    db.select({ c: count() }).from(callsTable).where(and(
      eq(callsTable.organisationId, orgId),
      eq(callsTable.status, "manque"),
      gte(callsTable.createdAt, weekAgo),
    )),
    db.select({ c: count() }).from(prospectsTable).where(and(
      eq(prospectsTable.organisationId, orgId),
      gte(prospectsTable.createdAt, weekAgo),
    )),
    db.select({ c: count() }).from(prospectsTable).where(and(
      eq(prospectsTable.organisationId, orgId),
      lt(prospectsTable.updatedAt, weekAgo),
      sql`${prospectsTable.stage} not in ('gagne','perdu')`,
    )),
    db.select({ c: count() }).from(projetsTable).where(and(
      eq(projetsTable.organisationId, orgId),
      sql`${projetsTable.endDate} < ${now.toISOString()}`,
      sql`${projetsTable.status} not in ('termine','annule')`,
    )),
    db.select({ c: count() }).from(projetsTable).where(and(
      eq(projetsTable.organisationId, orgId),
      sql`${projetsTable.status} not in ('termine','annule')`,
    )),
    db.select({ c: count() }).from(contactsTable).where(and(
      eq(contactsTable.organisationId, orgId),
      or(isNull(contactsTable.lastCallAt), lt(contactsTable.lastCallAt, monthAgo)),
    )),
  ]);

  return {
    overdueTasks: Number(overdueTasksRow[0]?.c ?? 0),
    overdueInvoices: Number(overdueInvoicesRow[0]?.c ?? 0),
    overdueInvoicesAmount: Number(overdueInvoicesRow[0]?.s ?? 0),
    missedCallsToday: Number(missedCallsRow[0]?.c ?? 0),
    unrespondedCallsLastWeek: Number(unrespondedCallsRow[0]?.c ?? 0),
    newProspectsThisWeek: Number(newProspectsRow[0]?.c ?? 0),
    idleProspects: Number(idleProspectsRow[0]?.c ?? 0),
    projetsEnRetard: Number(projetsEnRetardRow[0]?.c ?? 0),
    projetsActifs: Number(projetsActifsRow[0]?.c ?? 0),
    contactsSansActiviteRecente: Number(contactsIdleRow[0]?.c ?? 0),
  };
}

export interface InsightDraft {
  category: "calls" | "tasks" | "finance" | "contacts" | "projets" | "prospects" | "general";
  severity: "info" | "warn" | "critical";
  title: string;
  message: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
}

function deterministicInsights(signals: RawSignals): InsightDraft[] {
  const out: InsightDraft[] = [];
  if (signals.overdueInvoices > 0) {
    out.push({
      category: "finance", severity: "critical",
      title: `${signals.overdueInvoices} facture${signals.overdueInvoices > 1 ? "s" : ""} en retard`,
      message: `Total a recouvrer: ${signals.overdueInvoicesAmount.toFixed(2)} EUR. Relances recommandees aujourd'hui.`,
      actionUrl: "/factures-clients?status=en_retard", actionLabel: "Voir les factures",
    });
  }
  if (signals.overdueTasks > 0) {
    out.push({
      category: "tasks", severity: signals.overdueTasks >= 5 ? "warn" : "info",
      title: `${signals.overdueTasks} tache${signals.overdueTasks > 1 ? "s" : ""} en retard`,
      message: `Pensez a reattribuer ou cloturer les taches dont l'echeance est depassee.`,
      actionUrl: "/taches?filter=retard", actionLabel: "Voir les taches",
    });
  }
  if (signals.missedCallsToday > 0) {
    out.push({
      category: "calls", severity: signals.missedCallsToday >= 3 ? "warn" : "info",
      title: `${signals.missedCallsToday} appel${signals.missedCallsToday > 1 ? "s" : ""} manque${signals.missedCallsToday > 1 ? "s" : ""} aujourd'hui`,
      message: `Rappelez ces contacts avant la fin de journee pour preserver la relation.`,
      actionUrl: "/appels?filter=manques", actionLabel: "Rappeler",
    });
  }
  if (signals.idleProspects >= 3) {
    out.push({
      category: "prospects", severity: "info",
      title: `${signals.idleProspects} prospects inactifs depuis 7+ jours`,
      message: `Reprenez contact pour eviter de perdre l'opportunite.`,
      actionUrl: "/prospects?filter=inactifs", actionLabel: "Voir les prospects",
    });
  }
  if (signals.projetsEnRetard > 0) {
    out.push({
      category: "projets", severity: signals.projetsEnRetard >= 2 ? "warn" : "info",
      title: `${signals.projetsEnRetard} projet${signals.projetsEnRetard > 1 ? "s" : ""} en retard`,
      message: `Echeance depassee — replanifiez ou ajustez les ressources.`,
      actionUrl: "/projets?filter=retard", actionLabel: "Voir les projets",
    });
  }
  if (signals.contactsSansActiviteRecente >= 10) {
    out.push({
      category: "contacts", severity: "info",
      title: `${signals.contactsSansActiviteRecente} contacts dormants`,
      message: `Aucune activite depuis 30+ jours. Une campagne de reactivation serait pertinente.`,
      actionUrl: "/contacts?filter=dormants", actionLabel: "Voir les contacts",
    });
  }
  if (signals.newProspectsThisWeek >= 3) {
    out.push({
      category: "prospects", severity: "info",
      title: `${signals.newProspectsThisWeek} nouveaux prospects cette semaine`,
      message: `Bonne dynamique commerciale — qualifiez-les rapidement.`,
      actionUrl: "/prospects", actionLabel: "Qualifier",
    });
  }
  return out;
}

// Generic productivity tips used to top up to a 3-item minimum on quiet days.
const GENERIC_TIPS: InsightDraft[] = [
  {
    category: "general", severity: "info",
    title: "Planifiez votre journee en 5 minutes",
    message: "Bloquez vos 3 priorites du jour dans le calendrier pour rester concentre.",
    actionUrl: "/calendrier", actionLabel: "Ouvrir le calendrier",
  },
  {
    category: "contacts", severity: "info",
    title: "Renforcez la relation client",
    message: "Prenez 10 min pour appeler un contact que vous n'avez pas joint depuis longtemps.",
    actionUrl: "/contacts", actionLabel: "Voir mes contacts",
  },
  {
    category: "tasks", severity: "info",
    title: "Cloturez 3 petites taches",
    message: "Terminer 3 micro-taches en debut de journee booste l'elan productif.",
    actionUrl: "/taches", actionLabel: "Voir mes taches",
  },
  {
    category: "general", severity: "info",
    title: "Sauvegardez vos donnees",
    message: "Verifiez que la derniere sauvegarde automatique est bien recente.",
    actionUrl: "/backups", actionLabel: "Voir les sauvegardes",
  },
  {
    category: "prospects", severity: "info",
    title: "Relancez un prospect qualifie",
    message: "Un suivi regulier multiplie les chances de conversion.",
    actionUrl: "/prospects", actionLabel: "Ouvrir prospects",
  },
];

const MIN_INSIGHTS = 3;
const MAX_INSIGHTS = 5;

function topUpToMinimum(drafts: InsightDraft[]): InsightDraft[] {
  const out = [...drafts];
  const usedCategories = new Set(out.map(d => d.category));
  for (const tip of GENERIC_TIPS) {
    if (out.length >= MIN_INSIGHTS) break;
    if (usedCategories.has(tip.category)) continue;
    out.push(tip);
    usedCategories.add(tip.category);
  }
  // If still short (very small org), allow duplicate categories from tips.
  for (const tip of GENERIC_TIPS) {
    if (out.length >= MIN_INSIGHTS) break;
    if (out.some(d => d.title === tip.title)) continue;
    out.push(tip);
  }
  return out.slice(0, MAX_INSIGHTS);
}

async function maybeEnrichWithAi(orgId: number, signals: RawSignals, drafts: InsightDraft[]): Promise<InsightDraft[]> {
  // If no signals worth mentioning, skip AI entirely.
  if (drafts.length === 0) return drafts;

  try {
    await assertAiQuota(orgId);
  } catch (e) {
    if (e instanceof AiQuotaExceededError) {
      logger.info({ orgId }, "[ai-insights] quota exceeded, returning deterministic insights only");
      return drafts;
    }
    throw e;
  }

  const cacheKey = buildAiCacheKey({
    route: "/internal/ai-insights",
    organisationId: orgId,
    input: { signals, draftsCount: drafts.length },
  });

  return getOrCompute<InsightDraft[]>(cacheKey, AI_CACHE_TTL.LONG, async () => {
    try {
      const { ai } = await import("@workspace/integrations-gemini-ai");
      const model = GEMINI_FLASH_MODEL;
      const t0 = Date.now();

      const prompt = `Tu es un assistant de bureau IA en francais. Voici les indicateurs du jour pour une organisation:
${JSON.stringify(signals, null, 2)}

Et voici les insights deterministes deja generes (en JSON):
${JSON.stringify(drafts, null, 2)}

Ta mission: ameliorer le titre et le message de chaque insight pour qu'ils soient courts (max 80 caracteres titre, max 140 caracteres message), bienveillants, professionnels, en francais correct. Ne change PAS les champs category, severity, actionUrl, actionLabel. Garde l'ordre.

Reponds UNIQUEMENT avec un tableau JSON de la meme structure que les drafts. Pas de texte avant/apres.${await buildLearnedContextBlock(orgId)}`;

      const response = await withProviderTimeout(() => ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }), { timeoutMs: 15_000, label: "gemini-insights" });

      const text = response.text ?? "";
      const tokens = extractGeminiTokens(response);
      recordAiUsage({
        organisationId: orgId, provider: "gemini", model,
        route: "/internal/ai-insights",
        inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0,
      }).catch(() => {});
      invalidateQuotaCache(orgId);

      const parsed = safeJsonParse<InsightDraft[]>(text, drafts);
      if (!Array.isArray(parsed) || parsed.length === 0) return drafts;

      return parsed.slice(0, drafts.length).map((p, i) => ({
        category: drafts[i].category,
        severity: drafts[i].severity,
        title: typeof p.title === "string" && p.title.length > 0 ? p.title.slice(0, 120) : drafts[i].title,
        message: typeof p.message === "string" && p.message.length > 0 ? p.message.slice(0, 240) : drafts[i].message,
        actionUrl: drafts[i].actionUrl,
        actionLabel: drafts[i].actionLabel,
      }));
    } catch (err) {
      logger.warn({ err, orgId }, "[ai-insights] AI enrich failed, using deterministic");
      return drafts;
    }
  });
}

export async function generateInsightsForOrg(orgId: number): Promise<number> {
  const signals = await gatherSignals(orgId);
  const rawDrafts = deterministicInsights(signals);
  const drafts = topUpToMinimum(rawDrafts);
  if (drafts.length === 0) return 0;

  const enriched = await maybeEnrichWithAi(orgId, signals, drafts);

  // Soft-replace: dismiss previous non-dismissed insights for this org so we don't accumulate
  await db.update(aiInsightsTable)
    .set({ dismissed: true })
    .where(and(eq(aiInsightsTable.organisationId, orgId), eq(aiInsightsTable.dismissed, false)));

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(aiInsightsTable).values(enriched.map(d => ({
    organisationId: orgId,
    category: d.category,
    severity: d.severity,
    title: d.title,
    message: d.message,
    actionUrl: d.actionUrl ?? null,
    actionLabel: d.actionLabel ?? null,
    expiresAt,
  })));

  logger.info({ orgId, count: enriched.length }, "[ai-insights] generated");
  return enriched.length;
}

let cronTimer: NodeJS.Timeout | null = null;
// Default: once per day. Override with AI_INSIGHTS_CRON_INTERVAL_MS for tests.
const CRON_INTERVAL_MS = Number(process.env.AI_INSIGHTS_CRON_INTERVAL_MS ?? 24 * 60 * 60 * 1000);

async function purgeOldInsights(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await db.delete(aiInsightsTable).where(
      or(
        sql`${aiInsightsTable.dismissed} = true and ${aiInsightsTable.generatedAt} < ${cutoff.toISOString()}`,
        sql`${aiInsightsTable.expiresAt} is not null and ${aiInsightsTable.expiresAt} < ${cutoff.toISOString()}`,
      )!,
    ).returning({ id: aiInsightsTable.id });
    if (deleted.length > 0) logger.info({ purged: deleted.length }, "[ai-insights] old rows purged");
  } catch (err) {
    logger.warn({ err }, "[ai-insights] purge failed");
  }
}

async function runCronCycle(): Promise<void> {
  try {
    await purgeOldInsights();
    const orgs = await db.select({ id: organisationsTable.id }).from(organisationsTable).where(eq(organisationsTable.actif, true));
    let total = 0;
    for (const o of orgs) {
      try {
        total += await generateInsightsForOrg(o.id);
      } catch (err) {
        logger.warn({ err, orgId: o.id }, "[ai-insights] org generation failed");
      }
    }
    logger.info({ orgsProcessed: orgs.length, totalInsights: total }, "[ai-insights] cron cycle complete");
  } catch (err) {
    logger.error({ err }, "[ai-insights] cron cycle error");
  }
}

export function startAiInsightsCron(): void {
  if (cronTimer) return;
  // Run once 60s after boot, then every interval.
  setTimeout(() => { runCronCycle().catch(() => {}); }, 60_000);
  cronTimer = setInterval(() => { runCronCycle().catch(() => {}); }, CRON_INTERVAL_MS);
  cronTimer.unref?.();
  logger.info({ intervalMs: CRON_INTERVAL_MS }, "[ai-insights] cron started");
}
