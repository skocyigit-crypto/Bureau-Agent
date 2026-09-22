/**
 * La notice d'utilisation de l'IA (AI Act, art. 13) dit ce que fait le code.
 *
 * Une notice remise a l'employeur engage l'editeur : c'est sur elle que le
 * deployeur fonde sa supervision et son information des salaries. Chaque
 * affirmation verifiable dans le code l'est ici — une notice fausse est pire
 * qu'une notice absente.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scoreActivite } from "../services/performance-garde-fous";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const NOTICE = readFileSync(join(RACINE, "artifacts", "tanitim", "src", "content", "conformite-employeur", "notice-utilisation-ia.md"), "utf8");
const SRC = (...p: string[]) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");

const zero = { appels: 0, appelsRepondus: 0, tachesTerminees: 0, tachesEnRetard: 0, notes: 0, actions: 0 };

describe("le score est UNE formule fixe", () => {
  it("les deux surfaces qui l'affichent appellent la meme fonction", () => {
    for (const f of ["workforce-agent.ts", "workforce-intelligence.ts"]) {
      expect(SRC("routes", f), f).toContain("scoreActivite(");
    }
  });

  it("plus aucune copie de la formule dans les routes", () => {
    for (const f of ["workforce-agent.ts", "workforce-intelligence.ts"]) {
      expect(SRC("routes", f), f).not.toMatch(/Math\.min\([\w.]+ \* 3, 30\)/);
    }
  });

  it("sans activite, le score vaut 10 (le taux de reponse neutre)", () => {
    // Un salarie absent parait « peu actif » : c'est la limite que la notice
    // oblige a dire.
    expect(scoreActivite(zero)).toBe(10);
  });

  it("chaque composante est plafonnee", () => {
    const max = scoreActivite({ appels: 1000, appelsRepondus: 1000, tachesTerminees: 1000, tachesEnRetard: 0, notes: 1000, actions: 100000 });
    expect(max).toBe(100);
  });

  it("les retards retranchent au plus 20 points", () => {
    const base = { ...zero, tachesTerminees: 5 }; // 20 + 10 (taux neutre) = 30
    expect(scoreActivite(base)).toBe(30);
    expect(scoreActivite({ ...base, tachesEnRetard: 100 })).toBe(10);
  });

  it("le score reste dans 0..100", () => {
    expect(scoreActivite({ ...zero, appels: 1, appelsRepondus: 0, tachesEnRetard: 100 })).toBe(0);
  });
});

describe("la notice dit vrai", () => {
  it("elle dit que le score est une formule, pas un jugement du modele", () => {
    expect(NOTICE).toMatch(/Le score est une formule fixe/);
  });

  it("elle avoue les limites qui decoulent de la formule", () => {
    // Activite dans le logiciel seulement ; absences ignorees ; jamais validee.
    expect(NOTICE).toMatch(/Seule l'activité enregistrée dans le logiciel est comptée/);
    expect(NOTICE).toMatch(/Absences, temps partiel/);
    expect(NOTICE).toMatch(/jamais été validée/);
  });

  it("aucune identite chez le fournisseur d'IA : les trois routes pseudonymisent", () => {
    expect(NOTICE).toMatch(/aucune identité/);
    for (const f of ["workforce-agent.ts", "workforce-intelligence.ts", "ai-commandant.ts"]) {
      expect(SRC("routes", f), f).toContain("reidentifierNoms(");
    }
  });

  it("les fonctions dites « sans conservation » n'ecrivent rien en base", () => {
    // workforce-intelligence et la qualite d'equipe du Commandant.
    const wi = SRC("routes", "workforce-intelligence.ts");
    expect(wi).not.toMatch(/db\.insert\(/);
    const cmd = SRC("routes", "ai-commandant.ts");
    const i = cmd.indexOf('router.get("/commandant/employee-quality"');
    const bloc = cmd.slice(i, cmd.indexOf("// CONVERSATIONS (Chat persistant", i));
    expect(bloc).not.toMatch(/db\.insert\(/);
  });

  it("les fonctions dites « conservees » ecrivent bien leur rapport", () => {
    expect(SRC("services", "performance-analyzer.ts")).toMatch(/insert\(performanceReportsTable\)/);
    expect(SRC("routes", "workforce-agent.ts")).toMatch(/insert\(aiAgentReportsTable\)/);
  });

  it("la journalisation annoncee existe (art. 12)", () => {
    expect(NOTICE).toMatch(/evaluation_salaries/);
    for (const f of ["workforce-agent.ts", "workforce-intelligence.ts", "ai-commandant.ts"]) {
      expect(SRC("routes", f), f).toContain('"evaluation_salaries"');
    }
  });

  it("l'acces est reserve aux administrateurs", () => {
    for (const f of ["workforce-agent.ts", "workforce-intelligence.ts"]) {
      expect(SRC("routes", f), f).toMatch(/requireRole\("administrateur", "super_admin"\)/);
    }
    expect(SRC("routes", "ai-commandant.ts")).toMatch(/"\/commandant\/employee-quality", requireRole\("super_admin", "administrateur"\)/);
  });

  it("les dates du reglement sont celles du texte modifie", () => {
    expect(NOTICE).toMatch(/2 décembre 2027/);
    expect(NOTICE).toMatch(/2026\/1744/);
    expect(NOTICE).toMatch(/2 août 2026/);
  });
});
