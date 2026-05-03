import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, sql, and, or, ilike } from "drizzle-orm";
import { db, devisTable, facturesClientTable, projetsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";

const router: IRouter = Router();

router.get("/clients", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const { search } = req.query as any;

    const [devisList, facturesList] = await Promise.all([
      db.select({
        clientName: devisTable.clientName,
        clientEmail: devisTable.clientEmail,
        clientPhone: devisTable.clientPhone,
        clientAddress: devisTable.clientAddress,
        clientCompany: devisTable.clientCompany,
      }).from(devisTable).where(and(eq(devisTable.organisationId, orgId))),
      db.select({
        clientName: facturesClientTable.clientName,
        clientEmail: facturesClientTable.clientEmail,
        clientPhone: facturesClientTable.clientPhone,
        clientAddress: facturesClientTable.clientAddress,
        clientCompany: facturesClientTable.clientCompany,
      }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId))),
    ]);

    const map = new Map<string, any>();
    for (const row of [...devisList, ...facturesList]) {
      const key = row.clientName.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, {
          name: row.clientName,
          email: row.clientEmail || null,
          phone: row.clientPhone || null,
          address: row.clientAddress || null,
          company: row.clientCompany || null,
        });
      } else {
        const existing = map.get(key);
        if (!existing.email && row.clientEmail) existing.email = row.clientEmail;
        if (!existing.phone && row.clientPhone) existing.phone = row.clientPhone;
        if (!existing.address && row.clientAddress) existing.address = row.clientAddress;
        if (!existing.company && row.clientCompany) existing.company = row.clientCompany;
      }
    }

    let clients = Array.from(map.values());
    if (search) {
      const q = (search as string).toLowerCase();
      clients = clients.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.company && c.company.toLowerCase().includes(q))
      );
    }
    clients.sort((a, b) => a.name.localeCompare(b.name, "fr"));

    res.json(clients);
  } catch (err) {
    req.log.error({ err }, "GET /clients");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/clients/:name", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const clientName = decodeURIComponent(req.params.name as string);

    const [devisList, facturesList, projetsList] = await Promise.all([
      db.select().from(devisTable).where(
        and(eq(devisTable.organisationId, orgId), ilike(devisTable.clientName, clientName))
      ).orderBy(desc(devisTable.createdAt)),
      db.select().from(facturesClientTable).where(
        and(eq(facturesClientTable.organisationId, orgId), ilike(facturesClientTable.clientName, clientName))
      ).orderBy(desc(facturesClientTable.createdAt)),
      db.select({
        id: projetsTable.id, title: projetsTable.title, status: projetsTable.status,
        priority: projetsTable.priority, progress: projetsTable.progress,
        budget: projetsTable.budget, spent: projetsTable.spent,
        startDate: projetsTable.startDate, endDate: projetsTable.endDate,
        createdAt: projetsTable.createdAt,
      }).from(projetsTable).where(
        and(eq(projetsTable.organisationId, orgId), ilike(projetsTable.clientName, clientName))
      ).orderBy(desc(projetsTable.createdAt)),
    ]);

    const totalDevis = devisList.reduce((s, d) => s + parseFloat(d.totalAmount || "0"), 0);
    const totalFactures = facturesList.reduce((s, f) => s + parseFloat(f.totalAmount || "0"), 0);
    const totalPaid = facturesList.reduce((s, f) => s + parseFloat(f.paidAmount || "0"), 0);
    const devisAcceptes = devisList.filter(d => d.status === "accepte").length;
    const facturesPayees = facturesList.filter(f => f.status === "payee").length;
    const overdueFactures = facturesList.filter(f => f.dueDate && new Date(f.dueDate) < new Date() && !["payee", "annulee"].includes(f.status));
    const projetsActifs = projetsList.filter(p => !["termine", "annule"].includes(p.status)).length;

    const profile = devisList[0] || facturesList[0];

    res.json({
      name: clientName,
      email: profile?.clientEmail || null,
      phone: profile?.clientPhone || null,
      address: profile?.clientAddress || null,
      company: profile?.clientCompany || null,
      stats: {
        devisCount: devisList.length,
        devisAcceptes,
        totalDevis,
        facturesCount: facturesList.length,
        facturesPayees,
        totalFactures,
        totalPaid,
        totalDue: Math.max(0, totalFactures - totalPaid),
        overdueCount: overdueFactures.length,
        overdueAmount: overdueFactures.reduce((s, f) => s + Math.max(0, parseFloat(f.totalAmount || "0") - parseFloat(f.paidAmount || "0")), 0),
        projetsCount: projetsList.length,
        projetsActifs,
      },
      devis: devisList,
      factures: facturesList,
      projets: projetsList,
    });
  } catch (err) {
    req.log.error({ err }, "GET /clients/:name");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/clients/export/csv", requireRole("agent"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const [devisList, facturesList] = await Promise.all([
      db.select({ clientName: devisTable.clientName, clientEmail: devisTable.clientEmail, clientPhone: devisTable.clientPhone, clientAddress: devisTable.clientAddress, clientCompany: devisTable.clientCompany, totalAmount: devisTable.totalAmount }).from(devisTable).where(eq(devisTable.organisationId, orgId)),
      db.select({ clientName: facturesClientTable.clientName, clientEmail: facturesClientTable.clientEmail, clientPhone: facturesClientTable.clientPhone, clientAddress: facturesClientTable.clientAddress, clientCompany: facturesClientTable.clientCompany, totalAmount: facturesClientTable.totalAmount, paidAmount: facturesClientTable.paidAmount }).from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId)),
    ]);
    const clientMap = new Map<string, any>();
    for (const d of devisList) {
      const key = d.clientName?.toLowerCase().trim() || "";
      if (!clientMap.has(key)) clientMap.set(key, { name: d.clientName, email: d.clientEmail, phone: d.clientPhone, address: d.clientAddress, company: d.clientCompany, devisCount: 0, totalDevis: 0, facturesCount: 0, totalFactures: 0, totalPaid: 0 });
      const c = clientMap.get(key); c.devisCount++; c.totalDevis += parseFloat(d.totalAmount || "0");
    }
    for (const f of facturesList) {
      const key = f.clientName?.toLowerCase().trim() || "";
      if (!clientMap.has(key)) clientMap.set(key, { name: f.clientName, email: f.clientEmail, phone: f.clientPhone, address: f.clientAddress, company: f.clientCompany, devisCount: 0, totalDevis: 0, facturesCount: 0, totalFactures: 0, totalPaid: 0 });
      const c = clientMap.get(key); c.facturesCount++; c.totalFactures += parseFloat(f.totalAmount || "0"); c.totalPaid += parseFloat(f.paidAmount || "0");
    }
    const escape = (v: any) => { if (v == null) return ""; const s = String(v).replace(/"/g, '""'); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s; };
    const headers = ["Nom", "Email", "Téléphone", "Société", "Adresse", "Devis", "Total devis (€)", "Factures", "Total facturé (€)", "Encaissé (€)", "Solde dû (€)"];
    const lines = [headers.join(","), ...[...clientMap.values()].map(c => [
      escape(c.name), escape(c.email), escape(c.phone), escape(c.company), escape(c.address),
      escape(c.devisCount), escape(c.totalDevis.toFixed(2)),
      escape(c.facturesCount), escape(c.totalFactures.toFixed(2)), escape(c.totalPaid.toFixed(2)),
      escape(Math.max(0, c.totalFactures - c.totalPaid).toFixed(2)),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="clients_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err) {
    req.log.error({ err }, "GET /clients/export/csv");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
