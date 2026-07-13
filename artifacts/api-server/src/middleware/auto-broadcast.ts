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
  // NB: pas de regle "prospect" ici. Les prospects sont passes dans le backoffice
  // SaaS super-admin (cf. decision "Two-layer product") et leur routeur est monte
  // AVANT `requireTenant`/`autoBroadcast` dans routes/index.ts -> ce middleware ne
  // s'execute jamais pour /api/prospects. Une regle prospect serait donc du code
  // mort (aucun event SSE/webhook ne partirait). Si les prospects redeviennent un
  // event client, il faudra emettre le broadcast manuellement dans leur routeur.
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

  // Le routeur principal est monte sous `/api` (app.use("/api", router)), donc
  // `req.path` est relatif au point de montage ("/contacts") et NE contient PAS
  // le prefixe "/api". Les regles ci-dessus matchent le chemin complet
  // ("/api/contacts"), il faut donc recomposer `baseUrl + path`. Utiliser
  // `req.path` seul fait silencieusement echouer tous les broadcasts (SSE temps
  // reel + notifications mobiles + webhooks sortants) pour les ressources qui ne
  // diffusent que via ce middleware (contacts, calls, tasks, messages, etc.).
  const path = `${req.baseUrl}${req.path}`;
  const method = req.method.toUpperCase();

  const rule = BROADCAST_RULES.find(r => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    return methods.includes(method) && r.pattern.test(path);
  });

  if (!rule) { next(); return; }

  // Capture le body JSON pour pouvoir extraire des metadonnees utiles
  // (ex: direction/status d'un appel) sans imposer aux routes de
  // declencher elles-memes le broadcast.
  let capturedBody: unknown = undefined;
  const originalJson = res.json.bind(res);
  (res as any).json = function (body: unknown) {
    capturedBody = body;
    return originalJson(body);
  };

  const originalEnd = res.end.bind(res);
  (res as any).end = function (chunk?: any, encoding?: any, cb?: any) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const idMatch = path.match(/\/(\d+)$/);
      let resourceId = idMatch ? parseInt(idMatch[1]) : undefined;
      // Pour les "created" (POST sans id dans l'URL), l'id de la ressource
      // se trouve dans la reponse JSON. On le surface dans l'event SSE pour
      // que le mobile puisse deep-linker la notification vers le bon item
      // (Tache #83) au lieu de juste ouvrir la liste.
      if (resourceId === undefined && rule.action === "created") {
        resourceId = extractIdFromBody(capturedBody);
      }
      const meta = extractMeta(rule.type, capturedBody);
      setImmediate(() => {
        broadcaster.broadcast(orgId, {
          type: rule.type,
          action: rule.action,
          resourceId,
          triggeredBy: userId,
          ...(meta ? { meta } : {}),
        });
      });
    }
    return originalEnd(chunk, encoding, cb);
  };

  next();
}

function extractIdFromBody(body: unknown): number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const id = (body as Record<string, unknown>).id;
  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "string") {
    const parsed = parseInt(id, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractMeta(
  type: SyncEventType,
  body: unknown,
): Record<string, unknown> | undefined {
  if (!body || typeof body !== "object") return undefined;
  const obj = body as Record<string, unknown>;
  if (type === "call") {
    const meta: Record<string, unknown> = {};
    if (typeof obj.direction === "string") meta.direction = obj.direction;
    if (typeof obj.status === "string") meta.status = obj.status;
    return Object.keys(meta).length > 0 ? meta : undefined;
  }
  return undefined;
}
