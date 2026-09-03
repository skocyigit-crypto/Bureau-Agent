import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const lire = (p: string) => readFileSync(resolve(workspaceRoot, p), "utf8");

/**
 * La politique de securite du contenu du document de l'application.
 *
 * `deploy/csp.policy` en est la source unique. Les Caddyfile la recopient
 * telle quelle — un fichier de configuration Caddy ne peut pas lire un fichier
 * externe pour la valeur d'un header — donc rien n'empeche une copie de
 * deriver, et une CSP qui a derive protege autre chose que ce qu'on croit.
 *
 * Ce test existe pour la meme raison que celui du Permissions-Policy juste a
 * cote: la politique etait deja ecrite quelque part dans le depot
 * (`deploy/non-docker/nginx.conf`), mais pas dans le fichier qui sert
 * reellement l'application. Elle existait partout sauf la ou un navigateur la
 * lit.
 */
const POLITIQUE = lire("deploy/csp.policy").trim();

describe("Content-Security-Policy du document", () => {
  it("n'est pas vide et couvre les directives qui portent la protection", () => {
    expect(POLITIQUE.length).toBeGreaterThan(80);
    for (const directive of [
      "default-src 'self'",
      // Le coeur: sans elle, une injection de script s'execute.
      "script-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(POLITIQUE).toContain(directive);
    }
  });

  it("n'autorise pas 'unsafe-inline' pour les scripts", () => {
    // `style-src` le tolere (les styles en ligne de React), `script-src` non:
    // ce serait renoncer a la protection meme que cette politique apporte.
    const scriptSrc = POLITIQUE.split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it.each([
    "deploy/Caddyfile.cloudrun",
    "deploy/Caddyfile",
  ])("est recopiee sans derive dans %s", (chemin) => {
    const source = lire(chemin);
    expect(source).toContain(POLITIQUE);
  });

  it("est servie par e2e/serve-app.mjs depuis la source unique", () => {
    // Si le serveur de test codait la politique en dur, le test end-to-end
    // pourrait passer sur une politique que la production n'applique pas.
    expect(lire("e2e/serve-app.mjs")).toContain("csp.policy");
  });
});
