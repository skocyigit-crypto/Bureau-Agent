import { describe, expect, it } from "vitest";
import { rowId, safeInt, pageLimit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../lib/request-params";

/**
 * Une faute de frappe dans une URL ne doit pas devenir une panne serveur.
 *
 * La question de depart etait « 654 routes, 60 schemas de validation ». En
 * mesurant, la validation n'etait pas mince la ou on l'attendait: ce depot
 * n'ecrit jamais `req.body` en bloc, il choisit ses champs un par un, et
 * l'affectation de masse n'existe nulle part. Ce qui manquait etait plus
 * etroit: les nombres pris dans l'URL.
 *
 * `parseInt("abc")` rend `NaN`, qui traverse le code sans bruit jusqu'a
 * `eq(table.id, NaN)`. Postgres refuse, le client recoit un **500**, et cette
 * erreur va grossir le taux de 5xx que l'agent de sante vient de commencer a
 * surveiller: le bruit ronge l'alarme qu'on venait d'installer. Un identifiant
 * illisible est une faute du client — 400 — pas une panne du serveur.
 *
 * D'ou le choix de rendre `null` plutot que `NaN`: `null` ne se laisse pas
 * ignorer, il oblige l'appelant a decider.
 */

describe("rowId", () => {
  it("lit un identifiant normal", () => {
    expect(rowId("42")).toBe(42);
  });

  it("refuse ce qui n'est pas un nombre, au lieu de rendre NaN", () => {
    // C'est tout l'objet du module: NaN partait en base et ressortait en 500.
    expect(rowId("abc")).toBeNull();
    expect(rowId("")).toBeNull();
    expect(rowId(undefined)).toBeNull();
    expect(rowId(null)).toBeNull();
  });

  it("refuse zero et les negatifs: les cles primaires sont des `serial`", () => {
    expect(rowId("0")).toBeNull();
    expect(rowId("-1")).toBeNull();
  });

  it("refuse un identifiant decimal", () => {
    expect(rowId("1.5")).toBeNull();
  });

  it("ne se laisse pas avoir par un suffixe", () => {
    // `parseInt` lit 12 dans "12abc" et le rend sans rien signaler. Un
    // identifiant devine est pire qu'un identifiant refuse.
    expect(rowId("12abc")).toBeNull();
  });

  it("refuse un tableau, que Express produit sur `?id=1&id=2`", () => {
    // `String(["1","2"])` vaut "1,2", ou `parseInt` lit 1: la requete aurait
    // porte sur une ligne que personne n'a demandee.
    expect(rowId(["1", "2"])).toBeNull();
  });

  it("refuse un entier trop grand pour etre represente exactement", () => {
    expect(rowId("99999999999999999999")).toBeNull();
  });
});

describe("safeInt", () => {
  it("rend la valeur quand elle est dans les bornes", () => {
    expect(safeInt("30", 50, 1, 200)).toBe(30);
  });

  it("retombe sur le defaut pour une valeur illisible ou absente", () => {
    expect(safeInt("abc", 50, 1, 200)).toBe(50);
    expect(safeInt(undefined, 50, 1, 200)).toBe(50);
  });

  it("retombe sur le defaut sous le minimum", () => {
    expect(safeInt("0", 50, 1, 200)).toBe(50);
    expect(safeInt("-10", 50, 1, 200)).toBe(50);
  });

  it("plafonne au lieu de refuser: une demande trop grande est servie, bornee", () => {
    expect(safeInt("999999", 50, 1, 200)).toBe(200);
  });
});

describe("pageLimit", () => {
  it("borne une demande sans plafond", () => {
    // `?limit=99999999` demandait toute la table de l'organisation en une
    // requete — sur les journaux d'appels telephoniques, notamment.
    expect(pageLimit("99999999")).toBe(MAX_PAGE_SIZE);
  });

  it("rend le defaut quand le client ne demande rien", () => {
    expect(pageLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it("ne produit jamais NaN, qui donnait `LIMIT NaN`", () => {
    expect(pageLimit("abc")).toBe(DEFAULT_PAGE_SIZE);
    expect(Number.isFinite(pageLimit("abc"))).toBe(true);
  });

  it("accepte un plafond plus bas quand la route le veut", () => {
    expect(pageLimit("500", 60)).toBe(60);
  });
});
