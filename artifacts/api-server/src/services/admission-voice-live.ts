/**
 * Qui peut ouvrir une session Voice Live, et ce qu'elle peut faire.
 *
 * Mesure du 29/09 : la WebSocket `/api/voice/live` est branchee sur l'upgrade
 * HTTP, HORS de la chaine Express. Elle ne verifiait que l'origine et la
 * presence d'une session. Donc :
 *   - aucun controle de role : un compte `lecture_seule` recevait les 36
 *     outils et pouvait approuver a la voix un `send_email` ou un
 *     `delete_call` — ce que `requireMutationRole` lui interdit partout en HTTP ;
 *   - aucun controle de licence : un abonnement suspendu ou un plan sans IA
 *     ouvrait quand meme une session (payee au fournisseur) ;
 *   - aucun quota IA, aucune consommation enregistree.
 *
 * Les regles sont celles de l'HTTP, appliquees ici une fois, a l'ouverture :
 *   - un role inconnu est refuse ;
 *   - la licence est verifiee comme pour une ECRITURE (la session peut ecrire) ;
 *   - le quota IA de l'organisation doit etre disponible ;
 *   - un role qui n'ecrit pas ne recoit que les outils de lecture, et ne peut
 *     rien approuver.
 */
import { checkLicense } from "../middleware/license-check";
import { AiQuotaExceededError, assertAiQuota } from "./ai-quota";
import { getGeminiToolDeclarations, getTool } from "./assistant-tools";
import { PROFIL_ASSISTANT } from "./profils-agents";

/** Meme plancher que `requireMutationRole("super_admin", "administrateur", "agent")`. */
const ROLES_QUI_ECRIVENT = new Set(["agent", "administrateur", "super_admin"]);
const ROLES_CONNUS = new Set([...ROLES_QUI_ECRIVENT, "lecture_seule"]);

export function peutEcrire(role: string | undefined): boolean {
  return !!role && ROLES_QUI_ECRIVENT.has(role);
}

export type Admission =
  | { ok: true }
  | { ok: false; statut: 403 | 429 | 503; raison: string };

export interface DependancesAdmission {
  checkLicense: typeof checkLicense;
  assertAiQuota: typeof assertAiQuota;
}

export async function admettreVoiceLive(
  s: { organisationId: number; userRole?: string },
  deps: DependancesAdmission = { checkLicense, assertAiQuota },
): Promise<Admission> {
  if (!s.userRole || !ROLES_CONNUS.has(s.userRole)) return { ok: false, statut: 403, raison: "role" };
  if (s.userRole !== "super_admin") {
    try {
      const licence = await deps.checkLicense(s.organisationId, "POST", "/api/voice/live");
      if (!licence.allowed) return { ok: false, statut: 403, raison: licence.reason ?? "licence" };
    } catch {
      return { ok: false, statut: 503, raison: "licence_indisponible" };
    }
  }
  try {
    await deps.assertAiQuota(s.organisationId);
  } catch (err) {
    if (err instanceof AiQuotaExceededError) return { ok: false, statut: 429, raison: "quota_ia" };
    return { ok: false, statut: 503, raison: "quota_indisponible" };
  }
  return { ok: true };
}

/**
 * Les outils proposes au modele : ceux de l'assistant universel restreint
 * (services/profils-agents.ts) pour qui ecrit, leurs lectures sinon. La
 * session vocale n'a pas de profil metier : elle est l'assistant universel.
 */
export function declarationsPourRole(role: string | undefined) {
  const toutes = getGeminiToolDeclarations(PROFIL_ASSISTANT).functionDeclarations ?? [];
  if (peutEcrire(role)) return toutes;
  // `requiresConfirmation` est ABSENT (pas `false`) sur les outils de lecture.
  return toutes.filter((d) => {
    const outil = d.name ? getTool(d.name) : undefined;
    return !!outil && !outil.requiresConfirmation;
  });
}

/**
 * Consommation d'une session : une ligne par tour. Le serveur Live envoie
 * `usageMetadata` avec ses reponses ; on garde la DERNIERE vue dans le tour
 * et on l'inscrit a la fin du tour (ou a la fermeture). Additionner chaque
 * message compterait plusieurs fois un meme tour.
 */
export class CompteurConsommation {
  private dernier: { entree: number; sortie: number } | null = null;
  constructor(private readonly inscrire: (entree: number, sortie: number) => void) {}
  vu(um: { promptTokenCount?: number; responseTokenCount?: number; totalTokenCount?: number } | undefined): void {
    if (!um) return;
    const entree = um.promptTokenCount ?? 0;
    const sortie = um.responseTokenCount ?? Math.max(0, (um.totalTokenCount ?? 0) - entree);
    if (entree + sortie > 0) this.dernier = { entree, sortie };
  }
  finDeTour(): void {
    if (!this.dernier) return;
    this.inscrire(this.dernier.entree, this.dernier.sortie);
    this.dernier = null;
  }
}
