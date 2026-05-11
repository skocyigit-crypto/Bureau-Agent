import crypto from "crypto";

const PLAN_PREFIX_MAP: Record<string, string> = {
  essai: "ESS",
  starter: "STA",
  professionnel: "PRO",
  entreprise: "ENT",
};

export function generateLicenseKey(plan: string): string {
  const planLower = String(plan || "").toLowerCase().trim();
  const prefix = PLAN_PREFIX_MAP[planLower] || planLower.toUpperCase().substring(0, 3) || "GEN";
  const random = crypto.randomBytes(8).toString("hex").toUpperCase();
  return `ADB-${prefix}-${random}`;
}
