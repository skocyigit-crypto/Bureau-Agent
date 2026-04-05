import { Router, type IRouter } from "express";
import { eq, desc, asc, sql } from "drizzle-orm";
import {
  db, situationsTable, chantierNotesTable, chantierCommandesTable,
  chantierSousTraitanceTable, chantierPlanningTable, chantierTachesTable, chantierMailsTable,
} from "@workspace/db";

const router: IRouter = Router();

router.get("/chantiers/:chantierId/situations", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  if (isNaN(chantierId)) { res.status(400).json({ error: "ID invalide" }); return; }
  const situations = await db.select().from(situationsTable).where(eq(situationsTable.chantierId, chantierId)).orderBy(asc(situationsTable.numero));
  res.json({ situations });
});

router.post("/chantiers/:chantierId/situations", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  if (isNaN(chantierId)) { res.status(400).json({ error: "ID invalide" }); return; }
  const existing = await db.select({ count: sql<number>`count(*)::int` }).from(situationsTable).where(eq(situationsTable.chantierId, chantierId));
  const nextNumero = (existing[0]?.count ?? 0) + 1;
  const { type, description, pourcentage, montantHt, notes } = req.body;
  const tva = 20;
  const ttc = Number(montantHt || 0) * (1 + tva / 100);
  const [situation] = await db.insert(situationsTable).values({
    chantierId, numero: nextNumero, type: type || "general", description,
    pourcentage: String(pourcentage || 0), montantHt: String(montantHt || 0),
    montantTtc: ttc.toFixed(2), statut: "en_cours", notes,
  }).returning();
  res.status(201).json(situation);
});

router.patch("/situations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [updated] = await db.update(situationsTable).set(req.body).where(eq(situationsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Situation non trouvee" }); return; }
  res.json(updated);
});

router.delete("/situations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  await db.delete(situationsTable).where(eq(situationsTable.id, id));
  res.status(204).send();
});

router.get("/chantiers/:chantierId/notes", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const notes = await db.select().from(chantierNotesTable).where(eq(chantierNotesTable.chantierId, chantierId)).orderBy(desc(chantierNotesTable.createdAt));
  res.json({ notes });
});

router.post("/chantiers/:chantierId/notes", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const { contenu, auteur } = req.body;
  if (!contenu) { res.status(400).json({ error: "Contenu obligatoire" }); return; }
  const [note] = await db.insert(chantierNotesTable).values({ chantierId, contenu, auteur }).returning();
  res.status(201).json(note);
});

router.get("/chantiers/:chantierId/commandes", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const commandes = await db.select().from(chantierCommandesTable).where(eq(chantierCommandesTable.chantierId, chantierId)).orderBy(desc(chantierCommandesTable.createdAt));
  res.json({ commandes });
});

router.post("/chantiers/:chantierId/commandes", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const { reference, fournisseur, description, montant, dateLivraison } = req.body;
  if (!reference || !fournisseur) { res.status(400).json({ error: "Reference et fournisseur obligatoires" }); return; }
  const [cmd] = await db.insert(chantierCommandesTable).values({
    chantierId, reference, fournisseur, description, montant: String(montant || 0),
    dateLivraison: dateLivraison ? new Date(dateLivraison) : undefined,
  }).returning();
  res.status(201).json(cmd);
});

router.get("/chantiers/:chantierId/sous-traitance", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const items = await db.select().from(chantierSousTraitanceTable).where(eq(chantierSousTraitanceTable.chantierId, chantierId)).orderBy(desc(chantierSousTraitanceTable.createdAt));
  res.json({ sousTraitance: items });
});

router.post("/chantiers/:chantierId/sous-traitance", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const { entreprise, metier, contact, telephone, montant, notes } = req.body;
  if (!entreprise || !metier) { res.status(400).json({ error: "Entreprise et metier obligatoires" }); return; }
  const [item] = await db.insert(chantierSousTraitanceTable).values({
    chantierId, entreprise, metier, contact, telephone, montant: String(montant || 0), notes,
  }).returning();
  res.status(201).json(item);
});

router.get("/chantiers/:chantierId/planning", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const items = await db.select().from(chantierPlanningTable).where(eq(chantierPlanningTable.chantierId, chantierId)).orderBy(asc(chantierPlanningTable.dateDebut));
  res.json({ planning: items });
});

router.post("/chantiers/:chantierId/planning", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const { titre, metier, dateDebut, dateFin, responsable } = req.body;
  if (!titre || !dateDebut || !dateFin) { res.status(400).json({ error: "Titre et dates obligatoires" }); return; }
  const [item] = await db.insert(chantierPlanningTable).values({
    chantierId, titre, metier, dateDebut: new Date(dateDebut), dateFin: new Date(dateFin), responsable,
  }).returning();
  res.status(201).json(item);
});

router.get("/chantiers/:chantierId/taches", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const taches = await db.select().from(chantierTachesTable).where(eq(chantierTachesTable.chantierId, chantierId)).orderBy(desc(chantierTachesTable.createdAt));
  res.json({ taches });
});

router.post("/chantiers/:chantierId/taches", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const { titre, description, assigneA, priorite, dateEcheance } = req.body;
  if (!titre) { res.status(400).json({ error: "Titre obligatoire" }); return; }
  const [tache] = await db.insert(chantierTachesTable).values({
    chantierId, titre, description, assigneA, priorite: priorite || "moyenne",
    dateEcheance: dateEcheance ? new Date(dateEcheance) : undefined,
  }).returning();
  res.status(201).json(tache);
});

router.patch("/chantiers/taches/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [updated] = await db.update(chantierTachesTable).set(req.body).where(eq(chantierTachesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Tache non trouvee" }); return; }
  res.json(updated);
});

router.get("/chantiers/:chantierId/mails", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const mails = await db.select().from(chantierMailsTable).where(eq(chantierMailsTable.chantierId, chantierId)).orderBy(desc(chantierMailsTable.createdAt));
  res.json({ mails });
});

router.post("/chantiers/:chantierId/mails", async (req, res): Promise<void> => {
  const chantierId = Number(req.params.chantierId);
  const { destinataire, objet, contenu } = req.body;
  if (!destinataire || !objet || !contenu) { res.status(400).json({ error: "Destinataire, objet et contenu obligatoires" }); return; }
  const [mail] = await db.insert(chantierMailsTable).values({ chantierId, destinataire, objet, contenu }).returning();
  res.status(201).json(mail);
});

export default router;
