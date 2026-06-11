import Stripe from "stripe";
import { logger } from "../lib/logger";

type StripeCredentials = { secretKey: string; webhookSecret?: string };

// Credentials come from one of two sources, in this order of precedence:
//   1. Environment variables (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET) — explicit
//      config always wins. This keeps the app portable (self-hosting / Docker / PM2)
//      and lets tests inject deterministic dummy keys without any network call.
//   2. The Replit-managed Stripe connection (credential proxy) — used automatically
//      when no env key is set, so "connect Stripe via Replit" works with zero manual
//      secret entry.
// The resolved Stripe *secret key* is a stable Stripe API key (it does not rotate per
// request — only the Replit identity token used to FETCH it does, and that is read
// fresh from process.env each time), so we cache the resolved credentials for a short
// TTL to avoid hitting the connector proxy on every billing call / status poll.
const CRED_TTL_MS = 5 * 60_000;
let credCache: { creds: StripeCredentials; at: number } | null = null;
let cachedClient: { stripe: Stripe; key: string } | null = null;

async function fetchConnectorCredentials(): Promise<StripeCredentials | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname || !xReplitToken) return null;
  try {
    const resp = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
      {
        headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "[stripe] connector credential fetch failed");
      return null;
    }
    const data = (await resp.json()) as {
      items?: Array<{
        settings?: { secret?: string; secret_key?: string; webhook_secret?: string };
      }>;
    };
    const settings = data.items?.[0]?.settings;
    // The Replit-managed Stripe connection exposes the API secret key under
    // `secret` (older templates used `secret_key`); accept either. It does NOT
    // provide a webhook signing secret — that comes from env or is provisioned
    // separately (see getStripeWebhookSecret / STRIPE_WEBHOOK_SECRET).
    const secretKey = settings?.secret ?? settings?.secret_key;
    if (!secretKey) return null;
    return { secretKey, webhookSecret: settings?.webhook_secret };
  } catch (err) {
    logger.warn({ err }, "[stripe] connector credential fetch error");
    return null;
  }
}

async function resolveCredentials(): Promise<StripeCredentials | null> {
  if (credCache && Date.now() - credCache.at < CRED_TTL_MS) return credCache.creds;
  // 1. Explicit env config wins.
  const envKey = process.env.STRIPE_SECRET_KEY;
  if (envKey) {
    const creds: StripeCredentials = { secretKey: envKey, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET };
    credCache = { creds, at: Date.now() };
    return creds;
  }
  // 2. Replit-managed Stripe connection.
  const fromConnector = await fetchConnectorCredentials();
  if (fromConnector) {
    credCache = { creds: fromConnector, at: Date.now() };
    return fromConnector;
  }
  // Don't cache "not configured" — a transient proxy error shouldn't pin us to 503.
  return null;
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
