/**
 * La reception des travaux, et les quatre horloges qu'elle demarre.
 *
 * CE QUI MANQUAIT — MESURE DU 16/09
 *
 * Le module « Projets » est un suivi generique. Recherche dans tout le depot :
 * `carte BTP` 0 occurrence, `permis de construire` 0, `registre du personnel`
 * 0, `PPSPS` 0 — et `reception des travaux` / `garantie decennale` une seule
 * fois chacune, sur la MEME ligne de la fixture d'un test d'extraction PDF.
 *
 * Le vocabulaire juridique du chantier n'existait donc dans ce produit que
 * sous forme de chaine de caracteres dans un jeu d'essai.
 *
 * POURQUOI CETTE DATE PLUTOT QU'UNE AUTRE
 *
 * Parmi tout ce qui manque, la reception est la seule dont DEPENDENT des
 * obligations deja portees par le produit: la mention d'assurance decennale
 * sur les devis et factures (meme lot), et la retenue de garantie du modele de
 * tresorerie. Sans elle, ces periodes courent depuis un instant que le produit
 * ne sait pas situer.
 *
 * LES DEUX PIEGES TESTES ICI
 *
 * 1. Une reception AVEC RESERVES est une reception: elle fait partir la
 *    decennale exactement comme une reception sans reserve. Les confondre
 *    decale de plusieurs mois une periode de dix ans.
 * 2. La levee des reserves ne deplace AUCUNE garantie. Elle solde le parfait
 *    achevement sur les points reserves; le point de depart reste la
 *    reception.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";

import {
  RETENUE_GARANTIE_MOIS,
  echeancesDepuisReception,
  etatReception,
  type CodeGarantie,
} from "../services/garanties-chantier";

const RECEPTION = "2026-03-10T00:00:00.000Z";
const LENDEMAIN = new Date("2026-03-11T00:00:00.000Z");

function fin(code: CodeGarantie, reception = RECEPTION): string {
  const e = echeancesDepuisReception(reception, LENDEMAIN).find((x) => x.code === code);
  if (!e) throw new Error(`echeance ${code} absente`);
  return e.fin.toISOString().slice(0, 10);
}

describe("les quatre echeances et leurs durees", () => {
  it("le parfait achevement court un an", () => {
    expect(fin("parfait-achevement")).toBe("2027-03-10");
  });

  it("le bon fonctionnement court deux ans", () => {
    expect(fin("bon-fonctionnement")).toBe("2028-03-10");
  });

  it("la decennale court dix ans", () => {
    // Le chiffre EST la regle: neuf ans serait une autre loi, et l'erreur ne
    // se verrait qu'au sinistre.
    expect(fin("decennale")).toBe("2036-03-10");
  });

  it("la retenue de garantie est restituee au bout de douze mois", () => {
    expect(RETENUE_GARANTIE_MOIS).toBe(12);
    expect(fin("retenue-garantie")).toBe("2027-03-10");
  });

  it("chaque echeance cite son texte", () => {
    // Une echeance sans reference se discute; avec elle, elle se verifie.
    for (const e of echeancesDepuisReception(RECEPTION, LENDEMAIN)) {
      expect(e.reference.length, e.code).toBeGreaterThan(5);
    }
  });

  it("les quatre echeances sont rendues, pas trois", () => {
    const codes = echeancesDepuisReception(RECEPTION, LENDEMAIN).map((e) => e.code);
    expect(codes).toEqual([
      "parfait-achevement",
      "bon-fonctionnement",
      "decennale",
      "retenue-garantie",
    ]);
  });
});

describe("sans reception, rien ne court", () => {
  it("une date absente ne produit aucune echeance", () => {
    // Inventer un point de depart ferait courir dix ans depuis un instant
    // arbitraire — pire que de ne rien afficher.
    expect(echeancesDepuisReception(null)).toEqual([]);
    expect(echeancesDepuisReception(undefined)).toEqual([]);
    expect(echeancesDepuisReception("")).toEqual([]);
  });

  it("une date illisible non plus", () => {
    expect(echeancesDepuisReception("pas-une-date")).toEqual([]);
    expect(echeancesDepuisReception("2026-13-45T00:00:00Z")).toEqual([]);
  });

  it("des travaux termines sans reception sont signales", () => {
    // LE CAS QUI COUTE CHER. L'artisan croit le chantier clos; juridiquement
    // la decennale n'a pas commence, et l'assurance peut ne pas couvrir. Il
    // le decouvre au sinistre.
    const e = etatReception({ actualEndDate: "2026-03-01T00:00:00Z", receptionDate: null });
    expect(e.receptionnee).toBe(false);
    expect(e.avertissements.join(" ")).toMatch(/reception n'est pas enregistree/i);
    expect(e.avertissements.join(" ")).toMatch(/aucune garantie legale ne court/i);
  });

  it("un chantier ni termine ni receptionne ne declenche aucun reproche", () => {
    // Un chantier en cours est normal: s'en plaindre ferait du bruit sur la
    // majorite des lignes et l'avertissement cesserait d'etre lu.
    expect(etatReception({}).avertissements).toEqual([]);
  });
});

describe("la reception avec reserves reste une reception", () => {
  it("elle fait partir la decennale a la meme date", () => {
    // LE PREMIER PIEGE. Une lecture naive repousserait le depart a la levee
    // des reserves, decalant de plusieurs mois une periode de dix ans.
    const sans = etatReception(
      { receptionDate: RECEPTION, receptionWithReserves: false },
      LENDEMAIN,
    );
    const avec = etatReception(
      { receptionDate: RECEPTION, receptionWithReserves: true },
      LENDEMAIN,
    );
    const d = (e: typeof sans) => e.echeances.find((x) => x.code === "decennale")!.fin.toISOString();
    expect(d(avec)).toBe(d(sans));
  });

  it("des reserves non levees sont signalees", () => {
    const e = etatReception(
      { receptionDate: RECEPTION, receptionWithReserves: true },
      LENDEMAIN,
    );
    expect(e.reservesOuvertes).toBe(true);
    expect(e.avertissements.join(" ")).toMatch(/parfait achevement/i);
  });

  it("des reserves levees ne sont plus signalees", () => {
    const e = etatReception(
      {
        receptionDate: RECEPTION,
        receptionWithReserves: true,
        reservesLiftedAt: "2026-04-01T00:00:00Z",
      },
      LENDEMAIN,
    );
    expect(e.reservesOuvertes).toBe(false);
    expect(e.avertissements.join(" ")).not.toMatch(/reserves/i);
  });

  it("la levee des reserves ne deplace aucune echeance", () => {
    // LE SECOND PIEGE. La levee solde le parfait achevement sur les points
    // reserves; elle ne redemarre rien.
    const avant = etatReception({ receptionDate: RECEPTION, receptionWithReserves: true }, LENDEMAIN);
    const apres = etatReception(
      { receptionDate: RECEPTION, receptionWithReserves: true, reservesLiftedAt: "2026-04-01T00:00:00Z" },
      LENDEMAIN,
    );
    for (const code of ["parfait-achevement", "decennale", "retenue-garantie"] as const) {
      const a = avant.echeances.find((x) => x.code === code)!.fin.toISOString();
      const b = apres.echeances.find((x) => x.code === code)!.fin.toISOString();
      expect(b, code).toBe(a);
    }
  });

  it("une date de levee illisible laisse les reserves ouvertes", () => {
    // Prudence: une valeur inexploitable ne doit pas faire disparaitre un
    // avertissement qui porte sur une obligation.
    const e = etatReception(
      { receptionDate: RECEPTION, receptionWithReserves: true, reservesLiftedAt: "n'importe quoi" },
      LENDEMAIN,
    );
    expect(e.reservesOuvertes).toBe(true);
  });
});

describe("le temps qui passe", () => {
  it("les jours restants diminuent", () => {
    const tot = echeancesDepuisReception(RECEPTION, new Date("2026-03-11T00:00:00Z"));
    const tard = echeancesDepuisReception(RECEPTION, new Date("2026-09-11T00:00:00Z"));
    const j = (e: typeof tot) => e.find((x) => x.code === "parfait-achevement")!.joursRestants;
    expect(j(tard)).toBeLessThan(j(tot));
  });

  it("une garantie passee est marquee expiree", () => {
    const e = echeancesDepuisReception(RECEPTION, new Date("2027-06-01T00:00:00Z"));
    expect(e.find((x) => x.code === "parfait-achevement")!.expiree).toBe(true);
    expect(e.find((x) => x.code === "decennale")!.expiree).toBe(false);
  });

  it("la decennale expire bien apres dix ans, pas avant", () => {
    const veille = echeancesDepuisReception(RECEPTION, new Date("2036-03-09T00:00:00Z"));
    const apres = echeancesDepuisReception(RECEPTION, new Date("2036-03-11T00:00:00Z"));
    expect(veille.find((x) => x.code === "decennale")!.expiree).toBe(false);
    expect(apres.find((x) => x.code === "decennale")!.expiree).toBe(true);
  });

  it("la restitution proche de la retenue de garantie est annoncee", () => {
    // Deux mois avant l'echeance: c'est le moment ou l'entreprise doit
    // relancer, et 5 % d'un marche ne se reclament pas tout seuls.
    const e = etatReception({ receptionDate: RECEPTION }, new Date("2027-02-01T00:00:00Z"));
    expect(e.avertissements.join(" ")).toMatch(/retenue de garantie devient exigible/i);
  });

  it("elle ne l'est pas un an a l'avance", () => {
    const e = etatReception({ receptionDate: RECEPTION }, LENDEMAIN);
    expect(e.avertissements.join(" ")).not.toMatch(/retenue de garantie/i);
  });

  it("une reception du 29 fevrier ne produit pas de date impossible", () => {
    // 2036 n'est pas bissextile au sens ou le 29 fevrier + 10 ans n'existe
    // pas toujours: la date doit rester valide plutot que devenir NaN.
    const e = echeancesDepuisReception("2024-02-29T00:00:00Z", new Date("2024-03-01T00:00:00Z"));
    const dec = e.find((x) => x.code === "decennale")!;
    expect(Number.isNaN(dec.fin.getTime())).toBe(false);
    expect(dec.fin.getUTCFullYear()).toBe(2034);
  });
});

describe("le calcul est branche sur la fiche chantier", () => {
  it("la route de detail expose l'etat de reception", async () => {
    // Ce depot a un mode de panne recurrent que `retention-cron.ts` documente
    // lui-meme: « du code redige, jamais branche ».
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "projets.ts"), "utf8");
    expect(source).toContain("garanties-chantier");
    expect(source).toContain("chantier: etatReception(row)");
  });

  it("rien n'est ecrit en base : les durees sont des regles, pas des donnees", async () => {
    // Stocker « fin de decennale » figerait une regle de droit dans chaque
    // ligne, et les chantiers anciens divergeraient des nouveaux le jour ou
    // une duree change.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "projets.ts"), "utf8");
    const i = source.indexOf("chantier: etatReception(row)");
    const bloc = source.slice(Math.max(0, i - 600), i + 200);
    expect(bloc).not.toContain("db.update");
    expect(bloc).not.toContain("db.insert");
  });

  it("les colonnes de reception existent bien dans le schema", async () => {
    // Sans elles, la fonctionnalite n'a aucune donnee a lire et l'etat rendu
    // serait toujours « non receptionne ».
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "..", "lib", "db", "src", "schema", "projets.ts"),
      "utf8",
    );
    for (const c of ["reception_date", "reception_with_reserves", "reception_reserves", "reserves_lifted_at"]) {
      expect(schema, c).toContain(c);
    }
  });
});

describe("la date de reception peut etre saisie, et mal saisie", () => {
  it("le PATCH accepte les quatre champs", async () => {
    // Des colonnes que rien ne remplit resteraient vides, et l'etat rendu
    // serait toujours « non receptionne ».
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "projets.ts"), "utf8");
    for (const c of ["receptionDate", "receptionWithReserves", "receptionReserves", "reservesLiftedAt"]) {
      expect(source, c).toContain(`updates.${c}`);
    }
  });

  it("une date de reception illisible est REFUSEE, pas convertie", async () => {
    // `new Date("n'importe quoi")` rend `Invalid Date`, que Postgres
    // rejetterait ou stockerait selon le pilote. Dans les deux cas, dix ans
    // de decennale partiraient d'un instant indefini.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "projets.ts"), "utf8");
    const i = source.indexOf("if (receptionDate !== undefined)");
    expect(i).toBeGreaterThan(0);
    const bloc = source.slice(i, i + 500);
    expect(bloc).toContain("Number.isNaN(d.getTime())");
    expect(bloc).toContain("status(400)");
  });

  it("une date vide efface la reception au lieu de la corrompre", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "projets.ts"), "utf8");
    const i = source.indexOf("if (receptionDate !== undefined)");
    expect(source.slice(i, i + 300)).toContain("updates.receptionDate = null;");
  });
});
