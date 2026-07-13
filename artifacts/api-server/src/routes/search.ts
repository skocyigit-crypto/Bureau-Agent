import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { contactsTable, callsTable, tasksTable, messagesTable, prospectsTable, devisTable, facturesClientTable, stockArticlesTable, commandesFournisseurTable, projetsTable } from "@workspace/db/schema";
import { ilike, or, desc, and, eq, type Column, type SQL } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";

const router = Router();

router.get("/search", async (req: Request, res: Response): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const { q, limit = "5" } = req.query;

  if (!q || typeof q !== "string" || q.trim().length < 2) {
    res.json({ contacts: [], calls: [], tasks: [], messages: [], prospects: [], devis: [], factures: [], stock: [], commandes: [], projets: [], totalResults: 0 });
    return;
  }

  const orgId = getOrgId(req);
  const sanitized = q.trim().replace(/[%_\\]/g, "\\$&");
  const term = `%${sanitized}%`;
  const parsedLimit = parseInt(limit as string);
  const maxResults = isNaN(parsedLimit) ? 5 : Math.min(Math.max(parsedLimit, 1), 10);

  try {
  const useUnaccent = await ensureUnaccentExtension();
  const il = (col: Column): SQL => accentInsensitiveIlike(col, term, useUnaccent);
  const [contacts, calls, tasks, messages, prospects, devis, factures, stock, commandes, projets] = await Promise.all([
    db.select()
      .from(contactsTable)
      .where(and(
        eq(contactsTable.organisationId, orgId),
        or(
          il(contactsTable.lastName),
          il(contactsTable.firstName),
          il(contactsTable.company),
          il(contactsTable.email),
          il(contactsTable.phone)
        )
      ))
      .orderBy(desc(contactsTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(callsTable)
      .where(and(
        eq(callsTable.organisationId, orgId),
        or(
          il(callsTable.contactName),
          il(callsTable.phoneNumber),
          il(callsTable.notes)
        )
      ))
      .orderBy(desc(callsTable.createdAt))
      .limit(maxResults),

    db.select()
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organisationId, orgId),
        or(
          il(tasksTable.title),
          il(tasksTable.description)
        )
      ))
      .orderBy(desc(tasksTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(messagesTable)
      .where(and(
        eq(messagesTable.organisationId, orgId),
        or(
          il(messagesTable.content),
          il(messagesTable.contactName)
        )
      ))
      .orderBy(desc(messagesTable.createdAt))
      .limit(maxResults),

    db.select()
      .from(prospectsTable)
      .where(and(
        eq(prospectsTable.organisationId, orgId),
        or(
          il(prospectsTable.title),
          il(prospectsTable.contactName),
          il(prospectsTable.company),
          il(prospectsTable.email),
          il(prospectsTable.phone)
        )
      ))
      .orderBy(desc(prospectsTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(devisTable)
      .where(and(
        eq(devisTable.organisationId, orgId),
        or(
          il(devisTable.reference),
          il(devisTable.clientName),
          il(devisTable.clientEmail),
          il(devisTable.notes)
        )
      ))
      .orderBy(desc(devisTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(facturesClientTable)
      .where(and(
        eq(facturesClientTable.organisationId, orgId),
        or(
          il(facturesClientTable.reference),
          il(facturesClientTable.clientName),
          il(facturesClientTable.clientEmail),
          il(facturesClientTable.notes)
        )
      ))
      .orderBy(desc(facturesClientTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(stockArticlesTable)
      .where(and(
        eq(stockArticlesTable.organisationId, orgId),
        or(
          il(stockArticlesTable.name),
          il(stockArticlesTable.reference),
          il(stockArticlesTable.category),
          il(stockArticlesTable.description)
        )
      ))
      .orderBy(desc(stockArticlesTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(commandesFournisseurTable)
      .where(and(
        eq(commandesFournisseurTable.organisationId, orgId),
        or(
          il(commandesFournisseurTable.reference),
          il(commandesFournisseurTable.fournisseurName),
          il(commandesFournisseurTable.fournisseurEmail),
          il(commandesFournisseurTable.notes)
        )
      ))
      .orderBy(desc(commandesFournisseurTable.createdAt))
      .limit(maxResults),

    db.select()
      .from(projetsTable)
      .where(and(
        eq(projetsTable.organisationId, orgId),
        or(
          il(projetsTable.title),
          il(projetsTable.clientName),
          il(projetsTable.clientCompany),
          il(projetsTable.description),
          il(projetsTable.notes)
        )
      ))
      .orderBy(desc(projetsTable.updatedAt))
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
    projets,
    totalResults: contacts.length + calls.length + tasks.length + messages.length
      + prospects.length + devis.length + factures.length + stock.length + commandes.length + projets.length,
  });
  } catch (err: any) {
    req.log.error({ err }, "Erreur recherche globale");
    res.status(500).json({ error: "Erreur lors de la recherche." });
  }
});

export default router;
