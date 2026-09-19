/**
 * L'ecran d'abonnement affichait « 0/0 » appels pour toute organisation.
 *
 * Le serveur emet `callsThisMonth` (routes/subscriptions.ts). L'ecran lisait
 * `usage.calls`. La cle n'existant pas, `usage.calls?.current || 0` rendait
 * « 0/0 » — ce qui ressemble a un quota atteint, pas a une erreur de lecture.
 * Le `?.` et le `|| 0` transformaient l'absence en chiffre, et le defaut
 * n'avait aucune chance d'etre remarque.
 *
 * Second defaut dans le meme bloc : `max` vaut `null` quand le plan n'impose
 * aucun plafond. `|| 0` le rendait « 0 » — illimite s'affichait comme interdit.
 */
import { describe, expect, it } from "vitest";
import { courantAffiche, plafondAffiche } from "./quota-affiche";

describe("le plafond", () => {
  it("un plafond absent est un illimite, pas un zero", () => {
    expect(plafondAffiche({ current: 12, max: null }), "« 0 » se lit comme interdit").toBe("∞");
  });

  it("une cle absente aussi", () => {
    expect(plafondAffiche(undefined)).toBe("∞");
  });

  it("un plafond a zero reste un vrai plafond", () => {
    // Un plan qui n'ouvre pas la fonction: 0 est la bonne reponse.
    expect(plafondAffiche({ current: 0, max: 0 })).toBe("0");
  });

  it("un plafond chiffre s'affiche tel quel", () => {
    expect(plafondAffiche({ current: 3, max: 2000 })).toBe("2000");
  });

  it("le signe de l'illimite est configurable", () => {
    expect(plafondAffiche({ max: null }, "—")).toBe("—");
  });
});

describe("le compteur courant", () => {
  it("une consommation reelle est rendue", () => {
    expect(courantAffiche({ current: 137, max: 2000 })).toBe(137);
  });

  it("une absence vaut zero: rien n'a ete consomme", () => {
    expect(courantAffiche(undefined)).toBe(0);
  });

  it("zero reste zero", () => {
    expect(courantAffiche({ current: 0, max: 500 })).toBe(0);
  });

  it("une valeur non numerique ne passe pas a l'affichage", () => {
    expect(courantAffiche({ current: NaN })).toBe(0);
  });
});

describe("la forme emise par le serveur", () => {
  /** Reponse de `GET /api/subscription/usage`, telle qu'elle est ecrite. */
  const reponse = {
    users: { current: 3, max: 10 },
    contacts: { current: 120, max: 500 },
    callsThisMonth: { current: 137, max: 2000 },
  };

  it("le quota d'appels se lit sous `callsThisMonth`", () => {
    expect(courantAffiche((reponse as any).callsThisMonth), "c'est la cle que le serveur emet").toBe(137);
  });

  it("`calls` n'existe pas, et ne doit plus etre lu", () => {
    expect((reponse as any).calls, "lire cette cle rendait « 0/0 » partout").toBeUndefined();
  });

  it("le plafond d'appels est bien celui du plan", () => {
    expect(plafondAffiche(reponse.callsThisMonth)).toBe("2000");
  });

  it("sans abonnement, les plafonds sont nuls et donc illimites a l'affichage", () => {
    // Le serveur emet `max: null` quand aucun plan ne fixe de plafond.
    expect(plafondAffiche({ current: 0, max: null })).toBe("∞");
  });
});
