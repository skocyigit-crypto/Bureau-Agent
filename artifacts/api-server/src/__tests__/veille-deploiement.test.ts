/**
 * La ronde qui verifie que la production execute bien `main`.
 *
 * Deux pannes reelles le 18/09/2026, la meme journee:
 *   - #208: un build en retard a deploye PAR-DESSUS un plus recent — la
 *     production est revenue d'un commit en arriere pendant huit minutes;
 *   - #212 et #216: le declencheur Cloud Build n'a JAMAIS demarre. Le code
 *     etait sur main, la production restait en arriere, et aucune etape n'etait
 *     rouge. La premiere fois, la fusion suivante a masque le trou; la seconde,
 *     il a fallu lancer le build a la main.
 *
 * La ronde quotidienne, avec sa tolerance de 90 minutes, n'aurait vu ni l'un ni
 * l'autre: les retards mesures etaient de 41 et 45 minutes, et la ronde ne
 * passait qu'une fois par jour.
 *
 * Ce test tient la configuration, pas le code: c'est elle qui decide si
 * quelqu'un sera prevenu.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const VEILLE = readFileSync(join(RACINE, ".github", "workflows", "veille.yml"), "utf8");

describe("ronde de surveillance du deploiement", () => {
  it("elle passe plusieurs fois par jour, pas une seule", () => {
    const crons = [...VEILLE.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]!);
    expect(crons.length, "aucune planification").toBeGreaterThan(0);
    const heures = crons.flatMap((c) => (c.split(" ")[1] ?? "").split(","));
    expect(heures.length, `une seule ronde par jour laisse passer une journee entiere: ${crons.join(" | ")}`).toBeGreaterThanOrEqual(4);
  });

  it("le seuil de retard tolere reste sous une heure", () => {
    const m = VEILLE.match(/DELAI_MAX_MIN:\s*(\d+)/);
    expect(m, "seuil introuvable").not.toBeNull();
    expect(
      Number(m![1]),
      "les retards mesures le 18/09 etaient de 41 et 45 minutes: un seuil de 90 les laissait passer",
    ).toBeLessThanOrEqual(60);
  });

  it("… mais laisse le temps d'un deploiement normal (15 min + file)", () => {
    const m = VEILLE.match(/DELAI_MAX_MIN:\s*(\d+)/);
    expect(Number(m![1]), "un seuil trop bas crierait a chaque deploiement").toBeGreaterThanOrEqual(30);
  });

  it("elle compare la production a main par /api/healthz", () => {
    expect(VEILLE).toContain("/api/healthz");
    expect(VEILLE).toMatch(/"build":/);
  });

  it("elle distingue le commit inconnu du simple retard", () => {
    expect(VEILLE).toMatch(/n'existe pas dans ce depot/);
  });

  it("le message d'alerte dit ou regarder ET quoi faire", () => {
    expect(VEILLE, "il faut pouvoir agir sans relire ce fichier").toMatch(/gcloud builds list/);
    expect(VEILLE, "le cas « aucun build » doit etre nomme").toMatch(/declencheur n a jamais demarre|declencheur n'a jamais demarre/);
    expect(VEILLE).toMatch(/gcloud builds triggers run deploy-on-main-push/);
  });

  it("elle reste declenchable a la main, pour s'eprouver elle-meme", () => {
    expect(VEILLE).toContain("workflow_dispatch");
  });
});
