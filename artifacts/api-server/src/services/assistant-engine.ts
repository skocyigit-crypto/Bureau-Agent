import { ai } from "@workspace/integrations-gemini-ai";
import { callOrgGemini } from "./ai-providers";
import { executeTool, getGeminiToolDeclarations, getTool, type ToolContext } from "./assistant-tools";
import { db } from "@workspace/db";
import { assistantMessagesTable, assistantConversationsTable } from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { assertAiQuota, AiQuotaExceededError, invalidateQuotaCache } from "./ai-quota";
import { extractGeminiTokens, recordAiUsage, geminiActualModel, GEMINI_PRO_MODEL } from "./ai-utils";
import { buildLearnedContextBlock } from "./ai-learning";

const MODEL = process.env.ASSISTANT_MODEL || GEMINI_PRO_MODEL;
const MAX_TOOL_HOPS = 6;
// Rappel d'historique borne: on ne reinjecte que les N derniers messages d'une
// conversation pour limiter le cout en tokens et la latence sur les longs fils,
// tout en gardant un contexte coherent (cf. loadHistoryForGemini).
const HISTORY_MAX_MESSAGES = Math.max(10, Number(process.env.ASSISTANT_HISTORY_MAX_MESSAGES ?? 80));

export type StreamEvent =
  | { type: "step"; toolName: string; toolArgs?: unknown; toolResult?: unknown }
  | { type: "text"; text: string }
  | { type: "pending_action"; messageId: number; toolName: string; toolArgs: unknown; summary: string }
  | { type: "done" }
  | { type: "error"; error: string };

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent { role: "user" | "model" | "function"; parts: GeminiPart[]; }
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

const SYSTEM_INSTRUCTION = `Tu es l'assistant operationnel d'Agent de Bureau, un CRM/SaaS francais.
Tu reponds TOUJOURS en francais, ton professionnel mais chaleureux.
Tu peux EXECUTER des actions concretes via les outils disponibles (creer contact, tache, prospect, evenement; envoyer email/SMS; lister donnees; generer image; etc.).
IMPORTANT:
- Pour les outils marques "NECESSITE UNE CONFIRMATION" (envoi e-mail/SMS), le systeme demandera automatiquement la confirmation a l'utilisateur. Annonce ton intention en une phrase claire AVANT d'appeler l'outil.
- Pour les recherches d'information, utilise un outil 'list_*' au lieu d'inventer.
- Pour les dates, prefere ISO 8601 (utilise get_current_datetime au besoin).
- Apres chaque action reussie, donne un resume clair avec les liens si retournes.
- Si une action echoue, explique pourquoi en 1 phrase et propose une alternative.`;

async function loadHistoryForGemini(conversationId: number, orgId: number): Promise<GeminiContent[]> {
  // On charge les N derniers messages (desc + limit) puis on remet l'ordre
  // chronologique. Borne le cout en tokens / la latence sur les longs fils.
  const recent = await db.select().from(assistantMessagesTable)
    .where(and(
      eq(assistantMessagesTable.conversationId, conversationId),
      eq(assistantMessagesTable.organisationId, orgId),
    ))
    .orderBy(desc(assistantMessagesTable.createdAt))
    .limit(HISTORY_MAX_MESSAGES);
  recent.reverse();
  // Si la fenetre debute au milieu d'un echange d'outils, on retire les entrees
  // d'outils en tete pour ne JAMAIS commencer par une `functionResponse`
  // orpheline (Gemini rejette un function part sans son functionCall precedent).
  let startIdx = 0;
  while (startIdx < recent.length && !(recent[startIdx]!.role === "user" || recent[startIdx]!.role === "assistant")) {
    startIdx++;
  }
  const msgs = recent.slice(startIdx);
  const out: GeminiContent[] = [];
  for (const m of msgs) {
    if (m.role === "user") {
      out.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      out.push({ role: "model", parts: [{ text: m.content }] });
    } else if (m.role === "tool_call" && m.toolName) {
      out.push({ role: "model", parts: [{ functionCall: { name: m.toolName, args: (m.toolArgs as Record<string, unknown>) ?? {} } }] });
    } else if ((m.role === "tool_result" || m.role === "tool_pending_resolved") && m.toolName) {
      out.push({ role: "function", parts: [{ functionResponse: { name: m.toolName, response: (m.toolResult as Record<string, unknown>) ?? {} } }] });
    }
  }
  return out;
}

function recordUsage(orgId: number, response: GeminiResponse, t0: number): void {
  try {
    const tokens = extractGeminiTokens(response);
    recordAiUsage({
      organisationId: orgId, provider: "gemini", model: geminiActualModel(response, MODEL),
      route: "/assistant/chat",
      inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0,
    }).catch(() => {});
    invalidateQuotaCache(orgId);
  } catch { /* swallow usage tracking errors */ }
}

/** Sérialisation déterministe (clés triées) pour bâtir une clé de cache stable
 *  insensible à l'ordre des propriétés des arguments d'outil. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Clé de cache d'une lecture: nom de l'outil + arguments normalisés. */
function readCacheKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${stableStringify(args)}`;
}

/** Détecte un jeu de résultats vide pour les outils de listing/recherche qui
 *  exposent un champ `count`. Sert à déclencher le conseil d'auto-correction. */
function isEmptyReadResult(payload: Record<string, unknown>): boolean {
  return typeof payload.count === "number" && payload.count === 0;
}

interface RunOptions {
  /** When resuming after a confirmed/rejected pending action, the engine
   *  skips the user-message persistence step (the user message already exists). */
  resumeOnly?: boolean;
}

export async function runAssistantTurn(
  conversationId: number,
  userMessage: string,
  ctx: ToolContext,
  emit: (e: StreamEvent) => void,
  opts: RunOptions = {},
): Promise<void> {
  if (!opts.resumeOnly) {
    await db.insert(assistantMessagesTable).values({
      conversationId, organisationId: ctx.orgId, role: "user", content: userMessage,
    });
    await db.update(assistantConversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(assistantConversationsTable.id, conversationId));
  }

  // Quota check up front
  try {
    await assertAiQuota(ctx.orgId);
  } catch (e) {
    if (e instanceof AiQuotaExceededError) {
      emit({ type: "error", error: "Quota IA depasse pour cette organisation." });
      return;
    }
    throw e;
  }

  const contents = await loadHistoryForGemini(conversationId, ctx.orgId);
  // Pilier B: mémoire de l'organisation injectée dans l'instruction système (fail-soft).
  const learnedBlock = await buildLearnedContextBlock(ctx.orgId, ctx.userId);
  const systemInstruction = SYSTEM_INSTRUCTION + learnedBlock;
  let hops = 0;

  // État borné à CE tour uniquement:
  //  - readResultCache: réutilise le résultat d'une lecture identique (même
  //    outil + mêmes arguments) au lieu de la relancer. JAMAIS d'écritures.
  //  - selfCorrectionHinted: garde anti-boucle — un conseil d'auto-correction
  //    n'est ajouté qu'UNE fois par (outil + arguments).
  const readResultCache = new Map<string, Record<string, unknown>>();
  const selfCorrectionHinted = new Set<string>();

  while (hops < MAX_TOOL_HOPS) {
    hops++;
    let response: GeminiResponse;
    const t0 = Date.now();
    try {
      // Client Gemini per-org (BYOK) : cle de l'org si configuree, repli
      // plateforme automatique si la cle org est absente OU invalide a l'exec.
      const raw = await callOrgGemini(ctx.orgId, (client) => client.models.generateContent({
        model: MODEL,
        contents: contents as unknown as Parameters<typeof ai.models.generateContent>[0]["contents"],
        config: {
          systemInstruction,
          // Gemini SDK's Tool type uses Schema for properties; our declarations
          // use plain JSON-Schema-style records, so we cast through unknown.
          tools: [getGeminiToolDeclarations()] as unknown as Parameters<typeof ai.models.generateContent>[0]["config"] extends infer C ? C extends { tools?: infer T } ? T : never : never,
        },
      }));
      response = raw as unknown as GeminiResponse;
    } catch (err) {
      logger.error({ err, conversationId }, "[assistant] generateContent failed");
      const msg = err instanceof Error ? err.message : "Erreur du modele IA.";
      emit({ type: "error", error: msg });
      return;
    }
    recordUsage(ctx.orgId, response, t0);

    const candidate = response.candidates?.[0];
    const parts: GeminiPart[] = candidate?.content?.parts ?? [];
    const fnCalls = parts.filter((p): p is GeminiPart & { functionCall: NonNullable<GeminiPart["functionCall"]> } => Boolean(p.functionCall));
    const textParts = parts.filter(p => typeof p.text === "string" && p.text.length > 0);

    // Final text response (no tool calls) -> persist + emit + done
    if (fnCalls.length === 0) {
      const finalText = textParts.map(p => p.text!).join("\n").trim() || "(reponse vide)";
      emit({ type: "text", text: finalText });
      await db.insert(assistantMessagesTable).values({
        conversationId, organisationId: ctx.orgId, role: "assistant", content: finalText,
      });
      emit({ type: "done" });
      return;
    }

    // Append model's function-call message to in-memory history
    contents.push({ role: "model", parts });

    // Persist each tool_call (we'll persist results below)
    const toolCallRows: Array<{ id: number; name: string; args: Record<string, unknown> }> = [];
    for (const fc of fnCalls) {
      const args = fc.functionCall.args ?? {};
      const [row] = await db.insert(assistantMessagesTable).values({
        conversationId, organisationId: ctx.orgId, role: "tool_call",
        toolName: fc.functionCall.name, toolArgs: args, content: "",
      }).returning({ id: assistantMessagesTable.id });
      toolCallRows.push({ id: row.id, name: fc.functionCall.name, args });
    }

    // Le 1er outil exigeant une confirmation borne l'exécution de ce hop:
    // tout outil de lecture AVANT lui s'exécute, puis on émet pending_action et
    // on STOP (la reprise se fait via /confirm). Conserve la sémantique
    // séquentielle d'avant: les lectures situées APRÈS un outil de confirmation
    // ne sont pas exécutées ce hop.
    const firstConfirmIdx = toolCallRows.findIndex(c => getTool(c.name)?.requiresConfirmation);
    const readCalls = firstConfirmIdx === -1 ? toolCallRows : toolCallRows.slice(0, firstConfirmIdx);

    // Exécution PARALLÈLE des lectures de ce hop. Les `step` de début sont émis
    // dans l'ordre, puis chaque lecture est servie depuis le cache du tour si
    // disponible (même outil + mêmes arguments), sinon exécutée.
    const executed = await Promise.all(readCalls.map(async (call) => {
      emit({ type: "step", toolName: call.name, toolArgs: call.args });
      const key = readCacheKey(call.name, call.args);
      let basePayload = readResultCache.get(key);
      if (!basePayload) {
        const result = await executeTool(call.name, call.args, ctx);
        basePayload = result.ok
          ? (result.result as Record<string, unknown>) ?? {}
          : { error: result.error ?? "Erreur" };
        readResultCache.set(key, basePayload);
      }
      // Auto-correction: sur erreur ou résultat vide, on glisse UN conseil dans
      // le functionResponse pour que le modèle réessaie une fois avec des
      // paramètres ajustés (ou annonce qu'il n'a rien trouvé). Borné à une fois
      // par (outil + arguments) et, globalement, par le budget de hops.
      let payload = basePayload;
      const isError = "error" in basePayload;
      if ((isError || isEmptyReadResult(basePayload)) && !selfCorrectionHinted.has(key)) {
        selfCorrectionHinted.add(key);
        payload = {
          ...basePayload,
          _conseil: isError
            ? "Cet appel a echoue. Corrige les parametres et reessaie UNE seule fois; sinon explique l'echec en une phrase. N'invente pas de donnees."
            : "Aucun resultat. Reessaie UNE seule fois avec des parametres ajustes (orthographe, filtre plus large, autre periode); sinon indique clairement qu'aucun resultat n'a ete trouve. N'invente pas de donnees.",
        };
      }
      return { call, payload };
    }));

    // Émission des résultats + persistance dans l'ordre d'origine.
    const responseParts: GeminiPart[] = [];
    for (const { call, payload } of executed) {
      emit({ type: "step", toolName: call.name, toolArgs: call.args, toolResult: payload });
      responseParts.push({ functionResponse: { name: call.name, response: payload } });
      await db.insert(assistantMessagesTable).values({
        conversationId, organisationId: ctx.orgId, role: "tool_result",
        toolName: call.name, toolArgs: call.args, toolResult: payload, content: "",
      });
    }

    // Outil de confirmation présent: on s'arrête ici APRÈS avoir persisté les
    // lectures préalables. Le gate de confirmation reste côté serveur.
    if (firstConfirmIdx !== -1) {
      const call = toolCallRows[firstConfirmIdx]!;
      const tool = getTool(call.name);
      const summary = tool?.summarize?.(call.args as never) ?? `Confirmer l'execution de ${call.name}`;
      emit({ type: "pending_action", messageId: call.id, toolName: call.name, toolArgs: call.args, summary });
      // Loop stops here — no further model call until /confirm fires
      return;
    }

    contents.push({ role: "function", parts: responseParts });
  }

  // Hop budget exhausted — persisted tool_results may already have side effects
  const fallback = "J'ai effectue plusieurs etapes et certaines actions ont peut-etre deja ete enregistrees. Pourriez-vous reformuler ou preciser la prochaine etape ?";
  emit({ type: "text", text: fallback });
  await db.insert(assistantMessagesTable).values({
    conversationId, organisationId: ctx.orgId, role: "assistant", content: fallback,
  });
  emit({ type: "done" });
}

/** Resume a paused conversation after the user approves or rejects a pending tool call. */
export async function resolvePendingAction(
  conversationId: number,
  toolCallMessageId: number,
  decision: "approve" | "reject",
  ctx: ToolContext,
  emit: (e: StreamEvent) => void,
): Promise<void> {
  // Load and validate the pending tool_call row
  const [callRow] = await db.select().from(assistantMessagesTable).where(and(
    eq(assistantMessagesTable.id, toolCallMessageId),
    eq(assistantMessagesTable.conversationId, conversationId),
    eq(assistantMessagesTable.organisationId, ctx.orgId),
    eq(assistantMessagesTable.role, "tool_call"),
  ));
  if (!callRow || !callRow.toolName) {
    emit({ type: "error", error: "Action introuvable ou deja resolue." });
    return;
  }

  // Make sure no result has been persisted for this exact call already
  const existing = await db.select({ id: assistantMessagesTable.id }).from(assistantMessagesTable).where(and(
    eq(assistantMessagesTable.conversationId, conversationId),
    eq(assistantMessagesTable.organisationId, ctx.orgId),
    eq(assistantMessagesTable.toolName, callRow.toolName),
    eq(assistantMessagesTable.role, "tool_pending_resolved"),
  )).limit(1);
  if (existing.length > 0) {
    emit({ type: "error", error: "Cette action a deja ete traitee." });
    return;
  }

  const args = (callRow.toolArgs as Record<string, unknown>) ?? {};
  let payload: Record<string, unknown>;

  if (decision === "approve") {
    emit({ type: "step", toolName: callRow.toolName, toolArgs: args });
    const result = await executeTool(callRow.toolName, args, ctx, { skipConfirmation: true });
    payload = result.ok
      ? (result.result as Record<string, unknown>) ?? { success: true }
      : { error: result.error ?? "Erreur" };
    emit({ type: "step", toolName: callRow.toolName, toolArgs: args, toolResult: payload });
  } else {
    payload = { cancelled: true, reason: "Annule par l'utilisateur." };
    emit({ type: "step", toolName: callRow.toolName, toolArgs: args, toolResult: payload });
  }

  await db.insert(assistantMessagesTable).values({
    conversationId, organisationId: ctx.orgId, role: "tool_pending_resolved",
    toolName: callRow.toolName, toolArgs: args, toolResult: payload, content: "",
  });
  await db.update(assistantConversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(assistantConversationsTable.id, conversationId));

  // Resume the assistant turn so the model can summarize the outcome
  await runAssistantTurn(conversationId, "", ctx, emit, { resumeOnly: true });
}
