import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";
import { logSecurityEvent } from "./security";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const MAX_DEPTH = 12;

function findForbiddenKey(value: unknown, depth = 0): string | null {
  if (depth > MAX_DEPTH) return null;
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findForbiddenKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return key;
    const hit = findForbiddenKey((value as Record<string, unknown>)[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

export function protoPollutionGuard(req: Request, res: Response, next: NextFunction): void {
  const containers: Array<unknown> = [req.body, req.query, req.params];
  for (const c of containers) {
    const forbidden = findForbiddenKey(c);
    if (forbidden) {
      const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
      logger.warn({
        security: true,
        event: "proto_pollution_blocked",
        forbidden,
        method: req.method,
        url: req.originalUrl,
        ip,
      }, "[SECURITE] Cle interdite detectee dans la requete");
      try {
        logSecurityEvent(
          "proto_pollution_blocked",
          ip,
          (req.session as { userId?: number } | undefined)?.userId ?? null,
          `Cle interdite "${forbidden}" dans ${req.method} ${req.originalUrl}`,
          "warning",
        );
      } catch { /* logging best-effort */ }
      res.status(400).json({ error: "Requete invalide - cle reservee non autorisee." });
      return;
    }
  }
  next();
}
