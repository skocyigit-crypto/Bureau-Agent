/**
 * Titre de la page (RGAA 8.6 / WCAG 2.4.2).
 *
 * Toutes les pages de l'application portaient le meme titre, « Ajant Bureau -
 * Solution Professionnelle » : un lecteur d'ecran, l'historique du navigateur
 * et la liste des onglets ne permettaient pas de savoir ou l'on se trouve.
 *
 * Le nom vient de la navigation elle-meme : une page ajoutee au menu en herite
 * sans qu'on y pense.
 */
export const NOM_PRODUIT = "Ajant Bureau";

/** « Contacts – Ajant Bureau » : l'entree de menu la plus precise qui contient l'adresse. */
export function titreDePage(adresse: string, items: ReadonlyArray<{ name: string; href: string }>): string {
  const correspond = (href: string) =>
    href === "/" ? adresse === "/" : adresse === href || adresse.startsWith(`${href}/`);
  const item = items.filter((i) => correspond(i.href)).sort((x, y) => y.href.length - x.href.length)[0];
  return item ? `${item.name} – ${NOM_PRODUIT}` : NOM_PRODUIT;
}
