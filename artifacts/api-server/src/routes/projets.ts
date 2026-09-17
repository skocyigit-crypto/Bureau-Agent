import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, or, sql, and, ne, type Column, type SQL } from "drizzle-orm";
import { db, projetsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { archiveDeletedRows, deletionContext } from "../services/trash";
import { etatReception } from "../services/garanties-chantier";
import { contactDeLOrganisation } from "../services/contact-organisation";
import { montantValide, pagination } from "../services/prospect-saisie";

/** Avancement entier 0-100 ; `null` si la saisie n'est pas un nombre. */
function avancementValide(saisie: unknown): number | null {
  if (saisie === "" || saisie === null || typeof saisie === "boolean") return null;
  const n = Number(saisie);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
}

/** Date optionnelle : `null` si vide, `undefined` si illisible. */
function dateOptionnelle(saisie: unknown): Date | null | undefined {
  if (saisie === null || saisie === undefined || saisie === "") return null;
  const d = new Date(String(saisie));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const router: IRouter = Router();

const STATUSES = ["planifie", "en_cours", "en_pause", "termine", "annule"] as const;
const PRIORITIES = ["haute", "moyenne", "basse"] as const;

const sortCols: Record<string, any> = {
  createdAt: projetsTable.createdAt,
  updatedAt: projetsTable.updatedAt,
  title: projetsTable.title,
  endDate: projetsTable.endDate,
  priority: projetsTable.priority,
  progress: projetsTable.progress,
  budget: projetsTable.budget,
};

router.get("/projets", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, status, priority, assignedTo, contactId: contactIdQ, sortBy = "createdAt", sortOrder = "desc" } = req.query as any;
  const { limit, offset } = pagination(req.query.limit, req.query.offset);

  const conditions = [eq(projetsTable.organisationId, orgId)];
  if (status && status !== "all") conditions.push(eq(projetsTable.status, status));
  if (priority && priority !== "all") conditions.push(eq(projetsTable.priority, priority));
  const useUnaccent = await ensureUnaccentExtension();
  if (assignedTo) conditions.push(accentInsensitiveIlike(projetsTable.assignedTo, `%${assignedTo}%`, useUnaccent));
  if (contactIdQ) {
    const cid = Number(contactIdQ);
    if (Number.isFinite(cid)) conditions.push(eq(projetsTable.contactId, cid));
  }
  if (search) {
    const pattern = `%${search}%`;
    const il = (col: Column): SQL => accentInsensitiveIlike(col, pattern, useUnaccent);
    conditions.push(or(
      il(projetsTable.title),
      il(projetsTable.clientName),
      il(projetsTable.clientCompany),
      il(projetsTable.description),
    )!);
  }

  const where = and(...conditions);
  const col = sortCols[sortBy] ?? projetsTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(projetsTable).where(where).orderBy(orderFn(col)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(projetsTable).where(where),
    ]);
    res.json({ projets: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste projets");
    res.status(500).json({ error: "Erreur lors de la recuperation des projets." });
  }
});

router.get("/projets/stats", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const [byStatus, totals, budgetStats] = await Promise.all([
      db.select({
        status: projetsTable.status,
        count: sql<number>`count(*)::int`,
      }).from(projetsTable).where(eq(projetsTable.organisationId, orgId)).groupBy(projetsTable.status),
      db.select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${projetsTable.status} not in ('termine','annule'))::int`,
        termine: sql<number>`count(*) filter (where ${projetsTable.status} = 'termine')::int`,
        overdue: sql<number>`count(*) filter (where ${projetsTable.endDate} < now() and ${projetsTable.status} not in ('termine','annule'))::int`,
        avgProgress: sql<number>`coalesce(avg(${projetsTable.progress}), 0)::int`,
        highPriority: sql<number>`count(*) filter (where ${projetsTable.priority} = 'haute' and ${projetsTable.status} not in ('termine','annule'))::int`,
      }).from(projetsTable).where(eq(projetsTable.organisationId, orgId)),
      db.select({
        totalBudget: sql<number>`coalesce(sum(${projetsTable.budget}::numeric), 0)::numeric`,
        totalSpent: sql<number>`coalesce(sum(${projetsTable.spent}::numeric), 0)::numeric`,
        overBudget: sql<number>`count(*) filter (where ${projetsTable.spent}::numeric > ${projetsTable.budget}::numeric and ${projetsTable.budget}::numeric > 0)::int`,
      }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), ne(projetsTable.status, "annule"))),
    ]);
    res.json({ byStatus, ...totals[0], ...budgetStats[0] });
  } catch (err: any) {
    req.log.error({ err }, "Erreur stats projets");
    res.status(500).json({ error: "Erreur lors des statistiques." });
  }
});

router.get("/projets/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(projetsTable).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId)));
    if (!row) { res.status(404).json({ error: "Projet non trouve." }); return; }
    // La reception des travaux est la date dont dependent les quatre
    // echeances legales du chantier — parfait achevement, bon fonctionnement,
    // decennale, restitution de la retenue de garantie. Elle n'existait pas
    // dans ce produit: le vocabulaire du chantier n'y figurait que dans la
    // fixture d'un test d'extraction PDF.
    //
    // Calcule a la lecture, jamais stocke: les durees sont des regles de
    // droit, pas des donnees du projet. Les figer en base ferait diverger les
    // chantiers anciens des nouveaux le jour ou une duree change.
    res.json({ ...row, chantier: etatReception(row) });
  } catch (err: any) {
    req.log.error({ err }, "Erreur get projet");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/projets", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const {
    title, description, status = "planifie", priority = "moyenne",
    clientName, clientCompany, address, budget, currency = "EUR",
    progress = 0, startDate, endDate, assignedTo, teamMembers,
    milestones, tags, notes, contactId,
  } = req.body;

  if (typeof title !== "string" || !title.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: "Statut invalide." }); return; }
  if (!(PRIORITIES as readonly unknown[]).includes(priority)) { res.status(400).json({ error: "Priorite invalide." }); return; }
  const avancement = avancementValide(progress);
  if (avancement === null) { res.status(400).json({ error: "L'avancement doit etre un nombre entre 0 et 100." }); return; }
  const budgetSaisi = montantValide(budget);
  if (budgetSaisi === undefined) { res.status(400).json({ error: "Budget invalide." }); return; }
  const debut = dateOptionnelle(startDate);
  const fin = dateOptionnelle(endDate);
  if (debut === undefined || fin === undefined) { res.status(400).json({ error: "Date invalide." }); return; }
  if (debut && fin && fin < debut) { res.status(400).json({ error: "La date de fin precede la date de debut." }); return; }

  try {
    const contactLie = await contactDeLOrganisation(contactId, orgId);
    if (contactLie === false) { res.status(400).json({ error: "Contact introuvable." }); return; }
    const [row] = await db.insert(projetsTable).values({
      organisationId: orgId,
      title: title.trim(),
      description,
      status,
      priority,
      clientName,
      clientCompany,
      address,
      budget: budgetSaisi,
      currency,
      progress: avancement,
      startDate: debut,
      endDate: fin,
      actualEndDate: status === "termine" ? new Date() : null,
      assignedTo,
      teamMembers: teamMembers || [],
      milestones: milestones || [],
      tags: tags || [],
      notes,
      contactId: contactLie,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation projet");
    res.status(500).json({ error: "Erreur lors de la creation." });
  }
});

router.patch("/projets/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [existing] = await db.select({ id: projetsTable.id, status: projetsTable.status }).from(projetsTable).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Projet non trouve." }); return; }

    const {
      title, description, status, priority, clientName, clientCompany,
      address, budget, spent, currency, progress, startDate, endDate,
      actualEndDate, assignedTo, teamMembers, milestones, tags, notes, contactId,
      receptionDate, receptionWithReserves, receptionReserves, reservesLiftedAt,
    } = req.body;

    const updates: any = { updatedAt: new Date() };
    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
      updates.title = title.trim();
    }
    if (description !== undefined) updates.description = description;
    if (status !== undefined) {
      if (!STATUSES.includes(status)) { res.status(400).json({ error: "Statut invalide." }); return; }
      updates.status = status;
      // La fin reelle se pose quand le chantier PASSE a « termine » (pas a
      // chaque re-enregistrement du formulaire), et s'efface s'il reprend.
      if (status !== existing.status) {
        if (status === "termine" && !actualEndDate) updates.actualEndDate = new Date();
        if (existing.status === "termine" && !actualEndDate) updates.actualEndDate = null;
      }
    }
    if (priority !== undefined) {
      if (!(PRIORITIES as readonly unknown[]).includes(priority)) { res.status(400).json({ error: "Priorite invalide." }); return; }
      updates.priority = priority;
    }
    if (clientName !== undefined) updates.clientName = clientName;
    if (clientCompany !== undefined) updates.clientCompany = clientCompany;
    if (address !== undefined) updates.address = address;
    if (budget !== undefined) {
      const m = montantValide(budget);
      if (m === undefined) { res.status(400).json({ error: "Budget invalide." }); return; }
      updates.budget = m;
    }
    if (spent !== undefined) {
      // `String(null)` enregistrait « null » : erreur SQL, donc 500.
      const m = montantValide(spent);
      if (m === undefined) { res.status(400).json({ error: "Depense invalide." }); return; }
      updates.spent = m ?? "0";
    }
    if (currency !== undefined) updates.currency = currency;
    if (progress !== undefined) {
      const p = avancementValide(progress);
      if (p === null) { res.status(400).json({ error: "L'avancement doit etre un nombre entre 0 et 100." }); return; }
      updates.progress = p;
    }
    for (const [cle, saisie] of [["startDate", startDate], ["endDate", endDate], ["actualEndDate", actualEndDate]] as const) {
      if (saisie === undefined) continue;
      const d = dateOptionnelle(saisie);
      if (d === undefined) { res.status(400).json({ error: "Date invalide." }); return; }
      updates[cle] = d;
    }
    // Reception des travaux. Une date illisible est REFUSEE plutot que
    // convertie en `Invalid Date`: elle ferait partir dix ans de garantie
    // decennale depuis un instant indefini, et l'erreur ne se verrait qu'au
    // sinistre.
    if (receptionDate !== undefined) {
      if (receptionDate === null || receptionDate === "") {
        updates.receptionDate = null;
      } else {
        const d = new Date(receptionDate);
        if (Number.isNaN(d.getTime())) {
          res.status(400).json({ error: "Date de reception invalide." });
          return;
        }
        updates.receptionDate = d;
      }
    }
    if (receptionWithReserves !== undefined) updates.receptionWithReserves = !!receptionWithReserves;
    if (receptionReserves !== undefined) updates.receptionReserves = receptionReserves || null;
    if (reservesLiftedAt !== undefined) {
      if (reservesLiftedAt === null || reservesLiftedAt === "") {
        updates.reservesLiftedAt = null;
      } else {
        const d = new Date(reservesLiftedAt);
        if (Number.isNaN(d.getTime())) {
          res.status(400).json({ error: "Date de levee des reserves invalide." });
          return;
        }
        updates.reservesLiftedAt = d;
      }
    }
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    if (teamMembers !== undefined) updates.teamMembers = teamMembers;
    if (milestones !== undefined) updates.milestones = milestones;
    if (tags !== undefined) updates.tags = tags;
    if (notes !== undefined) updates.notes = notes;
    if (contactId !== undefined) {
      const contactLie = await contactDeLOrganisation(contactId, orgId);
      if (contactLie === false) { res.status(400).json({ error: "Contact introuvable." }); return; }
      updates.contactId = contactLie;
    }

    const [updated] = await db.update(projetsTable).set(updates).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId))).returning();
    res.json(updated);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour projet");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

router.post("/projets/:id/duplicate", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [src] = await db.select().from(projetsTable).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId)));
    if (!src) { res.status(404).json({ error: "Projet non trouve." }); return; }
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = src as any;
    // Une copie est un NOUVEAU chantier : ni depense, ni reception. Copier la
    // date de reception faisait partir les garanties legales (parfait
    // achevement, biennale, decennale) de la reception de l'ancien chantier.
    const [dup] = await db.insert(projetsTable).values({
      ...rest,
      title: `${src.title} (copie)`,
      status: "planifie",
      progress: 0,
      spent: "0",
      actualEndDate: null,
      receptionDate: null,
      receptionWithReserves: false,
      receptionReserves: null,
      reservesLiftedAt: null,
    }).returning();
    res.status(201).json(dup);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication projet");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.delete("/projets/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [deleted] = await db.delete(projetsTable).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId))).returning();
    if (!deleted) { res.status(404).json({ error: "Projet non trouve." }); return; }
    await archiveDeletedRows(projetsTable, [deleted], deletionContext(req, orgId));
    res.status(204).end();
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression projet");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
