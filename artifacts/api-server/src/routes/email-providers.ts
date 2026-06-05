import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, emailProvidersTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import {
  getSupportedEmailProviders,
  getEmailProviderInfo,
  validateEmailProviderConfig,
  maskEmailConfig,
  encryptEmailConfig,
  clearOrgEmailSenderCache,
} from "../services/email-providers";
import { sendTestEmailWithKey } from "../services/email";
import { decryptSensitiveData } from "../lib/crypto";

const router: IRouter = Router();

router.get("/email/providers/available", async (_req, res): Promise<void> => {
  res.json({ providers: getSupportedEmailProviders() });
});

router.get("/email/providers", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(emailProvidersTable)
      .where(eq(emailProvidersTable.organisationId, orgId))
      .orderBy(desc(emailProvidersTable.isDefault), desc(emailProvidersTable.isActive), desc(emailProvidersTable.id));
    res.json({ providers: rows.map(p => ({ ...p, config: maskEmailConfig(p.config as Record<string, any>, p.provider) })) });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste fournisseurs email");
    res.status(500).json({ error: "Erreur lors de la récupération des fournisseurs email." });
  }
});

router.post("/email/providers", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { provider, label, config } = req.body ?? {};
  if (!provider || !config) {
    res.status(400).json({ error: "Fournisseur et configuration requis." });
    return;
  }
  const info = getEmailProviderInfo(provider);
  if (!info) {
    res.status(400).json({ error: "Fournisseur email inconnu." });
    return;
  }
  const validation = validateEmailProviderConfig(provider, config);
  if (!validation.valid) {
    res.status(400).json({ error: "Configuration invalide.", details: validation.errors });
    return;
  }
  try {
    const existing = await db.select({ id: emailProvidersTable.id }).from(emailProvidersTable)
      .where(eq(emailProvidersTable.organisationId, orgId));
    const isFirst = existing.length === 0;
    const [created] = await db.insert(emailProvidersTable).values({
      organisationId: orgId,
      provider,
      label: label || info.displayName,
      config: encryptEmailConfig(config),
      isDefault: isFirst,
      isActive: true,
    }).returning();
    clearOrgEmailSenderCache(orgId);
    res.json({ provider: { ...created, config: maskEmailConfig(created.config as Record<string, any>, created.provider) } });
  } catch (err: any) {
    req.log.error({ err }, "Erreur création fournisseur email");
    res.status(500).json({ error: "Erreur lors de la configuration du fournisseur email." });
  }
});

router.patch("/email/providers/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  const { label, config, isActive, isDefault } = req.body ?? {};
  try {
    const [existing] = await db.select().from(emailProvidersTable)
      .where(and(eq(emailProvidersTable.id, id), eq(emailProvidersTable.organisationId, orgId)));
    if (!existing) {
      res.status(404).json({ error: "Fournisseur non trouvé." });
      return;
    }
    const updates: Record<string, any> = {};
    if (label !== undefined) updates.label = label;
    if (config !== undefined) {
      // Fusion des secrets : si la clé n'est pas re-saisie (vide ou masquée
      // "***..."), on conserve la valeur chiffrée existante plutôt que de
      // l'écraser avec le masque.
      const prev = (existing.config as Record<string, any>) ?? {};
      const merged: Record<string, any> = { ...prev, ...config };
      const incomingKey = config.apiKey;
      if (incomingKey === undefined || incomingKey === "" || String(incomingKey).startsWith("***")) {
        merged.apiKey = prev.apiKey;
      }
      const validation = validateEmailProviderConfig(existing.provider, merged);
      if (!validation.valid) {
        res.status(400).json({ error: "Configuration invalide.", details: validation.errors });
        return;
      }
      updates.config = encryptEmailConfig(merged);
    }
    if (isActive !== undefined) updates.isActive = isActive;
    if (isDefault === true) {
      await db.update(emailProvidersTable).set({ isDefault: false }).where(eq(emailProvidersTable.organisationId, orgId));
      updates.isDefault = true;
    }
    const [updated] = await db.update(emailProvidersTable).set(updates)
      .where(and(eq(emailProvidersTable.id, id), eq(emailProvidersTable.organisationId, orgId)))
      .returning();
    clearOrgEmailSenderCache(orgId);
    res.json({ provider: { ...updated, config: maskEmailConfig(updated.config as Record<string, any>, updated.provider) } });
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise à jour fournisseur email");
    res.status(500).json({ error: "Erreur lors de la mise à jour du fournisseur email." });
  }
});

router.delete("/email/providers/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  try {
    const [existing] = await db.select({ id: emailProvidersTable.id }).from(emailProvidersTable)
      .where(and(eq(emailProvidersTable.id, id), eq(emailProvidersTable.organisationId, orgId)));
    if (!existing) {
      res.status(404).json({ error: "Fournisseur non trouvé." });
      return;
    }
    await db.delete(emailProvidersTable)
      .where(and(eq(emailProvidersTable.id, id), eq(emailProvidersTable.organisationId, orgId)));
    clearOrgEmailSenderCache(orgId);
    res.json({ message: "Fournisseur supprimé." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression fournisseur email");
    res.status(500).json({ error: "Erreur lors de la suppression du fournisseur email." });
  }
});

router.post("/email/providers/:id/test", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  const to = String(req.body?.to ?? "").trim();
  if (!to || !to.includes("@")) {
    res.status(400).json({ error: "Adresse email destinataire de test requise." });
    return;
  }
  try {
    const [row] = await db.select().from(emailProvidersTable)
      .where(and(eq(emailProvidersTable.id, id), eq(emailProvidersTable.organisationId, orgId)));
    if (!row) {
      res.status(404).json({ error: "Fournisseur non trouvé." });
      return;
    }
    const cfg = row.config as Record<string, any>;
    const apiKey = cfg.apiKey ? decryptSensitiveData(String(cfg.apiKey)) : "";
    if (!apiKey) {
      res.status(400).json({ error: "Aucune clé API configurée pour ce fournisseur." });
      return;
    }
    const result = await sendTestEmailWithKey(apiKey, (cfg.fromEmail as string) || null, to);
    if (result.success) {
      res.json({ success: true, from: result.from, message: `Email de test envoyé à ${to}.` });
    } else {
      res.status(400).json({ success: false, error: result.error || "Échec de l'envoi du test." });
    }
  } catch (err: any) {
    req.log.error({ err }, "Erreur test fournisseur email");
    res.status(500).json({ error: "Erreur lors du test du fournisseur email." });
  }
});

export default router;
