/**
 * Moteur de calcul en langage naturel (`services/math-engine.ts`) — 832 lignes,
 * 18 processeurs, aucun test jusqu'ici. Il alimente les reponses chiffrees
 * rendues a l'utilisateur, donc une erreur y est invisible : le resultat est
 * faux mais presente avec des etapes et un score de confiance.
 *
 * INVARIANT CENTRAL VERROUILLE ICI — aucun resultat numerique non fini ne doit
 * sortir du moteur.
 *
 * `JSON.stringify(NaN)`, `JSON.stringify(Infinity)` et `JSON.stringify(-Infinity)`
 * valent tous `null`. Avant correction, `10 / 0` produisait NaN avec
 * confidence 0.99, et `ln(0)` / `9^999` produisaient ±Infinity avec confidence
 * 0.95. Le client recevait donc `result: null` accompagne d'etapes affirmant
 * "= -∞" — un calcul non abouti presente comme abouti. C'est exactement le type
 * de rupture silencieuse du flux d'information que cette suite doit empecher.
 */
import { describe, expect, it } from "vitest";
import {
  analyzeMath,
  detectMathExpressions,
  type MathSubComponent,
} from "../services/math-engine";

/** Composants d'un type donne, dans l'ordre de detection. */
function componentsOfType(text: string, type: string): MathSubComponent[] {
  return analyzeMath(text).subComponents.filter((c) => c.type === type);
}

/** Resultat numerique du premier composant du type demande. */
function firstResult(text: string, type: string): number | string | undefined {
  return componentsOfType(text, type)[0]?.result;
}

describe("math-engine — invariant de finitude", () => {
  const NON_FINITE_CASES = [
    ["10 / 0", "division par zero"],
    ["ln(0)", "logarithme naturel de zero"],
    ["log(0)", "logarithme decimal de zero"],
    ["9^999", "depassement de capacite"],
  ] as const;

  for (const [text, label] of NON_FINITE_CASES) {
    it(`n'emet aucun resultat non fini — ${label} (${text})`, () => {
      const analysis = analyzeMath(text);
      for (const component of analysis.subComponents) {
        if (typeof component.result === "number") {
          expect(
            Number.isFinite(component.result),
            `${component.type} "${component.expression}" -> ${component.result}`,
          ).toBe(true);
        }
      }
      if (typeof analysis.finalResult === "number") {
        expect(Number.isFinite(analysis.finalResult)).toBe(true);
      }
    });
  }

  it("survit a la serialisation JSON sans perdre de resultat", () => {
    // Le vrai test du flux d'information : ce que le client recoit vraiment.
    // Un `null` ici signifierait un calcul affiche mais vide.
    for (const [text] of NON_FINITE_CASES) {
      const analysis = analyzeMath(text);
      const roundTripped = JSON.parse(JSON.stringify(analysis)) as typeof analysis;
      for (const component of roundTripped.subComponents) {
        expect(component.result, `${text} / ${component.expression}`).not.toBe(
          null,
        );
      }
      if (analysis.finalResult !== undefined) {
        expect(roundTripped.finalResult, text).not.toBe(null);
      }
    }
  });

  it("ecarte la division par zero au lieu de la rapporter", () => {
    expect(componentsOfType("10 / 0", "arithmetic")).toHaveLength(0);
    // La fraction ignorait deja ce cas : les deux voies sont coherentes.
    expect(componentsOfType("10 / 0", "fraction")).toHaveLength(0);
  });
});

describe("math-engine — pourcentages", () => {
  it("calcule un pourcentage d'une base", () => {
    expect(firstResult("15% de 200", "percentage")).toBe(30);
    expect(firstResult("7,5% de 400", "percentage")).toBe(30);
  });

  it("convertit un pourcentage isole en fraction decimale", () => {
    const simple = componentsOfType("une remise de 20%", "percentage");
    expect(simple[0]?.result).toBeCloseTo(0.2, 10);
  });

  it("ne compte pas deux fois le pourcentage d'une expression complete", () => {
    // "15% de 200" contient "15%" : le second motif doit etre neutralise,
    // sinon un meme chiffre serait rapporte deux fois avec deux resultats.
    const pcts = componentsOfType("15% de 200", "percentage");
    expect(pcts).toHaveLength(1);
    expect(pcts[0].result).toBe(30);
  });
});

describe("math-engine — arithmetique", () => {
  it("applique les quatre operations", () => {
    expect(firstResult("12 + 8", "arithmetic")).toBe(20);
    expect(firstResult("12 - 8", "arithmetic")).toBe(4);
    expect(firstResult("12 * 8", "arithmetic")).toBe(96);
    expect(firstResult("12 / 8", "arithmetic")).toBe(1.5);
  });

  it("accepte les symboles × et ÷", () => {
    expect(firstResult("6 × 7", "arithmetic")).toBe(42);
    expect(firstResult("84 ÷ 2", "arithmetic")).toBe(42);
  });

  it("lit la virgule decimale francaise", () => {
    expect(firstResult("1,5 + 2,5", "arithmetic")).toBe(4);
  });
});

describe("math-engine — financier", () => {
  it("passe du HT au TTC avec une TVA a 20%", () => {
    expect(firstResult("100 € HT", "financial")).toBeCloseTo(120, 10);
  });

  it("passe du TTC au HT sans perte d'aller-retour", () => {
    // Invariant metier: HT -> TTC -> HT doit revenir au point de depart.
    const ht = firstResult("120 € TTC", "financial") as number;
    expect(ht).toBeCloseTo(100, 10);
    expect(firstResult(`${ht} € HT`, "financial")).toBeCloseTo(120, 8);
  });

  it("calcule un taux de marge", () => {
    expect(firstResult("marge 25 € sur 100", "financial")).toBeCloseTo(25, 10);
  });

  it("renvoie 0% de marge sur un chiffre d'affaires nul", () => {
    // Sans le garde anti div/0, ce cas remontait Infinity — donc `null` apres
    // serialisation, affiche comme un taux de marge.
    expect(firstResult("marge 25 € sur 0", "financial")).toBe(0);
  });
});

describe("math-engine — scientifique", () => {
  it("calcule puissances et racines", () => {
    expect(firstResult("2^10", "power")).toBe(1024);
    expect(firstResult("sqrt(144)", "root")).toBe(12);
  });

  it("calcule les logarithmes sur leur domaine de definition", () => {
    expect(firstResult("ln(1)", "logarithm")).toBe(0);
    expect(firstResult("log(100)", "logarithm")).toBeCloseTo(2, 10);
  });
});

describe("math-engine — ratios et fractions", () => {
  it("simplifie un ratio par le PGCD", () => {
    expect(firstResult("16 : 24", "ratio")).toBe("2:3");
  });

  it("evalue une fraction", () => {
    expect(firstResult("3 / 4", "fraction")).toBe(0.75);
  });
});

describe("math-engine — detection et agregation", () => {
  it("detecte la presence d'une expression calculable", () => {
    expect(detectMathExpressions("15% de 200")).toBe(true);
    expect(detectMathExpressions("bonjour, comment allez-vous ?")).toBe(false);
  });

  it("ne detecte rien dans un texte sans chiffres", () => {
    const analysis = analyzeMath("bonjour, comment allez-vous ?");
    expect(analysis.detected).toBe(false);
    expect(analysis.subComponents).toHaveLength(0);
    expect(analysis.finalResult).toBeUndefined();
  });

  it("classe un calcul financier isole comme financier", () => {
    expect(analyzeMath("100 € HT").category).toBe("financial");
  });

  it("deduplique les expressions identiques d'un meme type", () => {
    const analysis = analyzeMath("12 + 8 et encore 12 + 8");
    const arithmetic = analysis.subComponents.filter(
      (c) => c.type === "arithmetic",
    );
    expect(arithmetic).toHaveLength(1);
  });

  it("attribue un score de confiance exploitable a chaque composant", () => {
    // Un composant sans confiance utilisable rendrait l'arbitrage impossible
    // cote appelant, qui s'en sert pour decider d'afficher ou non le calcul.
    for (const component of analyzeMath("15% de 200 et 2^10").subComponents) {
      expect(component.confidence).toBeGreaterThan(0);
      expect(component.confidence).toBeLessThanOrEqual(1);
    }
  });
});
