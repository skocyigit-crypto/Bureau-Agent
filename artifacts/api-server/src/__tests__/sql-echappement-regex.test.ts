/**
 * Un motif d'expression reguliere dans un gabarit `sql` s'ecrit avec DEUX
 * barres obliques inverses.
 *
 * Mesure du 28/09 : dans un gabarit etiquete, « \D » est cuit en « D » — la
 * barre disparait avant meme que drizzle ne voie la chaine. La secretaire
 * telephonique envoyait donc `regexp_replace(tel, 'D', '', 'g')` a Postgres,
 * qui ne retirait que la lettre D : un numero enregistre avec des espaces
 * (« +33 6 11 11 11 11 ») n'etait jamais reconnu, l'appelant restait
 * « inconnu » et la note n'allait pas a son dossier. `'\\D'` donne bien `\D`.
 *
 * Ce controle lit les sources ; il ne peut pas voir un motif construit a
 * l'execution, seulement celui ecrit dans un gabarit.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const SRC = join(import.meta.dirname, "..");

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) { if (nom !== "__tests__") out.push(...fichiers(p)); }
    else if (nom.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Corps des gabarits `sql\`...\`` d'un source (sans les ${...}). */
function gabaritsSql(src: string): string[] {
  return [...src.matchAll(/\bsql`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]!.replace(/\$\{[^}]*\}/g, "${}"));
}

/** Une classe d'echappement (\d \D \s \S \w \W \b) precedee d'UNE seule barre. */
const SIMPLE_BARRE = /(^|[^\\])\\[dDsSwWbB]/;
const DOUBLE_BARRE = /\\\\[dDsSwWbB]/;

const SOURCES = fichiers(SRC).map((f) => ({ rel: relative(SRC, f).replace(/\\/g, "/"), texte: readFileSync(f, "utf8") }));

describe("motifs d'expression reguliere dans les gabarits sql", () => {
  it("l'instrument voit des gabarits sql et des motifs correctement echappes (garde-fou)", () => {
    const tous = SOURCES.flatMap((s) => gabaritsSql(s.texte));
    expect(tous.length).toBeGreaterThan(100);
    expect(tous.filter((g) => DOUBLE_BARRE.test(g)).length).toBeGreaterThanOrEqual(5);
  });

  it("ce que la regle interdit est bien ce que drizzle deforme (controle de l'instrument)", () => {
    const d = new PgDialect();
    // eslint-disable-next-line no-useless-escape
    expect(d.sqlToQuery(sql`regexp_replace(x, '\D', '', 'g')`).sql).toContain("'D'");
    expect(d.sqlToQuery(sql`regexp_replace(x, '\\D', '', 'g')`).sql).toContain("'\\D'");
    expect(SIMPLE_BARRE.test(String.raw`regexp_replace(x, '\D', '')`)).toBe(true);
    expect(SIMPLE_BARRE.test(String.raw`regexp_replace(x, '\\D', '')`)).toBe(false);
  });

  it("aucun gabarit sql n'ecrit \\D, \\s, \\w… avec une seule barre", () => {
    const fautifs = SOURCES.flatMap((s) => gabaritsSql(s.texte)
      .filter((g) => SIMPLE_BARRE.test(g))
      .map((g) => `${s.rel}: ${g.slice(0, 90)}`));
    expect(fautifs, "ecrire '\\\\D' : une seule barre est cuite et disparait").toEqual([]);
  });
});
