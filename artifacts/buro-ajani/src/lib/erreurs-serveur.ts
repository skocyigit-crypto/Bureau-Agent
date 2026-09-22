import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

/**
 * Erreurs de validation renvoyees par le SERVEUR, rattachees a leur champ
 * (RGAA 11.10 / WCAG 3.3.1).
 *
 * Quand l'API refuse une saisie, elle dit deja quel champ est en cause :
 * `{ error, issues: [{ path, message }] }` (lib/zod-error cote serveur). Les
 * formulaires jetaient cette information et affichaient un message general
 * (« la creation a echoue »). La personne devait deviner quel champ corriger.
 *
 * Ici, chaque probleme connu du formulaire devient une erreur de champ :
 * react-hook-form et les composants `Form` posent alors `aria-invalid`, relient
 * le message au champ (`aria-describedby`) et l'affichent sous lui ; le premier
 * champ en faute recoit le focus. Le message general reste affiche en plus.
 *
 * Rend le nombre de champs signales (0 si l'erreur ne designe aucun champ du
 * formulaire : doublon, droit insuffisant, panne).
 */
export function appliquerErreursServeur<T extends FieldValues>(err: unknown, form: UseFormReturn<T>): number {
  const donnees = (err as { data?: unknown } | null)?.data as { issues?: unknown } | null | undefined;
  const issues = Array.isArray(donnees?.issues) ? (donnees!.issues as Array<{ path?: unknown; message?: unknown }>) : [];
  const champs = new Set(Object.keys(form.getValues() ?? {}));
  let n = 0;
  for (const i of issues) {
    if (typeof i.path !== "string" || typeof i.message !== "string") continue;
    const nom = i.path.split(".")[0]!;
    if (!champs.has(nom)) continue;
    form.setError(nom as Path<T>, { type: "server", message: i.message }, { shouldFocus: n === 0 });
    n++;
  }
  return n;
}
