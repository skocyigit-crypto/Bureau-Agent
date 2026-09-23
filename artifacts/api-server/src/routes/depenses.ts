import { Router, type Request, type Response } from "express";
import { deductibiliteTva, totalDeductible } from "../services/tva-deductible";
import {
  db,
  depensesTable,
  EXPENSE_STATUSES,
  EXPENSE_PAYMENT_STATUSES,
  EXPENSE_CATEGORIES,
} from "@workspace/db";
import { and, eq, gte, lte, lt, desc, sql, type SQL } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { CURSEUR_EXPORT_DEBUT } from "../lib/curseur-export";
import { montantsDepense, NOTE_TVA_NON_LUE } from "../services/montants-depense";
import { computeDedupeHash, parseDocumentDate } from "../services/expense-capture";
import { withDbRetry } from "../lib/db-retry";
import { logger } from "../lib/logger";
import { archiveDeletedRows, deletionContext } from "../services/trash";
import { celluleCsv, SEPARATEUR_CSV } from "../lib/csv";
import { organisationsTable } from "@workspace/db";
import { jourLocal } from "../lib/jour-local";
import { comptesDepenseTable } from "@workspace/db";
import {
  ErreurCompte,
  PLAN_PROPOSE_BTP,
  validerLigne,
} from "../services/comptes-depense";
import { inArray } from "drizzle-orm";
import {
  ErreurVirement,
  construireVirementSepa,
  ibanValide,
  normaliserIban,
  bicValide,
} from "../services/virement-sepa";

const router = Router();
const requireMinAgent = requireRole("super_admin", "administrateur", "agent");
/**
 * Valider une depense engage l argent de l entreprise: c est un acte de
 * direction, pas de saisie. Un agent saisit, un responsable approuve.
 */
const requireResponsable = requireRole("super_admin", "administrateur");

const STATUS_SET = new Set<string>(EXPENSE_STATUSES);
const PAYMENT_SET = new Set<string>(EXPENSE_PAYMENT_STATUSES);
const CATEGORY_SET = new Set<string>(EXPENSE_CATEGORIES);


function num(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// Construit les conditions de filtrage communes au registre, aux statistiques
// et à l'export (catégorie, fournisseur, dates, statut de paiement, statut).
function buildFilterConditions(req: Request, orgId: number): SQL[] {
  const conds: SQL[] = [eq(depensesTable.organisationId, orgId)];

  const status = typeof req.query.status === "string" ? req.query.status : "";
  if (status && STATUS_SET.has(status)) conds.push(eq(depensesTable.status, status));

  const category = typeof req.query.category === "string" ? req.query.category : "";
  if (category && CATEGORY_SET.has(category)) conds.push(eq(depensesTable.category, category));

  const paymentStatus = typeof req.query.paymentStatus === "string" ? req.query.paymentStatus : "";
  if (paymentStatus && PAYMENT_SET.has(paymentStatus)) conds.push(eq(depensesTable.paymentStatus, paymentStatus));

  const vendor = typeof req.query.vendor === "string" ? req.query.vendor.trim() : "";
  if (vendor) {
    const like = `%${vendor.toLowerCase()}%`;
    conds.push(sql`lower(${depensesTable.vendor}) like ${like}`);
  }

  const from = parseDocumentDate(req.query.from);
  if (from) conds.push(gte(depensesTable.expenseDate, from));
  const to = parseDocumentDate(req.query.to);
  if (to) conds.push(lte(depensesTable.expenseDate, to));

  return conds;
}

// GET /depenses — registre + file d'inspection avec filtres.
// Query: status, category, vendor (recherche), from, to (dates ISO),
// paymentStatus, limit. Renvoie aussi un résumé (compteurs + totaux).
router.get("/depenses", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const conds = buildFilterConditions(req, orgId);

    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));

    const rows = await db
      .select()
      .from(depensesTable)
      .where(and(...conds))
      .orderBy(desc(depensesTable.expenseDate), desc(depensesTable.createdAt))
      .limit(limit);

    // Résumé org-wide (indépendant des filtres) : compteurs par statut +
    // totaux approuvés + reste à payer.
    const summaryRows = await db
      .select({
        status: depensesTable.status,
        count: sql<number>`count(*)::int`,
        totalTtc: sql<number>`coalesce(sum(${depensesTable.amountTtc}), 0)::float8`,
      })
      .from(depensesTable)
      .where(eq(depensesTable.organisationId, orgId))
      .groupBy(depensesTable.status);

    const summary = {
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      approvedTotal: 0,
    };
    for (const s of summaryRows) {
      if (s.status === "en_attente") summary.pendingCount = s.count;
      else if (s.status === "approuve") {
        summary.approvedCount = s.count;
        summary.approvedTotal = s.totalTtc;
      } else if (s.status === "rejete") summary.rejectedCount = s.count;
    }

    const [payable] = await db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${depensesTable.amountTtc}), 0)::float8`,
      })
      .from(depensesTable)
      .where(
        and(
          eq(depensesTable.organisationId, orgId),
          eq(depensesTable.status, "approuve"),
          eq(depensesTable.paymentStatus, "a_payer"),
        ),
      );

    // LA TVA FACTUREE N'EST PAS LA TVA RECUPERABLE.
    //
    // `amountTva` etait rendu tel quel, et rien ne distinguait la part
    // effectivement deductible. Une entreprise qui reprend ce total dans sa
    // CA3 sur-deduit sur au moins trois postes courants — carburant de
    // vehicule de tourisme (20 % de trop), entretien de ce meme vehicule et
    // hebergement (100 % de trop chacun). Une sur-deduction se paie d'un
    // rappel assorti d'interets.
    //
    // Rien n'est ecrit en base: c'est une lecture, et les lignes dont la
    // reponse depend d'une information absente (nature du vehicule, alcool)
    // sont comptees a part plutot que tranchees d'office.
    const avecDeduction = rows.map((r: Record<string, unknown>) => ({
      ...r,
      tvaDeductible: deductibiliteTva(String(r.category ?? "autre"), Number(r.amountTva ?? 0)),
    }));
    const deduction = totalDeductible(
      rows.map((r: Record<string, unknown>) => ({
        category: String(r.category ?? "autre"),
        montantTva: Number(r.amountTva ?? 0),
      })),
    );

    res.json({
      depenses: avecDeduction,
      summary: {
        ...summary,
        payableCount: payable?.count ?? 0,
        payableTotal: payable?.total ?? 0,
        tvaDeductibleTotal: deduction.total,
        tvaDeductibleAConfirmer: deduction.aConfirmer,
      },
      categories: EXPENSE_CATEGORIES,
    });
  } catch (err) {
    logger.error({ err }, "[depenses] list failed");
    res.status(500).json({ error: "Erreur lors du chargement des dépenses." });
  }
});

// GET /depenses/stats — agrégats pour les graphiques de synthèse (dépenses par
// catégorie, par mois, par fournisseur). Respecte les mêmes filtres que le
// registre. Par défaut, restreint aux dépenses approuvées (registre) si aucun
// statut n'est précisé.
router.get("/depenses/stats", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const conds = buildFilterConditions(req, orgId);
    const hasStatus = typeof req.query.status === "string" && STATUS_SET.has(req.query.status);
    if (!hasStatus) conds.push(eq(depensesTable.status, "approuve"));

    // Bucketing mensuel forcé en UTC pour s'aligner sur les clés JS.
    const monthExpr = sql<string>`to_char(date_trunc('month', ${depensesTable.expenseDate} at time zone 'UTC'), 'YYYY-MM')`;

    const [byCategory, byMonth, byVendor] = await Promise.all([
      db
        .select({
          category: depensesTable.category,
          total: sql<number>`coalesce(sum(${depensesTable.amountTtc}), 0)::float8`,
          count: sql<number>`count(*)::int`,
        })
        .from(depensesTable)
        .where(and(...conds))
        .groupBy(depensesTable.category)
        .orderBy(sql`2 desc`),
      db
        .select({
          month: monthExpr,
          total: sql<number>`coalesce(sum(${depensesTable.amountTtc}), 0)::float8`,
          count: sql<number>`count(*)::int`,
        })
        .from(depensesTable)
        .where(and(...conds, sql`${depensesTable.expenseDate} is not null`))
        .groupBy(monthExpr)
        .orderBy(sql`1 asc`),
      db
        .select({
          vendor: depensesTable.vendor,
          total: sql<number>`coalesce(sum(${depensesTable.amountTtc}), 0)::float8`,
          count: sql<number>`count(*)::int`,
        })
        .from(depensesTable)
        .where(and(...conds))
        .groupBy(depensesTable.vendor)
        .orderBy(sql`2 desc`)
        .limit(8),
    ]);

    res.json({ byCategory, byMonth, byVendor });
  } catch (err) {
    logger.error({ err }, "[depenses] stats failed");
    res.status(500).json({ error: "Erreur lors du calcul des statistiques." });
  }
});

// GET /depenses/export — export CSV (séparateur ;, BOM UTF-8 pour Excel) du
// registre filtré. Export en STREAMING par lots (pagination keyset sur l'id
// décroissant) : pas de troncature silencieuse, mémoire bornée. 500 propre
// uniquement si la 1re requête échoue avant tout envoi.
const EXPORT_BATCH = 1000;
const exportReserveAuResponsable = requireRole("super_admin", "administrateur");

// Un export rend la MEME matiere que `GET /api/export/:entity`, qui est
// reserve au responsable depuis l'audit du 19/09. La garde n'avait pas ete
// reportee ici: un compte `lecture_seule` retelechargeait le fichier client
// module par module. Le plancher global de `routes/index.ts` n'y peut rien,
// il exempte les GET par construction.
router.get("/depenses/export", exportReserveAuResponsable, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const conds = buildFilterConditions(req, orgId);
    const hasStatus = typeof req.query.status === "string" && STATUS_SET.has(req.query.status);
    if (!hasStatus) conds.push(eq(depensesTable.status, "approuve"));
    const baseClause = and(...conds);

    const escape = celluleCsv;
    const fmtDate = (d: Date | string | null): string => {
      if (!d) return "";
      const dt = d instanceof Date ? d : new Date(d);
      return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
    };
    // Le compte comptable de chaque categorie, s'il a ete renseigne. C'est
    // la colonne que le cabinet reconstituait a la main.
    const comptes = new Map<string, { charge: string; tva: string | null }>();
    for (const c of await db.select().from(comptesDepenseTable).where(eq(comptesDepenseTable.organisationId, orgId))) {
      comptes.set(c.categorie, { charge: c.compteCharge, tva: c.compteTva });
    }

    const headers = [
      "Date",
      "Fournisseur",
      "Libellé",
      "Référence",
      "Catégorie",
      "Compte",
      "Compte TVA",
      "HT",
      "TVA",
      "TTC",
      "Devise",
      "Statut",
      "Paiement",
      "Échéance",
      "Source",
      "Notes",
    ];

    // Voir CURSEUR_EXPORT_DEBUT: MAX_SAFE_INTEGER depasse un `integer` Postgres.
    let lastId = CURSEUR_EXPORT_DEBUT;
    let wroteHeader = false;
    for (;;) {
      const rows = await withDbRetry(
        () =>
          db
            .select()
            .from(depensesTable)
            .where(and(baseClause, lt(depensesTable.id, lastId)))
            .orderBy(desc(depensesTable.id))
            .limit(EXPORT_BATCH),
        { label: "depenses.export.batch" },
      );
      if (!wroteHeader) {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="depenses_${Date.now()}.csv"`);
        res.write("\uFEFF" + headers.join(SEPARATEUR_CSV) + "\n");
        wroteHeader = true;
      }
      if (rows.length === 0) break;
      const chunk = rows
        .map((r) =>
          [
            escape(fmtDate(r.expenseDate)),
            escape(r.vendor),
            escape(r.title),
            escape(r.reference),
            escape(r.category),
            escape(comptes.get(r.category)?.charge ?? ""),
            escape(comptes.get(r.category)?.tva ?? ""),
            escape(r.amountHt),
            escape(r.amountTva),
            escape(r.amountTtc),
            escape(r.currency),
            escape(r.status),
            escape(r.paymentStatus),
            escape(fmtDate(r.dueDate)),
            escape(r.source),
            escape(r.notes),
          ].join(";"),
        )
        .join("\n");
      res.write(chunk + "\n");
      lastId = rows[rows.length - 1].id;
      if (rows.length < EXPORT_BATCH) break;
    }
    res.end();
  } catch (err) {
    logger.error({ err }, "[depenses] export failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Erreur lors de l'export des dépenses." });
    } else {
      res.end();
    }
  }
});

// POST /depenses — saisie manuelle d'une dépense (entre en file d'inspection
// par défaut, ou directement au registre si status=approuve fourni).
router.post("/depenses", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId ?? null;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const vendor = typeof body.vendor === "string" ? body.vendor.trim() : "";
    if (!vendor) {
      res.status(400).json({ error: "Le fournisseur est requis." });
      return;
    }

    const amountTtc = num(body.amountTtc);
    if (amountTtc <= 0 && num(body.amountHt) <= 0) {
      res.status(400).json({ error: "Un montant (HT ou TTC) est requis." });
      return;
    }

    // Les trois montants sont reconstitues ensemble. Le calcul precedent
    // mettait le TTC dans la colonne HT des qu'aucune TVA n'etait saisie —
    // voir `montantsDepense`.
    const montants = montantsDepense({
      ht: num(body.amountHt),
      tva: num(body.amountTva),
      ttc: amountTtc,
      tauxTva: body.tauxTva === undefined ? null : num(body.tauxTva),
    });

    // Une TVA indeterminee ne fait pas echouer la saisie — elle se DIT.
    //
    // J'avais d'abord refuse ce cas en 400: l'utilisateur a le justificatif
    // sous les yeux, lui demander le taux coute une seconde. Mesure faite: ce
    // refus casse tous les appelants existants qui n'envoient qu'un TTC, y
    // compris des imports. Or ce qu'on corrige ici n'est pas le zero, c'est le
    // SILENCE — une TVA nulle parce qu'elle vaut zero et une TVA nulle parce
    // qu'on ne l'a pas etablie se ressemblent trop pour qu'on laisse deviner.
    //
    // La depense nait de toute facon « en attente »: la mention s'adresse a
    // celui qui approuve. Meme traitement que la lecture automatique d'un
    // justificatif (services/expense-capture.ts).
    const notesSaisies = typeof body.notes === "string" ? body.notes.trim() : "";
    const notesFinales = montants.tvaInconnue
      ? [notesSaisies, NOTE_TVA_NON_LUE].filter(Boolean).join(" — ")
      : notesSaisies;

    const amountHt = montants.ht;
    const amountTva = montants.tva;
    const ttc = montants.ttc;
    const category = typeof body.category === "string" && CATEGORY_SET.has(body.category) ? body.category : "autre";
    const paymentStatus =
      typeof body.paymentStatus === "string" && PAYMENT_SET.has(body.paymentStatus) ? body.paymentStatus : "a_payer";
    // Une depense NAIT en attente, toujours.
    //
    // La ligne precedente lisait `body.status`: il suffisait d envoyer
    // `status: "approuve"` a la creation pour que la depense entre au registre
    // sans qu aucun responsable ne l ait vue. L ecran d approbation existait,
    // mais rien n obligeait a y passer — mesure du 18/09 sur le banc, avec un
    // simple appel HTTP.
    const status = "en_attente";
    const expenseDate = parseDocumentDate(body.expenseDate);
    const dueDate = parseDocumentDate(body.dueDate);
    const dedupeHash = computeDedupeHash(vendor, ttc, expenseDate);

    const [dup] = await db
      .select({ id: depensesTable.id })
      .from(depensesTable)
      .where(and(eq(depensesTable.organisationId, orgId), eq(depensesTable.dedupeHash, dedupeHash)))
      .limit(1);

    const [inserted] = await db
      .insert(depensesTable)
      .values({
        organisationId: orgId,
        vendor,
        title: typeof body.title === "string" ? body.title.trim() || null : null,
        reference: typeof body.reference === "string" ? body.reference.trim() || null : null,
        category,
        expenseDate,
        dueDate,
        amountHt: amountHt.toFixed(2),
        amountTva: amountTva.toFixed(2),
        amountTtc: ttc.toFixed(2),
        status,
        paymentStatus,
        source: "manuel",
        notes: notesFinales || null,
        dedupeHash,
        duplicateOfId: dup?.id ?? null,
        createdBy: userId,
        // Personne n a encore relu: ces deux colonnes se remplissent a
        // l approbation, par celui qui approuve.
        reviewedBy: null,
        reviewedAt: null,
      })
      .returning();

    res.status(201).json({ success: true, depense: inserted, duplicate: !!dup });
  } catch (err) {
    logger.error({ err }, "[depenses] create failed");
    res.status(500).json({ error: "Erreur lors de la création de la dépense." });
  }
});

// PATCH /depenses/:id — corriger les champs extraits (file d'inspection ou
// registre). Recalcule l'empreinte de doublon si fournisseur/montant/date
// changent.
router.patch("/depenses/:id", requireMinAgent, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "ID invalide." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;

    const [current] = await db
      .select()
      .from(depensesTable)
      .where(and(eq(depensesTable.id, id), eq(depensesTable.organisationId, orgId)))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "Dépense introuvable." });
      return;
    }

    const update: Record<string, unknown> = {};
    if (typeof body.vendor === "string") update.vendor = body.vendor.trim();
    if (typeof body.title === "string") update.title = body.title.trim() || null;
    if (typeof body.reference === "string") update.reference = body.reference.trim() || null;
    if (typeof body.notes === "string") update.notes = body.notes.trim() || null;
    // Coordonnees bancaires du fournisseur : refusees des la saisie si elles
    // sont fausses. Un IBAN errone ne se rattrape pas une fois le virement
    // parti, et le decouvrir au moment de la remise ferait rejeter le fichier
    // entier par la banque.
    if (typeof body.vendorIban === "string") {
      const iban = normaliserIban(body.vendorIban);
      if (iban && !ibanValide(iban)) { res.status(400).json({ error: "IBAN du fournisseur invalide.", issues: [{ path: "vendorIban", message: "IBAN invalide." }] }); return; }
      update.vendorIban = iban || null;
    }
    if (typeof body.vendorBic === "string") {
      const bic = body.vendorBic.replace(/\s/g, "").toUpperCase();
      if (bic && !bicValide(bic)) { res.status(400).json({ error: "BIC du fournisseur invalide.", issues: [{ path: "vendorBic", message: "BIC invalide." }] }); return; }
      update.vendorBic = bic || null;
    }
    if (typeof body.category === "string" && CATEGORY_SET.has(body.category)) update.category = body.category;
    if (typeof body.paymentStatus === "string" && PAYMENT_SET.has(body.paymentStatus)) {
      update.paymentStatus = body.paymentStatus;
    }
    if ("expenseDate" in body) update.expenseDate = parseDocumentDate(body.expenseDate);
    if ("dueDate" in body) update.dueDate = parseDocumentDate(body.dueDate);
    // Les trois montants sont RECONSTITUES ensemble, comme a la creation.
    //
    // Ils etaient ecrits colonne par colonne, independamment: corriger une
    // depense de 250 EUR TTC en 300 EUR laissait l'ancien HT en place, et le
    // registre — celui qu'on remet au comptable, et dont la TVA deductible
    // derive — portait un triplet qui ne s'additionne pas.
    //
    // `montantsDepense` existe precisement pour ca et son en-tete le dit: il a
    // ete ecrit apres le meme defaut a la CREATION, ou le TTC se retrouvait
    // dans la colonne HT. La regle n'avait ete appliquee que d'un cote.
    if (body.amountHt !== undefined || body.amountTva !== undefined || body.amountTtc !== undefined) {
      // Seuls les montants FOURNIS entrent dans la reconstitution.
      //
      // Reprendre les anciens depuis la ligne serait pire que le defaut
      // d'origine: `montantsDepense` fait primer un couple HT+TVA connu sur
      // un TTC contradictoire (c'est sa premiere regle, et elle est juste).
      // Corriger le seul TTC de 250 a 300 aurait donc rendu... 250, en
      // silence. Ce que l'utilisateur vient de saisir fait foi; le reste se
      // deduit.
      const montants = montantsDepense({
        ht: body.amountHt !== undefined ? num(body.amountHt) : 0,
        tva: body.amountTva !== undefined ? num(body.amountTva) : 0,
        ttc: body.amountTtc !== undefined ? num(body.amountTtc) : 0,
        // Un TTC seul, corrige sans TVA, est reventile au taux fourni — ou
        // laisse tel quel, comme a la creation, si aucun taux n'est connu.
        tauxTva: body.tauxTva === undefined ? null : num(body.tauxTva),
      });
      update.amountHt = montants.ht.toFixed(2);
      update.amountTva = montants.tva.toFixed(2);
      update.amountTtc = montants.ttc.toFixed(2);
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "Aucun champ à mettre à jour." });
      return;
    }

    // Recalcule l'empreinte de doublon si l'un des composants change.
    const vendor = (update.vendor as string) ?? current.vendor;
    const ttc = update.amountTtc !== undefined ? num(update.amountTtc) : num(current.amountTtc);
    const expenseDate =
      "expenseDate" in update ? (update.expenseDate as Date | null) : (current.expenseDate as Date | null);
    if (update.vendor !== undefined || update.amountTtc !== undefined || "expenseDate" in update) {
      const dedupeHash = computeDedupeHash(vendor, ttc, expenseDate);
      update.dedupeHash = dedupeHash;
      const [dup] = await db
        .select({ id: depensesTable.id })
        .from(depensesTable)
        .where(
          and(
            eq(depensesTable.organisationId, orgId),
            eq(depensesTable.dedupeHash, dedupeHash),
            sql`${depensesTable.id} <> ${id}`,
          ),
        )
        .limit(1);
      update.duplicateOfId = dup?.id ?? null;
    }

    // Modifier ce qui a ete approuve REOUVRE l'approbation.
    //
    // Mesure du 18/09: une depense approuvee a 250 EUR pouvait passer a
    // 5 000 EUR et rester « approuvee », avec le nom du responsable encore
    // inscrit comme relecteur. L'approbation couvrait alors un montant que
    // personne n'avait valide — c'est le detournement classique, et il ne
    // demandait aucun privilege particulier.
    //
    // Ne rouvrent QUE les champs qui changent la nature de la depense: qui est
    // paye, combien, quand, a quel titre. Corriger une note ou un libelle ne
    // fait pas repasser par la case approbation.
    const CHAMPS_ENGAGEANTS = ["vendor", "amountHt", "amountTva", "amountTtc", "category", "expenseDate"] as const;
    const reouvre = current.status === "approuve"
      && CHAMPS_ENGAGEANTS.some((c) => update[c] !== undefined && String(update[c]) !== String(current[c as keyof typeof current]));
    if (reouvre) {
      update.status = "en_attente";
      update.reviewedBy = null;
      update.reviewedAt = null;
    }

    const [updated] = await db
      .update(depensesTable)
      .set(update)
      .where(and(eq(depensesTable.id, id), eq(depensesTable.organisationId, orgId)))
      .returning();

    res.json({ success: true, depense: updated, duplicate: !!updated?.duplicateOfId, approbationReouverte: reouvre });
  } catch (err) {
    logger.error({ err }, "[depenses] patch failed");
    res.status(500).json({ error: "Erreur lors de la mise à jour de la dépense." });
  }
});

async function setStatus(req: Request, res: Response, status: "approuve" | "rejete"): Promise<void> {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "ID invalide." });
      return;
    }
    const [updated] = await db
      .update(depensesTable)
      .set({ status, reviewedBy: req.session?.userId ?? null, reviewedAt: new Date() })
      .where(and(eq(depensesTable.id, id), eq(depensesTable.organisationId, orgId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Dépense introuvable." });
      return;
    }
    res.json({ success: true, depense: updated });
  } catch (err) {
    logger.error({ err, status }, "[depenses] status update failed");
    res.status(500).json({ error: "Erreur lors de la mise à jour de la dépense." });
  }
}

// POST /depenses/:id/approve — valide la dépense (entre au registre).
router.post("/depenses/:id/approve", requireResponsable, (req, res) => setStatus(req, res, "approuve"));
// POST /depenses/:id/reject — écarte la dépense.
router.post("/depenses/:id/reject", requireResponsable, (req, res) => setStatus(req, res, "rejete"));

// DELETE /depenses/:id — suppression définitive (responsables uniquement).
router.delete(
  "/depenses/:id",
  requireRole("super_admin", "administrateur"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = getOrgId(req);
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: "ID invalide." });
        return;
      }
      const deleted = await db
        .delete(depensesTable)
        .where(and(eq(depensesTable.id, id), eq(depensesTable.organisationId, orgId)))
        .returning();
      if (deleted.length === 0) {
        res.status(404).json({ error: "Dépense introuvable." });
        return;
      }
      // `depenses` figure dans les tables restaurables, mais sa suppression
      // n'etait jamais archivee : la corbeille ne la voyait pas.
      await archiveDeletedRows(depensesTable, deleted, deletionContext(req, orgId));
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "[depenses] delete failed");
      res.status(500).json({ error: "Erreur lors de la suppression de la dépense." });
    }
  },
);

/**
 * POST /depenses/virement-sepa — le fichier de virements a remettre a sa banque.
 *
 * Le produit lisait les releves (camt.053) et rapprochait les encaissements ;
 * dans l'autre sens, payer ses fournisseurs se faisait a la main dans la
 * banque en ligne, IBAN par IBAN. Cette route rend le fichier de remise, au
 * format que la place bancaire francaise exige a partir du 15 novembre 2026.
 *
 * Elle ne paie rien et ne marque rien comme paye : c'est le responsable qui
 * depose le fichier chez sa banque, et le rapprochement du releve constatera
 * l'execution. Marquer « paye » ici afficherait un paiement qui n'a peut-etre
 * jamais ete remis.
 */
router.post("/depenses/virement-sepa", requireResponsable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const corps = (req.body ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(corps.ids)
    ? corps.ids.map((v) => Number.parseInt(String(v), 10)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) { res.status(400).json({ error: "Aucune depense selectionnee." }); return; }
  if (ids.length > 500) { res.status(400).json({ error: "Au plus 500 paiements par remise." }); return; }

  // Par defaut : demain, DANS LE FUSEAU DE L'ENTREPRISE. Calculee en UTC, a
  // 23h30 a Paris, « demain » rendait la date du jour — une date d'execution
  // deja passee, que la banque refuse.
  const dateExecution = typeof corps.dateExecution === "string" && /^\d{4}-\d{2}-\d{2}$/.test(corps.dateExecution)
    ? corps.dateExecution
    : jourLocal(new Date(Date.now() + 86_400_000));

  try {
    const [org] = await db.select({
      name: organisationsTable.name,
      iban: organisationsTable.bankIban,
      bic: organisationsTable.bankBic,
    }).from(organisationsTable).where(eq(organisationsTable.id, orgId));
    if (!org?.iban) {
      res.status(409).json({ error: "Renseignez d'abord l'IBAN de l'entreprise dans les parametres." });
      return;
    }

    // Le filtre d'organisation est dans la requete, pas apres : une depense
    // d'un autre locataire ne doit meme pas etre lue.
    const lignes = await db.select().from(depensesTable).where(and(
      eq(depensesTable.organisationId, orgId),
      inArray(depensesTable.id, ids),
    ));
    if (lignes.length === 0) { res.status(404).json({ error: "Aucune depense trouvee." }); return; }

    const sansIban = lignes.filter((d) => !d.vendorIban);
    if (sansIban.length > 0) {
      res.status(409).json({
        error: "Certaines depenses n'ont pas d'IBAN fournisseur.",
        depenses: sansIban.map((d) => ({ id: d.id, fournisseur: d.vendor })),
      });
      return;
    }
    const dejaPayees = lignes.filter((d) => d.paymentStatus === "paye");
    if (dejaPayees.length > 0) {
      res.status(409).json({
        error: "Certaines depenses sont deja payees.",
        depenses: dejaPayees.map((d) => ({ id: d.id, fournisseur: d.vendor })),
      });
      return;
    }

    const { xml, nombre, total } = construireVirementSepa({
      donneur: { nom: org.name, iban: org.iban, bic: org.bic },
      dateExecution,
      maintenant: new Date(),
      identifiantRemise: `AB${orgId}-${Date.now().toString(36).toUpperCase()}`,
      beneficiaires: lignes.map((d) => ({
        reference: `DEP-${d.id}`,
        nom: d.vendor || "Fournisseur",
        iban: d.vendorIban!,
        bic: d.vendorBic,
        montant: num(d.amountTtc),
        libelle: [d.reference, d.title].filter(Boolean).join(" ") || `Depense ${d.id}`,
      })),
    });

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="virements_${dateExecution}.xml"`);
    res.setHeader("X-Virements-Nombre", String(nombre));
    res.setHeader("X-Virements-Total", total);
    res.send(xml);
  } catch (err) {
    if (err instanceof ErreurVirement) {
      // Le message nomme la ligne fautive : c'est ce qui permet de la corriger.
      res.status(400).json({ error: err.messagePublic, reference: err.reference });
      return;
    }
    logger.error({ err }, "[depenses] remise de virements en echec");
    res.status(500).json({ error: "Le fichier de virements n'a pas pu etre produit." });
  }
});

/**
 * GET /depenses/comptes — le plan de l'organisation, et celui qu'on propose.
 *
 * Les deux sont renvoyes ensemble et distinctement : ce qui est ENREGISTRE,
 * et ce qui est SUGGERE. Melanger les deux ferait croire a un reglage
 * applique d'office, alors que le choix du compte appartient au cabinet.
 */
router.get("/depenses/comptes", requireResponsable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const lignes = await db.select().from(comptesDepenseTable)
    .where(eq(comptesDepenseTable.organisationId, orgId));
  res.json({
    comptes: lignes.map((l) => ({ categorie: l.categorie, compteCharge: l.compteCharge, compteTva: l.compteTva })),
    propose: PLAN_PROPOSE_BTP.map(([categorie, compteCharge, compteTva]) => ({ categorie, compteCharge, compteTva })),
    categories: EXPENSE_CATEGORIES,
  });
});

/**
 * PUT /depenses/comptes — enregistre le plan choisi.
 *
 * Remplace ce qui existe pour les categories fournies, et n'y touche pas pour
 * les autres : un enregistrement partiel ne doit pas effacer le reste.
 */
router.put("/depenses/comptes", requireResponsable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const brutes = Array.isArray(req.body?.comptes) ? req.body.comptes : null;
  if (!brutes) { res.status(400).json({ error: "Aucun compte a enregistrer." }); return; }
  if (brutes.length > 100) { res.status(400).json({ error: "Trop de lignes." }); return; }

  let lignes;
  try {
    lignes = brutes.map((b: Record<string, unknown>) => validerLigne(b));
  } catch (err) {
    if (err instanceof ErreurCompte) {
      // Le champ fautif est nomme : sans lui, l'utilisateur cherche.
      res.status(400).json({ error: err.messagePublic, issues: [{ path: err.champ ?? "comptes", message: err.messagePublic }] });
      return;
    }
    throw err;
  }

  // Une categorie ne peut etre citee deux fois : la derniere ecraserait la
  // premiere en silence, et l'ecran afficherait autre chose que ce qui a ete
  // saisi.
  const vues = new Set<string>();
  for (const l of lignes) {
    if (vues.has(l.categorie)) {
      res.status(400).json({ error: `La categorie ${l.categorie} est citee deux fois.` });
      return;
    }
    vues.add(l.categorie);
  }

  for (const l of lignes) {
    await db.insert(comptesDepenseTable)
      .values({ organisationId: orgId, categorie: l.categorie, compteCharge: l.compteCharge, compteTva: l.compteTva })
      .onConflictDoUpdate({
        target: [comptesDepenseTable.organisationId, comptesDepenseTable.categorie],
        set: { compteCharge: l.compteCharge, compteTva: l.compteTva, updatedAt: new Date() },
      });
  }
  res.json({ ok: true, enregistrees: lignes.length });
});

/** DELETE /depenses/comptes/:categorie — retire une ligne du plan. */
router.delete("/depenses/comptes/:categorie", requireResponsable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const categorie = String(req.params.categorie ?? "");
  const supprimees = await db.delete(comptesDepenseTable)
    .where(and(eq(comptesDepenseTable.organisationId, orgId), eq(comptesDepenseTable.categorie, categorie)))
    .returning({ id: comptesDepenseTable.id });
  if (supprimees.length === 0) { res.status(404).json({ error: "Aucun compte pour cette categorie." }); return; }
  res.json({ ok: true });
});

export default router;
