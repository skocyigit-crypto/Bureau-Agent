/**
 * Paliers de `/ai/execute` : lire, ecrire chez soi, sortir, toucher a l'argent.
 *
 * Le tableau `PALIERS_AI_EXECUTE` ne protege que si CHAQUE type traite par la
 * route y figure, et si la barriere est posee AVANT le switch (les etapes de
 * `chain_actions` rappellent la route). Ces controles lisent la route elle-meme
 * : un nouveau `case` sans palier, ou une branche `send_email` qui reapparait,
 * les fait tomber.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PALIERS_AI_EXECUTE,
  palierAction,
  lireEmailSuggere,
  REFUS_FINANCIER,
} from "../services/paliers-actions-ia";

const SRC = join(import.meta.dirname, "..");
const route = readFileSync(join(SRC, "routes", "ai-analysis.ts"), "utf8");

/** Corps de la route POST /ai/execute, jusqu'a la route suivante. */
const execute = (() => {
  const debut = route.indexOf('router.post("/ai/execute"');
  const fin = route.indexOf("router.", debut + 10);
  return route.slice(debut, fin);
})();

/** Types traites par le switch principal (indentation de ses `case`). */
const casDuSwitch = [...execute.matchAll(/^ {6}case "([a-z_]+)"/gm)].map((m) => m[1]!);

const parPalier = (p: string) =>
  Object.entries(PALIERS_AI_EXECUTE).filter(([, v]) => v === p).map(([k]) => k);

describe("la route et le tableau disent la meme chose", () => {
  it("l'instrument lit bien la route (garde-fou)", () => {
    expect(execute.length).toBeGreaterThan(1000);
    expect(casDuSwitch.length).toBeGreaterThanOrEqual(30);
    expect(casDuSwitch).toContain("create_task");
  });

  it("chaque type du switch a un palier", () => {
    const sansPalier = casDuSwitch.filter((t) => palierAction(t) === undefined);
    expect(sansPalier, "type ajoute a /ai/execute sans palier").toEqual([]);
  });

  it("le tableau ne declare pas de type lecture/interne que la route ne traite pas", () => {
    const fantomes = [...parPalier("lecture"), ...parPalier("interne")].filter((t) => !casDuSwitch.includes(t));
    expect(fantomes).toEqual([]);
  });

  it("aucun type externe ou financier n'a de branche d'execution directe", () => {
    const directs = [...parPalier("externe"), ...parPalier("financier")].filter((t) => casDuSwitch.includes(t));
    expect(directs, "une action sortante s'execute de nouveau sans file").toEqual([]);
  });

  it("la barriere precede le switch", () => {
    const barriere = execute.indexOf("palierAction(");
    const aiguillage = execute.indexOf("switch (type)");
    expect(barriere).toBeGreaterThan(-1);
    expect(aiguillage).toBeGreaterThan(-1);
    expect(barriere).toBeLessThan(aiguillage);
  });

  it("un e-mail suggere part en file d'approbation, pas en envoi", () => {
    expect(execute).toMatch(/enqueueProposal\(\{[\s\S]*?toolName: "send_email"/);
    expect(execute, "la route envoie de nouveau elle-meme").not.toMatch(/\bsendEmail\s*\(/);
  });

  it("chain_actions rappelle la route : ses etapes repassent la barriere", () => {
    expect(palierAction("chain_actions")).toBe("interne");
    expect(execute).toMatch(/fetch\(`http:\/\/127\.0\.0\.1:\$\{port\}\/api\/ai\/execute`/);
  });
});

describe("classification", () => {
  it("argent et documents comptables sont financiers", () => {
    for (const t of ["create_invoice", "record_payment", "send_invoice_email", "send_payment_reminder"]) {
      expect(palierAction(t), t).toBe("financier");
    }
  });

  it("un e-mail vers l'exterieur est externe ; une notification interne ne l'est pas", () => {
    expect(palierAction("send_email")).toBe("externe");
    expect(palierAction("send_notification")).toBe("interne");
  });

  it("un type inconnu, ou une cle d'objet heritee, n'a pas de palier", () => {
    expect(palierAction("vider_la_base")).toBeUndefined();
    expect(palierAction("constructor")).toBeUndefined();
    expect(palierAction("__proto__")).toBeUndefined();
    expect(palierAction("toString")).toBeUndefined();
  });

  it("le refus financier dit ou aller", () => {
    expect(REFUS_FINANCIER).toMatch(/Factures/);
  });

  it("l'ecran de l'assistant ne propose aucun type financier", () => {
    const ecran = readFileSync(
      join(SRC, "..", "..", "buro-ajani", "src", "components", "ai-assistant.tsx"), "utf8",
    );
    const m = ecran.match(/const executableTypes = \[([^\]]+)\]/);
    expect(m, "liste executableTypes introuvable").not.toBeNull();
    const types = [...m![1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
    expect(types.length).toBeGreaterThan(10);
    expect(types.filter((t) => palierAction(t) === "financier")).toEqual([]);
  });
});

describe("lecture d'un e-mail suggere", () => {
  it("accepte un objet ou sa forme JSON", () => {
    const e = { to: "a@b.fr", subject: "Devis", body: "Bonjour" };
    expect(lireEmailSuggere(e)).toEqual(e);
    expect(lireEmailSuggere(JSON.stringify(e))).toEqual(e);
  });

  it("prend le premier destinataire d'une liste — un seul e-mail par proposition", () => {
    expect(lireEmailSuggere({ to: ["a@b.fr", "c@d.fr"], subject: "S", body: "B" })?.to).toBe("a@b.fr");
  });

  it("refuse une cible incomplete, vide ou illisible", () => {
    expect(lireEmailSuggere({ to: "a@b.fr", subject: "S" })).toBeNull();
    expect(lireEmailSuggere({ to: "  ", subject: "S", body: "B" })).toBeNull();
    expect(lireEmailSuggere({ to: "a@b.fr", subject: "S", body: "   " })).toBeNull();
    expect(lireEmailSuggere("{pas du json")).toBeNull();
    expect(lireEmailSuggere(null)).toBeNull();
    expect(lireEmailSuggere({ to: 42, subject: "S", body: "B" })).toBeNull();
  });
});
