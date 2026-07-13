import { Router } from "express";
import { broadcaster, type SyncEventType } from "../services/broadcaster";

const router = Router();

router.get("/sync/events", (req, res): void => {
  const orgId = req.session?.organisationId;
  const userId = req.session?.userId;
  if (!orgId || !userId) { res.status(401).end(); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const unsubscribe = broadcaster.subscribe(orgId, res);

  const welcome = `data: ${JSON.stringify({ type: "ping", action: "ping", ts: Date.now(), connections: broadcaster.connectionCount(orgId) })}\n\n`;
  res.write(welcome);

  const heartbeat = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: "ping", action: "ping", ts: Date.now() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.post("/sync/broadcast", (req, res): void => {
  const orgId = req.session?.organisationId;
  const userId = req.session?.userId;
  if (!orgId || !userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const { type, action, resourceId } = req.body as {
    type: SyncEventType;
    action: "created" | "updated" | "deleted";
    resourceId?: number;
  };

  if (!type || !action) { res.status(400).json({ error: "type et action requis." }); return; }

  broadcaster.broadcast(orgId, { type, action, resourceId, triggeredBy: userId });
  res.json({ ok: true, connections: broadcaster.connectionCount(orgId) });
});

router.get("/sync/status", (req, res): void => {
  const orgId = req.session?.organisationId;
  res.json({
    orgConnections: orgId ? broadcaster.connectionCount(orgId) : 0,
    totalConnections: broadcaster.totalConnections(),
  });
});

export default router;
