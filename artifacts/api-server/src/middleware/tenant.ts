import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  const organisationId = (req.session as any)?.organisationId;
  if (organisationId) {
    next();
    return;
  }

  const userId = (req.session as any)?.userId;
  if (!userId) {
    res.status(403).json({ error: "Aucune organisation associee a ce compte." });
    return;
  }

  db.select({ organisationId: usersTable.organisationId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .then(([user]) => {
      if (user?.organisationId) {
        (req.session as any).organisationId = user.organisationId;
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
  return (req.session as any).organisationId;
}
