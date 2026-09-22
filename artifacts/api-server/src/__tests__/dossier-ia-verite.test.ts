/**
 * Le dossier technique (AI Act, annexe IV) et le registre des risques
 * (article 9) disent ce que fait le code.
 *
 * Un dossier de conformite qui decrit un systeme qui n'existe plus est le
 * document le plus dangereux qu'un fournisseur puisse presenter a une
 * autorite. Ce test echoue des qu'un fait decrit cesse d'etre vrai.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scoreActivite } from "../services/performance-garde-fous";
import { ANTHROPIC_MODEL, GEMINI_PRO_MODEL, OPENAI_MODEL } from "../services/ai-utils";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const DOSSIER = readFileSync(join(RACINE, "docs", "conformite-ia", "dossier-technique-annexe-iv.md"), "utf8");
const REGISTRE = readFileSync(join(RACINE, "docs", "conformite-ia", "registre-risques-art9.md"), "utf8");
const SRC = (...p: string[]) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");

describe("le dossier technique decrit le systeme reel", () => {
  it("chaque fichier cite existe et porte la fonction decrite", () => {
    const cites: Array<[string[], string]> = [
      [["services", "performance-analyzer.ts"], "fusionnerAnalyses"],
      [["routes", "workforce-agent.ts"], "scoreActivite("],
      [["routes", "workforce-intelligence.ts"], "scoreActivite("],
      [["routes", "ai-commandant.ts"], "/commandant/employee-quality"],
      [["services", "performance-garde-fous.ts"], "export function scoreActivite"],
    ];
    for (const [chemin, marque] of cites) {
      expect(DOSSIER).toContain(chemin.join("/"));
      expect(SRC(...chemin), chemin.join("/")).toContain(marque);
    }
  });

  it("les modeles par defaut cites sont ceux du code", () => {
    // Si le defaut change sans que le dossier suive, il decrit un autre systeme.
    // (Les variables d'environnement peuvent les surcharger : on compare les defauts.)
    const defaut = (nom: string) => new RegExp(`${nom} = process\\.env\\.${nom} \\|\\| "([^"]+)"`).exec(SRC("services", "ai-utils.ts"))?.[1];
    for (const nom of ["GEMINI_PRO_MODEL", "OPENAI_MODEL", "ANTHROPIC_MODEL"]) {
      const d = defaut(nom);
      expect(d, `${nom} introuvable`).toBeTruthy();
      expect(DOSSIER, `${nom} = ${d}`).toContain(`\`${d}\``);
    }
    void [GEMINI_PRO_MODEL, OPENAI_MODEL, ANTHROPIC_MODEL];
  });

  it("les plafonds de la formule sont ceux decrits", () => {
    // appels 30, taux 20, taches 25, notes 10, actions 15 ; retards 20 au plus.
    expect(DOSSIER).toMatch(/appels 30, taux de réponse 20, tâches 25, notes 10, actions 15/);
    const plein = { appels: 1e6, appelsRepondus: 1e6, tachesTerminees: 1e6, tachesEnRetard: 0, notes: 1e6, actions: 1e9 };
    expect(scoreActivite(plein)).toBe(100); // 30+20+25+10+15
    expect(scoreActivite({ ...plein, tachesEnRetard: 1e6 })).toBe(80); // -20 au plus
  });

  it("« aucun apprentissage » : le code n'entraine rien", () => {
    expect(DOSSIER).toMatch(/Aucun apprentissage/);
    for (const f of ["performance-garde-fous.ts", "performance-analyzer.ts"]) {
      expect(SRC("services", f)).not.toMatch(/fine[-_ ]?tun|\.train\(|training_data/i);
    }
  });

  it("la journalisation decrite existe", () => {
    expect(DOSSIER).toContain("evaluation_salaries");
    for (const f of ["workforce-agent.ts", "workforce-intelligence.ts", "ai-commandant.ts"]) {
      expect(SRC("routes", f)).toContain('"evaluation_salaries"');
    }
  });

  it("l'echeance et le texte sont les bons", () => {
    expect(DOSSIER).toMatch(/2 décembre 2027/);
    expect(DOSSIER).toMatch(/2026\/1744/);
  });
});

describe("le registre des risques est tenu", () => {
  const lignes = REGISTRE.split(/\r?\n/).filter((l) => /^\| R-\d+ /.test(l));

  it("chaque risque a une mesure en place ou une action datee", () => {
    expect(lignes.length).toBeGreaterThanOrEqual(8);
    for (const l of lignes) {
      const cols = l.split("|").map((c) => c.trim());
      // | N° | Risque | Cause | Mesure | Residuel | Action |
      const mesure = cols[4] ?? "";
      const action = cols[6] ?? "";
      expect(mesure.length > 0 || /avant \d{2}\/\d{2}\/\d{4}/.test(action), l.slice(0, 40)).toBe(true);
    }
  });

  it("un risque residuel « eleve » a toujours une action datee", () => {
    for (const l of lignes.filter((x) => /\| élevé \|/.test(x))) {
      expect(l, l.slice(0, 40)).toMatch(/avant \d{2}\/\d{2}\/\d{4}/);
    }
  });

  it("R-6 (identite chez l'IA) renvoie a un test qui existe", () => {
    const l = lignes.find((x) => x.startsWith("| R-6 "))!;
    const test = /`([\w-]+\.test\.ts)`/.exec(l)?.[1];
    expect(test).toBeTruthy();
    expect(() => SRC("__tests__", test!)).not.toThrow();
  });
});
