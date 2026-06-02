import { ai } from "@workspace/integrations-gemini-ai";
import { executeTool, getGeminiToolDeclarations, getTool, type ToolContext } from "./assistant-tools";
import { db } from "@workspace/db";
import { assistantMessagesTable, assistantConversationsTable } from "@workspace/db/schema";
import { eq, asc, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { assertAiQuota, AiQuotaExceededError, invalidateQuotaCache } from "./ai-quota";
import { extractGeminiTokens, recordAiUsage, GEMINI_PRO_MODEL } from "./ai-utils";
import { buildLearnedContextBlock } from "./ai-learning";

const MODEL = process.env.ASSISTANT_MODEL || GEMINI_PRO_MODEL;
const MAX_TOOL_HOPS = 6;

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
  const msgs = await db.select().from(assistantMessagesTable)
    .where(and(
      eq(assistantMessagesTable.conversationId, conversationId),
      eq(assistantMessagesTable.organisationId, orgId),
    ))
    .orderBy(asc(assistantMessagesTable.createdAt));
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
      organisationId: orgId, provider: "gemini", model: MODEL,
      route: "/assistant/chat",
      inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0,
    }).catch(() => {});
    invalidateQuotaCache(orgId);
  } catch { /* swallow usage tracking errors */ }
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
  const learnedBlock = await buildLearnedContextBlock(ctx.orgId);
  const systemInstruction = SYSTEM_INSTRUCTION + learnedBlock;
  let hops = 0;

  while (hops < MAX_TOOL_HOPS) {
    hops++;
    let response: GeminiResponse;
    const t0 = Date.now();
    try {
      const raw = await ai.models.generateContent({
        model: MODEL,
        contents: contents as unknown as Parameters<typeof ai.models.generateContent>[0]["contents"],
        config: {
          systemInstruction,
          // Gemini SDK's Tool type uses Schema for properties; our declarations
          // use plain JSON-Schema-style records, so we cast through unknown.
          tools: [getGeminiToolDeclarations()] as unknown as Parameters<typeof ai.models.generateContent>[0]["config"] extends infer C ? C extends { tools?: infer T } ? T : never : never,
        },
      });
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

    // Execute each call. If ANY requires confirmation, persist the call,
    // emit pending_action, and STOP the loop. Resume happens via /confirm.
    const responseParts: GeminiPart[] = [];
    for (const call of toolCallRows) {
      const tool = getTool(call.name);
      // Server-enforced confirmation gate (NOT just prompt-based)
      if (tool?.requiresConfirmation) {
        const summary = tool.summarize?.(call.args as never) ?? `Confirmer l'execution de ${call.name}`;
        emit({ type: "pending_action", messageId: call.id, toolName: call.name, toolArgs: call.args, summary });
        // Loop stops here — no further model call until /confirm fires
        return;
      }

      emit({ type: "step", toolName: call.name, toolArgs: call.args });
      const result = await executeTool(call.name, call.args, ctx);
      const payload: Record<string, unknown> = result.ok
        ? (result.result as Record<string, unknown>) ?? {}
        : { error: result.error ?? "Erreur" };
      emit({ type: "step", toolName: call.name, toolArgs: call.args, toolResult: payload });
      responseParts.push({ functionResponse: { name: call.name, response: payload } });
      await db.insert(assistantMessagesTable).values({
        conversationId, organisationId: ctx.orgId, role: "tool_result",
        toolName: call.name, toolArgs: call.args, toolResult: payload, content: "",
      });
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
