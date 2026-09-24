/**
 * Les index declares par le schema existent VRAIMENT dans la base.
 *
 * Le 23/09/2026, une poussee de schema a echoue en cours de route — une
 * violation de cle etrangere — et `drizzle-kit push` a pourtant rendu un code
 * de SUCCES. Resultat : 222 index sur 333 n'ont jamais ete crees, et le
 * verificateur a repondu « schema sync verified », parce qu'il ne comparait
 * que des tables et des colonnes.
 *
 * Ce que l'on perd alors n'est pas du confort. Les index absents portaient
 * notamment l'unicite du numero de facture, celle des evenements Stripe et
 * celle de l'etat de position — c'est-a-dire les garde-fous qui empechent une
 * facture en double, un double encaissement, et une erreur 500 a chaque ping.
 * Le code compte dessus : il ecrit `ON CONFLICT`, et PostgreSQL refuse cette
 * clause quand la contrainte correspondante n'existe pas.
 *
 * Une base peut donc paraitre saine en ayant perdu exactement ce qui garantit
 * l'unicite. D'ou ce controle, qui derive la liste DU SCHEMA — une liste
 * tenue a la main ne protege que ce qu'on a pense a y mettre.
 *
 * CE QU'IL NE COUVRE PAS, et il vaut mieux l'ecrire que le laisser croire :
 * il compare des NOMS et, pour les unicites, le fait qu'elles soient bien
 * UNIQUE. Un index qui porterait le bon nom sur d'autres colonnes passerait
 * — cas d'une migration ecrite a la main, que ce depot ne pratique pas, la
 * base etant poussee depuis le schema.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const DOSSIER_SCHEMA = join(import.meta.dirname, "..", "..", "..", "..", "lib", "db", "src", "schema");

/** Les noms d'index ecrits dans le schema, `index(...)` et `uniqueIndex(...)`. */
function indexDeclares(): { tous: string[]; uniques: string[] } {
  const tous = new Set<string>();
  const uniques = new Set<string>();
  for (const fichier of readdirSync(DOSSIER_SCHEMA)) {
    if (!fichier.endsWith(".ts")) continue;
    const source = readFileSync(join(DOSSIER_SCHEMA, fichier), "utf8");
    for (const m of source.matchAll(/\buniqueIndex\(\s*"([^"]+)"/g)) { uniques.add(m[1]!); tous.add(m[1]!); }
    for (const m of source.matchAll(/(?<!unique)\bindex\(\s*"([^"]+)"/g)) tous.add(m[1]!);
  }
  return { tous: [...tous], uniques: [...uniques] };
}

/** Les index de la base, avec leur VALIDITE — un index invalide n'applique rien. */
async function indexEnBaseDetail(): Promise<Map<string, boolean>> {
  const r = await db.execute(sql`
    SELECT c.relname AS indexname, i.indisvalid AS valide
      FROM pg_class c
      JOIN pg_index i ON i.indexrelid = c.oid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
  `);
  const lignes = (r as unknown as { rows?: Array<{ indexname: string; valide: boolean }> }).rows
    ?? (r as unknown as Array<{ indexname: string; valide: boolean }>);
  return new Map(lignes.map((l) => [l.indexname, l.valide !== false]));
}

async function indexEnBase(): Promise<Set<string>> {
  return new Set((await indexEnBaseDetail()).keys());
}

describe("le schema et la base disent la meme chose", () => {
  it("le releve du schema trouve bien quelque chose a comparer", () => {
    // Garde-fou du controle lui-meme : un dossier deplace rendrait une liste
    // vide, et une liste vide est satisfaite par n'importe quelle base.
    const { tous, uniques } = indexDeclares();
    expect(tous.length, "aucun index lu dans le schema").toBeGreaterThan(100);
    expect(uniques.length, "aucune unicite lue dans le schema").toBeGreaterThan(10);
  });

  it("chaque index declare existe dans la base", async () => {
    const { tous } = indexDeclares();
    const presents = await indexEnBase();
    const manquants = tous.filter((n) => !presents.has(n));
    expect(manquants, `poussee de schema incomplete : ${manquants.length} index absents`).toEqual([]);
  });

  it("chaque unicite declaree existe, et est bien UNIQUE en base", async () => {
    // Un index cree sans le mot UNIQUE porterait le bon nom sans rien
    // garantir : deux factures pourraient recevoir le meme numero.
    const { uniques } = indexDeclares();
    const r = await db.execute(
      sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const lignes = (r as unknown as { rows?: Array<{ indexname: string; indexdef: string }> }).rows
      ?? (r as unknown as Array<{ indexname: string; indexdef: string }>);
    const parNom = new Map(lignes.map((l) => [l.indexname, l.indexdef]));
    const fautifs = uniques.filter((n) => !parNom.has(n) || !/CREATE UNIQUE INDEX/i.test(parNom.get(n)!));
    expect(fautifs, "unicites absentes ou non uniques").toEqual([]);
  });
});

describe("les unicites dont le code depend nommement", () => {
  // Ces quatre-la sont citees par du code qui ecrit `ON CONFLICT` : sans
  // elles, PostgreSQL ne refuse pas le doublon, il refuse la REQUETE.
  const CRITIQUES = [
    ["factures_client_org_reference_unique", "deux factures au meme numero (art. 242 nonies A ann. II CGI)"],
    ["encaissements_org_numero_unique", "deux ecritures de reglement au meme numero (art. 286-I-3 bis CGI)"],
    ["invoices_stripe_invoice_id_unique", "un paiement Stripe encaisse deux fois"],
    ["user_location_state_user_uniq", "l'upsert de position tombe en erreur 500"],
  ] as const;

  for (const [nom, consequence] of CRITIQUES) {
    it(`${nom} — sinon : ${consequence}`, async () => {
      // Present ET valide, nommement. Compter ne suffirait pas : un index
      // invalide se compte comme les autres et n'applique rien. (Piege releve
      // par la session Assise le 24/09/2026, sur son propre controle.)
      const detail = await indexEnBaseDetail();
      expect(detail.has(nom), `index ${nom} absent`).toBe(true);
      expect(detail.get(nom), `index ${nom} present mais INVALIDE : il n'applique rien`).toBe(true);
    });
  }

  it("aucun index declare n'est invalide", async () => {
    // Un CREATE INDEX CONCURRENTLY interrompu laisse un index invalide, que
    // `IF NOT EXISTS` retrouve ensuite et ignore : il porte le bon nom pour
    // toujours, sans rien garantir.
    const detail = await indexEnBaseDetail();
    const invalides = indexDeclares().tous.filter((n) => detail.has(n) && detail.get(n) === false);
    expect(invalides, "index presents mais sans effet").toEqual([]);
  });
});

describe("le verificateur de poussee compare aussi les index", () => {
  const SCRIPT = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "..", "lib", "db", "scripts", "verify-schema-sync.mjs"),
    "utf8",
  );

  it("il lit le schema plutot qu'une liste tenue a la main", () => {
    expect(SCRIPT).toContain("indexDeclaresDansLeSchema");
    expect(SCRIPT).toMatch(/readdirSync/);
  });

  it("il interroge la base sur ses index", () => {
    expect(SCRIPT).toMatch(/pg_indexes/);
  });

  it("un index manquant le fait echouer, avec les noms", () => {
    expect(SCRIPT).toMatch(/manquants/);
    expect(SCRIPT).toMatch(/failures\.push\(/);
  });

  it("une lecture vide du schema est signalee, pas prise pour un succes", () => {
    // Le piege classique : le controle ne mesure plus rien et repond vert.
    expect(SCRIPT).toMatch(/aucun index declare trouve/);
  });
});
