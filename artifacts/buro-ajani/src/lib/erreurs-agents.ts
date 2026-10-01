/**
 * Erreurs de l'API des agents (profils, essai, assistant) rendues dans la
 * langue de l'ecran.
 *
 * Pourquoi : le serveur renvoie un `code` stable (quota_ia, profil_role,
 * profil_desactive, action_anterieure_profils...) ET un message francais.
 * Afficher le message tel quel faisait lire du francais en turc ou en arabe ;
 * on traduit le code, et le message du serveur ne sert que de repli pour un
 * code que l'ecran ne connait pas encore.
 */
import type { TFunction } from "@/i18n";

export class ErreurApi extends Error {
  constructor(message: string, readonly code: string | undefined, readonly status: number) {
    super(message);
  }
}

/** Corps JSON d'une reponse ; leve une ErreurApi (code + statut) si elle a echoue. */
export async function lireJsonAgents(r: Response): Promise<unknown> {
  const corps = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!r.ok) throw new ErreurApi(corps.error || `HTTP ${r.status}`, corps.code, r.status);
  return corps;
}

/** Traduction d'une cle, ou le texte de repli (francais du serveur) si la cle manque. */
export function traduireOuRepli(t: TFunction, cle: string, repli: string): string {
  const v = t(cle);
  return v === cle ? repli : v;
}

/** Message traduit pour un code d'erreur ; repli : message serveur, puis message generique. */
export function messageErreurAgent(t: TFunction, code: string | undefined, repli: string | undefined, status?: number): string {
  if (code) {
    const cle = `agentErrors.${code}`;
    const v = t(cle);
    if (v !== cle) return v;
  }
  if (repli) return repli;
  return t("agentErrors.generic", { status: status ?? 0 });
}

export function messageDeErreur(t: TFunction, e: unknown): string {
  if (e instanceof ErreurApi) return messageErreurAgent(t, e.code, e.message, e.status);
  return e instanceof Error ? e.message : String(e);
}
