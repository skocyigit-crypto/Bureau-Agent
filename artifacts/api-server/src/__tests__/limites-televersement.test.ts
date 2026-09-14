/**
 * La taille annoncee doit etre celle qui PASSE.
 *
 * Trois plafonds se superposent sur un televersement, et ils ne se parlaient
 * pas:
 *
 *   1. la taille annoncee a l'utilisateur  -> 25 Mo
 *   2. la limite du lecteur de corps JSON  -> 15 Mo sur /api/document-ai
 *   3. le plafond de requete de Cloud Run  -> 32 Mio, non negociable
 *
 * Le fichier voyage en base64 dans du JSON: il enfle d'un tiers. Calcul:
 *
 *     corps de 15 Mo   -> fichier utile 11,2 Mo   (annonce: 25)
 *     fichier de 25 Mo -> corps de 33,4 Mo        (plafond: 32 Mio)
 *
 * Autrement dit: tout fichier au-dela d'environ 11 Mo etait refuse, et les
 * 25 Mo annonces n'etaient atteignables par AUCUN reglage — la plateforme les
 * aurait refuses de toute facon.
 *
 * Le pire n'est pas le refus, c'est ou il tombait: le lecteur de corps rejette
 * AVANT le controle applicatif, donc le message « Le fichier depasse la taille
 * maximale de 25 Mo » n'avait jamais lieu de s'afficher. L'utilisateur voyait
 * un echec sans phrase, sur un fichier que l'interface lui presentait comme
 * acceptable — apres l'avoir televerse.
 *
 * Ce test tient les trois nombres ensemble. Ils vivaient dans trois endroits
 * differents, et c'est pour cela qu'ils avaient derive.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  limiteCorpsBase64,
  PLAFOND_PLATEFORME_OCTETS,
  TAILLE_MAX_BASE64_MO,
  TAILLE_MAX_BASE64_OCTETS,
} from "../lib/limites-televersement";

const MO = 1024 * 1024;
const FACTEUR_BASE64 = 4 / 3;

describe("la taille annoncee", () => {
  it("tient dans le plafond de la plateforme, une fois encodee", () => {
    const corps = TAILLE_MAX_BASE64_OCTETS * FACTEUR_BASE64;
    expect(
      corps,
      "un fichier a la taille annoncee produit un corps que Cloud Run refusera",
    ).toBeLessThanOrEqual(PLAFOND_PLATEFORME_OCTETS);
  });

  it("n'est pas ridiculement basse non plus", () => {
    // L'autre facon de rendre les nombres coherents serait d'annoncer 2 Mo.
    // Ce serait vrai, et inutilisable: un PDF de chantier scanne les depasse.
    expect(TAILLE_MAX_BASE64_MO).toBeGreaterThanOrEqual(15);
  });

  it("vaut bien 23 Mo, et non les 25 promis auparavant", () => {
    // Contre-epreuve du calcul: 25 Mo etaient impossibles, 23 passent.
    expect(TAILLE_MAX_BASE64_MO).toBe(23);
    expect(25 * MO * FACTEUR_BASE64).toBeGreaterThan(PLAFOND_PLATEFORME_OCTETS);
    expect(23 * MO * FACTEUR_BASE64).toBeLessThan(PLAFOND_PLATEFORME_OCTETS);
  });
});

describe("la limite du lecteur de corps", () => {
  it("laisse passer un fichier a la taille annoncee", () => {
    const limite = limiteCorpsBase64(TAILLE_MAX_BASE64_MO);
    const octets = Number(limite.replace("mb", "")) * MO;

    expect(
      octets,
      `la limite de corps (${limite}) refuserait un fichier de ${TAILLE_MAX_BASE64_MO} Mo ` +
        "encode en base64 — et le refus tomberait avant le message qui l'explique",
    ).toBeGreaterThanOrEqual(TAILLE_MAX_BASE64_MO * MO * FACTEUR_BASE64);
  });

  it("ne promet jamais plus que la plateforme", () => {
    // Declarer 40mb, comme avant, ne rendait pas 40 Mo possibles: cela rendait
    // seulement l'ecart invisible.
    for (const demande of [10, 23, 50, 500]) {
      const octets = Number(limiteCorpsBase64(demande).replace("mb", "")) * MO;
      expect(octets).toBeLessThanOrEqual(PLAFOND_PLATEFORME_OCTETS);
    }
  });
});

describe("les routes qui recoivent du base64", () => {
  const app = readFileSync(join(import.meta.dirname, "..", "app.ts"), "utf8");

  it("ne fixent plus leur limite a la main", () => {
    // La valeur en dur est exactement ce qui permet a deux nombres de diverger
    // sans que personne ne s'en apercoive.
    expect(
      /\/api\/document-ai", express\.json\(\{ limit: "\d+mb" \}\)/.test(app),
      "la limite de /api/document-ai est de nouveau ecrite en dur",
    ).toBe(false);
    expect(app).toContain("limiteCorpsBase64(TAILLE_MAX_BASE64_MO)");
  });

  it("le message d'erreur cite la meme taille que celle qu'on applique", () => {
    const route = readFileSync(
      join(import.meta.dirname, "..", "routes", "document-ai.ts"),
      "utf8",
    );
    expect(route).toContain("TAILLE_MAX_BASE64_MO as MAX_FILE_SIZE_MB");
    expect(route).toMatch(/taille maximale de \$\{MAX_FILE_SIZE_MB\} Mo/);
  });
});
