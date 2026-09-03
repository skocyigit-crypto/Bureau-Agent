import { Router } from "express";
import { db } from "@workspace/db";
import {
  dataSubjectRequestsTable, DATA_REQUEST_TYPES,
  legalAgreementsTable, LEGAL_DOCUMENTS,
  usersTable, contactsTable, callsTable, tasksTable,
  checkinsTable, prospectsTable, notesInternesTable,
  auditLogsTable, aiUsageTable, pushTokensTable,
  commandantConversationsTable, commandantMessagesTable,
  userLocationStateTable, locationEventsTable, googleOAuthTokensTable,
  securityScansTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { getDataProtectionStatus } from "../services/data-protection-monitor";
import { SECURITY_SCAN_RETENTION_DAYS } from "../services/security-scans";

const router = Router();

/**
 * Le mois de l'article 12(3), rendu visible.
 *
 * Le responsable de traitement doit repondre « dans les meilleurs delais et
 * en tout etat de cause dans un delai d'un mois ». Ce delai n'existait nulle
 * part dans le produit: la reponse a l'utilisateur le PROMET (« 30 jours »),
 * mais rien ne le calculait, et donc rien ne pouvait dire a une organisation
 * qu'elle etait en retard — alors que le retard EST le manquement.
 *
 * Il est derive plutot que stocke: la date d'echeance est une fonction de la
 * date de depot, pas une donnee independante qui pourrait diverger. Un
 * champ en base aurait exige une migration et aurait pu, lui, devenir faux.
 */
export function requestDeadline(createdAt: Date, now = new Date()) {
  const dueAt = new Date(createdAt);
  dueAt.setMonth(dueAt.getMonth() + 1);
  const daysLeft = Math.ceil((dueAt.getTime() - now.getTime()) / 86_400_000);
  return { dueAt, daysLeft, overdue: daysLeft < 0 };
}

/** Une demande close ne court plus: son echeance n'a plus de sens. */
function withDeadline<T extends { createdAt: Date; status: string }>(r: T) {
  if (r.status !== "pending") return { ...r, dueAt: null, daysLeft: null, overdue: false };
  return { ...r, ...requestDeadline(r.createdAt) };
}

router.get("/data-protection/summary", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    const orgId = req.session?.organisationId;
    if (!userId || !orgId) { res.status(401).json({ error: "Non authentifie." }); return; }

    const [users, contacts, calls, tasks, prospects, checkins, notes, scans] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(contactsTable).where(eq(contactsTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(eq(callsTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(eq(tasksTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(prospectsTable).where(eq(prospectsTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(checkinsTable).where(eq(checkinsTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(notesInternesTable).where(eq(notesInternesTable.organisationId, orgId)),
      db.select({ count: sql<number>`count(*)::int` }).from(securityScansTable).where(eq(securityScansTable.organisationId, orgId)),
    ]);

    const agreements = await db.select().from(legalAgreementsTable)
      .where(and(eq(legalAgreementsTable.organisationId, orgId), eq(legalAgreementsTable.revoked, false)));

    const mandatoryDocs = Object.entries(LEGAL_DOCUMENTS).filter(([, d]) => d.mandatory).map(([code]) => code);
    const acceptedDocs = agreements.map(a => a.documentType);
    const missingMandatory = mandatoryDocs.filter(d => !acceptedDocs.includes(d));

    const myRequestRows = await db.select().from(dataSubjectRequestsTable)
      .where(eq(dataSubjectRequestsTable.organisationId, orgId))
      .orderBy(desc(dataSubjectRequestsTable.createdAt))
      .limit(10);
    const myRequests = myRequestRows.map(withDeadline);

    res.json({
      dataInventory: [
        { category: "Utilisateurs & agents", description: "Noms, prénoms, emails, rôles, mots de passe chiffrés", count: users[0]?.count || 0, retention: "Durée du contrat + 3 ans", legalBasis: "Exécution du contrat (Art. 6(1)(b))", sensitive: false },
        { category: "Contacts & clients", description: "Noms, coordonnées, historique de communication", count: contacts[0]?.count || 0, retention: "5 ans après dernier contact", legalBasis: "Intérêt légitime (Art. 6(1)(f))", sensitive: false },
        { category: "Appels téléphoniques", description: "Numéros, durées, notes, enregistrements éventuels", count: calls[0]?.count || 0, retention: "3 ans", legalBasis: "Exécution du contrat (Art. 6(1)(b))", sensitive: false },
        { category: "Tâches & activités", description: "Titres, descriptions, assignations, statuts", count: tasks[0]?.count || 0, retention: "3 ans", legalBasis: "Exécution du contrat (Art. 6(1)(b))", sensitive: false },
        { category: "Prospects", description: "Noms, entreprises, statuts de prospection", count: prospects[0]?.count || 0, retention: "3 ans", legalBasis: "Intérêt légitime (Art. 6(1)(f))", sensitive: false },
        { category: "Pointages & présences", description: "Heures d'arrivée/départ, statuts de présence", count: checkins[0]?.count || 0, retention: "5 ans (obligations légales)", legalBasis: "Obligation légale (Art. 6(1)(c))", sensitive: false },
        { category: "Notes internes", description: "Mémos, contenus des notes, auteurs", count: notes[0]?.count || 0, retention: "Durée du contrat", legalBasis: "Exécution du contrat (Art. 6(1)(b))", sensitive: false },
        // Categorie ajoutee le 2026-09-03. Elle manquait: le journal d'analyses
        // porte un `userId` et une `target` — le fichier, l'adresse ou le
        // numero analyse, y compris pour les pieces jointes entrantes — donc de
        // la donnee personnelle que l'inventaire ne declarait pas du tout.
        //
        // Base legale: interet legitime. Le considerant 49 vise nommement le
        // traitement « strictement necessaire et proportionne » a la securite
        // des reseaux et de l'information par « les fournisseurs de
        // technologies et de services de securite ».
        //
        // La duree n'est pas ecrite en dur: elle est lue depuis la constante
        // qu'applique la purge. Une duree annoncee qui differe de celle
        // appliquee est un manquement aux art. 13/14, et l'ecart serait
        // invisible — c'est exactement ce qui s'est produit ici, ou la purge
        // existait sans etre appelee.
        { category: "Analyses de sécurité", description: "Fichiers et messages analysés, verdicts, auteur de l'analyse", count: scans[0]?.count || 0, retention: `${SECURITY_SCAN_RETENTION_DAYS} jours`, legalBasis: "Intérêt légitime — sécurité des systèmes (Art. 6(1)(f), cons. 49)", sensitive: false },
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

/**
 * Export integral des donnees de l'ORGANISATION — reserve aux administrateurs.
 *
 * Cette route ne rend pas « les donnees de celui qui la demande »: elle rend
 * l'INTEGRALITE du fichier de l'organisation — contacts, prospects, historique
 * d'appels et notes internes. Le plancher global des mutations
 * (routes/index.ts) n'exige qu'un role `agent` ou superieur: seuls les
 * comptes `lecture_seule` etaient donc arretes. Tout salarie ordinaire
 * pouvait telecharger le CRM entier en une requete, sous couvert de
 * portabilite RGPD — et le bouton lui etait affiche.
 *
 * Or l'article 20 ouvre un droit sur SES PROPRES donnees, pas sur celles des
 * clients et prospects de l'employeur. Le responsable de traitement, c'est
 * l'organisation; l'export global est un acte de sa direction.
 *
 * Restreindre ne prive donc personne de son droit: la demande individuelle
 * (POST /data-protection/request, traitee sous 30 jours) reste ouverte a tous
 * et figure sur la meme carte, juste en dessous du bouton. C'est le canal
 * legal pour une personne; celui-ci est un outil d'administration.
 *
 * Meme exigence que /data-protection/requests et /status plus bas, qui
 * exposent pourtant bien moins.
 */
router.post("/data-protection/export", requireRole("super_admin", "administrateur"), async (req, res): Promise<void> => {
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
    const rows = await db.select().from(dataSubjectRequestsTable)
      .where(eq(dataSubjectRequestsTable.organisationId, orgId))
      .orderBy(desc(dataSubjectRequestsTable.createdAt));
    const requests = rows.map(withDeadline);
    res.json({ requests, overdue: requests.filter(r => r.overdue).length });
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

    // Le nombre de demandes en attente ne dit pas si l'organisation est en
    // faute; seul le retard le dit. Il est compte en base plutot que derive
    // en memoire, pour ne pas charger toutes les lignes juste pour un chiffre.
    const [late] = await db.select({ count: sql<number>`count(*)::int` })
      .from(dataSubjectRequestsTable)
      .where(and(
        eq(dataSubjectRequestsTable.organisationId, orgId),
        eq(dataSubjectRequestsTable.status, "pending"),
        sql`${dataSubjectRequestsTable.createdAt} < now() - interval '1 month'`,
      ));

    const response: Record<string, unknown> = {
      pending: pending[0]?.count || 0,
      completed: completed[0]?.count || 0,
      total: total[0]?.count || 0,
      overdue: late?.count || 0,
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

/**
 * L'export individuel — l'article 15/20 pour une personne, pas pour un fichier.
 *
 * L'export existant (/data-protection/export) rend l'INTEGRALITE du fichier
 * de l'organisation et est reserve aux administrateurs, a juste titre: c'est
 * un outil de direction. Restait donc ceci: un salarie ordinaire n'avait
 * AUCUN moyen d'obtenir ses propres donnees. Le seul canal ouvert etait la
 * demande manuelle sous 30 jours — laquelle, jusqu'a aujourd'hui, ne pouvait
 * meme pas etre close (voir la route suivante). Le droit etait donc annonce
 * dans l'interface et inexecutable de bout en bout.
 *
 * La ligne de partage est celle que le commentaire de /export trace deja, et
 * elle est le coeur de cette route: on rend les donnees QUI CONCERNENT la
 * personne, jamais celles qu'elle a seulement SAISIES. Les contacts, appels,
 * taches et prospects portent un `createdBy`; les inclure rouvrirait, sous
 * couvert de droit individuel, l'exfiltration integrale du CRM que l'on
 * vient de fermer. Ils appartiennent au responsable de traitement.
 *
 * Les colonnes sont enumerees une par une, jamais `select()` complet. Les
 * tables traversees contiennent des secrets — empreinte du mot de passe,
 * secret MFA, jetons de reinitialisation, jetons OAuth Google, jeton de
 * notification d'un appareil. Un `select *` les livrerait tous, et un export
 * RGPD est precisement ce qu'on transmet a l'exterieur. Pour Google, seule
 * l'EXISTENCE du rattachement est rendue: le fait qu'un compte soit lie est
 * une donnee personnelle, les jetons sont des identifiants d'acces.
 */
router.get("/data-protection/my-data", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    const orgId = req.session?.organisationId;
    if (!userId || !orgId) { res.status(401).json({ error: "Non authentifie." }); return; }

    const conversations = await db.select({
      id: commandantConversationsTable.id,
      title: commandantConversationsTable.title,
      createdAt: commandantConversationsTable.createdAt,
      updatedAt: commandantConversationsTable.updatedAt,
    }).from(commandantConversationsTable)
      .where(and(
        eq(commandantConversationsTable.userId, userId),
        eq(commandantConversationsTable.organisationId, orgId),
      ));

    // Les messages sont rattaches a la conversation, pas a la personne: sans
    // ce filtre par identifiants, le `organisationId` seul rendrait ceux des
    // collegues.
    const conversationIds = conversations.map(c => c.id);
    const messages = conversationIds.length === 0 ? [] : await db.select({
      conversationId: commandantMessagesTable.conversationId,
      role: commandantMessagesTable.role,
      content: commandantMessagesTable.content,
      createdAt: commandantMessagesTable.createdAt,
    }).from(commandantMessagesTable)
      .where(and(
        inArray(commandantMessagesTable.conversationId, conversationIds),
        eq(commandantMessagesTable.organisationId, orgId),
      ));

    const [profile, presences, journal, consommationIa, appareils, position, deplacements, google, analysesSecurite, demandes] = await Promise.all([
      db.select({
        id: usersTable.id, email: usersTable.email, nom: usersTable.nom,
        prenom: usersTable.prenom, role: usersTable.role,
        departement: usersTable.departement, telephone: usersTable.telephone,
        avatar: usersTable.avatar, actif: usersTable.actif,
        mfaActif: usersTable.mfaActif, preferences: usersTable.preferences,
        dernierAcces: usersTable.dernierAcces, lastLoginIp: usersTable.lastLoginIp,
        emailVerifiedAt: usersTable.emailVerifiedAt,
        createdAt: usersTable.createdAt, updatedAt: usersTable.updatedAt,
      }).from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId))),

      db.select({
        id: checkinsTable.id, type: checkinsTable.type, status: checkinsTable.status,
        location: checkinsTable.location, notes: checkinsTable.notes,
        ipAddress: checkinsTable.ipAddress, checkInAt: checkinsTable.checkInAt,
        checkOutAt: checkinsTable.checkOutAt, breakMinutes: checkinsTable.breakMinutes,
        totalMinutes: checkinsTable.totalMinutes, createdAt: checkinsTable.createdAt,
      }).from(checkinsTable)
        .where(and(eq(checkinsTable.createdBy, userId), eq(checkinsTable.organisationId, orgId))),

      db.select({
        action: auditLogsTable.action, resource: auditLogsTable.resource,
        resourceId: auditLogsTable.resourceId, ipAddress: auditLogsTable.ipAddress,
        userAgent: auditLogsTable.userAgent, createdAt: auditLogsTable.createdAt,
      }).from(auditLogsTable)
        .where(and(eq(auditLogsTable.userId, userId), eq(auditLogsTable.organisationId, orgId)))
        .orderBy(desc(auditLogsTable.createdAt)).limit(5000),

      db.select({
        provider: aiUsageTable.provider, model: aiUsageTable.model,
        route: aiUsageTable.route, totalTokens: aiUsageTable.totalTokens,
        estimatedCostUsd: aiUsageTable.estimatedCostUsd,
        status: aiUsageTable.status, createdAt: aiUsageTable.createdAt,
      }).from(aiUsageTable)
        .where(and(eq(aiUsageTable.userId, userId), eq(aiUsageTable.organisationId, orgId)))
        .orderBy(desc(aiUsageTable.createdAt)).limit(5000),

      // `token` est exclu: c'est l'identifiant qui permet d'ecrire sur
      // l'appareil, pas une donnee qui decrit la personne.
      db.select({
        platform: pushTokensTable.platform, lastSeenAt: pushTokensTable.lastSeenAt,
        createdAt: pushTokensTable.createdAt,
      }).from(pushTokensTable)
        .where(and(eq(pushTokensTable.userId, userId), eq(pushTokensTable.organisationId, orgId))),

      db.select({
        lastAt: userLocationStateTable.lastAt,
        currentGeofenceIds: userLocationStateTable.currentGeofenceIds,
        battery: userLocationStateTable.battery,
        isMoving: userLocationStateTable.isMoving,
        updatedAt: userLocationStateTable.updatedAt,
      }).from(userLocationStateTable)
        .where(and(eq(userLocationStateTable.userId, userId), eq(userLocationStateTable.organisationId, orgId))),

      db.select({
        geofenceId: locationEventsTable.geofenceId,
        event: locationEventsTable.event, at: locationEventsTable.at,
      }).from(locationEventsTable)
        .where(and(eq(locationEventsTable.userId, userId), eq(locationEventsTable.organisationId, orgId)))
        .orderBy(desc(locationEventsTable.at)).limit(5000),

      db.select({
        scope: googleOAuthTokensTable.scope,
        expiresAt: googleOAuthTokensTable.expiresAt,
        createdAt: googleOAuthTokensTable.createdAt,
      }).from(googleOAuthTokensTable)
        .where(and(eq(googleOAuthTokensTable.userId, userId), eq(googleOAuthTokensTable.organisationId, orgId))),

      // Une analyse declenchee par la personne la concerne: l'article 15 lui
      // en ouvre l'acces. La cible est incluse — c'est la donnee qui la
      // designe — mais pas le moteur ni la source, qui decrivent
      // l'infrastructure et non l'individu.
      db.select({
        kind: securityScansTable.kind,
        target: securityScansTable.target,
        verdict: securityScansTable.verdict,
        createdAt: securityScansTable.createdAt,
      }).from(securityScansTable)
        .where(and(eq(securityScansTable.userId, userId), eq(securityScansTable.organisationId, orgId)))
        .orderBy(desc(securityScansTable.createdAt)).limit(5000),

      db.select({
        requestType: dataSubjectRequestsTable.requestType,
        status: dataSubjectRequestsTable.status,
        details: dataSubjectRequestsTable.details,
        responseNotes: dataSubjectRequestsTable.responseNotes,
        processedAt: dataSubjectRequestsTable.processedAt,
        createdAt: dataSubjectRequestsTable.createdAt,
      }).from(dataSubjectRequestsTable)
        .where(and(eq(dataSubjectRequestsTable.requestedByUserId, userId), eq(dataSubjectRequestsTable.organisationId, orgId))),
    ]);

    if (profile.length === 0) { res.status(404).json({ error: "Compte introuvable." }); return; }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="mes-donnees-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      legalBasis: "Art. 15 et 20 RGPD — droit d'acces et droit a la portabilite",
      scope:
        "Donnees qui concernent la personne connectee. Les contacts, appels, " +
        "taches, prospects et notes qu'elle a saisis pour le compte de son " +
        "organisation n'y figurent pas: ils relevent du fichier du " +
        "responsable de traitement, et non de son droit individuel.",
      data: {
        profil: profile[0],
        presences,
        journalDActivite: journal,
        conversationsIa: conversations,
        messagesIa: messages,
        consommationIa,
        appareilsDeNotification: appareils,
        positionActuelle: position,
        deplacements,
        comptesGoogleRattaches: google,
        analysesSecurite,
        demandesRgpd: demandes,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Personal data export error");
    res.status(500).json({ error: "Erreur lors de l'export de vos donnees." });
  }
});

/**
 * Clore une demande — le maillon qui manquait.
 *
 * Jusqu'ici `data_subject_requests` n'etait qu'INSERE et LU: aucune ligne du
 * depot ne la mettait a jour. Une demande entrait en `pending` et y restait
 * pour toujours, pendant que la reponse de l'API promettait a la personne
 * « une reponse dans un delai de 30 jours ». Les colonnes `processedAt`,
 * `processedByName` et `responseNotes` existaient deja, ecrites par personne
 * — la forme exacte du defaut que ce depot corrige: du code redige, jamais
 * branche.
 *
 * Le refus est un resultat de plein droit, pas un echec: l'article 12(4)
 * impose alors d'exposer les MOTIFS et de rappeler la voie de reclamation.
 * D'ou une note obligatoire quand on refuse — un refus muet serait lui-meme
 * un manquement, et il serait indistinguable d'un oubli.
 *
 * L'effacement (art. 17) n'est deliberement PAS execute ici. Voir la note en
 * fin de fichier: c'est une decision de l'editeur, pas un defaut d'outil.
 */
router.post("/data-protection/requests/:id/process", requireRole("super_admin", "administrateur"), async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    const orgId = req.session?.organisationId;
    const prenom = req.session?.prenom || "";
    if (!userId || !orgId) { res.status(401).json({ error: "Non authentifie." }); return; }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Identifiant invalide." }); return; }

    const { status, responseNotes } = req.body ?? {};
    if (status !== "completed" && status !== "refused") {
      res.status(400).json({ error: 'Statut invalide: attendu "completed" ou "refused".' }); return;
    }
    const notes = typeof responseNotes === "string" ? responseNotes.trim() : "";
    if (status === "refused" && notes.length === 0) {
      res.status(400).json({
        error:
          "Un refus doit etre motive (art. 12(4) RGPD): indiquez les motifs et " +
          "rappelez a la personne son droit de reclamation aupres de la CNIL.",
      });
      return;
    }

    const user = await db.select({ nom: usersTable.nom }).from(usersTable).where(eq(usersTable.id, userId));
    const processedByName = user[0] ? `${prenom} ${user[0].nom}`.trim() : "Administrateur";

    // Le filtre par `organisationId` est la frontiere de tenant: sans lui, un
    // administrateur pourrait clore la demande d'une AUTRE organisation en
    // devinant un identifiant.
    const [updated] = await db.update(dataSubjectRequestsTable)
      .set({ status, responseNotes: notes || null, processedAt: new Date(), processedByName })
      .where(and(
        eq(dataSubjectRequestsTable.id, id),
        eq(dataSubjectRequestsTable.organisationId, orgId),
        eq(dataSubjectRequestsTable.status, "pending"),
      ))
      .returning();

    if (!updated) {
      // Une demande deja close ne doit pas pouvoir etre reecrite: la trace de
      // qui a repondu quoi, et quand, est ce qui prouve le respect du delai.
      res.status(404).json({ error: "Demande introuvable, ou deja traitee." });
      return;
    }

    res.json({ success: true, request: withDeadline(updated) });
  } catch (err: any) {
    logger.error({ err }, "Data subject request processing error");
    res.status(500).json({ error: "Erreur lors du traitement de la demande." });
  }
});

/**
 * Pourquoi l'effacement n'est pas automatise.
 *
 * L'article 17 est propose a l'utilisateur comme type de demande, et il le
 * restera: le droit existe. Ce qui n'existe pas ici, c'est un bouton qui
 * effacerait en cascade — et c'est un choix, pas un oubli.
 *
 * L'article 17(3) ecarte le droit a l'effacement quand la conservation est
 * necessaire au respect d'une obligation legale. Ce produit en detient
 * plusieurs, et il les annonce lui-meme dans /data-protection/summary: les
 * pointages sont conserves « 5 ans (obligations legales) », et les pieces
 * comptables relevent du code de commerce. Une cascade aveugle ferait donc
 * l'un ou l'autre: detruire ce que la loi impose de garder, ou pretendre
 * effacer sans le faire. Les deux sont des manquements, et le premier est
 * irreversible.
 *
 * L'arbitrage tient a des faits propres a l'editeur — duree exacte, sort des
 * sauvegardes, anonymisation plutot que suppression. Il appartient a
 * l'editeur, pas a ce fichier. La demande est donc tracee, datee, et close
 * explicitement par un humain qui ecrit ce qu'il a fait.
 */

export default router;
