import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, prospectsTable } from "@workspace/db";

const router: IRouter = Router();

const prospectSortColumns: Record<string, any> = {
  createdAt: prospectsTable.createdAt,
  nom: prospectsTable.nom,
  societe: prospectsTable.societe,
  statut: prospectsTable.statut,
};

router.get("/prospects", async (req, res): Promise<void> => {
  const { search, statut, limit, offset, sortBy, sortOrder } = req.query as any;

  const conditions = [];
  if (statut && statut !== "all") {
    conditions.push(eq(prospectsTable.statut, statut));
  }
  if (search) {
    conditions.push(
      or(
        ilike(prospectsTable.nom, `%${search}%`),
        ilike(prospectsTable.prenom, `%${search}%`),
        ilike(prospectsTable.societe, `%${search}%`),
        ilike(prospectsTable.email, `%${search}%`),
        ilike(prospectsTable.telephone, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const sortCol = prospectSortColumns[sortBy ?? "createdAt"] ?? prospectsTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const [prospects, countResult] = await Promise.all([
    db.select().from(prospectsTable).where(whereClause).orderBy(orderFn(sortCol)).limit(Number(limit) || 50).offset(Number(offset) || 0),
    db.select({ count: sql<number>`count(*)::int` }).from(prospectsTable).where(whereClause),
  ]);

  res.json({ prospects, total: countResult[0]?.count ?? 0 });
});

router.get("/prospects/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [prospect] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, id));
  if (!prospect) { res.status(404).json({ error: "Prospect non trouve" }); return; }
  res.json(prospect);
});

router.post("/prospects", async (req, res): Promise<void> => {
  const { prenom, nom, societe, email, telephone, mobile, adresse, ville, codePostal, source, notes } = req.body;
  if (!prenom || !nom || !telephone) {
    res.status(400).json({ error: "Prenom, nom et telephone sont obligatoires" });
    return;
  }

  const [prospect] = await db.insert(prospectsTable).values({
    prenom, nom, societe, email, telephone, mobile, adresse, ville, codePostal,
    source: source || "direct", statut: "prospect", notes,
  }).returning();

  res.status(201).json(prospect);
});

router.patch("/prospects/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [updated] = await db.update(prospectsTable).set(req.body).where(eq(prospectsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Prospect non trouve" }); return; }
  res.json(updated);
});

router.delete("/prospects/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db.delete(prospectsTable).where(eq(prospectsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Prospect non trouve" }); return; }
  res.status(204).send();
});

export default router;
