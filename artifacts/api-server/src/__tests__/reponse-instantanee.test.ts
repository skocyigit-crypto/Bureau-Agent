/**
 * Les cartes de reponse instantanee: un chiffre affiche sans avertissement.
 *
 * Ce module repond directement dans l'interface — calcul, conversion, IBAN,
 * jours feries — sans passer par l'IA et sans rien demander a personne.
 * L'utilisateur n'a aucune raison de douter du resultat: il n'y a ni « selon
 * l'assistant », ni source citee. C'est precisement ce qui rend une erreur ici
 * couteuse, et le module n'avait aucun test.
 *
 * TROIS RISQUES, CLASSES PAR CONSEQUENCE
 *
 *   1. Un IBAN faux declare valide. Dans le BTP, l'IBAN sert a payer un
 *      sous-traitant: une coquille validee par l'outil part en virement. La
 *      cle mod-97 (ISO 7064) rattrape une erreur de saisie dans 99 % des cas,
 *      MAIS seulement si la longueur du pays est connue — sinon la cle seule
 *      declarerait « valide » n'importe quelle suite de caracteres bien
 *      formee. Les deux controles comptent, et le second est le plus facile
 *      a perdre.
 *
 *   2. Un calcul faux. Ce chiffre finit dans un devis. La priorite des
 *      operateurs et les formats de nombres francais (« 1 500,75 ») sont les
 *      deux endroits ou un evaluateur se trompe sans planter.
 *
 *   3. Une carte affichee sur une requete qui n'en demandait pas. « FR 2026
 *      budget » ne doit pas devenir une carte IBAN: une reponse hors sujet
 *      apprend a l'utilisateur a ignorer ces cartes, y compris les justes.
 *
 * Les IBAN utilises ici sont les exemples publics de la documentation ISO
 * 13616, jamais des coordonnees reelles.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";

import { resolveInstantAnswer } from "../services/instant-answer";

/** Exemple public ISO 13616 pour la France. */
const IBAN_FR_VALIDE = "FR1420041010050500013M02606";
/** Meme IBAN avec un chiffre modifie: la cle mod-97 doit le rejeter. */
const IBAN_FR_FAUTE = "FR1420041010050500013M02607";

describe("la validation d'IBAN", () => {
  it("reconnait un IBAN francais valide", async () => {
    const r = await resolveInstantAnswer(IBAN_FR_VALIDE);
    expect(r?.kind).toBe("iban");
    expect(r?.result).toContain("valide");
    expect(r?.result).not.toContain("invalide");
  });

  it("rejette une coquille que seule la cle de controle revele", async () => {
    // Un seul chiffre change. La longueur est bonne, le format est bon: si la
    // cle mod-97 n'est pas verifiee, cet IBAN part en virement.
    const r = await resolveInstantAnswer(IBAN_FR_FAUTE);
    expect(r?.kind).toBe("iban");
    expect(r?.result).toContain("invalide");
  });

  it("rejette une longueur incorrecte pour le pays", async () => {
    // La cle mod-97 peut tomber juste par hasard sur une chaine trop courte:
    // la longueur officielle du pays est le second garde-fou.
    const r = await resolveInstantAnswer("FR1420041010050500013M0260");
    expect(r?.kind).toBe("iban");
    expect(r?.result).toContain("invalide");
    expect(String(r?.detail)).toMatch(/longueur/i);
  });

  it("ne declare jamais valide un pays inconnu de la table ISO", async () => {
    // Sans table de longueurs, la cle seule suffirait a valider n'importe
    // quelle suite bien formee. Mieux vaut ne rien dire que dire « valide ».
    const r = await resolveInstantAnswer("ZZ1420041010050500013M02606");
    expect(r, "un pays hors ISO 13616 a produit une carte").toBeNull();
  });

  it("tolere les espaces et les tirets de saisie", async () => {
    // Un IBAN se copie presque toujours groupe par quatre.
    const r = await resolveInstantAnswer("FR14 2004 1010 0505 0001 3M02 606");
    expect(r?.kind).toBe("iban");
    expect(r?.result).toContain("valide");
    expect(r?.result).not.toContain("invalide");
  });

  it("n'attrape pas une requete qui commence par deux lettres et deux chiffres", async () => {
    // « FR 2026 budget » ne doit pas devenir une carte IBAN. Une carte hors
    // sujet apprend a ignorer toutes les cartes, y compris les justes.
    expect(await resolveInstantAnswer("FR 2026 budget")).toBeNull();
  });
});

describe("la calculatrice", () => {
  it("respecte la priorite des operateurs", async () => {
    // 2 + 3 x 4 = 14, et non 20. Un evaluateur qui lit de gauche a droite ne
    // plante jamais: il se trompe.
    const r = await resolveInstantAnswer("2 + 3 * 4");
    expect(r?.kind).toBe("calculator");
    expect(r?.result).toContain("14");
  });

  it("respecte les parentheses", async () => {
    const r = await resolveInstantAnswer("(2 + 3) * 4");
    expect(r?.kind).toBe("calculator");
    expect(r?.result).toContain("20");
  });

  it("accepte un nombre ecrit a la francaise", async () => {
    // « 1 500,75 » est ce qu'un artisan francais tape. Le lire comme 1,50075
    // ou echouer silencieusement produirait un devis faux.
    const r = await resolveInstantAnswer("1 500,75 + 0,25");
    expect(r?.kind).toBe("calculator");
    expect(r?.result).toMatch(/1\s?501/);
  });

  it("ne rend pas un resultat pour une division par zero", async () => {
    // `Infinity` affiche dans une carte serait pire qu'aucune carte.
    // Mesure: le module rend `null`. Ce test l'ecrit, plutot que de se
    // contenter d'un "si une carte existe, alors..." qui ne verifie rien le
    // jour ou il n'y en a pas.
    expect(await resolveInstantAnswer("10 / 0")).toBeNull();
    expect(await resolveInstantAnswer("0 / 0")).toBeNull();
  });

  it("n'evalue pas de code", async () => {
    // L'evaluateur est un shunting-yard, pas un `eval`. Cette requete ne doit
    // produire aucune carte — et surtout rien executer.
    const r = await resolveInstantAnswer("process.exit(1)");
    expect(r).toBeNull();
  });

  it("ignore une phrase ordinaire qui contient un chiffre", async () => {
    // Sans cela, chaque message de l'utilisateur ferait apparaitre une carte.
    expect(await resolveInstantAnswer("rappelle-moi le devis 3 de lundi")).toBeNull();
  });
});

describe("les requetes qui ne demandent rien", () => {
  it("une phrase quelconque ne produit aucune carte", async () => {
    expect(await resolveInstantAnswer("bonjour, ou en est le chantier ?")).toBeNull();
  });

  it("une chaine vide ne produit aucune carte", async () => {
    expect(await resolveInstantAnswer("")).toBeNull();
  });

  it("une chaine d'espaces ne produit aucune carte", async () => {
    expect(await resolveInstantAnswer("   ")).toBeNull();
  });

  it("une requete demesuree ne fait pas tomber le module", async () => {
    // Le champ de recherche accepte ce qu'on y colle. Un document entier
    // colle par megarde ne doit ni bloquer ni jeter.
    // `toBeDefined()` aurait accepte `null` comme `undefined`: les deux
    // passent. On dit donc exactement ce qu'on attend.
    const enorme = "a".repeat(50_000);
    await expect(resolveInstantAnswer(enorme)).resolves.toBeNull();
  });
});

describe("les conversions d'unites", () => {
  it("convertit une longueur", async () => {
    const r = await resolveInstantAnswer("3 m en cm");
    expect(r?.kind).toBe("unit");
    expect(r?.result).toContain("300");
  });

  it("n'invente pas une conversion entre unites incompatibles", async () => {
    // « 3 kg en metres » n'a pas de reponse. En donner une serait pire que
    // n'en donner aucune.
    const r = await resolveInstantAnswer("3 kg en metres");
    expect(r?.kind).not.toBe("unit");
  });
});
