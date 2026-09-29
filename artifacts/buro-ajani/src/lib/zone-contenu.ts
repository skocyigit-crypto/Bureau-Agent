/**
 * Ce qui flotte au-dessus des pages (l'avatar « Bureau asistani ») se pose dans
 * la zone de contenu, jamais sur la barre laterale. Pose par defaut en bas a
 * gauche de la FENETRE, l'avatar recouvrait les reglages du bureau et le profil.
 * Sur telephone la barre est hors ecran et le contenu commence a 0.
 */
export type Position = { x: number; y: number };

const borne = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Bord gauche de `<main id="contenu">`, 0 s'il n'existe pas. */
export function bordGaucheDuContenu(): number {
  if (typeof document === "undefined") return 0;
  return Math.max(0, Math.round(document.getElementById("contenu")?.getBoundingClientRect().left ?? 0));
}

/** Position d'un element de `w` x `h` ramenee dans la zone de contenu visible. */
export function dansLeContenu(p: Position, w: number, h: number): Position {
  const gauche = bordGaucheDuContenu() + 8;
  return {
    x: borne(p.x, gauche, Math.max(gauche, window.innerWidth - w - 8)),
    y: borne(p.y, 8, Math.max(8, window.innerHeight - h - 8)),
  };
}
