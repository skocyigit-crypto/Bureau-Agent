/**
 * Une reponse de modele mal formee faisait tomber l'ecran entier.
 *
 * `/commandant/overdue-reminders` renvoyait `aiAnalysis: parsed`, le JSON du
 * modele tel quel — et, quand ce JSON etait illisible, un objet de repli qui ne
 * porte QUE `dailySummary` :
 *
 *     catch { parsed = { dailySummary: aiResponse }; }
 *
 * Les ecrans font `data.aiAnalysis.criticalAlerts.map(...)`. Sur ce chemin de
 * repli — un modele qui repond en prose, une reponse tronquee, une limite de
 * jetons atteinte : rien d'exceptionnel — la lecture porte sur `undefined`,
 * c'est une TypeError pendant le rendu, et l'ecran entier tombe.
 *
 * Un modele n'est pas une source de donnees de confiance. Sa reponse se
 * normalise avant d'etre transmise, comme n'importe quelle entree exterieure.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normaliserAnalyse, normaliserReponseAppel } from "../services/analyse-commandant";

/** Ce que les ecrans parcourent sans jamais verifier. */
const LISTES = ["criticalAlerts", "taskReminders", "invoiceReminders", "eventReminders"] as const;

describe("le chemin de repli, celui qui faisait tomber l'ecran", () => {
  it("un objet sans aucune liste en rend quatre, vides", () => {
    const a = normaliserAnalyse({ dailySummary: "Le modele a repondu en prose." });
    for (const cle of LISTES) {
      expect(Array.isArray(a[cle]), `${cle} n'est pas un tableau: .map() lance une TypeError`).toBe(true);
      expect(a[cle]).toHaveLength(0);
    }
  });

  it("le resume est conserve", () => {
    expect(normaliserAnalyse({ dailySummary: "Trois factures en retard." }).dailySummary)
      .toBe("Trois factures en retard.");
  });

  it("une reponse vide ne casse rien", () => {
    const a = normaliserAnalyse({});
    expect(a.dailySummary).toBe("");
    expect(a.criticalAlerts).toEqual([]);
  });

  it("`null` non plus", () => {
    expect(normaliserAnalyse(null).criticalAlerts).toEqual([]);
  });

  it("ni une chaine a la place d'un objet", () => {
    // Un modele peut rendre une phrase la ou on attend une structure.
    expect(normaliserAnalyse("rien a signaler").taskReminders).toEqual([]);
  });
});

describe("ce que le modele rend bien est transmis tel quel", () => {
  const complet = {
    dailySummary: "Situation tendue.",
    criticalAlerts: ["Facture FAC-2026-000012 impayee depuis 45 jours"],
    taskReminders: [{ taskId: 1, message: "Relancer Dupont", urgency: "haute" }],
    invoiceReminders: [{ invoiceRef: "FAC-1", clientName: "Dupont", amount: 1200 }],
    eventReminders: [{ title: "Visite chantier", message: "demain 9h" }],
  };

  it("les alertes sont conservees", () => {
    expect(normaliserAnalyse(complet).criticalAlerts).toEqual(complet.criticalAlerts);
  });

  it("les rappels de taches aussi", () => {
    expect(normaliserAnalyse(complet).taskReminders).toEqual(complet.taskReminders);
  });

  it("les rappels de factures aussi", () => {
    expect(normaliserAnalyse(complet).invoiceReminders).toEqual(complet.invoiceReminders);
  });

  it("le correctif ne vide donc pas ce qui marchait", () => {
    const a = normaliserAnalyse(complet);
    expect(a.eventReminders).toHaveLength(1);
    expect(a.dailySummary).toBe("Situation tendue.");
  });
});

describe("les formes intermediaires, celles qu'un modele produit vraiment", () => {
  it("une liste rendue comme un objet unique devient une liste vide", () => {
    // Mieux vaut une section vide qu'un `.map` sur un objet.
    expect(normaliserAnalyse({ criticalAlerts: { texte: "x" } }).criticalAlerts).toEqual([]);
  });

  it("une alerte non textuelle est ramenee a du texte", () => {
    // Les alertes sont AFFICHEES: un objet y rendrait « [object Object] ».
    expect(normaliserAnalyse({ criticalAlerts: [42] }).criticalAlerts).toEqual(["42"]);
  });

  it("les alertes vides sont ecartees", () => {
    expect(normaliserAnalyse({ criticalAlerts: ["", "   ", "vraie alerte"] }).criticalAlerts)
      .toEqual(["vraie alerte"]);
  });

  it("un resume non textuel ne s'affiche pas « undefined »", () => {
    expect(normaliserAnalyse({ dailySummary: 12 }).dailySummary).toBe("");
  });
});

describe("la route passe bien par la", () => {
  const route = readFileSync(
    join(import.meta.dirname, "..", "routes", "ai-commandant.ts"), "utf8",
  );

  it("elle ne renvoie plus le JSON du modele tel quel", () => {
    expect(route, "c'est cette ligne qui exposait le repli aux ecrans")
      .not.toMatch(/aiAnalysis: parsed,/);
  });

  it("elle normalise", () => {
    expect(route).toMatch(/aiAnalysis: normaliserAnalyse\(parsed\)/);
  });

  it("le chemin de repli existe toujours: c'est lui qu'on protege", () => {
    expect(route).toMatch(/parsed = \{ dailySummary: aiResponse \}/);
  });
});

describe("l'assistance en appel: un JSON valide mais incomplet", () => {
  it("une reponse sans `suggestedResponses` en rend une liste vide", () => {
    // Le repli de `safeJsonParse` fournit bien la cle — mais il ne sert QUE si
    // le JSON est illisible. Un JSON valide qui l'oublie passait a travers, et
    // l'ecran faisait `.map()` sur `undefined`.
    const r = normaliserReponseAppel({ greeting: "Bonjour Monsieur Dupont" });
    expect(Array.isArray(r.suggestedResponses)).toBe(true);
    expect(r.suggestedResponses).toHaveLength(0);
  });

  it("le salut est conserve", () => {
    expect(normaliserReponseAppel({ greeting: "Bonjour" }).greeting).toBe("Bonjour");
  });

  it("les reponses proposees le sont aussi", () => {
    const r = normaliserReponseAppel({ suggestedResponses: ["Je vous rappelle demain", "Je verifie"] });
    expect(r.suggestedResponses).toHaveLength(2);
  });

  it("les actions recommandees restent une liste", () => {
    expect(normaliserReponseAppel({ recommendedActions: null }).recommendedActions).toEqual([]);
  });

  it("la route passe par la", () => {
    const route = readFileSync(join(import.meta.dirname, "..", "routes", "ai-commandant.ts"), "utf8");
    expect(route).not.toMatch(/aiResponse: parsed,/);
    expect(route).toMatch(/aiResponse: normaliserReponseAppel\(parsed\)/);
  });
});
