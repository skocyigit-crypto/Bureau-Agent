/**
 * Une date envoyee au client se lit dans le fuseau de l'entreprise.
 *
 * `toLocaleDateString("fr-FR")` SANS `timeZone` prend celui de la MACHINE.
 * Sur le poste du developpeur, a Paris, le resultat est juste ; dans le
 * conteneur Cloud Run, qui tourne en UTC, une echeance enregistree a 23h30 a
 * Paris s'affiche LA VEILLE. Et c'est le conteneur qui envoie les courriels.
 *
 * C'est le meme defaut que « aujourd'hui » calcule en UTC (garde voisine,
 * aujourdhui-local.test.ts), en pire : celui-la se trahit a l'execution sur
 * une machine mal reglee, donc jamais en integration continue.
 * (Piege signale par la session Assise le 24/09/2026, qui l'a rencontre sur
 * vingt fichiers.)
 *
 * CE QUE CE CONTROLE EXIGE, et ou. Les modules qui ECRIVENT AU CLIENT —
 * courriels, factures, relances — doivent passer par `dateHumaine` ou fixer
 * `timeZone`. Le reste du produit (invites pour les modeles d'IA, tableaux de
 * bord internes) porte la meme dette ; elle est CHIFFREE ici, et ce chiffre
 * ne doit pas monter.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { dateHumaine, jourLocal } from "../lib/jour-local";

const SRC = join(import.meta.dirname, "..");

/** Ce qui part chez le client : un mauvais jour s'y lit, et engage. */
const AU_CLIENT = [
  "services/email.ts",
  "services/facture-document.ts",
  "services/invoice-pdf.ts",
  "services/factures-en-retard.ts",
  "routes/factures-client.ts",
  "routes/devis.ts",
];

/**
 * La dette restante, mesuree le 24/09/2026 : 75 formatages sans fuseau, tous
 * dans des textes internes (invites d'IA, resumes de tableau de bord). Le
 * chiffre est un PLAFOND : il baisse quand on corrige, il ne monte pas.
 */
const PLAFOND_DETTE_INTERNE = 75;

const MOTIF = /\.toLocale(?:Date|Time)?String\(/;

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n === "__tests__" ? [] : fichiers(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

/** Les appels sans `timeZone`, fichier par fichier. */
function sansFuseau(): Array<{ fichier: string; ligne: number; texte: string }> {
  const trouves: Array<{ fichier: string; ligne: number; texte: string }> = [];
  for (const f of fichiers(SRC)) {
    readFileSync(f, "utf8").split(/\r?\n/).forEach((ligne, i) => {
      if (!MOTIF.test(ligne)) return;
      if (/timeZone/.test(ligne)) return;
      if (/^\s*(\*|\/\/)/.test(ligne)) return;
      trouves.push({ fichier: relative(SRC, f).split("\\").join("/"), ligne: i + 1, texte: ligne.trim().slice(0, 120) });
    });
  }
  return trouves;
}

describe("le formateur", () => {
  it("rend la date du fuseau de l'entreprise, pas celle de la machine", () => {
    // 23h30 UTC le 23 septembre = 00h30 le 24 a Paris.
    const nuit = new Date("2026-09-23T22:30:00.000Z");
    expect(dateHumaine(nuit)).toBe("24/09/2026");
    expect(jourLocal(nuit)).toBe("2026-09-24");
  });

  it("accepte une autre langue sans perdre le fuseau", () => {
    const nuit = new Date("2026-09-23T22:30:00.000Z");
    expect(dateHumaine(nuit, "en-GB")).toBe("24/09/2026");
    expect(dateHumaine(nuit, "fr-FR", undefined, { day: "numeric", month: "long", year: "numeric" })).toMatch(/24 septembre 2026/);
  });

  it("un autre fuseau reste possible, explicitement", () => {
    expect(dateHumaine(new Date("2026-09-24T02:00:00.000Z"), "fr-FR", "America/New_York")).toBe("23/09/2026");
  });
});

describe("ce qui part chez le client", () => {
  const coupables = sansFuseau().filter((t) => AU_CLIENT.includes(t.fichier));

  it("aucune date sans fuseau dans les courriels, factures et relances", () => {
    expect(
      coupables.map((c) => `${c.fichier}:${c.ligne}  ${c.texte}`),
      "une date ecrite au client se lit dans le fuseau de l'entreprise (dateHumaine)",
    ).toEqual([]);
  });

  it("le controle regarde bien ces fichiers-la", () => {
    // Garde-fou : un fichier renomme viderait la liste, et une liste vide est
    // satisfaite par n'importe quel code.
    const presents = fichiers(SRC).map((f) => relative(SRC, f).split("\\").join("/"));
    for (const f of AU_CLIENT) expect(presents, `fichier surveille introuvable : ${f}`).toContain(f);
  });
});

describe("la dette interne est chiffree, et ne monte pas", () => {
  it(`au plus ${PLAFOND_DETTE_INTERNE} formatages sans fuseau ailleurs`, () => {
    const reste = sansFuseau().filter((t) => !AU_CLIENT.includes(t.fichier));
    // Si ce controle tombe vers le bas, c'est une bonne nouvelle : baisser le
    // plafond. Vers le haut, c'est une dette ajoutee sans decision.
    expect(reste.length, `dette : ${reste.slice(0, 5).map((r) => r.fichier + ":" + r.ligne).join(", ")}`)
      .toBeLessThanOrEqual(PLAFOND_DETTE_INTERNE);
  });

  it("le releve trouve bien quelque chose (sinon il ne mesure rien)", () => {
    expect(sansFuseau().length).toBeGreaterThan(10);
  });
});
