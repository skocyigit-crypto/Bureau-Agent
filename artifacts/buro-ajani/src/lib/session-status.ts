/**
 * Distinguer « la session n'existe plus » de « le serveur n'a pas repondu ».
 *
 * Cette distinction n'est pas un detail d'implementation: elle decide de ce
 * qu'on affiche a quelqu'un qui travaille. Se tromper dans un sens fait perdre
 * une saisie en cours derriere un mur de reconnexion; se tromper dans l'autre
 * laisse croire qu'on est connecte alors qu'aucune action ne passera plus.
 *
 * Le defaut corrige le 2026-09-11: toute reponse non-OK de `/api/auth/me`
 * declenchait « votre session a expire pour des raisons de securite ». Or
 * l'application se limite elle-meme (429) — un bureau derriere une seule
 * adresse IP publique, ou simplement plusieurs onglets, suffit a l'atteindre.
 * L'utilisateur, parfaitement authentifie, etait jete dehors JUSTE APRES une
 * connexion reussie. Mesure: `/auth/me` rendait 429 quatorze fois de suite, et
 * le mur de reconnexion s'affichait.
 *
 * Pire, le defaut s'aggravait lui-meme: se reconnecter ajoute des requetes a
 * celles qui ont declenche la limite.
 */

/**
 * Vrai seulement si le serveur a dit que la session n'est plus valable.
 *
 * 401 « non authentifie » et 403 « interdit » sont des reponses sur la
 * SESSION. 429 et 5xx sont des reponses sur le SERVEUR: ils ne disent rien de
 * la session, et on n'a donc rien appris qui justifie de deconnecter qui que
 * ce soit.
 */
export function sessionVraimentPerdue(statut: number): boolean {
  return statut === 401 || statut === 403;
}

/**
 * Vrai quand il vaut la peine de redemander plus tard.
 *
 * Sert au demarrage: tant qu'on n'a pas de reponse claire, un ecran d'attente
 * vaut mieux qu'un ecran de connexion affiche a tort a quelqu'un qui a une
 * session valide.
 */
export function refusTemporaire(statut: number): boolean {
  return statut === 429 || statut >= 500;
}
