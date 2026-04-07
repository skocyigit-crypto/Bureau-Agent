import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Non authentifie. Veuillez vous connecter." });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      res.status(401).json({ error: "Non authentifie." });
      return;
    }
    const userRole = (req.session as any)?.userRole;
    if (!roles.includes(userRole)) {
      res.status(403).json({ error: "Acces refuse. Permissions insuffisantes." });
      return;
    }
    next();
  };
}
