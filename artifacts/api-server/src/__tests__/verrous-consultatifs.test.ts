/**
 * Verrous consultatifs Postgres : deux regles que le depot a deja payees.
 *
 * 1. Un verrou de SESSION (`pg_advisory_lock`, `pg_try_advisory_lock`) ne se
 *    prend jamais par `db.execute` : `db` est un pool, la prise et la
 *    liberation partent sur deux connexions differentes, la liberation est
 *    refusee et le verrou reste detenu par une connexion rendue au pool.
 *    cron-lock.ts l'a documente, la conversion de devis l'a corrige — et trois
 *    sites l'avaient encore : l'execution des propositions de l'agent (double
 *    envoi possible), les invitations et le traitement d'appel (« occupe » a
 *    tort). On passe par `tryWithLock` (connexion dediee) ; le verrou de
 *    TRANSACTION (`pg_advisory_xact_lock` dans `db.transaction`) reste permis.
 *
 * 2. Deux usages ne partagent pas un espace de noms. L'execution des
 *    propositions utilisait 4310 « distinct des namespaces de cron » alors que
 *    `CRON_LOCK_NAMESPACE.trialWarning` valait deja 4310.
 *
 * Premiere assertion de chaque bloc : l'instrument a-t-il vu quelque chose ?
 * Un releve vide compare a une regle vide passerait au vert.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dirname, "..");

function fichiersSource(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) {
      if (nom === "__tests__" || nom === "node_modules") continue;
      out.push(...fichiersSource(chemin));
    } else if (nom.endsWith(".ts")) {
      out.push(chemin);
    }
  }
  return out;
}

const FICHIERS = fichiersSource(SRC).map((f) => ({
  rel: relative(SRC, f).replace(/\\/g, "/"),
  texte: readFileSync(f, "utf8"),
}));

/** Appels a un verrou de session passes par le pool drizzle. */
const SESSION_PAR_POOL = /\bdb\.execute\(\s*sql`\s*SELECT\s+pg_(?:try_)?advisory_(?:un)?lock\s*\(/g;
/** Tout usage d'un verrou consultatif, quel que soit le chemin. */
const TOUT_VERROU = /pg_(?:try_)?advisory_(?:xact_)?(?:un)?lock\s*\(/;

function sitesSessionParPool(texte: string): number {
  return (texte.match(SESSION_PAR_POOL) ?? []).length;
}

/**
 * Releve des espaces de noms : constantes `XXX_NAMESPACE = 4nnn` et entrees
 * de l'objet `CRON_LOCK_NAMESPACE`.
 */
function releverEspaces(): Array<{ ou: string; nom: string; valeur: number }> {
  const out: Array<{ ou: string; nom: string; valeur: number }> = [];
  for (const { rel, texte } of FICHIERS) {
    for (const m of texte.matchAll(/\bconst\s+([A-Z0-9_]*NAMESPACE)\s*=\s*(\d+)\s*;/g)) {
      out.push({ ou: rel, nom: m[1]!, valeur: Number(m[2]) });
    }
    const bloc = texte.match(/CRON_LOCK_NAMESPACE\s*=\s*\{([\s\S]*?)\}\s*as const/);
    if (bloc) {
      for (const m of bloc[1]!.matchAll(/^\s*(\w+)\s*:\s*(\d+)\s*,?/gm)) {
        out.push({ ou: rel, nom: `CRON_LOCK_NAMESPACE.${m[1]}`, valeur: Number(m[2]) });
      }
    }
  }
  return out;
}

describe("verrous de session : jamais par le pool", () => {
  it("l'instrument voit les verrous du depot (garde-fou)", () => {
    const avecVerrou = FICHIERS.filter((f) => TOUT_VERROU.test(f.texte));
    // cron-lock, devis, appointment-offers au minimum.
    expect(avecVerrou.length).toBeGreaterThanOrEqual(3);
    expect(avecVerrou.map((f) => f.rel)).toContain("lib/cron-lock.ts");
  });

  it("le motif reconnait bien la forme fautive (controle de l'instrument)", () => {
    const fautif = "await db.execute(sql`SELECT pg_advisory_lock(${NS}, ${id})`);";
    const fautifTry = "const r = await db.execute(\n  sql`SELECT pg_try_advisory_lock(${NS}, ${id}) AS acquired`\n);";
    const permis = "await tx.execute(sql`SELECT pg_advisory_xact_lock(${NS}, ${id})`);";
    expect(sitesSessionParPool(fautif)).toBe(1);
    expect(sitesSessionParPool(fautifTry)).toBe(1);
    expect(sitesSessionParPool(permis)).toBe(0);
  });

  it("aucun fichier ne prend ni ne relache un verrou de session par db.execute", () => {
    const fautifs = FICHIERS
      .map((f) => ({ rel: f.rel, n: sitesSessionParPool(f.texte) }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.rel} (${x.n})`);
    expect(fautifs, "utiliser tryWithLock (lib/cron-lock.ts) : connexion dediee").toEqual([]);
  });

  it("les trois sites corriges passent par tryWithLock", () => {
    for (const rel of ["services/autonomous-secretary.ts", "routes/invitations.ts", "services/call-processor.ts"]) {
      const f = FICHIERS.find((x) => x.rel === rel);
      expect(f, rel).toBeDefined();
      expect(f!.texte, rel).toMatch(/\btryWithLock\(/);
    }
  });
});

describe("espaces de noms des verrous : un par usage", () => {
  const espaces = releverEspaces();

  it("l'instrument releve les espaces du depot (garde-fou)", () => {
    // 12 crons + appel + creneaux + devis + invitations + propositions.
    expect(espaces.length).toBeGreaterThanOrEqual(15);
    expect(espaces.some((e) => e.nom === "CRON_LOCK_NAMESPACE.trialWarning")).toBe(true);
    expect(espaces.some((e) => e.nom === "PROPOSAL_LOCK_NAMESPACE")).toBe(true);
  });

  it("aucune valeur n'est partagee par deux usages", () => {
    const parValeur = new Map<number, string[]>();
    for (const e of espaces) {
      parValeur.set(e.valeur, [...(parValeur.get(e.valeur) ?? []), `${e.nom} (${e.ou})`]);
    }
    const collisions = [...parValeur.entries()]
      .filter(([, usages]) => usages.length > 1)
      .map(([v, usages]) => `${v}: ${usages.join(" / ")}`);
    expect(collisions).toEqual([]);
  });
});
