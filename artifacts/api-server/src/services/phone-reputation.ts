// Service de reputation des numeros de telephone via Twilio Lookup v2.
//
// Utilise les memes identifiants Twilio que la telephonie / les notifications
// WhatsApp (table telephony_providers, config par org). Best-effort et
// GRACIEUX: si le numero est invalide, si le compte Twilio n'a pas active les
// add-ons (line_type_intelligence / sms_pumping_risk), ou en cas d'erreur
// reseau, on renvoie un verdict "unknown" sans jamais lever d'exception.
//
// Niveaux de risque retournes:
//   - low      : numero valide, type de ligne normal
//   - medium   : type de ligne a risque (VoIP) ou signaux faibles
//   - high     : score de risque eleve (sms pumping) signale par Twilio
//   - unknown  : impossible de determiner (pas de creds / add-on / erreur)

import { and, eq } from "drizzle-orm";
import { db, telephonyProvidersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { decryptProviderConfig } from "./telephony-providers";
import { normalizePhone } from "./security-lists";

export type PhoneRisk = "low" | "medium" | "high" | "unknown";

export interface PhoneReputationResult {
  phoneNumber: string;
  valid: boolean;
  risk: PhoneRisk;
  /** Type de ligne (mobile, landline, voip...) si disponible. */
  lineType?: string;
  /** Score de risque brut 0-100 (sms pumping) si disponible. */
  riskScore?: number;
  /** Raisons lisibles du verdict. */
  reasons: string[];
}

interface TwilioCreds {
  accountSid?: string;
  authToken?: string;
}

async function loadTwilioCreds(orgId: number): Promise<TwilioCreds | null> {
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
  const cfg = decryptProviderConfig("twilio", (p.config as Record<string, any>) ?? {}) as TwilioCreds;
  if (!cfg?.accountSid || !cfg?.authToken) return null;
  return cfg;
}

interface LookupV2Response {
  valid?: boolean;
  line_type_intelligence?: { type?: string; error_code?: number | null } | null;
  sms_pumping_risk?: { carrier_risk_category?: string; sms_pumping_risk_score?: number; error_code?: number | null } | null;
}

/**
 * Evalue la reputation d'un numero. fail-soft: renvoie toujours un resultat.
 *
 * On demande deux champs Twilio Lookup (line_type_intelligence +
 * sms_pumping_risk). Ce sont des add-ons potentiellement payants; s'ils ne
 * sont pas actives, Twilio renvoie quand meme la validation de base et un
 * error_code par champ -> on degrade proprement.
 */
export async function evaluatePhoneReputation(
  orgId: number,
  rawNumber: string,
): Promise<PhoneReputationResult> {
  const phoneNumber = normalizePhone(rawNumber);
  const fallback: PhoneReputationResult = {
    phoneNumber,
    valid: false,
    risk: "unknown",
    reasons: [],
  };

  try {
    const creds = await loadTwilioCreds(orgId);
    if (!creds?.accountSid || !creds?.authToken) {
      return { ...fallback, reasons: ["Twilio non configure pour cette organisation"] };
    }

    const url =
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phoneNumber)}` +
      `?Fields=line_type_intelligence,sms_pumping_risk`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: "Basic " + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64"),
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    if (!resp.ok) {
      // 404 = numero invalide; autre = probleme creds/quota.
      if (resp.status === 404) {
        return { ...fallback, valid: false, risk: "high", reasons: ["Numero invalide ou inexistant"] };
      }
      logger.warn({ orgId, status: resp.status }, "[phone-reputation] echec Lookup Twilio");
      return { ...fallback, reasons: ["Verification indisponible"] };
    }

    const data = (await resp.json()) as LookupV2Response;
    const reasons: string[] = [];
    const valid = data.valid !== false;
    if (!valid) {
      return { phoneNumber, valid: false, risk: "high", reasons: ["Numero invalide"] };
    }

    let risk: PhoneRisk = "low";
    let lineType: string | undefined;
    let riskScore: number | undefined;

    const lti = data.line_type_intelligence;
    if (lti && !lti.error_code && lti.type) {
      lineType = lti.type;
      if (lti.type === "voip" || lti.type === "nonFixedVoip") {
        risk = "medium";
        reasons.push("Ligne VoIP (souvent utilisee pour le spam/arnaque)");
      }
    }

    const spr = data.sms_pumping_risk;
    if (spr && !spr.error_code && typeof spr.sms_pumping_risk_score === "number") {
      riskScore = spr.sms_pumping_risk_score;
      if (riskScore >= 75) {
        risk = "high";
        reasons.push(`Score de risque eleve (${riskScore}/100)`);
      } else if (riskScore >= 40) {
        if (risk === "low") risk = "medium";
        reasons.push(`Score de risque modere (${riskScore}/100)`);
      }
      if (spr.carrier_risk_category === "high") {
        risk = "high";
        reasons.push("Operateur a risque eleve");
      }
    }

    if (reasons.length === 0) reasons.push("Aucun signal de risque detecte");

    return { phoneNumber, valid, risk, lineType, riskScore, reasons };
  } catch (err) {
    logger.warn({ err, orgId }, "[phone-reputation] exception");
    return { ...fallback, reasons: ["Verification indisponible"] };
  }
}

/** Libelle court FR pour un niveau de risque (notifications WhatsApp). */
export function phoneRiskLabel(risk: PhoneRisk): string {
  switch (risk) {
    case "low": return "fiable";
    case "medium": return "a verifier";
    case "high": return "RISQUE ELEVE";
    default: return "inconnu";
  }
}
