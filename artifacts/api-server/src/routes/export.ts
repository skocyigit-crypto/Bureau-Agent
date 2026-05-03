import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { contactsTable, callsTable, tasksTable, messagesTable, prospectsTable, devisTable, facturesClientTable, stockArticlesTable, commandesFournisseurTable } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import { logAudit } from "./audit";
import { getOrgId } from "../middleware/tenant";

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

const VALID_ENTITIES = ["contacts", "appels", "taches", "messages", "prospects", "devis", "factures", "stock", "commandes-fournisseur"] as const;

router.get("/export/:entity", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const orgId = getOrgId(req);
  const entity = String(req.params.entity);

  if (!VALID_ENTITIES.includes(entity as any)) {
    res.status(400).json({ error: "Entite non supportee." });
    return;
  }

  let data: any[] = [];
  let columns: { key: string; label: string }[] = [];
  let filename = "";

  try {
  switch (entity) {
    case "contacts":
      data = await db.select().from(contactsTable).where(eq(contactsTable.organisationId, orgId)).orderBy(desc(contactsTable.updatedAt));
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
      data = await db.select().from(callsTable).where(eq(callsTable.organisationId, orgId)).orderBy(desc(callsTable.createdAt));
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
      data = await db.select().from(tasksTable).where(eq(tasksTable.organisationId, orgId)).orderBy(desc(tasksTable.updatedAt));
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
      data = await db.select().from(messagesTable).where(eq(messagesTable.organisationId, orgId)).orderBy(desc(messagesTable.createdAt));
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

    case "prospects":
      data = await db.select().from(prospectsTable).where(eq(prospectsTable.organisationId, orgId)).orderBy(desc(prospectsTable.updatedAt));
      columns = [
        { key: "title", label: "Titre" },
        { key: "contactName", label: "Contact" },
        { key: "company", label: "Entreprise" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Telephone" },
        { key: "stage", label: "Etape" },
        { key: "priority", label: "Priorite" },
        { key: "value", label: "Valeur (EUR)" },
        { key: "probability", label: "Probabilite (%)" },
        { key: "source", label: "Source" },
        { key: "assignedTo", label: "Assigne a" },
        { key: "expectedCloseDate", label: "Date de cloture prevue" },
        { key: "notes", label: "Notes" },
        { key: "createdAt", label: "Date de creation" },
      ];
      filename = "prospects";
      break;

    case "devis":
      data = await db.select().from(devisTable).where(eq(devisTable.organisationId, orgId)).orderBy(desc(devisTable.updatedAt));
      columns = [
        { key: "reference", label: "Reference" },
        { key: "title", label: "Titre" },
        { key: "clientName", label: "Client" },
        { key: "clientCompany", label: "Entreprise" },
        { key: "clientEmail", label: "Email" },
        { key: "status", label: "Statut" },
        { key: "subtotal", label: "Sous-total HT" },
        { key: "taxAmount", label: "TVA" },
        { key: "totalAmount", label: "Total TTC" },
        { key: "currency", label: "Devise" },
        { key: "validUntil", label: "Valide jusqu'au" },
        { key: "notes", label: "Notes" },
        { key: "createdAt", label: "Date de creation" },
      ];
      filename = "devis";
      break;

    case "factures":
      data = await db.select().from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId)).orderBy(desc(facturesClientTable.updatedAt));
      columns = [
        { key: "reference", label: "Reference" },
        { key: "title", label: "Titre" },
        { key: "clientName", label: "Client" },
        { key: "clientCompany", label: "Entreprise" },
        { key: "clientEmail", label: "Email" },
        { key: "status", label: "Statut" },
        { key: "subtotal", label: "Sous-total HT" },
        { key: "taxAmount", label: "TVA" },
        { key: "totalAmount", label: "Total TTC" },
        { key: "paidAmount", label: "Montant paye" },
        { key: "currency", label: "Devise" },
        { key: "dueDate", label: "Echeance" },
        { key: "paymentMethod", label: "Mode de paiement" },
        { key: "notes", label: "Notes" },
        { key: "createdAt", label: "Date de creation" },
      ];
      filename = "factures";
      break;

    case "stock":
      data = await db.select().from(stockArticlesTable).where(eq(stockArticlesTable.organisationId, orgId)).orderBy(desc(stockArticlesTable.updatedAt));
      columns = [
        { key: "name", label: "Nom" },
        { key: "reference", label: "Reference" },
        { key: "barcode", label: "Code-barres" },
        { key: "category", label: "Categorie" },
        { key: "quantity", label: "Quantite" },
        { key: "minQuantity", label: "Quantite minimale" },
        { key: "unit", label: "Unite" },
        { key: "unitPrice", label: "Prix unitaire (EUR)" },
        { key: "status", label: "Statut" },
        { key: "supplier", label: "Fournisseur" },
        { key: "location", label: "Emplacement" },
        { key: "description", label: "Description" },
        { key: "updatedAt", label: "Derniere mise a jour" },
      ];
      filename = "stock";
      break;

    case "commandes-fournisseur":
      data = await db.select().from(commandesFournisseurTable).where(eq(commandesFournisseurTable.organisationId, orgId)).orderBy(desc(commandesFournisseurTable.createdAt));
      columns = [
        { key: "reference", label: "Reference" },
        { key: "fournisseurName", label: "Fournisseur" },
        { key: "fournisseurEmail", label: "Email" },
        { key: "fournisseurPhone", label: "Telephone" },
        { key: "status", label: "Statut" },
        { key: "subtotal", label: "Sous-total HT" },
        { key: "taxAmount", label: "TVA" },
        { key: "totalAmount", label: "Total TTC" },
        { key: "currency", label: "Devise" },
        { key: "expectedDelivery", label: "Livraison prevue" },
        { key: "receivedAt", label: "Recu le" },
        { key: "notes", label: "Notes" },
        { key: "createdAt", label: "Date de creation" },
      ];
      filename = "commandes_fournisseur";
      break;
  }

  logAudit(userId, (req.session as any)?.userEmail, "export", entity, undefined, { count: data.length });

  const csv = toCsv(data, columns);
  const date = new Date().toISOString().split("T")[0];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}_${date}.csv"`);
  res.send("\uFEFF" + csv);
  } catch (err: any) {
    req.log.error({ err }, "Erreur export CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

export default router;
