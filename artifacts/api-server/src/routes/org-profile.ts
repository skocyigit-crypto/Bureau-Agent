import { Router, type Request, type Response } from "express";
import { db, organisationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";

const router = Router();

router.get("/org-profile", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "Non autorise." });
    return;
  }

  try {
    const [org] = await db
      .select({
        id: organisationsTable.id,
        name: organisationsTable.name,
        slug: organisationsTable.slug,
        email: organisationsTable.email,
        phone: organisationsTable.phone,
        address: organisationsTable.address,
        logo: organisationsTable.logo,
        aiAgentName: organisationsTable.aiAgentName,
        siret: organisationsTable.siret,
        tvaNumber: organisationsTable.tvaNumber,
        legalForm: organisationsTable.legalForm,
        capital: organisationsTable.capital,
        bankName: organisationsTable.bankName,
        bankIban: organisationsTable.bankIban,
        bankBic: organisationsTable.bankBic,
        invoiceFooter: organisationsTable.invoiceFooter,
        autoInvoiceEnabled: organisationsTable.autoInvoiceEnabled,
        autoEmailInvoice: organisationsTable.autoEmailInvoice,
        expenseAutoCaptureEnabled: organisationsTable.expenseAutoCaptureEnabled,
        createdAt: organisationsTable.createdAt,
      })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, orgId));

    if (!org) {
      res.status(404).json({ error: "Organisation introuvable." });
      return;
    }

    res.json(org);
  } catch (err: any) {
    req.log.error({ err }, "Erreur GET org-profile");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.put("/org-profile", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userRole = req.session?.userRole;

  if (!orgId) {
    res.status(403).json({ error: "Non autorise." });
    return;
  }

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Seuls les administrateurs peuvent modifier le profil." });
    return;
  }

  const {
    name,
    email,
    phone,
    address,
    logo,
    aiAgentName,
    siret,
    tvaNumber,
    legalForm,
    capital,
    bankName,
    bankIban,
    bankBic,
    invoiceFooter,
    autoInvoiceEnabled,
    autoEmailInvoice,
    expenseAutoCaptureEnabled,
  } = req.body;

  const updates: Record<string, any> = {};

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (trimmed.length < 2) {
      res.status(400).json({ error: "Le nom doit contenir au moins 2 caracteres." });
      return;
    }
    updates.name = trimmed;
  }

  if (email !== undefined) updates.email = email ? String(email).toLowerCase().trim() : null;
  if (phone !== undefined) updates.phone = phone ? String(phone).trim() : null;
  if (address !== undefined) updates.address = address ? String(address).trim() : null;
  if (logo !== undefined) updates.logo = logo ? String(logo).trim() : null;
  if (aiAgentName !== undefined) {
    const agentName = aiAgentName ? String(aiAgentName).trim().slice(0, 100) : null;
    updates.aiAgentName = agentName;
  }
  if (siret !== undefined) updates.siret = siret ? String(siret).trim() : null;
  if (tvaNumber !== undefined) updates.tvaNumber = tvaNumber ? String(tvaNumber).trim() : null;
  if (legalForm !== undefined) updates.legalForm = legalForm ? String(legalForm).trim() : null;
  if (capital !== undefined) updates.capital = capital ? String(capital).trim() : null;
  if (bankName !== undefined) updates.bankName = bankName ? String(bankName).trim() : null;
  if (bankIban !== undefined) updates.bankIban = bankIban ? String(bankIban).trim() : null;
  if (bankBic !== undefined) updates.bankBic = bankBic ? String(bankBic).trim() : null;
  if (invoiceFooter !== undefined) updates.invoiceFooter = invoiceFooter ? String(invoiceFooter).trim() : null;
  if (autoInvoiceEnabled !== undefined) updates.autoInvoiceEnabled = Boolean(autoInvoiceEnabled);
  if (autoEmailInvoice !== undefined) updates.autoEmailInvoice = Boolean(autoEmailInvoice);
  if (expenseAutoCaptureEnabled !== undefined) updates.expenseAutoCaptureEnabled = Boolean(expenseAutoCaptureEnabled);

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Aucune donnee a mettre a jour." });
    return;
  }

  try {
    const [updated] = await db
      .update(organisationsTable)
      .set(updates)
      .where(eq(organisationsTable.id, orgId))
      .returning({
        id: organisationsTable.id,
        name: organisationsTable.name,
        email: organisationsTable.email,
        phone: organisationsTable.phone,
        address: organisationsTable.address,
        logo: organisationsTable.logo,
        aiAgentName: organisationsTable.aiAgentName,
      });

    res.json({ message: "Profil mis a jour avec succes.", organisation: updated });
  } catch (err: any) {
    req.log.error({ err }, "Erreur PUT org-profile");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

export default router;
