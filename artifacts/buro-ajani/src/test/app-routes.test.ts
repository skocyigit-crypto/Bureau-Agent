import fs from "node:fs";
import path from "node:path";
import { describe,expect,it } from "vitest";

describe("application route priority", () => {
  it("enables React StrictMode at the application root", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../main.tsx"), "utf8");

    expect(source).toContain('import { StrictMode } from "react"');
    expect(source).toContain("<StrictMode>");
  });

  it("declares the contact import route before the dynamic contact route", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../App.tsx"), "utf8");
    const importRoute = source.indexOf('path="/contacts/import"');
    const detailRoute = source.indexOf('path="/contacts/:id"');

    expect(importRoute).toBeGreaterThan(-1);
    expect(detailRoute).toBeGreaterThan(-1);
    expect(importRoute).toBeLessThan(detailRoute);
  });

  it("keeps API- and workflow-generated destinations reachable", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../App.tsx"), "utf8");

    for (const route of [
      "/prospects",
      "/prospects/:id",
      "/devis",
      "/factures",
    ]) {
      expect(source, `missing application route: ${route}`).toContain(`path="${route}"`);
    }
  });
});

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8");

/** Chemins statiques declares dans App.tsx (les routes parametrees exclues). */
function staticRoutes(): string[] {
  return [...read("../App.tsx").matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((r) => !r.includes(":"));
}

describe("every link the product emits lands on a real page", () => {
  // Ecrans publics: on y arrive par une URL signee ou un email, jamais par une
  // proposition de l'assistant.
  const PUBLIC_PREFIXES = ["/login", "/register", "/invitation", "/rendez-vous", "/onboarding"];

  it("lets the assistant reach every internal page it could propose", () => {
    // `safeLink` (central-intelligence) remplace par "/" toute destination hors
    // liste blanche — sans erreur. Une page absente de la liste rend donc le
    // bouton "Traiter" du tableau de bord silencieusement inoperant.
    const source = read("../components/central-intelligence.tsx");
    const block = source.slice(source.indexOf("const VALID_ROUTES"), source.indexOf("];", source.indexOf("const VALID_ROUTES")));
    const allowed = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(allowed.length).toBeGreaterThan(10);

    // Reproduction exacte de safeLink: comparaison sur les deux premiers segments.
    const accepts = (target: string) => {
      const basePath = target.split("?")[0].split("/").slice(0, 2).join("/");
      return allowed.includes(basePath) || allowed.includes(target);
    };

    const unreachable = staticRoutes()
      .filter((r) => !PUBLIC_PREFIXES.some((p) => r.startsWith(p)))
      .filter((r) => !accepts(r));

    expect(unreachable, `pages absentes de VALID_ROUTES: ${unreachable.join(", ")}`).toEqual([]);
  });

  it("points every server-generated actionUrl at a route that exists", () => {
    // Les insights, notifications et propositions d'agent portent un
    // `actionUrl` construit cote serveur. Il n'y a aucun typage entre les deux
    // paquets: seule cette lecture croisee empeche une notification de mener
    // sur la page 404 (c'etait le cas de /factures-clients, /backups et
    // /communication).
    const apiSrc = path.resolve(import.meta.dirname, "../../../api-server/src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !/__tests__|\.test\./.test(p)) files.push(p);
      }
    };
    walk(apiSrc);

    const routeMatchers = [...read("../App.tsx").matchAll(/<Route\s+path="([^"]+)"/g)]
      .map((m) => new RegExp("^" + m[1].replace(/:[A-Za-z0-9_]+/g, "[^/]+") + "$"));

    const broken: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const m of source.matchAll(/actionUrl:\s*["'`](\/[^"'`$]*)/g)) {
        const target = m[1].replace(/[?#].*$/, "").replace(/\/$/, "");
        if (!target || target === "/") continue;
        if (!routeMatchers.some((re) => re.test(target))) {
          broken.push(`${path.basename(file)} -> ${target}`);
        }
      }
    }

    expect([...new Set(broken)]).toEqual([]);
  });

  it("points the licence and trial banners at a route that exists", () => {
    // Ces bannieres sont le seul appel a l'action quand l'essai expire ou qu'un
    // paiement echoue: elles visaient "/settings", qui n'a jamais existe (la
    // page est "/parametres"), donc le bouton menait a la page 404.
    const routes = staticRoutes();
    for (const file of ["../components/license-status-banner.tsx", "../components/trial-banner.tsx"]) {
      const source = read(file);
      const targets = [...source.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1].split("?")[0]);
      expect(targets.length, `${file} devrait porter au moins un lien`).toBeGreaterThan(0);
      for (const target of targets) {
        expect(routes, `${file} pointe vers ${target}, qui n'est pas une route`).toContain(target);
      }
    }
  });
});
