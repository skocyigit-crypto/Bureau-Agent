/**
 * Transfert vers la BONNE equipe : l'appelant qui demande « la comptabilite »
 * ou « le chef de chantier » est relie aux numeros de cette equipe, pas au
 * seul numero de transfert.
 *
 * Mesure du 28/09 : la demande etait « rediriger vers la bonne personne ou
 * equipe » ; le code n'avait qu'un numero (`forwardToNumber`). Les equipes
 * sont reglees par l'organisation (nom, numeros, mots-cles). Le choix se fait
 * dans cet ordre :
 *   1. l'equipe nommee par le modele, si elle existe telle quelle ;
 *   2. un nom d'equipe ou un mot-cle prononce par l'appelant ;
 *   3. le numero de transfert par defaut ;
 *   4. rien → demande de rappel (le code appelant s'en charge).
 * Le modele ne peut pas inventer une equipe : un nom inconnu est ignore.
 * Les numeros d'une equipe sonnent ensemble ; le premier qui decroche prend.
 */
export const MAX_EQUIPES = 6;
export const MAX_NUMEROS_PAR_EQUIPE = 5;
const TEL = /^\+?[0-9][0-9\s().-]{5,19}$/;

export interface EquipeTransfert { nom: string; numeros: string[]; motsCles: string[] }

const normaliser = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Valide la saisie de l'ecran. Rend l'erreur lisible ou la liste propre. */
export function validerEquipes(brut: unknown): { ok: true; equipes: EquipeTransfert[] } | { ok: false; erreur: string } {
  if (brut === undefined || brut === null) return { ok: true, equipes: [] };
  if (!Array.isArray(brut)) return { ok: false, erreur: "'equipesTransfert' doit etre une liste." };
  if (brut.length > MAX_EQUIPES) return { ok: false, erreur: `${MAX_EQUIPES} equipes au maximum.` };
  const equipes: EquipeTransfert[] = [];
  const noms = new Set<string>();
  for (const e of brut) {
    if (!e || typeof e !== "object") return { ok: false, erreur: "Equipe invalide." };
    const nom = typeof (e as any).nom === "string" ? (e as any).nom.trim().slice(0, 40) : "";
    if (!nom) return { ok: false, erreur: "Chaque equipe a un nom." };
    if (noms.has(normaliser(nom))) return { ok: false, erreur: `Equipe en double : ${nom}.` };
    noms.add(normaliser(nom));
    const numeros = Array.isArray((e as any).numeros) ? (e as any).numeros.map((n: unknown) => String(n ?? "").trim()).filter(Boolean) : [];
    if (numeros.length === 0) return { ok: false, erreur: `L'equipe « ${nom} » n'a aucun numero.` };
    if (numeros.length > MAX_NUMEROS_PAR_EQUIPE) return { ok: false, erreur: `${MAX_NUMEROS_PAR_EQUIPE} numeros au maximum par equipe.` };
    const invalide = numeros.find((n: string) => !TEL.test(n));
    if (invalide) return { ok: false, erreur: `Numero invalide dans « ${nom} » : ${invalide}.` };
    const motsCles = Array.isArray((e as any).motsCles)
      ? (e as any).motsCles.map((m: unknown) => String(m ?? "").trim().slice(0, 40)).filter(Boolean).slice(0, 10)
      : [];
    equipes.push({ nom, numeros, motsCles });
  }
  return { ok: true, equipes };
}

/** Equipes enregistrees (relues avec la meme validation ; une saisie corrompue = aucune). */
export function lireEquipes(cfg: Record<string, unknown>): EquipeTransfert[] {
  const v = validerEquipes(cfg.equipesTransfert);
  return v.ok ? v.equipes : [];
}

export function choisirEquipe(
  equipes: EquipeTransfert[],
  indices: { equipeModele?: string | null; texte?: string | null },
): EquipeTransfert | null {
  if (!equipes.length) return null;
  if (indices.equipeModele) {
    const cible = normaliser(indices.equipeModele);
    const parNom = equipes.find((e) => normaliser(e.nom) === cible);
    if (parNom) return parNom;
  }
  const texte = ` ${normaliser(indices.texte ?? "")} `;
  if (texte.trim()) {
    for (const e of equipes) {
      const termes = [e.nom, ...e.motsCles].map(normaliser).filter((t) => t.length >= 3);
      if (termes.some((t) => texte.includes(` ${t} `))) return e;
    }
  }
  return null;
}

/** Ou transferer : l'equipe choisie, sinon le numero par defaut, sinon personne. */
export function cibleDeTransfert(
  cfg: Record<string, unknown>,
  indices: { equipeModele?: string | null; texte?: string | null } = {},
): { equipe: string | null; numeros: string[] } {
  const equipe = choisirEquipe(lireEquipes(cfg), indices);
  if (equipe) return { equipe: equipe.nom, numeros: equipe.numeros };
  const defaut = typeof cfg.forwardToNumber === "string" ? cfg.forwardToNumber.trim() : "";
  return { equipe: null, numeros: defaut ? [defaut] : [] };
}

/** Un transfert est-il possible (pour dire au modele qu'il peut le proposer) ? */
export function transfertPossible(cfg: Record<string, unknown>): boolean {
  return lireEquipes(cfg).length > 0 || (typeof cfg.forwardToNumber === "string" && cfg.forwardToNumber.trim().length > 0);
}
