/**
 * Le verdict d'un ecran ouvert dans un navigateur, isole pour etre teste.
 *
 * Il vivait en ligne dans `verif-ecrans.mjs`, donc rien ne le verifiait. Or
 * c'est la piece qui decide si la porte s'ouvre ou se ferme : un verdict trop
 * indulgent rend un audit vert sur une application morte, et personne ne
 * relit un controle qui dit toujours oui.
 *
 * TROIS ETATS, PAS DEUX. Un ecran est « en probleme », « bon », ou NON JUGE.
 * Le troisieme est le plus important : un ecran limite par le compteur de
 * requetes n'a pas ete mesure, et le declarer bon comme le declarer mauvais
 * serait inventer un resultat. C'est ce qui avait produit le premier rapport
 * du 17/09/2026, ou soixante ecrans etaient annonces « en probleme » sans
 * qu'aucun ne le soit.
 */

/**
 * Le texte que l'ErrorBoundary affiche quand un ecran est tombe.
 *
 * POURQUOI LE CHERCHER EXPLICITEMENT. Un ecran qui tombe ne rend pas une page
 * blanche : la frontiere d'erreur affiche son propre message, bien plus long
 * que le seuil de « page vide ». Le detecter revenait donc a esperer une
 * erreur de console — et une frontiere d'erreur ATTRAPE l'exception, donc
 * `pageerror` ne se declenche pas. Le controle reposait sur un effet de bord
 * de la journalisation de React, pas sur le fait observable.
 *
 * (Angle mort signale par la session BatiFlow le 24/09/2026 : chez elle, un
 * ecran tombe cachait trois contrastes illisibles — dont un titre a 1,04:1 —
 * qu'aucun audit ne pouvait voir tant que la page tombait avant de se rendre.
 * Un ecran casse cache ses autres defauts, et un audit vert sur un ecran
 * casse ne prouve rien.)
 *
 * Les trois langues qu'un poste de verification peut servir. Une seule aurait
 * suffi aujourd'hui, mais la langue depend du navigateur qui ouvre la page.
 */
export const TEXTES_FRONTIERE_ERREUR = [
  "Une erreur inattendue s'est produite",
  "An unexpected error occurred",
  "Beklenmeyen bir hata oluştu",
];

/** Vrai quand la page affiche la frontiere d'erreur au lieu de l'ecran. */
export function montreLaFrontiereDErreur(texte) {
  const t = String(texte ?? "");
  return TEXTES_FRONTIERE_ERREUR.some((m) => t.includes(m));
}

/**
 * Le verdict d'un ecran.
 *
 * @param {{texte?: string, erreurs?: string[], reseau?: string[], limite?: string[], clesNues?: string[]}} constat
 * @returns {{etat: "probleme"|"non_juge"|"bon", vide: boolean, frontiere: boolean, raisons: string[]}}
 */
export function jugerEcran(constat) {
  const texte = String(constat?.texte ?? "").trim();
  const erreurs = constat?.erreurs ?? [];
  const reseau = constat?.reseau ?? [];
  const limite = constat?.limite ?? [];
  const clesNues = constat?.clesNues ?? [];

  const vide = texte.length < 60;
  const frontiere = montreLaFrontiereDErreur(texte);

  // Limite atteinte : rien n'a ete mesure. On le dit, au lieu de rendre un
  // verdict qui ne repose sur rien.
  //
  // EXCEPTION : la frontiere d'erreur. Elle est la preuve directe que l'ecran
  // est tombe — un 429 n'affiche pas ce message. La masquer derriere « non
  // juge » laisserait passer le pire des etats pour le plus anodin.
  if (limite.length > 0 && !frontiere) {
    return { etat: "non_juge", vide, frontiere, raisons: [`limite: ${[...new Set(limite)].join(", ")}`] };
  }

  const raisons = [];
  if (frontiere) raisons.push("la frontiere d'erreur remplace l'ecran : il est tombe au rendu");
  if (vide) raisons.push("page quasi vide : le rendu a echoue");
  if (erreurs.length > 0) raisons.push(`${erreurs.length} erreur(s) de console`);
  if (reseau.length > 0) raisons.push(`${reseau.length} appel(s) en echec`);
  if (clesNues.length > 0) raisons.push(`cle(s) de traduction nue(s) : ${clesNues.slice(0, 3).join(", ")}`);

  return { etat: raisons.length > 0 ? "probleme" : "bon", vide, frontiere, raisons };
}
