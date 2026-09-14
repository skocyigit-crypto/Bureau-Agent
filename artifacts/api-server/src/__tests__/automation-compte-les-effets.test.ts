/**
 * Une automatisation doit compter ce qui s'est PRODUIT, pas ce qu'elle a
 * tente.
 *
 * L'etat trouve: `executeAction` renvoyait `void`, et l'appelant incrementait
 * son compteur des que l'appel ne levait pas d'exception. Or plusieurs chemins
 * sortent en silence, sans lever:
 *
 *   - `create_task` sans organisation;
 *   - `send_sms` sans numero, sans fournisseur configure, ou refuse par le
 *     fournisseur;
 *   - `send_email` sans adresse, ou refuse a l'envoi;
 *   - un type d'action INCONNU.
 *
 * Le dernier est le plus net: une regle qui ne fait strictement rien etait
 * consignee « Reussi — N actions executees ».
 *
 * Ce que voyait le client dans son historique:
 *
 *     Regle « Relance client » — Reussi — 12 actions executees
 *
 * pendant que zero SMS partait, faute de fournisseur. Le seul temoin etait un
 * avertissement dans les journaux du serveur, qu'il ne verra jamais.
 *
 * C'est le defaut qui revient le plus souvent dans ce depot: compter
 * l'intention plutot que l'effet. Il a deja ete corrige sur les operations en
 * masse (on annoncait le nombre d'identifiants envoyes, pas le nombre de
 * lignes touchees). Ici il restait entier.
 *
 * Le test porte sur la FORME, car le comportement demanderait un vrai
 * fournisseur SMS et une vraie organisation: ce qui compte est que chaque
 * sortie de `executeAction` declare si l'action a eu lieu, et que la boucle
 * n'incremente que sur `true`. Le compilateur garantit le reste — une sortie
 * oubliee ne type plus.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOTEUR = readFileSync(
  join(import.meta.dirname, "..", "services", "automation-engine.ts"),
  "utf8",
);

describe("l'action dit si elle a eu lieu", () => {
  it("renvoie un booleen, plus `void`", () => {
    expect(
      /async function executeAction\([\s\S]{0,3000}?\): Promise<boolean> \{/.test(MOTEUR),
      "executeAction est revenue a `Promise<void>`: l'appelant ne peut plus distinguer " +
        "une action faite d'une action silencieusement abandonnee",
    ).toBe(true);
  });

  it.each([
    ["aucun fournisseur SMS configure", /aucun fournisseur SMS configure[\s\S]{0,120}?return false;/],
    ["numero cible absent", /numero cible absent[\s\S]{0,120}?return false;/],
    ["email cible absent", /email cible absent[\s\S]{0,120}?return false;/],
    ["type d'action inconnu", /Type d'action inconnu[\s\S]{0,120}?return false;/],
  ])("le chemin « %s » renvoie false", (_nom, motif) => {
    expect(motif.test(MOTEUR)).toBe(true);
  });

  it("une action mise en attente d'approbation n'est PAS comptee comme un echec", () => {
    // Nuance qui compte: la regle a fait son travail, la proposition est
    // visible dans la file. La marquer « sans effet » ferait passer pour casse
    // un fonctionnement voulu — l'erreur inverse, tout aussi trompeuse.
    expect(/await proposeAction\([^)]*\);\s*(?:\/\/[^\n]*\n\s*)*return true;/.test(MOTEUR)).toBe(true);
  });
});

describe("la boucle qui compte", () => {
  it("n'incremente que sur une action reellement effectuee", () => {
    expect(
      /const effectuee = await executeAction\([\s\S]{0,200}?if \(effectuee\) itemsProcessed\+\+;/.test(MOTEUR),
      "le compteur est revenu a « tout appel qui ne leve pas »",
    ).toBe(true);
  });

  it("compte a part ce qui n'a pas abouti", () => {
    expect(MOTEUR).toMatch(/let sansEffet = 0;/);
    expect(MOTEUR).toMatch(/else sansEffet\+\+;/);
  });

  it("consigne « partial » plutot que « success » des qu'une action manque", () => {
    expect(
      /sansEffet > 0 \? "partial" : "success"/.test(MOTEUR),
      "un passage ou des actions n'ont pas abouti serait de nouveau consigne « Reussi »",
    ).toBe(true);
    expect(MOTEUR).toMatch(/actionsSansEffet: sansEffet/);
  });
});

describe("ce que l'utilisateur lit", () => {
  const PAGE = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "buro-ajani", "src", "pages", "automations.tsx"),
    "utf8",
  );

  it("l'historique distingue le partiel du reussi et de l'echec", () => {
    // Sans cela, « partial » tomberait dans la branche « sinon » et
    // s'afficherait « Erreur »: on remplacerait un mensonge rassurant par un
    // mensonge alarmant.
    expect(PAGE).toContain('log.status === "partial"');
    expect(PAGE).toContain("automationsPage.logPartial");
  });

  it.each(["fr", "en", "tr", "de", "es", "ar"])("le libelle existe en %s", (langue) => {
    const json = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "buro-ajani", "src", "i18n", "locales", `${langue}.json`),
      "utf8",
    );
    const cle = JSON.parse(json).automationsPage?.logPartial;
    expect(typeof cle === "string" && cle.length > 0, `logPartial manquant en ${langue}`).toBe(true);
  });
});
