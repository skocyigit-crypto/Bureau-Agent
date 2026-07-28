import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, ilike, or, sql, and, type Column, type SQL } from "drizzle-orm";
import { db, facturesClientTable } from "@workspace/db";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { sendInvoiceReminderEmail } from "../services/email";
import { generateUniqueReference } from "../lib/unique-reference";
import { computeInvoiceTotals, isValidCurrency, parseUserDate, clampPagination, normalizePaidAmount } from "../services/invoice-totals";

const router: IRouter = Router();

const STATUSES = ["brouillon", "envoyee", "payee", "partiellement_payee", "en_retard", "annulee"] as const;

// Intervalle minimal entre deux relances d'une meme facture (anti-spam serveur).
const REMINDER_COOLDOWN_HOURS = Number(process.env.INVOICE_REMINDER_COOLDOWN_HOURS) || 24;

// Backoffice SaaS (super-admin uniquement). Plus de filtre organisation_id
// par defaut: la vue est globale. Un parametre ?organisationId= permet de
// scoper une organisation specifique. Voir Tâche #53.
function parseOrgFilter(req: Request): number | null {
  const raw = (req.query as Record<string, unknown>).organisationId;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

router.get("/factures-client", async (req: Request, res: Response): Promise<void> => {
  const { search, status } = req.query as any;
  const { limit, offset } = clampPagination((req.query as any).limit, (req.query as any).offset);
  const conditions: SQL[] = [];
  const orgFilter = parseOrgFilter(req);
  if (orgFilter != null) conditions.push(eq(facturesClientTable.organisationId, orgFilter));
  if (status && status !== "all") conditions.push(eq(facturesClientTable.status, status));
  if (search) {
    const useUnaccent = await ensureUnaccentExtension();
    const pattern = `%${search}%`;
    const il = (col: Column): SQL => accentInsensitiveIlike(col, pattern, useUnaccent);
    conditions.push(or(
      il(facturesClientTable.title),
      il(facturesClientTable.reference),
      il(facturesClientTable.clientName),
      il(facturesClientTable.clientCompany),
    )!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  try {
    const [rows, countRes] = await Promise.all([
      (where ? db.select().from(facturesClientTable).where(where) : db.select().from(facturesClientTable))
        .orderBy(desc(facturesClientTable.createdAt)).limit(limit).offset(offset),
      where
        ? db.select({ count: sql<number>`count(*)::int` }).from(facturesClientTable).where(where)
        : db.select({ count: sql<number>`count(*)::int` }).from(facturesClientTable),
    ]);
    res.json({ factures: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste factures");
    res.status(500).json({ error: "Erreur lors de la recuperation des factures." });
  }
});

router.get("/factures-client/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id));
    if (!row) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur get facture");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/factures-client", async (req: Request, res: Response): Promise<void> => {
  const { reference, title, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items, subtotal, taxAmount, totalAmount, paidAmount, isAutoliquidation, currency = "EUR", status = "brouillon", dueDate, paymentMethod, notes, conditions, contactId, devisId, organisationId } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!clientName?.trim()) { res.status(400).json({ error: "Le client est obligatoire." }); return; }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: "Statut invalide." }); return; }
  if (!isValidCurrency(currency)) { res.status(400).json({ error: "Devise invalide (code ISO 4217 attendu)." }); return; }
  const dueDateVal = parseUserDate(dueDate);
  if (dueDateVal === undefined) { res.status(400).json({ error: "Date d'échéance invalide." }); return; }
  const totalsPre = computeInvoiceTotals(Array.isArray(items) ? items : [], { autoliquidation: !!isAutoliquidation });
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
      const [existing] = await db.select({ id: facturesClientTable.id }).from(facturesClientTable)
        .where(and(eq(facturesClientTable.organisationId, targetOrg), eq(facturesClientTable.reference, candidate)));
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
      ref = await generateUniqueReference("FAC", checkExists);
    }
    const [row] = await db.insert(facturesClientTable).values({
      organisationId: targetOrg,
      reference: ref,
      title: title.trim(),
      clientName: clientName.trim(),
      clientEmail: clientEmail ?? null,
      clientPhone: clientPhone ?? null,
      clientAddress: clientAddress ?? null,
      clientCompany: clientCompany ?? null,
      // Totaux recalcules et valides ci-dessus; l'autoliquidation force TVA=0.
      items: totalsPre.lines,
      subtotal: String(totalsPre.subtotal),
      taxAmount: String(totalsPre.taxAmount),
      totalAmount: String(totalsPre.totalAmount),
      isAutoliquidation: !!isAutoliquidation,
      // paidAmount borne: jamais negatif, jamais au-dessus du plafond, jamais null.
      paidAmount: normalizePaidAmount(paidAmount),
      currency,
      status,
      dueDate: dueDateVal,
      paymentMethod: paymentMethod ?? null,
      notes: notes ?? null,
      conditions: conditions ?? null,
      contactId: contactId ? Number(contactId) : null,
      devisId: devisId ? Number(devisId) : null,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation facture");
    res.status(500).json({ error: "Erreur lors de la creation." });
  }
});

router.patch("/factures-client/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [existing] = await db.select({ id: facturesClientTable.id }).from(facturesClientTable).where(eq(facturesClientTable.id, id));
    if (!existing) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    const b = req.body ?? {};
    if (b.status !== undefined && !STATUSES.includes(b.status)) { res.status(400).json({ error: "Statut invalide." }); return; }
    if (b.currency !== undefined && !isValidCurrency(b.currency)) { res.status(400).json({ error: "Devise invalide." }); return; }
    const updates: any = { updatedAt: new Date() };
    for (const k of ["title", "clientName", "clientEmail", "clientPhone", "clientAddress", "clientCompany", "currency", "status", "notes", "conditions", "paymentMethod"]) {
      if (b[k] !== undefined) updates[k] = b[k];
    }
    // Reference: unicite verifiee aussi en modification (une facture legale ne
    // peut pas partager son numero avec une autre — exigence Factur-X incluse).
    if (b.reference !== undefined && String(b.reference).trim()) {
      const newRef = String(b.reference).trim();
      const [dup] = await db.select({ id: facturesClientTable.id }).from(facturesClientTable)
        .where(and(eq(facturesClientTable.reference, newRef), sql`${facturesClientTable.id} <> ${id}`));
      if (dup) { res.status(409).json({ error: `La reference "${newRef}" existe deja.` }); return; }
      updates.reference = newRef;
    }
    // paidAmount reste saisissable (encaissement partiel), borne >= 0; les
    // totaux sont TOUJOURS derives des lignes, jamais du client.
    if (b.paidAmount !== undefined) updates.paidAmount = normalizePaidAmount(b.paidAmount);
    if (b.isAutoliquidation !== undefined) updates.isAutoliquidation = !!b.isAutoliquidation;
    if (b.items !== undefined || b.isAutoliquidation !== undefined) {
      const [cur] = await db.select({ items: facturesClientTable.items, isAutoliquidation: facturesClientTable.isAutoliquidation })
        .from(facturesClientTable).where(eq(facturesClientTable.id, id));
      const effectiveItems = b.items !== undefined ? (Array.isArray(b.items) ? b.items : []) : (cur?.items ?? []);
      const effectiveAutoliq = b.isAutoliquidation !== undefined ? !!b.isAutoliquidation : !!cur?.isAutoliquidation;
      const t = computeInvoiceTotals(effectiveItems, { autoliquidation: effectiveAutoliq });
      if (t.overflow) { res.status(400).json({ error: "Montant trop élevé." }); return; }
      updates.items = t.lines;
      updates.subtotal = String(t.subtotal);
      updates.taxAmount = String(t.taxAmount);
      updates.totalAmount = String(t.totalAmount);
    }
    if (b.dueDate !== undefined) {
      const d = parseUserDate(b.dueDate);
      if (d === undefined) { res.status(400).json({ error: "Date d'échéance invalide." }); return; }
      updates.dueDate = d;
    }
    // Coherence statut <-> paiement: si on marque "payee", on cale paidAmount
    // sur le total; un statut "payee" avec paidAmount=0 etait incoherent (faux
    // encaissement dans les KPI). Reciproquement `paidAt` est renseigne.
    if (b.status === "payee") {
      updates.paidAt = new Date();
      const [cur] = await db.select({ totalAmount: facturesClientTable.totalAmount }).from(facturesClientTable).where(eq(facturesClientTable.id, id));
      if (updates.totalAmount === undefined && cur) updates.paidAmount = cur.totalAmount;
      else if (updates.totalAmount !== undefined) updates.paidAmount = updates.totalAmount;
    }
    const [row] = await db.update(facturesClientTable).set(updates).where(eq(facturesClientTable.id, id)).returning();
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour facture");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

// Relance d'une facture impayee : envoie un email courtois au client et
// enregistre la relance (compteur + date). Backoffice super-admin uniquement
// (le routeur est monte derriere requireSuperAdmin dans routes/index.ts).
router.post("/factures-client/:id/relance", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [facture] = await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id));
    if (!facture) { res.status(404).json({ error: "Facture non trouvee." }); return; }

    if (!facture.clientEmail || !facture.clientEmail.trim()) {
      res.status(400).json({ error: "Aucun email client renseigne pour cette facture." });
      return;
    }
    if (facture.status === "payee" || facture.status === "annulee") {
      res.status(400).json({ error: "Cette facture est deja reglee ou annulee — aucune relance necessaire." });
      return;
    }

    // Garde anti-spam : une relance par facture toutes les 24h maximum. Le bouton
    // UI demande deja confirmation, mais cette protection est cote serveur (un
    // double-clic ou un script ne peut pas inonder le client de rappels).
    if (facture.lastReminderAt) {
      const elapsedMs = Date.now() - new Date(facture.lastReminderAt).getTime();
      const cooldownMs = REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000;
      if (elapsedMs < cooldownMs) {
        const hoursLeft = Math.ceil((cooldownMs - elapsedMs) / (60 * 60 * 1000));
        res.status(429).json({ error: `Une relance a deja ete envoyee recemment. Reessayez dans ${hoursLeft}h.` });
        return;
      }
    }

    const total = parseFloat(facture.totalAmount || "0");
    const paid = parseFloat(facture.paidAmount || "0");
    const remaining = Math.max((Number.isFinite(total) ? total : 0) - (Number.isFinite(paid) ? paid : 0), 0);
    if (remaining <= 0) {
      res.status(400).json({ error: "Aucun montant restant du sur cette facture — aucune relance necessaire." });
      return;
    }
    const amountLabel = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: facture.currency || "EUR",
      maximumFractionDigits: 2,
    }).format(remaining);

    const dueDateLabel = facture.dueDate ? new Date(facture.dueDate).toLocaleDateString("fr-FR") : null;
    const isOverdue = facture.status === "en_retard"
      || (facture.dueDate != null && new Date(facture.dueDate).getTime() < Date.now());
    const reminderNumber = (facture.reminderCount ?? 0) + 1;

    const result = await sendInvoiceReminderEmail({
      to: facture.clientEmail.trim(),
      clientName: facture.clientName,
      reference: facture.reference,
      title: facture.title,
      amountLabel,
      dueDateLabel,
      isOverdue,
      reminderNumber,
    });

    if (!result.success) {
      req.log.error({ err: result.error, factureId: id }, "Echec envoi relance facture");
      res.status(502).json({ error: result.error || "L'envoi de l'email de relance a echoue." });
      return;
    }

    const now = new Date();
    const [updated] = await db.update(facturesClientTable)
      .set({ reminderCount: reminderNumber, lastReminderAt: now, updatedAt: now })
      .where(eq(facturesClientTable.id, id))
      .returning();

    req.log.info({ factureId: id, reminderNumber, provider: result.provider }, "Relance facture envoyee");
    res.json({ ok: true, reminderCount: updated.reminderCount, lastReminderAt: updated.lastReminderAt, provider: result.provider });
  } catch (err: any) {
    req.log.error({ err }, "Erreur relance facture");
    res.status(500).json({ error: "Erreur lors de l'envoi de la relance." });
  }
});

router.delete("/factures-client/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const result = await db.delete(facturesClientTable).where(eq(facturesClientTable.id, id)).returning({ id: facturesClientTable.id });
    if (result.length === 0) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression facture");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
