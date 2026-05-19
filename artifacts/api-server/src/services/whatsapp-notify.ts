// Envoi de notifications WhatsApp sortantes via Twilio.
//
// Utilise la meme config Twilio que la telephonie (`telephony_providers`),
// donc aucun setup supplementaire pour les organisations qui ont deja un
// fournisseur Twilio actif. Le `whatsappFromNumber` peut etre stocke dans
// le champ config du provider (override par tenant) ou via la variable
// d'env TWILIO_WHATSAPP_FROM (fallback global, utile pour la sandbox).
//
// L'envoi est fail-soft : toute erreur est logguee mais ne fait jamais
// remonter d'exception au caller (les notifications sont des effets de
// bord non bloquants).

import { and, eq } from "drizzle-orm";
import { db, telephonyProvidersTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";

interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  whatsappFromNumber?: string;
}

/** Verifie si l'utilisateur a opte pour ce type de notification WhatsApp. */
function isOptedIn(prefs: unknown, kind: "task" | "call" | "appointment" | "message"): boolean {
  if (!prefs || typeof prefs !== "object") return false;
  const wa = (prefs as { whatsappNotifications?: Record<string, boolean> }).whatsappNotifications;
  if (!wa || typeof wa !== "object") return false;
  return wa[kind] === true;
}

/** Normalise le numero pour le format Twilio WhatsApp (`whatsapp:+E164`). */
function toWhatsAppAddress(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9+]/g, "");
  if (!cleaned) return null;
  // Heuristique simple : si commence par 0, on assume FR (+33).
  let e164 = cleaned;
  if (cleaned.startsWith("0") && cleaned.length === 10) {
    e164 = "+33" + cleaned.slice(1);
  } else if (!cleaned.startsWith("+")) {
    e164 = "+" + cleaned;
  }
  return `whatsapp:${e164}`;
}

async function loadTwilioConfigForOrg(orgId: number): Promise<TwilioConfig | null> {
  const [p] = await db
    .select({ config: telephonyProvidersTable.config })
    .from(telephonyProvidersTable)
    .where(
      and(
        eq(telephonyProvidersTable.organisationId, orgId),
        eq(telephonyProvidersTable.provider, "twilio"),
        eq(telephonyProvidersTable.isActive, true),
      ),
    )
    .limit(1);
  if (!p) return null;
  return (p.config as TwilioConfig) ?? null;
}

/**
 * Envoie un message WhatsApp a un utilisateur. Fail-soft.
 *
 * @returns true si le message a ete envoye, false sinon (raison loggee).
 */
export async function sendWhatsAppNotification(
  orgId: number,
  userId: number,
  body: string,
  kind: "task" | "call" | "appointment" | "message",
): Promise<boolean> {
  try {
    const [user] = await db
      .select({
        telephone: usersTable.telephone,
        preferences: usersTable.preferences,
        actif: usersTable.actif,
      })
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)));

    if (!user || !user.actif) return false;
    if (!user.telephone) return false;
    if (!isOptedIn(user.preferences, kind)) return false;

    const toAddr = toWhatsAppAddress(user.telephone);
    if (!toAddr) return false;

    const cfg = await loadTwilioConfigForOrg(orgId);
    if (!cfg?.accountSid || !cfg?.authToken) {
      logger.info({ orgId }, "[whatsapp-notify] org sans Twilio actif");
      return false;
    }

    const fromRaw = cfg.whatsappFromNumber || process.env.TWILIO_WHATSAPP_FROM || cfg.fromNumber;
    if (!fromRaw) {
      logger.info({ orgId }, "[whatsapp-notify] aucun fromNumber WhatsApp configure");
      return false;
    }
    const fromAddr = fromRaw.startsWith("whatsapp:") ? fromRaw : `whatsapp:${fromRaw}`;

    const params = new URLSearchParams();
    params.set("To", toAddr);
    params.set("From", fromAddr);
    params.set("Body", body.slice(0, 1500));

    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ orgId, userId, status: resp.status, body: text.slice(0, 200) }, "[whatsapp-notify] echec API Twilio");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, orgId, userId }, "[whatsapp-notify] exception");
    return false;
  }
}
