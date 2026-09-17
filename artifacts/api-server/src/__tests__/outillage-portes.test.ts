/**
 * Les portes locales ne doivent pas pouvoir « passer » sans avoir mesure.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const ECRANS = readFileSync(join(RACINE, "scripts", "verif-ecrans.mjs"), "utf8");
const HOOK = readFileSync(join(RACINE, ".githooks", "pre-push"), "utf8");
const PKG = JSON.parse(readFileSync(join(RACINE, "package.json"), "utf8"));

describe("verif-ecrans : un ecran non juge n'est pas vert", () => {
  it("des non juges sans defaut donnent le code 2", () => {
    expect(ECRANS).toMatch(/if \(nonJuges\.length > 0 && process\.exitCode !== 1 && process\.env\.NON_JUGES_TOLERES !== "1"\) \{[\s\S]{0,200}process\.exitCode = 2;/);
  });
  it("un defaut reel garde le code 1 (prioritaire)", () => {
    expect(ECRANS.indexOf("process.exitCode = 1;")).toBeLessThan(ECRANS.indexOf("process.exitCode = 2;"));
  });
  it("un ecran limite (429) n'est jamais declare « en probleme »", () => {
    expect(ECRANS).toContain("const probleme = limite.length === 0 && (");
  });
  it("la tolerance doit etre explicite", () => expect(ECRANS).toContain('process.env.NON_JUGES_TOLERES !== "1"'));
});

describe("porte avant push", () => {
  it("le hook appelle la porte derivee du CI", () => expect(HOOK).toContain("pnpm run kapi"));
  it("il couvre au moins le job typecheck-and-build par defaut", () => expect(HOOK).toContain('KAPI_JOBS="${KAPI_JOBS:-typecheck-and-build}"'));
  it("il s'arrete si la porte echoue (pas de `|| true`)", () => expect(HOOK).not.toMatch(/pnpm run kapi[^\n]*\|\|/));
  it("l'installation branche les hooks du depot", () => expect(PKG.scripts.prepare).toBe("git config core.hooksPath .githooks || true"));
  it("le script kapi existe", () => expect(PKG.scripts.kapi).toBe("node ./scripts/kapi-locale.mjs"));
});

describe("kapi : une etape ignoree n'est pas reussie", () => {
  const KAPI = readFileSync(join(RACINE, "scripts", "kapi-locale.mjs"), "utf8");
  it("des etapes ignorees sans rouge donnent le code 2", () => {
    expect(KAPI).toContain("process.exit(rouges ? 1 : ignorees && !tolerees ? 2 : 0);");
  });
  it("le message ne dit plus « tout est vert » dans ce cas", () => expect(KAPI).toContain("porte NON franchie"));
  it("la tolerance est explicite", () => expect(KAPI).toContain('process.env.KAPI_IGNOREES_TOLEREES === "1"'));
});
