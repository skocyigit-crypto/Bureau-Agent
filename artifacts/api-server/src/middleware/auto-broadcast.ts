import type { Request, Response, NextFunction } from "express";
import { broadcaster, type SyncEventType } from "../services/broadcaster";

const BROADCAST_RULES: Array<{
  method: string | string[];
  pattern: RegExp;
  type: SyncEventType;
  action: "created" | "updated" | "deleted";
}> = [
  { method: "POST",   pattern: /^\/api\/calls$/,             type: "call",      action: "created" },
  { method: "PATCH",  pattern: /^\/api\/calls\/\d+$/,        type: "call",      action: "updated" },
  { method: "DELETE", pattern: /^\/api\/calls\/\d+$/,        type: "call",      action: "deleted" },
  { method: "POST",   pattern: /^\/api\/tasks$/,             type: "task",      action: "created" },
  { method: "PATCH",  pattern: /^\/api\/tasks\/\d+$/,        type: "task",      action: "updated" },
  { method: "DELETE", pattern: /^\/api\/tasks\/\d+$/,        type: "task",      action: "deleted" },
  { method: "POST",   pattern: /^\/api\/contacts$/,          type: "contact",   action: "created" },
  { method: "PATCH",  pattern: /^\/api\/contacts\/\d+$/,     type: "contact",   action: "updated" },
  { method: "DELETE", pattern: /^\/api\/contacts\/\d+$/,     type: "contact",   action: "deleted" },
  { method: "POST",   pattern: /^\/api\/messages$/,          type: "message",   action: "created" },
  { method: "PATCH",  pattern: /^\/api\/messages\/\d+$/,     type: "message",   action: "updated" },
  { method: "DELETE", pattern: /^\/api\/messages\/\d+$/,     type: "message",   action: "deleted" },
  { method: "POST",   pattern: /^\/api\/checkins/,           type: "checkin",   action: "created" },
  { method: ["POST","PATCH"], pattern: /^\/api\/calendar/,   type: "calendar",  action: "updated" },
  { method: "POST",   pattern: /^\/api\/prospects$/,         type: "prospect",  action: "created" },
  { method: "PATCH",  pattern: /^\/api\/prospects\/\d+$/,    type: "prospect",  action: "updated" },
  { method: "DELETE", pattern: /^\/api\/prospects\/\d+$/,    type: "prospect",  action: "deleted" },
  { method: "POST",   pattern: /^\/api\/notes-internes$/,    type: "note",      action: "created" },
  { method: "PATCH",  pattern: /^\/api\/notes-internes\/\d+$/, type: "note",   action: "updated" },
  { method: "DELETE", pattern: /^\/api\/notes-internes\/\d+$/, type: "note",   action: "deleted" },
  { method: "POST",   pattern: /^\/api\/projets$/,           type: "projet",    action: "created" },
  { method: "PATCH",  pattern: /^\/api\/projets\/\d+$/,      type: "projet",    action: "updated" },
  { method: "DELETE", pattern: /^\/api\/projets\/\d+$/,      type: "projet",    action: "deleted" },
];

export function autoBroadcast(req: Request, res: Response, next: NextFunction): void {
  const orgId: number | undefined = req.session?.organisationId;
  const userId: number | undefined = req.session?.userId;

  if (!orgId || !userId) { next(); return; }

  const path = req.path;
  const method = req.method.toUpperCase();

  const rule = BROADCAST_RULES.find(r => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    return methods.includes(method) && r.pattern.test(path);
  });

  if (!rule) { next(); return; }

  const originalEnd = res.end.bind(res);
  (res as any).end = function (chunk?: any, encoding?: any, cb?: any) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const idMatch = path.match(/\/(\d+)$/);
      const resourceId = idMatch ? parseInt(idMatch[1]) : undefined;
      setImmediate(() => {
        broadcaster.broadcast(orgId, {
          type: rule.type,
          action: rule.action,
          resourceId,
          triggeredBy: userId,
        });
      });
    }
    return originalEnd(chunk, encoding, cb);
  };

  next();
}
