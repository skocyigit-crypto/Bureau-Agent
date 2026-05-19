import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { calendarEventsTable, insertCalendarEventSchema, tasksTable, projetsTable } from "@workspace/db/schema";
import { eq, and, gte, lte, or, type Column, type SQL } from "drizzle-orm";
import { logAudit } from "./audit";
import { getOrgId } from "../middleware/tenant";
import { resolveUserNames, enrichWithUserNames } from "../helpers/user-tracking";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { notifyOrgUsers } from "../services/whatsapp-notify";

const router = Router();

const ALLOWED_UPDATE_FIELDS = new Set([
  "title", "description", "type", "startDate", "endDate", "allDay",
  "location", "color", "relatedContactId", "relatedTaskId", "reminder", "recurrence",
  "contactName", "contactPhone", "contactEmail", "contactCompany", "contactNotes",
  "status", "priority",
]);

router.get("/calendar/events", async (req: Request, res: Response): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const orgId = getOrgId(req);
  const { start, end, type, search, q } = req.query;

  let conditions: any[] = [eq(calendarEventsTable.organisationId, orgId)];
  if (start && typeof start === "string") {
    const d = new Date(start);
    if (!isNaN(d.getTime())) conditions.push(gte(calendarEventsTable.startDate, d));
  }
  if (end && typeof end === "string") {
    const d = new Date(end);
    if (!isNaN(d.getTime())) conditions.push(lte(calendarEventsTable.endDate, d));
  }
  if (type && type !== "tous" && typeof type === "string") conditions.push(eq(calendarEventsTable.type, type));

  const searchTerm = (typeof search === "string" && search.trim()) || (typeof q === "string" && q.trim()) || "";
  if (searchTerm) {
    const useUnaccent = await ensureUnaccentExtension();
    const pattern = `%${searchTerm.replace(/[%_\\]/g, "\\$&")}%`;
    const il = (col: Column): SQL => accentInsensitiveIlike(col, pattern, useUnaccent);
    conditions.push(or(
      il(calendarEventsTable.title),
      il(calendarEventsTable.description),
      il(calendarEventsTable.location),
      il(calendarEventsTable.contactName),
      il(calendarEventsTable.contactCompany),
    )!);
  }

  try {
    const events = await db
      .select()
      .from(calendarEventsTable)
      .where(and(...conditions))
      .orderBy(calendarEventsTable.startDate);

    const taskConditions: any[] = [eq(tasksTable.organisationId, orgId)];
    if (start && end) {
      taskConditions.push(gte(tasksTable.dueDate, new Date(start as string)));
      taskConditions.push(lte(tasksTable.dueDate, new Date(end as string)));
    }

    const tasks = await db
      .select()
      .from(tasksTable)
      .where(taskConditions.length > 1 ? and(...taskConditions) : taskConditions[0]);

    const taskEvents = tasks
      .filter(t => t.dueDate)
      .map(t => ({
        id: `task-${t.id}`,
        title: t.title,
        description: t.description,
        type: "tache",
        startDate: t.dueDate,
        endDate: t.dueDate,
        allDay: true,
        color: t.priority === "haute" ? "#ef4444" : t.priority === "moyenne" ? "#f59e0b" : "#22c55e",
        relatedTaskId: t.id,
        status: t.status,
      }));

    const projetConditions: any[] = [
      eq(projetsTable.organisationId, orgId),
    ];
    if (start && end) {
      projetConditions.push(gte(projetsTable.endDate, new Date(start as string)));
      projetConditions.push(lte(projetsTable.endDate, new Date(end as string)));
    }
    const projets = await db
      .select({ id: projetsTable.id, title: projetsTable.title, endDate: projetsTable.endDate, status: projetsTable.status, priority: projetsTable.priority, clientName: projetsTable.clientName, progress: projetsTable.progress })
      .from(projetsTable)
      .where(and(...projetConditions));

    const projetEvents = projets
      .filter(p => p.endDate && p.status !== "annule")
      .map(p => ({
        id: `projet-${p.id}`,
        title: `📁 ${p.title}${p.clientName ? ` — ${p.clientName}` : ""}`,
        description: `Projet · ${p.progress ?? 0}% avancé`,
        type: "projet",
        startDate: p.endDate,
        endDate: p.endDate,
        allDay: true,
        color: p.status === "termine" ? "#22c55e" : p.priority === "haute" ? "#ef4444" : "#6366f1",
        status: p.status,
      }));

    const userIds = events.flatMap((e: any) => [e.createdBy, e.updatedBy]);
    const userMap = await resolveUserNames(userIds);
    res.json({ events: enrichWithUserNames(events, userMap), taskEvents, projetEvents });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste evenements agenda");
    res.status(500).json({ error: "Erreur lors de la recuperation des evenements." });
  }
});

router.post("/calendar/events", async (req: Request, res: Response): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const orgId = getOrgId(req);
  const body = { ...req.body };
  if (body.startDate && typeof body.startDate === "string") body.startDate = new Date(body.startDate);
  if (body.endDate && typeof body.endDate === "string") body.endDate = new Date(body.endDate);

  const parsed = insertCalendarEventSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: "Donnees invalides.", details: parsed.error.issues });
    return;
  }

  try {
    const [event] = await db.insert(calendarEventsTable).values({
      ...parsed.data,
      organisationId: orgId,
      createdBy: userId,
      updatedBy: userId,
    }).returning();

    logAudit(userId, req.session?.userEmail, "create", "calendar_event", String(event.id), { title: event.title }, req.ip, req.get("user-agent"), req.session?.organisationId);

    // Notification WhatsApp aux membres opt-in (kind="appointment"). On
    // exclut le createur (il vient de le creer, pas besoin de se notifier
    // soi-meme). Fail-soft.
    try {
      const when = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);
      const whenStr = isNaN(when.getTime())
        ? ""
        : ` (${when.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })})`;
      void notifyOrgUsers(
        orgId,
        `Bureau IA - Nouveau rendez-vous : ${event.title}${whenStr}.`,
        "appointment",
        userId,
      ).catch((err) => req.log.warn({ err }, "[calendar] notifyOrgUsers rejection"));
    } catch (notifyErr) {
      req.log.warn({ err: notifyErr }, "[calendar] notify appointment failed");
    }

    res.status(201).json(event);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation evenement agenda");
    res.status(500).json({ error: "Erreur lors de la creation de l'evenement." });
  }
});

router.patch("/calendar/events/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const updateData: Record<string, any> = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (ALLOWED_UPDATE_FIELDS.has(key) && value !== undefined) {
      updateData[key] = value;
    }
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "Aucune modification fournie." });
    return;
  }

  updateData.updatedBy = userId;

  try {
    const [updated] = await db
      .update(calendarEventsTable)
      .set(updateData)
      .where(and(eq(calendarEventsTable.id, id), eq(calendarEventsTable.organisationId, orgId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Evenement non trouve." }); return; }
    logAudit(userId, req.session?.userEmail, "update", "calendar_event", String(id), updateData, req.ip, req.get("user-agent"), req.session?.organisationId);
    res.json(updated);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour evenement agenda");
    res.status(500).json({ error: "Erreur lors de la mise a jour de l'evenement." });
  }
});

router.post("/calendar/events/:id/duplicate", async (req: Request, res: Response): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [original] = await db.select().from(calendarEventsTable).where(and(eq(calendarEventsTable.id, id), eq(calendarEventsTable.organisationId, orgId)));
    if (!original) { res.status(404).json({ error: "Evenement non trouve." }); return; }
    const startDate = new Date(original.startDate);
    const endDate = new Date(original.endDate);
    startDate.setDate(startDate.getDate() + 7);
    endDate.setDate(endDate.getDate() + 7);
    const [copy] = await db.insert(calendarEventsTable).values({
      organisationId: orgId,
      title: `${original.title} (copie)`,
      description: original.description,
      type: original.type,
      startDate,
      endDate,
      allDay: original.allDay,
      location: original.location,
      color: original.color,
      relatedContactId: original.relatedContactId,
      contactName: original.contactName,
      contactPhone: original.contactPhone,
      contactEmail: original.contactEmail,
      contactCompany: original.contactCompany,
      reminder: original.reminder,
      status: "confirme",
      priority: original.priority,
      createdBy: userId,
      updatedBy: userId,
    }).returning();
    res.status(201).json(copy);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication evenement agenda");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.delete("/calendar/events/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    await db.delete(calendarEventsTable).where(and(eq(calendarEventsTable.id, id), eq(calendarEventsTable.organisationId, orgId)));
    logAudit(userId, req.session?.userEmail, "delete", "calendar_event", String(id), undefined, req.ip, req.get("user-agent"), req.session?.organisationId);
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression evenement agenda");
    res.status(500).json({ error: "Erreur lors de la suppression de l'evenement." });
  }
});

router.get("/calendar/events/export/csv", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.organisationId, orgId)).limit(5000);
    const headers = ["Titre", "Type", "Statut", "Début", "Fin", "Lieu", "Contact", "Priorité", "Créé le"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "";
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.title), escape(r.type), escape(r.status),
      escape(fmtDate(r.startDate)), escape(fmtDate(r.endDate)), escape(r.location),
      escape(r.contactName), escape(r.priority), escape(fmtDate(r.createdAt)),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="evenements_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export calendar CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

router.get("/calendar/events/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [event] = await db
      .select()
      .from(calendarEventsTable)
      .where(and(eq(calendarEventsTable.id, id), eq(calendarEventsTable.organisationId, orgId)));
    if (!event) { res.status(404).json({ error: "Evenement introuvable." }); return; }

    const userMap = await resolveUserNames([event.createdBy, event.updatedBy].filter(Boolean) as any);
    const [enriched] = enrichWithUserNames([event], userMap);
    res.json(enriched);
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation evenement agenda");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'evenement." });
  }
});

export default router;
