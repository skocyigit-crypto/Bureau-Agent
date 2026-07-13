// Boite de reception WhatsApp cote CLIENT — routes authentifiees (membres de
// l'organisation). Liste des conversations, fil detaille (avec marquage lu),
// approbation/envoi d'une reponse, regeneration du brouillon IA, et
// ouverture/fermeture d'un fil. Toutes les routes sont montees APRES
// requireTenant: l'isolation multi-tenant repose sur getOrgId(req).

import { Router, type IRouter } from "express";
import { and, eq, sql, desc, asc, ilike, or } from "drizzle-orm";
import {
  db,
  whatsappConversationsTable,
  whatsappMessagesTable,
  telephonyProvidersTable,
} from "@workspace/db";
import {
  ListWhatsappConversationsQueryParams,
  GetWhatsappConversationParams,
  UpdateWhatsappConversationParams,
  UpdateWhatsappConversationBody,
  SendWhatsappMessageParams,
  SendWhatsappMessageBody,
  GenerateWhatsappDraftParams,
} from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";
import { broadcaster } from "../services/broadcaster";
import { generateDraftInBackground } from "../services/whatsapp-inbox";
import { sendWhatsApp, type TelephonyProviderConfig } from "../services/telephony-providers";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const PREVIEW_MAX = 160;
function preview(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) + "…" : s;
}

// GET /whatsapp/conversations — liste paginee, filtrable par statut/recherche.
router.get("/whatsapp/conversations", async (req, res) => {
  const orgId = getOrgId(req);
  const parsed = ListWhatsappConversationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Paramètres invalides" });
    return;
  }
  const { status = "all", search, limit = 50, offset = 0 } = parsed.data;
  const cappedLimit = Math.min(Math.max(limit, 1), 100);

  const conds = [eq(whatsappConversationsTable.organisationId, orgId)];
  if (status === "open" || status === "closed") {
    conds.push(eq(whatsappConversationsTable.status, status));
  }
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    const searchCond = or(
      ilike(whatsappConversationsTable.customerPhone, term),
      ilike(whatsappConversationsTable.customerName, term),
    );
    if (searchCond) conds.push(searchCond);
  }
  const where = and(...conds);

  const [rows, [counted]] = await Promise.all([
    db
      .select()
      .from(whatsappConversationsTable)
      .where(where)
      .orderBy(desc(whatsappConversationsTable.lastMessageAt))
      .limit(cappedLimit)
      .offset(Math.max(offset, 0)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(whatsappConversationsTable)
      .where(where),
  ]);

  res.json({ conversations: rows, total: counted?.total ?? 0 });
});

// GET /whatsapp/conversations/:id — fil complet; marque le fil comme lu.
router.get("/whatsapp/conversations/:id", async (req, res) => {
  const orgId = getOrgId(req);
  const parsed = GetWhatsappConversationParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Identifiant invalide" });
    return;
  }
  const id = parsed.data.id;

  const [conv] = await db
    .select()
    .from(whatsappConversationsTable)
    .where(
      and(
        eq(whatsappConversationsTable.id, id),
        eq(whatsappConversationsTable.organisationId, orgId),
      ),
    );
  if (!conv) {
    res.status(404).json({ error: "Conversation introuvable" });
    return;
  }

  const messages = await db
    .select()
    .from(whatsappMessagesTable)
    .where(
      and(
        eq(whatsappMessagesTable.conversationId, id),
        eq(whatsappMessagesTable.organisationId, orgId),
      ),
    )
    .orderBy(asc(whatsappMessagesTable.createdAt));

  // Marque le fil comme lu (idempotent).
  if (conv.unreadCount > 0) {
    await db
      .update(whatsappConversationsTable)
      .set({ unreadCount: 0 })
      .where(
        and(
          eq(whatsappConversationsTable.id, id),
          eq(whatsappConversationsTable.organisationId, orgId),
        ),
      );
    broadcaster.broadcast(orgId, { type: "whatsapp", action: "updated", resourceId: id });
  }

  res.json({ conversation: { ...conv, unreadCount: 0 }, messages });
});

// PATCH /whatsapp/conversations/:id — change le statut (open/closed).
router.patch("/whatsapp/conversations/:id", async (req, res) => {
  const orgId = getOrgId(req);
  const parsedParams = UpdateWhatsappConversationParams.safeParse(req.params);
  const parsedBody = UpdateWhatsappConversationBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Requête invalide" });
    return;
  }
  const id = parsedParams.data.id;
  const { status } = parsedBody.data;

  const [updated] = await db
    .update(whatsappConversationsTable)
    .set({ ...(status ? { status } : {}) })
    .where(
      and(
        eq(whatsappConversationsTable.id, id),
        eq(whatsappConversationsTable.organisationId, orgId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Conversation introuvable" });
    return;
  }
  broadcaster.broadcast(orgId, { type: "whatsapp", action: "updated", resourceId: id });
  res.json(updated);
});

// POST /whatsapp/conversations/:id/draft — (re)genere un brouillon IA.
router.post("/whatsapp/conversations/:id/draft", async (req, res) => {
  const orgId = getOrgId(req);
  const parsed = GenerateWhatsappDraftParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Identifiant invalide" });
    return;
  }
  const id = parsed.data.id;

  const [conv] = await db
    .select({ id: whatsappConversationsTable.id })
    .from(whatsappConversationsTable)
    .where(
      and(
        eq(whatsappConversationsTable.id, id),
        eq(whatsappConversationsTable.organisationId, orgId),
      ),
    );
  if (!conv) {
    res.status(404).json({ error: "Conversation introuvable" });
    return;
  }

  // Generation en arriere-plan (peut prendre plusieurs secondes); l'UI suit
  // l'avancement via SSE (draftStatus generating -> ready/failed).
  void generateDraftInBackground(id, orgId);
  res.status(202).json({ status: "generating" });
});

// POST /whatsapp/conversations/:id/send — approuve et envoie une reponse.
router.post("/whatsapp/conversations/:id/send", async (req, res) => {
  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  const parsedParams = SendWhatsappMessageParams.safeParse(req.params);
  const parsedBody = SendWhatsappMessageBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Requête invalide" });
    return;
  }
  const id = parsedParams.data.id;
  const text = parsedBody.data.text.trim();
  if (!text) {
    res.status(400).json({ error: "Le message est vide." });
    return;
  }

  const [conv] = await db
    .select()
    .from(whatsappConversationsTable)
    .where(
      and(
        eq(whatsappConversationsTable.id, id),
        eq(whatsappConversationsTable.organisationId, orgId),
      ),
    );
  if (!conv) {
    res.status(404).json({ error: "Conversation introuvable" });
    return;
  }

  // Resout le fournisseur Twilio actif de l'organisation (priorite au provider
  // lie a la conversation; sinon le provider actif par defaut).
  const providers = await db
    .select()
    .from(telephonyProvidersTable)
    .where(
      and(
        eq(telephonyProvidersTable.organisationId, orgId),
        eq(telephonyProvidersTable.provider, "twilio"),
        eq(telephonyProvidersTable.isActive, true),
      ),
    )
    .orderBy(desc(telephonyProvidersTable.isDefault));
  const provider =
    providers.find((p) => p.id === conv.providerId) ?? providers[0];
  if (!provider) {
    res.status(400).json({ error: "Aucun fournisseur WhatsApp (Twilio) actif n'est configuré." });
    return;
  }

  const result = await sendWhatsApp(
    provider.provider,
    provider.config as TelephonyProviderConfig,
    { to: conv.customerPhone, body: text },
  );
  if (!result.success) {
    logger.warn({ orgId, conversationId: id, error: result.error }, "[whatsapp-inbox] echec envoi");
    res.status(400).json({ error: result.error || "Échec de l'envoi du message." });
    return;
  }

  const now = new Date();
  const [msg] = await db
    .insert(whatsappMessagesTable)
    .values({
      organisationId: orgId,
      conversationId: id,
      direction: "outbound",
      body: text,
      mediaUrls: [],
      providerMessageSid: result.messageSid ?? null,
      status: result.status ?? "sent",
      sentBy: userId ?? null,
    })
    .returning();

  // Une reponse envoyee consomme le brouillon et reouvre/maintient le fil ouvert.
  await db
    .update(whatsappConversationsTable)
    .set({
      lastMessageAt: now,
      lastMessagePreview: preview(text),
      lastDirection: "outbound",
      draftReply: null,
      draftStatus: "none",
      draftError: null,
      unreadCount: 0,
    })
    .where(
      and(
        eq(whatsappConversationsTable.id, id),
        eq(whatsappConversationsTable.organisationId, orgId),
      ),
    );

  broadcaster.broadcast(orgId, { type: "whatsapp", action: "updated", resourceId: id });
  res.status(201).json(msg);
});

export const whatsappInboxRouter: IRouter = router;
