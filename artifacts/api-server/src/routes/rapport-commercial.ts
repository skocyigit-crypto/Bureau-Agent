import { Router, type Request, type Response } from "express";
import { eq, sql, and, gte, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import { devisTable, facturesClientTable, prospectsTable, stockArticlesTable } from "@workspace/db/schema";
import { getOrgId } from "../middleware/tenant";

const router = Router();

router.get("/commercial/rapport", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const months = Math.min(Math.max(parseInt(req.query.months as string) || 6, 1), 24);

  try {
    const orgFilter = eq(devisTable.organisationId, orgId);
    const facFilter = eq(facturesClientTable.organisationId, orgId);
    const prospFilter = eq(prospectsTable.organisationId, orgId);
    const stockFilter = eq(stockArticlesTable.organisationId, orgId);

    const [devisStats, factureStats, prospectStats, stockStats, monthlyRevenue, devisByMonth, prospectsByStage, topProducts] = await Promise.all([
      db.select({
        total: sql<number>`count(*)::int`,
        brouillon: sql<number>`count(*) filter (where ${devisTable.status} = 'brouillon')::int`,
        envoye: sql<number>`count(*) filter (where ${devisTable.status} = 'envoye')::int`,
        accepte: sql<number>`count(*) filter (where ${devisTable.status} = 'accepte')::int`,
        refuse: sql<number>`count(*) filter (where ${devisTable.status} = 'refuse')::int`,
        expire: sql<number>`count(*) filter (where ${devisTable.status} = 'expire')::int`,
        totalAmount: sql<number>`coalesce(sum(${devisTable.totalAmount}::numeric), 0)::numeric`,
        acceptedAmount: sql<number>`coalesce(sum(${devisTable.totalAmount}::numeric) filter (where ${devisTable.status} = 'accepte'), 0)::numeric`,
      }).from(devisTable).where(orgFilter),

      db.select({
        total: sql<number>`count(*)::int`,
        brouillon: sql<number>`count(*) filter (where ${facturesClientTable.status} = 'brouillon')::int`,
        emise: sql<number>`count(*) filter (where ${facturesClientTable.status} = 'emise')::int`,
        payee: sql<number>`count(*) filter (where ${facturesClientTable.status} = 'payee')::int`,
        annulee: sql<number>`count(*) filter (where ${facturesClientTable.status} = 'annulee')::int`,
        totalAmount: sql<number>`coalesce(sum(${facturesClientTable.totalAmount}::numeric), 0)::numeric`,
        paidAmount: sql<number>`coalesce(sum(${facturesClientTable.paidAmount}::numeric), 0)::numeric`,
        remainingAmount: sql<number>`coalesce(sum((${facturesClientTable.totalAmount}::numeric - coalesce(${facturesClientTable.paidAmount}::numeric, 0))) filter (where ${facturesClientTable.status} not in ('payee','annulee')), 0)::numeric`,
        overdueCount: sql<number>`count(*) filter (where ${facturesClientTable.dueDate} < now() and ${facturesClientTable.status} not in ('payee','annulee'))::int`,
      }).from(facturesClientTable).where(facFilter),

      db.select({
        total: sql<number>`count(*)::int`,
        prospect: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'prospect')::int`,
        qualification: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'qualification')::int`,
        proposition: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'proposition')::int`,
        negociation: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'negociation')::int`,
        gagne: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'gagne')::int`,
        perdu: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'perdu')::int`,
        totalValue: sql<number>`coalesce(sum(${prospectsTable.value}::numeric), 0)::numeric`,
        wonValue: sql<number>`coalesce(sum(${prospectsTable.value}::numeric) filter (where ${prospectsTable.stage} = 'gagne'), 0)::numeric`,
      }).from(prospectsTable).where(prospFilter),

      db.select({
        total: sql<number>`count(*)::int`,
        alerte: sql<number>`count(*) filter (where ${stockArticlesTable.status} = 'alerte')::int`,
        rupture: sql<number>`count(*) filter (where ${stockArticlesTable.status} = 'rupture')::int`,
        totalValue: sql<number>`coalesce(sum(${stockArticlesTable.quantity}::numeric * ${stockArticlesTable.unitPrice}::numeric), 0)::numeric`,
      }).from(stockArticlesTable).where(stockFilter),

      db.select({
        month: sql<string>`to_char(date_trunc('month', ${facturesClientTable.createdAt}), 'YYYY-MM')`,
        revenue: sql<number>`coalesce(sum(${facturesClientTable.paidAmount}::numeric) filter (where ${facturesClientTable.status} = 'payee'), 0)::numeric`,
        invoiced: sql<number>`coalesce(sum(${facturesClientTable.totalAmount}::numeric), 0)::numeric`,
        count: sql<number>`count(*)::int`,
      }).from(facturesClientTable)
        .where(and(facFilter, gte(facturesClientTable.createdAt, sql`now() - interval '${sql.raw(String(months))} months'`)))
        .groupBy(sql`date_trunc('month', ${facturesClientTable.createdAt})`)
        .orderBy(sql`date_trunc('month', ${facturesClientTable.createdAt})`),

      db.select({
        month: sql<string>`to_char(date_trunc('month', ${devisTable.createdAt}), 'YYYY-MM')`,
        total: sql<number>`count(*)::int`,
        accepte: sql<number>`count(*) filter (where ${devisTable.status} = 'accepte')::int`,
        refuse: sql<number>`count(*) filter (where ${devisTable.status} = 'refuse')::int`,
      }).from(devisTable)
        .where(and(orgFilter, gte(devisTable.createdAt, sql`now() - interval '${sql.raw(String(months))} months'`)))
        .groupBy(sql`date_trunc('month', ${devisTable.createdAt})`)
        .orderBy(sql`date_trunc('month', ${devisTable.createdAt})`),

      db.select({
        stage: prospectsTable.stage,
        count: sql<number>`count(*)::int`,
        value: sql<number>`coalesce(sum(${prospectsTable.value}::numeric), 0)::numeric`,
      }).from(prospectsTable)
        .where(and(prospFilter, sql`${prospectsTable.stage} not in ('gagne','perdu')`))
        .groupBy(prospectsTable.stage),

      db.select({
        name: stockArticlesTable.name,
        category: stockArticlesTable.category,
        quantity: stockArticlesTable.quantity,
        unitPrice: stockArticlesTable.unitPrice,
        totalValue: sql<number>`(${stockArticlesTable.quantity}::numeric * ${stockArticlesTable.unitPrice}::numeric)`,
      }).from(stockArticlesTable)
        .where(stockFilter)
        .orderBy(sql`(${stockArticlesTable.quantity}::numeric * ${stockArticlesTable.unitPrice}::numeric) desc`)
        .limit(5),
    ]);

    const d = devisStats[0];
    const conversionRate = d.total > 0 ? Math.round((d.accepte / d.total) * 100) : 0;

    res.json({
      devis: { ...d, conversionRate },
      factures: factureStats[0],
      prospects: prospectStats[0],
      stock: stockStats[0],
      monthlyRevenue,
      devisByMonth,
      prospectsByStage,
      topProducts,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur rapport commercial");
    res.status(500).json({ error: "Erreur lors du rapport commercial." });
  }
});

export default router;
