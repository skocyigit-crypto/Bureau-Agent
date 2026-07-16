import { Router, type IRouter, type Request } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, telephonyProvidersTable, telephonyCallLogsTable, telephonySmsLogsTable, callsTable, contactsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { logger } from "../lib/logger";
import {
  getSupportedProviders,
  getProviderInfo,
  validateProviderConfig,
  makeCall,
  sendSms,
  maskConfig,
  encryptProviderConfig,
  decryptProviderConfig,
} from "../services/telephony-providers";

const router: IRouter = Router();
export const telephonyWebhookRouter: IRouter = Router();

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function validateTwilioSignature(req: Request, authToken: string): boolean {
  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!signature || !authToken) return false;
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
  const url = `${proto}://${host}${req.originalUrl}`;
  let urlWithParams = url;
  if (req.body && typeof req.body === "object") {
    const sortedKeys = Object.keys(req.body as Record<string, string>).sort();
    for (const key of sortedKeys) {
      urlWithParams += key + ((req.body as Record<string, string>)[key] ?? "");
    }
  }
  const expected = crypto.createHmac("sha1", authToken).update(urlWithParams).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function validateProviderWebhook(provider: string, req: Request): Promise<{ ok: boolean; orgId?: number | null }> {
  try {
    if (provider === "twilio") {
      // Twilio includes AccountSid in every webhook body. Bind verification to
      // the provider config that owns that AccountSid (per-tenant scoping).
      const accountSid = (req.body as any)?.AccountSid as string | undefined;
      if (!accountSid) return { ok: false };

      const matches = await db.select({ orgId: telephonyProvidersTable.organisationId, config: telephonyProvidersTable.config })
        .from(telephonyProvidersTable)
        .where(and(
          eq(telephonyProvidersTable.provider, "twilio"),
          eq(telephonyProvidersTable.isActive, true),
          sql`${telephonyProvidersTable.config}->>'accountSid' = ${accountSid}`,
        ));

      for (const m of matches) {
        const tok = decryptProviderConfig("twilio", (m.config as Record<string, any>) ?? {}).authToken;
        if (tok && validateTwilioSignature(req, tok)) return { ok: true, orgId: m.orgId };
      }
      // Dev/no-DB fallback: only accept env token if AccountSid also matches env
      const envSid = process.env.TWILIO_ACCOUNT_SID;
      const envToken = process.env.TWILIO_AUTH_TOKEN;
      if (envSid && envToken && envSid === accountSid && validateTwilioSignature(req, envToken)) {
        return { ok: true, orgId: null };
      }
      return { ok: false };
    }
    // Vonage/Telnyx/Plivo/Sinch/Bandwidth n'ont pas de signature HMAC native
    // comparable a Twilio dans ce flux — on verifie donc un secret webhook
    // que CHAQUE tenant definit lui-meme (champ optionnel "webhookSecret" de
    // son fournisseur, voir services/telephony-providers.ts), envoye par le
    // tenant en en-tete X-Webhook-Secret cote fournisseur. Ceci remplace
    // l'ancien controle base uniquement sur une variable d'env plateforme
    // (jamais definie en production, donc TOUJOURS rejetee pour tout tenant).
    if (["vonage", "telnyx", "plivo", "sinch", "bandwidth"].includes(provider)) {
      const providers = await db.select({ orgId: telephonyProvidersTable.organisationId, config: telephonyProvidersTable.config })
        .from(telephonyProvidersTable)
        .where(and(eq(telephonyProvidersTable.provider, provider), eq(telephonyProvidersTable.isActive, true)));

      const got = req.headers["x-webhook-secret"];
      if (typeof got === "string" && got) {
        for (const p of providers) {
          const cfg = decryptProviderConfig(provider, (p.config as Record<string, any>) ?? {});
          const secret = cfg.webhookSecret;
          if (secret && timingSafeEqualStr(got, secret)) return { ok: true, orgId: p.orgId };
        }
      }

      // Repli dev/no-DB: variable d'env plateforme, uniquement pour vonage/telnyx
      // (comportement historique conserve pour ne pas casser un environnement
      // de test existant qui s'appuierait dessus).
      const envVar = provider === "vonage" ? process.env.VONAGE_WEBHOOK_SECRET
        : provider === "telnyx" ? process.env.TELNYX_WEBHOOK_SECRET
        : undefined;
      if (envVar && typeof got === "string" && timingSafeEqualStr(got, envVar)) return { ok: true, orgId: null };

      return { ok: false };
    }
    return { ok: false };
  } catch (err) {
    logger.error({ err, provider }, "Webhook signature validation failed");
    return { ok: false };
  }
}

telephonyWebhookRouter.post("/telephony/webhook/:provider", async (req, res): Promise<void> => {
  const provider = String(req.params.provider);
  const payload = req.body;

  const { ok: valid, orgId } = await validateProviderWebhook(provider, req);
  if (!valid) {
    logger.warn({ provider, ip: req.ip }, "Rejected unsigned telephony webhook");
    res.status(401).json({ error: "Signature invalide." });
    return;
  }

  logger.info({ provider, payloadSize: JSON.stringify(payload).length }, "Telephony webhook received");

  try {
    if (provider === "twilio") {
      const callSid = payload.CallSid;
      const status = payload.CallStatus;
      const duration = parseInt(payload.CallDuration || "0");
      if (callSid) {
        const existing = await db.select({ id: telephonyCallLogsTable.id })
          .from(telephonyCallLogsTable)
          .where(orgId != null
            ? and(eq(telephonyCallLogsTable.providerCallSid, callSid), eq(telephonyCallLogsTable.organisationId, orgId))
            : eq(telephonyCallLogsTable.providerCallSid, callSid))
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
          .where(orgId != null
            ? and(eq(telephonyCallLogsTable.providerCallSid, uuid), eq(telephonyCallLogsTable.organisationId, orgId))
            : eq(telephonyCallLogsTable.providerCallSid, uuid))
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
          .where(orgId != null
            ? and(eq(telephonyCallLogsTable.providerCallSid, callId), eq(telephonyCallLogsTable.organisationId, orgId))
            : eq(telephonyCallLogsTable.providerCallSid, callId))
          .limit(1);
        if (existing.length > 0) {
          await db.update(telephonyCallLogsTable)
            .set({ status: status || "updated", endedAt: new Date() })
            .where(and(eq(telephonyCallLogsTable.id, existing[0].id), eq(telephonyCallLogsTable.providerCallSid, callId)));
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Erreur traitement webhook telephonie");
  }

  res.json({ received: true });
});

router.get("/telephony/providers/available", async (req, res): Promise<void> => {
  const providers = getSupportedProviders();
  res.json({ providers });
});

router.get("/telephony/providers", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);

  try {
    const providers = await db.select().from(telephonyProvidersTable)
      .where(eq(telephonyProvidersTable.organisationId, orgId))
      .orderBy(desc(telephonyProvidersTable.isDefault), desc(telephonyProvidersTable.isActive));

    const masked = providers.map(p => ({
      ...p,
      config: maskConfig(p.config as Record<string, any>, p.provider),
    }));
    res.json({ providers: masked });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste fournisseurs telephonie");
    res.status(500).json({ error: "Erreur lors de la recuperation des fournisseurs." });
  }
});

// F4: Protection automatique contre les appels frauduleux. Endpoints dedies
// (lecture/ecriture du seul champ config.fraudAction) pour ne JAMAIS toucher
// aux identifiants du fournisseur — le PATCH generique remplace tout le config
// et masque les secrets, ce qui corromprait les credentials.
const FRAUD_ACTIONS = ["off", "voicemail", "reject"] as const;
type FraudAction = (typeof FRAUD_ACTIONS)[number];

async function getDefaultTwilioProviderRow(orgId: number) {
  const [p] = await db.select().from(telephonyProvidersTable)
    .where(and(
      eq(telephonyProvidersTable.organisationId, orgId),
      eq(telephonyProvidersTable.provider, "twilio"),
    ))
    // Tie-break deterministe (id DESC) aligne sur GET /security/score pour que
    // les deux endpoints resolvent toujours le meme fournisseur par defaut.
    .orderBy(
      desc(telephonyProvidersTable.isDefault),
      desc(telephonyProvidersTable.isActive),
      desc(telephonyProvidersTable.id),
    )
    .limit(1);
  return p ?? null;
}

router.get("/telephony/fraud-protection", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const p = await getDefaultTwilioProviderRow(orgId);
    const action = ((p?.config as Record<string, any>)?.fraudAction as FraudAction) || "off";
    res.json({ action: FRAUD_ACTIONS.includes(action) ? action : "off", configured: !!p });
  } catch (err: any) {
    req.log.error({ err }, "Erreur lecture protection appels");
    res.status(500).json({ error: "Erreur lors de la lecture du reglage." });
  }
});

router.patch("/telephony/fraud-protection", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const action = (req.body?.action ?? "") as FraudAction;
  if (!FRAUD_ACTIONS.includes(action)) {
    res.status(400).json({ error: "Action invalide (off, voicemail ou reject attendu)." });
    return;
  }
  try {
    const p = await getDefaultTwilioProviderRow(orgId);
    if (!p) {
      res.status(404).json({ error: "Aucun fournisseur Twilio configure." });
      return;
    }
    const nextConfig = { ...(p.config as Record<string, any>), fraudAction: action };
    await db.update(telephonyProvidersTable)
      .set({ config: nextConfig })
      .where(and(
        eq(telephonyProvidersTable.id, p.id),
        eq(telephonyProvidersTable.organisationId, orgId),
      ));
    res.json({ action });
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour protection appels");
    res.status(500).json({ error: "Erreur lors de l'enregistrement du reglage." });
  }
});

// Secretaire telephonique IA (entrante). Endpoints dedies (lecture/ecriture du
// seul champ config.aiReceptionist) — meme precaution que fraud-protection:
// ne JAMAIS toucher aux identifiants du fournisseur (le PATCH generique
// remplace tout le config et masque les secrets, ce qui les corromprait).
const REC_LANGS = ["fr", "tr", "en"] as const;
type RecLangCfg = (typeof REC_LANGS)[number];

function receptionistBaseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
  return `${proto}://${host}`;
}

router.get("/telephony/ai-receptionist", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const p = await getDefaultTwilioProviderRow(orgId);
    const cfg = ((p?.config as Record<string, any>)?.aiReceptionist ?? {}) as Record<string, any>;
    const language: RecLangCfg = REC_LANGS.includes(cfg.language) ? cfg.language : "fr";
    const base = receptionistBaseUrl(req);
    res.json({
      configured: !!p,
      enabled: cfg.enabled === true,
      language,
      greeting: typeof cfg.greeting === "string" ? cfg.greeting : "",
      orgName: typeof cfg.orgName === "string" ? cfg.orgName : "",
      webhookUrl: `${base}/api/voice/twilio/incoming`,
      statusCallbackUrl: `${base}/api/voice/twilio/status`,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur lecture secretaire IA");
    res.status(500).json({ error: "Erreur lors de la lecture du reglage." });
  }
});

router.put("/telephony/ai-receptionist", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { enabled, language, greeting, orgName } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "Champ 'enabled' (booleen) requis." });
    return;
  }
  if (greeting != null && typeof greeting !== "string") {
    res.status(400).json({ error: "'greeting' doit etre une chaine de caracteres." });
    return;
  }
  if (orgName != null && typeof orgName !== "string") {
    res.status(400).json({ error: "'orgName' doit etre une chaine de caracteres." });
    return;
  }
  const lang: RecLangCfg = REC_LANGS.includes(language) ? language : "fr";
  try {
    const p = await getDefaultTwilioProviderRow(orgId);
    if (!p) {
      res.status(404).json({ error: "Aucun fournisseur Twilio configure." });
      return;
    }
    const prevCfg = (p.config as Record<string, any>) ?? {};
    const prevRec = (prevCfg.aiReceptionist as Record<string, any>) ?? {};
    const nextRec = {
      ...prevRec,
      enabled,
      language: lang,
      greeting: typeof greeting === "string" ? greeting.slice(0, 500) : (prevRec.greeting ?? ""),
      orgName: typeof orgName === "string" ? orgName.slice(0, 120) : (prevRec.orgName ?? ""),
    };
    const nextConfig = { ...prevCfg, aiReceptionist: nextRec };
    await db.update(telephonyProvidersTable)
      .set({ config: nextConfig })
      .where(and(
        eq(telephonyProvidersTable.id, p.id),
        eq(telephonyProvidersTable.organisationId, orgId),
      ));
    res.json({ enabled: nextRec.enabled, language: nextRec.language, greeting: nextRec.greeting, orgName: nextRec.orgName });
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour secretaire IA");
    res.status(500).json({ error: "Erreur lors de l'enregistrement du reglage." });
  }
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
    res.status(400).json({ error: "Fournisseur inconnu" });
    return;
  }

  const validation = validateProviderConfig(provider, config);
  if (!validation.valid) {
    res.status(400).json({ error: "Configuration invalide", details: validation.errors });
    return;
  }

  try {
    const existing = await db.select().from(telephonyProvidersTable)
      .where(and(eq(telephonyProvidersTable.organisationId, orgId)));
    const isFirst = existing.length === 0;

    const [created] = await db.insert(telephonyProvidersTable).values({
      organisationId: orgId,
      provider,
      label: label || info.displayName,
      config: encryptProviderConfig(provider, config),
      phoneNumbers: phoneNumbers || (config.fromNumber ? [config.fromNumber] : []),
      capabilities: info.capabilities,
      isDefault: isFirst,
      isActive: true,
    }).returning();

    res.json({
      provider: { ...created, config: maskConfig(created.config as Record<string, any>, created.provider) },
      message: `${info.displayName} configure avec succes`,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation fournisseur telephonie");
    res.status(500).json({ error: "Erreur lors de la configuration du fournisseur." });
  }
});

router.patch("/telephony/providers/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  const { label, config, isActive, isDefault, phoneNumbers } = req.body;

  try {
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
      updates.config = encryptProviderConfig(existing.provider, config);
    }
    if (isActive !== undefined) updates.isActive = isActive;
    if (phoneNumbers !== undefined) updates.phoneNumbers = phoneNumbers;

    if (isDefault === true) {
      await db.update(telephonyProvidersTable)
        .set({ isDefault: false })
        .where(eq(telephonyProvidersTable.organisationId, orgId));
      updates.isDefault = true;
    }

    // Defense-in-depth: even though `existing` was scoped to (id, orgId)
    // above, the UPDATE re-asserts the orgId predicate to close any
    // theoretical TOCTOU window between the SELECT and the UPDATE.
    const [updated] = await db.update(telephonyProvidersTable)
      .set(updates)
      .where(and(eq(telephonyProvidersTable.id, id), eq(telephonyProvidersTable.organisationId, orgId)))
      .returning();

    res.json({
      provider: { ...updated, config: maskConfig(updated.config as Record<string, any>, updated.provider) },
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour fournisseur telephonie");
    res.status(500).json({ error: "Erreur lors de la mise a jour du fournisseur." });
  }
});

router.delete("/telephony/providers/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));

  try {
    const [existing] = await db.select().from(telephonyProvidersTable)
      .where(and(eq(telephonyProvidersTable.id, id), eq(telephonyProvidersTable.organisationId, orgId)));
    if (!existing) {
      res.status(404).json({ error: "Fournisseur non trouve" });
      return;
    }

    // Defense-in-depth: re-assert orgId on the DELETE to close any TOCTOU
    // window between the preceding SELECT (id, orgId) and this DELETE.
    await db.delete(telephonyProvidersTable)
      .where(and(eq(telephonyProvidersTable.id, id), eq(telephonyProvidersTable.organisationId, orgId)));
    res.json({ message: "Fournisseur supprime" });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression fournisseur telephonie");
    res.status(500).json({ error: "Erreur lors de la suppression du fournisseur." });
  }
});

router.post("/telephony/providers/:id/test", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));

  try {
    const [provider] = await db.select().from(telephonyProvidersTable)
      .where(and(eq(telephonyProvidersTable.id, id), eq(telephonyProvidersTable.organisationId, orgId)));
    if (!provider) {
      res.status(404).json({ error: "Fournisseur non trouve" });
      return;
    }

    const config = decryptProviderConfig(provider.provider, provider.config as Record<string, any>);
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
  } catch (err: any) {
    req.log.error({ err }, "Erreur test fournisseur telephonie");
    res.status(500).json({ error: "Erreur lors du test du fournisseur." });
  }
});

router.post("/telephony/call", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { to, providerId, record, contactId } = req.body;

  if (!to) {
    res.status(400).json({ error: "Numero de destination requis" });
    return;
  }

  try {
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

    const config = decryptProviderConfig(provider.provider, provider.config as Record<string, any>);
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
      let verifiedContactId: number | null = null;
      if (contactId) {
        const [contact] = await db.select().from(contactsTable)
          .where(and(eq(contactsTable.id, contactId), eq(contactsTable.organisationId, orgId)));
        if (contact) {
          contactName = `${contact.firstName} ${contact.lastName}`;
          verifiedContactId = contact.id;
        }
      }
      await db.insert(callsTable).values({
        organisationId: orgId,
        contactId: verifiedContactId,
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
      error: result.success ? undefined : "Appel echoue. Verifiez la configuration du fournisseur.",
      logId: log.id,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur appel telephonique");
    res.status(500).json({ error: "Erreur lors de l'appel telephonique." });
  }
});

router.post("/telephony/sms", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { to, body: msgBody, providerId, contactId } = req.body;

  if (!to || !msgBody) {
    res.status(400).json({ error: "Numero et message requis" });
    return;
  }

  try {
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

    const config = decryptProviderConfig(provider.provider, provider.config as Record<string, any>);
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
      error: result.success ? undefined : "Envoi SMS echoue. Verifiez la configuration du fournisseur.",
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur envoi SMS");
    res.status(500).json({ error: "Erreur lors de l'envoi du SMS." });
  }
});

router.get("/telephony/call-logs", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const limit = parseInt(String(req.query.limit || "50"));

  try {
    const logs = await db.select().from(telephonyCallLogsTable)
      .where(eq(telephonyCallLogsTable.organisationId, orgId))
      .orderBy(desc(telephonyCallLogsTable.createdAt))
      .limit(limit);

    res.json({ logs, total: logs.length });
  } catch (err: any) {
    req.log.error({ err }, "Erreur logs appels telephonie");
    res.status(500).json({ error: "Erreur lors de la recuperation des logs d'appels." });
  }
});

router.get("/telephony/sms-logs", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const limit = parseInt(String(req.query.limit || "50"));

  try {
    const logs = await db.select().from(telephonySmsLogsTable)
      .where(eq(telephonySmsLogsTable.organisationId, orgId))
      .orderBy(desc(telephonySmsLogsTable.createdAt))
      .limit(limit);

    res.json({ logs, total: logs.length });
  } catch (err: any) {
    req.log.error({ err }, "Erreur logs SMS telephonie");
    res.status(500).json({ error: "Erreur lors de la recuperation des logs SMS." });
  }
});

router.get("/telephony/stats", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);

  try {
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
  } catch (err: any) {
    req.log.error({ err }, "Erreur stats telephonie");
    res.status(500).json({ error: "Erreur lors de la recuperation des statistiques." });
  }
});

// En memoire uniquement (pas de table dediee) — n'etait jamais purge: une
// entree ne disparaissait que via un DELETE explicite. Un appel programme
// dont l'heure est deja passee depuis longtemps n'a plus d'utilite; on la
// laisse expirer automatiquement plutot que de la garder indefiniment.
const SCHEDULED_CALL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours apres l'heure prevue
const scheduledCallsStore: Map<number, { id: number; orgId: number; toNumber: string; scheduledAt: string; note: string; status: string; createdBy: number; createdAt: string }[]> = new Map();
let scheduleIdCounter = 1;

function pruneScheduledCalls(): void {
  const now = Date.now();
  for (const [orgId, list] of scheduledCallsStore) {
    const kept = list.filter(s => now - new Date(s.scheduledAt).getTime() < SCHEDULED_CALL_RETENTION_MS);
    if (kept.length === 0) scheduledCallsStore.delete(orgId);
    else if (kept.length !== list.length) scheduledCallsStore.set(orgId, kept);
  }
}
setInterval(pruneScheduledCalls, 60 * 60 * 1000).unref?.();

router.get("/telephony/schedule", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const scheduled = scheduledCallsStore.get(orgId) || [];
  scheduled.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  res.json({ scheduled });
});

router.post("/telephony/schedule", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { toNumber, scheduledAt, note } = req.body;
  if (!toNumber || !scheduledAt) {
    res.status(400).json({ error: "Numero et date/heure requis" });
    return;
  }
  const userId = req.session?.userId || 0;
  const entry = {
    id: scheduleIdCounter++,
    orgId,
    toNumber,
    scheduledAt,
    note: note || "",
    status: "pending",
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
  if (!scheduledCallsStore.has(orgId)) scheduledCallsStore.set(orgId, []);
  scheduledCallsStore.get(orgId)!.push(entry);
  res.json({ success: true, scheduled: entry });
});

router.delete("/telephony/schedule/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  const list = scheduledCallsStore.get(orgId) || [];
  const idx = list.findIndex(s => s.id === id);
  if (idx >= 0) { list.splice(idx, 1); }
  res.json({ success: true });
});

export default router;
