import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  const organisationId = req.session?.organisationId;
  if (organisationId) {
    next();
    return;
  }

  const userId = req.session?.userId;
  if (!userId) {
    res.status(403).json({ error: "Aucune organisation associee a ce compte." });
    return;
  }

  db.select({ organisationId: usersTable.organisationId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .then(([user]) => {
      if (user?.organisationId) {
        req.session.organisationId = user.organisationId;
        next();
      } else {
        res.status(403).json({ error: "Aucune organisation associee a ce compte." });
      }
    })
    .catch(() => {
      res.status(500).json({ error: "Erreur lors de la verification de l'organisation." });
    });
}

export function getOrgId(req: Request): number {
  const orgId = req.session?.organisationId;
  if (!orgId) {
    throw new Error("Organisation manquante dans la session. Appelez requireTenant en amont.");
  }
  return orgId;
}
