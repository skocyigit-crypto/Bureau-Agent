import { and, desc, eq } from "drizzle-orm";
import { db, emailProvidersTable } from "@workspace/db";
import { encryptSensitiveData, decryptSensitiveData, isEncrypted } from "../lib/crypto";
import { logger } from "../lib/logger";

export interface EmailProviderInfo {
  name: string;
  displayName: string;
  website: string;
  configFields: { key: string; label: string; required: boolean; secret: boolean }[];
  pricing: { description: string };
}

const SUPPORTED_PROVIDERS: Record<string, EmailProviderInfo> = {
  resend: {
    name: "resend",
    displayName: "Resend",
    website: "https://resend.com",
    configFields: [
      { key: "apiKey", label: "Clé API Resend", required: true, secret: true },
      { key: "fromEmail", label: "Adresse expéditeur (domaine vérifié, ex: contact@votre-domaine.fr)", required: false, secret: false },
    ],
    pricing: { description: "Resend : 3 000 emails/mois gratuits, puis ~0,001€/email. Clé sur resend.com → API Keys." },
  },
};

// Champs secrets chiffrés au repos.
const SECRET_KEYS = ["apiKey"] as const;

export function getSupportedEmailProviders(): EmailProviderInfo[] {
  return Object.values(SUPPORTED_PROVIDERS);
}

export function getEmailProviderInfo(name: string): EmailProviderInfo | null {
  return SUPPORTED_PROVIDERS[name] || null;
}

export function validateEmailProviderConfig(provider: string, config: Record<string, any>): { valid: boolean; errors: string[] } {
  const info = SUPPORTED_PROVIDERS[provider];
  if (!info) return { valid: false, errors: [`Fournisseur inconnu : ${provider}`] };
  const errors: string[] = [];
  for (const field of info.configFields) {
    if (field.required && !config[field.key]) errors.push(`${field.label} est requis`);
  }
  return { valid: errors.length === 0, errors };
}

export function maskEmailConfig(config: Record<string, any>, provider: string): Record<string, any> {
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
export function encryptEmailConfig(config: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...config };
  for (const k of SECRET_KEYS) {
    const v = out[k];
    if (v && !isEncrypted(v)) out[k] = encryptSensitiveData(String(v));
  }
  return out;
}

interface OrgEmailSender {
  apiKey: string;
  fromEmail: string | null;
}

// Cache court par organisation pour éviter une requête DB + déchiffrement à
// chaque envoi. Invalidé explicitement à chaque create/update/delete.
const senderCache = new Map<number, { sender: OrgEmailSender | null; at: number }>();
const SENDER_TTL_MS = 5 * 60 * 1000;

export function clearOrgEmailSenderCache(orgId?: number): void {
  if (orgId == null) senderCache.clear();
  else senderCache.delete(orgId);
}

/**
 * Retourne la clé d'envoi (déchiffrée) de l'organisation si elle en a
 * configuré une active, sinon `null` (→ l'appelant retombe sur la plateforme).
 */
export async function getOrgEmailSender(orgId: number): Promise<OrgEmailSender | null> {
  const cached = senderCache.get(orgId);
  if (cached && Date.now() - cached.at < SENDER_TTL_MS) return cached.sender;

  let sender: OrgEmailSender | null = null;
  try {
    const [row] = await db.select().from(emailProvidersTable)
      .where(and(eq(emailProvidersTable.organisationId, orgId), eq(emailProvidersTable.isActive, true)))
      .orderBy(desc(emailProvidersTable.isDefault), desc(emailProvidersTable.id))
      .limit(1);
    if (row) {
      const cfg = row.config as Record<string, any>;
      const apiKey = cfg.apiKey ? decryptSensitiveData(String(cfg.apiKey)) : "";
      if (apiKey) sender = { apiKey, fromEmail: (cfg.fromEmail as string) || null };
    }
  } catch (err: any) {
    logger.error({ err: err?.message, orgId }, "[EmailProviders] Echec resolution cle organisation");
    sender = null;
  }
  senderCache.set(orgId, { sender, at: Date.now() });
  return sender;
}
