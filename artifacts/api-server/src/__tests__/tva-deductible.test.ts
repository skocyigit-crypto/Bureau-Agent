/**
 * La TVA facturee n'est pas la TVA recuperable.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * `depenses` stocke `amountTva` et une `category`. Rien ne distinguait la part
 * effectivement deductible : le mot « deductible » n'apparaissait qu'une seule
 * fois dans tout le depot, dans l'en-tete d'un fichier de tests.
 *
 * Une PME du BTP qui remonte `amountTva` dans sa CA3 sur-deduit donc
 * mecaniquement sur au moins trois postes courants — carburant de vehicule de
 * tourisme (20 % de trop), entretien de ce vehicule (100 % de trop),
 * hebergement (100 % de trop). Une sur-deduction se solde par un rappel
 * assorti d'interets de retard.
 *
 * LE SENS DES DEFAUTS COMPTE
 *
 * Quand l'information manque, ce module retient l'hypothese PRUDENTE et le
 * dit. Un carburant dont on ignore le vehicule est compte a 80 % et non a
 * 100 % : se tromper vers le bas coute une deduction oubliee, que l'utilisateur
 * peut corriger; se tromper vers le haut coute un redressement, qu'il
 * decouvre des annees plus tard.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";

import { deductibiliteTva, totalDeductible } from "../services/tva-deductible";

const TVA = 100;

describe("le carburant depend de la nature du vehicule", () => {
  it("un utilitaire ouvre droit a la totalite", () => {
    const r = deductibiliteTva("carburant", TVA, { natureVehicule: "utilitaire" });
    expect(r.fraction).toBe(1);
    expect(r.montantDeductible).toBe(100);
    expect(r.aConfirmer).toBe(false);
  });

  it("un vehicule de tourisme est limite a 80 %", () => {
    // Essence et gazole sont alignes depuis 2026: la meme fraction s'applique
    // aux deux, ce qui n'a pas toujours ete le cas.
    const r = deductibiliteTva("carburant", TVA, { natureVehicule: "tourisme" });
    expect(r.fraction).toBe(0.8);
    expect(r.montantDeductible).toBe(80);
    expect(r.aConfirmer).toBe(false);
  });

  it("vehicule inconnu : 80 % retenus, et signales comme a confirmer", () => {
    // LE CHOIX DU SENS. Retenir 100 % ferait sur-deduire en silence sur le
    // poste le plus frequent d'une entreprise de chantier.
    const r = deductibiliteTva("carburant", TVA);
    expect(r.fraction).toBe(0.8);
    expect(r.aConfirmer).toBe(true);
    expect(r.motif).toBe("nature-vehicule");
  });
});

describe("l'entretien de vehicule suit une regle differente du carburant", () => {
  it("un vehicule de tourisme est TOTALEMENT exclu", () => {
    // La difference qui surprend: le carburant reste deductible a 80 %, mais
    // l'entretien du meme vehicule ne l'est pas du tout.
    const r = deductibiliteTva("entretien_vehicule", TVA, { natureVehicule: "tourisme" });
    expect(r.fraction).toBe(0);
    expect(r.montantDeductible).toBe(0);
  });

  it("un utilitaire ouvre droit a la totalite", () => {
    expect(deductibiliteTva("entretien_vehicule", TVA, { natureVehicule: "utilitaire" }).fraction).toBe(1);
  });

  it("vehicule inconnu : exclusion par defaut, a confirmer", () => {
    const r = deductibiliteTva("entretien_vehicule", TVA);
    expect(r.fraction).toBe(0);
    expect(r.aConfirmer).toBe(true);
    expect(r.motif).toBe("nature-vehicule");
  });

  it("le carburant et l'entretien ne donnent PAS le meme resultat", () => {
    // Garde-fou contre une simplification qui traiterait « le vehicule »
    // comme un poste unique.
    const carb = deductibiliteTva("carburant", TVA, { natureVehicule: "tourisme" });
    const ent = deductibiliteTva("entretien_vehicule", TVA, { natureVehicule: "tourisme" });
    expect(carb.fraction).not.toBe(ent.fraction);
  });
});

describe("les postes exclus par nature", () => {
  it("l'assurance ne porte pas de TVA du tout", () => {
    // Les primes sont exonerees: elles supportent la taxe sur les conventions
    // d'assurance, qui n'est pas recuperable.
    const r = deductibiliteTva("assurance", TVA);
    expect(r.fraction).toBe(0);
    expect(r.raison).toMatch(/exoneree/i);
  });

  it("le montant saisi a tort sur une assurance est signale comme erreur", () => {
    // Le cas pratique: l'OCR lit un montant et le range en TVA. Sans ce
    // libelle, l'utilisateur croit avoir une deduction a recuperer.
    expect(deductibiliteTva("assurance", 240).raison).toMatch(/erreur de saisie/i);
  });

  it("les taxes et impots sont hors champ", () => {
    expect(deductibiliteTva("taxes", TVA).fraction).toBe(0);
  });
});

describe("les postes deductibles en totalite", () => {
  it("fournitures, materiel, sous-traitance, loyer, telephone et honoraires", () => {
    for (const c of ["fournitures", "materiel", "sous_traitance", "loyer", "telephone_internet", "honoraires"]) {
      const r = deductibiliteTva(c, TVA);
      expect(r.fraction, c).toBe(1);
      expect(r.aConfirmer, c).toBe(false);
    }
  });

  it("la restauration est deductible, mais l'alcool est signale", () => {
    // Seul poste de representation integralement deductible — l'exception des
    // boissons alcoolisees ne se lit sur aucun champ, d'ou l'avertissement.
    const r = deductibiliteTva("repas", TVA);
    expect(r.fraction).toBe(1);
    expect(r.aConfirmer).toBe(true);
    expect(r.motif).toBe("alcool");
  });

  it("le deplacement melange deux regimes opposes et le dit", () => {
    // Peage deductible de droit commun, hebergement exclu meme pour un
    // deplacement 100 % professionnel: la categorie ne permet pas de trancher.
    const r = deductibiliteTva("deplacement", TVA);
    expect(r.aConfirmer).toBe(true);
    expect(r.raison).toMatch(/hebergement/i);
  });
});

describe("les montants et les bornes", () => {
  it("la fraction est appliquee au centime", () => {
    const r = deductibiliteTva("carburant", 33.33, { natureVehicule: "tourisme" });
    expect(r.montantDeductible).toBe(26.66);
  });

  it("une TVA nulle ne produit rien", () => {
    expect(deductibiliteTva("fournitures", 0).montantDeductible).toBe(0);
  });

  it("une TVA negative est ramenee a zero", () => {
    // Une valeur negative vient d'un avoir mal saisi ou d'un OCR aberrant:
    // la laisser passer produirait une deduction negative, donc une dette.
    expect(deductibiliteTva("fournitures", -50).montantDeductible).toBe(0);
  });

  it("une valeur non numerique ne casse pas le calcul", () => {
    // `amountTva` vient d'une colonne texte convertie: un NaN se propagerait
    // silencieusement a tous les totaux.
    expect(deductibiliteTva("fournitures", Number.NaN).montantDeductible).toBe(0);
    expect(deductibiliteTva("fournitures", Number.POSITIVE_INFINITY).montantDeductible).toBe(0);
  });

  it("une categorie inconnue applique le droit commun, en le signalant", () => {
    const r = deductibiliteTva("categorie-inexistante", TVA);
    expect(r.fraction).toBe(1);
    expect(r.aConfirmer).toBe(true);
  });
});

describe("le total sur un registre de depenses", () => {
  it("additionne les fractions, pas les montants bruts", () => {
    // Le chiffre qui partira en CA3. Sommer `amountTva` donnerait 300 au lieu
    // de 180: 120 EUR de sur-deduction sur trois lignes seulement.
    const registre = [
      { category: "carburant", montantTva: 100, natureVehicule: "tourisme" as const },
      { category: "entretien_vehicule", montantTva: 100, natureVehicule: "tourisme" as const },
      { category: "fournitures", montantTva: 100 },
    ];
    const brut = registre.reduce((s, d) => s + d.montantTva, 0);
    const { total } = totalDeductible(registre);
    expect(brut).toBe(300);
    expect(total).toBe(180);
  });

  it("compte les lignes qui demandent une confirmation", () => {
    const { aConfirmer } = totalDeductible([
      { category: "carburant", montantTva: 100 },
      { category: "fournitures", montantTva: 100 },
      { category: "repas", montantTva: 100 },
    ]);
    expect(aConfirmer).toBe(2);
  });

  it("un registre vide rend zero, pas NaN", () => {
    expect(totalDeductible([])).toEqual({ total: 0, aConfirmer: 0 });
  });

  it("le total est arrondi au centime", () => {
    const { total } = totalDeductible([
      { category: "carburant", montantTva: 33.33, natureVehicule: "tourisme" as const },
      { category: "carburant", montantTva: 33.33, natureVehicule: "tourisme" as const },
    ]);
    expect(total).toBe(53.32);
  });
});

describe("le calcul est branche sur le registre des depenses", () => {
  it("la route expose la deductibilite ligne par ligne", async () => {
    // Un module de calcul que rien n'appelle ne protege personne: c'est le
    // mode de panne recurrent de ce depot, documente dans `retention-cron.ts`
    // (« du code redige, jamais branche »).
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "depenses.ts"), "utf8");
    expect(source).toContain("tva-deductible");
    expect(source).toContain("tvaDeductible: deductibiliteTva(");
  });

  it("le total recuperable accompagne le registre", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "depenses.ts"), "utf8");
    expect(source).toContain("tvaDeductibleTotal");
    expect(source).toContain("tvaDeductibleAConfirmer");
  });

  it("rien n'est ecrit en base : c'est une lecture", async () => {
    // Persister une fraction figerait une regle fiscale qui change, et
    // ferait diverger les lignes anciennes des nouvelles.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "depenses.ts"), "utf8");
    const i = source.indexOf("const avecDeduction");
    const bloc = source.slice(i, i + 800);
    expect(bloc).not.toContain("db.update");
    expect(bloc).not.toContain("db.insert");
  });
});
