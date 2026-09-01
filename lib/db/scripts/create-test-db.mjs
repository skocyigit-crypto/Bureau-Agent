/**
 * Cree la base de tests locale si elle n'existe pas, puis y charge le schema.
 *
 * Les tests de la couche base VIDENT des tables: ils ne doivent jamais viser
 * une base de travail. On isole donc une base dediee et jetable, dont le nom
 * est distinctif pour qu'aucune base existante ne soit prise pour elle.
 *
 * Le script est idempotent: relancable sans effet si la base est deja la. Il
 * ne SUPPRIME jamais rien — repartir de zero reste un geste volontaire
 * (`DROP DATABASE bureau_agent_test`), pas un effet de bord.
 */
import pg from "pg";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NAME = process.env.TEST_DB_NAME || "bureau_agent_test";
// Base d'administration: on ne peut pas creer une base depuis elle-meme.
const ADMIN_URL =
  process.env.TEST_DB_ADMIN_URL || "postgres://postgres@127.0.0.1:5432/postgres";

if (!/^[a-z_][a-z0-9_]*$/.test(NAME)) {
  // Le nom part dans un CREATE DATABASE, qui n'accepte pas de parametre lie.
  console.error(`[db] nom de base invalide: ${NAME}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: ADMIN_URL });
try {
  await client.connect();
} catch (err) {
  console.error(`[db] connexion impossible a ${ADMIN_URL}`);
  console.error(`[db] ${err.message}`);
  console.error("[db] Postgres est-il demarre ? Sinon, definir TEST_DB_ADMIN_URL.");
  process.exit(1);
}

try {
  const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [NAME]);
  if (rows.length > 0) {
    console.log(`[db] base de tests "${NAME}" deja presente`);
  } else {
    await client.query(`CREATE DATABASE ${NAME}`);
    console.log(`[db] base de tests "${NAME}" creee`);
  }
} finally {
  await client.end();
}

// Chargement du schema. On enchaine ici plutot que dans package.json: definir
// une variable d'environnement pour une seule commande n'a pas de syntaxe
// commune entre cmd.exe, PowerShell et sh, et ce depot se developpe sous
// Windows.
//
// Commande passee en une seule chaine: avec `shell: true`, un tableau
// d'arguments serait concatene sans echappement (DEP0190). Ici la commande
// est entierement litterale, donc il n'y a rien a echapper.
const url = ADMIN_URL.replace(/\/[^/]*$/, `/${NAME}`);
console.log("[db] chargement du schema...");
const res = spawnSync("npm run push", {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, DATABASE_URL: url },
  stdio: "inherit",
  shell: true,
});
if (res.status !== 0) process.exit(res.status ?? 1);
console.log(`[db] pret. Les tests utiliseront ${url}`);
