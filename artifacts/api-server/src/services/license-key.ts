import crypto from "crypto";
import { db, subscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const PLAN_PREFIX_MAP: Record<string, string> = {
  essai: "ESS",
  starter: "STA",
  professionnel: "PRO",
  entreprise: "ENT",
};

const LICENSE_KEY_REGEX = /^ADB-[A-Z]{2,3}-[0-9A-F]{16}$/;

function buildKey(plan: string): string {
  const planLower = String(plan || "").toLowerCase().trim();
  const prefix = PLAN_PREFIX_MAP[planLower] || planLower.toUpperCase().substring(0, 3) || "GEN";
  const random = crypto.randomBytes(8).toString("hex").toUpperCase();
  return `ADB-${prefix}-${random}`;
}

export function generateLicenseKey(plan: string): string {
  return buildKey(plan);
}

export function isValidLicenseKey(key: unknown): boolean {
  return typeof key === "string" && LICENSE_KEY_REGEX.test(key);
}

export async function generateUniqueLicenseKey(plan: string, maxAttempts = 5): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = buildKey(plan);
    const [existing] = await db
      .select({ id: subscriptionsTable.id })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.licenseKey, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  throw new Error("Impossible de generer une cle de licence unique apres plusieurs tentatives");
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "23505") return true;
  return typeof e.message === "string" && e.message.includes("license_key");
}

export async function withLicenseKeyRetry<T>(plan: string, fn: (key: string) => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 0; i < maxAttempts; i++) {
    const key = await generateUniqueLicenseKey(plan);
    try {
      return await fn(key);
    } catch (err) {
      lastErr = err;
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw lastErr ?? new Error("Conflit de cle de licence apres plusieurs tentatives");
}
