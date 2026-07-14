import { Router } from "express";
import { db } from "@workspace/db";
import {
  dataSubjectRequestsTable, DATA_REQUEST_TYPES,
  legalAgreementsTable, LEGAL_DOCUMENTS,
  usersTable, contactsTable, callsTable, tasksTable,
  checkinsTable, prospectsTable, notesInternesTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { getDataProtectionStatus } from "../services/data-protection-monitor";

const router = Router();

router.get("/data-protection/summary", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    const orgId = req.session?.organisationId;
    if (!userId || !orgId) { res.status(401).json({ error: "Non authentifie." }); return; }

    const [users, contacts, calls, tasks, prospects, checkins, notes] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(contactsTable).where(eq(contactsTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(eq(callsTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(eq(tasksTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(prospectsTable).where(eq(prospectsTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(checkinsTable).where(eq(checkinsTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(notesInternesTable).where(eq(notesInternesTable.organisationId, orgId)),
    ]);

    const agreements = await db.select().from(legalAgreementsTable)
      .where(and(eq(legalAgreementsTable.organisationId, orgId), eq(legalAgreementsTable.revoked, false)));

    const mandatoryDocs = Object.entries(LEGAL_DOCUMENTS).filter(([, d]) => d.mandatory).map(([code]) => code);
    const acceptedDocs = agreements.map(a => a.documentType);
    const missingMandatory = mandatoryDocs.filter(d => !acceptedDocs.includes(d));

    const myRequests = await db.select().from(dataSubjectRequestsTable)
      .where(eq(dataSubjectRequestsTable.organisationId, orgId))
      .orderBy(desc(dataSubjectRequestsTable.createdAt))
      .limit(10);

    res.json({
      dataInventory: [
        { category: "Utilisateurs & agents", description: "Noms, prénoms, emails, rôles, mots de passe chiffrés", count: users[0]?.count || 0, retention: "Durée du contrat + 3 ans", legalBasis: "Exécution du contrat (Art. 6(1)(b))", sensitive: false },
        { category: "Contacts & clients", description: "Noms, coordonnées, historique de communication", count: contacts[0]?.count || 0, retention: "5 ans après dernier contact", legalBasis: "Intérêt légitime (Art. 6(1)(f))", sensitive: false },
        { category: "Appels téléphoniques", description: "Numéros, durées, notes, enregistrements éventuels", count: calls[0]?.count || 0, retention: "3 ans", legalBasis: "Exécution du contrat (Art. 6(1)(b))", sensitive: false },
        { category: "Tâches & activités", description: "Titres, descriptions, assignations, statuts", count: tasks[0]?.count || 0, retention: "3 ans", legalBasis: "Exécution du contrat (Art. 6(1)(b))", sensitive: false },
        { category: "Prospects", description: "Noms, entreprises, statuts de prospection", count: prospects[0]?.count || 0, retention: "3 ans", legalBasis: "Intérêt légitime (Art. 6(1)(f))", sensitive: false },
        { category: "Pointages & présences", description: "Heures d'arrivée/départ, statuts de présence", count: checkins[0]?.count || 0, retention: "5 ans (obligations légales)", legalBasis: "Obligation légale (Art. 6(1)(c))", sensitive: false },
        { category: "Notes internes", description: "Mémos, contenus des notes, auteurs", count: notes[0]?.count || 0, retention: "Durée du contrat", legalBasis: "Exécution du contrat (Art. 6(1)(b))", sensitive: false },
      ],
      legalDocuments: Object.entries(LEGAL_DOCUMENTS).map(([code, doc]) => {
        const agreement = agreements.find(a => a.documentType === code);
        return {
          ...doc,
          code,
          accepted: !!agreement,
          acceptedAt: agreement?.acceptedAt || null,
          acceptedBy: agreement?.acceptedBy || null,
        };
      }),
      compliance: {
        isCompliant: missingMandatory.length === 0,
        missingMandatory,
        acceptedCount: acceptedDocs.length,
        totalCount: Object.keys(LEGAL_DOCUMENTS).length,
        percent: Math.round((acceptedDocs.length / Object.keys(LEGAL_DOCUMENTS).length) * 100),
      },
      myRequests,
      requestTypes: DATA_REQUEST_TYPES,
      dpo: {
        email: "dpo@agentdebureau.fr",
        name: "Délégué à la Protection des Données",
        address: "SK GROUP, 17 rue Saint-Exupéry, 67500 Haguenau, France",
        supervisoryAuthority: { name: "CNIL", url: "https://www.cnil.fr", phone: "+33 1 53 73 22 22" },
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Data protection summary error");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.post("/data-protection/request", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    const orgId = req.session?.organisationId;
    const prenom = req.session?.prenom || "";
    if (!userId || !orgId) { res.status(401).json({ error: "Non authentifie." }); return; }

    const { requestType, details } = req.body;
    if (!requestType || !DATA_REQUEST_TYPES[requestType as keyof typeof DATA_REQUEST_TYPES]) {
      res.status(400).json({ error: "Type de demande invalide." }); return;
    }

    const user = await db.select({ nom: usersTable.nom, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
    const userName = user[0] ? `${prenom} ${user[0].nom}`.trim() : "Utilisateur";
    const userEmail = user[0]?.email || "";

    const [request] = await db.insert(dataSubjectRequestsTable).values({
      organisationId: orgId,
      requestedByUserId: userId,
      requestedByName: userName,
      requestedByEmail: userEmail,
      requestType,
      status: "pending",
      details: details || null,
    }).returning();

    res.json({ success: true, requestId: request.id, message: "Votre demande a été enregistrée. Vous recevrez une réponse dans un délai de 30 jours conformément au RGPD." });
  } catch (err: any) {
    logger.error({ err }, "Data subject request creation error");
    res.status(500).json({ error: "Erreur lors de la création de la demande." });
  }
});

router.post("/data-protection/export", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    const orgId = req.session?.organisationId;
    if (!userId || !orgId) { res.status(401).json({ error: "Non authentifie." }); return; }

    const [users, contacts, calls, tasks, prospects, notes] = await Promise.all([
      db.select({ id: usersTable.id, nom: usersTable.nom, prenom: usersTable.prenom, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.organisationId, orgId)),
      db.select().from(contactsTable).where(eq(contactsTable.organisationId, orgId)),
      db.select({ id: callsTable.id, phoneNumber: callsTable.phoneNumber, direction: callsTable.direction, duration: callsTable.duration, status: callsTable.status, notes: callsTable.notes, createdAt: callsTable.createdAt }).from(callsTable).where(eq(callsTable.organisationId, orgId)),
      db.select({ id: tasksTable.id, title: tasksTable.title, description: tasksTable.description, status: tasksTable.status, priority: tasksTable.priority, dueDate: tasksTable.dueDate, createdAt: tasksTable.createdAt }).from(tasksTable).where(eq(tasksTable.organisationId, orgId)),
      db.select().from(prospectsTable).where(eq(prospectsTable.organisationId, orgId)),
      db.select().from(notesInternesTable).where(eq(notesInternesTable.organisationId, orgId)),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      exportedBy: `User ID ${userId}`,
      organisation: { id: orgId },
      legalBasis: "Art. 20 RGPD — Droit à la portabilité des données",
      data: { users, contacts, calls, tasks, prospects, notes },
      statistics: {
        totalUsers: users.length,
        totalContacts: contacts.length,
        totalCalls: calls.length,
        totalTasks: tasks.length,
        totalProspects: prospects.length,
        totalNotes: notes.length,
      },
    };

    await db.insert(dataSubjectRequestsTable).values({
      organisationId: orgId,
      requestedByUserId: userId,
      requestType: "portability",
      status: "completed",
      processedAt: new Date(),
      responseNotes: "Export automatique via portail en libre-service",
    });

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="agent-de-bureau-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(exportData);
  } catch (err: any) {
    logger.error({ err }, "Data export error");
    res.status(500).json({ error: "Erreur lors de l'export des données." });
  }
});

router.post("/data-protection/accept-legal", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    const orgId = req.session?.organisationId;
    const userRole = req.session?.userRole;
    const prenom = req.session?.prenom || "";
    if (!userId || !orgId) { res.status(401).json({ error: "Non authentifie." }); return; }
    if (userRole !== "super_admin" && userRole !== "administrateur") { res.status(403).json({ error: "Réservé aux administrateurs." }); return; }

    const { documentType } = req.body;
    if (!documentType || !LEGAL_DOCUMENTS[documentType as keyof typeof LEGAL_DOCUMENTS]) {
      res.status(400).json({ error: "Type de document invalide." }); return;
    }

    const docDef = LEGAL_DOCUMENTS[documentType as keyof typeof LEGAL_DOCUMENTS];
    const user = await db.select({ nom: usersTable.nom }).from(usersTable).where(eq(usersTable.id, userId));
    const signerName = user[0] ? `${prenom} ${user[0].nom}`.trim() : "Administrateur";

    const existing = await db.select().from(legalAgreementsTable)
      .where(and(eq(legalAgreementsTable.organisationId, orgId), eq(legalAgreementsTable.documentType, documentType), eq(legalAgreementsTable.revoked, false)));

    if (existing.length > 0) { res.status(409).json({ error: "Document déjà accepté." }); return; }

    await db.insert(legalAgreementsTable).values({
      organisationId: orgId,
      documentType,
      documentVersion: docDef.version,
      acceptedAt: new Date(),
      acceptedBy: signerName,
      acceptedIp: req.ip || "unknown",
    });

    res.json({ success: true, message: `"${docDef.title}" accepté avec succès.` });
  } catch (err: any) {
    logger.error({ err }, "Legal document acceptance error");
    res.status(500).json({ error: "Erreur lors de l'acceptation." });
  }
});

router.get("/data-protection/requests", requireRole("super_admin", "administrateur"), async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const requests = await db.select().from(dataSubjectRequestsTable)
      .where(eq(dataSubjectRequestsTable.organisationId, orgId))
      .orderBy(desc(dataSubjectRequestsTable.createdAt));
    res.json({ requests });
  } catch (err: any) {
    logger.error({ err }, "Data requests fetch error");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.get("/data-protection/status", requireRole("super_admin", "administrateur"), async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }
    const userRole = req.session?.userRole as string | undefined;
    const isSuperAdmin = userRole === "super_admin";

    const [pending, completed, total] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(dataSubjectRequestsTable).where(and(eq(dataSubjectRequestsTable.organisationId, orgId), eq(dataSubjectRequestsTable.status, "pending"))),
      db.select({ count: sql<number>`count(*)::int` }).from(dataSubjectRequestsTable).where(and(eq(dataSubjectRequestsTable.organisationId, orgId), eq(dataSubjectRequestsTable.status, "completed"))),
      db.select({ count: sql<number>`count(*)::int` }).from(dataSubjectRequestsTable).where(eq(dataSubjectRequestsTable.organisationId, orgId)),
    ]);

    const response: Record<string, unknown> = {
      pending: pending[0]?.count || 0,
      completed: completed[0]?.count || 0,
      total: total[0]?.count || 0,
    };

    // Platform-wide infrastructure health (totalRecords, lastBackup,
    // failedBackups24h, backupConfigured) is global and not tenant-scoped,
    // so it must only be returned to super_admin. Tenant admins receive only
    // their own organisation's GDPR request stats.
    if (isSuperAdmin) {
      const monitorStatus = await getDataProtectionStatus();
      response.lastCheck = monitorStatus.lastCheck;
      response.nextCheck = monitorStatus.nextCheck;
      response.globalHealth = monitorStatus.globalHealth;
    }

    res.json(response);
  } catch (err: any) {
    logger.error({ err }, "Data protection status error");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

export default router;
