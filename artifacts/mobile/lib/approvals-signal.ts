/**
 * Signal interne "une action attend une decision".
 *
 * Le badge de la file d'approbation (`usePendingApprovals`) interroge le
 * serveur toutes les 60 secondes: c'est la source de verite, et il faut la
 * garder — le nombre ne doit baisser que lorsqu'une proposition est reellement
 * tranchee, jamais parce qu'on a regarde l'ecran.
 *
 * Mais attendre jusqu'a une minute apres l'arrivee d'une proposition est
 * visible: l'agent annonce l'action (evenement SSE `proposition`, et
 * notification push pour les priorites hautes), l'utilisateur ouvre l'app...
 * et le badge est encore a zero. Ce petit bus relie donc le flux SSE, recu par
 * `UnreadBadgesContext`, au rafraichissement du compteur — sans faire dependre
 * l'un de l'autre ni transformer le compteur en "non lus".
 *
 * Deliberement minimal: pas d'etat, juste "quelque chose a change, va
 * revalider". La valeur affichee vient toujours du serveur.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** S'abonne aux annonces de nouvelle proposition. Renvoie le desabonnement. */
export function onApprovalsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Annonce qu'une proposition est arrivee (ou a ete tranchee ailleurs). */
export function notifyApprovalsChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Un abonne defaillant ne doit pas empecher les autres d'etre prevenus.
    }
  }
}
