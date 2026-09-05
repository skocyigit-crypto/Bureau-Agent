/**
 * Verifier un SIREN ou un SIRET avant d'emettre.
 *
 * Avec la reforme, le SIREN du client n'est plus une donnee administrative:
 * c'est l'adresse de routage de la facture dans l'annuaire central. Un numero
 * mal recopie, et la facture n'est pas delivree — le destinataire ne la recoit
 * jamais, et l'emetteur l'apprend par le retard de paiement. C'est l'une des
 * premieres causes de rejet.
 *
 * Deux cas comptent plus que les autres dans ce fichier:
 *
 *   - un chiffre transpose doit etre REFUSE. C'est la faute de frappe reelle,
 *     celle qu'une simple verification de longueur laisse passer;
 *   - un SIRET de La Poste doit etre ACCEPTE. Ses numeros ne satisfont pas
 *     Luhn — un validateur zele refuserait d'emettre une facture a un client
 *     parfaitement reel, ce qui est un defaut plus couteux que celui qu'il
 *     cherche a eviter.
 */
import { describe, expect, it } from "vitest";

import {
  LIBELLE_CATEGORIE,
  MENTION_TVA_DEBITS,
  normaliserIdentifiant,
  sirenDe,
  verifierIdentifiant,
} from "../services/siren";

/** SIREN et SIRET valides au sens de la cle de controle. */
const SIREN_VALIDE = "552100554";        // Danone
const SIRET_VALIDE = "55210055400013";

describe("verification d'un identifiant", () => {
  it("accepte un SIREN et un SIRET valides", () => {
    const a = verifierIdentifiant(SIREN_VALIDE);
    expect(a.valide).toBe(true);
    expect(a.type).toBe("siren");

    const b = verifierIdentifiant(SIRET_VALIDE);
    expect(b.valide).toBe(true);
    expect(b.type).toBe("siret");
  });

  it("refuse un chiffre transpose", () => {
    // La faute de frappe reelle: deux chiffres echanges. La longueur est bonne,
    // seule la cle ne tombe plus juste.
    const transpose = "552100545";
    expect(verifierIdentifiant(transpose).valide).toBe(false);
    expect(verifierIdentifiant(transpose).motif).toContain("cle de controle");
  });

  it("accepte les SIRET de La Poste, qui ne suivent pas Luhn", () => {
    // Exception historique: la somme des chiffres doit etre multiple de 5.
    // Un validateur qui l'ignore refuse un client reel.
    const laPoste = "35600000000010";
    const somme = [...laPoste].reduce((s, c) => s + Number(c), 0);
    expect(somme % 5, "l'exemple choisi doit bien satisfaire la regle La Poste").toBe(0);
    expect(verifierIdentifiant(laPoste).valide).toBe(true);
  });

  it("dit CE QUI ne va pas, pas seulement que c'est invalide", () => {
    // « Numero invalide » n'aide personne a corriger.
    expect(verifierIdentifiant("").motif).toBe("identifiant absent");
    expect(verifierIdentifiant("12345").motif).toContain("longueur 5");
    expect(verifierIdentifiant("ABC456789").motif).toContain("que des chiffres");
  });

  it("tolere la mise en forme humaine", () => {
    // On saisit « 552 100 554 » aussi souvent que « 552100554 ».
    for (const saisie of ["552 100 554", "552.100.554", " 552100554 ", "552-100-554"]) {
      expect(verifierIdentifiant(saisie).valide, `saisie « ${saisie} »`).toBe(true);
    }
    expect(normaliserIdentifiant("552 100 554")).toBe("552100554");
  });

  it("extrait le SIREN d'un SIRET", () => {
    // L'annuaire route sur le SIREN; le client fournit souvent un SIRET.
    expect(sirenDe(SIRET_VALIDE)).toBe(SIREN_VALIDE);
    expect(sirenDe(SIREN_VALIDE)).toBe(SIREN_VALIDE);
    expect(sirenDe("552100545"), "un identifiant invalide ne rend aucun SIREN").toBeNull();
  });
});

describe("libelles reglementaires", () => {
  it("porte les trois categories d'operation", () => {
    // La categorie n'est pas decorative: elle determine l'exigibilite de la TVA.
    expect(LIBELLE_CATEGORIE.biens).toBe("Livraison de biens");
    expect(LIBELLE_CATEGORIE.services).toBe("Prestation de services");
    expect(LIBELLE_CATEGORIE.mixte).toContain("et prestation de services");
  });

  it("recopie la mention des debits a l'identique", () => {
    // Le texte reglementaire fixe un libelle UNIQUE. Le reformuler, meme
    // mieux, c'est ne plus porter la mention exigee.
    expect(MENTION_TVA_DEBITS).toBe("Option pour le paiement de la taxe d'apres les debits");
  });
});
