import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Invariant: aucune sortie de modele ne declenche d'action sans qu'une
 * personne l'ait approuvee.
 *
 * C'est la derniere protection du systeme, et la seule qui tienne encore quand
 * les autres cedent. Le filtrage d'injection et la delimitation du contenu
 * elevent le cout d'une attaque; ils ne la rendent pas impossible. Ce qui la
 * rend sans consequence, c'est qu'un e-mail piege puisse au pire faire
 * PROPOSER une action absurde a un administrateur, jamais l'executer.
 *
 * L'invariant a ete verifie a la main et tient aujourd'hui. Il est fige ici
 * parce qu'il est exactement le genre de garde qu'une fonctionnalite ulterieure
 * — « approuver automatiquement les agents de confiance », « exécuter les
 * propositions à faible risque » — retirerait sans que personne n'y voie une
 * regression de securite.
 */

const SRC = join(import.meta.dirname, "..");

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const FILES = collect(SRC);
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

describe("execution d'une proposition d'agent", () => {
  it("n'est appelee que depuis les routes d'approbation", () => {
    // Un appel depuis un cron, le moteur d'automatisation ou un service
    // rendrait l'approbation humaine contournable.
    const callers = new Set<string>();
    for (const file of FILES) {
      const src = readFileSync(file, "utf8")
        // Les mentions en commentaire ne sont pas des appels: la definition
        // comme la file de propositions decrivent le contrat en toutes lettres.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      if (!/\bexecuteProposal\s*\(/.test(src)) continue;
      // La definition elle-meme n'est pas un appelant.
      if (/export async function executeProposal/.test(src)) continue;
      callers.add(file.slice(SRC.length + 1).replace(/\\/g, "/"));
    }
    expect([...callers].sort()).toEqual(["routes/agent-queue.ts"]);
  });

  it("passe par une decision explicite, jamais par une planification", () => {
    const src = read("routes/agent-queue.ts");
    // Les deux seuls points d'entree: approbation unitaire et decision en lot.
    const sites = src.split(/\bexecuteProposal\s*\(/).length - 1;
    expect(sites).toBe(2);
    expect(src).toContain('router.post("/agent-queue/:id/approve", requireAdmin');
    expect(src).toContain('router.post("/agent-queue/bulk-decide", requireAdmin');
  });

  it("reserve toute route mutante aux administrateurs", () => {
    // Une seule route de mutation sans garde suffirait a rendre le reste
    // decoratif.
    const src = read("routes/agent-queue.ts");
    const mutations = [...src.matchAll(/router\.(post|patch|put|delete)\(\s*"([^"]+)"\s*,\s*([A-Za-z_]+)/g)];
    expect(mutations.length).toBeGreaterThan(0);
    for (const [, method, path, guard] of mutations) {
      expect(guard, `${method.toUpperCase()} ${path} sans requireAdmin`).toBe("requireAdmin");
    }
  });

  it("documente que seule l'approbation execute", () => {
    expect(read("services/proposal-queue.ts")).toMatch(
      /seule l'approbation déclenche `executeProposal\(\)`/,
    );
  });
});

describe("brouillons de reponse de la boite de reception", () => {
  it("ne partent jamais sans declenchement humain", () => {
    // Le brouillon est redige par le modele a partir d'un e-mail que
    // l'expediteur controle: son envoi automatique transformerait une
    // injection en message signe par l'entreprise.
    const src = read("services/autonomous-inbox.ts");
    expect(src).toMatch(/explicite de l'humain/);
    expect(src).toContain("/proactive/suggestions/:id/send-reply");
  });
});
