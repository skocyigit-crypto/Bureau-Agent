/**
 * Le bouton « Appeler » de la LISTE des contacts n'ouvrait rien.
 *
 * Mesure du 19/09 : `contacts.tsx` envoie `/appels?phone=...`, `calls.tsx` ne
 * lisait que `contactId`. Et le chemin `contactId`, lui, effacait l'URL avant
 * que les contacts soient charges, donc avant d'avoir pu en tirer le numero.
 */
import { describe, expect, it } from "vitest";
import { intentionAppel } from "./intention-appel";

const contacts = [
  { id: 7, phone: "0102030405" },
  { id: 8, phone: null },
];

describe("arriver depuis la LISTE des contacts (?phone=)", () => {
  it("ouvre la boite de dialogue", () => {
    expect(
      intentionAppel("?phone=0102030405", contacts).ouvrir,
      "sans cela le bouton Appeler ne fait rien de visible",
    ).toBe(true);
  });

  it("pre-remplit le numero recu", () => {
    expect(intentionAppel("?phone=0102030405", contacts).phoneNumber).toBe("0102030405");
  });

  it("accepte un numero encode (espaces, +33)", () => {
    expect(intentionAppel(`?phone=${encodeURIComponent("+33 1 02 03 04 05")}`, contacts).phoneNumber)
      .toBe("+33 1 02 03 04 05");
  });

  it("l'URL a fini de servir des le premier passage", () => {
    // Un numero nu n'attend aucun chargement.
    expect(intentionAppel("?phone=0102030405", undefined).urlConsommee).toBe(true);
  });

  it("ne fonctionne pas au hasard : sans contacts charges non plus", () => {
    expect(intentionAppel("?phone=0102030405", undefined).phoneNumber).toBe("0102030405");
  });
});

describe("arriver depuis la FICHE d'un contact (?contactId=)", () => {
  it("garde l'URL tant que les contacts ne sont pas charges", () => {
    expect(
      intentionAppel("?contactId=7", undefined).urlConsommee,
      "l'effacer avant la reponse, c'est perdre le numero pour toujours",
    ).toBe(false);
  });

  it("n'invente pas de numero avant d'avoir les contacts", () => {
    expect(intentionAppel("?contactId=7", undefined).phoneNumber).toBeUndefined();
  });

  it("ouvre quand meme la boite pendant l'attente", () => {
    expect(intentionAppel("?contactId=7", undefined).ouvrir).toBe(true);
  });

  it("une fois les contacts la, remplit le numero", () => {
    expect(intentionAppel("?contactId=7", contacts).phoneNumber).toBe("0102030405");
  });

  it("et ne libere l'URL qu'a ce moment", () => {
    expect(intentionAppel("?contactId=7", contacts).urlConsommee).toBe(true);
  });

  it("un contact sans telephone ne bloque pas la saisie", () => {
    const r = intentionAppel("?contactId=8", contacts);
    expect(r.ouvrir).toBe(true);
    expect(r.phoneNumber).toBeUndefined();
  });

  it("un contact inconnu ouvre une saisie vide, sans retenir l'URL", () => {
    const r = intentionAppel("?contactId=999", contacts);
    expect(r.phoneNumber).toBeUndefined();
    expect(r.urlConsommee).toBe(true);
  });

  it("la fiche prime sur un numero present dans la meme URL", () => {
    expect(intentionAppel("?contactId=7&phone=0000000000", contacts).phoneNumber).toBe("0102030405");
  });

  it("l'identifiant est rendu en chaine, comme le formulaire l'attend", () => {
    expect(intentionAppel("?contactId=7", contacts).contactId).toBe("7");
  });
});

describe("arriver sans rien demander", () => {
  it("n'ouvre aucune boite de dialogue", () => {
    expect(intentionAppel("", contacts).ouvrir).toBe(false);
  });

  it("ne touche pas a l'URL", () => {
    expect(intentionAppel("?page=2", contacts).urlConsommee).toBe(false);
  });

  it("un parametre vide ne compte pas pour une demande", () => {
    expect(intentionAppel("?phone=", contacts).ouvrir).toBe(false);
  });
});
