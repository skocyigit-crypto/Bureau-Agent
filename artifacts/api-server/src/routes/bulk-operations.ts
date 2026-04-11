import { Router, type Request, type Response } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, prospectsTable } from "@workspace/db";
import { eq, sql, and, inArray } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";

const router = Router();

router.post("/bulk/tasks/complete", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    const result = await db.update(tasksTable)
      .set({ status: "terminee", updatedAt: new Date() })
      .where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.id, ids)));

    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur bulk complete" });
  }
});

router.post("/bulk/tasks/delete", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    await db.delete(tasksTable).where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.id, ids)));
    res.json({ success: true, deleted: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur bulk delete" });
  }
});

router.post("/bulk/tasks/assign", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, assignedTo } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    await db.update(tasksTable)
      .set({ assignedTo, updatedAt: new Date() })
      .where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.id, ids)));

    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur bulk assign" });
  }
});

router.post("/bulk/tasks/priority", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, priority } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!["basse", "moyenne", "haute", "urgente"].includes(priority)) { res.status(400).json({ error: "Priorite invalide" }); return; }

    await db.update(tasksTable)
      .set({ priority, updatedAt: new Date() })
      .where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.id, ids)));

    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur bulk priority" });
  }
});

router.post("/bulk/contacts/delete", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    await db.delete(contactsTable).where(and(eq(contactsTable.organisationId, orgId), inArray(contactsTable.id, ids)));
    res.json({ success: true, deleted: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur bulk delete contacts" });
  }
});

router.post("/bulk/contacts/category", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, category } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    await db.update(contactsTable)
      .set({ category, updatedAt: new Date() })
      .where(and(eq(contactsTable.organisationId, orgId), inArray(contactsTable.id, ids)));

    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur bulk category" });
  }
});

router.post("/bulk/messages/read", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    await db.update(messagesTable)
      .set({ isRead: true, updatedAt: new Date() })
      .where(and(eq(messagesTable.organisationId, orgId), inArray(messagesTable.id, ids)));

    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur bulk read" });
  }
});

router.post("/bulk/prospects/stage", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, stage } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    await db.update(prospectsTable)
      .set({ stage, updatedAt: new Date() })
      .where(and(eq(prospectsTable.organisationId, orgId), inArray(prospectsTable.id, ids)));

    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur bulk stage" });
  }
});

router.get("/export/:entity", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const entity = String(req.params.entity);
    const format = (req.query.format as string) || "json";

    let data: any[] = [];

    switch (entity) {
      case "contacts":
        data = await db.select().from(contactsTable).where(eq(contactsTable.organisationId, orgId));
        break;
      case "tasks":
        data = await db.select().from(tasksTable).where(eq(tasksTable.organisationId, orgId));
        break;
      case "calls":
        data = await db.select().from(callsTable).where(eq(callsTable.organisationId, orgId));
        break;
      case "messages":
        data = await db.select().from(messagesTable).where(eq(messagesTable.organisationId, orgId));
        break;
      case "prospects":
        data = await db.select().from(prospectsTable).where(eq(prospectsTable.organisationId, orgId));
        break;
      default:
        res.status(400).json({ error: "Entite invalide" });
        return;
    }

    if (format === "csv") {
      if (data.length === 0) { res.set("Content-Type", "text/csv").send(""); return; }
      const headers = Object.keys(data[0]);
      const csvRows = [
        headers.join(","),
        ...data.map(row => headers.map(h => {
          const val = (row as any)[h];
          if (val === null || val === undefined) return "";
          const str = String(val);
          return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(","))
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${entity}_export_${new Date().toISOString().slice(0,10)}.csv"`,
      });
      res.send(csvRows.join("\n"));
    } else {
      res.set({
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${entity}_export_${new Date().toISOString().slice(0,10)}.json"`,
      });
      res.json({ entity, count: data.length, exportedAt: new Date().toISOString(), data });
    }
  } catch (err: any) {
    console.error("Erreur export:", err);
    res.status(500).json({ error: "Erreur export" });
  }
});

export default router;
