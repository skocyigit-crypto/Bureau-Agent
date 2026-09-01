import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { enrichTimeoutMs } from "../services/ai-insights";

/**
 * Deux appelants, deux contraintes opposees.
 *
 * La reecriture IA des insights disposait d'un budget unique de 15 s, le plus
 * serre du depot (document-ai en accorde 30, le defaut du helper est 25).
 * Mesure en production le 2026-09-01: 18 expirations en six heures et pas une
 * seule reussite. L'enrichissement ne fonctionnait plus du tout, en silence —
 * chaque insight retombait sur son texte deterministe, et rien ne le disait.
 *
 * La cause n'est pas la lenteur des fournisseurs (appeles directement, ils
 * repondent en 0,2 a 2 s) mais le contexte: le cron tourne HORS requete et
 * Cloud Run y bride le CPU, si bien que le temps de mur s'ecoule bien plus
 * vite que le travail n'avance.
 *
 * Une seule valeur ne peut donc pas convenir aux deux appelants:
 *
 *   - le cron ne fait attendre personne; le serrer casse la fonction;
 *   - `/ai-insights/regenerate` fait patienter un utilisateur devant son
 *     ecran; le relacher fige la page.
 *
 * Les deux erreurs sont silencieuses et opposees, d'ou ce test: on ne peut
 * pas revenir a un budget unique sans le voir.
 */

describe("budget de reecriture des insights", () => {
  it("laisse le temps au cron, qui ne fait attendre personne", () => {
    const fond = enrichTimeoutMs(false);

    // Au-dessus des 15 s qui echouaient systematiquement, et au moins aussi
    // large que le reste du depot (document-ai: 30 s).
    expect(fond).toBeGreaterThan(15_000);
    expect(fond).toBeGreaterThanOrEqual(30_000);
  });

  it("garde l'appel interactif court", () => {
    const interactif = enrichTimeoutMs(true);

    // Mieux vaut un texte deterministe immediat qu'une page figee: le cron
    // enrichira au passage suivant.
    expect(interactif).toBeLessThanOrEqual(15_000);
  });

  it("ne confond pas les deux", () => {
    expect(enrichTimeoutMs(false)).toBeGreaterThan(enrichTimeoutMs(true));
  });

  it("est bien branche sur les deux appelants", () => {
    // Le choix ne vaut que si la route se declare interactive et le cron non:
    // un defaut inverse rendrait les constantes decoratives.
    const src = path.resolve(import.meta.dirname, "..");
    const route = fs.readFileSync(path.join(src, "routes", "ai-insights.ts"), "utf8");
    const service = fs.readFileSync(path.join(src, "services", "ai-insights.ts"), "utf8");

    expect(route, "la route ne se declare pas interactive").toContain("interactive: true");
    // Le cron appelle sans option: le defaut doit donc etre le budget long.
    expect(service).toContain("enrichTimeoutMs(opts.interactive === true)");
  });
});
