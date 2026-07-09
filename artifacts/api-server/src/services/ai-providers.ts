import { and, desc, eq } from "drizzle-orm";
import { db, aiProvidersTable } from "@workspace/db";
import { encryptSensitiveData, decryptSensitiveData, isEncrypted } from "../lib/crypto";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// BYOK fournisseurs IA (per-organisation). Mirroir de email-providers /
// telephony-providers : une organisation peut configurer SA PROPRE cle API
// pour chaque fournisseur IA (Gemini / OpenAI / Anthropic). Quand une cle
// active existe, les appels de ce fournisseur utilisent un client construit
// avec cette cle (API directe, SANS le proxy IA Replit) ; sinon on retombe
// sur le singleton plateforme (cle/proxy d'environnement) -> aucun changement
// de comportement pour les organisations qui n'ont rien configure.
// ---------------------------------------------------------------------------

export interface AiProviderInfo {
  name: string;
  displayName: string;
  website: string;
  configFields: { key: string; label: string; required: boolean; secret: boolean }[];
  pricing: { description: string };
}

const SUPPORTED_PROVIDERS: Record<string, AiProviderInfo> = {
  gemini: {
    name: "gemini",
    displayName: "Google Gemini",
    website: "https://aistudio.google.com/apikey",
    configFields: [
      { key: "apiKey", label: "Clé API Google Gemini", required: true, secret: true },
    ],
    pricing: { description: "Gemini : palier gratuit généreux, puis facturation à l'usage. Clé sur aistudio.google.com → API Keys." },
  },
  openai: {
    name: "openai",
    displayName: "OpenAI",
    website: "https://platform.openai.com/api-keys",
    configFields: [
      { key: "apiKey", label: "Clé API OpenAI (sk-...)", required: true, secret: true },
    ],
    pricing: { description: "OpenAI : facturation à l'usage (pas de palier gratuit). Clé sur platform.openai.com → API Keys." },
  },
  anthropic: {
    name: "anthropic",
    displayName: "Anthropic Claude",
    website: "https://console.anthropic.com/settings/keys",
    configFields: [
      { key: "apiKey", label: "Clé API Anthropic (sk-ant-...)", required: true, secret: true },
    ],
    pricing: { description: "Anthropic : facturation à l'usage. Clé sur console.anthropic.com → API Keys." },
  },
};

export type AiProviderName = keyof typeof SUPPORTED_PROVIDERS;

// Champs secrets chiffrés au repos.
const SECRET_KEYS = ["apiKey"] as const;

export function getSupportedAiProviders(): AiProviderInfo[] {
  return Object.values(SUPPORTED_PROVIDERS);
}

export function getAiProviderInfo(name: string): AiProviderInfo | null {
  return SUPPORTED_PROVIDERS[name] || null;
}

export function validateAiProviderConfig(provider: string, config: Record<string, any>): { valid: boolean; errors: string[] } {
  const info = SUPPORTED_PROVIDERS[provider];
  if (!info) return { valid: false, errors: [`Fournisseur inconnu : ${provider}`] };
  const errors: string[] = [];
  for (const field of info.configFields) {
    if (field.required && !config[field.key]) errors.push(`${field.label} est requis`);
  }
  return { valid: errors.length === 0, errors };
}

export function maskAiConfig(config: Record<string, any>, provider: string): Record<string, any> {
  const info = SUPPORTED_PROVIDERS[provider];
  if (!info) return {};
  const masked: Record<string, any> = {};
  for (const field of info.configFields) {
    const val = config[field.key];
    if (val) masked[field.key] = field.secret ? `***${String(val).slice(-4)}` : val;
  }
  return masked;
}

/** Chiffre les champs secrets du config avant persistance (idempotent). */
export function encryptAiConfig(config: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...config };
  for (const k of SECRET_KEYS) {
    const v = out[k];
    if (v && !isEncrypted(v)) out[k] = encryptSensitiveData(String(v));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Résolution des clés per-org + construction des clients.
// ---------------------------------------------------------------------------

interface OrgAiKeys {
  gemini: string | null;
  openai: string | null;
  anthropic: string | null;
}

const EMPTY_KEYS: OrgAiKeys = { gemini: null, openai: null, anthropic: null };

// Cache court par organisation pour éviter une requête DB + déchiffrement à
// chaque appel IA. Invalidé explicitement à chaque create/update/delete.
const keysCache = new Map<number, { keys: OrgAiKeys; at: number }>();
const KEYS_TTL_MS = 5 * 60 * 1000;

export function clearOrgAiClientsCache(orgId?: number): void {
  if (orgId == null) keysCache.clear();
  else keysCache.delete(orgId);
}

/**
 * Retourne les clés (déchiffrées) actives de l'organisation, par fournisseur.
 * Une valeur `null` signifie « pas de clé propre → retomber sur la plateforme ».
 */
async function getOrgAiKeys(orgId: number): Promise<OrgAiKeys> {
  const cached = keysCache.get(orgId);
  if (cached && Date.now() - cached.at < KEYS_TTL_MS) return cached.keys;

  const keys: OrgAiKeys = { ...EMPTY_KEYS };
  try {
    const rows = await db.select().from(aiProvidersTable)
      .where(and(eq(aiProvidersTable.organisationId, orgId), eq(aiProvidersTable.isActive, true)))
      .orderBy(desc(aiProvidersTable.isDefault), desc(aiProvidersTable.id));
    for (const row of rows) {
      const provider = row.provider as keyof OrgAiKeys;
      if (provider !== "gemini" && provider !== "openai" && provider !== "anthropic") continue;
      if (keys[provider]) continue; // garde la première (default puis id décroissant)
      const cfg = row.config as Record<string, any>;
      const apiKey = cfg.apiKey ? decryptSensitiveData(String(cfg.apiKey)) : "";
      if (apiKey) keys[provider] = apiKey;
    }
  } catch (err: any) {
    logger.error({ err: err?.message, orgId }, "[AiProviders] Echec resolution cles organisation");
    keysCache.set(orgId, { keys: EMPTY_KEYS, at: Date.now() });
    return EMPTY_KEYS;
  }
  keysCache.set(orgId, { keys, at: Date.now() });
  return keys;
}

/** Client Gemini : cle de l'org si configuree, sinon singleton plateforme. */
export async function getOrgGeminiClient(orgId?: number | null): Promise<any> {
  const mod = await import("@workspace/integrations-gemini-ai");
  if (orgId != null) {
    const { gemini } = await getOrgAiKeys(orgId);
    if (gemini) {
      try { return mod.createGeminiClient(gemini); }
      catch (err: any) { logger.warn({ err: err?.message, orgId }, "[AiProviders] createGeminiClient echec, repli plateforme"); }
    }
  }
  return mod.ai;
}

/** Client d'embeddings : cle Gemini de l'org si configuree, sinon embeddingAi plateforme. */
export async function getOrgEmbeddingClient(orgId?: number | null): Promise<any> {
  const mod = await import("@workspace/integrations-gemini-ai");
  if (orgId != null) {
    const { gemini } = await getOrgAiKeys(orgId);
    if (gemini) {
      try { return mod.createGeminiClient(gemini); }
      catch (err: any) { logger.warn({ err: err?.message, orgId }, "[AiProviders] createGeminiClient (embed) echec, repli plateforme"); }
    }
  }
  return mod.embeddingAi;
}

/** Client OpenAI : cle de l'org si configuree, sinon singleton plateforme. */
export async function getOrgOpenAIClient(orgId?: number | null): Promise<any> {
  const mod = await import("@workspace/integrations-openai-ai-server");
  if (orgId != null) {
    const { openai } = await getOrgAiKeys(orgId);
    if (openai) {
      try { return mod.createOpenAIClient(openai); }
      catch (err: any) { logger.warn({ err: err?.message, orgId }, "[AiProviders] createOpenAIClient echec, repli plateforme"); }
    }
  }
  return mod.openai;
}

/** Client Anthropic : cle de l'org si configuree, sinon singleton plateforme. */
export async function getOrgAnthropicClient(orgId?: number | null): Promise<any> {
  const mod = await import("@workspace/integrations-anthropic-ai");
  if (orgId != null) {
    const { anthropic } = await getOrgAiKeys(orgId);
    if (anthropic) {
      try { return mod.createAnthropicClient(anthropic); }
      catch (err: any) { logger.warn({ err: err?.message, orgId }, "[AiProviders] createAnthropicClient echec, repli plateforme"); }
    }
  }
  return mod.anthropic;
}

/** Indique, par fournisseur, si l'org utilise sa propre cle (pour l'UI/test). */
export async function getOrgAiKeyPresence(orgId: number): Promise<Record<AiProviderName, boolean>> {
  const keys = await getOrgAiKeys(orgId);
  return { gemini: !!keys.gemini, openai: !!keys.openai, anthropic: !!keys.anthropic };
}

// ---------------------------------------------------------------------------
// Repli "fail-soft" a l'execution.
//
// getOrg*Client retombe deja sur la plateforme quand l'org n'a PAS de cle ou
// quand la *construction* du client echoue. Mais une cle org syntaxiquement
// valide peut etre revoquee/invalide et n'echouer qu'au moment de l'APPEL
// reseau (401/403, "API key not valid"...). Exigence produit : une mauvaise
// cle org ne doit JAMAIS bloquer l'IA -> on detecte ces erreurs d'auth et on
// rejoue l'appel une fois avec le singleton plateforme.
//
// On ne replie QUE sur erreur d'authentification de cle : les erreurs de quota
// ou reseau remontent telles quelles (ne pas faire payer la plateforme pour un
// depassement de quota cote client, ne pas masquer une vraie panne).
// ---------------------------------------------------------------------------

/** Vrai si l'erreur ressemble a une cle API invalide/revoquee (et non un quota/reseau). */
export function isAiAuthKeyError(err: any): boolean {
  const status = Number(
    err?.status ?? err?.statusCode ?? err?.response?.status ?? err?.error?.status,
  );
  if (status === 401 || status === 403) return true;
  const msg = String(err?.message ?? err?.error?.message ?? "").toLowerCase();
  return (
    msg.includes("api key not valid") ||
    msg.includes("api_key_invalid") ||
    msg.includes("invalid api key") ||
    msg.includes("incorrect api key") ||
    msg.includes("invalid x-api-key") ||
    msg.includes("permission denied") ||
    msg.includes("unauthorized") ||
    msg.includes("authentication")
  );
}

/**
 * Execute `fn` avec le client Gemini de l'org ; si la cle org echoue a
 * l'authentification, rejoue une fois avec le singleton plateforme.
 */
export async function callOrgGemini<T>(
  orgId: number | null | undefined,
  fn: (client: any) => Promise<T>,
): Promise<T> {
  const mod = await import("@workspace/integrations-gemini-ai");
  const client = await getOrgGeminiClient(orgId);
  if (orgId == null || client === mod.ai) return fn(client);
  try {
    return await fn(client);
  } catch (err: any) {
    if (isAiAuthKeyError(err)) {
      logger.warn({ orgId, err: err?.message }, "[AiProviders] cle Gemini org invalide a l'execution, repli plateforme");
      return fn(mod.ai);
    }
    throw err;
  }
}

/** Idem `callOrgGemini` mais pour le client d'embeddings (modele Gemini embed). */
export async function callOrgEmbedding<T>(
  orgId: number | null | undefined,
  fn: (client: any) => Promise<T>,
): Promise<T> {
  const mod = await import("@workspace/integrations-gemini-ai");
  const client = await getOrgEmbeddingClient(orgId);
  if (orgId == null || client === mod.embeddingAi) return fn(client);
  try {
    return await fn(client);
  } catch (err: any) {
    if (isAiAuthKeyError(err)) {
      logger.warn({ orgId, err: err?.message }, "[AiProviders] cle Gemini org (embed) invalide a l'execution, repli plateforme");
      return fn(mod.embeddingAi);
    }
    throw err;
  }
}

/**
 * Execute `fn` avec le client OpenAI de l'org ; si la cle org echoue a
 * l'authentification, rejoue une fois avec le singleton plateforme.
 * Miroir de `callOrgGemini` — avant l'ajout de cette fonction, les appels
 * OpenAI via `getOrgOpenAIClient` echouaient durement sur une cle org
 * revoquee au lieu de retomber sur la plateforme.
 */
export async function callOrgOpenAI<T>(
  orgId: number | null | undefined,
  fn: (client: any) => Promise<T>,
): Promise<T> {
  const mod = await import("@workspace/integrations-openai-ai-server");
  const client = await getOrgOpenAIClient(orgId);
  if (orgId == null || client === mod.openai) return fn(client);
  try {
    return await fn(client);
  } catch (err: any) {
    if (isAiAuthKeyError(err)) {
      logger.warn({ orgId, err: err?.message }, "[AiProviders] cle OpenAI org invalide a l'execution, repli plateforme");
      return fn(mod.openai);
    }
    throw err;
  }
}

/**
 * Execute `fn` avec le client Anthropic de l'org ; si la cle org echoue a
 * l'authentification, rejoue une fois avec le singleton plateforme.
 * Miroir de `callOrgGemini` (voir `callOrgOpenAI` ci-dessus).
 */
export async function callOrgAnthropic<T>(
  orgId: number | null | undefined,
  fn: (client: any) => Promise<T>,
): Promise<T> {
  const mod = await import("@workspace/integrations-anthropic-ai");
  const client = await getOrgAnthropicClient(orgId);
  if (orgId == null || client === mod.anthropic) return fn(client);
  try {
    return await fn(client);
  } catch (err: any) {
    if (isAiAuthKeyError(err)) {
      logger.warn({ orgId, err: err?.message }, "[AiProviders] cle Anthropic org invalide a l'execution, repli plateforme");
      return fn(mod.anthropic);
    }
    throw err;
  }
}
