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
 * Ce controle a d'abord ete un CLIQUET : corriger 87 endroits d'un coup aurait
 * ete une modification massive et peu sure, alors qu'empecher le nombre de
 * monter etait immediat. Le stock etant resorbe, il est devenu une LISTE
 * d'exceptions nommees — plus stricte, puisqu'un silence ajoute ailleurs
 * echoue meme si le total ne bouge pas.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Histoire du compteur, pour qui reprend ce fichier.
 *
 * 19/09 : 87 au premier comptage. Corriges dans l'ordre « Creer un projet »
 * (quatre ecrans), les quatorze ecritures muettes de call-detail,
 * ia-apprentissage, call-assistant et commandant-ia, puis, ecran par ecran,
 * toutes celles qui AFFIRMAIENT quelque chose de faux. Reste 10, tous
 * examines et nommes dans `EXCEPTIONS` ci-dessous.
 *
 * Le plafond chiffre a ete retire en meme temps : une liste exacte est plus
 * stricte, et elle dit pourquoi.
 */

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
 * Les silences qui SUBSISTENT, chacun examine et justifie.
 *
 * Le cliquet a fait son travail : de 87 a 10. Ce qui reste n'est plus un stock
 * a resorber, c'est une liste d'exceptions — et une exception qui n'est pas
 * nommee redevient un oubli a la relecture suivante.
 *
 * Le controle ne porte donc plus sur un NOMBRE mais sur cette liste exacte.
 * Ajouter un silence ailleurs echoue, meme si le total ne bouge pas ; corriger
 * l'un de ceux-ci echoue aussi, et demande de le retirer d'ici. C'est plus
 * strict qu'un plafond, et ca dit pourquoi.
 *
 * Le critere commun : aucun de ces dix n'AFFIRME quelque chose de faux. Ils
 * laissent une carte absente, ou proposent un bouton « Charger ». Les silences
 * corriges, eux, affirmaient — « aucune facture », « aucune alerte de
 * securite », « aucun collaborateur ».
 */
const EXCEPTIONS = [
  // Recherche d'entreprise a la frappe: la saisie manuelle reste possible, et
  // la raison est ecrite sur place. Avertir a chaque frappe serait du bruit.
  "organisations.tsx:246",
  // Brouillons de facture: « la section reste vide, sans message trompeur »,
  // dit le commentaire d'origine — c'est exactement le bon arbitrage.
  "organisations.tsx:762",
  // Consommation d'IA: la carte ne s'affiche pas. Une carte absente ne dit
  // rien de faux.
  "tab-intelligence-artificielle.tsx:145",
  // Plateformes connectees et journal de synchronisation: meme cas, le resume
  // ne s'affiche pas. L'etat Google, lui, AFFIRMAIT et a ete corrige.
  "tab-plateformes.tsx:301",
  "tab-plateformes.tsx:316",
  // Sante d'un contact, statistiques d'equipe, apercu des paiements, briefing
  // du jour: ces quatre ecrans montrent un bouton « Charger » et invitent a
  // reessayer. C'est deja la bonne reponse a un echec.
  "call-assistant.tsx:585",
  "commandant-ia.tsx:692",
  "commandant-ia.tsx:814",
  "commandant-ia.tsx:884",
  // Statut de la base de connaissances: non bloquant, documente comme tel.
  "knowledge-base.tsx:67",
] as const;

describe("les echecs silencieux ne se multiplient plus", () => {
  /** Chaque silence, sous la forme `fichier.tsx:ligne`. */
  function releve(): string[] {
    const out: string[] = [];
    for (const racine of RACINES) {
      for (const f of fichiers(racine)) {
        const lignes = readFileSync(f, "utf8").split(/\r?\n/);
        lignes.forEach((l, i) => {
          if (!/if\s*\(\s*(?:!!)?res(?:ponse)?\d?\.ok\s*\)/.test(l)) return;
          if (/\belse\b/.test(lignes.slice(i, i + 40).join("\n"))) return;
          out.push(`${f.split(/[\\/]/).slice(-1)[0]}:${i + 1}`);
        });
      }
    }
    return out.sort();
  }

  it("le comptage trouve bien quelque chose a compter", () => {
    // Garde-fou du controle: une detection tombee a zero par accident ferait
    // passer les assertions suivantes sans rien garantir.
    expect(releve().length, "plus rien de detecte: la detection est cassee").toBeGreaterThan(5);
  });

  it("aucun silence en dehors des exceptions examinees", () => {
    const nouveaux = releve().filter((e) => !(EXCEPTIONS as readonly string[]).includes(e));
    expect(
      nouveaux,
      `un echec silencieux a ete ajoute ailleurs: ${nouveaux.join(", ")}`,
    ).toEqual([]);
  });

  it("et aucune exception qui n'existe plus", () => {
    // Corriger l'un d'eux est une bonne nouvelle — mais il faut alors le
    // retirer d'ici, sinon la liste se met a decrire un passe.
    const actuels = releve();
    const disparues = EXCEPTIONS.filter((e) => !actuels.includes(e));
    expect(
      disparues,
      `ces exceptions n'ont plus lieu d'etre, les retirer de EXCEPTIONS: ${disparues.join(", ")}`,
    ).toEqual([]);
  });
});

describe("plus aucune ECRITURE ne passe sous silence", () => {
  /**
   * Distinction qui a guide tout le travail : une lecture muette laisse une
   * liste vide, qui se voit ; une ecriture muette laisse croire que c'est
   * enregistre, ce qui ne se voit pas.
   *
   * Les lectures restantes sont tenues par la liste d'exceptions ci-dessus.
   * Les ecritures, elles, sont a zero — et ce controle interdit d'en rajouter
   * une seule.
   */
  it("aucune", () => {
    const restantes: string[] = [];
    for (const racine of RACINES) {
      for (const f of fichiers(racine)) {
        const lignes = readFileSync(f, "utf8").split(/\r?\n/);
        lignes.forEach((l, i) => {
          if (!/if\s*\(\s*(?:!!)?res(?:ponse)?\d?\.ok\s*\)/.test(l)) return;
          if (/\belse\b/.test(lignes.slice(i, i + 40).join("\n"))) return;
          const avant = lignes.slice(Math.max(0, i - 15), i).join("\n");
          // La detection inclut le verbe passe par une VARIABLE — le cas d'un
          // formulaire qui cree ou modifie selon le contexte — sous ses trois
          // ecritures : `method: verbe`, `method,` seul sur sa ligne, et
          // `{ method, headers... }` en ligne.
          //
          // Chacune de ces formes m'a echappe une fois, et chaque fois j'avais
          // compte l'ecriture correspondante comme une lecture : d'abord
          // `prospects.tsx`, puis l'enregistrement d'un evenement d'agenda.
          // Une detection incomplete ne produit pas une alerte manquante mais
          // une FAUSSE tranquillite, ce qui est pire.
          if (!/method:\s*"(POST|PUT|PATCH|DELETE)"|method:\s*\w+|[{,]\s*method\s*,|^\s*method,\s*$/m.test(avant)) return;
          restantes.push(`${f.split(/[\\/]/).slice(-1)[0]}:${i + 1}`);
        });
      }
    }
    expect(
      restantes,
      `une ecriture laisse a nouveau croire qu'elle a reussi: ${restantes.join(", ")}`,
    ).toEqual([]);
  });
});
