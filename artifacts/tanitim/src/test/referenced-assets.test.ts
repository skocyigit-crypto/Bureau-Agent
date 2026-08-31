import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tout fichier local reference doit exister.
 *
 * Une application monopage sert `index.html` pour tout chemin inconnu. Un lien
 * casse repond donc 200 avec du HTML la ou une image ou une feuille de style
 * est attendue: rien n'echoue, rien n'apparait dans les journaux, et le defaut
 * ne se voit qu'a l'oeil sur l'ecran d'un utilisateur.
 *
 * C'est exactement ainsi qu'une icone d'ecran d'accueil a pointe pendant des
 * mois vers un fichier absent. Verifier a la construction est le seul moment
 * ou l'absence est encore visible.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const PUBLIC = join(ROOT, "public");

/** Chemins absolus locaux cites dans un document (hors URL externes). */
function localRefs(source: string): string[] {
  const refs = new Set<string>();
  for (const m of source.matchAll(/(?:href|src|content)="(\/[^"]*)"/g)) refs.add(m[1]);
  for (const m of source.matchAll(/"(?:src|url)":\s*"(\/[^"]*)"/g)) refs.add(m[1]);
  return [...refs]
    // Les chemins sans extension sont des routes servies par l'application,
    // pas des fichiers sur le disque.
    .filter((p) => /\.[A-Za-z0-9]{2,5}$/.test(p))
    // Vite injecte /assets/... a la construction; ils n'existent pas en source.
    .filter((p) => !p.startsWith("/assets/"));
}

const html = readFileSync(join(ROOT, "index.html"), "utf8");

describe("fichiers references par index.html", () => {
  const refs = localRefs(html);

  it("en trouve reellement (sinon le test ne verifie rien)", () => {
    expect(refs.length).toBeGreaterThanOrEqual(3);
  });

  for (const ref of refs) {
    it(`existe: ${ref}`, () => {
      // Deux origines possibles: `public/` (copie telle quelle) et la racine
      // du projet (les points d'entree que Vite transforme a la construction,
      // par exemple /src/main.tsx).
      const inPublic = existsSync(join(PUBLIC, ref.replace(/^\//, "")));
      const inRoot = existsSync(join(ROOT, ref.replace(/^\//, "")));
      expect(inPublic || inRoot, `introuvable dans public/ ni a la racine`).toBe(true);
    });
  }
});

describe("fichiers references par le sitemap et robots", () => {
  it("le sitemap et robots.txt sont presents", () => {
    // Cites par index.html et par les moteurs; leur absence est silencieuse.
    expect(existsSync(join(PUBLIC, "sitemap.xml"))).toBe(true);
    expect(existsSync(join(PUBLIC, "robots.txt"))).toBe(true);
  });

  it("l'image Open Graph existe", () => {
    // Sans elle, chaque partage sur un reseau social affiche une carte vide.
    const og = html.match(/property="og:image" content="https:\/\/agentdebureau\.fr([^"]+)"/)?.[1];
    expect(og, "og:image absent").toBeTruthy();
    expect(existsSync(join(PUBLIC, og!.replace(/^\//, "")))).toBe(true);
  });
});
