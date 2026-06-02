import {
  db,
  aiLearnedPreferencesTable,
  aiRecurringPatternsTable,
  proactiveSuggestionsTable,
  aiInsightsTable,
  agentProposalsTable,
  callsTable,
  tasksTable,
  organisationsTable,
} from "@workspace/db";
import { and, eq, sql, gte, isNotNull, desc, notInArray } from "drizzle-orm";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Couche d'apprentissage IA (pilier B)
//
// 100 % déterministe (aucun appel IA, aucun coût quota). On agrège:
//   - le feedback 👍/👎 des suggestions proactives (par type)
//   - les votes des insights (par catégorie)
// en "préférences apprises", et on mine des motifs récurrents (appelants,
// horaires d'appels, thèmes de tâches). Le tout est résumé en un bloc de
// contexte BORNÉ injecté dans les prompts IA (fail-soft).
// ---------------------------------------------------------------------------

const PATTERN_WINDOW_DAYS = 90;
const TOP_CALLERS = 5;
const TOP_HOURS = 3;
const TOP_THEMES = 5;
const CONTEXT_MAX_CHARS = 700;

// Cache mémoire court du bloc de contexte (évite de marteler la DB à chaque
// appel IA). Déterministe -> sûr de mettre en cache brièvement.
const CONTEXT_TTL_MS = 5 * 60 * 1000;
const contextCache = new Map<number, { text: string; expiresAt: number }>();
const CONTEXT_CACHE_MAX = 500;

function pruneContextCache(): void {
  if (contextCache.size <= CONTEXT_CACHE_MAX) return;
  const now = Date.now();
  for (const [k, v] of contextCache) {
    if (v.expiresAt <= now) contextCache.delete(k);
  }
  while (contextCache.size > CONTEXT_CACHE_MAX) {
    const first = contextCache.keys().next().value;
    if (first === undefined) break;
    contextCache.delete(first);
  }
}

function invalidateContextCache(orgId: number): void {
  contextCache.delete(orgId);
}

// --- Agrégation du feedback -> préférences apprises ------------------------

async function upsertPreference(
  orgId: number,
  kind: string,
  key: string,
  upCount: number,
  downCount: number,
): Promise<void> {
  const total = upCount + downCount;
  const score = total > 0 ? (upCount - downCount) / total : 0;
  await db
    .insert(aiLearnedPreferencesTable)
    .values({ organisationId: orgId, kind, key, upCount, downCount, score, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [
        aiLearnedPreferencesTable.organisationId,
        aiLearnedPreferencesTable.kind,
        aiLearnedPreferencesTable.key,
      ],
      set: { upCount, downCount, score, updatedAt: new Date() },
    });
}

// Clé composite (kind + séparateur + key) pour comparer les lignes conservées
// vs obsolètes. On utilise U+001F (unit separator): valide en texte Postgres
// (contrairement à U+0000/NUL qui y est interdit) et improbable dans les données.
const KEY_SEP = "\u001f";

// Recalcule TOUTES les préférences d'une org depuis les sources de feedback.
export async function recomputeLearnedPreferences(orgId: number): Promise<number> {
  let written = 0;
  const kept: string[] = [];

  // Suggestions proactives: feedback up/down groupé par type.
  const sugg = await db
    .select({
      key: proactiveSuggestionsTable.type,
      up: sql<number>`count(*) filter (where ${proactiveSuggestionsTable.feedback} = 'up')`,
      down: sql<number>`count(*) filter (where ${proactiveSuggestionsTable.feedback} = 'down')`,
    })
    .from(proactiveSuggestionsTable)
    .where(
      and(
        eq(proactiveSuggestionsTable.organisationId, orgId),
        isNotNull(proactiveSuggestionsTable.feedback),
      ),
    )
    .groupBy(proactiveSuggestionsTable.type);
  for (const row of sugg) {
    const up = Number(row.up ?? 0);
    const down = Number(row.down ?? 0);
    if (up + down === 0) continue;
    await upsertPreference(orgId, "suggestion_type", row.key, up, down);
    kept.push(`suggestion_type${KEY_SEP}${row.key}`);
    written++;
  }

  // Insights: vote +1 / -1 groupé par catégorie.
  const ins = await db
    .select({
      key: aiInsightsTable.category,
      up: sql<number>`count(*) filter (where ${aiInsightsTable.vote} > 0)`,
      down: sql<number>`count(*) filter (where ${aiInsightsTable.vote} < 0)`,
    })
    .from(aiInsightsTable)
    .where(and(eq(aiInsightsTable.organisationId, orgId), sql`${aiInsightsTable.vote} <> 0`))
    .groupBy(aiInsightsTable.category);
  for (const row of ins) {
    const up = Number(row.up ?? 0);
    const down = Number(row.down ?? 0);
    if (up + down === 0) continue;
    await upsertPreference(orgId, "insight_category", row.key, up, down);
    kept.push(`insight_category${KEY_SEP}${row.key}`);
    written++;
  }

  // Propositions de la file d'approbation: décisions du patron, groupées par
  // catégorie. Approuvée/exécutée = signal positif (up), rejetée = négatif (down).
  // C'est ainsi que les agents apprennent CE QUE le dirigeant valide ou refuse.
  const props = await db
    .select({
      key: agentProposalsTable.category,
      up: sql<number>`count(*) filter (where ${agentProposalsTable.status} in ('approuvee','executee'))`,
      down: sql<number>`count(*) filter (where ${agentProposalsTable.status} = 'rejetee')`,
    })
    .from(agentProposalsTable)
    .where(eq(agentProposalsTable.organisationId, orgId))
    .groupBy(agentProposalsTable.category);
  for (const row of props) {
    const up = Number(row.up ?? 0);
    const down = Number(row.down ?? 0);
    if (up + down === 0) continue;
    await upsertPreference(orgId, "proposition_categorie", row.key, up, down);
    kept.push(`proposition_categorie${KEY_SEP}${row.key}`);
    written++;
  }

  // Purge des préférences obsolètes (feedback retiré / source disparue) afin que
  // l'UI et le bloc de contexte ne reflètent que l'état courant.
  const keyExpr = sql`${aiLearnedPreferencesTable.kind} || ${KEY_SEP} || ${aiLearnedPreferencesTable.key}`;
  if (kept.length > 0) {
    await db
      .delete(aiLearnedPreferencesTable)
      .where(and(eq(aiLearnedPreferencesTable.organisationId, orgId), notInArray(keyExpr, kept)));
  } else {
    await db
      .delete(aiLearnedPreferencesTable)
      .where(eq(aiLearnedPreferencesTable.organisationId, orgId));
  }

  invalidateContextCache(orgId);
  return written;
}

// Mise à jour incrémentale "recompute-on-vote": recalcule uniquement la clé
// touchée. Fire-and-forget depuis les routes de feedback/vote.
export async function bumpPreferenceFromFeedback(
  orgId: number,
  kind: "suggestion_type" | "insight_category",
  key: string,
): Promise<void> {
  try {
    if (kind === "suggestion_type") {
      const [row] = await db
        .select({
          up: sql<number>`count(*) filter (where ${proactiveSuggestionsTable.feedback} = 'up')`,
          down: sql<number>`count(*) filter (where ${proactiveSuggestionsTable.feedback} = 'down')`,
        })
        .from(proactiveSuggestionsTable)
        .where(
          and(
            eq(proactiveSuggestionsTable.organisationId, orgId),
            eq(proactiveSuggestionsTable.type, key),
            isNotNull(proactiveSuggestionsTable.feedback),
          ),
        );
      await upsertPreference(orgId, kind, key, Number(row?.up ?? 0), Number(row?.down ?? 0));
    } else {
      const [row] = await db
        .select({
          up: sql<number>`count(*) filter (where ${aiInsightsTable.vote} > 0)`,
          down: sql<number>`count(*) filter (where ${aiInsightsTable.vote} < 0)`,
        })
        .from(aiInsightsTable)
        .where(
          and(
            eq(aiInsightsTable.organisationId, orgId),
            eq(aiInsightsTable.category, key),
            sql`${aiInsightsTable.vote} <> 0`,
          ),
        );
      await upsertPreference(orgId, kind, key, Number(row?.up ?? 0), Number(row?.down ?? 0));
    }
    invalidateContextCache(orgId);
  } catch (err) {
    logger.warn({ err, orgId, kind, key }, "[ai-learning] bumpPreferenceFromFeedback failed");
  }
}

// Mise à jour incrémentale après une décision sur une proposition de la file
// d'approbation (approbation/rejet). Recalcule la seule catégorie touchée depuis
// agent_proposals. Fire-and-forget, fail-soft (ne lève jamais).
export async function bumpProposalPreference(orgId: number, category: string | null | undefined): Promise<void> {
  try {
    const cat = (category ?? "").trim() || "autre";
    const [row] = await db
      .select({
        up: sql<number>`count(*) filter (where ${agentProposalsTable.status} in ('approuvee','executee'))`,
        down: sql<number>`count(*) filter (where ${agentProposalsTable.status} = 'rejetee')`,
      })
      .from(agentProposalsTable)
      .where(and(eq(agentProposalsTable.organisationId, orgId), eq(agentProposalsTable.category, cat)));
    await upsertPreference(orgId, "proposition_categorie", cat, Number(row?.up ?? 0), Number(row?.down ?? 0));
    invalidateContextCache(orgId);
  } catch (err) {
    logger.warn({ err, orgId, category }, "[ai-learning] bumpProposalPreference failed");
  }
}

// --- Minage des motifs récurrents -----------------------------------------

async function upsertPattern(
  orgId: number,
  patternType: string,
  label: string,
  value: string,
  occurrences: number,
  lastSeenAt: Date | null,
): Promise<void> {
  await db
    .insert(aiRecurringPatternsTable)
    .values({ organisationId: orgId, patternType, label, value, occurrences, lastSeenAt, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [
        aiRecurringPatternsTable.organisationId,
        aiRecurringPatternsTable.patternType,
        aiRecurringPatternsTable.value,
      ],
      set: { label, occurrences, lastSeenAt, updatedAt: new Date() },
    });
}

export async function mineRecurringPatterns(orgId: number): Promise<number> {
  const since = new Date(Date.now() - PATTERN_WINDOW_DAYS * 86400000);
  let written = 0;
  const kept: string[] = [];

  // Appelants fréquents (appels entrants, regroupés par contact/numéro).
  const callers = await db
    .select({
      label: sql<string>`coalesce(nullif(trim(${callsTable.contactName}), ''), ${callsTable.phoneNumber}, 'Inconnu')`,
      value: sql<string>`coalesce(nullif(${callsTable.phoneNumber}, ''), nullif(trim(${callsTable.contactName}), ''), 'inconnu')`,
      occ: sql<number>`count(*)`,
      last: sql<string>`max(${callsTable.createdAt})`,
    })
    .from(callsTable)
    .where(
      and(
        eq(callsTable.organisationId, orgId),
        eq(callsTable.direction, "entrant"),
        gte(callsTable.createdAt, since),
      ),
    )
    .groupBy(
      sql`coalesce(nullif(trim(${callsTable.contactName}), ''), ${callsTable.phoneNumber}, 'Inconnu')`,
      sql`coalesce(nullif(${callsTable.phoneNumber}, ''), nullif(trim(${callsTable.contactName}), ''), 'inconnu')`,
    )
    .orderBy(desc(sql`count(*)`))
    .limit(TOP_CALLERS);
  for (const c of callers) {
    const occ = Number(c.occ ?? 0);
    if (occ < 2) continue;
    await upsertPattern(orgId, "frequent_caller", c.label, c.value, occ, c.last ? new Date(c.last) : null);
    kept.push(`frequent_caller${KEY_SEP}${c.value}`);
    written++;
  }

  // Heures de pointe (histogramme par heure locale des appels).
  const hours = await db
    .select({
      hour: sql<number>`extract(hour from ${callsTable.createdAt})::int`,
      occ: sql<number>`count(*)`,
    })
    .from(callsTable)
    .where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, since)))
    .groupBy(sql`extract(hour from ${callsTable.createdAt})::int`)
    .orderBy(desc(sql`count(*)`))
    .limit(TOP_HOURS);
  for (const h of hours) {
    const occ = Number(h.occ ?? 0);
    const hr = Number(h.hour ?? 0);
    if (occ < 2) continue;
    await upsertPattern(orgId, "busy_hour", `${hr} h`, String(hr), occ, null);
    kept.push(`busy_hour${KEY_SEP}${String(hr)}`);
    written++;
  }

  // Thèmes de tâches récurrents (premier mot significatif du titre).
  const themes = await db
    .select({
      theme: sql<string>`lower(split_part(trim(${tasksTable.title}), ' ', 1))`,
      occ: sql<number>`count(*)`,
      last: sql<string>`max(${tasksTable.createdAt})`,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.organisationId, orgId), gte(tasksTable.createdAt, since)))
    .groupBy(sql`lower(split_part(trim(${tasksTable.title}), ' ', 1))`)
    .orderBy(desc(sql`count(*)`))
    .limit(TOP_THEMES + 5);
  let themeCount = 0;
  for (const t of themes) {
    const occ = Number(t.occ ?? 0);
    const theme = (t.theme ?? "").trim();
    if (occ < 3 || theme.length < 3) continue;
    await upsertPattern(orgId, "task_theme", theme, theme, occ, t.last ? new Date(t.last) : null);
    kept.push(`task_theme${KEY_SEP}${theme}`);
    written++;
    if (++themeCount >= TOP_THEMES) break;
  }

  // Purge des motifs obsolètes (hors fenêtre 90j / plus assez fréquents) pour
  // que seuls les motifs courants restent visibles et injectés.
  const patExpr = sql`${aiRecurringPatternsTable.patternType} || ${KEY_SEP} || ${aiRecurringPatternsTable.value}`;
  if (kept.length > 0) {
    await db
      .delete(aiRecurringPatternsTable)
      .where(and(eq(aiRecurringPatternsTable.organisationId, orgId), notInArray(patExpr, kept)));
  } else {
    await db
      .delete(aiRecurringPatternsTable)
      .where(eq(aiRecurringPatternsTable.organisationId, orgId));
  }

  invalidateContextCache(orgId);
  return written;
}

// --- Lecture: profil pour l'UI "Ce que l'IA a appris" ----------------------

export interface LearningProfile {
  preferences: Array<{ kind: string; key: string; upCount: number; downCount: number; score: number; updatedAt: string }>;
  patterns: Array<{ patternType: string; label: string; value: string; occurrences: number; lastSeenAt: string | null }>;
}

export async function getLearningProfile(orgId: number): Promise<LearningProfile> {
  const [prefs, pats] = await Promise.all([
    db
      .select()
      .from(aiLearnedPreferencesTable)
      .where(eq(aiLearnedPreferencesTable.organisationId, orgId))
      .orderBy(desc(aiLearnedPreferencesTable.score)),
    db
      .select()
      .from(aiRecurringPatternsTable)
      .where(eq(aiRecurringPatternsTable.organisationId, orgId))
      .orderBy(desc(aiRecurringPatternsTable.occurrences)),
  ]);
  return {
    preferences: prefs.map((p) => ({
      kind: p.kind,
      key: p.key,
      upCount: p.upCount,
      downCount: p.downCount,
      score: p.score,
      updatedAt: p.updatedAt.toISOString(),
    })),
    patterns: pats.map((p) => ({
      patternType: p.patternType,
      label: p.label,
      value: p.value,
      occurrences: p.occurrences,
      lastSeenAt: p.lastSeenAt ? p.lastSeenAt.toISOString() : null,
    })),
  };
}

// --- Injection: bloc de contexte borné (fail-soft) -------------------------

const SUGGESTION_LABELS: Record<string, string> = {
  overdue_task: "tâches en retard",
  missed_call_followup: "rappels d'appels manqués",
  calendar_conflict: "conflits d'agenda",
};

const PROPOSAL_LABELS: Record<string, string> = {
  tache: "les tâches",
  email: "les e-mails",
  sms: "les SMS",
  rappel: "les rappels",
  relance: "les relances",
  contact: "les contacts",
  autre: "les actions diverses",
};

function humanizeKey(kind: string, key: string): string {
  if (kind === "suggestion_type") return SUGGESTION_LABELS[key] ?? key;
  if (kind === "proposition_categorie") return PROPOSAL_LABELS[key] ?? key;
  return key;
}

async function computeContextBlock(orgId: number): Promise<string> {
  const profile = await getLearningProfile(orgId);
  const liked = profile.preferences.filter((p) => p.score >= 0.34 && p.upCount + p.downCount >= 2);
  const disliked = profile.preferences.filter((p) => p.score <= -0.34 && p.upCount + p.downCount >= 2);
  const callers = profile.patterns.filter((p) => p.patternType === "frequent_caller").slice(0, 3);
  const hours = profile.patterns.filter((p) => p.patternType === "busy_hour").slice(0, 3);
  const themes = profile.patterns.filter((p) => p.patternType === "task_theme").slice(0, 3);

  const lines: string[] = [];
  if (liked.length > 0) {
    lines.push(`- Privilégie ce qui concerne: ${liked.map((p) => humanizeKey(p.kind, p.key)).join(", ")}.`);
  }
  if (disliked.length > 0) {
    lines.push(`- Évite ou minimise: ${disliked.map((p) => humanizeKey(p.kind, p.key)).join(", ")}.`);
  }
  if (callers.length > 0) {
    lines.push(`- Interlocuteurs fréquents: ${callers.map((c) => `${c.label} (${c.occurrences}x)`).join(", ")}.`);
  }
  if (hours.length > 0) {
    lines.push(`- Heures d'activité d'appels les plus chargées: ${hours.map((h) => h.label).join(", ")}.`);
  }
  if (themes.length > 0) {
    lines.push(`- Thèmes de tâches récurrents: ${themes.map((t) => t.label).join(", ")}.`);
  }
  if (lines.length === 0) return "";

  let block = `\n\n[Mémoire de l'organisation — préférences apprises, à respecter]\n${lines.join("\n")}`;
  // Borne STRICTE: l'ellipse incluse, le bloc reste <= CONTEXT_MAX_CHARS.
  if (block.length > CONTEXT_MAX_CHARS) block = block.slice(0, CONTEXT_MAX_CHARS - 1) + "…";
  return block;
}

// Bloc de contexte injectable. NE LÈVE JAMAIS: renvoie "" en cas d'erreur ou si
// rien n'a été appris (fail-soft, quota-safe). Mis en cache 5 min.
export async function buildLearnedContextBlock(orgId: number | undefined | null): Promise<string> {
  if (!orgId || !Number.isFinite(orgId)) return "";
  try {
    const cached = contextCache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) return cached.text;
    const text = await computeContextBlock(orgId);
    pruneContextCache();
    contextCache.set(orgId, { text, expiresAt: Date.now() + CONTEXT_TTL_MS });
    return text;
  } catch (err) {
    logger.warn({ err, orgId }, "[ai-learning] buildLearnedContextBlock failed (fail-soft)");
    return "";
  }
}

// --- Cron quotidien --------------------------------------------------------

const LEARNING_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LEARNING_STARTUP_DELAY_MS = 90 * 1000;

async function runLearningForAllOrgs(): Promise<void> {
  try {
    const orgs = await db.select({ id: organisationsTable.id }).from(organisationsTable);
    for (const o of orgs) {
      try {
        await recomputeLearnedPreferences(o.id);
        await mineRecurringPatterns(o.id);
      } catch (err) {
        logger.warn({ err, orgId: o.id }, "[ai-learning] org cycle failed");
      }
    }
    logger.info({ orgs: orgs.length }, "[ai-learning] cycle terminé");
  } catch (err) {
    logger.error({ err }, "[ai-learning] cycle global échoué");
  }
}

export function startAiLearning(): void {
  setTimeout(() => {
    void runLearningForAllOrgs();
  }, LEARNING_STARTUP_DELAY_MS);
  setInterval(() => {
    void runLearningForAllOrgs();
  }, LEARNING_INTERVAL_MS);
  logger.info("[ai-learning] cron démarré");
}
