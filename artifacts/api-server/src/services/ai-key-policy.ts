/**
 * A QUI appartient la cle utilisee pour un appel d'IA.
 *
 * L'etat d'avant: `ai_providers` stocke la cle de chaque organisation, l'ecran
 * existe, le chiffrement existe, et `services/ai-providers.ts` sait meme
 * construire un client avec cette cle — mais un seul fichier de tout le serveur
 * (`ai-stream.ts`) s'en servait. Partout ailleurs, y compris `ai-failover.ts`
 * par ou passe la quasi totalite des appels, le code prenait le singleton de la
 * plateforme et ne consultait `orgId` que pour compter le quota. Autrement dit:
 * un client qui collait sa propre cle continuait a depenser le credit du
 * proprietaire, et la fonction « apportez votre cle » ne changeait rien a la
 * facture.
 *
 * Ce module ne lit ni ne dechiffre aucune cle — c'est `ai-providers.ts` qui le
 * fait, avec son cache et son invalidation deja branchee sur les ecrans de
 * configuration. Deux caches sur la meme table, dont un seul serait vide par
 * l'ecran, ferait servir une cle revoquee pendant des minutes. Ici on repond a
 * une seule question: QUI PAIE cet appel.
 *
 * Regle: chaque organisation paie ses propres appels des qu'elle a une cle. La
 * cle de la plateforme reste permise dans quatre cas:
 *   1. les surfaces publiques (`orgId == null`) — la demo du site vitrine, qui
 *      a deja son propre plafond de depense;
 *   2. l'organisation du proprietaire lui-meme;
 *   3. une liste d'exceptions par variable d'environnement, pour couvrir un
 *      client precis sans redeployer;
 *   4. TANT QUE `AI_REQUIRE_OWN_KEY` n'est pas active: tout le monde.
 *
 * Le point 4 est deliberement le defaut. Basculer d'un coup en « pas de cle,
 * pas d'IA » couperait la fonction a tous les clients existants au premier
 * deploiement — une decision commerciale, pas technique. Ce module rend donc
 * d'abord l'attribution correcte (la cle du client est enfin utilisee), et
 * laisse le proprietaire fermer le robinet quand il l'a decide.
 */
import { logger } from "../lib/logger";
import { getSuperAdminOrgId } from "../lib/super-admin-org";
import { getOrgAiKeyPresence, type AiProviderName } from "./ai-providers";

export type { AiProviderName };

/** Erreur portee jusqu'a l'appelant HTTP, avec de quoi guider l'utilisateur. */
export class AiKeyRequiredError extends Error {
  readonly code = "ai_key_required";
  /** 402: le service existe, il manque un moyen de le payer. */
  readonly status = 402;
  constructor(
    message = "Aucune cle d'IA n'est configuree pour cette organisation. Ajoutez-la dans Parametres › Fournisseurs d'IA.",
  ) {
    super(message);
    this.name = "AiKeyRequiredError";
  }
}

export interface AiAccess {
  /** `own` = cle du client, `platform` = credit du proprietaire. */
  source: "own" | "platform";
  /**
   * L'organisation dont la cle doit servir, ou `null` pour « singleton
   * plateforme ». C'est cette valeur, et non `orgId`, qu'il faut passer aux
   * constructeurs de clients: elle porte la decision, pas seulement l'identite.
   */
  payerOrgId: number | null;
  /** Fournisseurs pour lesquels l'organisation a une cle propre. */
  providers: Partial<Record<AiProviderName, boolean>>;
  /** Pourquoi la plateforme paie, quand c'est le cas. */
  platformReason?: "public-surface" | "owner-organisation" | "allowlisted" | "enforcement-off";
}

const PUBLIC_SURFACE: AiAccess = {
  source: "platform",
  payerOrgId: null,
  providers: {},
  platformReason: "public-surface",
};

/** Organisations autorisees a consommer le credit de la plateforme. */
function allowlistedOrgIds(): Set<number> {
  const raw = process.env.AI_PLATFORM_KEY_ORG_IDS ?? "";
  return new Set(
    raw.split(",").map((v) => Number(v.trim())).filter((n) => Number.isInteger(n) && n > 0),
  );
}

/** Le refus est opt-in (voir l'en-tete): sans ce reglage, la plateforme paie. */
export function ownKeyRequired(): boolean {
  return process.env.AI_REQUIRE_OWN_KEY === "true";
}

/**
 * Decide quelle cle utilisera cet appel. Leve `AiKeyRequiredError` si
 * l'organisation doit apporter la sienne et ne l'a pas fait.
 *
 * `orgId == null` est un choix EXPLICITE de l'appelant (surface publique, sonde
 * de sante), a ne pas confondre avec « je ne sais pas »: un appel qui a perdu
 * son organisation en route doit etre corrige, pas facture au proprietaire en
 * silence.
 */
export async function resolveAiAccess(orgId: number | null | undefined): Promise<AiAccess> {
  if (orgId == null) return PUBLIC_SURFACE;

  let providers: Partial<Record<AiProviderName, boolean>> = {};
  try {
    const presence = await getOrgAiKeyPresence(orgId);
    providers = presence;
    if (presence.gemini || presence.openai || presence.anthropic) {
      return { source: "own", payerOrgId: orgId, providers: presence };
    }
  } catch (err) {
    // Base injoignable: ne pas transformer une panne d'infrastructure en
    // « ce client n'a pas de cle ». On retombe sur la plateforme, en trace.
    logger.warn({ err, orgId }, "[ai-key-policy] lecture des cles impossible, repli plateforme");
    return { source: "platform", payerOrgId: null, providers: {}, platformReason: "allowlisted" };
  }

  let reason: AiAccess["platformReason"] | null = null;
  if (orgId === (await getSuperAdminOrgId())) reason = "owner-organisation";
  else if (allowlistedOrgIds().has(orgId)) reason = "allowlisted";
  else if (!ownKeyRequired()) reason = "enforcement-off";

  if (reason) return { source: "platform", payerOrgId: null, providers, platformReason: reason };

  throw new AiKeyRequiredError();
}

/** Etat lisible par l'interface, pour guider le client sans le bloquer sans explication. */
export async function getAiKeyStatus(orgId: number): Promise<{
  configured: boolean;
  providers: AiProviderName[];
  usesPlatformCredit: boolean;
  platformReason: AiAccess["platformReason"] | null;
  enforced: boolean;
}> {
  const enforced = ownKeyRequired();
  try {
    const access = await resolveAiAccess(orgId);
    return {
      configured: access.source === "own",
      providers: (Object.keys(access.providers) as AiProviderName[])
        .filter((p) => access.providers[p]),
      usesPlatformCredit: access.source === "platform",
      platformReason: access.platformReason ?? null,
      enforced,
    };
  } catch (err) {
    if (err instanceof AiKeyRequiredError) {
      return { configured: false, providers: [], usesPlatformCredit: false, platformReason: null, enforced };
    }
    throw err;
  }
}
