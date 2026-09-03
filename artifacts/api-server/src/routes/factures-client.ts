import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, ilike, or, sql, and, type Column, type SQL } from "drizzle-orm";
import { db, devisTable, facturesClientTable, organisationsTable } from "@workspace/db";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { sendInvoiceReminderEmail } from "../services/email";
import { generateUniqueReference } from "../lib/unique-reference";
import { getOrgId } from "../middleware/tenant";
import { deriveInvoiceStatus, overdueCondition } from "../services/invoice-status";
import { buildInvoiceDocument, invoiceFileName, renderInvoicePdf } from "../services/invoice-pdf";
import { buildFacturXXml } from "../services/facturx";
import { computeInvoiceTotals, isValidCurrency, parseUserDate, clampPagination, normalizePaidAmount } from "../services/invoice-totals";

const router: IRouter = Router();

const STATUSES = ["brouillon", "envoyee", "payee", "partiellement_payee", "en_retard", "annulee"] as const;

// Intervalle minimal entre deux relances d'une meme facture (anti-spam serveur).
const REMINDER_COOLDOWN_HOURS = Number(process.env.INVOICE_REMINDER_COOLDOWN_HOURS) || 24;

// Ressource TENANT: la facture appartient au client qui l'emet. Chaque requete
// est bornee a l'organisation de la session (`getOrgId`); aucun appelant ne
// choisit son `organisationId` (cf. routes/index.ts, "Customer content").

router.get("/factures-client", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, status } = req.query as any;
  const { limit, offset } = clampPagination((req.query as any).limit, (req.query as any).offset);
  const conditions: SQL[] = [eq(facturesClientTable.organisationId, orgId)];
  if (status === "en_retard") {
    // "En retard" est DEDUIT de l'echeance et du reste du, pas lu dans la
    // colonne: aucun chemin de code n'y ecrivait cette valeur, donc le filtre
    // ne renvoyait jamais rien (et le lien "Voir les factures en retard" des
    // insights tombait sur une liste vide).
    conditions.push(overdueCondition());
  } else if (status && status !== "all") {
    conditions.push(eq(facturesClientTable.status, status));
  }
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
  // Toujours defini: le filtre organisation est la premiere condition, donc
  // aucune branche ne peut interroger la table sans borne tenant.
  const where = and(...conditions);
  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(facturesClientTable).where(where)
        .orderBy(desc(facturesClientTable.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(facturesClientTable).where(where),
    ]);
    res.json({ factures: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste factures");
    res.status(500).json({ error: "Erreur lors de la recuperation des factures." });
  }
});

router.get("/factures-client/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(facturesClientTable)
      .where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    if (!row) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur get facture");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

/**
 * Facture PDF A4 conforme (identite du vendeur, lignes, ventilation de TVA,
 * mentions obligatoires). L'identite vendeur vient du profil de
 * l'organisation; si des mentions obligatoires manquent, le PDF est quand
 * meme produit et les manques sont journalises et renvoyes dans un en-tete
 * `X-Invoice-Warnings` (une facture incomplete doit se voir, pas echouer
 * silencieusement au moment ou l'utilisateur veut l'envoyer).
 */
router.get("/factures-client/:id/pdf", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [facture] = await db.select().from(facturesClientTable)
      .where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    if (!facture) { res.status(404).json({ error: "Facture non trouvee." }); return; }

    const [org] = await db.select({
      name: organisationsTable.name,
      legalForm: organisationsTable.legalForm,
      capital: organisationsTable.capital,
      address: organisationsTable.address,
      siret: organisationsTable.siret,
      tvaNumber: organisationsTable.tvaNumber,
      email: organisationsTable.email,
      phone: organisationsTable.phone,
      bankName: organisationsTable.bankName,
      bankIban: organisationsTable.bankIban,
      bankBic: organisationsTable.bankBic,
      invoiceFooter: organisationsTable.invoiceFooter,
    }).from(organisationsTable).where(eq(organisationsTable.id, orgId));

    const model = buildInvoiceDocument(facture, org ?? {});
    if (model.warnings.length > 0) {
      req.log.warn({ factureId: id, warnings: model.warnings }, "Facture PDF emise avec des mentions obligatoires manquantes");
      // En-tete ASCII: les avertissements sont rediges sans accent, mais on
      // encode malgre tout pour qu'un futur libelle ne casse pas la reponse.
      res.setHeader("X-Invoice-Warnings", encodeURIComponent(model.warnings.join(" | ")));
    }

    // Le XML part du MEME enregistrement que le PDF, dans la meme requete: il
    // ne peut donc pas decrire une version anterieure de la facture. Deux
    // appels separes le pourraient, et l'ecart ne se verrait sur aucun ecran.
    const facturX = buildFacturXXml(facture, org ?? {});
    const pdf = await renderInvoicePdf(model, { facturXXml: facturX.xml });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdf.length));
    res.setHeader("Content-Disposition", `inline; filename="${invoiceFileName(facture.reference)}"`);
    res.end(pdf);
  } catch (err: any) {
    req.log.error({ err }, "Erreur generation PDF facture");
    res.status(500).json({ error: "Erreur lors de la generation du PDF." });
  }
});

/**
 * Le XML CII seul, sans le PDF.
 *
 * La reforme du 1er septembre 2026 fait transiter les factures par des
 * plateformes (PDP) et par Chorus Pro pour la sphere publique, qui consomment
 * la donnee STRUCTUREE. Beaucoup acceptent un CII autonome: exposer le XML
 * evite d'obliger l'utilisateur a extraire une piece jointe a la main.
 *
 * Meme portee de tenant que le PDF: une facture appartient a une organisation,
 * et le format sous lequel on la demande n'y change rien.
 */
router.get("/factures-client/:id/facturx.xml", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [facture] = await db.select().from(facturesClientTable)
      .where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    if (!facture) { res.status(404).json({ error: "Facture non trouvee." }); return; }

    const [org] = await db.select({
      name: organisationsTable.name,
      legalForm: organisationsTable.legalForm,
      capital: organisationsTable.capital,
      address: organisationsTable.address,
      siret: organisationsTable.siret,
      tvaNumber: organisationsTable.tvaNumber,
      email: organisationsTable.email,
      phone: organisationsTable.phone,
      bankName: organisationsTable.bankName,
      bankIban: organisationsTable.bankIban,
      bankBic: organisationsTable.bankBic,
      invoiceFooter: organisationsTable.invoiceFooter,
    }).from(organisationsTable).where(eq(organisationsTable.id, orgId));

    const facturX = buildFacturXXml(facture, org ?? {});
    if (facturX.warnings.length > 0) {
      // Une donnee absente ne bloque pas l'emission — la facture existe et le
      // client l'attend — mais elle doit etre visible, sinon le rejet
      // arrivera plus tard et depuis l'exterieur.
      req.log.warn({ factureId: id, warnings: facturX.warnings }, "XML Factur-X emis avec des donnees manquantes");
      res.setHeader("X-Invoice-Warnings", encodeURIComponent(facturX.warnings.join(" | ")));
    }

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("X-Facturx-Profile", facturX.profile);
    res.setHeader("Content-Disposition", `attachment; filename="${invoiceFileName(facture.reference).replace(/\.pdf$/, "")}-factur-x.xml"`);
    res.end(facturX.xml);
  } catch (err: any) {
    req.log.error({ err }, "Erreur generation XML Factur-X");
    res.status(500).json({ error: "Erreur lors de la generation du XML." });
  }
});

router.post("/factures-client", async (req: Request, res: Response): Promise<void> => {
  const targetOrg = getOrgId(req);
  const { reference, title, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items, subtotal, taxAmount, totalAmount, paidAmount, isAutoliquidation, currency = "EUR", status = "brouillon", dueDate, paymentMethod, notes, conditions, contactId, devisId } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!clientName?.trim()) { res.status(400).json({ error: "Le client est obligatoire." }); return; }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: "Statut invalide." }); return; }
  if (!isValidCurrency(currency)) { res.status(400).json({ error: "Devise invalide (code ISO 4217 attendu)." }); return; }
  const dueDateVal = parseUserDate(dueDate);
  if (dueDateVal === undefined) { res.status(400).json({ error: "Date d'échéance invalide." }); return; }
  const totalsPre = computeInvoiceTotals(Array.isArray(items) ? items : [], { autoliquidation: !!isAutoliquidation });
  if (totalsPre.overflow) { res.status(400).json({ error: "Montant trop élevé (dépasse la limite autorisée)." }); return; }
  try {
    // Un devis lie doit appartenir a la meme organisation: sans ce controle,
    // une facture pourrait pointer vers le devis d'un autre client.
    const linkedDevis = devisId ? Number(devisId) : null;
    if (linkedDevis != null) {
      const [owned] = await db.select({ id: devisTable.id }).from(devisTable)
        .where(and(eq(devisTable.id, linkedDevis), eq(devisTable.organisationId, targetOrg)));
      if (!owned) { res.status(400).json({ error: "Devis lie introuvable." }); return; }
    }
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
      devisId: linkedDevis,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation facture");
    res.status(500).json({ error: "Erreur lors de la creation." });
  }
});

router.patch("/factures-client/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  const scoped = and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId));
  try {
    const [existing] = await db.select({ id: facturesClientTable.id }).from(facturesClientTable).where(scoped);
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
        .where(and(eq(facturesClientTable.organisationId, orgId), eq(facturesClientTable.reference, newRef), sql`${facturesClientTable.id} <> ${id}`));
      if (dup) { res.status(409).json({ error: `La reference "${newRef}" existe deja.` }); return; }
      updates.reference = newRef;
    }
    // paidAmount reste saisissable (encaissement partiel), borne >= 0; les
    // totaux sont TOUJOURS derives des lignes, jamais du client.
    if (b.paidAmount !== undefined) updates.paidAmount = normalizePaidAmount(b.paidAmount);
    if (b.isAutoliquidation !== undefined) updates.isAutoliquidation = !!b.isAutoliquidation;
    if (b.items !== undefined || b.isAutoliquidation !== undefined) {
      const [cur] = await db.select({ items: facturesClientTable.items, isAutoliquidation: facturesClientTable.isAutoliquidation })
        .from(facturesClientTable).where(scoped);
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
      const [cur] = await db.select({ totalAmount: facturesClientTable.totalAmount }).from(facturesClientTable).where(scoped);
      if (updates.totalAmount === undefined && cur) updates.paidAmount = cur.totalAmount;
      else if (updates.totalAmount !== undefined) updates.paidAmount = updates.totalAmount;
    } else if (b.status === undefined) {
      // Statut deduit quand l'appelant n'en impose pas: un encaissement
      // partiel doit se lire "partiellement payee", un solde atteint "payee".
      // Sans cela, `partiellement_payee` n'etait jamais atteint par l'API et
      // une facture soldee restait "envoyee" tant qu'un humain ne la corrigeait
      // pas. Un statut envoye explicitement reste souverain.
      const [cur] = await db.select({
        status: facturesClientTable.status,
        paidAmount: facturesClientTable.paidAmount,
        totalAmount: facturesClientTable.totalAmount,
        dueDate: facturesClientTable.dueDate,
      }).from(facturesClientTable).where(scoped);
      if (cur) {
        const derived = deriveInvoiceStatus({
          status: cur.status,
          paidAmount: updates.paidAmount ?? cur.paidAmount,
          totalAmount: updates.totalAmount ?? cur.totalAmount,
          dueDate: updates.dueDate ?? cur.dueDate,
        });
        if (derived) {
          updates.status = derived;
          if (derived === "payee") updates.paidAt = new Date();
        }
      }
    }
    const [row] = await db.update(facturesClientTable).set(updates).where(scoped).returning();
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour facture");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

// Relance d'une facture impayee : envoie un email courtois au client et
// enregistre la relance (compteur + date). Bornee a l'organisation de la
// session, comme le reste du routeur.
router.post("/factures-client/:id/relance", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  const scoped = and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId));
  try {
    const [facture] = await db.select().from(facturesClientTable).where(scoped);
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
      .where(scoped)
      .returning();

    req.log.info({ factureId: id, reminderNumber, provider: result.provider }, "Relance facture envoyee");
    res.json({ ok: true, reminderCount: updated.reminderCount, lastReminderAt: updated.lastReminderAt, provider: result.provider });
  } catch (err: any) {
    req.log.error({ err }, "Erreur relance facture");
    res.status(500).json({ error: "Erreur lors de l'envoi de la relance." });
  }
});

router.delete("/factures-client/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const result = await db.delete(facturesClientTable)
      .where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)))
      .returning({ id: facturesClientTable.id });
    if (result.length === 0) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression facture");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
