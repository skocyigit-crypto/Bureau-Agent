import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db, callsTable, contactsTable, tasksTable, messagesTable, stockArticlesTable, calendarEventsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
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
