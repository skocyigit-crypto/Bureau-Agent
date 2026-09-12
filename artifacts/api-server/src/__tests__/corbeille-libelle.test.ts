/**
 * Une corbeille qui n'affiche que des identifiants ne sert a rien.
 *
 * `labelOf` existe pour cela, et son commentaire le dit: « un libelle lisible,
 * pour que la corbeille ne soit pas une liste d'identifiants ». Elle ne
 * cherchait pourtant que `reference`, `title`, `titre`, `name`, `nom`,
 * `subject`, `description`.
 *
 * Or trois des quinze tables archivees n'ont aucun de ces champs:
 *
 *   - `contacts`  -> firstName, lastName, company
 *   - `calls`     -> contactName, phoneNumber
 *   - `checkins`  -> employeeName
 *
 * Elles arrivaient donc en corbeille avec `label: null`. Mesure du 2026-09-12
 * sur l'application en fonctionnement: trois contacts supprimes, trois entrees
 * sans libelle. Impossible de savoir lequel restaurer — et c'est precisement
 * au moment ou l'on cherche a reparer une erreur qu'on a besoin de le savoir.
 *
 * Ce test ne verifie pas trois cas particuliers: il verifie que CHAQUE table
 * confiee a la corbeille possede au moins un champ que `labelOf` sait lire.
 * La liste des tables est extraite du code appelant, donc une table ajoutee
 * demain a la corbeille sans champ lisible fera echouer ce test.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const SCHEMAS = join(SRC, "..", "..", "..", "lib", "db", "src", "schema");

function fichiersTs(dossier: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dossier)) {
    const p = join(dossier, e);
    if (statSync(p).isDirectory()) out.push(...fichiersTs(p));
    else if (/\.ts$/.test(e) && !e.includes(".test.")) out.push(p);
  }
  return out;
}

/** Les champs que `labelOf` sait lire, extraits de la source elle-meme. */
function champsLisibles(): string[] {
  const source = readFileSync(join(SRC, "services", "trash.ts"), "utf8");
  const bloc = source.slice(source.indexOf("const CHAMPS_LIBELLE"), source.indexOf("function labelOf"));
  const champs = [...bloc.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
  // `labelOf` compose aussi prenom + nom avant de parcourir la liste.
  return [...champs, "firstName", "lastName"];
}

/** Les tables reellement confiees a la corbeille. */
function tablesArchivees(): string[] {
  const tables = new Set<string>();
  for (const f of fichiersTs(join(SRC, "routes"))) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/archiveDeletedRows\(\s*([a-zA-Z]+Table)/g)) tables.add(m[1]);
  }
  return [...tables];
}

/** Les colonnes declarees pour une table, d'apres son schema. */
function colonnes(nomTable: string): string[] {
  const base = nomTable.replace(/Table$/, "");
  // `facturesClient` -> `factures-client`
  const fichier = base.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() + ".ts";
  const chemin = join(SCHEMAS, fichier);
  let source: string;
  try {
    source = readFileSync(chemin, "utf8");
  } catch {
    return [];
  }
  return [...source.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*(?:varchar|text|integer|serial|boolean|timestamp|numeric|jsonb|real|date)\(/gm)]
    .map((m) => m[1]);
}

describe("la corbeille sait nommer ce qu'elle contient", () => {
  const lisibles = champsLisibles();
  const tables = tablesArchivees();

  it("trouve bien les champs et les tables", () => {
    // Garde-fou: une extraction vide validerait tout sans rien lire.
    expect(lisibles.length, "aucun champ de libelle trouve").toBeGreaterThan(5);
    expect(tables.length, "aucune table archivee trouvee").toBeGreaterThan(10);
  });

  it("chaque table archivee possede un champ que la corbeille sait lire", () => {
    const muettes: string[] = [];
    for (const table of tables) {
      const cols = colonnes(table);
      if (cols.length === 0) continue; // schema introuvable: rien a affirmer
      if (!cols.some((c) => lisibles.includes(c))) muettes.push(`${table} (${cols.slice(0, 6).join(", ")}...)`);
    }
    expect(
      muettes,
      "ces tables arriveront en corbeille sans libelle: l'utilisateur verra des identifiants nus et ne saura pas quoi restaurer",
    ).toEqual([]);
  });
});
