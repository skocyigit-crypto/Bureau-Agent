/**
 * Validation d'une note interne.
 *
 * MESURE LE 17/09 : `content.trim()` sur un nombre ou un objet levait une 500 ;
 * un PUT avec `content: "   "` enregistrait une note VIDE que le POST refusait ;
 * `tags` acceptait n'importe quel tableau (objets compris) ; aucune longueur
 * n'etait bornee. Et l'auteur etait lu sur `req.user`, que rien n'alimente :
 * toutes les notes etaient enregistrees sans auteur.
 */

export const LIMITES_NOTE = { titre: 300, contenu: 20_000, tags: 30, tag: 50, couleur: 30 } as const;

export interface ChampsNote {
  title?: string | null;
  content?: string;
  color?: string;
  pinned?: boolean;
  tags?: string[];
}

export type ResultatNote = { ok: true; champs: ChampsNote } | { ok: false; erreur: string };

/** `partiel` : mise a jour (seuls les champs fournis sont controles). */
export function validerNote(corps: unknown, partiel: boolean): ResultatNote {
  const b = (corps && typeof corps === "object" ? corps : {}) as Record<string, unknown>;
  const champs: ChampsNote = {};

  if (!partiel || b.content !== undefined) {
    if (typeof b.content !== "string" || !b.content.trim()) return { ok: false, erreur: "Le contenu est obligatoire." };
    if (b.content.trim().length > LIMITES_NOTE.contenu) return { ok: false, erreur: `Contenu limite a ${LIMITES_NOTE.contenu} caracteres.` };
    champs.content = b.content.trim();
  }
  if (b.title !== undefined) {
    if (b.title !== null && typeof b.title !== "string") return { ok: false, erreur: "Titre invalide." };
    const t = typeof b.title === "string" ? b.title.trim() : "";
    if (t.length > LIMITES_NOTE.titre) return { ok: false, erreur: `Titre limite a ${LIMITES_NOTE.titre} caracteres.` };
    champs.title = t || null;
  }
  if (b.color !== undefined) {
    if (typeof b.color !== "string" || !b.color || b.color.length > LIMITES_NOTE.couleur) return { ok: false, erreur: "Couleur invalide." };
    champs.color = b.color;
  } else if (!partiel) champs.color = "default";
  if (b.pinned !== undefined) champs.pinned = b.pinned === true;
  else if (!partiel) champs.pinned = false;
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.some((x) => typeof x !== "string")) return { ok: false, erreur: "Les etiquettes doivent etre du texte." };
    const tags = [...new Set((b.tags as string[]).map((x) => x.trim()).filter(Boolean))];
    if (tags.length > LIMITES_NOTE.tags || tags.some((x) => x.length > LIMITES_NOTE.tag)) {
      return { ok: false, erreur: `Au plus ${LIMITES_NOTE.tags} etiquettes de ${LIMITES_NOTE.tag} caracteres.` };
    }
    champs.tags = tags;
  } else if (!partiel) champs.tags = [];
  return { ok: true, champs };
}
