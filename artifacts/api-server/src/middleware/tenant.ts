import type { Request, Response, NextFunction } from "express";

export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  const organisationId = (req.session as any)?.organisationId;
  if (!organisationId) {
    res.status(403).json({ error: "Aucune organisation associee a ce compte." });
    return;
  }
  next();
}

export function getOrgId(req: Request): number {
  return (req.session as any).organisationId;
}
