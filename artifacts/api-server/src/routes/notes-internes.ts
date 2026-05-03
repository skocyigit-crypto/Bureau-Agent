import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, notesInternesTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";

const router: IRouter = Router();

router.get("/notes-internes", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const rows = await db.select().from(notesInternesTable)
      .where(eq(notesInternesTable.organisationId, orgId))
      .orderBy((t) => [desc(t.pinned), desc(t.updatedAt)]);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /notes-internes");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/notes-internes", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = (req as any).user?.id || null;
    const { title, content, color = "default", pinned = false, tags } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: "Le contenu est obligatoire." }); return; }
    const [row] = await db.insert(notesInternesTable).values({
      organisationId: orgId,
      userId,
      title: title?.trim() || null,
      content: content.trim(),
      color,
      pinned: !!pinned,
      tags: Array.isArray(tags) ? tags : [],
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "POST /notes-internes");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.put("/notes-internes/:id", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(notesInternesTable)
      .where(and(eq(notesInternesTable.id, id), eq(notesInternesTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Note introuvable" }); return; }
    const { title, content, color, pinned, tags } = req.body;
    const updates: any = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title?.trim() || null;
    if (content !== undefined) updates.content = content.trim();
    if (color !== undefined) updates.color = color;
    if (pinned !== undefined) updates.pinned = !!pinned;
    if (tags !== undefined) updates.tags = Array.isArray(tags) ? tags : [];
    const [row] = await db.update(notesInternesTable).set(updates).where(eq(notesInternesTable.id, id)).returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "PUT /notes-internes/:id");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.delete("/notes-internes/:id", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const id = parseInt(req.params.id as string);
    await db.delete(notesInternesTable)
      .where(and(eq(notesInternesTable.id, id), eq(notesInternesTable.organisationId, orgId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /notes-internes/:id");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/notes-internes/:id/duplicate", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = (req as any).user?.id || null;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(notesInternesTable)
      .where(and(eq(notesInternesTable.id, id), eq(notesInternesTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Note introuvable" }); return; }
    const [row] = await db.insert(notesInternesTable).values({
      organisationId: orgId,
      userId,
      title: existing.title ? `${existing.title} (copie)` : null,
      content: existing.content,
      color: existing.color,
      pinned: false,
      tags: existing.tags,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "POST /notes-internes/:id/duplicate");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/notes-internes/export/csv", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const rows = await db.select().from(notesInternesTable)
      .where(eq(notesInternesTable.organisationId, orgId))
      .orderBy(desc(notesInternesTable.updatedAt));
    const headers = ["Titre", "Contenu", "Couleur", "Épinglé", "Tags", "Créé le", "Modifié le"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "";
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.title), escape(r.content), escape(r.color),
      r.pinned ? "Oui" : "Non", escape(Array.isArray(r.tags) ? r.tags.join(";") : ""),
      escape(fmtDate(r.createdAt)), escape(fmtDate(r.updatedAt)),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="notes_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err) {
    req.log.error({ err }, "GET /notes-internes/export/csv");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
