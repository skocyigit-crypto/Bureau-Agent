/**
 * Deux biais qui poussaient la prevision de tresorerie du bon cote.
 *
 * Ce module estime une PROBABILITE DE RUPTURE DE TRESORERIE sur 90 jours par
 * simulation de Monte-Carlo. Un modele de risque qui se trompe dans le sens
 * rassurant ne se signale jamais de lui-meme : il rend simplement des chiffres
 * calmes, jusqu'au jour ou la rupture arrive quand meme.
 *
 * PREMIER BIAIS — LA LOI DES RETARDS N'AVAIT PAS DE QUEUE
 *
 * Le retard etait tire d'une loi normale N(12, 5). Calcul du 16/09 :
 *
 *     P(retard > 30 j) = 0,016 %      P(retard > 45 j) = 0,000 %
 *
 * Autrement dit, le modele declarait quasiment impossible le seul evenement
 * qu'il existe pour anticiper. La meme loi tirait par ailleurs des retards
 * NEGATIFS dans 0,82 % des cas, que `if (day < 0) day = 0` ecretait en
 * silence — ce qui deplacait la moyenne effective sans que personne ne l'ait
 * decide.
 *
 * La lognormale est bornee a zero et asymetrique a droite, ce qu'est un delai
 * de paiement. A MOYENNE ET ECART-TYPE IDENTIQUES, P(retard > 30 j) passe a
 * 0,64 % : quarante fois plus de queue, sans qu'aucun parametre annonce ne
 * change.
 *
 * On ne calibre volontairement pas sur les chiffres sectoriels 2026, qui se
 * contredisent : Altares situe le retard moyen du batiment a 8 jours, d'autres
 * publications annoncent 47 % de factures reglees a plus de 30 jours de
 * retard. Les deux sont incompatibles — 47 % au-dela de 30 jours imposerait
 * une moyenne d'au moins 14 jours. On corrige la FAMILLE de loi, defendable
 * independamment; la calibration reste a l'exploitant via les variables
 * d'environnement.
 *
 * SECOND BIAIS — LA TVA ETAIT COMPTEE COMME DE LA TRESORERIE
 *
 * Une facture encaissee TTC entrait en entier dans le solde, et rien ne la
 * faisait ressortir. Or la TVA collectee appartient au Tresor et en repart le
 * mois suivant. Sur une activite au taux normal, c'etait un cinquieme de
 * chaque encaissement compte comme disponible alors qu'il ne l'etait pas.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(import.meta.dirname, "..", "services", "treasury-risk.ts"),
  "utf8",
);

/** Fonction de repartition de la loi normale centree reduite. */
function Phi(z: number): number {
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((a[4]! * t + a[3]!) * t + a[2]!) * t + a[1]!) * t + a[0]!) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

/** Parametres de la lognormale de moyenne `m` et d'ecart-type `sd`. */
function logParams(m: number, sd: number) {
  const sigma2 = Math.log(1 + (sd * sd) / (m * m));
  return { mu: Math.log(m) - sigma2 / 2, sigma: Math.sqrt(sigma2) };
}
const pLognormaleAuDela = (j: number, m = 12, sd = 5) => {
  const { mu, sigma } = logParams(m, sd);
  return 1 - Phi((Math.log(j) - mu) / sigma);
};
const pNormaleAuDela = (j: number, m = 12, sd = 5) => 1 - Phi((j - m) / sd);

describe("la loi des retards a desormais une queue", () => {
  it("la loi normale rendait un retard de 30 jours quasi impossible", () => {
    // Le chiffre du defaut, conserve ici pour que la correction reste
    // comparable a ce qu'elle remplace.
    expect(pNormaleAuDela(30)).toBeLessThan(0.0005);
  });

  it("la lognormale donne au moins trente fois plus de poids a ce meme cas", () => {
    // Le coeur de la correction, exprime en rapport plutot qu'en valeur
    // absolue: c'est l'ordre de grandeur qui etait faux.
    expect(pLognormaleAuDela(30) / pNormaleAuDela(30)).toBeGreaterThan(30);
  });

  it("un retard de 45 jours cesse d'etre traite comme impossible", () => {
    expect(pNormaleAuDela(45)).toBeLessThan(1e-6);
    expect(pLognormaleAuDela(45)).toBeGreaterThan(1e-4);
  });

  it("la moyenne annoncee est conservee", () => {
    // La correction ne doit pas changer le chiffre calibre sur les donnees
    // publiques: seule la FORME change.
    const { mu, sigma } = logParams(12, 5);
    const moyenne = Math.exp(mu + (sigma * sigma) / 2);
    expect(moyenne).toBeCloseTo(12, 6);
  });

  it("l'ecart-type annonce est conserve lui aussi", () => {
    const { mu, sigma } = logParams(12, 5);
    const variance = (Math.exp(sigma * sigma) - 1) * Math.exp(2 * mu + sigma * sigma);
    expect(Math.sqrt(variance)).toBeCloseTo(5, 6);
  });

  it("aucun retard negatif ne peut plus etre tire", () => {
    // La loi normale en produisait 0,82 %, ecretes en silence par
    // `if (day < 0) day = 0`, ce qui biaisait la moyenne vers le haut.
    expect(pNormaleAuDela(0)).toBeLessThan(1);
    expect(1 - pNormaleAuDela(0)).toBeGreaterThan(0.005);
    // La lognormale est strictement positive par construction.
    const { mu, sigma } = logParams(12, 5);
    for (const z of [-6, -3, 0, 3, 6]) {
      expect(Math.exp(mu + sigma * z)).toBeGreaterThan(0);
    }
  });

  it("augmenter l'ecart-type epaissit bien la queue", () => {
    // La propriete qui rend le reglage utile a l'exploitant: sans elle, les
    // variables d'environnement ne serviraient a rien.
    expect(pLognormaleAuDela(30, 12, 10)).toBeGreaterThan(pLognormaleAuDela(30, 12, 5));
  });

  it("le code utilise bien une lognormale, et plus une normale", () => {
    // Garde statique: la propriete se demontre mathematiquement ci-dessus,
    // mais rien ne garantirait que le module l'emploie.
    expect(SOURCE).toContain("sampleDelayDays");
    expect(SOURCE).toContain("Math.exp(mu + sigma * z)");
    expect(/sampleNormal\(DELAY_MEAN/.test(SOURCE), "l'ancien tirage normal est revenu").toBe(false);
  });
});

describe("la TVA ressort de la tresorerie", () => {
  it("la part de TVA est calculee sur chaque facture", () => {
    expect(SOURCE).toContain("vatCollected");
    expect(SOURCE).toContain("taxAmount");
  });

  it("elle est retiree du solde apres l'encaissement, pas avant", () => {
    // L'ordre compte: la TVA entre avec le reglement et ne repart qu'ensuite.
    // La retirer au meme instant ferait disparaitre le repit reel dont
    // l'entreprise dispose entre les deux.
    expect(SOURCE).toContain("const jourTva = day + delaiTva;");
    const i = SOURCE.indexOf("const jourTva = day + delaiTva;");
    const bloc = SOURCE.slice(i, i + 200);
    expect(bloc).toContain("-= inv.vatCollected");
  });

  it("le delai de reversement est parametrable", () => {
    expect(SOURCE).toContain("TREASURY_VAT_REMITTANCE_DAYS");
  });

  it("le delai par defaut correspond a une CA3 mensuelle", () => {
    // Paiement entre le 15 et le 24 du mois suivant: de ~20 a ~50 jours
    // apres l'encaissement selon la date dans le mois.
    const defaut = /TREASURY_VAT_REMITTANCE_DAYS \?\? (\d+)/.exec(SOURCE);
    expect(defaut).toBeTruthy();
    const jours = Number(defaut![1]);
    expect(jours).toBeGreaterThanOrEqual(20);
    expect(jours).toBeLessThanOrEqual(50);
  });

  it("aucune TVA n'est reversee en autoliquidation", () => {
    // En autoliquidation, aucune TVA n'est facturee: en faire sortir une
    // creerait une dette imaginaire et rendrait le modele pessimiste a tort.
    expect(SOURCE).toContain("const vatCollected = autoliq ? 0 : remaining * vatRatio;");
  });

  it("la part de TVA est bornee entre 0 et 1", () => {
    // Des totaux incoherents en base — une facture dont la TVA depasse le
    // TTC — feraient sinon sortir plus d'argent qu'il n'en est entre.
    expect(SOURCE).toContain("Math.max(0, Math.min(1, taxAmount / total))");
  });

  it("une facture de total nul ne produit aucune TVA", () => {
    // Division par zero: le ratio doit valoir 0, pas NaN, sans quoi tout le
    // solde simule devient NaN et la probabilite de rupture aussi.
    expect(SOURCE).toContain("total > 0 ? Math.max(0, Math.min(1, taxAmount / total)) : 0");
  });
});

describe("ce qui reste a faire est nomme", () => {
  it("la retenue de garantie n'est toujours pas modelisee", () => {
    // Troisieme biais mesure, et le seul qui demande une colonne en base: en
    // BTP, 5 % de chaque facture sont retenus douze mois. Le modele compte
    // donc 5 % d'encaissements qui n'arriveront pas dans l'horizon.
    //
    // Ce test ECHOUERA quand la fonctionnalite sera ajoutee. C'est voulu: il
    // force a revenir ici plutot qu'a laisser le commentaire mentir.
    expect(/retenueGarantie|retenue_garantie|holdback/i.test(SOURCE)).toBe(false);
  });
});
