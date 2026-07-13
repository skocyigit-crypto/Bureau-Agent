import { Router, type Request, type Response } from "express";
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
import { computeDedupeHash, parseDocumentDate } from "../services/expense-capture";
import { withDbRetry } from "../lib/db-retry";
import { logger } from "../lib/logger";

const router = Router();
const requireMinAgent = requireRole("super_admin", "administrateur", "agent");

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

    res.json({
      depenses: rows,
      summary: {
        ...summary,
        payableCount: payable?.count ?? 0,
        payableTotal: payable?.total ?? 0,
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
router.get("/depenses/export", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const conds = buildFilterConditions(req, orgId);
    const hasStatus = typeof req.query.status === "string" && STATUS_SET.has(req.query.status);
    if (!hasStatus) conds.push(eq(depensesTable.status, "approuve"));
    const baseClause = and(...conds);

    const escape = (v: unknown): string => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[";\n]/.test(s) ? `"${s}"` : s;
    };
    const fmtDate = (d: Date | string | null): string => {
      if (!d) return "";
      const dt = d instanceof Date ? d : new Date(d);
      return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
    };
    const headers = [
      "Date",
      "Fournisseur",
      "Libellé",
      "Référence",
      "Catégorie",
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

    let lastId = Number.MAX_SAFE_INTEGER;
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
        res.write("\uFEFF" + headers.join(";") + "\n");
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
    let amountHt = num(body.amountHt);
    let amountTva = num(body.amountTva);
    if (amountTtc <= 0 && amountHt <= 0) {
      res.status(400).json({ error: "Un montant (HT ou TTC) est requis." });
      return;
    }
    const ttc = amountTtc > 0 ? amountTtc : amountHt + Math.max(0, amountTva);
    if (amountHt <= 0) amountHt = Math.max(0, ttc - Math.max(0, amountTva));
    if (amountTva <= 0) amountTva = Math.max(0, ttc - amountHt);

    const category = typeof body.category === "string" && CATEGORY_SET.has(body.category) ? body.category : "autre";
    const paymentStatus =
      typeof body.paymentStatus === "string" && PAYMENT_SET.has(body.paymentStatus) ? body.paymentStatus : "a_payer";
    const status = body.status === "approuve" ? "approuve" : "en_attente";
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
        notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
        dedupeHash,
        duplicateOfId: dup?.id ?? null,
        createdBy: userId,
        reviewedBy: status === "approuve" ? userId : null,
        reviewedAt: status === "approuve" ? new Date() : null,
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
    if (typeof body.category === "string" && CATEGORY_SET.has(body.category)) update.category = body.category;
    if (typeof body.paymentStatus === "string" && PAYMENT_SET.has(body.paymentStatus)) {
      update.paymentStatus = body.paymentStatus;
    }
    if ("expenseDate" in body) update.expenseDate = parseDocumentDate(body.expenseDate);
    if ("dueDate" in body) update.dueDate = parseDocumentDate(body.dueDate);
    if (body.amountHt !== undefined) update.amountHt = num(body.amountHt).toFixed(2);
    if (body.amountTva !== undefined) update.amountTva = num(body.amountTva).toFixed(2);
    if (body.amountTtc !== undefined) update.amountTtc = num(body.amountTtc).toFixed(2);

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

    const [updated] = await db
      .update(depensesTable)
      .set(update)
      .where(and(eq(depensesTable.id, id), eq(depensesTable.organisationId, orgId)))
      .returning();

    res.json({ success: true, depense: updated, duplicate: !!updated?.duplicateOfId });
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
router.post("/depenses/:id/approve", requireMinAgent, (req, res) => setStatus(req, res, "approuve"));
// POST /depenses/:id/reject — écarte la dépense.
router.post("/depenses/:id/reject", requireMinAgent, (req, res) => setStatus(req, res, "rejete"));

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
        .returning({ id: depensesTable.id });
      if (deleted.length === 0) {
        res.status(404).json({ error: "Dépense introuvable." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "[depenses] delete failed");
      res.status(500).json({ error: "Erreur lors de la suppression de la dépense." });
    }
  },
);

export default router;
