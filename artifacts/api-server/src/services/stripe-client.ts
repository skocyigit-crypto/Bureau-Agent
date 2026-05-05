import Stripe from "stripe";
import { logger } from "../lib/logger";

let cached: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe | null {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    cached = new Stripe(key);
    logger.info("[stripe] client initialised (mode=" + (key.startsWith("sk_live_") ? "live" : "test") + ")");
    return cached;
  } catch (err) {
    logger.error({ err }, "[stripe] failed to initialise client");
    return null;
  }
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
