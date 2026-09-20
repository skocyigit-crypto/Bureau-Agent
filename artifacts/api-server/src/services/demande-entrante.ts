/**
 * Ce qu'on a le droit de repondre a quelqu'un qui vient de remplir le
 * formulaire.
 *
 * LE DEFAUT
 *
 * `sendEmail` ne leve pas en cas d'echec fournisseur : elle rend
 * `{ success: false, error }` (voir `services/email.ts`). Les deux routes
 * publiques — demande de devis / rappel, demande de demonstration — jetaient
 * cette valeur, puis repondaient 200 :
 *
 *     « Votre demande a ete envoyee. Vous recevrez un devis sous 24h. »
 *
 * Si la chaine d'e-mail etait en panne, le visiteur repartait avec une
 * promesse que personne n'avait recue, et l'alerte vers l'equipe n'etait pas
 * partie non plus. C'est le premier ecran du produit, et l'endroit ou une
 * piste commerciale se perd le plus cher.
 *
 * LA REGLE
 *
 * Refuser la demande des qu'un courriel echoue serait excessif : le PROSPECT
 * en base est le vrai filet, c'est lui qui fait que l'equipe rappellera. Tant
 * que l'un des deux chemins tient — la fiche en base, ou l'alerte a
 * l'equipe — la promesse est vraie. Si les deux tombent, personne ne sait que
 * cette personne a ecrit, et il faut le lui dire.
 *
 * Cette fonction existe pour que la regle soit LA MEME des deux cotes et
 * qu'elle se teste sans monter une route : les quatre cas tiennent en quatre
 * lignes.
 */
export type SuiteDemande = "transmise" | "perdue";

export function suiteDemande(prospectCapte: boolean, alerteEnvoyee: boolean): SuiteDemande {
  return prospectCapte || alerteEnvoyee ? "transmise" : "perdue";
}

/**
 * Message rendu quand rien n'a abouti.
 *
 * Il dit quoi faire, parce qu'un visiteur a qui l'on repond « erreur » ferme
 * l'onglet.
 */
export const MESSAGE_DEMANDE_PERDUE =
  "Votre demande n'a pas pu etre transmise. Merci de reessayer ou de nous ecrire directement.";
