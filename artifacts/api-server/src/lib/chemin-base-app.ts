/**
 * Le prefixe de chemin de l'application, rendu inoffensif.
 *
 * CE QUI S'EST PASSE
 *
 * `APP_BASE_PATH` vaut, en production, la CHAINE `"undefined"` — quelqu'un a
 * pousse une variable JavaScript qui n'etait pas definie, et Cloud Run a
 * enregistre le mot. Les quatre points du serveur qui construisent un lien
 * ecrivaient:
 *
 *     const appBase = process.env.APP_BASE_PATH ?? "";
 *
 * `??` ne rattrape que la valeur `undefined`, pas le mot « undefined », qui
 * traverse. Le lien produit etait donc:
 *
 *     https://app.agentdebureau.frundefined?reset_token=...
 *
 * Un domaine qui n'existe pas. Les quatre points concernes sont la
 * reinitialisation de mot de passe, la verification d'adresse, les invitations
 * et les invitations d'organisation — c'est-a-dire TOUT ce qui permet a
 * quelqu'un d'entrer ou de revenir dans le produit.
 *
 * Personne ne pouvait s'en apercevoir depuis l'interieur: les comptes en place
 * fonctionnent, rien n'echoue, aucune erreur n'est journalisee. Seul celui qui
 * a oublie son mot de passe reste dehors, et il n'a personne a qui le dire.
 *
 * POURQUOI CORRIGER ICI PLUTOT QUE SEULEMENT DANS LA CONFIGURATION
 *
 * Retirer la variable repare aujourd'hui. Ce module fait qu'une faute de
 * configuration ne puisse PLUS couper la recuperation de compte demain: une
 * valeur douteuse est traitee comme absente. C'est le bon arbitrage pour un
 * prefixe de chemin — s'en passer donne une racine correcte, le prendre au mot
 * donne une adresse morte.
 */

/** Mots qui trahissent une variable mal poussee, jamais un vrai chemin. */
const VALEURS_FANTOMES = new Set(["undefined", "null", "nil", "none", "(null)"]);

/**
 * Rend le prefixe utilisable dans une URL, ou la chaine vide.
 *
 * - une valeur absente, vide, ou visiblement fantome donne "";
 * - "/" seul donne "" (il ferait un double slash devant la query);
 * - un chemin reel recoit sa barre de tete et perd celle de fin.
 */
export function cheminBaseApp(brut: string | undefined = process.env.APP_BASE_PATH): string {
  const valeur = (brut ?? "").trim();
  if (valeur === "") return "";
  if (VALEURS_FANTOMES.has(valeur.toLowerCase())) return "";

  const sansBarreFinale = valeur.replace(/\/+$/, "");
  if (sansBarreFinale === "") return "";

  return sansBarreFinale.startsWith("/") ? sansBarreFinale : `/${sansBarreFinale}`;
}
