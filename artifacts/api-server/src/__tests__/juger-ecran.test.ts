/**
 * Le verdict d'un ecran ouvert dans un navigateur.
 *
 * C'est la piece qui decide si la porte s'ouvre. Elle vivait en ligne dans
 * `verif-ecrans.mjs`, donc rien ne la verifiait — alors qu'un verdict trop
 * indulgent rend un audit vert sur une application morte, et que personne ne
 * relit un controle qui dit toujours oui.
 *
 * LE TROU QU'ON FERME : un ecran qui tombe n'affiche pas une page blanche.
 * La frontiere d'erreur rend son propre message, bien plus long que le seuil
 * de « page quasi vide ». Le detecter revenait donc a ESPERER une erreur de
 * console — alors qu'une frontiere d'erreur ATTRAPE l'exception, si bien que
 * `pageerror` ne se declenche jamais. Le controle reposait sur un effet de
 * bord de la journalisation de React, pas sur le fait observable.
 *
 * OU VIT CE FICHIER, ET POURQUOI : le dossier `scripts/` n a pas de coureur de
 * tests. Un fichier pose la-bas ne tournerait jamais — precisement le defaut
 * que ce lot corrige. Il vit donc avec les tests de l API, qui tournent.
 *
 * (Angle mort signale par la session BatiFlow le 24/09/2026 : chez elle, un
 * ecran tombe cachait trois contrastes illisibles — dont un titre a 1,04:1 —
 * qu'aucun audit ne voyait tant que la page tombait avant de se rendre.)
 */
import { describe, expect, it } from "vitest";
import { jugerEcran, montreLaFrontiereDErreur, TEXTES_FRONTIERE_ERREUR } from "../../../../scripts/juger-ecran.mjs";

const ECRAN_NORMAL =
  "Devis — Vos propositions commerciales : redaction, envoi, suivi des reponses. " +
  "Nouveau devis. Rechercher. Statut. Reference. Client. Montant. Total.";

const ECRAN_TOMBE =
  "Une erreur inattendue s'est produite. L'application a rencontre un probleme. " +
  "Vous pouvez reessayer ou recharger la page. Reessayer. Recharger la page.";

describe("l'ecran tombe est reconnu pour ce qu'il est", () => {
  it("le message de la frontiere est detecte", () => {
    expect(montreLaFrontiereDErreur(ECRAN_TOMBE)).toBe(true);
  });

  it("un ecran normal ne l'est pas", () => {
    expect(montreLaFrontiereDErreur(ECRAN_NORMAL)).toBe(false);
  });

  it("il est declare en probleme, sans aucune erreur de console", () => {
    // LE CAS QUI MANQUAIT : la frontiere attrape l'exception, donc rien
    // n'arrive dans la console ni dans `pageerror`. Avant, cet ecran passait
    // pour bon.
    const v = jugerEcran({ texte: ECRAN_TOMBE, erreurs: [], reseau: [], limite: [], clesNues: [] });
    expect(v.etat).toBe("probleme");
    expect(v.frontiere).toBe(true);
  });

  it("et le rapport dit pourquoi, en toutes lettres", () => {
    const v = jugerEcran({ texte: ECRAN_TOMBE });
    expect(v.raisons.join(" ")).toMatch(/tombe au rendu/);
  });

  it("il n'est PAS compte comme une page vide — ce serait un autre defaut", () => {
    // Le message de la frontiere fait plus de 60 caracteres : c'est
    // exactement pourquoi le seuil de vacuite ne l'attrapait pas.
    const v = jugerEcran({ texte: ECRAN_TOMBE });
    expect(v.vide).toBe(false);
  });

  it("les trois langues servies sont reconnues", () => {
    // La langue depend du navigateur qui ouvre la page : n'en couvrir qu'une
    // rendrait le controle vert selon la machine qui l'execute.
    for (const m of TEXTES_FRONTIERE_ERREUR) {
      expect(jugerEcran({ texte: `${m} — quelque chose a casse.` }).frontiere).toBe(true);
    }
  });

  it("la liste des messages n'est pas vide", () => {
    // Un garde-fou du controle lui-meme : une liste vide ne detecterait rien
    // et laisserait tous les tests ci-dessus passer... sauf celui-ci.
    expect(TEXTES_FRONTIERE_ERREUR.length).toBeGreaterThan(2);
  });
});

describe("ce qui etait deja juge le reste", () => {
  it("une page quasi vide est un probleme", () => {
    expect(jugerEcran({ texte: "Chargement" }).etat).toBe("probleme");
  });

  it("une erreur de console aussi", () => {
    expect(jugerEcran({ texte: ECRAN_NORMAL, erreurs: ["TypeError: x is not a function"] }).etat).toBe("probleme");
  });

  it("un appel reseau en echec aussi", () => {
    expect(jugerEcran({ texte: ECRAN_NORMAL, reseau: ["500 /api/devis"] }).etat).toBe("probleme");
  });

  it("une cle de traduction nue aussi", () => {
    expect(jugerEcran({ texte: ECRAN_NORMAL, clesNues: ["adminDevis.title"] }).etat).toBe("probleme");
  });

  it("un ecran sain est bon", () => {
    const v = jugerEcran({ texte: ECRAN_NORMAL, erreurs: [], reseau: [], limite: [], clesNues: [] });
    expect(v.etat).toBe("bon");
    expect(v.raisons).toEqual([]);
  });

  it("un constat vide de tout est juge sur son texte, pas suppose bon", () => {
    expect(jugerEcran({}).etat).toBe("probleme");
  });
});

describe("non juge : ni bon, ni mauvais", () => {
  it("une page vide avec des 429 n'est pas declaree cassee", () => {
    // Le defaut du 17/09/2026 : soixante ecrans annonces « en probleme »
    // alors que l'outil mesurait sa propre cadence.
    const v = jugerEcran({ texte: "", limite: ["429 /api/devis"] });
    expect(v.etat).toBe("non_juge");
  });

  it("des appels en echec avec des 429 non plus", () => {
    expect(jugerEcran({ texte: ECRAN_NORMAL, reseau: ["500 /api/x"], limite: ["429 /api/y"] }).etat).toBe("non_juge");
  });

  it("le rapport nomme la limite rencontree", () => {
    expect(jugerEcran({ texte: "", limite: ["429 /api/devis"] }).raisons.join(" ")).toMatch(/429/);
  });

  it("MAIS la frontiere d'erreur passe devant la limite", () => {
    // Un 429 n'affiche jamais ce message : la frontiere est une preuve
    // directe que l'ecran est tombe. La ranger dans « non juge » laisserait
    // le pire des etats passer pour le plus anodin.
    const v = jugerEcran({ texte: ECRAN_TOMBE, limite: ["429 /api/devis"] });
    expect(v.etat).toBe("probleme");
    expect(v.frontiere).toBe(true);
  });
});
