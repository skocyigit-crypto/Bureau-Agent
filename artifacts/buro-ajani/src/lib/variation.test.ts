import { describe, expect, it } from "vitest";
import { affichageVariation, valeurOuTiret } from "./variation";

describe("affichageVariation", () => {
  it("null est inconnu, affiche un tiret", () => expect(affichageVariation(null)).toEqual({ sens: "inconnu", texte: "—" }));
  it("undefined est inconnu", () => expect(affichageVariation(undefined).sens).toBe("inconnu"));
  it("NaN est inconnu", () => expect(affichageVariation(NaN).sens).toBe("inconnu"));
  it("zero est stable, pas une baisse", () => expect(affichageVariation(0)).toEqual({ sens: "stable", texte: "0%" }));
  it("positif est une hausse signee", () => expect(affichageVariation(12.5)).toEqual({ sens: "hausse", texte: "+12.5%" }));
  it("negatif est une baisse", () => expect(affichageVariation(-3)).toEqual({ sens: "baisse", texte: "-3%" }));
  it("l'unite est respectee", () => expect(affichageVariation(4, " pts").texte).toBe("+4 pts"));
});

describe("valeurOuTiret", () => {
  it("null donne un tiret", () => expect(valeurOuTiret(null, "%")).toBe("—"));
  it("0 reste 0 : c'est une mesure", () => expect(valeurOuTiret(0, "%")).toBe("0%"));
  it("Infinity donne un tiret", () => expect(valeurOuTiret(Infinity)).toBe("—"));
  it("une chaine passe telle quelle", () => expect(valeurOuTiret("Lun")).toBe("Lun"));
});
