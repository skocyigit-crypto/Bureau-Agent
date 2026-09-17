/**
 * « Aujourd'hui » dans le fuseau de l'APPAREIL, au format AAAA-MM-JJ.
 *
 * `new Date().toISOString().slice(0, 10)` rend la date UTC : entre minuit et
 * 2h a Paris, un formulaire proposait la veille — date d'encaissement, date de
 * pointage, jour ouvert dans l'agenda. Mesure le 17/09.
 */
export function jourLocal(instant: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${instant.getFullYear()}-${p(instant.getMonth() + 1)}-${p(instant.getDate())}`;
}
