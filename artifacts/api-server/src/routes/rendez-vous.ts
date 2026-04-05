import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and, gte, lte } from "drizzle-orm";
import { db, rendezVousTable, prospectsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/rendez-vous", async (req, res): Promise<void> => {
  const { search, statut, type, dateFrom, dateTo, limit, offset, sortBy, sortOrder } = req.query as any;

  const conditions = [];
  if (statut && statut !== "all") conditions.push(eq(rendezVousTable.statut, statut));
  if (type && type !== "all") conditions.push(eq(rendezVousTable.type, type));
  if (dateFrom) conditions.push(gte(rendezVousTable.dateDebut, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(rendezVousTable.dateDebut, new Date(dateTo)));
  if (search) {
    conditions.push(or(
      ilike(rendezVousTable.titre, `%${search}%`),
      ilike(rendezVousTable.contactNom, `%${search}%`),
      ilike(rendezVousTable.telephone, `%${search}%`)
    ));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const orderFn = sortOrder === "desc" ? desc : asc;
  const sortCol = sortBy === "titre" ? rendezVousTable.titre : sortBy === "statut" ? rendezVousTable.statut : rendezVousTable.dateDebut;

  const [rdvs, countResult] = await Promise.all([
    db.select({
      id: rendezVousTable.id, titre: rendezVousTable.titre, description: rendezVousTable.description,
      prospectId: rendezVousTable.prospectId, contactNom: rendezVousTable.contactNom,
      telephone: rendezVousTable.telephone, type: rendezVousTable.type,
      dateDebut: rendezVousTable.dateDebut, dateFin: rendezVousTable.dateFin,
      lieu: rendezVousTable.lieu, statut: rendezVousTable.statut, rappel: rendezVousTable.rappel,
      callId: rendezVousTable.callId, notes: rendezVousTable.notes,
      createdAt: rendezVousTable.createdAt, updatedAt: rendezVousTable.updatedAt,
      prospectNom: prospectsTable.nom, prospectPrenom: prospectsTable.prenom,
    })
      .from(rendezVousTable)
      .leftJoin(prospectsTable, eq(rendezVousTable.prospectId, prospectsTable.id))
      .where(whereClause)
      .orderBy(orderFn(sortCol))
      .limit(Number(limit) || 50)
      .offset(Number(offset) || 0),
    db.select({ count: sql<number>`count(*)::int` }).from(rendezVousTable).where(whereClause),
  ]);

  res.json({ rendezVous: rdvs, total: countResult[0]?.count ?? 0 });
});

router.get("/rendez-vous/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [rdv] = await db.select({
    id: rendezVousTable.id, titre: rendezVousTable.titre, description: rendezVousTable.description,
    prospectId: rendezVousTable.prospectId, contactNom: rendezVousTable.contactNom,
    telephone: rendezVousTable.telephone, type: rendezVousTable.type,
    dateDebut: rendezVousTable.dateDebut, dateFin: rendezVousTable.dateFin,
    lieu: rendezVousTable.lieu, statut: rendezVousTable.statut, rappel: rendezVousTable.rappel,
    callId: rendezVousTable.callId, notes: rendezVousTable.notes,
    createdAt: rendezVousTable.createdAt, updatedAt: rendezVousTable.updatedAt,
    prospectNom: prospectsTable.nom, prospectPrenom: prospectsTable.prenom,
  })
    .from(rendezVousTable)
    .leftJoin(prospectsTable, eq(rendezVousTable.prospectId, prospectsTable.id))
    .where(eq(rendezVousTable.id, id));
  if (!rdv) { res.status(404).json({ error: "Rendez-vous non trouve" }); return; }
  res.json(rdv);
});

const VALID_TYPES = ["rdv", "appel", "visite", "reunion"];
const VALID_STATUTS = ["planifie", "confirme", "annule", "termine"];

router.post("/rendez-vous", async (req, res): Promise<void> => {
  const { titre, description, prospectId, contactNom, telephone, type, dateDebut, dateFin, lieu, rappel, callId, notes } = req.body;
  if (!titre || !dateDebut || !dateFin) {
    res.status(400).json({ error: "Titre, date debut et date fin sont obligatoires" });
    return;
  }
  if (type && !VALID_TYPES.includes(type)) {
    res.status(400).json({ error: "Type invalide" });
    return;
  }
  const [rdv] = await db.insert(rendezVousTable).values({
    titre, description, prospectId: prospectId || null, contactNom, telephone,
    type: type || "rdv", dateDebut: new Date(dateDebut), dateFin: new Date(dateFin),
    lieu, statut: "planifie", rappel: rappel || "30min", callId: callId || null, notes,
  }).returning();
  res.status(201).json(rdv);
});

router.patch("/rendez-vous/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const { titre, description, contactNom, telephone, type, dateDebut, dateFin, lieu, statut, rappel, notes } = req.body;
  if (type && !VALID_TYPES.includes(type)) { res.status(400).json({ error: "Type invalide" }); return; }
  if (statut && !VALID_STATUTS.includes(statut)) { res.status(400).json({ error: "Statut invalide" }); return; }
  const updateData: Record<string, any> = {};
  if (titre !== undefined) updateData.titre = titre;
  if (description !== undefined) updateData.description = description;
  if (contactNom !== undefined) updateData.contactNom = contactNom;
  if (telephone !== undefined) updateData.telephone = telephone;
  if (type !== undefined) updateData.type = type;
  if (dateDebut !== undefined) updateData.dateDebut = new Date(dateDebut);
  if (dateFin !== undefined) updateData.dateFin = new Date(dateFin);
  if (lieu !== undefined) updateData.lieu = lieu;
  if (statut !== undefined) updateData.statut = statut;
  if (rappel !== undefined) updateData.rappel = rappel;
  if (notes !== undefined) updateData.notes = notes;
  const [updated] = await db.update(rendezVousTable).set(updateData).where(eq(rendezVousTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Rendez-vous non trouve" }); return; }
  res.json(updated);
});

router.delete("/rendez-vous/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [deleted] = await db.delete(rendezVousTable).where(eq(rendezVousTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Rendez-vous non trouve" }); return; }
  res.status(204).send();
});

export default router;
