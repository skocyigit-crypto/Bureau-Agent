import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, aiProvidersTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import {
  getSupportedAiProviders,
  getAiProviderInfo,
  validateAiProviderConfig,
  maskAiConfig,
  encryptAiConfig,
  clearOrgAiClientsCache,
} from "../services/ai-providers";
import { decryptSensitiveData } from "../lib/crypto";
import {
  createGeminiClient,
} from "@workspace/integrations-gemini-ai";
import { createOpenAIClient } from "@workspace/integrations-openai-ai-server";
import { createAnthropicClient } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

router.get("/ai-providers/available", async (_req, res): Promise<void> => {
  res.json({ providers: getSupportedAiProviders() });
});

router.get("/ai-providers", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(aiProvidersTable)
      .where(eq(aiProvidersTable.organisationId, orgId))
      .orderBy(desc(aiProvidersTable.isDefault), desc(aiProvidersTable.isActive), desc(aiProvidersTable.id));
    res.json({ providers: rows.map(p => ({ ...p, config: maskAiConfig(p.config as Record<string, any>, p.provider) })) });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste fournisseurs IA");
    res.status(500).json({ error: "Erreur lors de la récupération des fournisseurs IA." });
  }
});

router.post("/ai-providers", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { provider, label, config } = req.body ?? {};
  if (!provider || !config) {
    res.status(400).json({ error: "Fournisseur et configuration requis." });
    return;
  }
  const info = getAiProviderInfo(provider);
  if (!info) {
    res.status(400).json({ error: "Fournisseur IA inconnu." });
    return;
  }
  const validation = validateAiProviderConfig(provider, config);
  if (!validation.valid) {
    res.status(400).json({ error: "Configuration invalide.", details: validation.errors });
    return;
  }
  try {
    // Un seul fournisseur actif par type (gemini/openai/anthropic) et par org :
    // si l'org reconfigure un fournisseur deja present, on remplace l'existant.
    const existingSame = await db.select({ id: aiProvidersTable.id }).from(aiProvidersTable)
      .where(and(eq(aiProvidersTable.organisationId, orgId), eq(aiProvidersTable.provider, provider)));
    if (existingSame.length > 0) {
      res.status(409).json({ error: "Ce fournisseur IA est déjà configuré. Modifiez ou supprimez l'existant." });
      return;
    }
    const existing = await db.select({ id: aiProvidersTable.id }).from(aiProvidersTable)
      .where(eq(aiProvidersTable.organisationId, orgId));
    const isFirst = existing.length === 0;
    const [created] = await db.insert(aiProvidersTable).values({
      organisationId: orgId,
      provider,
      label: label || info.displayName,
      config: encryptAiConfig(config),
      isDefault: isFirst,
      isActive: true,
    }).returning();
    clearOrgAiClientsCache(orgId);
    res.json({ provider: { ...created, config: maskAiConfig(created.config as Record<string, any>, created.provider) } });
  } catch (err: any) {
    req.log.error({ err }, "Erreur création fournisseur IA");
    res.status(500).json({ error: "Erreur lors de la configuration du fournisseur IA." });
  }
});

router.patch("/ai-providers/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  const { label, config, isActive, isDefault } = req.body ?? {};
  try {
    const [existing] = await db.select().from(aiProvidersTable)
      .where(and(eq(aiProvidersTable.id, id), eq(aiProvidersTable.organisationId, orgId)));
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
      const validation = validateAiProviderConfig(existing.provider, merged);
      if (!validation.valid) {
        res.status(400).json({ error: "Configuration invalide.", details: validation.errors });
        return;
      }
      updates.config = encryptAiConfig(merged);
    }
    if (isActive !== undefined) updates.isActive = isActive;
    if (isDefault === true) {
      await db.update(aiProvidersTable).set({ isDefault: false }).where(eq(aiProvidersTable.organisationId, orgId));
      updates.isDefault = true;
    }
    const [updated] = await db.update(aiProvidersTable).set(updates)
      .where(and(eq(aiProvidersTable.id, id), eq(aiProvidersTable.organisationId, orgId)))
      .returning();
    clearOrgAiClientsCache(orgId);
    res.json({ provider: { ...updated, config: maskAiConfig(updated.config as Record<string, any>, updated.provider) } });
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise à jour fournisseur IA");
    res.status(500).json({ error: "Erreur lors de la mise à jour du fournisseur IA." });
  }
});

router.delete("/ai-providers/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  try {
    const [existing] = await db.select({ id: aiProvidersTable.id }).from(aiProvidersTable)
      .where(and(eq(aiProvidersTable.id, id), eq(aiProvidersTable.organisationId, orgId)));
    if (!existing) {
      res.status(404).json({ error: "Fournisseur non trouvé." });
      return;
    }
    await db.delete(aiProvidersTable)
      .where(and(eq(aiProvidersTable.id, id), eq(aiProvidersTable.organisationId, orgId)));
    clearOrgAiClientsCache(orgId);
    res.json({ message: "Fournisseur supprimé." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression fournisseur IA");
    res.status(500).json({ error: "Erreur lors de la suppression du fournisseur IA." });
  }
});

// Test de la cle : un petit appel reel au fournisseur pour valider la cle saisie.
router.post("/ai-providers/:id/test", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  try {
    const [row] = await db.select().from(aiProvidersTable)
      .where(and(eq(aiProvidersTable.id, id), eq(aiProvidersTable.organisationId, orgId)));
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

    const ping = "Réponds uniquement par le mot: OK";
    if (row.provider === "gemini") {
      const client = createGeminiClient(apiKey);
      const r: any = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: ping,
        config: { maxOutputTokens: 8 },
      });
      const text = typeof r?.text === "function" ? r.text() : r?.text;
      res.json({ success: true, message: "Clé Gemini valide.", sample: String(text ?? "").slice(0, 40) });
      return;
    }
    if (row.provider === "openai") {
      const client = createOpenAIClient(apiKey);
      const r: any = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 8,
        messages: [{ role: "user", content: ping }],
      });
      const text = r?.choices?.[0]?.message?.content ?? "";
      res.json({ success: true, message: "Clé OpenAI valide.", sample: String(text).slice(0, 40) });
      return;
    }
    if (row.provider === "anthropic") {
      const client = createAnthropicClient(apiKey);
      const r: any = await client.messages.create({
        model: "claude-3-5-haiku-latest",
        max_tokens: 8,
        messages: [{ role: "user", content: ping }],
      });
      const block = r?.content?.[0];
      const text = block?.type === "text" ? block.text : "";
      res.json({ success: true, message: "Clé Anthropic valide.", sample: String(text).slice(0, 40) });
      return;
    }
    res.status(400).json({ error: "Fournisseur IA inconnu." });
  } catch (err: any) {
    req.log.error({ err: err?.message }, "Erreur test fournisseur IA");
    res.status(400).json({ success: false, error: `Échec du test : ${err?.message || "clé invalide ou quota épuisé."}` });
  }
});

export default router;
