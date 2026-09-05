import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const lire = (p: string) => readFileSync(resolve(workspaceRoot, p), "utf8");

/**
 * La politique de securite du contenu du SITE VITRINE.
 *
 * Elle est distincte de celle de l'application, et ce fichier existe parce que
 * le site vitrine n'en avait aucune. Mesure du 2026-09-05 sur
 * `https://agentdebureau.fr/`: la reponse portait HSTS, X-Frame-Options,
 * X-Content-Type-Options et Referrer-Policy — mais ni CSP ni
 * Permissions-Policy, alors que l'application avait les deux. Or c'est ce
 * service qui sert la racine du domaine.
 *
 * Ce qui a ete trouve en l'appliquant vaut d'etre garde en memoire: le site
 * chargeait la fonte Inter depuis `fonts.googleapis.com`. La correction
 * existait pourtant deja dans `main.tsx`, commentaire a l'appui — mais un
 * `@import url(...)` reste en tete de `index.css` la defaisait. Une CSP ne
 * fait pas que proteger: elle rend visible ce qu'une page va chercher
 * ailleurs.
 */
const POLITIQUE = lire("deploy/csp.tanitim.policy").trim();

describe("Content-Security-Policy du site vitrine", () => {
  it("couvre les directives qui portent la protection", () => {
    expect(POLITIQUE.length).toBeGreaterThan(80);
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(POLITIQUE).toContain(directive);
    }
  });

  it("n'autorise pas 'unsafe-inline' pour les scripts", () => {
    const scriptSrc = POLITIQUE.split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("n'ouvre pas les destinations que le site n'utilise pas", () => {
    // La politique de l'application autorise Stripe et Google en `form-action`
    // parce qu'elle y envoie reellement des formulaires. Le site vitrine, non.
    // Recopier la politique voisine par commodite elargirait la permission
    // sans raison — et une permission sans usage ne se remarque plus.
    const formAction = POLITIQUE.split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("form-action"));
    expect(formAction).toBe("form-action 'self'");
  });

  it("est recopiee sans derive dans deploy/Caddyfile.tanitim.cloudrun", () => {
    // Caddy ne sait pas lire un fichier externe pour la valeur d'un header:
    // la politique y est forcement dupliquee, donc elle peut deriver.
    expect(lire("deploy/Caddyfile.tanitim.cloudrun")).toContain(POLITIQUE);
  });

  it("est appliquee en mode BLOQUANT, et non Report-Only", () => {
    // Difference assumee avec l'application (voir csp.tanitim.policy.md): ce
    // site est statique et les tests en navigateur ouvrent chacune de ses
    // pages sous cette politique. Un passage silencieux en Report-Only ferait
    // croire a une protection qui n'existe plus.
    const caddy = lire("deploy/Caddyfile.tanitim.cloudrun");
    expect(caddy).toContain(`Content-Security-Policy "${POLITIQUE}"`);
    expect(caddy).not.toContain("Content-Security-Policy-Report-Only");
  });

  it("est servie par e2e/serve-tanitim.mjs depuis la source unique", () => {
    expect(lire("e2e/serve-tanitim.mjs")).toContain("csp.tanitim.policy");
  });
});

describe("fonte du site vitrine", () => {
  it("ne va chercher aucune ressource chez Google", () => {
    // Charger la fonte depuis `fonts.googleapis.com` transmet l'adresse IP de
    // chaque visiteur a un tiers, avant tout consentement. Le tribunal
    // regional de Munich (LG Munchen I, 3 O 17493/20) a juge ce seul appel
    // suffisant pour caracteriser une atteinte.
    //
    // Le test porte sur la SOURCE et non sur le rendu: la fuite ne casse rien,
    // ne se voit pas a l'ecran, et se reintroduit d'une seule ligne.
    for (const fichier of ["artifacts/tanitim/src/index.css", "artifacts/tanitim/index.html"]) {
      expect(lire(fichier), `${fichier} appelle un domaine Google`).not.toContain("fonts.googleapis.com");
      expect(lire(fichier), `${fichier} appelle un domaine Google`).not.toContain("fonts.gstatic.com");
    }
  });

  it("sert par nos soins toutes les graisses que le site emploie", () => {
    // 800 et 900 venaient de la feuille de style de Google. Retirer l'appel
    // sans importer ces graisses n'aurait pas laisse de trace visible: le
    // navigateur les aurait synthetisees a partir du 700, en moins bien.
    const main = lire("artifacts/tanitim/src/main.tsx");
    for (const graisse of ["400", "500", "600", "700", "800", "900"]) {
      expect(main, `graisse ${graisse} absente`).toContain(`@fontsource/inter/${graisse}.css`);
    }
  });
});
