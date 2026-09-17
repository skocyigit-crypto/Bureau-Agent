import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, notesInternesTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { rowId } from "../lib/request-params";
import { validerNote } from "../services/note-interne";
import { archiveDeletedRows, deletionContext } from "../services/trash";
import { celluleCsv, SEPARATEUR_CSV } from "../lib/csv";

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
    // `req.user` n'est alimente nulle part : l'auteur etait toujours NULL.
    const userId = req.session?.userId ?? null;
    const v = validerNote(req.body, false);
    if (!v.ok) { res.status(400).json({ error: v.erreur }); return; }
    const [row] = await db.insert(notesInternesTable).values({
      organisationId: orgId,
      userId,
      title: v.champs.title ?? null,
      content: v.champs.content!,
      color: v.champs.color!,
      pinned: v.champs.pinned!,
      tags: v.champs.tags!,
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
    const id = rowId(req.params.id);
    if (id === null) { res.status(400).json({ error: "Identifiant invalide." }); return; }
    const [existing] = await db.select().from(notesInternesTable)
      .where(and(eq(notesInternesTable.id, id), eq(notesInternesTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Note introuvable" }); return; }
    const v = validerNote(req.body, true);
    if (!v.ok) { res.status(400).json({ error: v.erreur }); return; }
    const updates = { ...v.champs, updatedAt: new Date() };
    const [row] = await db.update(notesInternesTable).set(updates).where(and(eq(notesInternesTable.id, id), eq(notesInternesTable.organisationId, orgId))).returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "PUT /notes-internes/:id");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.delete("/notes-internes/:id", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const id = rowId(req.params.id);
    if (id === null) { res.status(400).json({ error: "Identifiant invalide." }); return; }
    const deleted = await db.delete(notesInternesTable)
      .where(and(eq(notesInternesTable.id, id), eq(notesInternesTable.organisationId, orgId)))
      .returning();
    if (deleted.length === 0) { res.status(404).json({ error: "Note introuvable." }); return; }
    await archiveDeletedRows(notesInternesTable, deleted, deletionContext(req, orgId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /notes-internes/:id");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/notes-internes/:id/duplicate", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    // `req.user` n'est alimente nulle part : l'auteur etait toujours NULL.
    const userId = req.session?.userId ?? null;
    const id = rowId(req.params.id);
    if (id === null) { res.status(400).json({ error: "Identifiant invalide." }); return; }
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
    const escape = celluleCsv;
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "";
    const lines = [headers.map(celluleCsv).join(SEPARATEUR_CSV), ...rows.map(r => [
      escape(r.title), escape(r.content), escape(r.color),
      r.pinned ? "Oui" : "Non", escape(Array.isArray(r.tags) ? r.tags.join(";") : ""),
      escape(fmtDate(r.createdAt)), escape(fmtDate(r.updatedAt)),
    ].join(SEPARATEUR_CSV))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="notes_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err) {
    req.log.error({ err }, "GET /notes-internes/export/csv");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
