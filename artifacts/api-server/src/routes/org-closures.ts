import { Router, type Request, type Response } from "express";
import { db, organisationClosuresTable } from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime());
}

router.get("/org-closures", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "Non autorise." });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(organisationClosuresTable)
      .where(eq(organisationClosuresTable.organisationId, orgId))
      .orderBy(asc(organisationClosuresTable.dateStart));

    res.json(rows);
  } catch (err: any) {
    req.log.error({ err }, "Erreur GET org-closures");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.post("/org-closures", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userRole = req.session?.userRole;

  if (!orgId) {
    res.status(403).json({ error: "Non autorise." });
    return;
  }

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Seuls les administrateurs peuvent gerer les fermetures." });
    return;
  }

  const { dateStart, dateEnd, label } = req.body;

  if (!dateStart || typeof dateStart !== "string" || !isValidDate(dateStart)) {
    res.status(400).json({ error: "Date de debut invalide (format attendu YYYY-MM-DD)." });
    return;
  }

  const end = dateEnd && typeof dateEnd === "string" && dateEnd.trim() ? dateEnd.trim() : dateStart;

  if (!isValidDate(end)) {
    res.status(400).json({ error: "Date de fin invalide (format attendu YYYY-MM-DD)." });
    return;
  }

  if (end < dateStart) {
    res.status(400).json({ error: "La date de fin doit etre posterieure ou egale a la date de debut." });
    return;
  }

  const labelVal = label && typeof label === "string" ? label.trim().slice(0, 200) || null : null;

  try {
    const [row] = await db
      .insert(organisationClosuresTable)
      .values({
        organisationId: orgId,
        dateStart: dateStart.trim(),
        dateEnd: end,
        label: labelVal,
      })
      .returning();

    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur POST org-closures");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.delete("/org-closures/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userRole = req.session?.userRole;

  if (!orgId) {
    res.status(403).json({ error: "Non autorise." });
    return;
  }

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Seuls les administrateurs peuvent gerer les fermetures." });
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }

  try {
    const result = await db
      .delete(organisationClosuresTable)
      .where(and(eq(organisationClosuresTable.id, id), eq(organisationClosuresTable.organisationId, orgId)))
      .returning({ id: organisationClosuresTable.id });

    if (result.length === 0) {
      res.status(404).json({ error: "Fermeture introuvable." });
      return;
    }

    res.json({ message: "Fermeture supprimee." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur DELETE org-closures");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

export default router;
