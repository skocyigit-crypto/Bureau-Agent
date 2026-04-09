import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, stockArticlesTable } from "@workspace/db";
import { scanBase64Content, logSecurityEvent } from "../middleware/security";
import {
  ListStockArticlesQueryParams,
  CreateStockArticleBody,
  GetStockArticleParams,
  UpdateStockArticleParams,
  UpdateStockArticleBody,
  DeleteStockArticleParams,
  ScanStockBarcodeParams,
  ImportStockPdfBody,
} from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";

const router: IRouter = Router();

const stockSortColumns: Record<string, any> = {
  createdAt: stockArticlesTable.createdAt,
  name: stockArticlesTable.name,
  reference: stockArticlesTable.reference,
  quantity: stockArticlesTable.quantity,
  category: stockArticlesTable.category,
  unitPrice: stockArticlesTable.unitPrice,
};

router.get("/stock", async (req, res): Promise<void> => {
  const query = ListStockArticlesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const { search, category, status, limit, offset, sortBy, sortOrder } = query.data;

  const conditions: any[] = [eq(stockArticlesTable.organisationId, orgId)];
  if (category && category !== "all") {
    conditions.push(eq(stockArticlesTable.category, category));
  }
  if (status && status !== "all") {
    conditions.push(eq(stockArticlesTable.status, status));
  }
  if (search) {
    conditions.push(
      or(
        ilike(stockArticlesTable.name, `%${search}%`),
        ilike(stockArticlesTable.reference, `%${search}%`),
        ilike(stockArticlesTable.barcode, `%${search}%`),
        ilike(stockArticlesTable.supplier, `%${search}%`),
        ilike(stockArticlesTable.description, `%${search}%`)
      )!
    );
  }

  const whereClause = and(...conditions);
  const sortCol = stockSortColumns[sortBy ?? "createdAt"] ?? stockArticlesTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const [articles, countResult] = await Promise.all([
    db.select().from(stockArticlesTable).where(whereClause).orderBy(orderFn(sortCol)).limit(limit ?? 50).offset(offset ?? 0),
    db.select({ count: sql<number>`count(*)::int` }).from(stockArticlesTable).where(whereClause),
  ]);

  res.json({ articles, total: countResult[0]?.count ?? 0 });
});

router.post("/stock", async (req, res): Promise<void> => {
  const body = CreateStockArticleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const VALID_CATEGORIES = ["general", "fourniture", "informatique", "mobilier", "consommable", "papeterie", "hygiene", "alimentaire", "autre"];
  const VALID_UNITS = ["piece", "boite", "carton", "paquet", "litre", "kg", "lot"];

  const insertData: any = { ...body.data, organisationId: orgId };
  if (insertData.category && !VALID_CATEGORIES.includes(insertData.category)) {
    insertData.category = "general";
  }
  if (insertData.unit && !VALID_UNITS.includes(insertData.unit)) {
    insertData.unit = "piece";
  }
  const qty = insertData.quantity ?? 0;
  const minQty = insertData.minQuantity ?? 5;
  if (qty === 0) insertData.status = "rupture";
  else if (qty <= minQty) insertData.status = "stock_faible";
  else insertData.status = insertData.status || "en_stock";

  const [article] = await db.insert(stockArticlesTable).values(insertData).returning();
  res.status(201).json(article);
});

router.get("/stock/stats", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const orgFilter = eq(stockArticlesTable.organisationId, orgId);

  const [totalResult] = await db.select({ count: sql<number>`count(*)::int` }).from(stockArticlesTable).where(orgFilter);
  const [valueResult] = await db.select({ total: sql<number>`COALESCE(SUM(quantity * COALESCE(unit_price::numeric, 0)), 0)::float` }).from(stockArticlesTable).where(orgFilter);
  const [lowStockResult] = await db.select({ count: sql<number>`count(*)::int` }).from(stockArticlesTable).where(and(orgFilter, eq(stockArticlesTable.status, "stock_faible")));
  const [outResult] = await db.select({ count: sql<number>`count(*)::int` }).from(stockArticlesTable).where(and(orgFilter, eq(stockArticlesTable.status, "rupture")));

  const categoryRows = await db.select({
    category: stockArticlesTable.category,
    count: sql<number>`count(*)::int`,
  }).from(stockArticlesTable).where(orgFilter).groupBy(stockArticlesTable.category);

  const categoryCounts: Record<string, number> = {};
  for (const row of categoryRows) {
    categoryCounts[row.category] = row.count;
  }

  res.json({
    totalArticles: totalResult?.count ?? 0,
    totalValue: valueResult?.total ?? 0,
    lowStockCount: lowStockResult?.count ?? 0,
    outOfStockCount: outResult?.count ?? 0,
    categoryCounts,
  });
});

router.get("/stock/scan/:barcode", async (req, res): Promise<void> => {
  const params = ScanStockBarcodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [article] = await db.select().from(stockArticlesTable)
    .where(and(
      eq(stockArticlesTable.organisationId, orgId),
      or(
        eq(stockArticlesTable.barcode, params.data.barcode),
        eq(stockArticlesTable.reference, params.data.barcode)
      )
    ))
    .limit(1);

  if (!article) {
    res.status(404).json({ error: "Article non trouve" });
    return;
  }

  res.json(article);
});

router.post("/stock/import/pdf", async (req, res): Promise<void> => {
  const body = ImportStockPdfBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const orgId = getOrgId(req);

  const scanResult = scanBase64Content(body.data.pdfContent, "import.pdf");
  if (!scanResult.safe) {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket?.remoteAddress || "unknown";
    logSecurityEvent("malicious_pdf_upload", ip, (req.session as any)?.userId, `PDF import bloque: ${scanResult.threats.join(", ")}`, "critical");
    res.status(400).json({
      error: "Le fichier PDF contient du contenu potentiellement dangereux et a ete bloque.",
      threats: scanResult.threats,
      code: "FILE_THREAT_DETECTED",
    });
    return;
  }

  try {
    const { ai } = await import("@workspace/integrations-gemini-ai");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: body.data.pdfContent,
            },
          },
          {
            text: `Analyse ce document PDF et extrais tous les articles/produits de stock.
Pour chaque article trouve, retourne un objet JSON avec ces champs:
- name: nom de l'article (obligatoire)
- reference: reference/code produit (obligatoire, genere un code REF-XXXX si absent)
- barcode: code-barres si present
- description: description courte
- category: une de ces valeurs: general, fourniture, informatique, mobilier, consommable, papeterie, hygiene, alimentaire, autre
- quantity: quantite (nombre entier, 0 si non specifie)
- minQuantity: quantite minimale de reapprovisionnement (5 par defaut)
- unitPrice: prix unitaire en string (ex: "12.50")
- supplier: fournisseur si mentionne
- location: emplacement de stockage si mentionne
- unit: une de ces valeurs: piece, boite, carton, paquet, litre, kg, lot

Reponds UNIQUEMENT en JSON avec cette structure:
{
  "articles": [...],
  "notes": "observations eventuelles sur le document"
}

Sois precis et exhaustif. Extrais TOUS les articles du document.`,
          },
        ],
      }],
      config: { maxOutputTokens: 16384, responseMimeType: "application/json" },
    });

    const text = response.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      res.status(422).json({ imported: 0, articles: [], errors: ["Impossible d'analyser le contenu du PDF"] });
      return;
    }

    const importedArticles = [];
    const errors: string[] = [];

    for (const item of parsed.articles || []) {
      try {
        if (!item.name || !item.reference) {
          errors.push(`Article ignore: nom ou reference manquant`);
          continue;
        }

        const [article] = await db.insert(stockArticlesTable).values({
          name: item.name,
          reference: item.reference,
          barcode: item.barcode || null,
          description: item.description || null,
          category: item.category || "general",
          quantity: parseInt(item.quantity) || 0,
          minQuantity: parseInt(item.minQuantity) || 5,
          unitPrice: item.unitPrice || null,
          supplier: item.supplier || null,
          location: item.location || null,
          unit: item.unit || "piece",
          status: (parseInt(item.quantity) || 0) === 0 ? "rupture" : (parseInt(item.quantity) || 0) <= (parseInt(item.minQuantity) || 5) ? "stock_faible" : "en_stock",
          organisationId: orgId,
        }).returning();

        importedArticles.push(article);
      } catch (e: any) {
        errors.push(`Erreur pour "${item.name}": ${e.message}`);
      }
    }

    res.json({ imported: importedArticles.length, articles: importedArticles, errors });
  } catch (error: any) {
    res.status(500).json({ imported: 0, articles: [], errors: [`Erreur IA: ${error.message}`] });
  }
});

router.get("/stock/:id", async (req, res): Promise<void> => {
  const params = GetStockArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [article] = await db.select().from(stockArticlesTable).where(and(eq(stockArticlesTable.id, params.data.id), eq(stockArticlesTable.organisationId, orgId))).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article non trouve" });
    return;
  }

  res.json(article);
});

router.put("/stock/:id", async (req, res): Promise<void> => {
  const params = UpdateStockArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateStockArticleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const updateData = { ...body.data };
  if (updateData.quantity !== undefined) {
    const minQty = updateData.minQuantity;
    if (updateData.quantity === 0) {
      updateData.status = "rupture";
    } else if (minQty !== undefined && updateData.quantity <= minQty) {
      updateData.status = "stock_faible";
    } else {
      const [existing] = await db.select().from(stockArticlesTable).where(and(eq(stockArticlesTable.id, params.data.id), eq(stockArticlesTable.organisationId, orgId))).limit(1);
      if (existing && updateData.quantity <= existing.minQuantity) {
        updateData.status = "stock_faible";
      } else {
        updateData.status = "en_stock";
      }
    }
  }

  const [article] = await db.update(stockArticlesTable)
    .set(updateData)
    .where(and(eq(stockArticlesTable.id, params.data.id), eq(stockArticlesTable.organisationId, orgId)))
    .returning();

  if (!article) {
    res.status(404).json({ error: "Article non trouve" });
    return;
  }

  res.json(article);
});

router.delete("/stock/:id", async (req, res): Promise<void> => {
  const params = DeleteStockArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [deleted] = await db.delete(stockArticlesTable).where(and(eq(stockArticlesTable.id, params.data.id), eq(stockArticlesTable.organisationId, orgId))).returning();
  if (!deleted) {
    res.status(404).json({ error: "Article non trouve" });
    return;
  }

  res.status(204).send();
});

export default router;
