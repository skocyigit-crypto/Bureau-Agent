/**
 * Le defaut le plus repandu du produit : `if (res.ok)` sans `else`.
 *
 * L'ecran demande quelque chose au serveur, regarde si ca a marche, et ne
 * prevoit RIEN quand ca n'a pas marche. Pour une lecture, la liste reste vide
 * et se lit comme « vous n'avez rien ». Pour une ecriture, la boite de dialogue
 * se ferme, la ligne n'apparait pas, et l'utilisateur recommence — ou pire, ne
 * recommence pas, croyant que c'est enregistre.
 *
 * Trois cas reels rencontres pendant l'audit du 19/09 le montrent :
 *  - l'abonnement ne pouvait pas etre resilie, et rien ne le disait ;
 *  - les notes internes du mobile n'etaient jamais enregistrees (404) ;
 *  - les factures d'une autre organisation restaient affichees sous le nom de
 *    celle qu'on venait d'ouvrir.
 *
 * Ce controle est un CLIQUET, pas une interdiction. Corriger 97 endroits d'un
 * coup serait une modification massive et peu sure ; empecher le nombre de
 * monter, lui, est immediat. Chaque correction fait baisser le plafond
 * ci-dessous, et il ne remonte jamais.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Plafond courant. A BAISSER a chaque correction — jamais a monter.
 *
 * 19/09 : 87 au premier comptage, puis 68. Corriges d'abord « Creer un projet »
 * sur trois ecrans, puis les quatorze ECRITURES muettes de call-detail,
 * ia-apprentissage, call-assistant et commandant-ia — la ou un echec ne
 * produisait rien du tout : le chargement s'arretait, rien n'apparaissait, et
 * l'utilisateur ne pouvait qu'appuyer a nouveau.
 */
const PLAFOND = 67;

const RACINES = [
  join(import.meta.dirname, "..", "pages"),
  join(import.meta.dirname, "..", "..", "..", "mobile", "app"),
];

function fichiers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return fichiers(p);
    return p.endsWith(".tsx") && !p.includes(".test.") ? [p] : [];
  });
}

/**
 * Les `if (res.ok)` sans `else` a portee de vue.
 *
 * La fenetre de 40 lignes est volontairement large : un `else` plus loin que
 * cela n'est plus le traitement de CET echec. Trop etroite, la mesure
 * compterait des endroits corrects — et un controle qui crie au loup finit
 * desactive.
 */
function silences(): Array<{ fichier: string; nombre: number }> {
  const out: Array<{ fichier: string; nombre: number }> = [];
  for (const racine of RACINES) {
    for (const f of fichiers(racine)) {
      const lignes = readFileSync(f, "utf8").split(/\r?\n/);
      let n = 0;
      lignes.forEach((l, i) => {
        if (!/if\s*\(\s*(?:!!)?res(?:ponse)?\d?\.ok\s*\)/.test(l)) return;
        // On cherche un `else`, pas « `}` immediatement suivi de `else` » : un
        // commentaire entre les deux est frequent, et une detection aussi
        // litterale compterait du code correct. Un controle qui crie au loup
        // finit desactive, et c'est le vrai defaut qui passe ensuite.
        if (!/\belse\b/.test(lignes.slice(i, i + 40).join("\n"))) n++;
      });
      if (n > 0) out.push({ fichier: f, nombre: n });
    }
  }
  return out;
}

describe("les echecs silencieux ne se multiplient plus", () => {
  const releve = silences();
  const total = releve.reduce((s, r) => s + r.nombre, 0);

  it("le comptage trouve bien quelque chose a compter", () => {
    // Garde-fou du controle: une detection tombee a zero par accident ferait
    // passer l'assertion suivante sans rien garantir.
    expect(releve.length, "plus aucun fichier detecte: la detection est cassee").toBeGreaterThan(5);
  });

  it("leur nombre ne depasse pas le plafond", () => {
    const pires = [...releve].sort((a, b) => b.nombre - a.nombre).slice(0, 5)
      .map((r) => `${r.nombre} × ${r.fichier}`).join(", ");
    expect(
      total,
      `un nouvel echec silencieux a ete ajoute. Les plus charges: ${pires}`,
    ).toBeLessThanOrEqual(PLAFOND);
  });

  it("le plafond suit la realite: il doit etre baisse quand on corrige", () => {
    // Un plafond qui reste loin au-dessus du reel ne protege plus de rien.
    expect(
      PLAFOND - total,
      `${total} echecs silencieux pour un plafond de ${PLAFOND}: abaisser PLAFOND a ${total}`,
    ).toBeLessThanOrEqual(3);
  });
});
