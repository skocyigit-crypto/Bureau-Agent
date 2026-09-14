/**
 * Ce qu'un fichier peut REELLEMENT peser, de bout en bout.
 *
 * Trois plafonds se superposent, et ils ne se parlaient pas:
 *
 *   1. la taille annoncee a l'utilisateur       (« 25 Mo »)
 *   2. la limite du lecteur de corps JSON       (`express.json({ limit })`)
 *   3. la limite de requete de Cloud Run        (32 Mio, non negociable)
 *
 * Quand le fichier voyage en base64 dans du JSON — ce que fait l'analyse de
 * document — il enfle d'un tiers. Un fichier de 25 Mo produit donc un corps de
 * ~33,3 Mo, alors que la route n'en acceptait que 15. Resultat: tout fichier
 * au-dela d'environ 11 Mo etait refuse par le lecteur de corps, AVANT que le
 * message « Le fichier depasse la taille maximale de 25 Mo » n'ait la moindre
 * chance de s'afficher. L'utilisateur voyait un echec sans phrase, sur un
 * fichier que l'interface lui presentait comme acceptable.
 *
 * Deux verites a garder ensemble:
 *
 *   - le nombre annonce doit etre celui qui PASSE, pas celui qu'on aurait
 *     aime offrir;
 *   - la limite du corps doit suivre le nombre annonce, pas l'inverse, sinon
 *     les deux rederiveront a la premiere modification.
 *
 * D'ou ce module: une seule source, et le calcul fait une fois.
 */

/**
 * Plafond de requete de Cloud Run, en octets (32 Mio).
 *
 * Il ne se configure pas. Tout ce qui le depasse est refuse par la plateforme
 * avant d'atteindre l'application: aucun message de notre part, aucune trace
 * dans nos journaux.
 */
export const PLAFOND_PLATEFORME_OCTETS = 32 * 1024 * 1024;

/** Inflation du base64: quatre octets transmis pour trois octets de fichier. */
const FACTEUR_BASE64 = 4 / 3;

/**
 * Marge pour l'enveloppe JSON (noms de champs, nom du fichier, type MIME,
 * echappements). Quelques kilo-octets suffisent en pratique; on prend large
 * plutot que de decouvrir la limite sur un fichier reel.
 */
const ENVELOPPE_JSON_OCTETS = 64 * 1024;

/**
 * Taille de fichier maximale transmissible en base64 dans du JSON, en octets.
 *
 * Derivee du plafond de la plateforme: c'est le seul des trois nombres qu'on
 * ne choisit pas.
 */
export const TAILLE_MAX_BASE64_OCTETS = Math.floor(
  (PLAFOND_PLATEFORME_OCTETS - ENVELOPPE_JSON_OCTETS) / FACTEUR_BASE64,
);

/** Le meme, en megaoctets entiers — c'est ce qu'on annonce a l'utilisateur. */
export const TAILLE_MAX_BASE64_MO = Math.floor(TAILLE_MAX_BASE64_OCTETS / (1024 * 1024));

/**
 * Limite a donner a `express.json` pour une route qui recoit du base64.
 *
 * On part de la taille annoncee et on remonte: c'est le sens qui empeche la
 * derive. Le resultat ne depasse jamais le plafond de la plateforme — le
 * declarer plus haut ne servirait a rien et laisserait croire le contraire,
 * ce qui est precisement le defaut qu'on corrige.
 */
export function limiteCorpsBase64(tailleFichierMo: number): string {
  const octets = Math.ceil(tailleFichierMo * 1024 * 1024 * FACTEUR_BASE64) + ENVELOPPE_JSON_OCTETS;
  const borne = Math.min(octets, PLAFOND_PLATEFORME_OCTETS);
  // On arrondit vers le HAUT: arrondir vers le bas rognerait quelques centaines
  // de kilo-octets et ferait refuser un fichier tout juste a la taille
  // annoncee — c'est-a-dire exactement le defaut qu'on corrige, en plus
  // discret. Le plafond ci-dessus garantit qu'arrondir au-dessus ne fait pas
  // promettre plus que la plateforme n'accepte.
  const mio = Math.min(
    Math.ceil(borne / (1024 * 1024)),
    Math.floor(PLAFOND_PLATEFORME_OCTETS / (1024 * 1024)),
  );
  return `${mio}mb`;
}
