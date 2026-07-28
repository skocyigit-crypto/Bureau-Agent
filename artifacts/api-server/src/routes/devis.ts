import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, ilike, or, sql, and, type Column, type SQL } from "drizzle-orm";
import { db, devisTable, facturesClientTable } from "@workspace/db";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { generateUniqueReference } from "../lib/unique-reference";
import { computeInvoiceTotals, isValidCurrency, parseUserDate, clampPagination } from "../services/invoice-totals";

const router: IRouter = Router();

const STATUSES = ["brouillon", "envoye", "accepte", "refuse", "expire"] as const;

// Backoffice SaaS (super-admin uniquement). Plus de filtre organisation_id
// par defaut: la vue est globale. Un parametre ?organisationId= permet de
// scoper une organisation specifique pour le tri/QA. Voir Tâche #53.
function parseOrgFilter(req: Request): number | null {
  const raw = (req.query as Record<string, unknown>).organisationId;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

router.get("/devis", async (req: Request, res: Response): Promise<void> => {
  const { search, status } = req.query as any;
  const { limit, offset } = clampPagination((req.query as any).limit, (req.query as any).offset);
  const conditions: SQL[] = [];
  const orgFilter = parseOrgFilter(req);
  if (orgFilter != null) conditions.push(eq(devisTable.organisationId, orgFilter));
  if (status && status !== "all") conditions.push(eq(devisTable.status, status));
  if (search) {
    const useUnaccent = await ensureUnaccentExtension();
    const pattern = `%${search}%`;
    const il = (col: Column): SQL => accentInsensitiveIlike(col, pattern, useUnaccent);
    conditions.push(or(
      il(devisTable.title),
      il(devisTable.reference),
      il(devisTable.clientName),
      il(devisTable.clientCompany),
    )!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  try {
    const [rows, countRes] = await Promise.all([
      (where ? db.select().from(devisTable).where(where) : db.select().from(devisTable))
        .orderBy(desc(devisTable.createdAt)).limit(limit).offset(offset),
      where
        ? db.select({ count: sql<number>`count(*)::int` }).from(devisTable).where(where)
        : db.select({ count: sql<number>`count(*)::int` }).from(devisTable),
    ]);
    res.json({ devis: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste devis");
    res.status(500).json({ error: "Erreur lors de la recuperation des devis." });
  }
});

router.get("/devis/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(devisTable).where(eq(devisTable.id, id));
    if (!row) { res.status(404).json({ error: "Devis non trouve." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur get devis");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/devis", async (req: Request, res: Response): Promise<void> => {
  const { reference, title, description, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items, subtotal, taxAmount, totalAmount, currency = "EUR", status = "brouillon", validUntil, notes, conditions, contactId, prospectId, organisationId } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!clientName?.trim()) { res.status(400).json({ error: "Le client est obligatoire." }); return; }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: "Statut invalide." }); return; }
  if (!isValidCurrency(currency)) { res.status(400).json({ error: "Devise invalide (code ISO 4217 attendu)." }); return; }
  const validUntilDate = parseUserDate(validUntil);
  if (validUntilDate === undefined) { res.status(400).json({ error: "Date de validité invalide." }); return; }
  const totalsPre = computeInvoiceTotals(Array.isArray(items) ? items : []);
  if (totalsPre.overflow) { res.status(400).json({ error: "Montant trop élevé (dépasse la limite autorisée)." }); return; }
  const orgFromBody = organisationId != null && organisationId !== "" ? Number(organisationId) : null;
  if (orgFromBody != null && (!Number.isInteger(orgFromBody) || orgFromBody <= 0)) {
    res.status(400).json({ error: "organisationId invalide." });
    return;
  }
  const sessionOrg = req.session?.organisationId ?? null;
  const targetOrg = orgFromBody ?? sessionOrg;
  if (targetOrg == null) {
    res.status(400).json({ error: "organisationId requis (le super-admin n'a pas d'organisation rattachee)." });
    return;
  }
  try {
    const checkExists = async (candidate: string): Promise<boolean> => {
      const [existing] = await db.select({ id: devisTable.id }).from(devisTable)
        .where(and(eq(devisTable.organisationId, targetOrg), eq(devisTable.reference, candidate)));
      return !!existing;
    };
    let ref: string;
    if (reference && String(reference).trim()) {
      ref = String(reference).trim();
      if (await checkExists(ref)) {
        res.status(409).json({ error: `La reference "${ref}" existe deja pour cette organisation.` });
        return;
      }
    } else {
      ref = await generateUniqueReference("DEV", checkExists);
    }
    const [row] = await db.insert(devisTable).values({
      organisationId: targetOrg,
      reference: ref,
      title: title.trim(),
      description: description ?? null,
      clientName: clientName.trim(),
      clientEmail: clientEmail ?? null,
      clientPhone: clientPhone ?? null,
      clientAddress: clientAddress ?? null,
      clientCompany: clientCompany ?? null,
      // Totaux recalcules cote serveur a partir des seules lignes (deja
      // calcules et valides ci-dessus): on ignore les subtotal/taxAmount/
      // totalAmount envoyes par le client.
      items: totalsPre.lines,
      subtotal: String(totalsPre.subtotal),
      taxAmount: String(totalsPre.taxAmount),
      totalAmount: String(totalsPre.totalAmount),
      currency,
      status,
      validUntil: validUntilDate,
      notes: notes ?? null,
      conditions: conditions ?? null,
      contactId: contactId ? Number(contactId) : null,
      prospectId: prospectId ? Number(prospectId) : null,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation devis");
    res.status(500).json({ error: "Erreur lors de la creation." });
  }
});

router.patch("/devis/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [existing] = await db.select({ id: devisTable.id }).from(devisTable).where(eq(devisTable.id, id));
    if (!existing) { res.status(404).json({ error: "Devis non trouve." }); return; }
    const b = req.body ?? {};
    if (b.status !== undefined && !STATUSES.includes(b.status)) { res.status(400).json({ error: "Statut invalide." }); return; }
    if (b.currency !== undefined && !isValidCurrency(b.currency)) { res.status(400).json({ error: "Devise invalide." }); return; }
    const updates: any = { updatedAt: new Date() };
    for (const k of ["title", "description", "clientName", "clientEmail", "clientPhone", "clientAddress", "clientCompany", "currency", "status", "notes", "conditions"]) {
      if (b[k] !== undefined) updates[k] = b[k];
    }
    // Reference: unicite verifiee aussi en modification (elle ne l'etait qu'a la
    // creation), sinon deux devis pouvaient partager la meme reference.
    if (b.reference !== undefined && String(b.reference).trim()) {
      const newRef = String(b.reference).trim();
      const [dup] = await db.select({ id: devisTable.id }).from(devisTable)
        .where(and(eq(devisTable.reference, newRef), sql`${devisTable.id} <> ${id}`));
      if (dup) { res.status(409).json({ error: `La reference "${newRef}" existe deja.` }); return; }
      updates.reference = newRef;
    }
    // Si les lignes changent, on recalcule les totaux cote serveur (jamais
    // depuis les valeurs client).
    if (b.items !== undefined) {
      const t = computeInvoiceTotals(Array.isArray(b.items) ? b.items : []);
      if (t.overflow) { res.status(400).json({ error: "Montant trop élevé." }); return; }
      updates.items = t.lines;
      updates.subtotal = String(t.subtotal);
      updates.taxAmount = String(t.taxAmount);
      updates.totalAmount = String(t.totalAmount);
    }
    if (b.validUntil !== undefined) {
      const d = parseUserDate(b.validUntil);
      if (d === undefined) { res.status(400).json({ error: "Date de validité invalide." }); return; }
      updates.validUntil = d;
    }
    if (b.status === "accepte") updates.acceptedAt = new Date();
    if (b.status === "refuse") updates.rejectedAt = new Date();
    const [row] = await db.update(devisTable).set(updates).where(eq(devisTable.id, id)).returning();
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour devis");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

/**
 * Convertit un devis en facture: copie les lignes, le client et les montants
 * (deja recalcules cote serveur) dans une nouvelle facture, puis relie les deux
 * (facture.devisId <-> devis.convertedToInvoice). C'est ici que la valeur
 * TRAVERSE reellement les segments — avant, chaque document ressaisissait ses
 * montants a la main.
 *
 * Idempotent: un verrou consultatif Postgres serialise les conversions du meme
 * devis, et `convertedToInvoice` empeche d'en creer une seconde (double clic,
 * rejeu). Renvoie la facture existante si le devis est deja converti.
 */
const DEVIS_CONVERT_LOCK_NAMESPACE = 4320;

router.post("/devis/:id/convert-to-facture", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  await db.execute(sql`SELECT pg_advisory_lock(${DEVIS_CONVERT_LOCK_NAMESPACE}, ${id})`);
  try {
    const [devis] = await db.select().from(devisTable).where(eq(devisTable.id, id));
    if (!devis) { res.status(404).json({ error: "Devis non trouve." }); return; }

    // Deja converti: on renvoie la facture liee plutot que d'en creer une autre.
    if (devis.convertedToInvoice) {
      const [existing] = await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, devis.convertedToInvoice));
      if (existing) { res.status(200).json({ facture: existing, alreadyConverted: true }); return; }
      // La facture liee a disparu (supprimee): on autorise une nouvelle conversion.
    }

    const orgId = devis.organisationId;
    const checkExists = async (candidate: string): Promise<boolean> => {
      const [e] = await db.select({ id: facturesClientTable.id }).from(facturesClientTable)
        .where(and(eq(facturesClientTable.organisationId, orgId), eq(facturesClientTable.reference, candidate)));
      return !!e;
    };
    const ref = await generateUniqueReference("FAC", checkExists);

    // Echeance par defaut: 30 jours (delai de paiement usuel B2B en France).
    const dueDate = new Date(Date.now() + 30 * 86400000);

    const [facture] = await db.insert(facturesClientTable).values({
      organisationId: orgId,
      contactId: devis.contactId ?? null,
      devisId: devis.id,
      reference: ref,
      title: devis.title,
      clientName: devis.clientName,
      clientEmail: devis.clientEmail ?? null,
      clientPhone: devis.clientPhone ?? null,
      clientAddress: devis.clientAddress ?? null,
      clientCompany: devis.clientCompany ?? null,
      // Les montants viennent du devis (deja calcules cote serveur): la valeur
      // se propage sans ressaisie.
      items: devis.items ?? [],
      subtotal: devis.subtotal,
      taxAmount: devis.taxAmount,
      totalAmount: devis.totalAmount,
      paidAmount: "0",
      currency: devis.currency,
      status: "brouillon",
      dueDate,
      conditions: devis.conditions ?? null,
      notes: devis.notes ?? null,
    }).returning();

    await db.update(devisTable)
      .set({ convertedToInvoice: facture.id, status: devis.status === "brouillon" ? "accepte" : devis.status, acceptedAt: devis.acceptedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(devisTable.id, id));

    res.status(201).json({ facture });
  } catch (err: any) {
    req.log.error({ err }, "Erreur conversion devis->facture");
    res.status(500).json({ error: "Erreur lors de la conversion." });
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${DEVIS_CONVERT_LOCK_NAMESPACE}, ${id})`).catch(() => {});
  }
});

router.delete("/devis/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const result = await db.delete(devisTable).where(eq(devisTable.id, id)).returning({ id: devisTable.id });
    if (result.length === 0) { res.status(404).json({ error: "Devis non trouve." }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression devis");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
