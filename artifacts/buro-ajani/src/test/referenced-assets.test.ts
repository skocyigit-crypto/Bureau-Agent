import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tout fichier local reference doit exister.
 *
 * L'application monopage sert `index.html` pour tout chemin inconnu. Un lien
 * casse repond donc 200 avec du HTML la ou une image est attendue: rien
 * n'echoue, rien n'apparait dans les journaux, et le defaut ne se voit que sur
 * l'ecran de l'utilisateur.
 *
 * C'est exactement ainsi que l'icone d'ecran d'accueil a pointe vers un
 * fichier absent sans que rien ne le signale. La verification a la
 * construction est le seul moment ou l'absence est encore visible.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const PUBLIC = join(ROOT, "public");

function exists(ref: string): boolean {
  const rel = ref.replace(/^\//, "");
  // `public/` est copie tel quel; la racine porte les points d'entree que
  // Vite transforme a la construction (par exemple /src/main.tsx).
  return existsSync(join(PUBLIC, rel)) || existsSync(join(ROOT, rel));
}

function localRefs(source: string): string[] {
  const refs = new Set<string>();
  for (const m of source.matchAll(/(?:href|src|content)="(\/[^"]*)"/g)) refs.add(m[1]);
  for (const m of source.matchAll(/"(?:src|url)":\s*"(\/[^"]*)"/g)) refs.add(m[1]);
  return [...refs]
    // Sans extension: une route de l'application, pas un fichier.
    .filter((p) => /\.[A-Za-z0-9]{2,5}$/.test(p))
    // Injecte par Vite a la construction, absent des sources.
    .filter((p) => !p.startsWith("/assets/"));
}

const html = readFileSync(join(ROOT, "index.html"), "utf8");
const manifestRaw = readFileSync(join(PUBLIC, "manifest.json"), "utf8");

describe("fichiers references par index.html", () => {
  const refs = localRefs(html);

  it("en trouve reellement (sinon le test ne verifie rien)", () => {
    expect(refs.length).toBeGreaterThanOrEqual(3);
  });

  for (const ref of refs) {
    it(`existe: ${ref}`, () => {
      expect(exists(ref), "introuvable dans public/ ni a la racine").toBe(true);
    });
  }
});

describe("fichiers references par le manifeste", () => {
  const refs = localRefs(manifestRaw);

  it("en trouve reellement", () => {
    expect(refs.length).toBeGreaterThanOrEqual(5);
  });

  for (const ref of refs) {
    it(`existe: ${ref}`, () => {
      expect(exists(ref)).toBe(true);
    });
  }
});

describe("service worker", () => {
  it("ne precharge que des fichiers qui existent", () => {
    // `cache.addAll` est atomique: un seul chemin absent fait echouer
    // l'installation du service worker, et l'application perd son mode hors
    // ligne sans qu'aucune erreur ne remonte cote serveur.
    const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");
    const list = sw.match(/const STATIC_ASSETS = \[([^\]]*)\]/);
    expect(list, "STATIC_ASSETS introuvable").not.toBeNull();
    const assets = [...list![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) {
      expect(exists(a), `precharge mais absent: ${a}`).toBe(true);
    }
  });
});
