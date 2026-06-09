import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and, lt } from "drizzle-orm";
import { db, messagesTable } from "@workspace/db";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { withDbRetry } from "../lib/db-retry";
import {
  ListMessagesQueryParams,
  CreateMessageBody,
  GetMessageParams,
  UpdateMessageParams,
  UpdateMessageBody,
  DeleteMessageParams,
} from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";
import { resolveUserNames, enrichWithUserNames, enrichSingle } from "../helpers/user-tracking";
import { zodErrorResponse } from "../lib/zod-error";
import { notifyOrgUsers, maskPhone } from "../services/whatsapp-notify";

const router: IRouter = Router();

const messageSortColumns: Record<string, any> = {
  createdAt: messagesTable.createdAt,
  priority: messagesTable.priority,
  type: messagesTable.type,
};

router.get("/messages", async (req, res): Promise<void> => {
  const query = ListMessagesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json(zodErrorResponse(query.error));
    return;
  }

  const orgId = getOrgId(req);
  const { read, limit, offset, search, type, priority, sortBy, sortOrder } = query.data;

  const conditions: any[] = [eq(messagesTable.organisationId, orgId)];
  if (read !== undefined) {
    conditions.push(eq(messagesTable.isRead, read));
  }
  if (type && type !== "all") {
    conditions.push(eq(messagesTable.type, type));
  }
  if (priority && priority !== "all") {
    conditions.push(eq(messagesTable.priority, priority));
  }
  if (search) {
    const useUnaccent = await ensureUnaccentExtension();
    const pattern = `%${search}%`;
    conditions.push(
      or(
        accentInsensitiveIlike(messagesTable.content, pattern, useUnaccent),
        accentInsensitiveIlike(messagesTable.contactName, pattern, useUnaccent),
        accentInsensitiveIlike(messagesTable.phoneNumber, pattern, useUnaccent)
      )!
    );
  }

  const whereClause = and(...conditions);

  const sortCol = messageSortColumns[sortBy ?? "createdAt"] ?? messagesTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
    const [messages, countResult] = await Promise.all([
      db
        .select()
        .from(messagesTable)
        .where(whereClause)
        .orderBy(orderFn(sortCol))
        .limit(limit ?? 50)
        .offset(offset ?? 0),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(messagesTable)
        .where(whereClause),
    ]);

    const userIds = messages.flatMap((m: any) => [m.createdBy, m.updatedBy]);
    const userMap = await resolveUserNames(userIds);
    res.json({ messages: enrichWithUserNames(messages, userMap), total: countResult[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste messages");
    res.status(500).json({ error: "Erreur lors de la recuperation des messages." });
  }
});

router.post("/messages", async (req, res): Promise<void> => {
  const parsed = CreateMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }

  const orgId = getOrgId(req);
  const userId = req.session?.userId;

  try {
    const [message] = await db.insert(messagesTable).values({ ...parsed.data, organisationId: orgId, createdBy: userId, updatedBy: userId }).returning();

    // Notification WhatsApp aux membres opt-in (kind="message"). On exclut
    // le createur du message. On limite le contenu a 140 caracteres pour
    // ne pas exploser la longueur du SMS WhatsApp. Fail-soft.
    try {
      // On masque le numero de telephone et on tronque le contenu pour
      // limiter l'exposition PII via Twilio. L'utilisateur peut consulter
      // le message complet dans l'app.
      const who = message.contactName
        || (message.phoneNumber ? `numero finissant par ${maskPhone(message.phoneNumber)}` : "un contact");
      const preview = (message.content || "").slice(0, 80);
      const ellipsis = (message.content || "").length > 80 ? "..." : "";
      void notifyOrgUsers(
        orgId,
        `Bureau IA - Nouveau message de ${who} : ${preview}${ellipsis}`,
        "message",
        userId,
      ).catch((err) => req.log.warn({ err }, "[messages] notifyOrgUsers rejection"));
    } catch (notifyErr) {
      req.log.warn({ err: notifyErr }, "[messages] notify message failed");
    }

    res.status(201).json(message);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation message");
    res.status(500).json({ error: "Erreur lors de la creation du message." });
  }
});

router.get("/messages/:id", async (req, res): Promise<void> => {
  const params = GetMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const orgId = getOrgId(req);

  try {
    const [message] = await db.select().from(messagesTable).where(and(eq(messagesTable.id, params.data.id), eq(messagesTable.organisationId, orgId)));
    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const userMap = await resolveUserNames([message.createdBy, message.updatedBy]);
    res.json(enrichSingle(message, userMap));
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation message");
    res.status(500).json({ error: "Erreur lors de la recuperation du message." });
  }
});

router.patch("/messages/:id", async (req, res): Promise<void> => {
  const params = UpdateMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const parsed = UpdateMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }

  const orgId = getOrgId(req);
  const userId = req.session?.userId;

  try {
    const [message] = await db.update(messagesTable)
      .set({ ...parsed.data, updatedBy: userId })
      .where(and(eq(messagesTable.id, params.data.id), eq(messagesTable.organisationId, orgId)))
      .returning();

    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    res.json(message);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour message");
    res.status(500).json({ error: "Erreur lors de la mise a jour du message." });
  }
});

// Export CSV en STREAMING. L'ancienne version chargeait jusqu'a 5000 lignes en
// memoire d'un coup (pression memoire + risque de troncature silencieuse au-dela
// du plafond). On pagine desormais par lots via une pagination keyset sur l'id
// (decroissant) et on ecrit chaque lot dans la reponse, sans plafond artificiel.
// Si la PREMIERE requete echoue avant tout envoi, on renvoie un 500 JSON propre;
// au-dela, l'en-tete est deja parti et on termine simplement le flux.
const MESSAGES_EXPORT_BATCH = 1000;

router.get("/messages/export/csv", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const headers = ["Type", "Contact", "Numéro", "Contenu", "Priorité", "Lu", "Date"];
  const escape = (v: any) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
  };
  const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("fr-FR") : "");
  try {
    let lastId = Number.MAX_SAFE_INTEGER;
    let wroteHeader = false;
    for (;;) {
      const rows = await withDbRetry(
        () =>
          db
            .select({
              id: messagesTable.id, type: messagesTable.type, contactName: messagesTable.contactName,
              phoneNumber: messagesTable.phoneNumber, content: messagesTable.content,
              priority: messagesTable.priority, isRead: messagesTable.isRead, createdAt: messagesTable.createdAt,
            })
            .from(messagesTable)
            .where(and(eq(messagesTable.organisationId, orgId), lt(messagesTable.id, lastId)))
            .orderBy(desc(messagesTable.id))
            .limit(MESSAGES_EXPORT_BATCH),
        { label: "messages.export.batch" },
      );
      if (!wroteHeader) {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="messages_${Date.now()}.csv"`);
        res.write("\uFEFF" + headers.join(",") + "\n");
        wroteHeader = true;
      }
      if (rows.length === 0) break;
      const chunk = rows.map((r) => [
        escape(r.type), escape(r.contactName), escape(r.phoneNumber),
        escape(r.content), escape(r.priority), r.isRead ? "Oui" : "Non", escape(fmtDate(r.createdAt)),
      ].join(",")).join("\n");
      res.write(chunk + "\n");
      lastId = rows[rows.length - 1].id;
      if (rows.length < MESSAGES_EXPORT_BATCH) break;
    }
    res.end();
  } catch (err: any) {
    req.log.error({ err }, "Erreur export messages CSV");
    if (!res.headersSent) {
      res.status(500).json({ error: "Erreur lors de l'export." });
    } else {
      res.end();
    }
  }
});

router.post("/messages/:id/duplicate", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  try {
    const [original] = await db.select().from(messagesTable).where(and(eq(messagesTable.id, id), eq(messagesTable.organisationId, orgId)));
    if (!original) { res.status(404).json({ error: "Message non trouve." }); return; }
    const [copy] = await db.insert(messagesTable).values({
      organisationId: orgId,
      contactId: original.contactId,
      contactName: original.contactName,
      phoneNumber: original.phoneNumber,
      content: original.content,
      type: original.type,
      priority: original.priority,
      isRead: false,
      createdBy: userId,
      updatedBy: userId,
    }).returning();
    res.status(201).json(copy);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication message");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.delete("/messages/:id", async (req, res): Promise<void> => {
  const params = DeleteMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const orgId = getOrgId(req);

  try {
    const [message] = await db.delete(messagesTable).where(and(eq(messagesTable.id, params.data.id), eq(messagesTable.organisationId, orgId))).returning();
    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    res.sendStatus(204);
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression message");
    res.status(500).json({ error: "Erreur lors de la suppression du message." });
  }
});

export default router;
