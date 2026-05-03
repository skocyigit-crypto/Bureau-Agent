import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { legalAgreementsTable, LEGAL_DOCUMENTS, type LegalDocumentCode } from "@workspace/db";
import { organisationsTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";

const router = Router();

const requireSuperAdmin = (req: Request, res: Response, next: Function) => {
  const role = (req.session as any)?.userRole;
  if (role !== "super_admin") {
    res.status(403).json({ error: "Acces reserve au super administrateur." });
    return;
  }
  next();
};

router.use(requireSuperAdmin);

router.get("/legal/documents", async (_req: Request, res: Response): Promise<void> => {
  res.json({ documents: LEGAL_DOCUMENTS });
});

router.get("/legal/compliance", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgs = await db.select({
      id: organisationsTable.id,
      name: organisationsTable.name,
      actif: organisationsTable.actif,
    }).from(organisationsTable).orderBy(organisationsTable.name);

    const agreements = await db.select().from(legalAgreementsTable).where(eq(legalAgreementsTable.revoked, false));

    const mandatoryDocs = Object.entries(LEGAL_DOCUMENTS)
      .filter(([_, doc]) => doc.mandatory)
      .map(([code]) => code);

    const compliance = orgs.map(org => {
      const orgAgreements = agreements.filter(a => a.organisationId === org.id);
      const accepted = orgAgreements.map(a => a.documentType);
      const missing = mandatoryDocs.filter(doc => !accepted.includes(doc));
      const total = Object.keys(LEGAL_DOCUMENTS).length;
      const acceptedCount = orgAgreements.length;
      const isCompliant = missing.length === 0;

      return {
        ...org,
        agreements: orgAgreements.map(a => ({
          id: a.id,
          documentType: a.documentType,
          documentVersion: a.documentVersion,
          acceptedAt: a.acceptedAt,
          acceptedBy: a.acceptedBy,
          expiresAt: a.expiresAt,
        })),
        missingDocuments: missing,
        acceptedCount,
        totalDocuments: total,
        mandatoryTotal: mandatoryDocs.length,
        isCompliant,
        compliancePercent: Math.round((acceptedCount / total) * 100),
      };
    });

    const totalOrgs = orgs.length;
    const compliantOrgs = compliance.filter(c => c.isCompliant).length;
    const nonCompliantOrgs = totalOrgs - compliantOrgs;

    res.json({
      compliance,
      summary: {
        totalOrgs,
        compliantOrgs,
        nonCompliantOrgs,
        complianceRate: totalOrgs > 0 ? Math.round((compliantOrgs / totalOrgs) * 100) : 0,
        mandatoryDocuments: mandatoryDocs.length,
        totalDocuments: Object.keys(LEGAL_DOCUMENTS).length,
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur conformite legale");
    res.status(500).json({ error: "Erreur lors de la recuperation des donnees de conformite." });
  }
});

router.get("/legal/org/:orgId", async (req: Request, res: Response): Promise<void> => {
  const orgId = parseInt(String(req.params.orgId));
  if (isNaN(orgId)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const agreements = await db.select().from(legalAgreementsTable)
      .where(and(eq(legalAgreementsTable.organisationId, orgId), eq(legalAgreementsTable.revoked, false)));

    const allDocs = Object.entries(LEGAL_DOCUMENTS).map(([code, doc]) => {
      const agreement = agreements.find(a => a.documentType === code);
      return {
        ...(doc as any),
        code,
        status: agreement ? "accepted" as const : "pending" as const,
        agreement: agreement ? {
          id: agreement.id,
          acceptedAt: agreement.acceptedAt,
          acceptedBy: agreement.acceptedBy,
          acceptedIp: agreement.acceptedIp,
          documentVersion: agreement.documentVersion,
          expiresAt: agreement.expiresAt,
          notes: agreement.notes,
        } : null,
      };
    });

    const mandatoryDocs = allDocs.filter(d => d.mandatory);
    const acceptedMandatory = mandatoryDocs.filter(d => d.status === "accepted");

    res.json({
      documents: allDocs,
      isCompliant: acceptedMandatory.length === mandatoryDocs.length,
      compliancePercent: Math.round((agreements.length / allDocs.length) * 100),
      mandatoryAccepted: acceptedMandatory.length,
      mandatoryTotal: mandatoryDocs.length,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur documents organisation");
    res.status(500).json({ error: "Erreur lors de la recuperation des documents." });
  }
});

router.post("/legal/accept", async (req: Request, res: Response): Promise<void> => {
  const { organisationId, documentType, acceptedBy, notes } = req.body;

  if (!organisationId || !documentType) {
    res.status(400).json({ error: "organisationId et documentType sont requis." });
    return;
  }

  const docDef = LEGAL_DOCUMENTS[documentType as LegalDocumentCode];
  if (!docDef) {
    res.status(400).json({ error: "Type de document juridique inconnu." });
    return;
  }

  try {
    const existing = await db.select().from(legalAgreementsTable)
      .where(and(
        eq(legalAgreementsTable.organisationId, organisationId),
        eq(legalAgreementsTable.documentType, documentType),
        eq(legalAgreementsTable.revoked, false),
      ));

    if (existing.length > 0) {
      res.status(409).json({ error: "Ce document est deja accepte pour cette organisation." });
      return;
    }

    const session = req.session as any;
    const prenom = session?.userPrenom || "";
    const nom = session?.userNom || "";
    const signerName = (prenom && nom) ? `${prenom} ${nom}` : "Administrateur";
    const clientIp = req.ip || "unknown";

    const [agreement] = await db.insert(legalAgreementsTable).values({
      organisationId,
      documentType,
      documentVersion: docDef.version,
      acceptedAt: new Date(),
      acceptedBy: signerName,
      acceptedIp: clientIp,
      notes,
    }).returning();

    res.json({ message: `Document "${docDef.title}" accepte avec succes.`, agreement });
  } catch (err: any) {
    req.log.error({ err }, "Erreur acceptation document legal");
    res.status(500).json({ error: "Erreur lors de l'acceptation du document." });
  }
});

router.post("/legal/accept-all", async (req: Request, res: Response): Promise<void> => {
  const { organisationId } = req.body;

  if (!organisationId) {
    res.status(400).json({ error: "organisationId est requis." });
    return;
  }

  try {
    const existing = await db.select().from(legalAgreementsTable)
      .where(and(eq(legalAgreementsTable.organisationId, organisationId), eq(legalAgreementsTable.revoked, false)));

    const existingTypes = existing.map(e => e.documentType);
    const missingDocs = Object.entries(LEGAL_DOCUMENTS).filter(([code]) => !existingTypes.includes(code));

    if (missingDocs.length === 0) {
      res.json({ message: "Tous les documents sont deja acceptes.", accepted: 0 });
      return;
    }

    const session = req.session as any;
    const prenom = session?.userPrenom || "";
    const nom = session?.userNom || "";
    const signer = (prenom && nom) ? `${prenom} ${nom}` : "Administrateur";
    const clientIp = req.ip || "unknown";

    const values = missingDocs.map(([code, doc]) => ({
      organisationId,
      documentType: code,
      documentVersion: doc.version,
      acceptedAt: new Date(),
      acceptedBy: signer,
      acceptedIp: clientIp,
    }));

    await db.insert(legalAgreementsTable).values(values);

    res.json({
      message: `${missingDocs.length} document(s) accepte(s) avec succes.`,
      accepted: missingDocs.length,
      documents: missingDocs.map(([code, doc]) => doc.title),
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur acceptation tous documents");
    res.status(500).json({ error: "Erreur lors de l'acceptation des documents." });
  }
});

router.post("/legal/revoke", async (req: Request, res: Response): Promise<void> => {
  const { agreementId, reason } = req.body;

  if (!agreementId) {
    res.status(400).json({ error: "agreementId est requis." });
    return;
  }

  try {
    const [agreement] = await db.select().from(legalAgreementsTable).where(eq(legalAgreementsTable.id, agreementId));
    if (!agreement) {
      res.status(404).json({ error: "Accord introuvable." });
      return;
    }

    if (agreement.revoked) {
      res.status(400).json({ error: "Cet accord est deja revoque." });
      return;
    }

    await db.update(legalAgreementsTable).set({
      revoked: true,
      revokedAt: new Date(),
      revokedReason: reason || "Revocation par l'administrateur",
    }).where(eq(legalAgreementsTable.id, agreementId));

    res.json({ message: "Accord revoque avec succes." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur revocation accord legal");
    res.status(500).json({ error: "Erreur lors de la revocation de l'accord." });
  }
});

router.get("/legal/history/:orgId", async (req: Request, res: Response): Promise<void> => {
  const orgId = parseInt(String(req.params.orgId));
  if (isNaN(orgId)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const history = await db.select().from(legalAgreementsTable)
      .where(eq(legalAgreementsTable.organisationId, orgId))
      .orderBy(sql`${legalAgreementsTable.createdAt} DESC`);

    const enriched = history.map(h => ({
      ...h,
      documentTitle: LEGAL_DOCUMENTS[h.documentType as LegalDocumentCode]?.title || h.documentType,
      documentCategory: LEGAL_DOCUMENTS[h.documentType as LegalDocumentCode]?.category || "unknown",
    }));

    res.json({ history: enriched });
  } catch (err: any) {
    req.log.error({ err }, "Erreur historique accords legaux");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'historique." });
  }
});

export default router;
