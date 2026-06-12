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
        workingDays: organisationsTable.workingDays,
        workingHoursStart: organisationsTable.workingHoursStart,
        workingHoursEnd: organisationsTable.workingHoursEnd,
        appointmentTimezone: organisationsTable.appointmentTimezone,
        appointmentDurationMinutes: organisationsTable.appointmentDurationMinutes,
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
    workingDays,
    workingHoursStart,
    workingHoursEnd,
    appointmentTimezone,
    appointmentDurationMinutes,
  } = req.body;

  const updates: Record<string, any> = {};

  const parseHHMM = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  };
  const hhmmToMinutes = (value: string): number => {
    const [h, min] = value.split(":").map(Number);
    return h * 60 + min;
  };

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

  // Horaires d'ouverture (disponibilites RDV + standard vocal).
  if (workingDays !== undefined) {
    const raw = Array.isArray(workingDays)
      ? workingDays
      : String(workingDays).split(",");
    const days = Array.from(
      new Set(
        raw
          .map((d: unknown) => Number(String(d).trim()))
          .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 7),
      ),
    ).sort((a, b) => a - b);
    if (days.length === 0) {
      res.status(400).json({ error: "Selectionnez au moins un jour d'ouverture." });
      return;
    }
    updates.workingDays = days.join(",");
  }

  // Les heures de debut/fin sont liees: on doit verifier la coherence en tenant
  // compte des valeurs deja en base si une seule des deux est fournie.
  let nextStart: string | undefined;
  let nextEnd: string | undefined;
  if (workingHoursStart !== undefined) {
    const parsed = parseHHMM(workingHoursStart);
    if (!parsed) {
      res.status(400).json({ error: "Heure d'ouverture invalide (format attendu HH:MM)." });
      return;
    }
    nextStart = parsed;
    updates.workingHoursStart = parsed;
  }
  if (workingHoursEnd !== undefined) {
    const parsed = parseHHMM(workingHoursEnd);
    if (!parsed) {
      res.status(400).json({ error: "Heure de fermeture invalide (format attendu HH:MM)." });
      return;
    }
    nextEnd = parsed;
    updates.workingHoursEnd = parsed;
  }
  if (nextStart !== undefined || nextEnd !== undefined) {
    let startVal = nextStart;
    let endVal = nextEnd;
    if (startVal === undefined || endVal === undefined) {
      const [current] = await db
        .select({
          workingHoursStart: organisationsTable.workingHoursStart,
          workingHoursEnd: organisationsTable.workingHoursEnd,
        })
        .from(organisationsTable)
        .where(eq(organisationsTable.id, orgId));
      if (startVal === undefined) startVal = current?.workingHoursStart ?? "09:00";
      if (endVal === undefined) endVal = current?.workingHoursEnd ?? "18:00";
    }
    if (hhmmToMinutes(endVal) <= hhmmToMinutes(startVal)) {
      res.status(400).json({ error: "L'heure de fermeture doit etre posterieure a l'heure d'ouverture." });
      return;
    }
  }

  if (appointmentTimezone !== undefined) {
    const tz = String(appointmentTimezone).trim();
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      res.status(400).json({ error: "Fuseau horaire invalide." });
      return;
    }
    updates.appointmentTimezone = tz;
  }

  if (appointmentDurationMinutes !== undefined) {
    const dur = Number(appointmentDurationMinutes);
    if (!Number.isInteger(dur) || dur < 5 || dur > 480) {
      res.status(400).json({ error: "La duree d'un rendez-vous doit etre comprise entre 5 et 480 minutes." });
      return;
    }
    updates.appointmentDurationMinutes = dur;
  }

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
        workingDays: organisationsTable.workingDays,
        workingHoursStart: organisationsTable.workingHoursStart,
        workingHoursEnd: organisationsTable.workingHoursEnd,
        appointmentTimezone: organisationsTable.appointmentTimezone,
        appointmentDurationMinutes: organisationsTable.appointmentDurationMinutes,
      });

    res.json({ message: "Profil mis a jour avec succes.", organisation: updated });
  } catch (err: any) {
    req.log.error({ err }, "Erreur PUT org-profile");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

export default router;
