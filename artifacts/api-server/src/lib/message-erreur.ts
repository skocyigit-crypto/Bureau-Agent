/**
 * Ce qu'une reponse d'erreur a le droit de dire au client.
 *
 * LE DEFAUT
 *
 * Neuf routes renvoyaient `err.message` tel quel dans le corps de la reponse.
 * Un message d'exception n'est pas un texte pour l'utilisateur : c'est un
 * texte pour le developpeur, et il porte ce qu'il a sous la main.
 *
 *  - Postgres : « duplicate key value violates unique constraint
 *    "factures_client_org_reference_unique" » — le nom des tables, des
 *    colonnes et des contraintes ;
 *  - un fournisseur d'envoi (Resend, Twilio) : l'identifiant de compte, le
 *    domaine expediteur, parfois le debut d'une cle ;
 *  - le stockage : un chemin de bucket.
 *
 * Rien de tout cela n'aide la personne qui a clique, et tout cela decrit
 * l'interieur du produit a quelqu'un qui n'a qu'un compte de son organisation.
 *
 * LA REGLE
 *
 * Le detail va au JOURNAL, toujours et en entier. La reponse porte une phrase
 * stable, ecrite pour etre lue. Hors production, le detail est joint sous
 * `details` : c'est ce dont on a besoin en developpement, et c'est deja le
 * choix fait dans `routes/ai-analysis.ts` — cette fonction ne fait que le
 * rendre disponible partout au lieu d'etre recopie.
 *
 * Elle ne remplace PAS un message metier. Quand la route sait ce qui s'est
 * passe — periode close, montant qui depasse le reste du — elle doit le dire
 * explicitement : une phrase precise vaut toujours mieux qu'une phrase sure.
 */
export interface CorpsErreur {
  error: string;
  details?: string;
}

/**
 * Le corps de la reponse: la phrase stable, plus le detail hors production.
 *
 * `fallback` est ce que l'utilisateur lira en production. Il doit dire ce qui
 * n'a pas marche et, quand c'est possible, quoi faire.
 */
export function corpsErreur(err: unknown, fallback: string): CorpsErreur {
  if (process.env.NODE_ENV === "production") return { error: fallback };
  const detail = err instanceof Error ? err.message : typeof err === "string" ? err : undefined;
  return detail ? { error: fallback, details: detail } : { error: fallback };
}
