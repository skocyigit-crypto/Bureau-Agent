/**
 * Une evaluation automatisee de salaries doit laisser une trace, et figurer
 * au registre.
 *
 * CE QUE FAIT REELLEMENT CET AGENT
 *
 * `workforce-agent` envoie a un modele, pour chaque salarie actif de
 * l'organisation: son NOM, son PRENOM, son role, son service et un SCORE
 * calcule a partir de son activite (appels, taches, notes, connexions). Il en
 * recoit un « diagnostic » et des « prescriptions » INDIVIDUELS, conserves
 * dans `ai_agent_reports`.
 *
 * Ce n'est pas une statistique d'equipe. C'est une evaluation automatisee de
 * personnes, et c'est la donnee la plus lourde de consequences que ce produit
 * traite — pas au sens de l'article 9, mais au sens du risque pour la
 * personne concernee.
 *
 * DEUX MANQUES CONSTATES, TOUS DEUX CORRIGEABLES PAR DU CODE
 *
 *   1. Aucune trace. On ne pouvait dire ni qui avait declenche l'evaluation,
 *      ni quand, ni sur combien de personnes. C'est exactement ce qu'un
 *      salarie — ou la CNIL — peut demander, et l'absence de reponse est
 *      elle-meme le manquement (art. 5.2, responsabilite).
 *
 *   2. Absente du registre des traitements, alors que le produit en tient un
 *      et le presente a l'exploitant. Un traitement non declare ne peut pas
 *      etre porte a la connaissance des salaries.
 *
 * CE QUE LE CODE NE PEUT PAS FAIRE, ET QUI RESTE DU
 *
 * Ces deux corrections ne rendent pas le traitement conforme. Restent des
 * obligations organisationnelles: consultation prealable du CSE (Code du
 * travail, art. L2312-38), information prealable des salaries (art. L1222-4),
 * analyse d'impact (AIPD), et l'interdiction de l'art. 22 RGPD de fonder une
 * decision produisant des effets significatifs sur le seul traitement
 * automatise. Ces tests verrouillent la part technique; ils ne pretendent pas
 * couvrir le reste, et le disent.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = join(import.meta.dirname, "..", "routes");
const AGENT = readFileSync(join(ROUTES, "workforce-agent.ts"), "utf8");
const REGISTRE = readFileSync(join(ROUTES, "data-protection.ts"), "utf8");

describe("le declenchement laisse une trace", () => {
  it("l'agent ecrit une entree d'audit", () => {
    expect(
      AGENT.includes("logAudit("),
      "aucune trace: impossible de dire qui a evalue qui, ni quand.",
    ).toBe(true);
  });

  it("l'action est nommee sans ambiguite", () => {
    // Une action nommee « ai_report » ne se retrouve pas dans un journal le
    // jour ou un salarie exerce son droit d'acces.
    expect(AGENT).toContain("workforce_evaluation_generated");
  });

  it("la trace retient le nombre de personnes evaluees", () => {
    // « Une evaluation a eu lieu » ne suffit pas: la portee du traitement
    // fait partie de ce qui doit pouvoir etre demontre.
    const i = AGENT.indexOf("workforce_evaluation_generated");
    expect(i).toBeGreaterThan(0);
    expect(AGENT.slice(i, i + 400)).toContain("employeeCount");
  });

  it("la trace retient l'auteur du declenchement", () => {
    const i = AGENT.indexOf("logAudit(");
    expect(AGENT.slice(i, i + 300)).toContain("userId");
  });

  it("une trace impossible a ecrire ne prive pas l'exploitant du rapport", () => {
    // L'inverse serait pire: refuser le rapport parce qu'une ecriture
    // secondaire a echoue. Le manque doit se voir dans les journaux, pas
    // casser la fonction.
    const i = AGENT.indexOf("logAudit(");
    const bloc = AGENT.slice(i, i + 800);
    expect(bloc).toContain(".catch(");
    expect(bloc).toMatch(/warn/);
  });

  it("l'evaluation reste reservee aux responsables", () => {
    // Un agent ordinaire ne doit pas pouvoir generer l'evaluation de ses
    // collegues.
    expect(AGENT).toContain('requireRole("administrateur", "super_admin")');
  });
});

describe("le traitement figure au registre", () => {
  it("une categorie nomme l'evaluation de salaries", () => {
    expect(
      /Évaluations automatisées de salariés/.test(REGISTRE),
      "le registre ne declare pas ce traitement: il ne peut donc pas etre " +
        "porte a la connaissance des salaries.",
    ).toBe(true);
  });

  it("elle est comptee sur des donnees reelles, pas annoncee a vide", () => {
    // Un registre qui affiche « 0 » quand des rapports existent est faux, et
    // c'est le genre d'erreur qu'une relecture ne voit pas.
    expect(REGISTRE).toContain("aiAgentReportsTable");
    expect(REGISTRE).toContain("evaluations[0]?.count");
  });

  it("elle est signalee comme demandant plus qu'une mention", () => {
    const i = REGISTRE.indexOf("Évaluations automatisées de salariés");
    expect(REGISTRE.slice(i, i + 600)).toContain("sensitive: true");
  });

  it("les obligations qui restent sont nommees, pas sous-entendues", () => {
    // Le point le plus important de cette categorie: dire clairement ce que
    // le code NE regle pas. Un exploitant qui lit « conforme » sans voir ces
    // trois lignes prendrait le registre pour un quitus.
    const i = REGISTRE.indexOf("Évaluations automatisées de salariés");
    const bloc = REGISTRE.slice(Math.max(0, i - 2500), i + 600);
    expect(bloc, "la consultation du CSE n'est pas mentionnee").toContain("L2312-38");
    expect(bloc, "l'information des salaries n'est pas mentionnee").toContain("L1222-4");
    expect(bloc, "l'analyse d'impact n'est pas mentionnee").toMatch(/AIPD|DPIA/);
    expect(bloc, "l'article 22 n'est pas mentionne").toMatch(/art\. 22|article 22/i);
  });

  it("la base legale annoncee n'est pas le consentement", () => {
    // Le consentement d'un salarie n'est pas libre au sens du RGPD: le
    // presenter comme base legale serait une erreur de fond, pas de forme.
    const i = REGISTRE.indexOf("Évaluations automatisées de salariés");
    const ligne = REGISTRE.slice(i, i + 600);
    expect(ligne).toMatch(/Intérêt légitime/);
    expect(ligne).not.toMatch(/Consentement|consentement \(Art\. 6\(1\)\(a\)\)/);
  });
});

describe("ce que ces tests ne couvrent pas", () => {
  it("la consultation du CSE et l'AIPD restent des actes hors du code", () => {
    // Test volontairement declaratif. Il existe pour qu'une relecture
    // rapide ne conclue pas de la presence de ce fichier que la conformite
    // est acquise: elle ne l'est pas, et la partie manquante ne s'ecrit pas
    // en TypeScript.
    const restantes = [
      "consultation prealable du CSE (L2312-38)",
      "information prealable des salaries (L1222-4)",
      "analyse d'impact (AIPD)",
      "art. 22: pas de decision fondee sur le seul traitement automatise",
    ];
    expect(restantes.length).toBe(4);
  });
});
