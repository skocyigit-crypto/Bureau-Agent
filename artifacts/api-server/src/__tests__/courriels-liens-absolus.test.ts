/**
 * Un lien dans un courriel doit etre absolu.
 *
 * Mesure le 18/09: les deux messages de bienvenue (demande de demo, demande de
 * contact) portaient `href="/register"`. Dans un navigateur, un chemin relatif
 * se resout contre la page courante; dans un client de messagerie, il n'y a pas
 * de page courante — le lien ne mene nulle part. Le bouton « Demarrer l'essai
 * gratuit » etait donc mort dans le seul message ou un prospect a envie de
 * cliquer.
 *
 * Le meme balayage a retrouve la promesse corrigee en #201 (« 14 jours d'acces
 * complet ») recopiee dans ces deux courriels, alors que le plan d'essai
 * n'ouvre ni l'IA, ni le stock, ni les automatisations.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..");

/** Tout fichier qui compose du HTML de courriel. */
function fichiersCourriel(): string[] {
  const trouves: string[] = [];
  const parcourir = (dossier: string) => {
    for (const e of readdirSync(dossier, { withFileTypes: true })) {
      const p = join(dossier, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__") parcourir(p); continue; }
      if (!e.name.endsWith(".ts")) continue;
      const contenu = readFileSync(p, "utf8");
      if (/sendEmail\s*\(/.test(contenu) && /<a\s+href=/.test(contenu)) trouves.push(p);
    }
  };
  parcourir(join(SRC, "routes"));
  parcourir(join(SRC, "services"));
  return trouves;
}

describe("liens des courriels", () => {
  const fichiers = fichiersCourriel();

  it("il y a bien des courriels a verifier (sinon ce test ne mesure rien)", () => {
    expect(fichiers.length).toBeGreaterThan(0);
  });

  it("aucun lien relatif dans un courriel", () => {
    const fautifs: string[] = [];
    for (const f of fichiers) {
      const contenu = readFileSync(f, "utf8");
      for (const m of contenu.matchAll(/<a\s+href="([^"]*)"/g)) {
        const cible = m[1]!;
        const absolu = /^https?:\/\//.test(cible) || /^mailto:/.test(cible) || cible.startsWith("${");
        if (!absolu) fautifs.push(`${f.replace(SRC, "")}: ${cible}`);
      }
    }
    expect(fautifs, "un chemin relatif ne mene nulle part depuis une boite mail").toEqual([]);
  });

  it("le lien d'inscription vient de PUBLIC_URL, pas d'un domaine ecrit a la main", () => {
    for (const f of [join(SRC, "routes", "demo-request.ts"), join(SRC, "routes", "contact-request.ts")]) {
      const contenu = readFileSync(f, "utf8");
      expect(contenu, `${f}: lien d'inscription fige`).toMatch(/process\.env\.PUBLIC_URL/);
    }
  });

  it("les courriels ne promettent pas un essai « complet »", () => {
    // L'essai n'ouvre ni l'IA, ni le stock, ni les automatisations (#201).
    for (const f of fichiers) {
      const contenu = readFileSync(f, "utf8");
      const phrases = contenu.split(/[.\n]/).filter((p) => /essai|jours/i.test(p) && /acc[eè]s complet|toutes les fonctionnalit/i.test(p));
      expect(phrases, `${f.replace(SRC, "")} promet un essai complet`).toEqual([]);
    }
  });

  it("les donnees saisies par le visiteur restent echappees", () => {
    for (const f of [join(SRC, "routes", "demo-request.ts"), join(SRC, "routes", "contact-request.ts")]) {
      expect(readFileSync(f, "utf8")).toMatch(/escapeHtml|Safe\b/);
    }
  });
});
