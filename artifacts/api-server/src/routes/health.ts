import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db, callsTable, contactsTable, tasksTable, messagesTable, stockArticlesTable, calendarEventsTable, appReleasesTable, checkDbHealth } from "@workspace/db";
import { sql, desc, eq, and } from "drizzle-orm";
import crypto from "crypto";

const router: IRouter = Router();

const APP_BUILD_HASH = crypto.createHash("md5").update(new Date().toISOString().slice(0, 16)).digest("hex").substring(0, 12);
const APP_BUILD_TIME = new Date().toISOString();
const startedAt = new Date().toISOString();

router.get("/healthz", async (_req, res) => {
  const dbHealthy = await checkDbHealth();
  const status = dbHealthy ? "ok" : "degraded";
  const httpStatus = dbHealthy ? 200 : 503;

  res.status(httpStatus).json({
    status,
    uptime: Math.floor(process.uptime()),
    startedAt,
    db: dbHealthy ? "connected" : "unreachable",
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    },
  });
});

router.get("/app-version", async (_req, res) => {
  try {
    const [latestRelease] = await db.select()
      .from(appReleasesTable)
      .where(eq(appReleasesTable.isActive, true))
      .orderBy(desc(appReleasesTable.publishedAt))
      .limit(1);

    res.json({
      buildHash: APP_BUILD_HASH,
      buildTime: APP_BUILD_TIME,
      latestRelease: latestRelease ? {
        id: latestRelease.id,
        version: latestRelease.version,
        title: latestRelease.title,
        description: latestRelease.description,
        changes: latestRelease.changes,
        type: latestRelease.type,
        forceUpdate: latestRelease.forceUpdate,
        publishedAt: latestRelease.publishedAt,
      } : null,
    });
  } catch {
    res.json({ buildHash: APP_BUILD_HASH, buildTime: APP_BUILD_TIME, latestRelease: null });
  }
});

router.get("/app-releases", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit)) || 10, 50);
    const releases = await db.select()
      .from(appReleasesTable)
      .where(eq(appReleasesTable.isActive, true))
      .orderBy(desc(appReleasesTable.publishedAt))
      .limit(limit);
    res.json({ releases });
  } catch {
    res.json({ releases: [] });
  }
});

router.post("/app-releases", async (req, res): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  if (userRole !== "super_admin") {
    res.status(403).json({ error: "Acces reserve au super administrateur." });
    return;
  }

  const { version, title, description, changes, type, forceUpdate } = req.body;
  if (!version || !title) {
    res.status(400).json({ error: "Version et titre requis." });
    return;
  }

  try {
    const userId = (req.session as any)?.userId;
    const [release] = await db.insert(appReleasesTable).values({
      version,
      title,
      description: description || null,
      changes: changes || null,
      type: type || "update",
      forceUpdate: forceUpdate || false,
      buildHash: APP_BUILD_HASH,
      publishedBy: userId,
    }).returning();
    res.status(201).json(release);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/app-releases/:id", async (req, res): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  if (userRole !== "super_admin") {
    res.status(403).json({ error: "Acces reserve." });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  if (!id) { res.status(400).json({ error: "ID invalide." }); return; }
  await db.update(appReleasesTable).set({ isActive: false }).where(eq(appReleasesTable.id, id));
  res.status(204).end();
});

let cachedVersion: { hash: string; timestamp: number } | null = null;
const CACHE_TTL_MS = 10_000;

router.get("/data-version", async (req, res) => {
  try {
    const now = Date.now();
    if (cachedVersion && now - cachedVersion.timestamp < CACHE_TTL_MS) {
      res.json({ version: cachedVersion.hash, ts: cachedVersion.timestamp });
      return;
    }

    const orgId = (req.session as any)?.organisationId;
    const tables = [
      { t: callsTable, col: callsTable.updatedAt, org: callsTable.organisationId },
      { t: contactsTable, col: contactsTable.updatedAt, org: contactsTable.organisationId },
      { t: tasksTable, col: tasksTable.updatedAt, org: tasksTable.organisationId },
      { t: messagesTable, col: messagesTable.updatedAt, org: messagesTable.organisationId },
      { t: stockArticlesTable, col: stockArticlesTable.updatedAt, org: stockArticlesTable.organisationId },
      { t: calendarEventsTable, col: calendarEventsTable.updatedAt, org: calendarEventsTable.organisationId },
    ];

    const results = await Promise.all(
      tables.map(({ t, col, org }) =>
        db.select({
          latest: sql<string>`coalesce(max(${col})::text, '')`,
          cnt: sql<number>`count(*)::int`,
        }).from(t).where(orgId ? sql`${org} = ${orgId}` : sql`1=1`)
      )
    );

    const fingerprint = results.map(r => `${r[0]?.latest || ""}:${r[0]?.cnt || 0}`).join("|");
    const hash = crypto.createHash("md5").update(fingerprint).digest("hex").substring(0, 12);

    cachedVersion = { hash, timestamp: now };
    res.json({ version: hash, ts: now });
  } catch {
    res.json({ version: "unknown", ts: Date.now() });
  }
});

export default router;
