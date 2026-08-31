import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * L'icone d'ecran d'accueil doit exister en PNG.
 *
 * L'application est installable depuis le navigateur (PWA), et c'est
 * aujourd'hui la seule facon de l'avoir sur un telephone: elle n'est publiee
 * sur aucun magasin. L'icone est donc la premiere chose qu'un client voit.
 *
 * Elle etait declaree en SVG (`apple-touch-icon` -> icon-192.svg). iOS
 * n'accepte PAS le SVG pour l'icone d'ecran d'accueil: il ignore le lien et
 * pose a la place une capture de la page, ce qui donne une vignette floue et
 * illisible au lieu du logo. Android accepte le SVG, donc le defaut ne se
 * voyait que sur iPhone.
 *
 * Les fichiers PNG sont rendus a partir de `icon-512.svg`, qui reste la
 * source: le SVG est modifie, les PNG sont regeneres.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const manifest = JSON.parse(readFileSync(join(ROOT, "public", "manifest.json"), "utf8"));

describe("icone d'ecran d'accueil (iOS)", () => {
  it("est declaree en PNG, pas en SVG", () => {
    const link = html.match(/<link[^>]*rel="apple-touch-icon"[^>]*>/);
    expect(link, "aucun apple-touch-icon declare").not.toBeNull();
    expect(link![0]).toMatch(/\.png"/);
    expect(link![0]).not.toMatch(/\.svg"/);
  });

  it("pointe vers un fichier qui existe reellement", () => {
    // Une application monopage renvoie index.html pour tout chemin inconnu:
    // un lien casse repond donc 200 et passe inapercu en production.
    const href = html.match(/rel="apple-touch-icon"[^>]*href="([^"]+)"/)?.[1];
    expect(href).toBeTruthy();
    expect(existsSync(join(ROOT, "public", href!.replace(/^\//, "")))).toBe(true);
  });

  it("annonce la taille attendue par iOS", () => {
    expect(html).toMatch(/rel="apple-touch-icon"[^>]*sizes="180x180"/);
  });
});

describe("manifeste PWA", () => {
  const icons: Array<{ src: string; sizes: string; type: string }> = manifest.icons ?? [];

  it("propose du PNG en 192 et 512", () => {
    // Tailles requises par Chrome pour proposer l'installation. Le SVG passe
    // sur Android recent, le PNG passe partout.
    for (const size of ["192x192", "512x512"]) {
      const png = icons.find((i) => i.sizes === size && i.type === "image/png");
      expect(png, `PNG ${size} absent du manifeste`).toBeTruthy();
      expect(existsSync(join(ROOT, "public", png!.src.replace(/^\//, "")))).toBe(true);
    }
  });

  it("garde une icone maskable", () => {
    // Sans elle, Android recadre l'icone dans un cercle et rogne le logo.
    expect(icons.some((i) => /maskable/.test((i as any).purpose ?? ""))).toBe(true);
  });

  it("reste installable", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.name).toBeTruthy();
  });
});
