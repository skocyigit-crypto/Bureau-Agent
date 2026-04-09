import { Router, type IRouter } from "express";
import { db, adminReportsTable, organisationsTable, usersTable } from "@workspace/db";
import { eq, desc, and, count, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/admin-reports", async (req, res): Promise<void> => {
  const session = req.session as any;
  const userId = session?.userId;
  const userRole = session?.userRole;
  const organisationId = session?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces reserve aux administrateurs." }); return;
  }

  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const conditions: any[] = [];

    if (userRole === "super_admin") {
      if (req.query.status && req.query.status !== "all") {
        conditions.push(eq(adminReportsTable.status, req.query.status as string));
      }
      if (req.query.organisationId) {
        conditions.push(eq(adminReportsTable.organisationId, parseInt(req.query.organisationId as string)));
      }
    } else {
      conditions.push(eq(adminReportsTable.organisationId, organisationId));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [reports, totalResult] = await Promise.all([
      db.select().from(adminReportsTable)
        .where(where)
        .orderBy(desc(adminReportsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(adminReportsTable).where(where),
    ]);

    res.json({
      reports,
      total: totalResult[0]?.count ?? 0,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur serveur." });
  }
});

router.post("/admin-reports", async (req, res): Promise<void> => {
  const session = req.session as any;
  const userId = session?.userId;
  const userRole = session?.userRole;
  const organisationId = session?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "administrateur" && userRole !== "super_admin") {
    res.status(403).json({ error: "Acces reserve aux administrateurs." }); return;
  }

  const { subject, message, category, priority } = req.body || {};
  if (!subject?.trim() || !message?.trim()) {
    res.status(400).json({ error: "Sujet et message requis." }); return;
  }

  try {
    const [user] = await db.select({ prenom: usersTable.prenom, nom: usersTable.nom, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    const [org] = await db.select({ name: organisationsTable.name })
      .from(organisationsTable).where(eq(organisationsTable.id, organisationId)).limit(1);

    const [report] = await db.insert(adminReportsTable).values({
      organisationId,
      userId,
      userName: user ? `${user.prenom} ${user.nom}` : "Inconnu",
      userEmail: user?.email || "",
      orgName: org?.name || "",
      subject: subject.trim(),
      message: message.trim(),
      category: category || "general",
      priority: priority || "normal",
      status: "nouveau",
    }).returning();

    res.status(201).json({ report });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur serveur." });
  }
});

router.patch("/admin-reports/:id", async (req, res): Promise<void> => {
  const session = req.session as any;
  const userId = session?.userId;
  const userRole = session?.userRole;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin") {
    res.status(403).json({ error: "Acces reserve au super admin." }); return;
  }

  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const { status, adminResponse } = req.body || {};
  const updates: any = {};
  if (status) updates.status = status;
  if (adminResponse !== undefined) {
    updates.adminResponse = adminResponse;
    updates.respondedAt = new Date();
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Aucune modification." }); return;
  }

  try {
    const [updated] = await db.update(adminReportsTable)
      .set(updates)
      .where(eq(adminReportsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Rapport non trouve." }); return; }
    res.json({ report: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur serveur." });
  }
});

router.patch("/admin-reports/:id/read", async (req, res): Promise<void> => {
  const session = req.session as any;
  const userId = session?.userId;
  const userRole = session?.userRole;
  const organisationId = session?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces reserve aux administrateurs." }); return;
  }

  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const conditions = [eq(adminReportsTable.id, id)];
    if (userRole !== "super_admin") {
      conditions.push(eq(adminReportsTable.organisationId, organisationId));
    }

    const [updated] = await db.update(adminReportsTable)
      .set({ readAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!updated) { res.status(404).json({ error: "Rapport non trouve." }); return; }
    res.json({ report: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur serveur." });
  }
});

router.get("/admin-reports/stats", async (req, res): Promise<void> => {
  const session = req.session as any;
  const userId = session?.userId;
  const userRole = session?.userRole;
  const organisationId = session?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces reserve aux administrateurs." }); return;
  }

  try {
    const conditions: any[] = [];
    if (userRole !== "super_admin") {
      conditions.push(eq(adminReportsTable.organisationId, organisationId));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const stats = await db.select({
      total: count(),
      nouveau: sql<number>`count(*) filter (where ${adminReportsTable.status} = 'nouveau')`,
      en_cours: sql<number>`count(*) filter (where ${adminReportsTable.status} = 'en_cours')`,
      resolu: sql<number>`count(*) filter (where ${adminReportsTable.status} = 'resolu')`,
      repondu: sql<number>`count(*) filter (where ${adminReportsTable.adminResponse} is not null)`,
    }).from(adminReportsTable).where(where);

    res.json(stats[0] || { total: 0, nouveau: 0, en_cours: 0, resolu: 0, repondu: 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur serveur." });
  }
});

export default router;
