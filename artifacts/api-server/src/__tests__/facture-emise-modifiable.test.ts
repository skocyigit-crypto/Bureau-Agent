/**
 * Une facture emise etait verrouillee au point de ne plus pouvoir etre annulee.
 *
 * Le gel du CONTENU d'une facture emise est juste : une facture ne se reecrit
 * pas, elle s'annule ou se corrige par un avoir (art. 286-I-3° bis du CGI).
 * Mais le controle portait sur la PRESENCE du champ dans la requete, pas sur
 * sa modification :
 *
 *     FROZEN_FIELDS.filter((f) => body[f] !== undefined)
 *
 * Or les ecrans envoient le formulaire COMPLET. Changer le seul statut d'une
 * facture envoyee renvoyait donc 409 « son contenu ne peut plus etre
 * modifie » — en citant des champs auxquels l'utilisateur n'avait pas touche.
 *
 * Et la remediation que le serveur proposait lui-meme — « annulez la facture
 * (statut "annulee") » — etait impossible, puisqu'elle passe par ce meme
 * PATCH. Mesure du 19/09 : aucun autre chemin de l'interface n'ecrit ce
 * statut. Une facture emise par erreur restait donc emise, pour toujours.
 *
 * Une valeur identique n'est pas une reecriture. Le gel reste entier ; il ne
 * se declenche plus que sur un changement reel.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { FROZEN_FIELDS, frozenFieldsTouched } from "../services/invoice-numbering";

/** Une facture emise, telle que la base la rend. */
const emise = {
  reference: "FAC-2026-0001",
  clientName: "Dupont SARL",
  clientCompany: "Dupont",
  totalAmount: "120.00",
  subtotal: "100.00",
  taxAmount: "20.00",
  currency: "EUR",
  dueDate: new Date("2026-10-15T00:00:00.000Z"),
  items: [{ description: "Pose", quantity: 1, unitPrice: 100 }],
  isAutoliquidation: false,
  status: "envoyee",
};

describe("ce qui n'est pas une modification ne doit pas bloquer", () => {
  it("renvoyer le formulaire inchange ne touche a rien", () => {
    expect(
      frozenFieldsTouched({ ...emise, status: "annulee" }, emise),
      "l'ecran renvoie tout le formulaire: le gel bloquait alors chaque enregistrement",
    ).toEqual([]);
  });

  it("annuler une facture emise redevient possible", () => {
    // C'est la remediation que le serveur proposait, et qu'il rendait
    // impossible.
    const corps = { ...emise, status: "annulee" };
    expect(frozenFieldsTouched(corps, emise)).toHaveLength(0);
  });

  it("« 120 » et « 120.00 » designent le meme montant", () => {
    expect(frozenFieldsTouched({ totalAmount: 120 }, emise)).toEqual([]);
  });

  it("une date identique rendue par la base ne compte pas", () => {
    expect(frozenFieldsTouched({ dueDate: "2026-10-15T00:00:00.000Z" }, emise)).toEqual([]);
  });

  it("des lignes identiques non plus", () => {
    expect(frozenFieldsTouched({ items: [{ description: "Pose", quantity: 1, unitPrice: 100 }] }, emise)).toEqual([]);
  });

  it("les champs absents de la requete restent hors sujet", () => {
    expect(frozenFieldsTouched({ notes: "rappel telephonique" }, emise)).toEqual([]);
  });
});

describe("le gel, lui, tient toujours", () => {
  it("changer le montant est refuse", () => {
    expect(frozenFieldsTouched({ totalAmount: "999.00" }, emise)).toContain("totalAmount");
  });

  it("changer le client est refuse", () => {
    expect(frozenFieldsTouched({ clientName: "Autre SARL" }, emise)).toContain("clientName");
  });

  it("changer les lignes est refuse", () => {
    const autres = [{ description: "Autre chose", quantity: 5, unitPrice: 800 }];
    expect(frozenFieldsTouched({ items: autres }, emise)).toContain("items");
  });

  it("changer la reference est refuse", () => {
    expect(frozenFieldsTouched({ reference: "FAC-2026-9999" }, emise)).toContain("reference");
  });

  it("changer l'echeance est refuse", () => {
    expect(frozenFieldsTouched({ dueDate: "2027-01-01T00:00:00.000Z" }, emise)).toContain("dueDate");
  });

  it("le refus nomme TOUS les champs reecrits", () => {
    const touches = frozenFieldsTouched({ totalAmount: "999.00", clientName: "X" }, emise);
    expect(touches.sort()).toEqual(["clientName", "totalAmount"]);
  });

  it("sans etat de reference, toute presence reste suspecte", () => {
    // Un appelant qui ne fournit pas la facture actuelle ne doit pas obtenir
    // un blanc-seing: on retombe sur l'ancien comportement, plus strict.
    expect(frozenFieldsTouched({ totalAmount: "120.00" })).toContain("totalAmount");
  });

  it("la liste des champs geles couvre bien le contenu de la facture", () => {
    for (const champ of ["reference", "items", "totalAmount", "clientName", "dueDate"]) {
      expect(FROZEN_FIELDS as readonly string[], `${champ} n'est plus gele`).toContain(champ);
    }
  });
});
