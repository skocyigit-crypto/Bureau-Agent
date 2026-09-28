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

/**
 * Une date ECRITE POUR UN HUMAIN, dans le fuseau de l-entreprise.
 *
 * `toLocaleDateString("fr-FR")` sans fuseau est pire que `toISOString` : il
 * prend celui de la MACHINE. Juste sur le poste du developpeur, faux dans un
 * conteneur qui tourne en UTC — et c-est le conteneur qui envoie les courriels.
 * Une echeance enregistree a 23h30 a Paris s-affichait alors la veille.
 * (Piege signale par la session Assise, 24/09/2026.)
 */
export function dateHumaine(
  instant: Date,
  langue: string = "fr-FR",
  fuseau: string = FUSEAU_ENTREPRISE,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" },
): string {
  return new Intl.DateTimeFormat(langue, { ...options, timeZone: fuseau }).format(instant);
}

/**
 * Une date de validite designe un JOUR, et vaut jusqu-a la fin de ce jour.
 *
 * `new Date("2026-09-30")` rend minuit UTC, soit 2 h du matin a Paris. Compare
 * telle quelle a l-instant present, une validite « jusqu-au 30/09 » expirait
 * donc le 30 a 2 h : le dernier jour etait perdu en entier. Sur un devis, ce
 * jour-la est celui ou le client se decide ; sur une echeance de facture,
 * c-est celui ou il paie — et la relance partait avant terme.
 *
 * Cette fonction rend l-instant ou ce jour-la se termine dans le fuseau de
 * l-entreprise. On compare des instants, on ne recrit pas ce qui est stocke :
 * les lignes deja enregistrees se lisent correctement sans migration.
 */
export function finDeJournee(jour: Date, fuseau: string = FUSEAU_ENTREPRISE): Date {
  const [a, m, j] = jourLocal(jour, fuseau).split("-").map(Number) as [number, number, number];
  // Minuit du LENDEMAIN dans ce fuseau, moins une milliseconde. L-ecart au
  // temps universel se mesure sur la journee visee, jamais sur aujourd-hui :
  // un changement d-heure entre les deux fausserait le calcul.
  const midiUtc = Date.UTC(a, m - 1, j, 12);
  const ecart = new Date(midiUtc).getTime() - new Date(new Intl.DateTimeFormat("sv-SE", {
    timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(midiUtc)).replace(" ", "T") + "Z").getTime();
  return new Date(Date.UTC(a, m - 1, j + 1) + ecart - 1);
}

/**
 * Bornes [debut, fin[ du jour local qui contient `instant`.
 *
 * `DATE(col) = CURRENT_DATE` compare dans le fuseau de la SESSION Postgres —
 * UTC en production (la connexion ne le fixe pas) : entre minuit et 2 h a
 * Paris (1 h en hiver), « aujourd'hui » y designe encore HIER. Les appels du
 * jour, les rendez-vous du jour et le briefing vocal comptaient alors ceux de
 * la veille. Comparer l'horodatage a ces deux instants est juste quel que soit
 * le fuseau de la session et la nature de la colonne (avec ou sans fuseau),
 * et garde son index utilisable. 23 h ou 25 h les jours de changement d'heure.
 * (Piege signale par la session Assise, 28/09/2026.)
 */
export function bornesDuJour(instant: Date = new Date(), fuseau: string = FUSEAU_ENTREPRISE): { debut: Date; fin: Date } {
  const [a, m, j] = jourLocal(instant, fuseau).split("-").map(Number) as [number, number, number];
  // Midi UTC tombe le meme jour calendaire a Paris : finDeJournee y mesure
  // l'ecart du jour vise, pas celui d'aujourd'hui.
  const veille = new Date(Date.UTC(a, m - 1, j - 1, 12));
  const jour = new Date(Date.UTC(a, m - 1, j, 12));
  return {
    debut: new Date(finDeJournee(veille, fuseau).getTime() + 1),
    fin: new Date(finDeJournee(jour, fuseau).getTime() + 1),
  };
}
