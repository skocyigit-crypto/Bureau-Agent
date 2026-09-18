/**
 * Quels chemins /api/ai consomment vraiment le budget IA.
 *
 * Mesure le 18/09 sur le banc local : `app.use("/api/ai", aiLimiter)` couvrait
 * TOUT le prefixe, y compris des lectures qui n'appellent aucun modele —
 * l'etat d'une analyse en cours, la liste des rapports deja produits, la
 * configuration, et `/ai/recognize` qui n'est que dix-sept requetes SQL malgre
 * son nom. Vingt lectures d'etat suffisaient a epuiser les 15 appels/minute :
 * le client naviguait dans l'application, puis l'assistant lui repondait
 * « Limite d'analyse IA atteinte » alors qu'il n'avait rien demande a l'IA.
 *
 * Ces chemins restent bornes par le limiteur general (1000 / 15 min) et par
 * les quotas d'organisation : ce n'est pas une porte ouverte, c'est le bon
 * compteur.
 */

/** Chemins (sous /api/ai) qui ne declenchent aucun appel de modele. */
const LECTURES_SANS_MODELE: readonly RegExp[] = [
  /^\/recognize\/?$/,
  /^\/agents\/run\/status\/?$/,
  /^\/agents\/reports(\/[0-9]+)?\/?$/,
  /^\/agents\/latest\/?$/,
  /^\/agents\/config\/?$/,
  /^\/autopilot\/(status|logs)\/?$/,
  /^\/super-agent\/status\/?$/,
  /^\/inline-suggest\/metrics\/?$/,
  /^\/anomalies\/?$/,
  /^\/usage(\/.*)?$/,
];

/**
 * Vrai si le chemin appelle un modele et doit donc passer par le limiteur IA.
 * `chemin` est relatif au point de montage (`req.path` sous /api/ai).
 */
export function consommeBudgetIa(methode: string, chemin: string): boolean {
  if (methode === "OPTIONS" || methode === "HEAD") return false;
  return !LECTURES_SANS_MODELE.some((motif) => motif.test(chemin));
}
