import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and, isNull, type Column, type SQL } from "drizzle-orm";
import { db, contactsTable, callsTable, tasksTable, calendarEventsTable, usersTable, projetsTable, messagesTable } from "@workspace/db";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import {
  ListContactsQueryParams,
  CreateContactBody,
  GetContactParams,
  UpdateContactParams,
  UpdateContactBody,
  DeleteContactParams,
} from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";
import { resolveUserNames, enrichWithUserNames, enrichSingle } from "../helpers/user-tracking";
import { zodErrorResponse } from "../lib/zod-error";

const router: IRouter = Router();

// Bornes de pagination pour les sous-ressources d'un contact (appels, taches,
// projets, devis). Sans plafond, un contact tres actif renvoyait toutes ses
// lignes d'un coup. limit borne a [1, MAX], offset >= 0.
const SUBRESOURCE_DEFAULT_LIMIT = 20;
const SUBRESOURCE_MAX_LIMIT = 200;

function parsePagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const rawLimit = parseInt(String(query.limit ?? ""), 10);
  const rawOffset = parseInt(String(query.offset ?? ""), 10);
  const limit = Number.isNaN(rawLimit)
    ? SUBRESOURCE_DEFAULT_LIMIT
    : Math.min(Math.max(rawLimit, 1), SUBRESOURCE_MAX_LIMIT);
  const offset = Number.isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);
  return { limit, offset };
}

const contactSortColumns: Record<string, any> = {
  createdAt: contactsTable.createdAt,
  firstName: contactsTable.firstName,
  lastName: contactsTable.lastName,
  company: contactsTable.company,
  totalCalls: contactsTable.totalCalls,
};

router.get("/contacts", async (req, res): Promise<void> => {
  const query = ListContactsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json(zodErrorResponse(query.error));
    return;
  }

  const orgId = getOrgId(req);
  const { search, category, limit, offset, sortBy, sortOrder } = query.data;

  const conditions = [eq(contactsTable.organisationId, orgId)];
  if (category && category !== "all") {
    conditions.push(eq(contactsTable.category, category));
  }
  const useUnaccent = await ensureUnaccentExtension();
  if (search) {
    const pattern = `%${search}%`;
    const il = (col: Column): SQL => accentInsensitiveIlike(col, pattern, useUnaccent);
    conditions.push(
      or(
        il(contactsTable.firstName),
        il(contactsTable.lastName),
        il(contactsTable.company),
        il(contactsTable.phone),
        il(contactsTable.email),
      )!
    );
  }

  const whereClause = and(...conditions);

  const sortCol = contactSortColumns[sortBy ?? "createdAt"] ?? contactsTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
    const [contacts, countResult] = await Promise.all([
      db
        .select()
        .from(contactsTable)
        .where(whereClause)
        .orderBy(orderFn(sortCol))
        .limit(limit ?? 50)
        .offset(offset ?? 0),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(contactsTable)
        .where(whereClause),
    ]);

    const userIds = contacts.flatMap((c: any) => [c.createdBy, c.updatedBy]);
    const userMap = await resolveUserNames(userIds);
    res.json({ contacts: enrichWithUserNames(contacts, userMap), total: countResult[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste contacts");
    res.status(500).json({ error: "Erreur lors de la recuperation des contacts." });
  }
});

router.post("/contacts", async (req, res): Promise<void> => {
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }

  const orgId = getOrgId(req);
  const userId = req.session?.userId;

  try {
    const [contact] = await db.insert(contactsTable).values({ ...parsed.data, organisationId: orgId, createdBy: userId, updatedBy: userId }).returning();
    res.status(201).json(contact);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation contact");
    res.status(500).json({ error: "Erreur lors de la creation du contact." });
  }
});

router.post("/contacts/import", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ error: "Aucune donnée fournie." }); return; }
  if (rows.length > 500) { res.status(400).json({ error: "Maximum 500 contacts par import." }); return; }

  let imported = 0, skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const firstName = String(row.firstName || row.prenom || row["Prénom"] || row["Prenom"] || "").trim();
    const lastName = String(row.lastName || row.nom || row["Nom"] || "").trim();
    if (!firstName && !lastName) { skipped++; errors.push(`Ligne ${i + 2}: prénom et nom vides`); continue; }
    try {
      await db.insert(contactsTable).values({
        organisationId: orgId,
        createdBy: userId,
        updatedBy: userId,
        firstName: firstName || "-",
        lastName: lastName || "-",
        email: String(row.email || row.Email || "").trim() || null,
        phone: String(row.phone || row.telephone || row.Téléphone || row.Tel || "").trim() || null,
        company: String(row.company || row.entreprise || row.Entreprise || "").trim() || null,
        notes: String(row.notes || row.Notes || "").trim() || null,
        category: String(row.category || row.categorie || row.Catégorie || "client").toLowerCase() || "client",
      } as any);
      imported++;
    } catch {
      skipped++;
      errors.push(`Ligne ${i + 2}: ${firstName} ${lastName} — doublon ou erreur`);
    }
  }

  res.json({ imported, skipped, errors: errors.slice(0, 20) });
});

router.get("/contacts/:id", async (req, res): Promise<void> => {
  const params = GetContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const orgId = getOrgId(req);

  try {
    const [contact] = await db.select().from(contactsTable).where(and(eq(contactsTable.id, params.data.id), eq(contactsTable.organisationId, orgId)));
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    const userMap = await resolveUserNames([contact.createdBy, contact.updatedBy]);
    res.json(enrichSingle(contact, userMap));
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation contact");
    res.status(500).json({ error: "Erreur lors de la recuperation du contact." });
  }
});

router.patch("/contacts/:id", async (req, res): Promise<void> => {
  const params = UpdateContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const parsed = UpdateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }

  const orgId = getOrgId(req);
  const userId = req.session?.userId;

  try {
    // On lit l'etat AVANT mise a jour pour calculer l'ancien nom d'affichage
    // ("prenom nom"). Cela permet de resynchroniser le snapshot contact_name
    // pose sur les messages lies, sans ecraser un nom saisi manuellement.
    const [existing] = await db
      .select({ firstName: contactsTable.firstName, lastName: contactsTable.lastName })
      .from(contactsTable)
      .where(and(eq(contactsTable.id, params.data.id), eq(contactsTable.organisationId, orgId)));

    if (!existing) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    const [contact] = await db.update(contactsTable)
      .set({ ...parsed.data, updatedBy: userId })
      .where(and(eq(contactsTable.id, params.data.id), eq(contactsTable.organisationId, orgId)))
      .returning();

    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    // Synchronisation du nom snapshote sur les messages lies. On ne touche
    // qu'aux messages dont contact_name correspond a l'ANCIEN nom auto-rempli
    // (ou est vide/NULL) : un nom saisi explicitement par l'utilisateur, donc
    // different de l'ancien snapshot, est preserve. Scope strict a l'org.
    const oldName = `${existing.firstName} ${existing.lastName}`.trim();
    const newName = `${contact.firstName} ${contact.lastName}`.trim();
    if (newName && newName !== oldName) {
      const matchAutoFilled = oldName
        ? or(
            eq(messagesTable.contactName, oldName),
            isNull(messagesTable.contactName),
            eq(messagesTable.contactName, ""),
          )
        : or(isNull(messagesTable.contactName), eq(messagesTable.contactName, ""));
      await db.update(messagesTable)
        .set({ contactName: newName })
        .where(and(
          eq(messagesTable.contactId, contact.id),
          eq(messagesTable.organisationId, orgId),
          matchAutoFilled!,
        ));
    }

    res.json(contact);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour contact");
    res.status(500).json({ error: "Erreur lors de la mise a jour du contact." });
  }
});

router.patch("/contacts/:id/tags", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  const { tags } = req.body;
  if (!Array.isArray(tags)) { res.status(400).json({ error: "tags doit être un tableau." }); return; }

  try {
    const [contact] = await db.update(contactsTable)
      .set({ updatedAt: new Date() } as any)
      .where(and(eq(contactsTable.id, id), eq(contactsTable.organisationId, orgId)))
      .returning();
    if (!contact) { res.status(404).json({ error: "Contact non trouvé." }); return; }

    await db.execute(
      sql`UPDATE contacts SET tags = ${tags}::text[] WHERE id = ${id} AND organisation_id = ${orgId}`
    );
    res.json({ ...contact, tags });
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour tags contact");
    res.status(500).json({ error: "Erreur lors de la mise à jour des tags." });
  }
});

router.post("/contacts/:id/duplicate", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  try {
    const [original] = await db.select().from(contactsTable).where(and(eq(contactsTable.id, id), eq(contactsTable.organisationId, orgId)));
    if (!original) { res.status(404).json({ error: "Contact non trouve." }); return; }
    const [copy] = await db.insert(contactsTable).values({
      organisationId: orgId,
      firstName: original.firstName,
      lastName: `${original.lastName} (copie)`,
      company: original.company,
      email: original.email,
      phone: original.phone,
      category: original.category,
      address: original.address,
      notes: original.notes,
      createdBy: userId,
      updatedBy: userId,
    }).returning();
    res.status(201).json(copy);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication contact");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.delete("/contacts/:id", async (req, res): Promise<void> => {
  const params = DeleteContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const orgId = getOrgId(req);

  try {
    const [contact] = await db.delete(contactsTable).where(and(eq(contactsTable.id, params.data.id), eq(contactsTable.organisationId, orgId))).returning();
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    await db.update(tasksTable).set({ relatedContactId: null }).where(and(eq(tasksTable.relatedContactId, params.data.id), eq(tasksTable.organisationId, orgId)));
    await db.update(calendarEventsTable).set({ relatedContactId: null }).where(and(eq(calendarEventsTable.relatedContactId, params.data.id), eq(calendarEventsTable.organisationId, orgId)));

    res.sendStatus(204);
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression contact");
    res.status(500).json({ error: "Erreur lors de la suppression du contact." });
  }
});

router.get("/contacts/:id/calls", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw!, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const orgId = getOrgId(req);
  const { limit, offset } = parsePagination(req.query);

  try {
    const [calls, countResult] = await Promise.all([
      db
        .select()
        .from(callsTable)
        .where(and(eq(callsTable.contactId, id), eq(callsTable.organisationId, orgId)))
        .orderBy(desc(callsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(callsTable)
        .where(and(eq(callsTable.contactId, id), eq(callsTable.organisationId, orgId))),
    ]);

    res.json({ calls, total: countResult[0]?.count ?? 0, limit, offset });
  } catch (err: any) {
    req.log.error({ err }, "Erreur appels contact");
    res.status(500).json({ error: "Erreur lors de la recuperation des appels." });
  }
});

router.get("/contacts/export/csv", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.organisationId, orgId))
      .orderBy(asc(contactsTable.lastName));
    const headers = ["Prénom", "Nom", "Email", "Téléphone", "Mobile", "Entreprise", "Catégorie", "Adresse", "Notes", "Créé le"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.firstName), escape(r.lastName), escape(r.email), escape(r.phone),
      escape(r.mobile), escape(r.company), escape(r.category), escape(r.address),
      escape(r.notes), escape(r.createdAt ? new Date(r.createdAt).toLocaleDateString("fr-FR") : ""),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="contacts_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export contacts CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

router.get("/contacts/:id/tasks", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw!, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const orgId = getOrgId(req);
  const { limit, offset } = parsePagination(req.query);

  try {
    const [tasks, countResult] = await Promise.all([
      db
        .select()
        .from(tasksTable)
        .where(and(eq(tasksTable.relatedContactId, id), eq(tasksTable.organisationId, orgId)))
        .orderBy(desc(tasksTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasksTable)
        .where(and(eq(tasksTable.relatedContactId, id), eq(tasksTable.organisationId, orgId))),
    ]);

    res.json({ tasks, total: countResult[0]?.count ?? 0, limit, offset });
  } catch (err: any) {
    req.log.error({ err }, "Erreur taches contact");
    res.status(500).json({ error: "Erreur lors de la recuperation des taches." });
  }
});

router.get("/contacts/:id/projets", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const orgId = getOrgId(req);
  const { limit, offset } = parsePagination(req.query);
  try {
    const contact = await db.select({ id: contactsTable.id }).from(contactsTable).where(and(eq(contactsTable.id, id), eq(contactsTable.organisationId, orgId))).limit(1);
    if (!contact[0]) { res.status(404).json({ error: "Contact not found" }); return; }
    const [projets, countResult] = await Promise.all([
      db.select({ id: projetsTable.id, title: projetsTable.title, status: projetsTable.status, progress: projetsTable.progress, endDate: projetsTable.endDate, budget: projetsTable.budget, clientName: projetsTable.clientName, createdAt: projetsTable.createdAt })
        .from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), eq(projetsTable.contactId, id))).orderBy(desc(projetsTable.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), eq(projetsTable.contactId, id))),
    ]);
    res.json({ projets, total: countResult[0]?.count ?? 0, limit, offset });
  } catch (err: any) {
    req.log.error({ err }, "Erreur projets contact");
    res.status(500).json({ error: "Erreur lors de la récupération des projets." });
  }
});

router.get("/contacts/:id/devis", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const orgId = getOrgId(req);
  const { limit, offset } = parsePagination(req.query);
  try {
    const contact = await db.select({ email: contactsTable.email, firstName: contactsTable.firstName, lastName: contactsTable.lastName, company: contactsTable.company }).from(contactsTable).where(and(eq(contactsTable.id, id), eq(contactsTable.organisationId, orgId))).limit(1);
    if (!contact[0]) { res.status(404).json({ error: "Contact not found" }); return; }
    const name = `${contact[0].firstName} ${contact[0].lastName}`.trim();
    const { devisTable, facturesClientTable } = await import("@workspace/db");
    const useUnaccent = await ensureUnaccentExtension();
    const namePattern = `%${name}%`;
    const devisWhere = and(eq(devisTable.organisationId, orgId), or(ilike(devisTable.clientEmail, contact[0].email || "__none__"), accentInsensitiveIlike(devisTable.clientName, namePattern, useUnaccent)));
    const facturesWhere = and(eq(facturesClientTable.organisationId, orgId), or(ilike(facturesClientTable.clientEmail, contact[0].email || "__none__"), accentInsensitiveIlike(facturesClientTable.clientName, namePattern, useUnaccent)));
    const [devisList, facturesList, devisCount, facturesCount] = await Promise.all([
      db.select({ id: devisTable.id, reference: devisTable.reference, status: devisTable.status, totalAmount: devisTable.totalAmount, createdAt: devisTable.createdAt }).from(devisTable)
        .where(devisWhere).orderBy(desc(devisTable.createdAt)).limit(limit).offset(offset),
      db.select({ id: facturesClientTable.id, reference: facturesClientTable.reference, status: facturesClientTable.status, totalAmount: facturesClientTable.totalAmount, paidAmount: facturesClientTable.paidAmount, createdAt: facturesClientTable.createdAt }).from(facturesClientTable)
        .where(facturesWhere).orderBy(desc(facturesClientTable.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(devisTable).where(devisWhere),
      db.select({ count: sql<number>`count(*)::int` }).from(facturesClientTable).where(facturesWhere),
    ]);
    res.json({ devis: devisList, factures: facturesList, devisTotal: devisCount[0]?.count ?? 0, facturesTotal: facturesCount[0]?.count ?? 0, limit, offset });
  } catch (err: any) {
    req.log.error({ err }, "Erreur devis/factures contact");
    res.status(500).json({ error: "Erreur lors de la récupération." });
  }
});

export default router;
