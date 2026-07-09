// Boite de reception WhatsApp cote CLIENT (modele "brouillon -> validation
// humaine"). A la difference de l'assistant WhatsApp du personnel
// (routes/whatsapp.ts), ce service capture les messages des CLIENTS de
// l'organisation (numeros non lies a un utilisateur), les stocke dans un fil
// de conversation, et prepare une reponse SUGGEREE par l'IA — sans jamais
// l'envoyer automatiquement. Un membre relit, edite si besoin, puis approuve
// l'envoi depuis l'app web.

import { and, eq, sql, asc } from "drizzle-orm";
import {
  db,
  whatsappConversationsTable,
  whatsappMessagesTable,
  organisationsTable,
} from "@workspace/db";
import { broadcaster } from "./broadcaster";
import { assertAiQuota, invalidateQuotaCache } from "./ai-quota";
import {
  recordAiUsage,
  extractGeminiTokens,
  geminiActualModel,
  GEMINI_FLASH_MODEL,
  sanitizePromptInput,
} from "./ai-utils";
import { logger } from "../lib/logger";

const PREVIEW_MAX = 160;
const DRAFT_HISTORY_TURNS = 15;
const DRAFT_MSG_MAX = 800;
const DRAFT_MAX_OUTPUT = 600;

function preview(text: string | null | undefined): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  return s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) + "…" : s;
}

export interface InboundCustomerMessage {
  orgId: number;
  providerId: number | null;
  fromPhone: string;
  customerName?: string | null;
  body: string | null;
  mediaUrls?: string[];
  providerMessageSid?: string | null;
}

/**
 * Stocke un message entrant d'un client (upsert du fil + insertion du message),
 * incremente le compteur non-lu, et diffuse l'evenement SSE. Renvoie l'id de la
 * conversation, ou null en cas d'echec (le webhook reste fail-soft).
 */
export async function recordInboundCustomerMessage(
  input: InboundCustomerMessage,
): Promise<number | null> {
  try {
    const previewText = preview(
      input.body || (input.mediaUrls && input.mediaUrls.length > 0 ? "[pièce jointe]" : ""),
    );
    const now = new Date();

    // Upsert du fil par (organisation, numero client).
    const [conv] = await db
      .insert(whatsappConversationsTable)
      .values({
        organisationId: input.orgId,
        providerId: input.providerId,
        customerPhone: input.fromPhone,
        customerName: input.customerName ?? null,
        status: "open",
        unreadCount: 1,
        lastMessageAt: now,
        lastMessagePreview: previewText,
        lastDirection: "inbound",
      })
      .onConflictDoUpdate({
        target: [
          whatsappConversationsTable.organisationId,
          whatsappConversationsTable.customerPhone,
        ],
        set: {
          unreadCount: sql`${whatsappConversationsTable.unreadCount} + 1`,
          lastMessageAt: now,
          lastMessagePreview: previewText,
          lastDirection: "inbound",
          status: "open",
          updatedAt: now,
          // Conserve un nom existant; ne l'ecrase pas avec null.
          customerName: sql`coalesce(${whatsappConversationsTable.customerName}, ${input.customerName ?? null})`,
          providerId: sql`coalesce(${whatsappConversationsTable.providerId}, ${input.providerId})`,
        },
      })
      .returning({ id: whatsappConversationsTable.id });

    if (!conv) return null;

    await db.insert(whatsappMessagesTable).values({
      organisationId: input.orgId,
      conversationId: conv.id,
      direction: "inbound",
      body: input.body,
      mediaUrls: input.mediaUrls ?? [],
      providerMessageSid: input.providerMessageSid ?? null,
      status: "received",
    });

    broadcaster.broadcast(input.orgId, {
      type: "whatsapp",
      action: "created",
      resourceId: conv.id,
    });

    return conv.id;
  } catch (err) {
    logger.error({ err, orgId: input.orgId }, "[whatsapp-inbox] echec enregistrement message entrant");
    return null;
  }
}

/**
 * Prepare une reponse SUGGEREE par l'IA pour la conversation, en arriere-plan.
 * Ne bloque jamais l'appelant (webhook ou route). Met a jour draftStatus
 * (generating -> ready/failed) et diffuse l'evenement SSE a chaque transition.
 * Respecte le quota IA de l'organisation; en cas de quota epuise ou d'erreur,
 * marque le brouillon "failed" (le membre peut toujours repondre manuellement).
 */
export async function generateDraftInBackground(conversationId: number, orgId: number): Promise<void> {
  const emit = () =>
    broadcaster.broadcast(orgId, { type: "whatsapp", action: "updated", resourceId: conversationId });

  try {
    await db
      .update(whatsappConversationsTable)
      .set({ draftStatus: "generating", draftError: null })
      .where(
        and(
          eq(whatsappConversationsTable.id, conversationId),
          eq(whatsappConversationsTable.organisationId, orgId),
        ),
      );
    emit();

    const [conv] = await db
      .select()
      .from(whatsappConversationsTable)
      .where(
        and(
          eq(whatsappConversationsTable.id, conversationId),
          eq(whatsappConversationsTable.organisationId, orgId),
        ),
      );
    if (!conv) return;

    try {
      await assertAiQuota(orgId);
    } catch {
      await db
        .update(whatsappConversationsTable)
        .set({ draftStatus: "failed", draftError: "Quota IA atteint. Répondez manuellement ou réessayez plus tard." })
        .where(
          and(
            eq(whatsappConversationsTable.id, conversationId),
            eq(whatsappConversationsTable.organisationId, orgId),
          ),
        );
      emit();
      return;
    }

    const messages = await db
      .select({
        direction: whatsappMessagesTable.direction,
        body: whatsappMessagesTable.body,
      })
      .from(whatsappMessagesTable)
      .where(
        and(
          eq(whatsappMessagesTable.conversationId, conversationId),
          eq(whatsappMessagesTable.organisationId, orgId),
        ),
      )
      .orderBy(asc(whatsappMessagesTable.createdAt));

    const recent = messages.slice(-DRAFT_HISTORY_TURNS);
    const transcript = recent
      .map((m) => {
        const who = m.direction === "inbound" ? "Client" : "Nous";
        const text = m.body ? sanitizePromptInput(m.body, DRAFT_MSG_MAX) : "[pièce jointe]";
        return `${who}: ${text}`;
      })
      .join("\n");

    const [org] = await db
      .select({ name: organisationsTable.name, aiAgentName: organisationsTable.aiAgentName })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, orgId));
    const agentName = org?.aiAgentName || "l'assistant du bureau";
    const businessName = org?.name || "notre bureau";

    const prompt = `Tu es ${agentName}, l'assistant d'un bureau professionnel ("${businessName}").
Un CLIENT a écrit sur WhatsApp. Prépare UNE réponse professionnelle, chaleureuse et concise
que le bureau pourra envoyer après relecture.

RÈGLES STRICTES:
- Réponds dans la MÊME langue que le dernier message du client.
- Ne promets jamais un prix, un rendez-vous ferme ou un engagement que tu ne peux pas garantir;
  reste prudent et propose de confirmer si nécessaire.
- N'invente aucune information factuelle (tarifs, disponibilités, coordonnées).
- Style WhatsApp: court, clair, poli. Pas de markdown, pas de signature automatique.
- Maximum ~6 phrases.

CONVERSATION (du plus ancien au plus récent):
${transcript || "(aucun message)"}

Rédige UNIQUEMENT le texte de la réponse suggérée, sans préfixe ni guillemets.`;

    const { ai } = await import("@workspace/integrations-gemini-ai");
    const t0 = Date.now();
    const response = await ai.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: DRAFT_MAX_OUTPUT, temperature: 0.6 },
    });

    const tokens = extractGeminiTokens(response);
    recordAiUsage({
      organisationId: orgId,
      provider: "gemini",
      model: geminiActualModel(response, GEMINI_FLASH_MODEL),
      route: "/whatsapp/draft",
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      durationMs: Date.now() - t0,
    }).catch(() => {});
    invalidateQuotaCache(orgId);

    const draft = (response.text ?? "").trim();
    if (!draft) {
      await db
        .update(whatsappConversationsTable)
        .set({ draftStatus: "failed", draftError: "Aucune suggestion générée." })
        .where(
          and(
            eq(whatsappConversationsTable.id, conversationId),
            eq(whatsappConversationsTable.organisationId, orgId),
          ),
        );
      emit();
      return;
    }

    await db
      .update(whatsappConversationsTable)
      .set({ draftReply: draft, draftStatus: "ready", draftError: null })
      .where(
        and(
          eq(whatsappConversationsTable.id, conversationId),
          eq(whatsappConversationsTable.organisationId, orgId),
        ),
      );
    emit();
  } catch (err) {
    logger.error({ err, orgId, conversationId }, "[whatsapp-inbox] echec generation brouillon IA");
    try {
      await db
        .update(whatsappConversationsTable)
        .set({ draftStatus: "failed", draftError: "Erreur technique lors de la génération." })
        .where(
          and(
            eq(whatsappConversationsTable.id, conversationId),
            eq(whatsappConversationsTable.organisationId, orgId),
          ),
        );
      emit();
    } catch {
      /* fail-soft */
    }
  }
}
