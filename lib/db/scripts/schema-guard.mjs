#!/usr/bin/env node
/**
 * Refuse un `drizzle-kit push` qui detruirait des donnees.
 *
 * Pourquoi ce garde-fou existe. Le schema de ce depot n'est pas gere par des
 * migrations versionnees: il est POUSSE, avec `drizzle-kit push --force`, y
 * compris sur la base de production (`deploy/gcp-schema-push.sh`, lance a la
 * main). `--force` veut dire exactement ce qu'il dit — aucune question posee,
 * meme pour supprimer une table ou une colonne.
 *
 * Ce n'est pas une inquietude theorique. Le commentaire de `drizzle.config.ts`
 * raconte l'accident evite de justesse: `push` avait pris la table
 * `user_sessions` — creee et detenue par connect-pg-simple, donc absente du
 * schema Drizzle — pour un orphelin, et s'appretait a la « renommer » vers une
 * table nouvellement ajoutee. Sous `--force`, cela aurait efface les sessions
 * de tous les utilisateurs connectes. La parade retenue fut un `tablesFilter`
 * nominatif, c'est-a-dire une liste a tenir a jour a la main: elle protege la
 * table qu'on a su nommer, et aucune autre.
 *
 * Ce script protege les autres. Il compare ce que la base contient a ce que le
 * schema declare, et refuse la poussee si elle ferait disparaitre quoi que ce
 * soit — a moins qu'on ne l'ait explicitement voulu:
 *
 *   ALLOW_DESTRUCTIVE_SCHEMA=true pnpm push
 *
 * Une suppression reste possible, elle cesse simplement d'etre accidentelle.
 *
 * Usage: node ./scripts/schema-guard.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(here, "..", "src", "schema");

/**
 * Objets que Drizzle ne connait pas et ne doit jamais toucher.
 *
 * `user_sessions` appartient a connect-pg-simple. Elle est deja exclue par le
 * `tablesFilter` de la configuration, mais on la reprend ici: un garde-fou qui
 * depend d'un autre garde-fou ne protege rien le jour ou le premier saute.
 */
const EXTERNALLY_OWNED = new Set(["user_sessions", "drizzle_migrations", "__drizzle_migrations"]);

// ── Lecture du schema declare ────────────────────────────────────────────────

/** Tables et colonnes telles que le code source les declare. */
export function declaredSchema(dir = schemaDir) {
  const tables = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".ts") || file === "index.ts") continue;
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const tableRe = /pgTable\(\s*["'`]([\w_]+)["'`]\s*,\s*\{([\s\S]*?)\n\}/g;
    let m;
    while ((m = tableRe.exec(src))) {
      const [, tableName, body] = m;
      const columns = new Set();
      // `nom: type("colonne_en_base", ...)` — c'est le nom en base qui compte.
      const colRe = /\b\w+\s*:\s*\w+\(\s*["'`]([\w_]+)["'`]/g;
      let c;
      while ((c = colRe.exec(body))) columns.add(c[1]);
      tables.set(tableName, columns);
    }
  }
  return tables;
}

// ── Comparaison, isolee pour etre testable sans base ─────────────────────────

/**
 * Ce qu'une poussee ferait disparaitre.
 *
 * Fonction PURE et testee: c'est elle qui decide d'autoriser ou non une
 * operation irreversible sur les donnees des clients, et une regression ici
 * serait silencieuse dans le sens le plus couteux.
 */
export function destructiveChanges(declared, live) {
  const droppedTables = [];
  const droppedColumns = [];

  for (const [table, liveColumns] of live) {
    if (EXTERNALLY_OWNED.has(table)) continue;
    const declaredColumns = declared.get(table);
    if (!declaredColumns) {
      droppedTables.push(table);
      continue;
    }
    for (const column of liveColumns) {
      if (!declaredColumns.has(column)) droppedColumns.push(`${table}.${column}`);
    }
  }

  return { droppedTables: droppedTables.sort(), droppedColumns: droppedColumns.sort() };
}

// ── Execution ────────────────────────────────────────────────────────────────

async function liveSchema(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, column_name
    `);
    const tables = new Map();
    for (const row of rows) {
      if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
      tables.get(row.table_name).add(row.column_name);
    }
    return tables;
  } finally {
    await client.end();
  }
}

// Import direct (tests) plutot qu'execution: on ne touche a rien.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[schema-guard] DATABASE_URL est requis.");
    process.exit(1);
  }

  const declared = declaredSchema();
  let live;
  try {
    live = await liveSchema(url);
  } catch (err) {
    // Base vide ou inaccessible: rien a detruire, rien a garder. On laisse
    // passer plutot que de bloquer une premiere installation.
    console.log(`[schema-guard] Base non lisible (${err.message}) — aucune verification possible, on continue.`);
    process.exit(0);
  }

  if (live.size === 0) {
    console.log("[schema-guard] Base vide: premiere installation, rien a proteger.");
    process.exit(0);
  }

  const { droppedTables, droppedColumns } = destructiveChanges(declared, live);

  if (droppedTables.length === 0 && droppedColumns.length === 0) {
    console.log(`[schema-guard] Aucune perte de donnees (${live.size} tables comparees).`);
    process.exit(0);
  }

  console.error("\n[schema-guard] Cette poussee DETRUIRAIT des donnees.\n");
  if (droppedTables.length > 0) {
    console.error(`  Tables supprimees (${droppedTables.length}) :`);
    for (const t of droppedTables) console.error(`    - ${t}`);
  }
  if (droppedColumns.length > 0) {
    console.error(`  Colonnes supprimees (${droppedColumns.length}) :`);
    for (const c of droppedColumns) console.error(`    - ${c}`);
  }

  if (process.env.ALLOW_DESTRUCTIVE_SCHEMA === "true") {
    console.error("\n  ALLOW_DESTRUCTIVE_SCHEMA=true : poursuite demandee explicitement.\n");
    process.exit(0);
  }

  console.error(
    "\n  Poussee interrompue. Si la suppression est voulue, relancer avec :\n" +
    "    ALLOW_DESTRUCTIVE_SCHEMA=true <commande>\n\n" +
    "  Si elle ne l'est pas, c'est probablement qu'une table ou une colonne a ete\n" +
    "  renommee dans le schema sans l'etre en base : Drizzle voit alors une\n" +
    "  suppression suivie d'une creation, et les donnees ne suivent pas.\n",
  );
  process.exit(1);
}
