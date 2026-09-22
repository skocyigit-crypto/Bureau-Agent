/**
 * Le kit de conformite employeur est trouvable, lisible, et construit.
 *
 * Il existait, complet, mais dans le depot seulement : aucune page n'y menait.
 * L'employeur — celui que le Code du travail et le RGPD obligent — ne pouvait
 * pas le lire. Ces controles tiennent les trois conditions pour qu'il le
 * puisse : une page le sert, on y arrive depuis le site, et le build de
 * production l'embarque (le `.dockerignore` excluait tout `*.md`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, Fragment } from "react";
import { rendreMarkdown } from "@/lib/markdown-simple";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const SITE = join(RACINE, "artifacts", "tanitim");
const KIT = join(SITE, "src", "content", "conformite-employeur");
const FICHIERS = ["README.md", "dossier-consultation-cse.md", "note-information-salaries.md", "trame-aipd.md", "notice-utilisation-ia.md"];
const PAGE = readFileSync(join(SITE, "src", "pages", "conformite-employeur.tsx"), "utf8");

const html = (md: string, lien: (c: string) => string = (c) => `/x/${c}`) =>
  renderToStaticMarkup(createElement(Fragment, null, ...rendreMarkdown(md, lien)));

describe("la page sert chaque document du kit", () => {
  for (const f of FICHIERS) {
    it(`${f} est importe par la page`, () => {
      expect(PAGE).toContain(`@/content/conformite-employeur/${f}?raw`);
    });
  }

  it("chaque lien entre documents du kit mene a une page du kit", () => {
    // Le README renvoie vers les trois autres fichiers par leur nom: sans
    // traduction, le lien menerait a « /trame-aipd.md », une page d'erreur.
    const readme = readFileSync(join(KIT, "README.md"), "utf8");
    const cibles = [...readme.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]!);
    expect(cibles.length).toBeGreaterThanOrEqual(3);
    for (const c of cibles) {
      expect(FICHIERS, `lien vers un fichier absent du kit: ${c}`).toContain(c);
      expect(PAGE, `${c} n'a pas de page`).toMatch(new RegExp(`fichier: "${c.replace(".", "\\.")}"`));
    }
  });
});

describe("on y arrive depuis le site", () => {
  it("la route existe", () => {
    const app = readFileSync(join(SITE, "src", "App.tsx"), "utf8");
    expect(app).toContain('path="/conformite-employeur"');
    expect(app).toContain('path="/conformite-employeur/:doc"');
  });

  it("le pied de page y mene", () => {
    const footer = readFileSync(join(SITE, "src", "components", "layout", "Footer.tsx"), "utf8");
    expect(footer).toContain('href="/conformite-employeur"');
  });

  it("le sitemap l'annonce", () => {
    const sm = readFileSync(join(SITE, "public", "sitemap.xml"), "utf8");
    expect(sm).toContain("<loc>https://agentdebureau.fr/conformite-employeur</loc>");
  });
});

describe("le build de production embarque les fichiers", () => {
  it("le .dockerignore fait une exception pour le kit", () => {
    // Sans elle, `*.md` exclut le kit du contexte Docker: le build local
    // passe, celui de production echoue a l'import.
    const di = readFileSync(join(RACINE, ".dockerignore"), "utf8").split(/\r?\n/);
    const exclu = di.indexOf("*.md");
    const exception = di.indexOf("!artifacts/tanitim/src/content/**/*.md");
    expect(exclu).toBeGreaterThanOrEqual(0);
    expect(exception, "exception absente: le build Docker ne verra pas le kit").toBeGreaterThan(exclu);
  });

  it("le Dockerfile du site copie le dossier qui contient le kit", () => {
    const df = readFileSync(join(RACINE, "deploy", "Dockerfile.tanitim.cloudrun"), "utf8");
    expect(df).toMatch(/COPY artifacts\/tanitim \.\/artifacts\/tanitim/);
  });
});

describe("le rendu construit des elements, jamais du HTML injecte", () => {
  it("la page n'injecte pas de HTML", () => {
    const lib = readFileSync(join(SITE, "src", "lib", "markdown-simple.tsx"), "utf8");
    expect(PAGE + lib).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("une balise ecrite dans un document reste du texte", () => {
    const sortie = html("Un <script>alert(1)</script> ici.");
    expect(sortie).not.toContain("<script>");
    expect(sortie).toContain("&lt;script&gt;");
  });

  it("titres, gras et italique", () => {
    const s = html("# Titre\n\n## Sous\n\nDu **gras** et de l'*italique*.");
    expect(s).toContain("<h1");
    expect(s).toContain("<h2");
    expect(s).toContain("<strong>gras</strong>");
    expect(s).toContain("<em>italique</em>");
  });

  it("un tableau garde ses en-tetes et ses cellules", () => {
    const s = html("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
    expect(s).toContain('<th scope="col"');
    expect((s.match(/<td/g) ?? []).length).toBe(4);
  });

  it("listes ordonnees et a puces", () => {
    expect(html("- un\n- deux")).toMatch(/<ul[^>]*><li>un<\/li><li>deux<\/li><\/ul>/);
    expect(html("1. un\n2. deux")).toMatch(/<ol/);
  });

  it("un lien interne passe par la traduction, un lien externe s'ouvre a part", () => {
    const s = html("[doc](trame-aipd.md) et [CNIL](https://www.cnil.fr)", (c) => `/kit/${c}`);
    expect(s).toContain('href="/kit/trame-aipd.md"');
    expect(s).toMatch(/href="https:\/\/www\.cnil\.fr"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  });

  it("les vrais documents du kit se rendent sans perdre leur tableau", () => {
    const aipd = readFileSync(join(KIT, "trame-aipd.md"), "utf8");
    const s = html(aipd);
    expect(s).toContain("<table");
    expect(s).toContain("Présence sur zone");
  });
});
