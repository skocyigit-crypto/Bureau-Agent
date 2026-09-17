import { describe, expect, it } from "vitest";
import { detecterSeparateur, lireCsv, lireCsvObjets } from "./lecture-csv";

describe("lecture CSV d'import", () => {
  it("le BOM ne colle plus au premier en-tete", () => {
    expect(Object.keys(lireCsvObjets('\uFEFF"Prénom";"Nom"\r\n"Jean";"Dupont"')[0]!)).toEqual(["Prénom", "Nom"]);
  });
  it("un separateur entre guillemets reste dans la cellule", () => {
    expect(lireCsv('"a";"3 rue X; bat. B"\r\n')[0]).toEqual(["a", "3 rue X; bat. B"]);
  });
  it("guillemets doubles et retour a la ligne dans une cellule", () => {
    expect(lireCsv('"il a dit ""oui""";"l1\nl2"')[0]).toEqual(['il a dit "oui"', "l1\nl2"]);
  });
  it("l'apostrophe de protection anti-formule est retiree", () => {
    expect(lireCsv('"\'-Durand";"\'=1+1"')[0]).toEqual(["-Durand", "=1+1"]);
  });
  it("une apostrophe ordinaire est conservee", () => expect(lireCsv('"l\'Atelier"')[0]).toEqual(["l'Atelier"]));
  it("une apostrophe en tete SANS formule derriere est conservee", () => {
    // Mutation survivante mesuree : retirer toute apostrophe initiale passait.
    expect(lireCsv(`"'Tis"`)[0]).toEqual(["'Tis"]);
  });
  it("virgule reconnue pour les anciens fichiers", () => {
    expect(lireCsvObjets("Prénom,Nom\nJean,Dupont")).toEqual([{ "Prénom": "Jean", Nom: "Dupont" }]);
  });
  it("le modele avec virgules et accents", () => expect(detecterSeparateur("Prénom,Nom,Email")).toBe(","));
  it("point-virgule majoritaire", () => expect(detecterSeparateur('"a";"b,c";"d"')).toBe(";"));
  it("lignes vides ignorees, cellule manquante vide", () => {
    expect(lireCsvObjets("A;B\n\nx\n")).toEqual([{ A: "x", B: "" }]);
  });
  it("aller-retour avec l'export (format exact produit par le serveur)", () => {
    const exporte = '\uFEFF"Prénom";"Nom";"Notes"\r\n"\'@Jean";"Dupont";"a;b ""c"""\r\n';
    expect(lireCsvObjets(exporte)).toEqual([{ "Prénom": "@Jean", Nom: "Dupont", Notes: 'a;b "c"' }]);
  });
});
