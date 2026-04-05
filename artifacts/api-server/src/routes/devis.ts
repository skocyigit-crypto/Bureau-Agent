import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, devisTable, devisLignesTable, prospectsTable, facturesTable, chantiersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const generateDevisNumero = () => {
  const now = new Date();
  const year = now.getFullYear();
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `DEV-${year}-${rand}`;
};

const generateFactureNumero = () => {
  const now = new Date();
  const year = now.getFullYear();
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `FAC-${year}-${rand}`;
};

const devisSortColumns: Record<string, any> = {
  createdAt: devisTable.createdAt,
  numero: devisTable.numero,
  montantTtc: devisTable.montantTtc,
  statut: devisTable.statut,
  dateCreation: devisTable.dateCreation,
};

router.get("/devis", async (req, res): Promise<void> => {
  const { search, statut, limit, offset, sortBy, sortOrder } = req.query as any;

  const conditions = [];
  if (statut && statut !== "all") {
    conditions.push(eq(devisTable.statut, statut));
  }
  if (search) {
    conditions.push(
      or(
        ilike(devisTable.numero, `%${search}%`),
        ilike(devisTable.objet, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const sortCol = devisSortColumns[sortBy ?? "createdAt"] ?? devisTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const [devisList, countResult] = await Promise.all([
    db.select({
      id: devisTable.id,
      numero: devisTable.numero,
      prospectId: devisTable.prospectId,
      objet: devisTable.objet,
      description: devisTable.description,
      dateCreation: devisTable.dateCreation,
      dateValidite: devisTable.dateValidite,
      statut: devisTable.statut,
      montantHt: devisTable.montantHt,
      tva: devisTable.tva,
      montantTtc: devisTable.montantTtc,
      conditions: devisTable.conditions,
      notes: devisTable.notes,
      createdAt: devisTable.createdAt,
      updatedAt: devisTable.updatedAt,
      prospectNom: prospectsTable.nom,
      prospectPrenom: prospectsTable.prenom,
      prospectSociete: prospectsTable.societe,
    })
      .from(devisTable)
      .leftJoin(prospectsTable, eq(devisTable.prospectId, prospectsTable.id))
      .where(whereClause)
      .orderBy(orderFn(sortCol))
      .limit(Number(limit) || 50)
      .offset(Number(offset) || 0),
    db.select({ count: sql<number>`count(*)::int` }).from(devisTable).where(whereClause),
  ]);

  res.json({ devis: devisList, total: countResult[0]?.count ?? 0 });
});

router.get("/devis/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [devis] = await db.select({
    id: devisTable.id,
    numero: devisTable.numero,
    prospectId: devisTable.prospectId,
    objet: devisTable.objet,
    description: devisTable.description,
    dateCreation: devisTable.dateCreation,
    dateValidite: devisTable.dateValidite,
    statut: devisTable.statut,
    montantHt: devisTable.montantHt,
    tva: devisTable.tva,
    montantTtc: devisTable.montantTtc,
    conditions: devisTable.conditions,
    notes: devisTable.notes,
    createdAt: devisTable.createdAt,
    updatedAt: devisTable.updatedAt,
    prospectNom: prospectsTable.nom,
    prospectPrenom: prospectsTable.prenom,
    prospectSociete: prospectsTable.societe,
  }).from(devisTable).leftJoin(prospectsTable, eq(devisTable.prospectId, prospectsTable.id)).where(eq(devisTable.id, id));

  if (!devis) { res.status(404).json({ error: "Devis non trouve" }); return; }

  const lignes = await db.select().from(devisLignesTable).where(eq(devisLignesTable.devisId, id)).orderBy(asc(devisLignesTable.ordre));

  res.json({ ...devis, lignes });
});

router.post("/devis", async (req, res): Promise<void> => {
  const { prospectId, objet, description, dateValidite, conditions, notes, lignes } = req.body;
  if (!prospectId || !objet) {
    res.status(400).json({ error: "prospectId et objet sont obligatoires" });
    return;
  }

  let montantHt = 0;
  if (lignes && Array.isArray(lignes)) {
    for (const l of lignes) {
      montantHt += Number(l.quantite || 1) * Number(l.prixUnitaire || 0);
    }
  }
  const tvaRate = 20;
  const montantTtc = montantHt * (1 + tvaRate / 100);

  const [devis] = await db.insert(devisTable).values({
    numero: generateDevisNumero(),
    prospectId,
    objet,
    description,
    dateValidite: dateValidite ? new Date(dateValidite) : undefined,
    statut: "brouillon",
    montantHt: montantHt.toFixed(2),
    tva: tvaRate.toFixed(2),
    montantTtc: montantTtc.toFixed(2),
    conditions,
    notes,
  }).returning();

  if (lignes && Array.isArray(lignes)) {
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i];
      const lMontant = Number(l.quantite || 1) * Number(l.prixUnitaire || 0);
      await db.insert(devisLignesTable).values({
        devisId: devis.id,
        description: l.description || "",
        metier: l.metier || null,
        quantite: String(l.quantite || 1),
        unite: l.unite || "unite",
        prixUnitaire: String(l.prixUnitaire || 0),
        montantHt: lMontant.toFixed(2),
        ordre: i,
      });
    }
  }

  res.status(201).json(devis);
});

router.patch("/devis/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { lignes, ...devisData } = req.body;

  if (devisData.statut === "accepte") {
    const [existing] = await db.select().from(devisTable).where(eq(devisTable.id, id));
    if (!existing) { res.status(404).json({ error: "Devis non trouve" }); return; }

    await db.update(devisTable).set({ statut: "accepte" }).where(eq(devisTable.id, id));

    await db.update(prospectsTable).set({ statut: "client" }).where(eq(prospectsTable.id, existing.prospectId));

    const pourcentageAcompte = 30;
    const acompteMontantHt = Number(existing.montantHt) * (pourcentageAcompte / 100);
    const acompteTva = Number(existing.tva);
    const acompteMontantTtc = acompteMontantHt * (1 + acompteTva / 100);

    await db.insert(facturesTable).values({
      numero: generateFactureNumero(),
      devisId: id,
      prospectId: existing.prospectId,
      type: "acompte",
      objet: `Acompte ${pourcentageAcompte}% - ${existing.objet}`,
      montantHt: acompteMontantHt.toFixed(2),
      tva: acompteTva.toFixed(2),
      montantTtc: acompteMontantTtc.toFixed(2),
      pourcentageAcompte: String(pourcentageAcompte),
      statut: "en_attente",
    });

    const existingLignes = await db.select().from(devisLignesTable).where(eq(devisLignesTable.devisId, id));

    const metiers = new Set<string>();
    for (const l of existingLignes) {
      if (l.metier) metiers.add(l.metier);
    }

    if (metiers.size === 0) {
      metiers.add("general");
    }

    const [prospect] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, existing.prospectId));

    for (const metier of metiers) {
      const metierLignes = existingLignes.filter(l => l.metier === metier || (!l.metier && metier === "general"));
      const metierDesc = metierLignes.map(l => l.description).join(", ");

      await db.insert(chantiersTable).values({
        nom: `${existing.objet} - ${metier.charAt(0).toUpperCase() + metier.slice(1)}`,
        devisId: id,
        prospectId: existing.prospectId,
        metier,
        adresse: prospect?.adresse || "",
        description: metierDesc || `Travaux de ${metier}`,
        statut: "planifie",
      });
    }

    logger.info({ devisId: id, metiers: Array.from(metiers) }, "Devis accepte: facture acompte + chantiers crees");

    const [updated] = await db.select().from(devisTable).where(eq(devisTable.id, id));
    res.json(updated);
    return;
  }

  if (lignes && Array.isArray(lignes)) {
    await db.delete(devisLignesTable).where(eq(devisLignesTable.devisId, id));
    let montantHt = 0;
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i];
      const lMontant = Number(l.quantite || 1) * Number(l.prixUnitaire || 0);
      montantHt += lMontant;
      await db.insert(devisLignesTable).values({
        devisId: id,
        description: l.description || "",
        metier: l.metier || null,
        quantite: String(l.quantite || 1),
        unite: l.unite || "unite",
        prixUnitaire: String(l.prixUnitaire || 0),
        montantHt: lMontant.toFixed(2),
        ordre: i,
      });
    }
    const tvaRate = Number(devisData.tva || 20);
    const montantTtc = montantHt * (1 + tvaRate / 100);
    devisData.montantHt = montantHt.toFixed(2);
    devisData.montantTtc = montantTtc.toFixed(2);
  }

  const [updated] = await db.update(devisTable).set(devisData).where(eq(devisTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Devis non trouve" }); return; }
  res.json(updated);
});

router.delete("/devis/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db.delete(devisTable).where(eq(devisTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Devis non trouve" }); return; }
  res.status(204).send();
});

export default router;
