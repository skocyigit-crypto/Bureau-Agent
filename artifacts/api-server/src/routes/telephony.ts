import { Router, type IRouter } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, telephonyProvidersTable, telephonyCallLogsTable, telephonySmsLogsTable, callsTable, contactsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import {
  getSupportedProviders,
  getProviderInfo,
  validateProviderConfig,
  makeCall,
  sendSms,
  maskConfig,
} from "../services/telephony-providers";

const router: IRouter = Router();
export const telephonyWebhookRouter: IRouter = Router();

telephonyWebhookRouter.post("/telephony/webhook/:provider", async (req, res): Promise<void> => {
  const provider = String(req.params.provider);
  const payload = req.body;

  console.log(`[Telephony Webhook] ${provider}:`, JSON.stringify(payload).slice(0, 500));

  try {
    if (provider === "twilio") {
      const callSid = payload.CallSid;
      const status = payload.CallStatus;
      const duration = parseInt(payload.CallDuration || "0");
      if (callSid) {
        const existing = await db.select({ id: telephonyCallLogsTable.id })
          .from(telephonyCallLogsTable)
          .where(eq(telephonyCallLogsTable.providerCallSid, callSid))
          .limit(1);
        if (existing.length > 0) {
          await db.update(telephonyCallLogsTable)
            .set({ status, duration, endedAt: new Date() })
            .where(and(eq(telephonyCallLogsTable.id, existing[0].id), eq(telephonyCallLogsTable.providerCallSid, callSid)));
        }
      }
    } else if (provider === "vonage") {
      const uuid = payload.uuid;
      const status = payload.status;
      const duration = parseInt(payload.duration || "0");
      if (uuid) {
        const existing = await db.select({ id: telephonyCallLogsTable.id })
          .from(telephonyCallLogsTable)
          .where(eq(telephonyCallLogsTable.providerCallSid, uuid))
          .limit(1);
        if (existing.length > 0) {
          await db.update(telephonyCallLogsTable)
            .set({ status, duration, endedAt: new Date() })
            .where(and(eq(telephonyCallLogsTable.id, existing[0].id), eq(telephonyCallLogsTable.providerCallSid, uuid)));
        }
      }
    } else if (provider === "telnyx") {
      const callId = payload.data?.payload?.call_control_id;
      const status = payload.data?.event_type;
      if (callId) {
        const existing = await db.select({ id: telephonyCallLogsTable.id })
          .from(telephonyCallLogsTable)
          .where(eq(telephonyCallLogsTable.providerCallSid, callId))
          .limit(1);
        if (existing.length > 0) {
          await db.update(telephonyCallLogsTable)
            .set({ status: status || "updated", endedAt: new Date() })
            .where(and(eq(telephonyCallLogsTable.id, existing[0].id), eq(telephonyCallLogsTable.providerCallSid, callId)));
        }
      }
    }
  } catch (err) {
    console.error(`[Telephony Webhook] Error processing ${provider}:`, err);
  }

  res.json({ received: true });
});

router.get("/telephony/providers/available", async (req, res): Promise<void> => {
  const providers = getSupportedProviders();
  res.json({ providers });
});

router.get("/telephony/providers", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const providers = await db.select().from(telephonyProvidersTable)
    .where(eq(telephonyProvidersTable.organisationId, orgId))
    .orderBy(desc(telephonyProvidersTable.isDefault), desc(telephonyProvidersTable.isActive));

  const masked = providers.map(p => ({
    ...p,
    config: maskConfig(p.config as Record<string, any>, p.provider),
  }));
  res.json({ providers: masked });
});

router.post("/telephony/providers", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { provider, label, config, phoneNumbers } = req.body;

  if (!provider || !config) {
    res.status(400).json({ error: "Fournisseur et configuration requis" });
    return;
  }

  const info = getProviderInfo(provider);
  if (!info) {
    res.status(400).json({ error: `Fournisseur inconnu: ${provider}` });
    return;
  }

  const validation = validateProviderConfig(provider, config);
  if (!validation.valid) {
    res.status(400).json({ error: "Configuration invalide", details: validation.errors });
    return;
  }

  const existing = await db.select().from(telephonyProvidersTable)
    .where(and(eq(telephonyProvidersTable.organisationId, orgId)));
  const isFirst = existing.length === 0;

  const [created] = await db.insert(telephonyProvidersTable).values({
    organisationId: orgId,
    provider,
    label: label || info.displayName,
    config,
    phoneNumbers: phoneNumbers || (config.fromNumber ? [config.fromNumber] : []),
    capabilities: info.capabilities,
    isDefault: isFirst,
    isActive: true,
  }).returning();

  res.json({
    provider: { ...created, config: maskConfig(created.config as Record<string, any>, created.provider) },
    message: `${info.displayName} configure avec succes`,
  });
});

router.patch("/telephony/providers/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  const { label, config, isActive, isDefault, phoneNumbers } = req.body;

  const [existing] = await db.select().from(telephonyProvidersTable)
    .where(and(eq(telephonyProvidersTable.id, id), eq(telephonyProvidersTable.organisationId, orgId)));
  if (!existing) {
    res.status(404).json({ error: "Fournisseur non trouve" });
    return;
  }

  const updates: any = {};
  if (label !== undefined) updates.label = label;
  if (config !== undefined) {
    const validation = validateProviderConfig(existing.provider, config);
    if (!validation.valid) {
      res.status(400).json({ error: "Configuration invalide", details: validation.errors });
      return;
    }
    updates.config = config;
  }
  if (isActive !== undefined) updates.isActive = isActive;
  if (phoneNumbers !== undefined) updates.phoneNumbers = phoneNumbers;

  if (isDefault === true) {
    await db.update(telephonyProvidersTable)
      .set({ isDefault: false })
      .where(eq(telephonyProvidersTable.organisationId, orgId));
    updates.isDefault = true;
  }

  const [updated] = await db.update(telephonyProvidersTable)
    .set(updates)
    .where(eq(telephonyProvidersTable.id, id))
    .returning();

  res.json({
    provider: { ...updated, config: maskConfig(updated.config as Record<string, any>, updated.provider) },
  });
});

router.delete("/telephony/providers/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));

  const [existing] = await db.select().from(telephonyProvidersTable)
    .where(and(eq(telephonyProvidersTable.id, id), eq(telephonyProvidersTable.organisationId, orgId)));
  if (!existing) {
    res.status(404).json({ error: "Fournisseur non trouve" });
    return;
  }

  await db.delete(telephonyProvidersTable).where(eq(telephonyProvidersTable.id, id));
  res.json({ message: "Fournisseur supprime" });
});

router.post("/telephony/providers/:id/test", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));

  const [provider] = await db.select().from(telephonyProvidersTable)
    .where(and(eq(telephonyProvidersTable.id, id), eq(telephonyProvidersTable.organisationId, orgId)));
  if (!provider) {
    res.status(404).json({ error: "Fournisseur non trouve" });
    return;
  }

  const config = provider.config as Record<string, any>;
  const info = getProviderInfo(provider.provider);
  const hasVoice = info?.capabilities.includes("voice");
  const hasSms = info?.capabilities.includes("sms");

  res.json({
    provider: provider.provider,
    label: provider.label,
    status: provider.isActive ? "actif" : "inactif",
    capabilities: provider.capabilities,
    phoneNumbers: provider.phoneNumbers,
    configValid: validateProviderConfig(provider.provider, config).valid,
    voiceReady: hasVoice && !!config.fromNumber,
    smsReady: hasSms && !!config.fromNumber,
    message: "Configuration verifiee avec succes",
  });
});

router.post("/telephony/call", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { to, providerId, record, contactId } = req.body;

  if (!to) {
    res.status(400).json({ error: "Numero de destination requis" });
    return;
  }

  let provider;
  if (providerId) {
    [provider] = await db.select().from(telephonyProvidersTable)
      .where(and(eq(telephonyProvidersTable.id, providerId), eq(telephonyProvidersTable.organisationId, orgId)));
  } else {
    [provider] = await db.select().from(telephonyProvidersTable)
      .where(and(eq(telephonyProvidersTable.organisationId, orgId), eq(telephonyProvidersTable.isDefault, true), eq(telephonyProvidersTable.isActive, true)));
  }

  if (!provider) {
    res.status(400).json({ error: "Aucun fournisseur telephonique configure. Ajoutez un fournisseur dans les parametres." });
    return;
  }

  const config = provider.config as Record<string, any>;
  const result = await makeCall(provider.provider, config, { to, record: record === true });

  const [log] = await db.insert(telephonyCallLogsTable).values({
    organisationId: orgId,
    providerId: provider.id,
    providerCallSid: result.callSid || null,
    direction: "sortant",
    fromNumber: config.fromNumber || "",
    toNumber: to,
    status: result.success ? (result.status || "initiated") : "failed",
    metadata: { error: result.error || undefined },
  }).returning();

  if (result.success) {
    let contactName = "";
    if (contactId) {
      const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
      if (contact) contactName = `${contact.firstName} ${contact.lastName}`;
    }
    await db.insert(callsTable).values({
      organisationId: orgId,
      contactId: contactId || null,
      contactName: contactName || "",
      phoneNumber: to,
      direction: "sortant",
      status: "repondu",
      duration: 0,
      notes: `Appel via ${provider.label}`,
    });
  }

  res.json({
    success: result.success,
    callSid: result.callSid,
    status: result.status,
    provider: provider.label,
    error: result.error,
    logId: log.id,
  });
});

router.post("/telephony/sms", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { to, body: msgBody, providerId, contactId } = req.body;

  if (!to || !msgBody) {
    res.status(400).json({ error: "Numero et message requis" });
    return;
  }

  let provider;
  if (providerId) {
    [provider] = await db.select().from(telephonyProvidersTable)
      .where(and(eq(telephonyProvidersTable.id, providerId), eq(telephonyProvidersTable.organisationId, orgId)));
  } else {
    [provider] = await db.select().from(telephonyProvidersTable)
      .where(and(eq(telephonyProvidersTable.organisationId, orgId), eq(telephonyProvidersTable.isDefault, true), eq(telephonyProvidersTable.isActive, true)));
  }

  if (!provider) {
    res.status(400).json({ error: "Aucun fournisseur SMS configure" });
    return;
  }

  const config = provider.config as Record<string, any>;
  const result = await sendSms(provider.provider, config, { to, body: msgBody });

  await db.insert(telephonySmsLogsTable).values({
    organisationId: orgId,
    providerId: provider.id,
    providerMessageSid: result.messageSid || null,
    direction: "sortant",
    fromNumber: config.fromNumber || "",
    toNumber: to,
    body: msgBody,
    status: result.success ? (result.status || "sent") : "failed",
    metadata: { error: result.error || undefined },
  });

  res.json({
    success: result.success,
    messageSid: result.messageSid,
    status: result.status,
    provider: provider.label,
    error: result.error,
  });
});

router.get("/telephony/call-logs", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const limit = parseInt(String(req.query.limit || "50"));

  const logs = await db.select().from(telephonyCallLogsTable)
    .where(eq(telephonyCallLogsTable.organisationId, orgId))
    .orderBy(desc(telephonyCallLogsTable.createdAt))
    .limit(limit);

  res.json({ logs, total: logs.length });
});

router.get("/telephony/sms-logs", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const limit = parseInt(String(req.query.limit || "50"));

  const logs = await db.select().from(telephonySmsLogsTable)
    .where(eq(telephonySmsLogsTable.organisationId, orgId))
    .orderBy(desc(telephonySmsLogsTable.createdAt))
    .limit(limit);

  res.json({ logs, total: logs.length });
});

router.get("/telephony/stats", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);

  const [callStats] = await db.select({
    total: sql<number>`count(*)::int`,
    successful: sql<number>`count(*) filter (where ${telephonyCallLogsTable.status} != 'failed')::int`,
    failed: sql<number>`count(*) filter (where ${telephonyCallLogsTable.status} = 'failed')::int`,
    totalDuration: sql<number>`coalesce(sum(${telephonyCallLogsTable.duration}), 0)::int`,
  }).from(telephonyCallLogsTable).where(eq(telephonyCallLogsTable.organisationId, orgId));

  const [smsStats] = await db.select({
    total: sql<number>`count(*)::int`,
    successful: sql<number>`count(*) filter (where ${telephonySmsLogsTable.status} != 'failed')::int`,
    failed: sql<number>`count(*) filter (where ${telephonySmsLogsTable.status} = 'failed')::int`,
  }).from(telephonySmsLogsTable).where(eq(telephonySmsLogsTable.organisationId, orgId));

  const providers = await db.select({
    total: sql<number>`count(*)::int`,
    active: sql<number>`count(*) filter (where ${telephonyProvidersTable.isActive} = true)::int`,
  }).from(telephonyProvidersTable).where(eq(telephonyProvidersTable.organisationId, orgId));

  res.json({
    calls: callStats,
    sms: smsStats,
    providers: providers[0],
  });
});

export default router;
