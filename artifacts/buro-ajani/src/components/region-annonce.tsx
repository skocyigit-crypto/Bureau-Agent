/**
 * Region d'annonce pour les lecteurs d'ecran (WCAG 4.1.3, messages d'etat).
 *
 * Les pages de l'application ne disaient leurs changements d'etat que par un
 * toast (un seul a la fois, remplace au suivant) : une liste rechargee, un
 * filtre applique, une demande traitee passaient inapercus au clavier et au
 * lecteur d'ecran. Cette region est TOUJOURS montee (une region inseree en
 * meme temps que son texte n'est pas annoncee par tous les lecteurs) et son
 * texte change a chaque annonce.
 *
 * `urgent` passe en `role="alert"` (assertive) : a reserver aux erreurs.
 */
export function RegionAnnonce({ message, urgent = false, id }: { message: string; urgent?: boolean; id?: string }) {
  return (
    <div
      id={id}
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      aria-atomic="true"
      className="sr-only"
      data-testid="region-annonce"
    >
      {message}
    </div>
  );
}
