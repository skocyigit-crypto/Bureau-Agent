import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, objectifsCommerciauxTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";

const router: IRouter = Router();

router.get("/objectifs-commerciaux", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const rows = await db.select().from(objectifsCommerciauxTable)
      .where(eq(objectifsCommerciauxTable.organisationId, orgId))
      .orderBy(desc(objectifsCommerciauxTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /objectifs-commerciaux");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/objectifs-commerciaux", requireRole("manager"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const { title, metric = "revenue", targetValue, currentValue = 0, period = "monthly", startDate, endDate, notes } = req.body;
    if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
    if (!targetValue || Number(targetValue) <= 0) { res.status(400).json({ error: "La valeur cible doit être supérieure à 0." }); return; }
    const [row] = await db.insert(objectifsCommerciauxTable).values({
      organisationId: orgId,
      title: title.trim(),
      metric,
      targetValue: String(targetValue),
      currentValue: String(currentValue),
      period,
      startDate: startDate || null,
      endDate: endDate || null,
      notes: notes || null,
      status: "actif",
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "POST /objectifs-commerciaux");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.put("/objectifs-commerciaux/:id", requireRole("manager"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(objectifsCommerciauxTable).where(and(eq(objectifsCommerciauxTable.id, id), eq(objectifsCommerciauxTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Objectif introuvable" }); return; }
    const { title, metric, targetValue, currentValue, period, startDate, endDate, status, notes } = req.body;
    const updates: any = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title.trim();
    if (metric !== undefined) updates.metric = metric;
    if (targetValue !== undefined) updates.targetValue = String(targetValue);
    if (currentValue !== undefined) updates.currentValue = String(currentValue);
    if (period !== undefined) updates.period = period;
    if (startDate !== undefined) updates.startDate = startDate || null;
    if (endDate !== undefined) updates.endDate = endDate || null;
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes || null;
    const [row] = await db.update(objectifsCommerciauxTable).set(updates).where(eq(objectifsCommerciauxTable.id, id)).returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "PUT /objectifs-commerciaux/:id");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.delete("/objectifs-commerciaux/:id", requireRole("manager"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id as string);
    await db.delete(objectifsCommerciauxTable).where(and(eq(objectifsCommerciauxTable.id, id), eq(objectifsCommerciauxTable.organisationId, orgId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /objectifs-commerciaux/:id");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/objectifs-commerciaux/export/csv", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const rows = await db.select().from(objectifsCommerciauxTable)
      .where(eq(objectifsCommerciauxTable.organisationId, orgId))
      .orderBy(desc(objectifsCommerciauxTable.createdAt));
    const headers = ["Titre", "Type", "Valeur cible", "Valeur actuelle", "Unité", "Période", "Statut", "Créé le"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "";
    const lines = [headers.join(","), ...rows.map((r: any) => [
      escape(r.title), escape(r.type), escape(r.targetValue),
      escape(r.currentValue), escape(r.unit), escape(r.period),
      escape(r.status), escape(fmtDate(r.createdAt)),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="objectifs_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err) {
    req.log.error({ err }, "GET /objectifs-commerciaux/export/csv");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
