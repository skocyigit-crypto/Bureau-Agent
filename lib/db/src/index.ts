import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// ── Pool sizing & timeouts ─────────────────────────────────────────────────
// max=20 reste raisonnable pour un Postgres standard (Replit/Neon 100 conn).
// statement_timeout: defense-in-depth contre les requetes lourdes/malicieuses
//   (jointures explosives, regex catastrophic backtracking cote pg, etc.)
//   qui sinon mobiliseraient une connexion du pool jusqu'a expiration ->
//   epuisement du pool et DoS de l'app entiere.
// query_timeout: cote node-postgres (cancelle le client). Doit etre >=
//   statement_timeout pour laisser PG annuler proprement.
// idle_in_transaction_session_timeout: ferme une transaction ouverte oubliee
//   (bug applicatif ou client deconnecte) qui sinon tient un verrou.
// lock_timeout: ne JAMAIS attendre indefiniment un verrou row/table.
// keepAlive: detecte les connexions tuees par un middlebox (load balancer,
//   firewall NAT) avant qu'elles n'arrivent en silence "dead" dans le pool.
const STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "30000", 10);
const LOCK_TIMEOUT_MS = parseInt(process.env.DB_LOCK_TIMEOUT_MS || "5000", 10);
const IDLE_TX_TIMEOUT_MS = parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT_MS || "60000", 10);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  allowExitOnIdle: false,
  // node-postgres timeout — coupe la requete cote client si PG ne repond pas.
  // On ajoute 2s a statement_timeout pour laisser PG annuler en premier.
  query_timeout: STATEMENT_TIMEOUT_MS + 2000,
  statement_timeout: STATEMENT_TIMEOUT_MS,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on("error", (err) => {
  console.error("[DB Pool] Unexpected client error:", err.message);
});

// Sur chaque NOUVELLE connexion physique, on enforce les timeouts cote
// session PG (en plus de statement_timeout/lock_timeout deja passes via
// les params de connexion). Couvre le cas ou un client utilise une
// transaction longue: idle_in_transaction_session_timeout libere la
// connexion si la transaction reste oisive trop longtemps.
pool.on("connect", async (client) => {
  try {
    await client.query(`SET lock_timeout = ${LOCK_TIMEOUT_MS}`);
    await client.query(`SET idle_in_transaction_session_timeout = ${IDLE_TX_TIMEOUT_MS}`);
    // search_path explicite -> empeche un attaquant qui aurait CREATE sur
    // un schema "public-like" d'intercepter des appels via shadowing.
    await client.query(`SET search_path = "$user", public`);
  } catch (err: any) {
    console.error("[DB Pool] Failed to set session timeouts:", err.message);
  }
});

export const db = drizzle(pool, { schema });

export async function checkDbHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export * from "./schema";
