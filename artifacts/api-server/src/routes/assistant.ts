import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { assistantConversationsTable, assistantMessagesTable } from "@workspace/db/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { runAssistantTurn, resolvePendingAction, type StreamEvent } from "../services/assistant-engine";
import { getAllTools } from "../services/assistant-tools";
import { logger } from "../lib/logger";

const router = Router();

function getUserId(req: Request): number | null {
  return (req.session as { userId?: number } | undefined)?.userId ?? null;
}

router.get("/assistant/tools", (_req, res) => {
  res.json({
    tools: getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      requiresConfirmation: Boolean(t.requiresConfirmation),
    })),
  });
});

router.get("/assistant/conversations", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const orgId = getOrgId(req);
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  try {
    const rows = await db.select({
      id: assistantConversationsTable.id,
      title: assistantConversationsTable.title,
      updatedAt: assistantConversationsTable.updatedAt,
    }).from(assistantConversationsTable)
      .where(and(eq(assistantConversationsTable.organisationId, orgId), eq(assistantConversationsTable.userId, userId)))
      .orderBy(desc(assistantConversationsTable.updatedAt))
      .limit(50);
    res.json({ conversations: rows });
  } catch (err) {
    logger.error({ err }, "[assistant] list conversations failed");
    res.status(500).json({ error: "Erreur lors du chargement." });
  }
});

router.get("/assistant/conversations/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const orgId = getOrgId(req);
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [conv] = await db.select().from(assistantConversationsTable)
      .where(and(eq(assistantConversationsTable.id, id), eq(assistantConversationsTable.organisationId, orgId), eq(assistantConversationsTable.userId, userId)));
    if (!conv) { res.status(404).json({ error: "Conversation introuvable." }); return; }
    const messages = await db.select().from(assistantMessagesTable)
      .where(and(
        eq(assistantMessagesTable.conversationId, id),
        eq(assistantMessagesTable.organisationId, orgId),
      ))
      .orderBy(asc(assistantMessagesTable.createdAt));
    res.json({ conversation: conv, messages });
  } catch (err) {
    logger.error({ err }, "[assistant] get conversation failed");
    res.status(500).json({ error: "Erreur lors du chargement." });
  }
});

router.delete("/assistant/conversations/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const orgId = getOrgId(req);
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    await db.delete(assistantConversationsTable)
      .where(and(eq(assistantConversationsTable.id, id), eq(assistantConversationsTable.organisationId, orgId), eq(assistantConversationsTable.userId, userId)));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[assistant] delete conversation failed");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

function setupSse(res: Response): (event: string, data: unknown) => void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  return (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

// SSE streaming endpoint. Body: { conversationId?: number, message: string }
router.post("/assistant/chat", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const orgId = getOrgId(req);
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const message = String((req.body as { message?: unknown })?.message ?? "").trim();
  if (!message) { res.status(400).json({ error: "Message vide." }); return; }
  if (message.length > 4000) { res.status(400).json({ error: "Message trop long (max 4000)." }); return; }

  let conversationId = Number((req.body as { conversationId?: unknown })?.conversationId ?? 0);

  try {
    if (conversationId > 0) {
      const [conv] = await db.select({ id: assistantConversationsTable.id })
        .from(assistantConversationsTable)
        .where(and(eq(assistantConversationsTable.id, conversationId), eq(assistantConversationsTable.organisationId, orgId), eq(assistantConversationsTable.userId, userId)));
      if (!conv) { res.status(404).json({ error: "Conversation introuvable." }); return; }
    } else {
      const title = message.slice(0, 60);
      const [created] = await db.insert(assistantConversationsTable).values({
        organisationId: orgId, userId, title,
      }).returning({ id: assistantConversationsTable.id });
      conversationId = created.id;
    }
  } catch (err) {
    logger.error({ err }, "[assistant] conversation setup failed");
    res.status(500).json({ error: "Erreur lors de l'initialisation." });
    return;
  }

  const send = setupSse(res);
  send("init", { conversationId });

  let aborted = false;
  req.on("close", () => { aborted = true; });

  const emit = (ev: StreamEvent): void => {
    if (aborted) return;
    send(ev.type, ev);
  };

  try {
    await runAssistantTurn(conversationId, message, { orgId, userId }, emit);
  } catch (err) {
    logger.error({ err }, "[assistant] turn failed");
    const msg = err instanceof Error ? err.message : "Erreur interne.";
    if (!aborted) send("error", { error: msg });
  } finally {
    if (!aborted) {
      send("close", {});
      res.end();
    }
  }
});

// Confirm or reject a pending tool action.
// Body: { conversationId: number, messageId: number, decision: "approve" | "reject" }
router.post("/assistant/confirm", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const orgId = getOrgId(req);
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const body = req.body as { conversationId?: unknown; messageId?: unknown; decision?: unknown } | undefined;
  const conversationId = Number(body?.conversationId);
  const messageId = Number(body?.messageId);
  const decision = body?.decision === "approve" ? "approve" : body?.decision === "reject" ? "reject" : null;
  if (!Number.isFinite(conversationId) || !Number.isFinite(messageId) || !decision) {
    res.status(400).json({ error: "Parametres invalides." });
    return;
  }

  // Verify conversation ownership
  const [conv] = await db.select({ id: assistantConversationsTable.id })
    .from(assistantConversationsTable)
    .where(and(
      eq(assistantConversationsTable.id, conversationId),
      eq(assistantConversationsTable.organisationId, orgId),
      eq(assistantConversationsTable.userId, userId),
    ));
  if (!conv) { res.status(404).json({ error: "Conversation introuvable." }); return; }

  const send = setupSse(res);
  let aborted = false;
  req.on("close", () => { aborted = true; });

  const emit = (ev: StreamEvent): void => {
    if (aborted) return;
    send(ev.type, ev);
  };

  try {
    await resolvePendingAction(conversationId, messageId, decision, { orgId, userId }, emit);
  } catch (err) {
    logger.error({ err }, "[assistant] confirm failed");
    const msg = err instanceof Error ? err.message : "Erreur interne.";
    if (!aborted) send("error", { error: msg });
  } finally {
    if (!aborted) {
      send("close", {});
      res.end();
    }
  }
});

export default router;
