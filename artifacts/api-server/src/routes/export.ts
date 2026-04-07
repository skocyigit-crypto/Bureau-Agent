import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { contactsTable, callsTable, tasksTable, messagesTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { logAudit } from "./audit";

const router = Router();

function toCsv(data: any[], columns: { key: string; label: string }[]): string {
  const header = columns.map(c => c.label).join(";");
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key];
      if (val === null || val === undefined) return "";
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(";")
  );
  return [header, ...rows].join("\n");
}

const VALID_ENTITIES = ["contacts", "appels", "taches", "messages"] as const;

router.get("/export/:entity", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const { entity } = req.params;

  if (!VALID_ENTITIES.includes(entity as any)) {
    res.status(400).json({ error: "Entite non supportee." });
    return;
  }

  let data: any[] = [];
  let columns: { key: string; label: string }[] = [];
  let filename = "";

  switch (entity) {
    case "contacts":
      data = await db.select().from(contactsTable).orderBy(desc(contactsTable.updatedAt));
      columns = [
        { key: "lastName", label: "Nom" },
        { key: "firstName", label: "Prenom" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Telephone" },
        { key: "company", label: "Entreprise" },
        { key: "category", label: "Categorie" },
        { key: "totalCalls", label: "Nombre d'appels" },
        { key: "createdAt", label: "Date de creation" },
      ];
      filename = "contacts";
      break;

    case "appels":
      data = await db.select().from(callsTable).orderBy(desc(callsTable.createdAt));
      columns = [
        { key: "contactName", label: "Contact" },
        { key: "phoneNumber", label: "Telephone" },
        { key: "direction", label: "Direction" },
        { key: "status", label: "Statut" },
        { key: "duration", label: "Duree (s)" },
        { key: "sentiment", label: "Sentiment" },
        { key: "notes", label: "Notes" },
        { key: "createdAt", label: "Date" },
      ];
      filename = "appels";
      break;

    case "taches":
      data = await db.select().from(tasksTable).orderBy(desc(tasksTable.updatedAt));
      columns = [
        { key: "title", label: "Titre" },
        { key: "description", label: "Description" },
        { key: "status", label: "Statut" },
        { key: "priority", label: "Priorite" },
        { key: "dueDate", label: "Echeance" },
        { key: "assignedTo", label: "Assigne a" },
        { key: "createdAt", label: "Date de creation" },
      ];
      filename = "taches";
      break;

    case "messages":
      data = await db.select().from(messagesTable).orderBy(desc(messagesTable.createdAt));
      columns = [
        { key: "contactName", label: "Contact" },
        { key: "content", label: "Contenu" },
        { key: "type", label: "Type" },
        { key: "priority", label: "Priorite" },
        { key: "isRead", label: "Lu" },
        { key: "createdAt", label: "Date" },
      ];
      filename = "messages";
      break;
  }

  logAudit(userId, (req.session as any)?.userEmail, "export", entity, undefined, { count: data.length });

  const csv = toCsv(data, columns);
  const date = new Date().toISOString().split("T")[0];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}_${date}.csv"`);
  res.send("\uFEFF" + csv);
});

export default router;
