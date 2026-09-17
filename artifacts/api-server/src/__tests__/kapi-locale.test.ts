import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error module .mjs sans declaration de types
import { etapesCi, secretsDansDiff } from "../../../../scripts/kapi-locale-lib.mjs";

const CI = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", ".github", "workflows", "ci.yml"), "utf8");
const diff = (...ajouts: string[]) => ["+++ b/fichier.ts", ...ajouts.map((a) => `+${a}`)].join("\n");

describe("etapes derivees du CI reel", () => {
  const etapes = etapesCi(CI, ["typecheck-and-build", "test"]) as Array<{ job: string; nom: string; run: string; dossier: string | null }>;
  it("aucune etape `run:` du CI n'est perdue (hors installation et portes GitHub)", () => {
    // Compte independant : chaque `run:` des deux jobs, moins les ignorees.
    const bloc = CI.slice(CI.indexOf("  typecheck-and-build:"), CI.indexOf("  docker-build-api:"));
    const runs = bloc.match(/^\s+(- )?run:/gm)?.length ?? 0;
    const ignorees = (bloc.match(/run: corepack enable|run: pnpm install|\$\{\{ steps\./g) ?? []).length;
    // `${{ steps.` apparait plusieurs fois dans l'unique etape de porte : on la compte une fois.
    const porte = /\$\{\{ steps\./.test(bloc) ? 1 : 0;
    const installs = (bloc.match(/run: corepack enable|run: pnpm install/g) ?? []).length;
    expect(ignorees).toBeGreaterThan(0);
    expect(etapes.length).toBe(runs - installs - porte);
  });
  it("contient les portes qui ont deja manque en local", () => {
    const tout = etapes.map((e) => e.run).join("\n");
    for (const c of ["pnpm run typecheck", "lint:ratchet", "routes:check", "tenant:check", "a11y:check", "run build", "security:audit"]) expect(tout).toContain(c);
  });
  it("lit un bloc plie `>-` en une seule commande", () => {
    const schema = etapes.find((e) => e.run.includes("drizzle-kit push"))!;
    expect(schema.run).toContain("ensure-search-extensions.mjs && ");
    expect(schema.run).not.toContain("\n");
  });
  it("garde le dossier de travail", () => expect(etapes.find((e) => e.run.includes("drizzle-kit"))!.dossier).toBe("lib/db"));
  it("ignore installation et portes a expressions GitHub", () => {
    for (const e of etapes) {
      expect(e.run).not.toMatch(/^pnpm install|^corepack enable|\$\{\{/);
    }
  });
  it("les quatre suites de tests sont presentes", () => {
    expect(etapes.filter((e) => /--filter @workspace\/\S+ run test/.test(e.run)).length).toBeGreaterThanOrEqual(4);
  });
});

describe("scan de secrets (depot public)", () => {
  // Valeurs construites a l'execution : aucun motif reel ne figure dans ce fichier.
  const x = (n: number) => "A1b2".repeat(Math.ceil(n / 4)).slice(0, n);
  it("cle Stripe", () => expect(secretsDansDiff(diff(`const k = "sk_${"live"}_${x(24)}";`))).toHaveLength(1));
  it("cle Google", () => expect(secretsDansDiff(diff(`AIza${x(35)}`))).toHaveLength(1));
  it("cle privee", () => expect(secretsDansDiff(diff(`-----BEGIN ${"PRIVATE"} KEY-----`))).toHaveLength(1));
  it("jeton GitHub", () => expect(secretsDansDiff(diff(`ghp_${x(36)}`))).toHaveLength(1));
  it("URL Postgres distante avec mot de passe", () => {
    expect(secretsDansDiff(diff(`postgres://app:${x(12)}@db.example.com/prod`))).toHaveLength(1);
  });
  it("base locale de test : pas d'alerte", () => {
    expect(secretsDansDiff(diff("postgres://postgres:postgres@localhost:5432/agent_de_bureau_test"))).toHaveLength(0);
  });
  it("une ligne SUPPRIMEE n'alerte pas", () => {
    expect(secretsDansDiff(["+++ b/f.ts", `-AIza${x(35)}`].join("\n"))).toHaveLength(0);
  });
  it("le fichier est nomme", () => expect(secretsDansDiff(diff(`ghp_${x(36)}`))[0]).toContain("fichier.ts"));
});
