import { Router, type Request, type Response } from "express";
import { db, organisationClosuresTable } from "@workspace/db";
import { and, eq, asc, inArray } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime());
}

router.get("/org-closures", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "Non autorise." });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(organisationClosuresTable)
      .where(eq(organisationClosuresTable.organisationId, orgId))
      .orderBy(asc(organisationClosuresTable.dateStart));

    res.json(rows);
  } catch (err: any) {
    req.log.error({ err }, "Erreur GET org-closures");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.post("/org-closures", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userRole = req.session?.userRole;

  if (!orgId) {
    res.status(403).json({ error: "Non autorise." });
    return;
  }

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Seuls les administrateurs peuvent gerer les fermetures." });
    return;
  }

  const { dateStart, dateEnd, label } = req.body;

  if (!dateStart || typeof dateStart !== "string" || !isValidDate(dateStart)) {
    res.status(400).json({ error: "Date de debut invalide (format attendu YYYY-MM-DD)." });
    return;
  }

  const end = dateEnd && typeof dateEnd === "string" && dateEnd.trim() ? dateEnd.trim() : dateStart;

  if (!isValidDate(end)) {
    res.status(400).json({ error: "Date de fin invalide (format attendu YYYY-MM-DD)." });
    return;
  }

  if (end < dateStart) {
    res.status(400).json({ error: "La date de fin doit etre posterieure ou egale a la date de debut." });
    return;
  }

  const labelVal = label && typeof label === "string" ? label.trim().slice(0, 200) || null : null;

  try {
    const [row] = await db
      .insert(organisationClosuresTable)
      .values({
        organisationId: orgId,
        dateStart: dateStart.trim(),
        dateEnd: end,
        label: labelVal,
      })
      .returning();

    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur POST org-closures");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

/**
 * Compute French public holidays for a given year.
 * Easter date calculated via the Meeus/Jones/Butcher algorithm.
 */
function frenchHolidays(year: number): Array<{ date: string; label: string }> {
  // Easter Sunday (Meeus/Jones/Butcher)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 1-based
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  const easter = new Date(Date.UTC(year, month - 1, day));

  function addDays(base: Date, n: number): string {
    const d = new Date(base.getTime() + n * 86400000);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }

  function fixed(mo: number, da: number): string {
    return `${year}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }

  return [
    { date: fixed(1, 1), label: "Jour de l'An" },
    { date: addDays(easter, 1), label: "Lundi de Pâques" },
    { date: fixed(5, 1), label: "Fête du Travail" },
    { date: fixed(5, 8), label: "Victoire 1945" },
    { date: addDays(easter, 39), label: "Ascension" },
    { date: addDays(easter, 50), label: "Lundi de Pentecôte" },
    { date: fixed(7, 14), label: "Fête Nationale" },
    { date: fixed(8, 15), label: "Assomption" },
    { date: fixed(11, 1), label: "Toussaint" },
    { date: fixed(11, 11), label: "Armistice" },
    { date: fixed(12, 25), label: "Noël" },
  ];
}

router.post("/org-closures/import-holidays", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userRole = req.session?.userRole;

  if (!orgId) {
    res.status(403).json({ error: "Non autorise." });
    return;
  }

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Seuls les administrateurs peuvent importer les jours feries." });
    return;
  }

  const rawYear = req.body?.year;
  const year = rawYear != null ? Number(rawYear) : new Date().getUTCFullYear();

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    res.status(400).json({ error: "Annee invalide (2000-2100 attendu)." });
    return;
  }

  try {
    const holidays = frenchHolidays(year);
    const holidayDates = holidays.map((h) => h.date);

    // Fetch already-existing closure dates for this org within the year
    const existing = await db
      .select({ dateStart: organisationClosuresTable.dateStart })
      .from(organisationClosuresTable)
      .where(
        and(
          eq(organisationClosuresTable.organisationId, orgId),
          inArray(organisationClosuresTable.dateStart, holidayDates),
        ),
      );

    const existingSet = new Set(existing.map((r) => r.dateStart));
    const toInsert = holidays.filter((h) => !existingSet.has(h.date));

    if (toInsert.length === 0) {
      res.json({ inserted: 0, skipped: holidays.length, message: "Tous les jours feries sont deja enregistres." });
      return;
    }

    const inserted = await db
      .insert(organisationClosuresTable)
      .values(
        toInsert.map((h) => ({
          organisationId: orgId,
          dateStart: h.date,
          dateEnd: h.date,
          label: h.label,
        })),
      )
      .returning();

    res.status(201).json({ inserted: inserted.length, skipped: existingSet.size, rows: inserted });
  } catch (err: any) {
    req.log.error({ err }, "Erreur POST org-closures/import-holidays");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.patch("/org-closures/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userRole = req.session?.userRole;

  if (!orgId) {
    res.status(403).json({ error: "Non autorise." });
    return;
  }

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Seuls les administrateurs peuvent gerer les fermetures." });
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }

  const { dateEnd, label } = req.body;

  const updates: Partial<{ dateEnd: string; label: string | null }> = {};

  if (dateEnd !== undefined) {
    if (typeof dateEnd !== "string" || !isValidDate(dateEnd)) {
      res.status(400).json({ error: "Date de fin invalide (format attendu YYYY-MM-DD)." });
      return;
    }
    updates.dateEnd = dateEnd.trim();
  }

  if (label !== undefined) {
    updates.label = label && typeof label === "string" ? label.trim().slice(0, 200) || null : null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Aucun champ a modifier." });
    return;
  }

  try {
    const existing = await db
      .select()
      .from(organisationClosuresTable)
      .where(and(eq(organisationClosuresTable.id, id), eq(organisationClosuresTable.organisationId, orgId)))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Fermeture introuvable." });
      return;
    }

    const current = existing[0];
    const effectiveDateEnd = updates.dateEnd ?? current.dateEnd;

    if (effectiveDateEnd < current.dateStart) {
      res.status(400).json({ error: "La date de fin doit etre posterieure ou egale a la date de debut." });
      return;
    }

    const [updated] = await db
      .update(organisationClosuresTable)
      .set(updates)
      .where(and(eq(organisationClosuresTable.id, id), eq(organisationClosuresTable.organisationId, orgId)))
      .returning();

    res.json(updated);
  } catch (err: any) {
    req.log.error({ err }, "Erreur PATCH org-closures");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.delete("/org-closures/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userRole = req.session?.userRole;

  if (!orgId) {
    res.status(403).json({ error: "Non autorise." });
    return;
  }

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Seuls les administrateurs peuvent gerer les fermetures." });
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }

  try {
    const result = await db
      .delete(organisationClosuresTable)
      .where(and(eq(organisationClosuresTable.id, id), eq(organisationClosuresTable.organisationId, orgId)))
      .returning({ id: organisationClosuresTable.id });

    if (result.length === 0) {
      res.status(404).json({ error: "Fermeture introuvable." });
      return;
    }

    res.json({ message: "Fermeture supprimee." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur DELETE org-closures");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

export default router;
