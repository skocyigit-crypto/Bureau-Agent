import { tracerExtraction } from "../lib/tracer-extraction";
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, ilike, isNull, or, sql, and, type Column, type SQL } from "drizzle-orm";
import { db, prospectsTable, contactsTable, devisTable, facturesClientTable, callsTable, tasksTable } from "@workspace/db";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { requireRole } from "../middleware/auth";
import { generateUniqueReference } from "../lib/unique-reference";
import { getOrgId } from "../middleware/tenant";
import { computeInvoiceTotals } from "../services/invoice-totals";
import { archiveDeletedRows, deletionContext } from "../services/trash";
import { celluleCsv, SEPARATEUR_CSV } from "../lib/csv";
import { datesEtape, pagination, validerSaisieProspect } from "../services/prospect-saisie";
import { contactDeLOrganisation } from "../services/contact-organisation";
import { PREFIXE_ESTIMATION, pointsManquants, validerListeDecouverte } from "../services/crm-decouverte";
import { logAudit } from "./audit";
import { usersTable } from "@workspace/db";

const router: IRouter = Router();

// Ressource TENANT: le prospect appartient au client. Chaque requete est
// bornee a l'organisation de la session (`getOrgId`); aucun appelant ne choisit
// son `organisationId` (cf. routes/index.ts, "Customer content").

/** Borne une ligne a la fois par son id ET par l'organisation appelante. */
function ownedById(id: number, orgId: number): SQL {
  return and(eq(prospectsTable.id, id), eq(prospectsTable.organisationId, orgId))!;
}

const sortCols: Record<string, any> = {
  createdAt: prospectsTable.createdAt,
  title: prospectsTable.title,
  value: prospectsTable.value,
  probability: prospectsTable.probability,
  expectedCloseDate: prospectsTable.expectedCloseDate,
  stage: prospectsTable.stage,
};

router.get("/prospects", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, stage, priority, assignedTo, sortBy = "createdAt", sortOrder = "desc" } = req.query as any;
  const { limit, offset } = pagination(req.query.limit, req.query.offset);

  const conditions: SQL[] = [eq(prospectsTable.organisationId, orgId)];
  if (stage && stage !== "all") conditions.push(eq(prospectsTable.stage, stage));
  if (priority && priority !== "all") conditions.push(eq(prospectsTable.priority, priority));
  const useUnaccent = await ensureUnaccentExtension();
  if (assignedTo) conditions.push(accentInsensitiveIlike(prospectsTable.assignedTo, `%${assignedTo}%`, useUnaccent));
  if (search) {
    const pattern = `%${search}%`;
    const il = (col: Column): SQL => accentInsensitiveIlike(col, pattern, useUnaccent);
    conditions.push(or(
      il(prospectsTable.title),
      il(prospectsTable.contactName),
      il(prospectsTable.company),
      il(prospectsTable.email),
    )!);
  }

  // Toujours defini: le filtre organisation est la premiere condition, donc
  // aucune branche ne peut interroger la table sans borne tenant.
  const where = and(...conditions);
  const col = sortCols[sortBy] ?? prospectsTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(prospectsTable).where(where)
        .orderBy(orderFn(col)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(prospectsTable).where(where),
    ]);
    res.json({ prospects: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste prospects");
    res.status(500).json({ error: "Erreur lors de la recuperation des prospects." });
  }
});

router.get("/prospects/stats", async (req: Request, res: Response): Promise<void> => {
  const where = eq(prospectsTable.organisationId, getOrgId(req));
  try {
    const stageQ = db.select({
      stage: prospectsTable.stage,
      count: sql<number>`count(*)::int`,
      totalValue: sql<number>`coalesce(sum(${prospectsTable.value}), 0)::numeric`,
    }).from(prospectsTable);
    const totalsQ = db.select({
      total: sql<number>`count(*)::int`,
      totalValue: sql<number>`coalesce(sum(${prospectsTable.value}), 0)::numeric`,
      avgValue: sql<number>`coalesce(avg(${prospectsTable.value}), 0)::numeric`,
      wonCount: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'gagne')::int`,
      lostCount: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'perdu')::int`,
    }).from(prospectsTable);
    const [byStage, totals] = await Promise.all([
      stageQ.where(where).groupBy(prospectsTable.stage),
      totalsQ.where(where),
    ]);
    res.json({ byStage, ...totals[0] });
  } catch (err: any) {
    req.log.error({ err }, "Erreur stats prospects");
    res.status(500).json({ error: "Erreur lors des statistiques." });
  }
});

/**
 * Prochaines actions echues ou du jour (avant /prospects/:id : sinon Express
 * lirait « next-actions » comme un identifiant).
 *
 * `scope=me` : celles dont la session est responsable. Les opportunites
 * gagnees ou perdues n'ont plus de prochaine action qui compte.
 */
router.get("/prospects/next-actions", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const finDuJour = new Date();
  finDuJour.setHours(23, 59, 59, 999);
  const conditions = [
    eq(prospectsTable.organisationId, orgId),
    sql`${prospectsTable.nextActionAt} IS NOT NULL`,
    sql`${prospectsTable.nextActionAt} <= ${finDuJour}`,
    sql`${prospectsTable.stage} NOT IN ('gagne', 'perdu')`,
  ];
  if (req.query.scope === "me") {
    const uid = req.session?.userId;
    if (!uid) { res.json({ actions: [] }); return; }
    conditions.push(eq(prospectsTable.nextActionOwnerId, uid));
  }
  try {
    const actions = await db.select({
      id: prospectsTable.id, title: prospectsTable.title, contactName: prospectsTable.contactName,
      nextActionLabel: prospectsTable.nextActionLabel, nextActionAt: prospectsTable.nextActionAt,
      nextActionOwnerId: prospectsTable.nextActionOwnerId,
    }).from(prospectsTable).where(and(...conditions)).orderBy(asc(prospectsTable.nextActionAt)).limit(100);
    const maintenant = Date.now();
    res.json({ actions: actions.map((a) => ({ ...a, enRetard: a.nextActionAt != null && a.nextActionAt.getTime() < maintenant })) });
  } catch (err: any) {
    req.log.error({ err }, "Erreur prochaines actions");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.get("/prospects/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(prospectsTable).where(ownedById(id, orgId));
    if (!row) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur get prospect");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/prospects", async (req: Request, res: Response): Promise<void> => {
  const targetOrg = getOrgId(req);
  const { title, description, contactName, company, email, phone, currency = "EUR", source, assignedTo, expectedCloseDate, notes, tags, contactId } = req.body;

  if (typeof title !== "string" || !title.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  const saisie = validerSaisieProspect(req.body ?? {}, false);
  if (!saisie.ok) { res.status(400).json({ error: saisie.erreur }); return; }
  const { stage, priority, probability } = saisie.valeurs as { stage: string; priority: string; probability: number };

  try {
    const contactLie = await contactDeLOrganisation(contactId, targetOrg);
    if (contactLie === false) { res.status(400).json({ error: "Contact introuvable." }); return; }
    const [row] = await db.insert(prospectsTable).values({
      organisationId: targetOrg,
      title: title.trim(),
      description,
      contactName,
      company,
      email,
      phone,
      stage,
      priority,
      value: (saisie.valeurs.value as string | null | undefined) ?? null,
      currency,
      probability,
      source,
      assignedTo,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
      notes,
      tags: tags || [],
      contactId: contactLie,
      ...datesEtape(stage),
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation prospect");
    res.status(500).json({ error: "Erreur lors de la creation." });
  }
});

router.patch("/prospects/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  const owned = ownedById(id, orgId);

  try {
    const [existing] = await db.select({ id: prospectsTable.id, stage: prospectsTable.stage }).from(prospectsTable).where(owned);
    if (!existing) { res.status(404).json({ error: "Prospect non trouve." }); return; }

    const saisie = validerSaisieProspect(req.body ?? {}, true);
    if (!saisie.ok) { res.status(400).json({ error: saisie.erreur }); return; }
    const { title, description, contactName, company, email, phone, currency, source, assignedTo, expectedCloseDate, notes, tags, contactId, lostReason } = req.body;

    const updates: any = { updatedAt: new Date(), ...saisie.valeurs };
    // Les dates de gain/perte ne bougent que si l'etape change vraiment : un
    // formulaire re-enregistre avec « gagne » ne doit pas redater la victoire.
    if (typeof updates.stage === "string" && updates.stage !== existing.stage) Object.assign(updates, datesEtape(updates.stage));
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description;
    if (contactName !== undefined) updates.contactName = contactName;
    if (company !== undefined) updates.company = company;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (currency !== undefined) updates.currency = currency;
    if (source !== undefined) updates.source = source;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    if (expectedCloseDate !== undefined) updates.expectedCloseDate = expectedCloseDate ? new Date(expectedCloseDate) : null;
    if (notes !== undefined) updates.notes = notes;
    if (tags !== undefined) updates.tags = tags;
    if (contactId !== undefined) {
      const contactLie = await contactDeLOrganisation(contactId, orgId);
      if (contactLie === false) { res.status(400).json({ error: "Contact introuvable." }); return; }
      updates.contactId = contactLie;
    }
    if (lostReason !== undefined) updates.lostReason = lostReason;

    // Prochaine action : le responsable doit etre un utilisateur de LA MEME
    // organisation — sinon « Aujourd'hui » nommerait quelqu'un d'un autre
    // client, et l'identifiant revelerait qu'il existe.
    const b = req.body ?? {};
    const champsSuivis: string[] = [];
    if (b.nextActionLabel !== undefined) {
      if (b.nextActionLabel !== null && typeof b.nextActionLabel !== "string") { res.status(400).json({ error: "Prochaine action invalide." }); return; }
      updates.nextActionLabel = typeof b.nextActionLabel === "string" && b.nextActionLabel.trim() ? b.nextActionLabel.trim().slice(0, 500) : null;
      champsSuivis.push("nextActionLabel");
    }
    if (b.nextActionAt !== undefined) {
      if (b.nextActionAt === null || b.nextActionAt === "") updates.nextActionAt = null;
      else {
        const d = new Date(b.nextActionAt);
        if (Number.isNaN(d.getTime())) { res.status(400).json({ error: "Date de prochaine action invalide." }); return; }
        updates.nextActionAt = d;
      }
      champsSuivis.push("nextActionAt");
    }
    if (b.nextActionOwnerId !== undefined) {
      if (b.nextActionOwnerId === null || b.nextActionOwnerId === "") updates.nextActionOwnerId = null;
      else {
        const uid = Number(b.nextActionOwnerId);
        const [u] = Number.isInteger(uid)
          ? await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.id, uid), eq(usersTable.organisationId, orgId)))
          : [];
        if (!u) { res.status(400).json({ error: "Responsable introuvable.", code: "responsable_inconnu" }); return; }
        updates.nextActionOwnerId = u.id;
      }
      champsSuivis.push("nextActionOwnerId");
    }
    if (b.discoveryChecklist !== undefined) {
      const liste = validerListeDecouverte(b.discoveryChecklist);
      if (!liste.ok) { res.status(400).json({ error: liste.erreur, code: "decouverte_invalide" }); return; }
      updates.discoveryChecklist = liste.valeur;
      champsSuivis.push("discoveryChecklist");
    }

    const [row] = await db.update(prospectsTable).set(updates).where(owned).returning();
    if (champsSuivis.length) {
      void logAudit(
        req.session?.userId, req.session?.userEmail, "prospect.suivi_modifie", "prospect", String(id),
        { champs: champsSuivis, nextActionAt: row?.nextActionAt ?? null, nextActionOwnerId: row?.nextActionOwnerId ?? null, manquants: pointsManquants(row?.discoveryChecklist) },
        req.ip, req.get("user-agent"), orgId,
      ).catch(() => {});
    }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour prospect");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

const exportReserveAuResponsable = requireRole("super_admin", "administrateur");

// Un export rend la MEME matiere que `GET /api/export/:entity`, qui est
// reserve au responsable depuis l'audit du 19/09. La garde n'avait pas ete
// reportee ici: un compte `lecture_seule` retelechargeait le fichier client
// module par module. Le plancher global de `routes/index.ts` n'y peut rien,
// il exempte les GET par construction.
router.get("/prospects/export/csv", exportReserveAuResponsable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(prospectsTable)
      .where(eq(prospectsTable.organisationId, orgId))
      .orderBy(desc(prospectsTable.createdAt));
    const headers = ["Titre", "Contact", "Entreprise", "Email", "Téléphone", "Étape", "Priorité", "Valeur", "Probabilité", "Source", "Clôture prévue", "Créé le"];
    const escape = celluleCsv;
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "";
    const lines = [headers.map(celluleCsv).join(SEPARATEUR_CSV), ...rows.map(r => [
      escape(r.title), escape(r.contactName), escape(r.company), escape(r.email), escape(r.phone),
      escape(r.stage), escape(r.priority), escape(r.value), escape(r.probability),
      escape(r.source), escape(fmtDate(r.expectedCloseDate)), escape(fmtDate(r.createdAt)),
    ].join(SEPARATEUR_CSV))];
    await tracerExtraction(req, "prospects", { format: "csv", lignes: rows.length });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="prospects_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export prospects CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

router.post("/prospects/:id/convert", requireRole("agent"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [prospect] = await db.select().from(prospectsTable).where(ownedById(id, orgId));
    if (!prospect) { res.status(404).json({ error: "Prospect non trouvé." }); return; }

    // Deja converti (ou lie a un contact) : chaque clic creait un doublon.
    if (prospect.contactId) {
      const [lie] = await db.select().from(contactsTable)
        .where(and(eq(contactsTable.id, prospect.contactId), eq(contactsTable.organisationId, orgId)));
      if (lie) { res.status(409).json({ contact: lie, error: "Ce prospect est deja lie a un contact." }); return; }
    }

    const nameParts = (prospect.contactName || "").trim().split(/\s+/);
    const firstName = nameParts[0] || prospect.title || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    // Les deux ecritures sont ATOMIQUES, et la prise du prospect est
    // conditionnelle.
    //
    // Le garde-fou ci-dessus lit `contactId` puis agit: entre les deux, rien
    // ne tenait. Deux facons d'obtenir exactement le doublon qu'il existe
    // pour empecher:
    //  - le contact est insere, la mise a jour du prospect echoue (coupure,
    //    contrainte). Le contact existe, le prospect ne le sait pas, et le
    //    clic suivant repasse la garde et en cree un deuxieme.
    //  - deux clics partent ensemble (double-clic, deux utilisateurs). Les
    //    deux lisent `contactId` vide, les deux inserent.
    //
    // Le `WHERE ... contactId IS NULL ... RETURNING` tranche cote Postgres:
    // un seul appel matche, le perdant n'a pas de ligne et sa transaction est
    // annulee — contact insere compris. Meme idiome que la reclamation des
    // cycles planifies dans `ai-agents.ts`.
    const conflit = Symbol("deja converti");
    let contact: typeof contactsTable.$inferSelect;
    try {
      contact = await db.transaction(async (tx) => {
        const [cree] = await tx.insert(contactsTable).values({
          organisationId: prospect.organisationId,
          firstName,
          lastName,
          email: prospect.email || null,
          phone: prospect.phone || "",
          company: prospect.company || null,
          notes: `Converti depuis prospect: ${prospect.title}`,
          category: "autre",
        } as any).returning();

        const pris = await tx.update(prospectsTable).set({
          contactId: cree.id,
          stage: "gagne",
          ...(prospect.stage === "gagne" ? {} : datesEtape("gagne")),
          updatedAt: new Date(),
        }).where(and(ownedById(id, orgId), isNull(prospectsTable.contactId)))
          .returning({ id: prospectsTable.id });

        if (pris.length === 0) throw conflit;
        return cree;
      });
    } catch (err) {
      if (err === conflit) {
        res.status(409).json({ error: "Ce prospect est deja lie a un contact." });
        return;
      }
      throw err;
    }

    res.status(201).json({ contact, message: "Prospect converti en contact avec succès." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur conversion prospect en contact");
    res.status(500).json({ error: "Erreur lors de la conversion." });
  }
});

/**
 * Cree un devis pre-rempli a partir d'un prospect: reprend le client (nom,
 * societe, email, telephone), etablit le LIEN (devis.prospectId) — jusqu'ici la
 * seule "connexion" etait un rapprochement flou par nom/email — et fait
 * remonter la VALEUR estimee du prospect comme premiere ligne du devis, pour
 * qu'elle traverse reellement le segment au lieu d'etre ressaisie. L'utilisateur
 * ajuste ensuite les lignes reelles; les totaux sont recalcules cote serveur.
 */
router.post("/prospects/:id/create-devis", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [prospect] = await db.select().from(prospectsTable).where(ownedById(id, orgId));
    if (!prospect) { res.status(404).json({ error: "Prospect non trouvé." }); return; }

    const checkExists = async (candidate: string): Promise<boolean> => {
      const [e] = await db.select({ id: devisTable.id }).from(devisTable)
        .where(and(eq(devisTable.organisationId, orgId), eq(devisTable.reference, candidate)));
      return !!e;
    };
    const ref = await generateUniqueReference("DEV", checkExists);

    // La valeur estimee devient une ligne de depart (TVA 20% par defaut), de
    // sorte que le montant se propage. Si aucune valeur, devis vide a completer.
    //
    // Mais cette valeur est une ESTIMATION commerciale, pas un chiffrage : la
    // ligne le dit (libelle + `estimate: true`), l'ecran du devis la montre a
    // part, et l'acceptation est refusee tant qu'elle n'a pas ete reprise
    // (routes/devis.ts, code `devis_ligne_estimee`).
    const estimate = Number(prospect.value ?? 0);
    const seedItems = estimate > 0
      ? [{ description: `${PREFIXE_ESTIMATION}${prospect.title}`, quantity: 1, unitPrice: estimate, taxRate: 20, estimate: true }]
      : [];
    // Ce que la decouverte n'a pas confirme : le devis est cree quand meme
    // (l'utilisateur peut chiffrer avec des hypotheses), mais il le sait.
    const manquants = pointsManquants(prospect.discoveryChecklist);
    const totals = computeInvoiceTotals(seedItems);

    const [devis] = await db.insert(devisTable).values({
      organisationId: orgId,
      contactId: prospect.contactId ?? null,
      prospectId: prospect.id,
      reference: ref,
      title: prospect.title,
      clientName: prospect.contactName || prospect.company || prospect.title,
      clientEmail: prospect.email ?? null,
      clientPhone: prospect.phone ?? null,
      clientCompany: prospect.company ?? null,
      items: totals.lines,
      subtotal: String(totals.subtotal),
      taxAmount: String(totals.taxAmount),
      totalAmount: String(totals.totalAmount),
      currency: "EUR",
      status: "brouillon",
    }).returning();

    // Le prospect avance a l'etape "proposition" (un devis a ete emis).
    if (prospect.stage === "nouveau" || prospect.stage === "contact" || prospect.stage === "qualification") {
      await db.update(prospectsTable).set({ stage: "proposition", updatedAt: new Date() }).where(ownedById(id, orgId));
    }

    res.status(201).json({
      devis,
      avertissements: {
        decouverteManquante: manquants,
        ligneEstimee: seedItems.length > 0,
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation devis depuis prospect");
    res.status(500).json({ error: "Erreur lors de la creation du devis." });
  }
});

router.post("/prospects/:id/duplicate", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [original] = await db.select().from(prospectsTable).where(ownedById(id, orgId));
    if (!original) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    const [copy] = await db.insert(prospectsTable).values({
      organisationId: original.organisationId,
      title: `${original.title} (copie)`,
      contactName: original.contactName,
      company: original.company,
      email: original.email,
      phone: original.phone,
      stage: original.stage,
      priority: original.priority,
      value: original.value,
      probability: original.probability,
      source: original.source,
      notes: original.notes,
      expectedCloseDate: original.expectedCloseDate,
    }).returning();
    res.status(201).json(copy);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication prospect");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.get("/prospects/:id/devis", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [prospect] = await db.select({
      organisationId: prospectsTable.organisationId,
      contactName: prospectsTable.contactName,
      company: prospectsTable.company,
      email: prospectsTable.email,
    }).from(prospectsTable).where(ownedById(id, orgId)).limit(1);
    if (!prospect) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    const name = (prospect.contactName || "").trim();
    const company = (prospect.company || "").trim();
    const email = (prospect.email || "").trim();

    const nameMatch = (col: Column): SQL[] => {
      const arr: SQL[] = [];
      if (name) arr.push(ilike(col, `%${name}%`));
      if (company) arr.push(ilike(col, `%${company}%`));
      return arr;
    };
    const emailMatch = (col: Column): SQL | null => email ? ilike(col, email) : null;

    const devisConds: SQL[] = [eq(devisTable.prospectId, id), ...nameMatch(devisTable.clientName)];
    const dEmail = emailMatch(devisTable.clientEmail); if (dEmail) devisConds.push(dEmail);

    const factureConds: SQL[] = [...nameMatch(facturesClientTable.clientName)];
    const fEmail = emailMatch(facturesClientTable.clientEmail); if (fEmail) factureConds.push(fEmail);

    const [devisList, facturesList] = await Promise.all([
      db.select({ id: devisTable.id, reference: devisTable.reference, status: devisTable.status, totalAmount: devisTable.totalAmount, createdAt: devisTable.createdAt })
        .from(devisTable)
        .where(and(eq(devisTable.organisationId, orgId), or(...devisConds)))
        .orderBy(desc(devisTable.createdAt)).limit(20),
      factureConds.length > 0
        ? db.select({ id: facturesClientTable.id, reference: facturesClientTable.reference, status: facturesClientTable.status, totalAmount: facturesClientTable.totalAmount, paidAmount: facturesClientTable.paidAmount, createdAt: facturesClientTable.createdAt })
            .from(facturesClientTable)
            .where(and(eq(facturesClientTable.organisationId, orgId), or(...factureConds)))
            .orderBy(desc(facturesClientTable.createdAt)).limit(20)
        : Promise.resolve([] as any[]),
    ]);

    res.json({ devis: devisList, factures: facturesList });
  } catch (err: any) {
    req.log.error({ err }, "Erreur devis/factures prospect");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.get("/prospects/:id/history", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [prospect] = await db.select().from(prospectsTable)
      .where(ownedById(id, orgId)).limit(1);
    if (!prospect) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    const name = (prospect.contactName || "").trim();
    const phone = (prospect.phone || "").trim();
    const email = (prospect.email || "").trim();

    const callConds: SQL[] = [];
    if (prospect.contactId) callConds.push(eq(callsTable.contactId, prospect.contactId));
    if (phone) callConds.push(ilike(callsTable.phoneNumber, `%${phone}%`));
    if (name) callConds.push(ilike(callsTable.contactName, `%${name}%`));

    const taskConds: SQL[] = [];
    if (prospect.contactId) taskConds.push(eq(tasksTable.relatedContactId, prospect.contactId));
    if (name) taskConds.push(ilike(tasksTable.title, `%${name}%`));
    const company = (prospect.company || "").trim();
    if (company) taskConds.push(ilike(tasksTable.title, `%${company}%`));
    if (prospect.title) taskConds.push(ilike(tasksTable.title, `%${prospect.title}%`));

    const [calls, tasks] = await Promise.all([
      callConds.length > 0
        ? db.select({
            id: callsTable.id, direction: callsTable.direction, status: callsTable.status,
            phoneNumber: callsTable.phoneNumber, contactName: callsTable.contactName,
            duration: callsTable.duration, notes: callsTable.notes, createdAt: callsTable.createdAt,
          }).from(callsTable)
            .where(and(eq(callsTable.organisationId, orgId), or(...callConds)))
            .orderBy(desc(callsTable.createdAt)).limit(20)
        : Promise.resolve([] as any[]),
      taskConds.length > 0
        ? db.select({
            id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
            priority: tasksTable.priority, dueDate: tasksTable.dueDate, createdAt: tasksTable.createdAt,
          }).from(tasksTable)
            .where(and(eq(tasksTable.organisationId, orgId), or(...taskConds)))
            .orderBy(desc(tasksTable.createdAt)).limit(20)
        : Promise.resolve([] as any[]),
    ]);

    res.json({ calls, tasks });
  } catch (err: any) {
    req.log.error({ err }, "Erreur historique prospect");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'historique." });
  }
});

router.delete("/prospects/:id", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.delete(prospectsTable).where(ownedById(id, orgId)).returning();
    if (!row) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    await archiveDeletedRows(prospectsTable, [row], deletionContext(req, orgId));
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression prospect");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
