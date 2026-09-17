/**
 * « Aujourd'hui » pour l'entreprise, pas pour Greenwich.
 *
 * `new Date().toISOString().slice(0, 10)` rend la date UTC : entre minuit et
 * 2h a Paris (1h en hiver), elle designe HIER. Mesure le 17/09 : 6 usages cote
 * serveur (rapports des agents IA, prochain jour ferie...), et autant dans le
 * web et le mobile (date d'encaissement par defaut, pointage, agenda).
 */
export const FUSEAU_ENTREPRISE = "Europe/Paris";

/** Date calendaire AAAA-MM-JJ dans le fuseau donne. */
export function jourLocal(instant: Date = new Date(), fuseau: string = FUSEAU_ENTREPRISE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}
