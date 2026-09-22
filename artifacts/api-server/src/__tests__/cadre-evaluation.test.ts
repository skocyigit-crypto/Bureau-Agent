/**
 * Le cadre que chaque rapport d'evaluation porte a l'ecran (registre des
 * risques, docs/conformite-ia : R-1a, R-5a, R-8a).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEUIL_PETITE_EQUIPE, cadreEvaluation } from "../services/performance-garde-fous";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const lire = (...p: string[]) => readFileSync(join(RACINE, ...p), "utf8");

describe("cadreEvaluation", () => {
  it("dit toujours : genere par IA, hypothese a verifier", () => {
    expect(cadreEvaluation(40)).toMatchObject({ genereParIa: true, nature: "hypothese_a_verifier" });
  });
  it("signale une petite equipe sous le seuil", () => {
    expect(SEUIL_PETITE_EQUIPE).toBe(5);
    expect(cadreEvaluation(4).petiteEquipe).toBe(true);
    expect(cadreEvaluation(5).petiteEquipe).toBe(false);
  });
  it("pas d'avertissement pour une equipe vide", () => {
    expect(cadreEvaluation(0).petiteEquipe).toBe(false);
  });
  it("pas d'avertissement pour un rapport individuel : la personne est nommee", () => {
    expect(cadreEvaluation(1, true).petiteEquipe).toBe(false);
  });
});

describe("les quatre surfaces renvoient le cadre", () => {
  const routes: Array<[string, RegExp]> = [
    ["performance.ts", /cadre: cadreEvaluation\(effectif, Boolean\(employeId\)\)/],
    ["workforce-agent.ts", /cadre: cadreEvaluation\(result\.employeeCount\)/],
    ["workforce-intelligence.ts", /cadre: cadreEvaluation\(employees\.length\)/],
    ["ai-commandant.ts", /cadre: cadreEvaluation\(employees\.length\)/],
  ];
  for (const [f, motif] of routes) {
    it(f, () => { expect(lire("artifacts", "api-server", "src", "routes", f)).toMatch(motif); });
  }
});

describe("et les ecrans l'affichent", () => {
  it("web : page performance, au-dessus de l'analyse", () => {
    const s = lire("artifacts", "buro-ajani", "src", "pages", "performance.tsx");
    expect(s).toContain("<CadreEvaluationIa cadre={rapport.cadre} />");
  });
  for (const f of ["workforce-agent.tsx", "workforce-intelligence.tsx"]) {
    it(`mobile : ${f}`, () => {
      expect(lire("artifacts", "mobile", "app", f)).toContain("<CadreEvaluationIa cadre={data?.cadre} />");
    });
  }
  for (const app of ["buro-ajani/src/i18n/locales", "mobile/lib/i18n/locales"]) {
    for (const l of ["fr", "en", "tr", "es", "de", "ar"]) {
      it(`${app} ${l} : textes traduits`, () => {
        const j = JSON.parse(lire("artifacts", ...app.split("/"), `${l}.json`)).cadreEvaluationIa;
        expect(j.hypothese?.trim()).toBeTruthy();
        expect(j.petiteEquipe).toContain("{{count}}");
      });
    }
  }
});
