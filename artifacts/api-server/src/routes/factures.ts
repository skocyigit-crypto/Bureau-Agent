import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, facturesTable, prospectsTable, devisTable } from "@workspace/db";

const router: IRouter = Router();

const factureSortColumns: Record<string, any> = {
  createdAt: facturesTable.createdAt,
  numero: facturesTable.numero,
  montantTtc: facturesTable.montantTtc,
  statut: facturesTable.statut,
  dateEmission: facturesTable.dateEmission,
};

router.get("/factures", async (req, res): Promise<void> => {
  const { search, statut, type, limit, offset, sortBy, sortOrder } = req.query as any;

  const conditions = [];
  if (statut && statut !== "all") {
    conditions.push(eq(facturesTable.statut, statut));
  }
  if (type && type !== "all") {
    conditions.push(eq(facturesTable.type, type));
  }
  if (search) {
    conditions.push(
      or(
        ilike(facturesTable.numero, `%${search}%`),
        ilike(facturesTable.objet, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const sortCol = factureSortColumns[sortBy ?? "createdAt"] ?? facturesTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const [factures, countResult] = await Promise.all([
    db.select({
      id: facturesTable.id,
      numero: facturesTable.numero,
      devisId: facturesTable.devisId,
      prospectId: facturesTable.prospectId,
      type: facturesTable.type,
      objet: facturesTable.objet,
      dateEmission: facturesTable.dateEmission,
      dateEcheance: facturesTable.dateEcheance,
      montantHt: facturesTable.montantHt,
      tva: facturesTable.tva,
      montantTtc: facturesTable.montantTtc,
      pourcentageAcompte: facturesTable.pourcentageAcompte,
      montantPaye: facturesTable.montantPaye,
      statut: facturesTable.statut,
      notes: facturesTable.notes,
      createdAt: facturesTable.createdAt,
      updatedAt: facturesTable.updatedAt,
      prospectNom: prospectsTable.nom,
      prospectPrenom: prospectsTable.prenom,
      prospectSociete: prospectsTable.societe,
    })
      .from(facturesTable)
      .leftJoin(prospectsTable, eq(facturesTable.prospectId, prospectsTable.id))
      .where(whereClause)
      .orderBy(orderFn(sortCol))
      .limit(Number(limit) || 50)
      .offset(Number(offset) || 0),
    db.select({ count: sql<number>`count(*)::int` }).from(facturesTable).where(whereClause),
  ]);

  res.json({ factures, total: countResult[0]?.count ?? 0 });
});

router.get("/factures/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [facture] = await db.select({
    id: facturesTable.id,
    numero: facturesTable.numero,
    devisId: facturesTable.devisId,
    prospectId: facturesTable.prospectId,
    type: facturesTable.type,
    objet: facturesTable.objet,
    dateEmission: facturesTable.dateEmission,
    dateEcheance: facturesTable.dateEcheance,
    montantHt: facturesTable.montantHt,
    tva: facturesTable.tva,
    montantTtc: facturesTable.montantTtc,
    pourcentageAcompte: facturesTable.pourcentageAcompte,
    montantPaye: facturesTable.montantPaye,
    statut: facturesTable.statut,
    notes: facturesTable.notes,
    createdAt: facturesTable.createdAt,
    updatedAt: facturesTable.updatedAt,
    prospectNom: prospectsTable.nom,
    prospectPrenom: prospectsTable.prenom,
    prospectSociete: prospectsTable.societe,
    devisNumero: devisTable.numero,
  })
    .from(facturesTable)
    .leftJoin(prospectsTable, eq(facturesTable.prospectId, prospectsTable.id))
    .leftJoin(devisTable, eq(facturesTable.devisId, devisTable.id))
    .where(eq(facturesTable.id, id));

  if (!facture) { res.status(404).json({ error: "Facture non trouvee" }); return; }
  res.json(facture);
});

router.patch("/factures/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [updated] = await db.update(facturesTable).set(req.body).where(eq(facturesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Facture non trouvee" }); return; }
  res.json(updated);
});

router.delete("/factures/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db.delete(facturesTable).where(eq(facturesTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Facture non trouvee" }); return; }
  res.status(204).send();
});

export default router;
