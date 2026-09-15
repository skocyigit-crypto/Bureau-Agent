/**
 * Une sonde qui ne peut pas echouer ne mesure rien.
 *
 * LA MESURE QUI A TRANCHE
 *
 * Le 15 septembre 2026, apres trois corrections successives, l'agent de sante
 * ne voyait toujours pas la panne de Gemini. Les deux horodatages suivants
 * disent pourquoi:
 *
 *     13h00:26,7   bascule « gemini -> autre fournisseur »,
 *                  cause: 429 prepayment credits are depleted
 *     13h00:30,0   l'agent de sante lit
 *                  « gemini  enPanne: false  echecs: 0  vu il y a 3 296 ms »
 *
 * Les 3 296 ms sont exactement l'ecart entre les deux lignes: la bascule de
 * 13h00:26,7 EST la sonde de l'agent. Sur la journee: seize bascules reelles,
 * ZERO sonde en echec.
 *
 * LA CAUSE
 *
 * `callGemini` passe par le client Gemini PARTAGE, dont `generateContent` est
 * patche: quand Gemini refuse, le patch bascule sur un autre fournisseur et
 * rend sa reponse. La sonde recoit donc du texte et conclut que Gemini
 * repond — alors que c'est Anthropic qui vient de parler. Elle ne peut pas
 * echouer, quelle que soit la panne.
 *
 * C'est le meme defaut que celui du 1er septembre, a un etage de plus: la
 * bascule masque la panne pour l'utilisateur — c'est son role — mais alors
 * plus rien ne la signale. Chaque correction en a retire une couche; celle-ci
 * retire la derniere.
 *
 * CE QUI DISTINGUE LES DEUX CAS
 *
 * `res.provider` vaut toujours le fournisseur interroge: `callGemini` l'ecrit
 * en dur. La verite est dans le MODELE, que le patch prefixe du fournisseur
 * ayant reellement servi (`anthropic:claude-...`). C'est la seule information
 * qui traverse, et ces tests la verrouillent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  join(import.meta.dirname, "..", "services", "ai-failover.ts"),
  "utf8",
);

/** Le corps de `probeStaleProviders`, seul endroit concerne. */
function corpsDeLaSonde(): string {
  const debut = SOURCE.indexOf("export async function probeStaleProviders");
  expect(debut, "`probeStaleProviders` a disparu").toBeGreaterThan(0);
  const fin = SOURCE.indexOf("\n}", debut);
  return SOURCE.slice(debut, fin);
}

describe("la sonde verifie QUI a repondu", () => {
  it("elle compare le fournisseur ayant servi a celui qu'elle interroge", () => {
    const corps = corpsDeLaSonde();
    expect(
      /aRepondu\s*!==\s*name/.test(corps),
      "sans cette comparaison, la sonde prend la reponse d'un autre " +
        "fournisseur pour une preuve de sante — et ne peut plus jamais echouer.",
    ).toBe(true);
  });

  it("elle lit le modele, pas le champ `provider`", () => {
    // `callGemini` ecrit `provider: "gemini"` en dur: ce champ ne peut pas
    // trahir une bascule. Seul le modele porte le prefixe du fournisseur qui
    // a reellement servi.
    //
    // Une premiere version de ce test cherchait `res.model` N'IMPORTE OU dans
    // le corps. Mesure par mutation: en derivant `aRepondu` de `res.provider`,
    // le test restait VERT — parce que `res.model` figure aussi dans la ligne
    // de journal juste en dessous. Un test qui cherche une chaine quelque part
    // ne dit rien de l'endroit ou elle compte.
    const corps = corpsDeLaSonde();
    const ligne = corps.split("\n").find((l) => /const\s+aRepondu\s*=/.test(l));
    expect(ligne, "`aRepondu` n'est plus derive nulle part").toBeDefined();
    expect(
      ligne!,
      "`aRepondu` doit venir du MODELE: `res.provider` vaut toujours `name`, " +
        "la comparaison serait alors toujours fausse et la sonde de nouveau " +
        "incapable d'echouer.",
    ).toContain("res.model");
    expect(ligne!).not.toContain("res.provider");
  });

  it("une sonde servie par un autre compte comme un echec", () => {
    // Pas seulement « ne compte pas comme un succes »: c'est bien la preuve
    // que le fournisseur interroge ne repond plus.
    const corps = corpsDeLaSonde();
    const i = corps.indexOf("aRepondu !== name");
    expect(i).toBeGreaterThan(0);
    const bloc = corps.slice(i, i + 500);
    expect(bloc).toContain("noteFailure(");
  });

  it("elle le dit dans les journaux", () => {
    // Une sonde qui se disqualifie en silence rend le diagnostic impossible:
    // c'est precisement ce qui a coute trois deploiements ce jour-la.
    const corps = corpsDeLaSonde();
    expect(corps).toContain("n'a pas repondu lui-meme");
  });

  it("elle passe au fournisseur suivant au lieu de conclure", () => {
    const corps = corpsDeLaSonde();
    const i = corps.indexOf("aRepondu !== name");
    const bloc = corps.slice(i, i + 500);
    expect(bloc).toContain("continue;");
  });
});

describe("la separation sonde / trafic tient toujours", () => {
  it("un succes de sonde n'est jamais compte comme un appel reussi", () => {
    const corps = corpsDeLaSonde();
    expect(corps).toContain('noteSuccess(name, "sonde")');
  });

  it("le corps de la sonde n'appelle pas `noteSuccess` sans origine", () => {
    // La regression exacte a craindre: quelqu'un retire le second argument
    // « pour simplifier », et la sonde recommence a laver les pannes.
    const corps = corpsDeLaSonde();
    expect(/noteSuccess\(\s*name\s*\)/.test(corps)).toBe(false);
  });

  it("l'echec de sonde reste compte comme un echec reel", () => {
    // L'invite est fixe et connue pour valide: si elle echoue, la cause est
    // du cote du fournisseur, quelle qu'elle soit.
    const corps = corpsDeLaSonde();
    expect(corps).toContain("noteFailure(name, msg)");
  });
});

describe("ce que la sonde demande reste minime", () => {
  it("elle ne demande que quelques jetons", () => {
    // Cette sonde tourne pour chaque fournisseur, toutes les quinze minutes,
    // aux frais de la plateforme. La rendre bavarde la rendrait couteuse.
    const corps = corpsDeLaSonde();
    const m = corps.match(/maxOutputTokens:\s*(\d+)/);
    expect(m, "la sonde ne borne plus sa reponse").not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(16);
  });

  it("elle n'est facturee a aucun client", () => {
    // `orgId: null`: ni quota decompte, ni usage attribue a une organisation.
    // Facturer une sonde de plateforme a un client serait une erreur qu'il
    // verrait sur sa facture avant nous.
    const corps = corpsDeLaSonde();
    expect(corps).toContain("orgId: null");
  });

  it("elle reste desactivable sans redeploiement", () => {
    // Un fournisseur peut facturer ces appels; il faut pouvoir les couper.
    expect(SOURCE).toContain("AI_PROVIDER_PROBE");
  });
});
