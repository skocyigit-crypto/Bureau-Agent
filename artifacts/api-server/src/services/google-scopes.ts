/**
 * Demander l'ecriture quand on ne fait que lire.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * Le produit demandait `gmail.modify`, qui autorise a LIRE, MODIFIER et
 * SUPPRIMER le courrier de l'utilisateur. Inventaire de ce qu'il en fait
 * reellement, sur tout le depot :
 *
 *     getProfile, labels.list, messages.list, messages.get,
 *     messages.attachments, messages.send, threads.get
 *
 * Aucun `messages.modify`, aucun changement d'etiquette, aucune mise a la
 * corbeille — ni via la bibliotheque cliente, ni en REST brut. Le droit
 * d'ecriture n'etait utilise nulle part.
 *
 * CE QUE CELA CHANGE
 *
 * `gmail.modify` et `gmail.readonly` sont tous deux des « restricted scopes »
 * chez Google : dans les deux cas l'application doit passer une evaluation de
 * securite CASA, renouvelee chaque annee. Le resserrement ne supprime donc pas
 * cette obligation.
 *
 * Ce qu'il change est ailleurs, et compte davantage : l'ecran de consentement
 * cesse de demander a l'utilisateur le droit de supprimer son courrier, et
 * surtout un jeton compromis ne permet plus de le faire. C'est la minimisation
 * de l'article 5.1.c du RGPD, et une reduction du rayon d'explosion.
 *
 * POURQUOI `drive` N'EST PAS RESSERRE ICI
 *
 * Contrairement a Gmail, l'ecriture Drive est REELLEMENT utilisee :
 * `google-drive-backup.ts` cree un dossier, y televerse les sauvegardes et
 * supprime les anciennes. `drive.file` — non sensible, sans CASA — suffirait
 * pour cela, car il couvre les fichiers crees par l'application.
 *
 * Mais `google-workspace.ts` liste, lit et exporte les fichiers EXISTANTS de
 * l'utilisateur, ce que `drive.file` ne couvre pas. Separer les deux usages
 * (sauvegardes en `drive.file`, navigateur de fichiers via le Google Picker)
 * retirerait un restricted scope complet. C'est un changement de
 * fonctionnalite, pas un resserrement de constante : il est nomme ici plutot
 * que fait a la va-vite.
 *
 * LA COMPATIBILITE, QUI EST LA VRAIE DIFFICULTE
 *
 * Les utilisateurs deja connectes ont accorde `gmail.modify`. Le controle qui
 * decide si un service est connecte comparait le scope requis au scope
 * accorde par egalite stricte. Resserrer la demande sans toucher a ce controle
 * aurait affiche « Gmail non connecte » a tous ces utilisateurs, dont le jeton
 * fonctionne parfaitement.
 *
 * D'ou la notion d'englobement : un scope accorde satisfait un scope requis
 * s'il est le meme, ou s'il le contient.
 */

export const SCOPE_GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const SCOPE_GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
export const SCOPE_GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";

/**
 * Scopes plus larges qui contiennent un scope requis.
 *
 * Sert UNIQUEMENT a reconnaitre une autorisation deja accordee. Aucun de ces
 * scopes n'est demande.
 */
const ENGLOBANTS: Record<string, readonly string[]> = {
  [SCOPE_GMAIL_READONLY]: [SCOPE_GMAIL_MODIFY, "https://mail.google.com/"],
  [SCOPE_GMAIL_SEND]: [SCOPE_GMAIL_MODIFY, "https://mail.google.com/"],
};

/** Un scope requis est-il couvert par ce qui a ete accorde ? */
export function scopeSatisfait(requis: string, accordes: readonly string[]): boolean {
  if (accordes.includes(requis)) return true;
  const englobants = ENGLOBANTS[requis];
  if (!englobants) return false;
  return englobants.some((e) => accordes.includes(e));
}

/** Tous les scopes requis d'un service sont-ils couverts ? */
export function serviceConnecte(requis: readonly string[], accordes: readonly string[]): boolean {
  if (requis.length === 0) return false;
  return requis.every((r) => scopeSatisfait(r, accordes));
}
