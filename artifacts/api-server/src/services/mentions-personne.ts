/**
 * Ce que les rapports d'agents disent d'UNE personne — pour son droit d'acces.
 *
 * `GET /data-protection/my-data` rendait profil, presences, journal, IA...
 * mais pas les appreciations portees sur la personne : les rapports de
 * performance (`performance_reports`, une ligne par salarie) et les rapports
 * d'equipe de l'agent RH (`ai_agent_reports.details`). Ce sont precisement
 * les donnees qu'un salarie a le plus de raisons de demander (RGPD art. 15),
 * et que la politique annonce (« appreciations d'activite generees par
 * intelligence artificielle »).
 *
 * Les rapports d'equipe ne portent pas d'identifiant par personne : l'agent
 * travaille sur des pseudonymes, puis `reidentifierNoms` remet « Prenom Nom »
 * dans chaque chaine. On ne peut donc retrouver une personne que par son nom.
 * Deux regles en decoulent :
 *
 *   - on rend l'OBJET qui la mentionne (son diagnostic, sa recommandation),
 *     jamais le rapport entier : le rapport d'equipe contient l'evaluation des
 *     collegues, qui n'est pas a elle ;
 *   - si un autre compte de l'organisation porte le meme nom, on n'extrait
 *     rien et on le dit. Rendre a Marie Martin l'evaluation de l'autre Marie
 *     Martin serait une fuite, pas un droit d'acces.
 */

export interface Mention {
  /** Chemin dans le rapport, pour que la personne sache d'ou vient le passage. */
  chemin: string;
  valeur: unknown;
}

const normaliser = (s: string) => s.replace(/\s+/g, " ").trim().toLocaleLowerCase("fr");

function mentionne(texte: string, nom: string): boolean {
  return normaliser(texte).includes(nom);
}

/**
 * Les passages d'un rapport qui nomment la personne.
 *
 * Un objet dont une chaine DIRECTE la nomme est sa fiche (diagnostic, statut,
 * recommandation) : il est rendu A PLAT, champs simples seulement. Ses
 * sous-objets et listes sont examines a part, et rendus seulement s'ils la
 * nomment eux aussi — une fiche peut contenir la liste de toute l'equipe.
 * La racine n'est jamais une fiche : le rapport entier contient les
 * collegues. (Le premier jet rendait l'objet entier ; le test l'a pris a
 * rendre tout le rapport des que le resume citait la personne.)
 */
export function mentionsDe(details: unknown, nomComplet: string): Mention[] {
  const nom = normaliser(nomComplet);
  if (nom.length < 3) return [];
  const out: Mention[] = [];
  const parcourir = (v: unknown, chemin: string): void => {
    if (typeof v === "string") {
      if (mentionne(v, nom)) out.push({ chemin, valeur: v });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => parcourir(x, `${chemin}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      const entrees = Object.entries(v as Record<string, unknown>);
      const simples = entrees.filter(([, x]) => x === null || typeof x !== "object");
      const composes = entrees.filter(([, x]) => x !== null && typeof x === "object");
      const estFiche = chemin !== "" && simples.some(([, x]) => typeof x === "string" && mentionne(x, nom));
      if (estFiche) out.push({ chemin, valeur: Object.fromEntries(simples) });
      else for (const [k, x] of simples) parcourir(x, chemin ? `${chemin}.${k}` : k);
      for (const [k, x] of composes) parcourir(x, chemin ? `${chemin}.${k}` : k);
    }
  };
  parcourir(details, "");
  return out;
}

/** Vrai si un AUTRE compte de l'organisation porte le meme nom complet. */
export function nomAmbigu(
  moi: { id: number; prenom: string; nom: string },
  comptes: readonly { id: number; prenom: string; nom: string }[],
): boolean {
  const cle = (c: { prenom: string; nom: string }) => normaliser(`${c.prenom} ${c.nom}`);
  return comptes.some((c) => c.id !== moi.id && cle(c) === cle(moi));
}
