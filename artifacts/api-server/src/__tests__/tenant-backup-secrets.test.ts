/**
 * Aucun secret vivant dans la sauvegarde telechargeable.
 *
 * La sauvegarde d'une organisation se telecharge : elle finit dans un dossier
 * de telechargements, une piece jointe, une cle USB. Les colonnes portant un
 * secret y sont remplacees par null (REDACTED_COLUMNS).
 *
 * Cette liste etait tenue A LA MAIN, et le test qui la gardait l'etait aussi.
 * Le 21/09/2026, en y ajoutant la table des plateformes agreees, on a trouve
 * qu'elle laissait partir en clair :
 *  - users.reset_password_token : de quoi reinitialiser un mot de passe ;
 *  - invitations.token : un lien d'entree dans l'organisation ;
 *  - api_keys.key_encrypted, subscriptions.license_key, demo_handoffs.claim_token,
 *    users.email_verification_token, appointment_offers.token, push_tokens.token.
 *
 * Ce controle derive la liste du SCHEMA : toute colonne dont le nom dit
 * « secret », « token », « password », « chiffre », « encrypted » ou « key » doit
 * etre caviardee ou exclue explicitement, avec sa raison.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REDACTED_COLUMNS, TENANT_TABLES, redactRow } from "../services/tenant-backup";

const SCHEMA = join(import.meta.dirname, "..", "..", "..", "..", "lib", "db", "src", "schema");

/** Colonnes au nom evocateur qui ne sont PAS des secrets — chacune avec sa raison. */
const PAS_UN_SECRET: Record<string, string> = {
  token_type: "le TYPE de jeton (« Bearer »), pas le jeton",
  dedupe_key: "une cle de deduplication calculee, pas un identifiant d'acces",
  input_tokens: "un compte de jetons de modele d'IA, pas un secret",
  output_tokens: "idem",
  total_tokens: "idem",
  tokens: "document_chunks.tokens est un ENTIER (taille du fragment en jetons), pas un jeton",
  token_invalidated_at: "une date, pas un jeton",
  reset_password_expiry: "une date d'expiration, pas le jeton",
};

const EVOCATEUR = /(secret|token|password|chiffre|encrypted|_key)$|^(secret|token|password)/;

/** { table -> colonnes } lus dans les fichiers du schema. */
function colonnesDuSchema(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of readdirSync(SCHEMA).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(SCHEMA, f), "utf8");
    // Un fichier peut declarer plusieurs tables : on decoupe a chaque pgTable.
    for (const bloc of src.split(/pgTable\(/).slice(1)) {
      const table = /^"([a-z_]+)"/.exec(bloc)?.[1];
      if (!table) continue;
      const fin = bloc.indexOf("\n}");
      const cols = [...bloc.slice(0, fin < 0 ? undefined : fin).matchAll(/:\s*[a-zA-Z]+\("([a-z_]+)"/g)].map((m) => m[1]!);
      out.set(table, cols);
    }
  }
  return out;
}

const SCHEMA_COLS = colonnesDuSchema();

describe("le releve lit bien le schema", () => {
  it("trouve les tables et leurs colonnes", () => {
    // Sans ce temoin, un releve casse rendrait le controle suivant vrai sur du vide.
    expect(SCHEMA_COLS.size).toBeGreaterThan(50);
    expect(SCHEMA_COLS.get("users")).toEqual(expect.arrayContaining(["password_hash", "reset_password_token"]));
    expect(SCHEMA_COLS.get("plateformes_agreees")).toContain("client_secret_chiffre");
  });
});

describe("toute colonne secrete d'une table sauvegardee est caviardee", () => {
  const sauvegardees = new Set<string>(TENANT_TABLES);
  const fautives: string[] = [];
  for (const [table, cols] of SCHEMA_COLS) {
    if (!sauvegardees.has(table)) continue;
    for (const c of cols) {
      if (!EVOCATEUR.test(c)) continue;
      if (REDACTED_COLUMNS.has(c) || PAS_UN_SECRET[c]) continue;
      fautives.push(`${table}.${c}`);
    }
  }

  it("aucune n'echappe", () => {
    expect(fautives, `secret exporte en clair dans la sauvegarde telechargeable: ${fautives.join(", ")}`).toEqual([]);
  });

  for (const c of ["reset_password_token", "email_verification_token", "token", "claim_token", "key_encrypted", "license_key", "client_secret_chiffre"]) {
    it(`${c} est caviardee`, () => {
      expect(REDACTED_COLUMNS.has(c)).toBe(true);
      expect(redactRow({ id: 1, [c]: "VALEUR-SECRETE" })[c]).toBeNull();
    });
  }

  it("chaque exception dit pourquoi ce n'est pas un secret", () => {
    for (const [c, raison] of Object.entries(PAS_UN_SECRET)) expect(raison.trim(), c).toBeTruthy();
  });
});
