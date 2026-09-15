/**
 * Le radar de tresorerie: ce qu'il affiche doit venir des vraies factures.
 *
 * Ce moteur dit a un patron de BTP s'il risque de manquer de caisse dans les
 * 90 jours. C'est la chose la plus consequente que le produit affirme: sur
 * cette probabilite, quelqu'un decide d'echelonner un paiement de
 * sous-traitant, ou de ne pas le faire. Il n'avait aucun test.
 *
 * Les tests ci-dessous ne verifient pas « Monte Carlo est correct » — une
 * simulation aleatoire ne se verifie pas par egalite. Ils verrouillent les
 * proprietes que le patron croit vraies en lisant l'ecran, et qui, si elles
 * cassent, cassent en silence:
 *
 *   1. Sans trésorerie saisie, AUCUNE probabilite n'est fabriquee.
 *   2. Une caisse a zero est une valeur, pas une absence de configuration.
 *   3. Les factures deja payees, annulees ou en brouillon ne comptent pas.
 *   4. En autoliquidation, on encaisse le HT — pas le TTC.
 *   5. Les depenses approuvees et non payees sortent de la caisse.
 *   6. Un creux INTERMEDIAIRE compte, meme si le solde final est positif.
 *
 * La sixieme est la plus facile a perdre: il suffit de remplacer la detection
 * « passe sous zero un jour quelconque » par un test sur le solde terminal
 * pour que le moteur devienne rassurant et faux. Le decouvert, lui, arrive
 * quand meme — a la banque, pas a l'ecran.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  depensesTable,
  facturesClientTable,
  organisationsTable,
  treasurySettingsTable,
} from "@workspace/db";

import {
  analyzeTreasuryRisk,
  CASH_CRUNCH_THRESHOLD,
} from "../services/treasury-risk";

const marque = Date.now();
const orgsCreees: number[] = [];
const JOUR = 24 * 60 * 60 * 1000;

async function creerOrg(tag: string): Promise<number> {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `Tresorerie ${tag} ${marque}`,
      slug: `tresorerie-${tag}-${marque}`,
      email: `tresorerie-${tag}-${marque}@example.test`,
      phone: "+33123456789",
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgsCreees.push(org.id);
  return org.id;
}

async function reglerTresorerie(
  orgId: number,
  caisse: number,
  chargesMensuelles: number,
  autoliquidation = false,
): Promise<void> {
  await db.insert(treasurySettingsTable).values({
    organisationId: orgId,
    currentCash: String(caisse),
    monthlyFixedCosts: String(chargesMensuelles),
    defaultAutoliquidation: autoliquidation,
  });
}

let compteurFacture = 0;
async function creerFacture(
  orgId: number,
  opts: {
    total: number;
    paye?: number;
    ht?: number;
    statut?: string;
    echeanceDansJours?: number | null;
    autoliquidation?: boolean;
  },
): Promise<number> {
  compteurFacture += 1;
  const total = opts.total;
  const ht = opts.ht ?? total;
  const [f] = await db
    .insert(facturesClientTable)
    .values({
      organisationId: orgId,
      reference: `FA-T-${marque}-${compteurFacture}`,
      title: "Chantier de test",
      clientName: "Client de test",
      subtotal: String(ht),
      taxAmount: String(total - ht),
      totalAmount: String(total),
      paidAmount: String(opts.paye ?? 0),
      status: opts.statut ?? "envoyee",
      isAutoliquidation: opts.autoliquidation ?? false,
      dueDate:
        opts.echeanceDansJours === null || opts.echeanceDansJours === undefined
          ? null
          : new Date(Date.now() + opts.echeanceDansJours * JOUR),
    })
    .returning({ id: facturesClientTable.id });
  return f.id;
}

async function creerDepense(
  orgId: number,
  opts: {
    ttc: number;
    statut?: string;
    paiement?: string;
    echeanceDansJours?: number;
  },
): Promise<void> {
  await db.insert(depensesTable).values({
    organisationId: orgId,
    vendor: "Fournisseur de test",
    amountTtc: String(opts.ttc),
    status: opts.statut ?? "approuve",
    paymentStatus: opts.paiement ?? "a_payer",
    expenseDate: new Date(),
    dueDate: new Date(Date.now() + (opts.echeanceDansJours ?? 10) * JOUR),
  });
}

/** Simulations reduites: ces tests portent sur des proprietes, pas sur la precision. */
const RAPIDE = { simulations: 400 };

afterAll(async () => {
  for (const id of orgsCreees) {
    try {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, id));
    } catch {
      // Le nettoyage ne doit jamais faire echouer la suite.
    }
  }
});

describe("une organisation qui n'a pas saisi sa tresorerie", () => {
  let orgId: number;
  let resultat: Awaited<ReturnType<typeof analyzeTreasuryRisk>>;

  beforeAll(async () => {
    orgId = await creerOrg("non-configuree");
    await creerFacture(orgId, { total: 12000, echeanceDansJours: -30 });
    resultat = await analyzeTreasuryRisk(orgId, RAPIDE);
  });

  it("est signalee comme non configuree", () => {
    expect(resultat.configured).toBe(false);
  });

  it("ne recoit aucune probabilite fabriquee", () => {
    // Sans caisse ni charges, toute probabilite serait une invention. Le
    // produit prefere ne rien dire plutot que de dire un chiffre faux.
    expect(resultat.simulation.runs).toBe(0);
    expect(resultat.simulation.insolvencyProbability).toBe(0);
    expect(resultat.alert).toBe(false);
    expect(resultat.recommendation).toBeNull();
  });

  it("montre quand meme les vraies factures en retard", () => {
    // Ce qui est mesure existe: l'absence de reglage n'efface pas les impayes.
    expect(resultat.overdueCount).toBe(1);
    expect(resultat.overdueTotal).toBeCloseTo(12000, 2);
  });
});

describe("une caisse a zero", () => {
  it("compte comme une tresorerie saisie, pas comme une absence", async () => {
    // La ligne treasury_settings n'existe que si le patron l'a remplie. Une
    // caisse vide est precisement le cas ou l'alerte sert le plus; la traiter
    // comme « non configure » eteindrait le radar de ceux qui en ont besoin.
    const orgId = await creerOrg("caisse-vide");
    await reglerTresorerie(orgId, 0, 3000);
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.configured).toBe(true);
    expect(r.simulation.runs).toBeGreaterThan(0);
  });
});

describe("le tri des factures encaissables", () => {
  let orgId: number;
  let r: Awaited<ReturnType<typeof analyzeTreasuryRisk>>;

  beforeAll(async () => {
    orgId = await creerOrg("statuts");
    await reglerTresorerie(orgId, 50000, 1000);
    // Encaissables:
    await creerFacture(orgId, { total: 1000, statut: "envoyee", echeanceDansJours: 20 });
    await creerFacture(orgId, { total: 2000, statut: "en_retard", echeanceDansJours: -10 });
    await creerFacture(orgId, {
      total: 3000,
      paye: 1200,
      statut: "partiellement_payee",
      echeanceDansJours: 15,
    });
    // Non encaissables:
    await creerFacture(orgId, { total: 9000, statut: "brouillon", echeanceDansJours: 20 });
    await creerFacture(orgId, { total: 9000, statut: "payee", echeanceDansJours: 20 });
    await creerFacture(orgId, { total: 9000, statut: "annulee", echeanceDansJours: 20 });
    r = await analyzeTreasuryRisk(orgId, RAPIDE);
  });

  it("ne retient que les trois factures reellement encaissables", () => {
    expect(r.pendingCount).toBe(3);
  });

  it("compte le reste a payer, pas le montant emis", () => {
    // 1000 + 2000 + (3000 - 1200) = 4800. Compter 6000 surestimerait la
    // rentree de 1 200 EUR deja encaisses.
    expect(r.pendingTotal).toBeCloseTo(4800, 2);
  });

  it("n'inclut aucun brouillon, paiement solde ou annulation", () => {
    // 9 000 x 3 = 27 000 EUR qui n'arriveront jamais.
    expect(r.pendingTotal).toBeLessThan(9000);
  });

  it("ne declare en retard que ce qui a une echeance depassee", () => {
    expect(r.overdueCount).toBe(1);
    expect(r.overdue[0].remaining).toBeCloseTo(2000, 2);
    expect(r.overdue[0].daysOverdue).toBeGreaterThanOrEqual(9);
  });
});

describe("une facture sans echeance", () => {
  it("n'est pas declaree en retard", async () => {
    // Sans date, le moteur applique un terme par defaut. La compter en retard
    // ferait apparaitre des impayes qui n'existent pas, et declencherait des
    // relances vers des clients a jour.
    const orgId = await creerOrg("sans-echeance");
    await reglerTresorerie(orgId, 10000, 500);
    await creerFacture(orgId, { total: 5000, echeanceDansJours: null });
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.pendingCount).toBe(1);
    expect(r.overdueCount).toBe(0);
  });
});

describe("les factures en retard sont classees par anciennete", () => {
  it("la plus ancienne vient en premier", async () => {
    // L'ecran n'en montre qu'une poignee: si l'ordre se perd, le patron relance
    // l'impaye de la semaine derniere et laisse dormir celui de six mois.
    const orgId = await creerOrg("ordre-retards");
    await reglerTresorerie(orgId, 10000, 500);
    await creerFacture(orgId, { total: 100, echeanceDansJours: -5 });
    await creerFacture(orgId, { total: 200, echeanceDansJours: -120 });
    await creerFacture(orgId, { total: 300, echeanceDansJours: -40 });
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.overdue.map((o) => o.remaining)).toEqual([200, 300, 100]);
  });
});

describe("l'autoliquidation de TVA", () => {
  it("n'encaisse que la part HT", async () => {
    // En sous-traitance BTP, le client paie la TVA a l'Etat, pas au
    // sous-traitant. Simuler l'encaissement du TTC gonfle la tresorerie de
    // 20 % et eteint une alerte justifiee.
    const orgId = await creerOrg("autoliquidation");
    await reglerTresorerie(orgId, 1000, 0);
    await creerFacture(orgId, {
      total: 12000,
      ht: 10000,
      autoliquidation: true,
      echeanceDansJours: 10,
    });
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.pendingTotal).toBeCloseTo(12000, 2); // du au titre de la facture
    expect(r.expectedCollectible).toBeCloseTo(10000, 2); // reellement encaisse
  });

  it("encaisse le TTC quand elle ne s'applique pas", async () => {
    const orgId = await creerOrg("sans-autoliquidation");
    await reglerTresorerie(orgId, 1000, 0);
    await creerFacture(orgId, { total: 12000, ht: 10000, echeanceDansJours: 10 });
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.expectedCollectible).toBeCloseTo(12000, 2);
  });
});

describe("les depenses approuvees et non payees", () => {
  it("sont comptees comme des sorties certaines", async () => {
    const orgId = await creerOrg("depenses");
    await reglerTresorerie(orgId, 20000, 0);
    await creerDepense(orgId, { ttc: 4000 });
    await creerDepense(orgId, { ttc: 1500 });
    // Ni approuvee, ni a payer: aucune des deux ne doit compter.
    await creerDepense(orgId, { ttc: 9999, statut: "en_attente" });
    await creerDepense(orgId, { ttc: 8888, paiement: "paye" });
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.expensesPayableCount).toBe(2);
    expect(r.expensesPayableTotal).toBeCloseTo(5500, 2);
  });

  it("font basculer le risque quand elles vident la caisse", async () => {
    // Meme caisse, meme absence de rentrees: la seule difference est une
    // depense approuvee superieure au solde.
    const sans = await creerOrg("depense-sans");
    await reglerTresorerie(sans, 10000, 0);
    const avec = await creerOrg("depense-avec");
    await reglerTresorerie(avec, 10000, 0);
    await creerDepense(avec, { ttc: 15000, echeanceDansJours: 20 });

    const rSans = await analyzeTreasuryRisk(sans, RAPIDE);
    const rAvec = await analyzeTreasuryRisk(avec, RAPIDE);
    expect(rSans.simulation.insolvencyProbability).toBe(0);
    expect(rAvec.simulation.insolvencyProbability).toBe(1);
    expect(rAvec.alert).toBe(true);
  });
});

describe("un creux de tresorerie au milieu de l'horizon", () => {
  it("compte, meme si le solde final est repasse au vert", async () => {
    // C'est la propriete la plus fragile du moteur. Scenario: la caisse est
    // videe par une depense au jour 10, et une grosse facture rentre bien plus
    // tard. Au jour 90 tout va bien; au jour 10 le compte est a decouvert.
    //
    // Un moteur qui ne regarderait que le solde terminal annoncerait 0 % de
    // risque sur exactement cette situation — celle que la banque facture.
    const orgId = await creerOrg("creux-intermediaire");
    await reglerTresorerie(orgId, 5000, 0);
    await creerDepense(orgId, { ttc: 20000, echeanceDansJours: 10 });
    await creerFacture(orgId, { total: 60000, echeanceDansJours: 60 });

    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.simulation.insolvencyProbability).toBe(1);
    expect(r.alert).toBe(true);
    // Le solde terminal est bel et bien positif: c'est ce qui rend le piege
    // credible.
    expect(r.simulation.projectedMedian).toBeGreaterThan(0);
  });
});

describe("le seuil d'alerte", () => {
  it("ne se declenche pas sous le seuil", async () => {
    const orgId = await creerOrg("seuil-bas");
    await reglerTresorerie(orgId, 100000, 100);
    await creerFacture(orgId, { total: 1000, echeanceDansJours: 10 });
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.simulation.insolvencyProbability).toBeLessThanOrEqual(CASH_CRUNCH_THRESHOLD);
    expect(r.alert).toBe(false);
  });

  it("porte une recommandation des que l'alerte est levee", async () => {
    // Une alerte sans conduite a tenir laisse le patron devant un pourcentage.
    const orgId = await creerOrg("seuil-haut");
    await reglerTresorerie(orgId, 0, 30000);
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.alert).toBe(true);
    expect(r.recommendation).toBeTruthy();
    expect(r.recommendation!.length).toBeGreaterThan(40);
  });
});

describe("le nombre de simulations", () => {
  it("est borne, meme si l'appelant demande l'absurde", async () => {
    // Ce moteur tourne dans un cron, pour toutes les organisations. Un appel
    // a un million de tirages n'echouerait pas: il tiendrait la boucle.
    const orgId = await creerOrg("bornes");
    await reglerTresorerie(orgId, 1000, 100);
    const trop = await analyzeTreasuryRisk(orgId, { simulations: 10_000_000 });
    expect(trop.simulation.runs).toBeLessThanOrEqual(20000);
    const pasAssez = await analyzeTreasuryRisk(orgId, { simulations: 1 });
    expect(pasAssez.simulation.runs).toBeGreaterThanOrEqual(100);
  });

  it("l'horizon annonce est bien celui qui est simule", async () => {
    const orgId = await creerOrg("horizon");
    await reglerTresorerie(orgId, 1000, 100);
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.horizonDays).toBe(90);
  });
});

describe("l'etancheite entre organisations", () => {
  it("les factures d'une autre organisation n'entrent pas dans le calcul", async () => {
    // Une fuite ici ferait apparaitre, chez un client, les impayes d'un autre.
    const a = await creerOrg("etanche-a");
    const b = await creerOrg("etanche-b");
    await reglerTresorerie(a, 1000, 0);
    await reglerTresorerie(b, 1000, 0);
    await creerFacture(b, { total: 77000, echeanceDansJours: 5 });
    await creerDepense(b, { ttc: 66000 });

    const r = await analyzeTreasuryRisk(a, RAPIDE);
    expect(r.pendingCount).toBe(0);
    expect(r.pendingTotal).toBe(0);
    expect(r.expensesPayableCount).toBe(0);
  });
});
