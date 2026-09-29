/**
 * Etat de la commande vocale, partage entre l'assistant vocal et l'en-tete.
 *
 * Le micro etait un bouton flottant en bas a gauche : il recouvrait le bas de
 * la barre laterale (et le bouton « + », pose au meme endroit). Il est
 * maintenant un bouton « Commande vocale » de l'en-tete. L'assistant, lui,
 * reste monte au niveau de l'application (il ecoute le mot d'eveil sur toutes
 * les pages) : ce petit magasin fait le lien entre les deux, sans contexte
 * React commun.
 *
 * L'etat d'ecoute est affiche dans l'en-tete : le micro peut ecouter le mot
 * d'eveil en arriere-plan, et cela doit se voir.
 */
import { useSyncExternalStore } from "react";

export type EcouteVocale = "arret" | "veille" | "commande" | "traitement" | "parole";

export type EtatCommandeVocale = {
  /** Faux tant que l'assistant n'est pas charge, ou si le navigateur n'a pas de reconnaissance vocale. */
  disponible: boolean;
  /** Le panneau de l'assistant est ouvert. */
  ouverte: boolean;
  ecoute: EcouteVocale;
};

const INITIAL: EtatCommandeVocale = { disponible: false, ouverte: false, ecoute: "arret" };

let etat: EtatCommandeVocale = INITIAL;
const abonnes = new Set<() => void>();
let bascule: (() => void) | null = null;

export function publierCommandeVocale(partiel: Partial<EtatCommandeVocale>): void {
  const suivant = { ...etat, ...partiel };
  if (suivant.disponible === etat.disponible && suivant.ouverte === etat.ouverte && suivant.ecoute === etat.ecoute) return;
  etat = suivant;
  abonnes.forEach((f) => f());
}

export function lireCommandeVocale(): EtatCommandeVocale {
  return etat;
}

export function useCommandeVocale(): EtatCommandeVocale {
  return useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => { abonnes.delete(f); };
    },
    () => etat,
    () => INITIAL,
  );
}

/** L'assistant s'inscrit ici ; renvoie de quoi se desinscrire. */
export function enregistrerBascule(f: () => void): () => void {
  bascule = f;
  return () => {
    if (bascule === f) bascule = null;
    publierCommandeVocale(INITIAL);
  };
}

/** Ouvre l'assistant (et lance l'ecoute), ou le ferme s'il est ouvert. */
export function basculerCommandeVocale(): void {
  bascule?.();
}
