// Charge les signaux de securite d'une organisation pour alimenter
// computeSecurityScore. Centralise ici afin que la route GET /security/score
// ET le cron hebdomadaire resolvent EXACTEMENT les memes donnees (pas de drift).
//
// Semantique fail-soft: si une lecture echoue, on retourne un etat "unknown"
// (tri-state) plutot qu'une valeur penalisante — voir computeSecurityScore.

import { db, telephonyProvidersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { listSecurityEntries } from "./security-lists";
import { getRecentSecurityScans } from "./security-scans";
import { isSafeBrowsingConfigured } from "./url-safety";
import type { SecurityScoreInput, FraudProtectionState, CustomListsState } from "./security-score";

interface LoaderLogger {
  warn: (obj: unknown, msg?: string) => void;
}

export async function loadSecurityScoreInput(
  orgId: number,
  log?: LoaderLogger,
): Promise<SecurityScoreInput> {
  // Protection appels frauduleux: config.fraudAction du fournisseur Twilio par
  // defaut. L'ordre (isDefault, isActive, id) doit refleter la selection runtime
  // (getDefaultTwilioProviderRow) pour que score et reglage pointent le meme row.
  let fraudProtection: FraudProtectionState = "unknown";
  try {
    const [provider] = await db
      .select({ config: telephonyProvidersTable.config })
      .from(telephonyProvidersTable)
      .where(and(
        eq(telephonyProvidersTable.organisationId, orgId),
        eq(telephonyProvidersTable.provider, "twilio"),
      ))
      .orderBy(
        desc(telephonyProvidersTable.isDefault),
        desc(telephonyProvidersTable.isActive),
        desc(telephonyProvidersTable.id),
      )
      .limit(1);
    if (provider) {
      const action = (provider.config as Record<string, any>)?.fraudAction;
      fraudProtection =
        action === "voicemail" || action === "reject" || action === "off" ? action : "off";
    } else {
      fraudProtection = "off";
    }
  } catch (err: any) {
    log?.warn({ err, orgId }, "Score securite: lecture protection appels echouee (non-bloquant)");
  }

  let customLists: CustomListsState = "unknown";
  try {
    customLists = (await listSecurityEntries(orgId)).length > 0 ? "present" : "absent";
  } catch (err: any) {
    log?.warn({ err, orgId }, "Score securite: lecture listes echouee (non-bloquant)");
  }

  const recentScans = getRecentSecurityScans(orgId, 200).map((s) => ({
    verdict: s.verdict,
    at: s.at,
  }));

  return {
    safeBrowsingConfigured: isSafeBrowsingConfigured(),
    fraudProtection,
    customLists,
    recentScans,
  };
}
