import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Le moteur d'automatisation est la seule voie par laquelle le produit envoie
 * un message a un tiers sans qu'un humain ait clique. Une regle qui se
 * declenche seule peut envoyer un SMS ou un e-mail a un client reel: c'est
 * pourquoi ces deux actions passent par la file de propositions.
 *
 * Ce garde etait contournable. Il s'ecrivait `if (orgId && needsApproval(...))`,
 * alors que `automation_rules.organisation_id` est nullable: une regle sans
 * organisation sautait le controle entier et l'envoi partait directement. Un
 * champ absent desactivait silencieusement une protection — et ce depot a deja
 * connu des lignes creees avec `organisation_id = NULL` (cf. routes/auth.ts).
 *
 * La regle retenue: l'approbation ne depend jamais d'une donnee facultative, et
 * l'absence d'organisation fait refuser l'action au lieu de l'executer. Une
 * action sortante non relue vaut moins qu'une action non faite.
 */

const SRC = join(import.meta.dirname, "..", "services", "automation-engine.ts");
const source = readFileSync(SRC, "utf8");

describe("politique d'approbation des automatisations", () => {
  it("soumet a approbation tout ce qui sort vers un tiers", () => {
    const set = source.match(/const OUTBOUND_ACTIONS = new Set\(\[([^\]]*)\]/);
    expect(set, "OUTBOUND_ACTIONS introuvable").not.toBeNull();
    const listed = [...set![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(["send_email", "send_sms"]);
  });

  it("couvre chaque action qui atteint l'exterieur", () => {
    // Un `case` ajoute plus tard pour appeler un service tiers — webhook,
    // WhatsApp, appel sortant — passerait sans approbation s'il n'etait pas
    // ajoute a OUTBOUND_ACTIONS. Ce cliquet oblige a y penser.
    // Restreint au switch de executeAction: getTriggerItems en contient un
    // autre, dont les cases sont des declencheurs et non des actions.
    const body = source.slice(
      source.indexOf("async function executeAction"),
      source.indexOf("async function proposeAction"),
    );
    const cases = [...body.matchAll(/^\s{4}case "([a-z_]+)": \{/gm)].map((m) => m[1]).sort();
    expect(cases).toEqual(["create_task", "send_email", "send_notification", "send_sms"]);
  });

  it("ne conditionne pas l'approbation a la presence de l'organisation", () => {
    // La regression exacte: `orgId &&` devant le controle le rendait
    // facultatif.
    expect(source).not.toMatch(/if\s*\(\s*orgId\s*&&\s*needsApproval/);
    expect(source).toMatch(/if\s*\(\s*needsApproval\(action\.type, requiresApproval\)\s*\)/);
  });

  it("refuse l'action sortante quand l'organisation manque, au lieu de l'envoyer", () => {
    // Sans organisation la proposition ne peut pas etre mise en file: le seul
    // comportement acceptable est de ne rien envoyer.
    const guard = source.slice(
      source.indexOf("if (needsApproval(action.type, requiresApproval))"),
      source.indexOf("switch (action.type)"),
    );
    expect(guard).toMatch(/if\s*\(\s*!orgId\s*\)/);
    // Le refus precede l'appel a proposeAction et rend la main avant le switch.
    expect(guard.indexOf("!orgId")).toBeLessThan(guard.indexOf("proposeAction"));
    expect(guard).toContain("return;");
    expect(guard).toMatch(/logger\.error/);
  });

  it("laisse l'operateur exiger ou lever l'approbation explicitement", () => {
    // `requiresApproval` a trois etats: le null retombe sur la politique par
    // defaut, et seul un false explicite dispense une action sortante.
    const fn = source.slice(
      source.indexOf("function needsApproval"),
      source.indexOf("function needsApproval") + 400,
    );
    expect(fn).toMatch(/requiresApproval === false/);
    expect(fn).toMatch(/requiresApproval === true/);
    expect(fn).toMatch(/OUTBOUND_ACTIONS\.has\(actionType\)/);
  });
});

describe("declencheurs d'automatisation", () => {
  it("ne partent que d'evenements internes, jamais d'une sortie de modele", () => {
    // Si une sortie de modele pouvait declencher une regle, l'invariant
    // d'approbation humaine verrouille ailleurs (human-in-the-loop.test.ts)
    // serait contournable par ce chemin.
    const triggers = [...source.matchAll(/case "([a-z_]+)":\s*\n\s*(?:\/\/[^\n]*\n\s*)*return getTriggerItems/g)];
    expect(source).toContain("missed_call");
    expect(source).not.toMatch(/trigger.*ai_|model_output|agent_suggestion/);
    void triggers;
  });
});
