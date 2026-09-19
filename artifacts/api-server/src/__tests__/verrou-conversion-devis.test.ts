/**
 * Le verrou de conversion etait pris et relache sur deux connexions.
 *
 * `pg_advisory_lock` appartient a la SESSION, c'est-a-dire a la connexion qui
 * l'a pris. `db` est un pool : `db.execute(...)` emprunte une connexion au
 * hasard. La prise et la liberation partaient donc sur deux connexions
 * differentes, Postgres refusait la liberation (« you don't own a lock of this
 * type »), et le `.catch(() => {})` avalait ce refus.
 *
 * Consequence propre a CETTE route, et plus grave que pour un cron :
 * `pg_advisory_lock` ATTEND, il ne renonce pas. La conversion suivante du MEME
 * devis se bloquait indefiniment — la requete HTTP ne repondait plus, et
 * l'utilisateur voyait « Convertir en facture » tourner sans fin, sans erreur
 * ni delai.
 *
 * `lib/cron-lock.ts` documente ce piege en detail et le resout depuis
 * longtemps par une connexion dediee. Cette route ne l'avait pas suivi.
 *
 * Les controles ci-dessous PRENNENT un vrai verrou sur la base de test : un
 * controle qui se contenterait de lire le code ne dirait rien de ce que
 * Postgres accepte reellement.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "@workspace/db";

const NS = 4320;
const CLE = 987_651;

/** Le verrou est-il detenu par quelqu'un ? */
async function verrouDetenu(namespace: number, cle: number): Promise<boolean> {
  const r = await pool.query(
    "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = $1 AND objid = $2",
    [namespace, cle],
  );
  return (r.rows[0]?.n ?? 0) > 0;
}

describe("un verrou consultatif se libere sur la connexion qui l'a pris", () => {
  it("la liberation sur UNE AUTRE connexion echoue — c'est la cause du defaut", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("SELECT pg_advisory_lock($1, $2)", [NS, CLE]);
      const r = await b.query("SELECT pg_advisory_unlock($1, $2) AS libere", [NS, CLE]);
      expect(
        r.rows[0]?.libere,
        "si Postgres liberait depuis une autre connexion, le defaut n'existerait pas",
      ).toBe(false);
      expect(await verrouDetenu(NS, CLE), "le verrou reste detenu").toBe(true);
    } finally {
      await a.query("SELECT pg_advisory_unlock($1, $2)", [NS, CLE]).catch(() => {});
      a.release();
      b.release();
    }
  });

  it("la liberation sur la MEME connexion aboutit, et rend le verrou", async () => {
    const c = await pool.connect();
    try {
      await c.query("SELECT pg_advisory_lock($1, $2)", [NS, CLE + 1]);
      const r = await c.query("SELECT pg_advisory_unlock($1, $2) AS libere", [NS, CLE + 1]);
      expect(r.rows[0]?.libere).toBe(true);
      expect(await verrouDetenu(NS, CLE + 1)).toBe(false);
    } finally {
      c.release();
    }
  });

  it("un verrou non libere bloquerait bien la demande suivante", async () => {
    // C'est le symptome exact: la seconde conversion ATTEND, elle n'echoue
    // pas. On le mesure avec `try`, qui rend `false` au lieu d'attendre.
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("SELECT pg_advisory_lock($1, $2)", [NS, CLE + 2]);
      const r = await b.query("SELECT pg_try_advisory_lock($1, $2) AS pris", [NS, CLE + 2]);
      expect(
        r.rows[0]?.pris,
        "sans cela, le verrou ne protegerait rien",
      ).toBe(false);
    } finally {
      await a.query("SELECT pg_advisory_unlock($1, $2)", [NS, CLE + 2]).catch(() => {});
      a.release();
      b.release();
    }
  });
});

describe("la route de conversion suit ce modele", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "routes", "devis.ts"), "utf8",
  );
  const bloc = source.slice(source.indexOf('"/devis/:id/convert-to-facture"'));

  it("elle prend une connexion dediee", () => {
    expect(bloc.slice(0, 12000), "sans connexion dediee, la liberation part ailleurs").toMatch(/pool\.connect\(\)/);
  });

  it("verrou et liberation passent par cette connexion", () => {
    expect(bloc.slice(0, 12000)).toMatch(/client\.query\("SELECT pg_advisory_lock/);
    expect(bloc.slice(0, 12000)).toMatch(/client\.query\("SELECT pg_advisory_unlock/);
  });

  it("elle n'utilise plus le pool anonyme pour ces deux ordres", () => {
    const lignes = bloc.slice(0, 12000).split("\n")
      .filter((l) => { const t = l.trimStart(); return !t.startsWith("//") && !t.startsWith("*"); });
    expect(
      lignes.join("\n"),
      "db.execute emprunte une connexion au hasard: c'est exactement le defaut",
    ).not.toMatch(/db\.execute\(sql`SELECT pg_advisory/);
  });

  it("la connexion est rendue au pool quoi qu'il arrive", () => {
    // Une liberation refusee ne doit pas retenir la connexion en plus du
    // verrou: le `release()` a son propre `finally`.
    expect(bloc.slice(0, 12000)).toMatch(/finally \{\s*\n\s*client\.release\(\);/);
  });

  it("un verrou indisponible rend une reponse, au lieu de faire attendre", () => {
    expect(bloc.slice(0, 12000)).toMatch(/503/);
  });
});
