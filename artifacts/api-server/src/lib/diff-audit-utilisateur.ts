/**
 * Ce qu'un journal d'audit doit retenir d'une modification de compte.
 *
 * L'etat d'avant: la modification d'un utilisateur etait consignee comme
 *
 *     update_user  user 42  { fields: ["role"] }
 *
 * — QUELS champs ont bouge, jamais de QUOI vers QUOI. Le journal ne pouvait
 * donc pas repondre a la seule question qui compte sur les droits: « qui a
 * nomme Jean administrateur, et qu'etait-il avant ? »
 *
 * Ce n'est pas theorique. Le role decide de trois choses: ce qu'on peut lire,
 * ce qu'on peut detruire, et le nombre de sieges factures. Le jour d'un litige
 * — « je n'ai jamais nomme cette personne » — un journal qui dit « le champ
 * role a change » ne tranche rien. La suppression, elle, consignait deja le
 * role de la cible: la regle etait connue, elle n'etait appliquee qu'a une
 * voie sur deux.
 *
 * POURQUOI PAS TOUS LES CHAMPS
 *
 * Consigner l'ancien et le nouveau nom, telephone ou adresse reviendrait a
 * recopier des donnees personnelles dans un journal conserve des annees, alors
 * que la modification elle-meme est deja tracee. Le RGPD demande l'inverse: le
 * minimum necessaire a la finalite. La finalite ici est la securite, donc les
 * champs qui donnent ou retirent un pouvoir — et eux seuls.
 */

/** Les champs dont la valeur, elle-meme, doit figurer au journal. */
const CHAMPS_DE_POUVOIR = ["role", "actif"] as const;

export interface ChangementAudite {
  /** Les champs modifies, quels qu'ils soient (deja consigne auparavant). */
  fields: string[];
  /** Avant/apres, pour les seuls champs qui donnent ou retirent un pouvoir. */
  changements?: Record<string, { avant: unknown; apres: unknown }>;
}

/**
 * Compare l'etat d'avant a la modification demandee.
 *
 * `avant` est la ligne telle qu'elle a ete lue pour les controles d'acces;
 * `patch` ce que la requete veut ecrire. Un champ present dans le patch mais
 * identique a l'existant n'est PAS un changement: le consigner remplirait le
 * journal de lignes ou rien ne s'est passe, et c'est ainsi qu'on cesse de le
 * lire.
 */
export function diffAuditUtilisateur(
  avant: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): ChangementAudite {
  const fields = Object.keys(patch).filter((c) => c !== "updatedAt");
  const changements: Record<string, { avant: unknown; apres: unknown }> = {};

  for (const champ of CHAMPS_DE_POUVOIR) {
    if (!(champ in patch)) continue;
    const ancienne = avant ? avant[champ] : undefined;
    const nouvelle = patch[champ];
    if (ancienne === nouvelle) continue;
    changements[champ] = { avant: ancienne ?? null, apres: nouvelle ?? null };
  }

  return Object.keys(changements).length > 0 ? { fields, changements } : { fields };
}
