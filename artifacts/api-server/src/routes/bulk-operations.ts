import { Router, type Request, type Response } from "express";
import { db, callsTable, contactsTable, tasksTable, messagesTable, prospectsTable, devisTable, facturesClientTable, commandesFournisseurTable, stockArticlesTable, checkinsTable, documentsTable, notesInternesTable, objectifsCommerciauxTable, projetsTable } from "@workspace/db";
import { eq, sql, and, inArray } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { logAudit } from "./audit";
import { logger } from "../lib/logger";

const router = Router();

const requireMinOperateur = requireRole("super_admin", "administrateur", "agent");
const requireMinAdmin = requireRole("super_admin", "administrateur");

function auditBulk(req: Request, action: string, resource: string, ids: any[], extra?: any): void {
  void logAudit(
    req.session?.userId,
    req.session?.userEmail,
    action,
    resource,
    undefined,
    { count: ids.length, ids: ids.slice(0, 100), ...(extra || {}) },
    req.ip,
    req.get("user-agent"),
    req.session?.organisationId,
  );
}

router.post("/bulk/tasks/complete", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    const result = await db.update(tasksTable)
      .set({ status: "terminee", updatedAt: new Date() })
      .where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.id, ids)));

    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur bulk complete:");
    res.status(500).json({ error: "Erreur bulk complete" });
  }
});

router.post("/bulk/tasks/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    auditBulk(req, "bulk_delete", "tasks", ids);

    await db.delete(tasksTable).where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.id, ids)));
    res.json({ success: true, deleted: ids.length });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur bulk delete tasks:");
    res.status(500).json({ error: "Erreur bulk delete" });
  }
});

router.post("/bulk/tasks/assign", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, assignedTo } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!assignedTo || typeof assignedTo !== "string" || assignedTo.trim().length === 0) { res.status(400).json({ error: "assignedTo requis" }); return; }

    await db.update(tasksTable)
      .set({ assignedTo: assignedTo.trim(), updatedAt: new Date() })
      .where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.id, ids)));

    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur bulk assign:");
    res.status(500).json({ error: "Erreur bulk assign" });
  }
});

router.post("/bulk/tasks/priority", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
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
    logger.error({ err: err }, "Erreur bulk priority:");
    res.status(500).json({ error: "Erreur bulk priority" });
  }
});

router.post("/bulk/tasks/status", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!["todo", "en_cours", "terminee", "annulee"].includes(status)) { res.status(400).json({ error: "Statut invalide" }); return; }
    await db.update(tasksTable).set({ status, updatedAt: new Date() }).where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk tasks status error");
    res.status(500).json({ error: "Erreur bulk status" });
  }
});

router.post("/bulk/contacts/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    auditBulk(req, "bulk_delete", "contacts", ids);

    await db.delete(contactsTable).where(and(eq(contactsTable.organisationId, orgId), inArray(contactsTable.id, ids)));
    res.json({ success: true, deleted: ids.length });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur bulk delete contacts:");
    res.status(500).json({ error: "Erreur bulk delete contacts" });
  }
});

router.post("/bulk/contacts/category", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, category } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!category || typeof category !== "string" || category.trim().length === 0) { res.status(400).json({ error: "category requis" }); return; }

    await db.update(contactsTable)
      .set({ category: category.trim(), updatedAt: new Date() })
      .where(and(eq(contactsTable.organisationId, orgId), inArray(contactsTable.id, ids)));

    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur bulk category:");
    res.status(500).json({ error: "Erreur bulk category" });
  }
});

router.post("/bulk/devis/status", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!["brouillon", "envoye", "accepte", "refuse", "expire"].includes(status)) { res.status(400).json({ error: "Statut invalide" }); return; }
    await db.update(devisTable).set({ status, updatedAt: new Date() }).where(and(eq(devisTable.organisationId, orgId), inArray(devisTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk devis status error");
    res.status(500).json({ error: "Erreur bulk status" });
  }
});

router.post("/bulk/factures/status", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!["brouillon", "emise", "partiellement_payee", "payee", "annulee"].includes(status)) { res.status(400).json({ error: "Statut invalide" }); return; }
    await db.update(facturesClientTable).set({ status, updatedAt: new Date() }).where(and(eq(facturesClientTable.organisationId, orgId), inArray(facturesClientTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk factures status error");
    res.status(500).json({ error: "Erreur bulk status" });
  }
});

router.post("/bulk/commandes/status", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!["brouillon", "envoye", "confirme", "recu", "annule"].includes(status)) { res.status(400).json({ error: "Statut invalide" }); return; }
    await db.update(commandesFournisseurTable).set({ status, updatedAt: new Date() }).where(and(eq(commandesFournisseurTable.organisationId, orgId), inArray(commandesFournisseurTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk commandes status error");
    res.status(500).json({ error: "Erreur bulk status" });
  }
});

router.post("/bulk/calls/status", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!["repondu", "manque", "messagerie", "en_cours"].includes(status)) { res.status(400).json({ error: "Statut invalide" }); return; }
    await db.update(callsTable).set({ status, updatedAt: new Date() }).where(and(eq(callsTable.organisationId, orgId), inArray(callsTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk calls status error");
    res.status(500).json({ error: "Erreur bulk status" });
  }
});

router.post("/bulk/calls/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "calls", ids);
    const result = await db.delete(callsTable).where(and(eq(callsTable.organisationId, orgId), inArray(callsTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete calls error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/messages/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "messages", ids);
    const result = await db.delete(messagesTable).where(and(eq(messagesTable.organisationId, orgId), inArray(messagesTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete messages error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/messages/read", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    await db.update(messagesTable)
      .set({ isRead: true, updatedAt: new Date() })
      .where(and(eq(messagesTable.organisationId, orgId), inArray(messagesTable.id, ids)));

    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur bulk read messages:");
    res.status(500).json({ error: "Erreur bulk read" });
  }
});

router.post("/bulk/prospects/stage", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, stage } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }

    await db.update(prospectsTable)
      .set({ stage, updatedAt: new Date() })
      .where(and(eq(prospectsTable.organisationId, orgId), inArray(prospectsTable.id, ids)));

    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err: err }, "Erreur bulk stage prospects:");
    res.status(500).json({ error: "Erreur bulk stage" });
  }
});

router.post("/bulk/prospects/priority", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, priority } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!["basse", "moyenne", "haute"].includes(priority)) { res.status(400).json({ error: "Priorité invalide" }); return; }
    await db.update(prospectsTable).set({ priority, updatedAt: new Date() }).where(and(eq(prospectsTable.organisationId, orgId), inArray(prospectsTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk prospects priority error");
    res.status(500).json({ error: "Erreur bulk priority" });
  }
});

router.post("/bulk/prospects/assign", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, assignedTo } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!assignedTo || typeof assignedTo !== "string" || assignedTo.trim().length === 0) { res.status(400).json({ error: "assignedTo requis" }); return; }
    await db.update(prospectsTable).set({ assignedTo: assignedTo.trim(), updatedAt: new Date() }).where(and(eq(prospectsTable.organisationId, orgId), inArray(prospectsTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk prospects assign error");
    res.status(500).json({ error: "Erreur bulk assign" });
  }
});

router.get("/export/:entity", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
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
    logger.error({ err: err }, "Erreur export:");
    res.status(500).json({ error: "Erreur export" });
  }
});

router.post("/bulk/devis/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "devis", ids);
    const result = await db.delete(devisTable).where(and(eq(devisTable.organisationId, orgId), inArray(devisTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete devis error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/factures/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "factures", ids);
    const result = await db.delete(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), inArray(facturesClientTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete factures error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/commandes/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "commandes", ids);
    const result = await db.delete(commandesFournisseurTable).where(and(eq(commandesFournisseurTable.organisationId, orgId), inArray(commandesFournisseurTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete commandes error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/stock/status", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!["en_stock", "stock_faible", "rupture"].includes(status)) { res.status(400).json({ error: "Statut invalide" }); return; }
    await db.update(stockArticlesTable).set({ status, updatedAt: new Date() }).where(and(eq(stockArticlesTable.organisationId, orgId), inArray(stockArticlesTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk stock status error");
    res.status(500).json({ error: "Erreur bulk status" });
  }
});

router.post("/bulk/checkins/status", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    if (!["present", "en_pause", "termine", "absent"].includes(status)) { res.status(400).json({ error: "Statut invalide" }); return; }
    await db.update(checkinsTable).set({ status, updatedAt: new Date() }).where(and(eq(checkinsTable.organisationId, orgId), inArray(checkinsTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk checkins status error");
    res.status(500).json({ error: "Erreur bulk status" });
  }
});

router.post("/bulk/stock/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "stock", ids);
    const result = await db.delete(stockArticlesTable).where(and(eq(stockArticlesTable.organisationId, orgId), inArray(stockArticlesTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete stock error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/prospects/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "prospects", ids);
    const result = await db.delete(prospectsTable).where(and(eq(prospectsTable.organisationId, orgId), inArray(prospectsTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete prospects error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/checkins/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "checkins", ids);
    const result = await db.delete(checkinsTable).where(and(eq(checkinsTable.organisationId, orgId), inArray(checkinsTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete checkins error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/documents/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "documents", ids);
    const result = await db.delete(documentsTable).where(and(eq(documentsTable.organisationId, orgId), inArray(documentsTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete documents error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/objectifs-commerciaux/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "objectifs", ids);
    const result = await db.delete(objectifsCommerciauxTable).where(and(eq(objectifsCommerciauxTable.organisationId, orgId), inArray(objectifsCommerciauxTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete objectifs error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/objectifs-commerciaux/status", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, status } = req.body as { ids: number[]; status: string };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    const validStatuses = ["actif", "termine", "archive"];
    if (!validStatuses.includes(status)) { res.status(400).json({ error: "Statut invalide" }); return; }
    await db.update(objectifsCommerciauxTable).set({ status }).where(and(eq(objectifsCommerciauxTable.organisationId, orgId), inArray(objectifsCommerciauxTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk status objectifs error");
    res.status(500).json({ error: "Erreur" });
  }
});

router.post("/bulk/notes-internes/delete", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "notes_internes", ids);
    const result = await db.delete(notesInternesTable).where(and(eq(notesInternesTable.organisationId, orgId), inArray(notesInternesTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete notes-internes error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/notes-internes/color", requireMinOperateur, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, color } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    const validColors = ["default", "yellow", "blue", "green", "pink", "violet", "orange"];
    if (!validColors.includes(color)) { res.status(400).json({ error: "Couleur invalide" }); return; }
    await db.update(notesInternesTable).set({ color }).where(and(eq(notesInternesTable.organisationId, orgId), inArray(notesInternesTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk color notes-internes error");
    res.status(500).json({ error: "Erreur" });
  }
});

router.post("/bulk/projets/delete", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    auditBulk(req, "bulk_delete", "projets", ids);
    const result = await db.delete(projetsTable).where(and(eq(projetsTable.organisationId, orgId), inArray(projetsTable.id, ids)));
    res.json({ deleted: result.rowCount ?? ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete projets error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/bulk/projets/status", requireMinAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { ids, status } = req.body as { ids: number[]; status: string };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    const validStatuses = ["planifie", "en_cours", "en_pause", "termine", "annule"];
    if (!validStatuses.includes(status)) { res.status(400).json({ error: "Statut invalide" }); return; }
    await db.update(projetsTable).set({ status, updatedAt: new Date() }).where(and(eq(projetsTable.organisationId, orgId), inArray(projetsTable.id, ids)));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk status projets error");
    res.status(500).json({ error: "Erreur" });
  }
});

export default router;
