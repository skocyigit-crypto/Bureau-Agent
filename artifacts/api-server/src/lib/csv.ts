/**
 * Exports CSV : un seul ecrivain, sur, et lisible par Excel en France.
 *
 * CE QUI ETAIT MESURE LE 17/09
 *
 * Une quinzaine d'exports (contacts, appels, messages, prospects, taches,
 * agenda, pointages, notes, audit, depenses, documents, utilisateurs...)
 * avaient chacun leur petite fonction `escape`. AUCUNE ne neutralisait les
 * formules (OWASP « CSV Injection », CWE-1236).
 *
 * Or une grande partie de ces cellules vient de L'EXTERIEUR : nom d'appelant,
 * contenu d'un WhatsApp ou d'un e-mail entrant, prospect saisi par formulaire
 * public. Un message dont le texte commence par `=HYPERLINK(...)` ou `=cmd|...`
 * devient une formule quand le gerant ouvre l'export dans Excel.
 *
 * Deuxieme defaut : la plupart separaient par des VIRGULES. Excel en francais
 * utilise le separateur de liste regional, le point-virgule (la virgule est le
 * separateur decimal) : le fichier s'ouvrait en une seule colonne.
 *
 * LA REGLE
 *
 *  - separateur `;`, fin de ligne CRLF (RFC 4180), BOM UTF-8 pour les accents ;
 *  - toute cellule texte est entre guillemets, guillemets doubles ;
 *  - un texte qui commence par = + - @ tabulation ou retour chariot recoit une
 *    apostrophe en tete (recommandation OWASP) ;
 *  - SAUF un nombre pur (« -120,50 ») : un avoir negatif ne peut pas etre une
 *    formule, et le transformer en texte casserait les sommes.
 */

export const SEPARATEUR_CSV = ";";
export const FIN_LIGNE_CSV = "\r\n";
export const BOM_CSV = "\uFEFF";

const DEBUT_DE_FORMULE = /^[=+\-@\t\r]/;
const NOMBRE_PUR = /^[+-]?\d+(?:[.,]\d+)?$/;

/** Une cellule CSV sure. */
export function celluleCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "bigint") return Number.isFinite(Number(v)) ? String(v) : "";
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (DEBUT_DE_FORMULE.test(s) && !NOMBRE_PUR.test(s.trim())) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Une ligne CSV. */
export function ligneCsv(cellules: unknown[]): string {
  return cellules.map(celluleCsv).join(SEPARATEUR_CSV);
}

/** Un document complet : BOM, en-tete, lignes, CRLF. */
export function documentCsv(entetes: string[], lignes: unknown[][]): string {
  return BOM_CSV + [ligneCsv(entetes), ...lignes.map(ligneCsv)].join(FIN_LIGNE_CSV) + FIN_LIGNE_CSV;
}
