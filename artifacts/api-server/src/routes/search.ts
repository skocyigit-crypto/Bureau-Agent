import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { contactsTable, callsTable, tasksTable, messagesTable } from "@workspace/db/schema";
import { ilike, or, desc } from "drizzle-orm";

const router = Router();

router.get("/search", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const { q, limit = "5" } = req.query;

  if (!q || typeof q !== "string" || q.trim().length < 2) {
    res.json({ contacts: [], calls: [], tasks: [], messages: [], totalResults: 0 });
    return;
  }

  const term = `%${q.trim()}%`;
  const parsedLimit = parseInt(limit as string);
  const maxResults = isNaN(parsedLimit) ? 5 : Math.min(Math.max(parsedLimit, 1), 10);

  const [contacts, calls, tasks, messages] = await Promise.all([
    db.select()
      .from(contactsTable)
      .where(or(
        ilike(contactsTable.lastName, term),
        ilike(contactsTable.firstName, term),
        ilike(contactsTable.company, term),
        ilike(contactsTable.email, term),
        ilike(contactsTable.phone, term)
      ))
      .orderBy(desc(contactsTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(callsTable)
      .where(or(
        ilike(callsTable.contactName, term),
        ilike(callsTable.phoneNumber, term),
        ilike(callsTable.notes, term)
      ))
      .orderBy(desc(callsTable.createdAt))
      .limit(maxResults),

    db.select()
      .from(tasksTable)
      .where(or(
        ilike(tasksTable.title, term),
        ilike(tasksTable.description, term)
      ))
      .orderBy(desc(tasksTable.updatedAt))
      .limit(maxResults),

    db.select()
      .from(messagesTable)
      .where(or(
        ilike(messagesTable.content, term),
        ilike(messagesTable.contactName, term)
      ))
      .orderBy(desc(messagesTable.createdAt))
      .limit(maxResults),
  ]);

  res.json({
    contacts,
    calls,
    tasks,
    messages,
    totalResults: contacts.length + calls.length + tasks.length + messages.length,
  });
});

export default router;
