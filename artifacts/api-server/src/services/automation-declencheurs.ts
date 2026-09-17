/**
 * Declencheurs et cadences reconnus par le moteur d'automatisation.
 *
 * Mesure le 17/09 : l'ecran proposait « Nouveau projet cree » (projet_created),
 * que le moteur ne connaissait pas. Son `default` renvoyait un element factice,
 * donc la regle executait ses actions A CHAQUE passage, sans qu'aucun projet
 * n'ait ete cree — notifications en boucle, et propositions d'e-mail ou de SMS
 * en file d'attente. Rien ne validait non plus le declencheur ni la cadence a
 * la creation d'une regle : une valeur inventee etait acceptee.
 */

export const DECLENCHEURS = [
  "schedule",
  "missed_call",
  "contact_no_activity",
  "task_overdue",
  "projet_overdue",
  "projet_created",
] as const;

export const CADENCES = ["5min", "15min", "30min", "1h", "6h", "12h", "24h"] as const;

export const ACTIONS = ["send_notification", "create_task", "send_sms", "send_email"] as const;

export type Declencheur = (typeof DECLENCHEURS)[number];

export function declencheurConnu(v: unknown): v is Declencheur {
  return typeof v === "string" && (DECLENCHEURS as readonly string[]).includes(v);
}
export function cadenceConnue(v: unknown): boolean {
  return typeof v === "string" && (CADENCES as readonly string[]).includes(v);
}

export type ActionsLues = { ok: true; actions: Array<{ type: string; params?: Record<string, unknown> }> } | { ok: false; erreur: string };

/** Les actions d'une regle : liste non vide, types connus, parametres objets. */
export function lireActions(saisie: unknown): ActionsLues {
  if (!Array.isArray(saisie) || saisie.length === 0) return { ok: false, erreur: "Au moins une action est requise." };
  if (saisie.length > 10) return { ok: false, erreur: "Dix actions au maximum par regle." };
  const actions: Array<{ type: string; params?: Record<string, unknown> }> = [];
  for (const a of saisie) {
    if (!a || typeof a !== "object" || Array.isArray(a)) return { ok: false, erreur: "Action invalide." };
    const type = (a as Record<string, unknown>).type;
    if (typeof type !== "string" || !(ACTIONS as readonly string[]).includes(type)) {
      return { ok: false, erreur: `Action inconnue : ${String(type).slice(0, 40)}.` };
    }
    const params = (a as Record<string, unknown>).params;
    if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) {
      return { ok: false, erreur: "Parametres d'action invalides." };
    }
    actions.push({ type, params: params as Record<string, unknown> | undefined });
  }
  return { ok: true, actions };
}
