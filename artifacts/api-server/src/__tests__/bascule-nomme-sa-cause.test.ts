/**
 * La ligne qui temoigne d'une bascule de fournisseur doit dire CE QUI EST
 * TOMBE.
 *
 * Elle ne le disait pas, et je m'en suis apercu en cherchant pourquoi le
 * fournisseur principal echoue — sans pouvoir le trouver.
 *
 * Mesure en production, sept jours: 1249 bascules. Le champ prevu pour la
 * cause, `apres`, etait vide dans la quasi-totalite des cas. La raison est
 * mecanique: la chaine de secours est appelee APRES l'echec du principal et
 * elle le SAUTE (« c'est lui qui vient d'echouer »); `apres` ne recense donc
 * que les echecs des remplacants essayes ensuite. Quand le premier remplacant
 * repond — le cas courant — il n'y a rien a afficher.
 *
 * La cause etait pourtant connue: l'appelant la transmet a
 * `noteProviderFailure`, et l'etat du fournisseur la conserve dans `reason`.
 * Elle ne faisait simplement pas le dernier pas jusqu'au journal.
 *
 * Ce que cela coute: une bascule toutes les dix minutes pendant une semaine,
 * et aucun moyen de savoir pourquoi. Le produit repond — c'est le repli qui
 * masque la panne — donc rien n'oblige a regarder. Mais un recours qu'on
 * consomme en permanence n'est plus un recours: le jour ou le remplacant tombe
 * a son tour, il ne reste rien.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  join(import.meta.dirname, "..", "services", "ai-failover.ts"),
  "utf8",
);

/** Le bloc qui journalise la bascule dans la chaine de compatibilite Gemini. */
function blocDeJournalisation(): string {
  const i = SOURCE.indexOf("reponse servie par un autre fournisseur");
  expect(i, "la ligne de journalisation de bascule est introuvable").toBeGreaterThan(-1);
  return SOURCE.slice(Math.max(0, i - 900), i + 200);
}

describe("le journal de bascule", () => {
  it("nomme le fournisseur tombe", () => {
    expect(
      /tombe:/.test(blocDeJournalisation()),
      "la bascule ne dit plus quel fournisseur a echoue: on ne peut pas diagnostiquer " +
        "une panne dont on ignore l'origine",
    ).toBe(true);
  });

  it("joint la cause conservee dans l'etat du fournisseur", () => {
    const bloc = blocDeJournalisation();
    expect(bloc).toMatch(/cause:/);
    expect(
      /providerHealth\(\)/.test(bloc),
      "la cause n'est plus lue depuis l'etat du fournisseur: elle redeviendra vide",
    ).toBe(true);
  });

  it("garde `apres`, qui reste utile quand plusieurs remplacants echouent", () => {
    // Ce champ n'etait pas faux, il etait incomplet. Le retirer ferait perdre
    // le cas ou la chaine traverse deux fournisseurs avant d'aboutir.
    expect(blocDeJournalisation()).toMatch(/apres: failures\.join/);
  });
});

describe("l'etat du fournisseur", () => {
  it("expose bien une raison a joindre au journal", () => {
    // Si `reason` disparaissait de l'interface, le journal redeviendrait muet
    // sans qu'aucun test ne tombe ailleurs.
    const iface = SOURCE.slice(
      SOURCE.indexOf("export interface ProviderHealth"),
      SOURCE.indexOf("export interface ProviderHealth") + 600,
    );
    expect(iface).toMatch(/reason: string \| null;/);
  });

  it("l'appelant transmet toujours une raison quand le principal tombe", () => {
    const utils = readFileSync(
      join(import.meta.dirname, "..", "services", "ai-utils.ts"),
      "utf8",
    );
    // Sans cet appel, l'etat resterait « en bonne sante » pendant une panne —
    // le depot a deja connu ce defaut, et le commentaire sur place le raconte.
    expect(utils).toMatch(/noteProviderFailure\("gemini",/);
  });
});
