/**
 * Lire un CSV d'import — y compris ceux que l'application exporte.
 *
 * MESURE LE 17/09 : l'import de contacts decoupait chaque ligne sur le
 * separateur, sans tenir compte des guillemets. Trois consequences :
 *
 *  - le BOM UTF-8 (que nos exports posent pour Excel) collait au premier
 *    en-tete : « \uFEFFPrénom » ne correspondait plus a « Prénom », et la
 *    colonne des prenoms disparaissait au re-import d'un export ;
 *  - une adresse « 3 rue X; bat. B » entre guillemets coupait la ligne ;
 *  - des guillemets doubles (« "" ») restaient doubles.
 *
 * Et l'apostrophe que l'export ajoute devant une valeur commencant par
 * = + - @ (protection contre l'injection de formule) doit etre retiree a la
 * relecture, sinon « -Durand » deviendrait « '-Durand ».
 */

const APOSTROPHE_DE_PROTECTION = /^'(?=[=+\-@\t\r])/;

export function detecterSeparateur(premiereLigne: string): ";" | "," {
  let pv = 0, v = 0, q = false;
  for (const c of premiereLigne) {
    if (c === '"') q = !q;
    else if (!q && c === ";") pv++;
    else if (!q && c === ",") v++;
  }
  return pv >= v && pv > 0 ? ";" : ",";
}

/** Tableau de lignes (RFC 4180 : guillemets, "" et retours a la ligne dans une cellule). */
export function lireCsv(texte: string): string[][] {
  // Retrait explicite. Mesure : `trim()` enleve aussi le BOM (espace au sens JS),
  // la mutation qui supprime cette ligne survit donc \u2014 on la garde pour ne pas
  // dependre d'une subtilite de `trim`.
  const t = texte.replace(/^\uFEFF/, "");
  const finPremiere = t.search(/\r?\n/);
  const sep = detecterSeparateur(finPremiere < 0 ? t : t.slice(0, finPremiere));
  const lignes: string[][] = [];
  let ligne: string[] = [], cell = "", q = false, citee = false;
  const pousser = () => { ligne.push(citee ? cell : cell.trim()); cell = ""; citee = false; };
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell.trim() === "") { q = true; citee = true; cell = ""; }
    else if (c === sep) pousser();
    else if (c === "\n" || (c === "\r" && t[i + 1] === "\n")) {
      if (c === "\r") i++;
      pousser(); lignes.push(ligne); ligne = [];
    } else cell += c;
  }
  if (cell !== "" || ligne.length > 0) { pousser(); lignes.push(ligne); }
  return lignes
    .map((l) => l.map((v) => v.replace(APOSTROPHE_DE_PROTECTION, "")))
    .filter((l) => l.some((v) => v !== ""));
}

/** Objets indexes par en-tete. */
export function lireCsvObjets(texte: string): Record<string, string>[] {
  const [entetes, ...lignes] = lireCsv(texte);
  if (!entetes || lignes.length === 0) return [];
  return lignes.map((l) => Object.fromEntries(entetes.map((h, i) => [h, l[i] ?? ""])));
}
