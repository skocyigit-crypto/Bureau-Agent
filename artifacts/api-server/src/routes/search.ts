import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { contactsTable, callsTable, tasksTable, messagesTable, prospectsTable, devisTable, facturesClientTable, stockArticlesTable, commandesFournisseurTable } from "@workspace/db/schema";
import { ilike, or, desc, and, eq } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";

const router = Router();

router.get("/search", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const { q, limit = "5" } = req.query;

  if (!q || typeof q !== "string" || q.trim().length < 2) {
    res.json({ contacts: [], calls: [], tasks: [], messages: [], prospects: [], devis: [], factures: [], stock: [], commandes: [], totalResults: 0 });
    return;
  }

  const orgId = getOrgId(req);
  const sanitized = q.trim().replace(/[%_\\]/g, "\\$&");
  const term = `%${sanitized}%`;
  const parsedLimit = parseInt(limit as string);
  const maxResults = isNaN(parsedLimit) ? 5 : Math.min(Math.max(parsedLimit, 1), 10);

  try {
  const [contacts, calls, tasks, messages, prospects, devis, factures, stock, commandes] = await Promise.all([
    db.select()
      .from(contactsTable)
      .where(and(
        eq(contactsTable.organisationId, orgId),
        or(
          ilike(contactsTable.lastName, term),
          ilike(contactsTable.firstName, term),
          ilike(contactsTable.company, term),
          ilike(contactsTable.email, term),
          ilike(contactsTable.phone, term)
        )
      ))
      .orderBy(desc(contactsTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(callsTable)
      .where(and(
        eq(callsTable.organisationId, orgId),
        or(
          ilike(callsTable.contactName, term),
          ilike(callsTable.phoneNumber, term),
          ilike(callsTable.notes, term)
        )
      ))
      .orderBy(desc(callsTable.createdAt))
      .limit(maxResults),

    db.select()
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organisationId, orgId),
        or(
          ilike(tasksTable.title, term),
          ilike(tasksTable.description, term)
        )
      ))
      .orderBy(desc(tasksTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(messagesTable)
      .where(and(
        eq(messagesTable.organisationId, orgId),
        or(
          ilike(messagesTable.content, term),
          ilike(messagesTable.contactName, term)
        )
      ))
      .orderBy(desc(messagesTable.createdAt))
      .limit(maxResults),

    db.select()
      .from(prospectsTable)
      .where(and(
        eq(prospectsTable.organisationId, orgId),
        or(
          ilike(prospectsTable.title, term),
          ilike(prospectsTable.contactName, term),
          ilike(prospectsTable.company, term),
          ilike(prospectsTable.email, term),
          ilike(prospectsTable.phone, term)
        )
      ))
      .orderBy(desc(prospectsTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(devisTable)
      .where(and(
        eq(devisTable.organisationId, orgId),
        or(
          ilike(devisTable.reference, term),
          ilike(devisTable.clientName, term),
          ilike(devisTable.clientEmail, term),
          ilike(devisTable.notes, term)
        )
      ))
      .orderBy(desc(devisTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(facturesClientTable)
      .where(and(
        eq(facturesClientTable.organisationId, orgId),
        or(
          ilike(facturesClientTable.reference, term),
          ilike(facturesClientTable.clientName, term),
          ilike(facturesClientTable.clientEmail, term),
          ilike(facturesClientTable.notes, term)
        )
      ))
      .orderBy(desc(facturesClientTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(stockArticlesTable)
      .where(and(
        eq(stockArticlesTable.organisationId, orgId),
        or(
          ilike(stockArticlesTable.name, term),
          ilike(stockArticlesTable.reference, term),
          ilike(stockArticlesTable.category, term),
          ilike(stockArticlesTable.description, term)
        )
      ))
      .orderBy(desc(stockArticlesTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(commandesFournisseurTable)
      .where(and(
        eq(commandesFournisseurTable.organisationId, orgId),
        or(
          ilike(commandesFournisseurTable.reference, term),
          ilike(commandesFournisseurTable.fournisseurName, term),
          ilike(commandesFournisseurTable.fournisseurEmail, term),
          ilike(commandesFournisseurTable.notes, term)
        )
      ))
      .orderBy(desc(commandesFournisseurTable.createdAt))
      .limit(maxResults),
  ]);

  res.json({
    contacts,
    calls,
    tasks,
    messages,
    prospects,
    devis,
    factures,
    stock,
    commandes,
    totalResults: contacts.length + calls.length + tasks.length + messages.length
      + prospects.length + devis.length + factures.length + stock.length + commandes.length,
  });
  } catch (err: any) {
    req.log.error({ err }, "Erreur recherche globale");
    res.status(500).json({ error: "Erreur lors de la recherche." });
  }
});

export default router;
