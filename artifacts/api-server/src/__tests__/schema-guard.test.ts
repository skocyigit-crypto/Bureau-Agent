import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error — script d'outillage en JS pur, volontairement hors du build.
import { destructiveChanges, declaredSchema } from "../../../../lib/db/scripts/schema-guard.mjs";

/**
 * Une poussee de schema ne doit pas pouvoir effacer des donnees par accident.
 *
 * Ce depot ne gere pas son schema par migrations versionnees: il le POUSSE,
 * avec `drizzle-kit push --force`, y compris sur la production
 * (`deploy/gcp-schema-push.sh`, lance a la main). `--force` ne pose aucune
 * question, pas meme pour supprimer une table.
 *
 * Ce n'est pas une inquietude theorique. Le commentaire de `drizzle.config.ts`
 * garde la trace de l'accident evite: `push` avait pris `user_sessions` — creee
 * et detenue par connect-pg-simple, donc absente du schema Drizzle — pour un
 * orphelin, et s'appretait a la « renommer » vers une table nouvellement
 * ajoutee. Sous `--force`, toutes les sessions ouvertes disparaissaient. La
 * parade fut une liste nominative: elle protege ce qu'on a su nommer.
 *
 * `destructiveChanges` protege le reste. Elle est testee ici plutot qu'en
 * integration parce que c'est elle, et rien d'autre, qui autorise une operation
 * irreversible sur les donnees des clients.
 */

const tables = (spec: Record<string, string[]>) =>
  new Map(Object.entries(spec).map(([t, cols]) => [t, new Set(cols)]));

describe("changements destructeurs", () => {
  it("ne signale rien quand la base et le schema coincident", () => {
    const same = { contacts: ["id", "name"], tasks: ["id", "title"] };
    expect(destructiveChanges(tables(same), tables(same))).toEqual({
      droppedTables: [],
      droppedColumns: [],
    });
  });

  it("laisse passer un AJOUT: creer n'a jamais detruit personne", () => {
    const live = tables({ contacts: ["id"] });
    const declared = tables({ contacts: ["id", "email"], factures: ["id"] });
    expect(destructiveChanges(declared, live)).toEqual({
      droppedTables: [],
      droppedColumns: [],
    });
  });

  it("repere une table qui disparaitrait", () => {
    const live = tables({ contacts: ["id"], anciennes_notes: ["id", "texte"] });
    const declared = tables({ contacts: ["id"] });
    expect(destructiveChanges(declared, live).droppedTables).toEqual(["anciennes_notes"]);
  });

  it("repere une colonne qui disparaitrait", () => {
    const live = tables({ contacts: ["id", "name", "iban"] });
    const declared = tables({ contacts: ["id", "name"] });
    expect(destructiveChanges(declared, live).droppedColumns).toEqual(["contacts.iban"]);
  });

  it("voit un RENOMMAGE comme la perte qu'il est reellement", () => {
    // Drizzle ne peut pas deviner qu'une colonne a ete renommee: il supprime
    // puis recree, et les donnees ne suivent pas. C'est la forme la plus
    // courante de la perte accidentelle, et la plus facile a commettre.
    const live = tables({ contacts: ["id", "telephone"] });
    const declared = tables({ contacts: ["id", "phone"] });
    const result = destructiveChanges(declared, live);
    expect(result.droppedColumns).toEqual(["contacts.telephone"]);
  });

  it("ignore les tables detenues par d'autres: c'est l'accident qui a eu lieu", () => {
    // `user_sessions` appartient a connect-pg-simple et n'est PAS dans le
    // schema Drizzle. La signaler ici ferait echouer chaque poussee legitime,
    // et le garde-fou serait desactive dans la semaine.
    const live = tables({ contacts: ["id"], user_sessions: ["sid", "sess", "expire"] });
    const declared = tables({ contacts: ["id"] });
    expect(destructiveChanges(declared, live).droppedTables).toEqual([]);
  });

  it("ignore aussi la table de journal des migrations", () => {
    const live = tables({ contacts: ["id"], __drizzle_migrations: ["id", "hash"] });
    const declared = tables({ contacts: ["id"] });
    expect(destructiveChanges(declared, live).droppedTables).toEqual([]);
  });

  it("rend une liste triee et complete, pas seulement la premiere trouvaille", () => {
    // Le message d'erreur doit permettre de decider, donc de tout voir.
    const live = tables({ a: ["id", "x", "y"], b: ["id"], c: ["id"] });
    const declared = tables({ a: ["id"] });
    const result = destructiveChanges(declared, live);
    expect(result.droppedTables).toEqual(["b", "c"]);
    expect(result.droppedColumns).toEqual(["a.x", "a.y"]);
  });
});

/**
 * Le garde-fou lit-il TOUT le schema.
 *
 * Sa premiere version fermait le corps d'une table sur le premier `\n}` — une
 * accolade en colonne zero. Elle ratait donc en silence la forme multi-lignes,
 * ou l'appel est indente :
 *
 *   export const t = pgTable(
 *     "whatsapp_messages",
 *     { ... },
 *   );
 *
 * Deux tables manquaient. Le garde-fou les a vues comme absentes du schema,
 * donc comme des tables a supprimer, et a fait echouer un deploiement — ce
 * qu'il devait faire: son appel en CI existe precisement pour reperer une
 * derive de sa propre lecture, et il l'a fait des le premier build.
 *
 * Ce test empeche la rechute. Il ne compte pas un nombre fige — qui se
 * perimerait a la table suivante — mais compare la lecture du garde-fou au
 * texte source: chaque `pgTable("...")` du depot doit se retrouver dans le
 * resultat. Un oubli ici rend le garde-fou dangereux dans les deux sens: il
 * bloque des poussees legitimes, et surtout il ne protege pas les tables qu'il
 * n'a pas su lire.
 */
describe("lecture du schema", () => {
  const schemaDir = path.join(__dirname, "..", "..", "..", "..", "lib", "db", "src", "schema");

  it("trouve chaque table declaree dans les fichiers de schema", () => {
    const declared = declaredSchema();
    const namesInSource = new Set<string>();
    for (const file of fs.readdirSync(schemaDir)) {
      if (!file.endsWith(".ts") || file === "index.ts") continue;
      const src = fs.readFileSync(path.join(schemaDir, file), "utf8");
      for (const m of src.matchAll(/pgTable\(\s*["'`]([\w_]+)["'`]/g)) namesInSource.add(m[1]);
    }

    const missing = [...namesInSource].filter((t) => !declared.has(t));
    expect(missing, `tables non lues par le garde-fou: ${missing.join(", ")}`).toEqual([]);
    expect(declared.size).toBe(namesInSource.size);
  });

  it("lit les colonnes d'une table declaree sur plusieurs lignes", () => {
    // La forme exacte qui echappait a la version precedente.
    const declared = declaredSchema();
    const columns = declared.get("whatsapp_processed_messages");
    expect(columns, "whatsapp_processed_messages introuvable").toBeTruthy();
    expect([...columns]).toContain("message_sid");
    expect([...columns]).toContain("organisation_id");
  });
});
