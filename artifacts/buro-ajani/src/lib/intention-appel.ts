/**
 * Ce que l'URL demande a l'ecran « Appels » quand on y arrive depuis ailleurs.
 *
 * Deux boutons y mènent, et ils n'envoient pas le meme parametre :
 *   - la FICHE d'un contact envoie `?contactId=`
 *   - la LISTE des contacts (menu « Appeler ») envoie `?phone=`
 *
 * L'ecran ne lisait que le premier. Depuis la liste, l'utilisateur arrivait
 * sur le tableau des appels sans boite de dialogue et sans numero, le
 * parametre restant affiche dans la barre d'adresse : le bouton « Appeler »
 * ne faisait rien de visible.
 *
 * Second defaut, sur `?contactId=` : le numero du contact n'est connu qu'une
 * fois la liste des contacts chargee. L'ecran effacait pourtant l'URL des son
 * premier passage — donc avant la reponse. Au passage suivant il ne restait
 * plus rien a lire, et le numero restait vide sauf si le cache etait deja
 * chaud.
 *
 * D'ou cette fonction : elle dit quoi pre-remplir, ET si l'URL a fini de
 * servir. Elle est pure pour que ces deux regles soient verifiables sans
 * monter l'ecran.
 */
export interface Contact {
  id: number | string;
  phone?: string | null;
}

export interface IntentionAppel {
  /** Ouvrir la boite de dialogue de saisie d'appel. */
  ouvrir: boolean;
  /** Contact a pre-selectionner, tel qu'attendu par le formulaire. */
  contactId?: string;
  /** Numero a pre-remplir. */
  phoneNumber?: string;
  /**
   * Vrai quand l'URL a livre tout ce qu'elle portait et peut etre nettoyee.
   * Faux tant qu'on attend les contacts : l'effacer avant, c'est perdre la
   * demande.
   */
  urlConsommee: boolean;
}

export function intentionAppel(
  search: string,
  contacts: Contact[] | undefined,
): IntentionAppel {
  const params = new URLSearchParams(search);
  const contactId = params.get("contactId");
  const phone = params.get("phone");

  if (contactId) {
    // Les contacts ne sont pas encore la : on ouvre deja la boite (l'attente
    // est ainsi visible), mais on garde l'URL pour le passage suivant.
    if (!contacts) return { ouvrir: true, contactId, urlConsommee: false };
    const trouve = contacts.find((c) => String(c.id) === contactId);
    return {
      ouvrir: true,
      contactId,
      phoneNumber: trouve?.phone ?? undefined,
      urlConsommee: true,
    };
  }

  if (phone) {
    // Un numero nu ne depend d'aucun chargement : il est utilisable tout de
    // suite.
    return { ouvrir: true, phoneNumber: phone, urlConsommee: true };
  }

  return { ouvrir: false, urlConsommee: false };
}
