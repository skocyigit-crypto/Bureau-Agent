import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, chantiersTable, prospectsTable, devisTable } from "@workspace/db";

const router: IRouter = Router();

const chantierSortColumns: Record<string, any> = {
  createdAt: chantiersTable.createdAt,
  nom: chantiersTable.nom,
  metier: chantiersTable.metier,
  statut: chantiersTable.statut,
  dateDebut: chantiersTable.dateDebut,
};

router.get("/chantiers", async (req, res): Promise<void> => {
  const { search, statut, metier, limit, offset, sortBy, sortOrder } = req.query as any;

  const conditions = [];
  if (statut && statut !== "all") {
    conditions.push(eq(chantiersTable.statut, statut));
  }
  if (metier && metier !== "all") {
    conditions.push(eq(chantiersTable.metier, metier));
  }
  if (search) {
    conditions.push(
      or(
        ilike(chantiersTable.nom, `%${search}%`),
        ilike(chantiersTable.metier, `%${search}%`),
        ilike(chantiersTable.responsable, `%${search}%`),
        ilike(chantiersTable.adresse, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const sortCol = chantierSortColumns[sortBy ?? "createdAt"] ?? chantiersTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const [chantiers, countResult] = await Promise.all([
    db.select({
      id: chantiersTable.id,
      nom: chantiersTable.nom,
      devisId: chantiersTable.devisId,
      prospectId: chantiersTable.prospectId,
      metier: chantiersTable.metier,
      adresse: chantiersTable.adresse,
      description: chantiersTable.description,
      dateDebut: chantiersTable.dateDebut,
      dateFinPrevue: chantiersTable.dateFinPrevue,
      dateFinReelle: chantiersTable.dateFinReelle,
      statut: chantiersTable.statut,
      responsable: chantiersTable.responsable,
      notes: chantiersTable.notes,
      createdAt: chantiersTable.createdAt,
      updatedAt: chantiersTable.updatedAt,
      prospectNom: prospectsTable.nom,
      prospectPrenom: prospectsTable.prenom,
      prospectSociete: prospectsTable.societe,
      devisNumero: devisTable.numero,
    })
      .from(chantiersTable)
      .leftJoin(prospectsTable, eq(chantiersTable.prospectId, prospectsTable.id))
      .leftJoin(devisTable, eq(chantiersTable.devisId, devisTable.id))
      .where(whereClause)
      .orderBy(orderFn(sortCol))
      .limit(Number(limit) || 50)
      .offset(Number(offset) || 0),
    db.select({ count: sql<number>`count(*)::int` }).from(chantiersTable).where(whereClause),
  ]);

  res.json({ chantiers, total: countResult[0]?.count ?? 0 });
});

router.get("/chantiers/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [chantier] = await db.select({
    id: chantiersTable.id,
    nom: chantiersTable.nom,
    devisId: chantiersTable.devisId,
    prospectId: chantiersTable.prospectId,
    metier: chantiersTable.metier,
    adresse: chantiersTable.adresse,
    description: chantiersTable.description,
    dateDebut: chantiersTable.dateDebut,
    dateFinPrevue: chantiersTable.dateFinPrevue,
    dateFinReelle: chantiersTable.dateFinReelle,
    statut: chantiersTable.statut,
    responsable: chantiersTable.responsable,
    notes: chantiersTable.notes,
    createdAt: chantiersTable.createdAt,
    updatedAt: chantiersTable.updatedAt,
    prospectNom: prospectsTable.nom,
    prospectPrenom: prospectsTable.prenom,
    prospectSociete: prospectsTable.societe,
    devisNumero: devisTable.numero,
  })
    .from(chantiersTable)
    .leftJoin(prospectsTable, eq(chantiersTable.prospectId, prospectsTable.id))
    .leftJoin(devisTable, eq(chantiersTable.devisId, devisTable.id))
    .where(eq(chantiersTable.id, id));

  if (!chantier) { res.status(404).json({ error: "Chantier non trouve" }); return; }
  res.json(chantier);
});

router.post("/chantiers", async (req, res): Promise<void> => {
  const { nom, devisId, prospectId, metier, adresse, description, dateDebut, dateFinPrevue, responsable, notes } = req.body;
  if (!nom || !metier) {
    res.status(400).json({ error: "nom et metier sont obligatoires" });
    return;
  }

  const [chantier] = await db.insert(chantiersTable).values({
    nom, devisId, prospectId, metier, adresse, description,
    dateDebut: dateDebut ? new Date(dateDebut) : undefined,
    dateFinPrevue: dateFinPrevue ? new Date(dateFinPrevue) : undefined,
    responsable, notes, statut: "planifie",
  }).returning();

  res.status(201).json(chantier);
});

router.patch("/chantiers/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const updateData = { ...req.body };
  if (updateData.dateDebut) updateData.dateDebut = new Date(updateData.dateDebut);
  if (updateData.dateFinPrevue) updateData.dateFinPrevue = new Date(updateData.dateFinPrevue);
  if (updateData.dateFinReelle) updateData.dateFinReelle = new Date(updateData.dateFinReelle);

  const [updated] = await db.update(chantiersTable).set(updateData).where(eq(chantiersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Chantier non trouve" }); return; }
  res.json(updated);
});

router.delete("/chantiers/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db.delete(chantiersTable).where(eq(chantiersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Chantier non trouve" }); return; }
  res.status(204).send();
});

export default router;
