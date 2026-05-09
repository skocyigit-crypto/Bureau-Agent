import { ai } from "@workspace/integrations-gemini-ai";
import { executeTool, getGeminiToolDeclarations, type ToolContext } from "./assistant-tools";
import { db } from "@workspace/db";
import { assistantMessagesTable, assistantConversationsTable } from "@workspace/db/schema";
import { eq, asc, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { assertAiQuota, AiQuotaExceededError, invalidateQuotaCache } from "./ai-quota";
import { extractGeminiTokens, recordAiUsage } from "./ai-utils";

const MODEL = process.env.ASSISTANT_MODEL || "gemini-2.5-pro";
const MAX_TOOL_HOPS = 6;

export interface StreamEvent {
  type: "step" | "text" | "done" | "error";
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  text?: string;
  error?: string;
}

const SYSTEM_INSTRUCTION = `Tu es l'assistant operationnel d'Agent de Bureau, un CRM/SaaS francais.
Tu reponds TOUJOURS en francais, ton professionnel mais chaleureux.
Tu peux EXECUTER des actions concretes via les outils disponibles (creer contact, tache, prospect, evenement; envoyer email/SMS; lister donnees; generer image; etc.).
Regles:
- Avant toute action destructive ou envoi externe (email, SMS), confirme brievement ce que tu vas faire en une phrase.
- Quand l'utilisateur demande une info, utilise un outil 'list_*' au lieu d'inventer.
- Pour les dates, prefere ISO 8601. Si l'utilisateur dit "demain 14h", convertis-le.
- Apres chaque action reussie, donne un resume clair avec les liens si retournes.
- Si une action echoue, explique pourquoi en 1 phrase et propose une alternative.`;

interface GeminiPart { text?: string; functionCall?: { name: string; args: any }; functionResponse?: { name: string; response: any }; }
interface GeminiContent { role: "user" | "model" | "function"; parts: GeminiPart[]; }

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
      out.push({ role: "model", parts: [{ functionCall: { name: m.toolName, args: m.toolArgs ?? {} } }] });
    } else if (m.role === "tool_result" && m.toolName) {
      out.push({ role: "function", parts: [{ functionResponse: { name: m.toolName, response: m.toolResult ?? {} } }] });
    }
  }
  return out;
}

export async function runAssistantTurn(
  conversationId: number,
  userMessage: string,
  ctx: ToolContext,
  emit: (e: StreamEvent) => void,
): Promise<void> {
  // Persist user message
  await db.insert(assistantMessagesTable).values({
    conversationId, organisationId: ctx.orgId, role: "user", content: userMessage,
  });
  await db.update(assistantConversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(assistantConversationsTable.id, conversationId));

  // Quota check up front (avoid expensive loop if org is over budget)
  try {
    await assertAiQuota(ctx.orgId);
  } catch (e) {
    if (e instanceof AiQuotaExceededError) {
      emit({ type: "error", error: "Quota IA depasse pour cette organisation." });
      return;
    }
    throw e;
  }

  // Build history
  const contents = await loadHistoryForGemini(conversationId, ctx.orgId);

  let hops = 0;
  let finalText = "";

  while (hops < MAX_TOOL_HOPS) {
    hops++;
    let response;
    const t0 = Date.now();
    try {
      response = await ai.models.generateContent({
        model: MODEL,
        contents: contents as any,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [getGeminiToolDeclarations()] as any,
        },
      });
    } catch (err: any) {
      logger.error({ err, conversationId }, "[assistant] generateContent failed");
      emit({ type: "error", error: err?.message ?? "Erreur du modele IA." });
      return;
    }

    // Record usage for billing/quota tracking
    try {
      const tokens = extractGeminiTokens(response);
      recordAiUsage({
        organisationId: ctx.orgId, provider: "gemini", model: MODEL,
        route: "/assistant/chat",
        inputTokens: tokens.input, outputTokens: tokens.output, durationMs: Date.now() - t0,
      }).catch(() => {});
      invalidateQuotaCache(ctx.orgId);
    } catch {}

    const candidate = response.candidates?.[0];
    const parts: GeminiPart[] = (candidate?.content?.parts as any) ?? [];
    const fnCalls = parts.filter(p => p.functionCall);
    const textParts = parts.filter(p => typeof p.text === "string" && p.text.length > 0);

    // If model returned text + no function call -> final answer
    if (fnCalls.length === 0) {
      finalText = textParts.map(p => p.text).join("\n").trim() || "(reponse vide)";
      emit({ type: "text", text: finalText });
      await db.insert(assistantMessagesTable).values({
        conversationId, organisationId: ctx.orgId, role: "assistant", content: finalText,
      });
      emit({ type: "done" });
      return;
    }

    // Append the model's function-call message to history
    contents.push({ role: "model", parts: parts as any });
    // Persist as tool_call rows
    for (const fc of fnCalls) {
      const fcall = fc.functionCall!;
      await db.insert(assistantMessagesTable).values({
        conversationId, organisationId: ctx.orgId, role: "tool_call",
        toolName: fcall.name, toolArgs: fcall.args ?? {}, content: "",
      });
    }

    // Execute each tool call
    const responseParts: GeminiPart[] = [];
    for (const fc of fnCalls) {
      const fcall = fc.functionCall!;
      emit({ type: "step", toolName: fcall.name, toolArgs: fcall.args });
      const result = await executeTool(fcall.name, fcall.args, ctx);
      const payload = result.ok ? result.result : { error: result.error };
      emit({ type: "step", toolName: fcall.name, toolArgs: fcall.args, toolResult: payload });
      responseParts.push({ functionResponse: { name: fcall.name, response: payload as any } });
      await db.insert(assistantMessagesTable).values({
        conversationId, organisationId: ctx.orgId, role: "tool_result",
        toolName: fcall.name, toolArgs: fcall.args ?? {}, toolResult: payload as any, content: "",
      });
    }
    contents.push({ role: "function", parts: responseParts });
  }

  // Hop budget exhausted
  const fallback = "J'ai effectue plusieurs etapes mais je n'ai pas pu finaliser. Pourriez-vous reformuler ?";
  emit({ type: "text", text: fallback });
  await db.insert(assistantMessagesTable).values({
    conversationId, organisationId: ctx.orgId, role: "assistant", content: fallback,
  });
  emit({ type: "done" });
}
