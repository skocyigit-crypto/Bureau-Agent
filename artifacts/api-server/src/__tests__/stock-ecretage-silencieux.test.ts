/**
 * Le manque ne doit pas disparaitre dans un `Math.max`.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * La sortie de stock par saisie vocale de chantier est par ailleurs SOLIDE :
 * transaction, `SELECT ... FOR UPDATE` pour verrouiller la ligne, journal des
 * mouvements ecrit dans la meme transaction avec `quantityBefore` et
 * `quantityAfter`, journal d'audit, jeton consomme une seule fois. Rien a
 * reprocher sur la concurrence — la premiere hypothese, celle d'un
 * lire-modifier-ecrire non protege, etait fausse.
 *
 * Le defaut est ailleurs, et il est silencieux :
 *
 *     const after = Math.max(0, before - qty);
 *     ...
 *     results.push({ index: i, kind: a.kind, ok: true, message: a.summary });
 *
 * L'ecretage a zero est JUSTE : un stock negatif n'a pas de sens physique. Mais
 * il ne disait rien. L'ouvrier declare dix sacs de ciment, il en reste trois :
 * le systeme en sort trois, et repond « ok » avec le resume d'origine — qui
 * parle de dix.
 *
 * POURQUOI CELA COMPTE SUR UN CHANTIER
 *
 * L'ecart n'est pas une erreur de saisie : la matiere a bien ete consommee.
 * Elle sort d'un stock qui ne la connaissait pas — reception non enregistree,
 * inventaire faux, ou prelevement non declare ailleurs. La valorisation derive,
 * et personne ne voit ou, parce que l'operation a ete annoncee comme conforme.
 *
 * LA REGLE RETENUE, LA MEME QUE PARTOUT DANS CET AUDIT
 *
 * On enregistre la realite — on ne descend pas sous zero — et on NOMME l'ecart.
 * Ni refus (la consommation a eu lieu), ni silence (elle ne colle pas au stock).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { calculerSortieStock } from "../services/sortie-stock";

const SOURCE = readFileSync(
  join(import.meta.dirname, "..", "routes", "voice-site-ops.ts"),
  "utf8",
);

/**
 * On appelle le VRAI calcul.
 *
 * La premiere version de ce fichier reproduisait la formule ici. Une
 * mutation de la route ne faisait alors tomber aucun test : l'epreuve
 * portait sur la copie, pas sur le code execute. Un test qui reecrit ce
 * qu'il verifie ne verifie rien.
 */
function sortir(before: number, demande: number) {
  const r = calculerSortieStock(before, demande);
  return { after: r.apres, sortie: r.sortie, manque: r.manque };
}

describe("le calcul de sortie", () => {
  it("un stock suffisant sort la quantite demandee, sans manque", () => {
    const r = sortir(20, 10);
    expect(r.after).toBe(10);
    expect(r.sortie).toBe(10);
    expect(r.manque).toBe(0);
  });

  it("un stock insuffisant sort ce qu'il reste et chiffre le manque", () => {
    // LE CAS DU DEFAUT: dix demandes, trois disponibles.
    const r = sortir(3, 10);
    expect(r.after).toBe(0);
    expect(r.sortie).toBe(3);
    expect(r.manque).toBe(7);
  });

  it("un stock exactement suffisant ne produit aucun manque", () => {
    // La borne compte: signaler un manque a zero ferait du bruit sur le cas
    // le plus ordinaire, et l'avertissement cesserait d'etre lu.
    const r = sortir(10, 10);
    expect(r.after).toBe(0);
    expect(r.manque).toBe(0);
  });

  it("un stock vide fait un manque egal a la demande", () => {
    const r = sortir(0, 5);
    expect(r.sortie).toBe(0);
    expect(r.manque).toBe(5);
  });

  it("la quantite ne descend jamais sous zero", () => {
    // L'ecretage reste juste: un stock negatif n'a pas de sens physique, et
    // le corriger par une valeur negative ne ferait que deplacer le probleme.
    for (const [avant, demande] of [[0, 1], [3, 10], [1, 1000]]) {
      expect(sortir(avant!, demande!).after).toBeGreaterThanOrEqual(0);
    }
  });

  it("sortie + reste reconstituent toujours le stock d'origine", () => {
    // Propriete du journal: `quantityBefore` et `quantityAfter` doivent
    // encadrer exactement le `delta` ecrit, sinon le journal ment.
    for (const [avant, demande] of [[20, 10], [3, 10], [10, 10], [0, 5]]) {
      const r = sortir(avant!, demande!);
      expect(r.sortie + r.after, `${avant}/${demande}`).toBe(avant);
    }
  });
});

describe("le manque remonte a l'appelant", () => {
  it("le message d'origine n'est plus renvoye tel quel apres un ecretage", () => {
    // Le resume vient de l'IA et decrit ce que l'ouvrier a DIT. Le renvoyer
    // apres un ecretage fait croire l'operation conforme a la declaration.
    expect(SOURCE).toContain("manqueStock > 0");
    expect(SOURCE).toContain("il en manquait ${manqueStock} en stock");
  });

  it("le nombre reellement sorti est annonce", () => {
    // « Il en manquait 7 » sans dire combien sont sortis oblige a calculer.
    expect(SOURCE).toContain("seulement ${sortieStock} sortie(s)");
  });

  it("sans manque, le resume d'origine est conserve", () => {
    // L'erreur symetrique: alourdir chaque message d'un « manque : 0 »
    // rendrait le cas normal illisible.
    const i = SOURCE.indexOf("manqueStock > 0");
    const bloc = SOURCE.slice(i, i + 600);
    expect(bloc).toContain("message: a.summary }");
  });

  it("le champ `manque` est facultatif, pas simule a zero partout", () => {
    // Le poser a zero sur chaque action ferait croire qu'un manque a ete
    // calcule pour toutes, y compris celles qui ne touchent pas au stock.
    expect(SOURCE).toContain("manque?: number");
  });
});

describe("ce qui etait deja correct et doit le rester", () => {
  it("la ligne d'article est verrouillee avant lecture", () => {
    // `SELECT ... FOR UPDATE`: sans lui, deux saisies simultanees liraient le
    // meme `before` et l'une des deux sorties disparaitrait.
    const i = SOURCE.indexOf('a.kind === "stock_deduction"');
    const bloc = SOURCE.slice(i, i + 2600);
    expect(bloc).toContain('.for("update")');
  });

  it("la mise a jour et le mouvement sont dans la MEME transaction", () => {
    // Sinon un incident entre les deux laisserait un stock modifie sans trace,
    // ou une trace sans stock modifie.
    const i = SOURCE.indexOf('a.kind === "stock_deduction"');
    const bloc = SOURCE.slice(i, i + 3000);
    expect(bloc).toContain("db.transaction(");
    // Les appels sont chaines sur plusieurs lignes (`await tx` puis
    // `.update(...)`): on cherche la table, pas une forme d'ecriture.
    expect(bloc).toContain("stockMouvementsTable");
    expect(bloc).toContain(".update(stockArticlesTable)");
  });

  it("le mouvement porte l'avant et l'apres, pas seulement le delta", () => {
    // C'est ce qui permet de rejouer le journal et de detecter un trou.
    const i = SOURCE.indexOf("tx.insert(stockMouvementsTable)");
    const bloc = SOURCE.slice(i, i + 500);
    expect(bloc).toContain("quantityBefore: before");
    expect(bloc).toContain("quantityAfter: after");
  });

  it("l'operation est bornee a l'organisation", () => {
    const i = SOURCE.indexOf('a.kind === "stock_deduction"');
    const bloc = SOURCE.slice(i, i + 1400);
    expect(bloc).toContain("eq(stockArticlesTable.organisationId, orgId)");
  });

  it("la note ne peut pas etre appliquee deux fois", () => {
    // Sans cela, un renvoi du formulaire sortirait le stock une seconde fois.
    expect(SOURCE).toContain("consumeTokenOnce");
  });
});
