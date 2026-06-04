import crypto from "crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  webhookEndpointsTable,
  webhookDeliveriesTable,
} from "@workspace/db";
import { CreateWebhookBody, UpdateWebhookBody } from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";
import { zodErrorResponse } from "../lib/zod-error";
import { encryptSensitiveData } from "../lib/crypto";
import { assertSafePublicUrl } from "../lib/ssrf-guard";

// Endpoints webhook sortants génériques (Faz 1). CRUD tenant-scoped + rotation
// du secret de signature + historique des livraisons. Le secret HMAC est
// chiffré au repos et n'est renvoyé en clair qu'à la création / rotation.

const router: IRouter = Router();

const SECRET_PREFIX = "whsec_";

function generateSigningSecret(): string {
  return SECRET_PREFIX + crypto.randomBytes(32).toString("base64url");
}

/** Sérialise une ligne endpoint vers la forme API (sans le secret chiffré). */
function toEndpointResponse(row: typeof webhookEndpointsTable.$inferSelect) {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    active: row.active,
    failureCount: row.failureCount,
    lastDeliveryAt: row.lastDeliveryAt,
    lastStatus: row.lastStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.get("/webhooks", async (req, res) => {
  const orgId = getOrgId(req);
  const rows = await db
    .select()
    .from(webhookEndpointsTable)
    .where(eq(webhookEndpointsTable.organisationId, orgId))
    .orderBy(desc(webhookEndpointsTable.createdAt));
  res.json(rows.map(toEndpointResponse));
});

router.post("/webhooks", async (req, res) => {
  const parsed = CreateWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }
  const orgId = getOrgId(req);
  const userId = req.session?.userId ?? null;

  // Anti-SSRF : valide la cible AVANT persistance (résout le DNS, bloque
  // privé/loopback/metadata ; https requis en production).
  try {
    await assertSafePublicUrl(parsed.data.url);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const plaintextSecret = generateSigningSecret();

  const [row] = await db
    .insert(webhookEndpointsTable)
    .values({
      organisationId: orgId,
      url: parsed.data.url,
      description: parsed.data.description ?? null,
      events: parsed.data.events,
      secret: encryptSensitiveData(plaintextSecret),
      active: parsed.data.active ?? true,
      createdByUserId: userId,
    })
    .returning();

  res.status(201).json({ ...toEndpointResponse(row), secret: plaintextSecret });
});

router.patch("/webhooks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }
  const parsed = UpdateWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }
  const orgId = getOrgId(req);

  if (parsed.data.url !== undefined) {
    try {
      await assertSafePublicUrl(parsed.data.url);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
  }

  const updates: Partial<typeof webhookEndpointsTable.$inferInsert> = {};
  if (parsed.data.url !== undefined) updates.url = parsed.data.url;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.events !== undefined) updates.events = parsed.data.events;
  if (parsed.data.active !== undefined) updates.active = parsed.data.active;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Aucun champ à mettre à jour." });
    return;
  }

  const [row] = await db
    .update(webhookEndpointsTable)
    .set(updates)
    .where(
      and(
        eq(webhookEndpointsTable.id, id),
        eq(webhookEndpointsTable.organisationId, orgId),
      ),
    )
    .returning();

  if (!row) {
    res.status(404).json({ error: "Endpoint webhook introuvable." });
    return;
  }
  res.json(toEndpointResponse(row));
});

router.delete("/webhooks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }
  const orgId = getOrgId(req);
  const [row] = await db
    .delete(webhookEndpointsTable)
    .where(
      and(
        eq(webhookEndpointsTable.id, id),
        eq(webhookEndpointsTable.organisationId, orgId),
      ),
    )
    .returning({ id: webhookEndpointsTable.id });
  if (!row) {
    res.status(404).json({ error: "Endpoint webhook introuvable." });
    return;
  }
  res.status(204).end();
});

router.post("/webhooks/:id/rotate-secret", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }
  const orgId = getOrgId(req);
  const plaintextSecret = generateSigningSecret();

  const [row] = await db
    .update(webhookEndpointsTable)
    .set({ secret: encryptSensitiveData(plaintextSecret) })
    .where(
      and(
        eq(webhookEndpointsTable.id, id),
        eq(webhookEndpointsTable.organisationId, orgId),
      ),
    )
    .returning();

  if (!row) {
    res.status(404).json({ error: "Endpoint webhook introuvable." });
    return;
  }
  res.json({ ...toEndpointResponse(row), secret: plaintextSecret });
});

router.get("/webhooks/:id/deliveries", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }
  const orgId = getOrgId(req);

  // Vérifie l'appartenance de l'endpoint à l'organisation avant d'exposer
  // son historique.
  const [endpoint] = await db
    .select({ id: webhookEndpointsTable.id })
    .from(webhookEndpointsTable)
    .where(
      and(
        eq(webhookEndpointsTable.id, id),
        eq(webhookEndpointsTable.organisationId, orgId),
      ),
    );
  if (!endpoint) {
    res.status(404).json({ error: "Endpoint webhook introuvable." });
    return;
  }

  const rows = await db
    .select()
    .from(webhookDeliveriesTable)
    .where(
      and(
        eq(webhookDeliveriesTable.endpointId, id),
        eq(webhookDeliveriesTable.organisationId, orgId),
      ),
    )
    .orderBy(desc(webhookDeliveriesTable.createdAt))
    .limit(100);

  res.json(
    rows.map((r) => ({
      id: r.id,
      endpointId: r.endpointId,
      eventType: r.eventType,
      eventId: r.eventId,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.maxAttempts,
      responseStatus: r.responseStatus,
      error: r.error,
      durationMs: r.durationMs,
      nextRetryAt: r.nextRetryAt,
      deliveredAt: r.deliveredAt,
      createdAt: r.createdAt,
    })),
  );
});

export default router;
