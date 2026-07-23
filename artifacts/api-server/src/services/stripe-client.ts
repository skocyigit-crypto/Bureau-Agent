import Stripe from "stripe";
import { logger } from "../lib/logger";

type StripeCredentials = { secretKey: string; webhookSecret?: string };

// Credentials come from the environment only: STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET. This keeps the app portable (Cloud Run, Docker,
// self-hosting) and lets tests inject dummy keys without any network call.
//
// The Stripe client itself is cached and rebuilt only when the key changes, so
// rotating the key takes effect on the next call without a restart.
let cachedClient: { stripe: Stripe; key: string } | null = null;

/**
 * Stripe credentials come from the environment, and only from there.
 *
 * A second source existed: a Replit-managed connection fetched over
 * REPLIT_CONNECTORS_HOSTNAME. It could never work here — the app runs on Cloud
 * Run, where those variables are unset — and it was broken regardless: the auth
 * header was sent as `X_REPLIT_TOKEN` instead of `X-Replit-Token`, so even on
 * Replit the request would have been rejected. Removed along with its cache.
 */
async function resolveCredentials(): Promise<StripeCredentials | null> {
  // Read on EVERY call (env reads are free), so rotating or removing the key
  // takes effect immediately rather than being masked by a cached value.
  const envKey = process.env.STRIPE_SECRET_KEY;
  if (!envKey) return null;
  return { secretKey: envKey, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET };
}

export async function isStripeConfigured(): Promise<boolean> {
  return (await resolveCredentials()) !== null;
}

export async function getStripeClient(): Promise<Stripe | null> {
  const creds = await resolveCredentials();
  if (!creds) return null;
  if (cachedClient && cachedClient.key === creds.secretKey) return cachedClient.stripe;
  try {
    const stripe = new Stripe(creds.secretKey);
    cachedClient = { stripe, key: creds.secretKey };
    logger.info(
      "[stripe] client initialised (mode=" +
        (creds.secretKey.startsWith("sk_live_") ? "live" : "test") +
        ")",
    );
    return stripe;
  } catch (err) {
    logger.error({ err }, "[stripe] failed to initialise client");
    return null;
  }
}

export async function getStripeWebhookSecret(): Promise<string | null> {
  const creds = await resolveCredentials();
  return creds?.webhookSecret ?? null;
}

export function getPriceIdForPlan(plan: string): string | null {
  const map: Record<string, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER,
    professionnel: process.env.STRIPE_PRICE_PROFESSIONNEL,
    entreprise: process.env.STRIPE_PRICE_ENTREPRISE,
  };
  return map[plan] ?? null;
}

export function getPlanForPriceId(priceId: string): string | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === process.env.STRIPE_PRICE_PROFESSIONNEL) return "professionnel";
  if (priceId === process.env.STRIPE_PRICE_ENTREPRISE) return "entreprise";
  return null;
}

export function getPublicAppUrl(): string {
  return (
    process.env.PUBLIC_URL ||
    process.env.APP_URL ||
    `https://${process.env.REPLIT_DEV_DOMAIN || "agentdebureau.fr"}`
  );
}
