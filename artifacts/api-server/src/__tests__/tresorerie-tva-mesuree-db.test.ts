process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  facturesClientTable,
  organisationsTable,
  treasurySettingsTable,
} from "@workspace/db";

import { analyzeTreasuryRisk } from "../services/treasury-risk";

/**
 * La TVA ressort VRAIMENT du solde — mesure, pas relue dans la source.
 *
 * Le fichier voisin (`tresorerie-biais-optimiste`) demontre les proprietes
 * mathematiques et verrouille la forme du code. Il ne peut pas dire si le
 * solde simule change reellement. C'est pourtant la seule chose qui compte:
 * un modele dont on a corrige le texte mais pas le resultat n'a pas bouge.
 *
 * LE MONTAGE
 *
 * Une organisation dont le solde projete depend visiblement du sort de la
 * TVA: si elle reste dans les comptes, le solde termine 12 000 EUR plus haut.
 * On compare donc des NIVEAUX (mediane, 5e percentile), robustes au tirage,
 * et non la probabilite de rupture, qui n'est pas decidee par la TVA dans ce
 * montage.
 *
 * On compare la MEME organisation a elle-meme, en deplacant seulement la date
 * de reversement. Aucune autre difference ne peut expliquer l'ecart.
 */

const JOUR = 24 * 60 * 60 * 1000;
const stamp = Date.now();
const orgsCreees: number[] = [];

/** Simulations reduites: ces tests portent sur une comparaison, pas sur une precision. */
const RAPIDE = { simulations: 600 };

async function creerOrg(suffixe: string): Promise<number> {
  const [o] = await db
    .insert(organisationsTable)
    .values({
      name: `Org TVA ${suffixe} ${stamp}`,
      slug: `tva-${suffixe}-${stamp}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgsCreees.push(o!.id);
  return o!.id;
}

async function configurer(orgId: number, caisse: number, chargesMensuelles: number): Promise<void> {
  await db.insert(treasurySettingsTable).values({
    organisationId: orgId,
    currentCash: String(caisse),
    monthlyFixedCosts: String(chargesMensuelles),
  } as never);
}

/** Facture au taux normal: TVA = 20 % du HT. */
async function creerFacture(
  orgId: number,
  ht: number,
  echeanceDansJours: number,
  autoliquidation = false,
): Promise<void> {
  const tva = Math.round(ht * 0.2 * 100) / 100;
  await db.insert(facturesClientTable).values({
    organisationId: orgId,
    reference: `F-TVA-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Travaux",
    clientName: "Client de test",
    subtotal: String(ht),
    taxAmount: String(autoliquidation ? 0 : tva),
    totalAmount: String(autoliquidation ? ht : ht + tva),
    paidAmount: "0",
    status: "envoyee",
    isAutoliquidation: autoliquidation,
    dueDate: new Date(Date.now() + echeanceDansJours * JOUR),
  } as never);
}

afterAll(async () => {
  for (const id of orgsCreees) {
    try {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, id));
    } catch {
      // Le nettoyage ne doit jamais faire echouer la suite.
    }
  }
});

describe("le reversement de TVA pese sur le solde simule", () => {
  let orgId = 0;

  beforeAll(async () => {
    orgId = await creerOrg("pesee");
    // Caisse modeste, charges fixes reelles, et une grosse facture encaissee
    // tot: sans sortie de TVA, l'entreprise parait confortable.
    await configurer(orgId, 8_000, 9_000);
    await creerFacture(orgId, 60_000, 5);
  });

  it("le solde median est plus BAS quand la TVA sort dans l'horizon", async () => {
    // LA MESURE. Meme organisation, meme facture, meme caisse: seule la date
    // de reversement change. L'ecart attendu est de l'ordre de la TVA de la
    // facture, soit 12 000 EUR.
    const sansSortie = await analyzeTreasuryRisk(orgId, { ...RAPIDE, vatRemittanceDays: 400 });
    const avecSortie = await analyzeTreasuryRisk(orgId, { ...RAPIDE, vatRemittanceDays: 35 });

    expect(avecSortie.simulation.projectedMedian).toBeLessThan(
      sansSortie.simulation.projectedMedian,
    );
  });

  it("l'ecart correspond a l'ordre de grandeur de la TVA facturee", async () => {
    // Un ecart de quelques euros signifierait que la TVA sort d'une facture
    // et pas de l'autre, ou qu'elle est comptee au mauvais taux.
    const sansSortie = await analyzeTreasuryRisk(orgId, { ...RAPIDE, vatRemittanceDays: 400 });
    const avecSortie = await analyzeTreasuryRisk(orgId, { ...RAPIDE, vatRemittanceDays: 35 });

    const ecart = sansSortie.simulation.projectedMedian - avecSortie.simulation.projectedMedian;
    expect(ecart).toBeGreaterThan(10_000);
    expect(ecart).toBeLessThan(14_000);
  });

  it("le bas de la distribution baisse lui aussi", async () => {
    // Le 5e percentile, et pas la probabilite de rupture.
    //
    // La premiere version de ce test comparait `insolvencyProbability` et
    // ECHOUAIT PAR INTERMITTENCE sans aucune mutation: dans ce montage, la
    // TVA sort au jour ~40, quand le solde est deja largement positif. Elle
    // ne change donc pas la solvabilite — seulement le niveau — et le test
    // oscillait autour de l'egalite au gre du tirage.
    //
    // C'est une lecon sur le montage, pas sur le modele: une assertion qui
    // depend du bruit de Monte-Carlo n'est pas une preuve, elle est une
    // loterie qui finit par etre desactivee.
    const sansSortie = await analyzeTreasuryRisk(orgId, { ...RAPIDE, vatRemittanceDays: 400 });
    const avecSortie = await analyzeTreasuryRisk(orgId, { ...RAPIDE, vatRemittanceDays: 35 });

    expect(avecSortie.simulation.projectedP5).toBeLessThan(sansSortie.simulation.projectedP5);
  });
});

describe("l'autoliquidation ne fait sortir aucune TVA", () => {
  let orgId = 0;

  beforeAll(async () => {
    orgId = await creerOrg("autoliq");
    await configurer(orgId, 8_000, 9_000);
    // Meme montant HT que le cas precedent, mais en autoliquidation: aucune
    // TVA n'est facturee, donc aucune ne peut etre reversee.
    await creerFacture(orgId, 60_000, 5, true);
  });

  it("deplacer la date de reversement ne change rien", async () => {
    // Si un euro de difference apparaissait, le modele ferait sortir une TVA
    // qui n'a jamais ete encaissee — une dette imaginaire, et un modele
    // pessimiste a tort.
    const a = await analyzeTreasuryRisk(orgId, { ...RAPIDE, vatRemittanceDays: 400 });
    const b = await analyzeTreasuryRisk(orgId, { ...RAPIDE, vatRemittanceDays: 35 });

    // Le tirage est aleatoire: on compare les esperances a une tolerance
    // large, tout en excluant l'ecart de 12 000 EUR du cas non autoliquide.
    expect(Math.abs(a.simulation.projectedMedian - b.simulation.projectedMedian)).toBeLessThan(3_000);
  });
});

describe("une facture autoliquidee dont la TVA est restee en base", () => {
  let orgId = 0;

  beforeAll(async () => {
    orgId = await creerOrg("incoherente");
    await configurer(orgId, 8_000, 9_000);
    // DONNEE INCOHERENTE, ET REALISTE: la facture porte le drapeau
    // d'autoliquidation mais un `taxAmount` non nul — ce qui arrive quand le
    // drapeau est active apres coup sans recalculer les totaux.
    //
    // C'est precisement le cas que le garde `autoliq ? 0 : ...` existe pour
    // couvrir. Sans lui, le modele ferait sortir une TVA qui n'a jamais ete
    // encaissee: une dette imaginaire de 12 000 EUR.
    await db.insert(facturesClientTable).values({
      organisationId: orgId,
      reference: `F-INCOH-${stamp}`,
      title: "Travaux sous-traites",
      clientName: "Client de test",
      subtotal: "60000",
      taxAmount: "12000",
      totalAmount: "72000",
      paidAmount: "0",
      status: "envoyee",
      isAutoliquidation: true,
      dueDate: new Date(Date.now() + 5 * JOUR),
    } as never);
  });

  it("aucune TVA n'en sort, malgre le montant present en base", async () => {
    const a = await analyzeTreasuryRisk(orgId, { ...RAPIDE, vatRemittanceDays: 400 });
    const b = await analyzeTreasuryRisk(orgId, { ...RAPIDE, vatRemittanceDays: 35 });
    expect(Math.abs(a.simulation.projectedMedian - b.simulation.projectedMedian)).toBeLessThan(3_000);
  });
});

describe("les proprietes qui doivent survivre a la correction", () => {
  let orgId = 0;

  beforeAll(async () => {
    orgId = await creerOrg("saines");
    await configurer(orgId, 200_000, 3_000);
    await creerFacture(orgId, 20_000, 10);
  });

  it("une organisation confortable reste sans alerte", async () => {
    // Garde-fou: un modele qu'on vient de rendre plus severe pourrait
    // declencher partout, et l'alerte cesserait d'etre lue.
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.configured).toBe(true);
    expect(r.alert).toBe(false);
    expect(r.simulation.insolvencyProbability).toBeLessThan(0.05);
  });

  it("le solde projete reste un nombre fini", async () => {
    // Une facture de total nul ou un ratio de TVA aberrant produirait des
    // NaN qui se propageraient a toute la simulation sans lever d'erreur.
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    for (const v of [
      r.simulation.projectedMedian,
      r.simulation.projectedP5,
      r.simulation.projectedP95,
      r.simulation.insolvencyProbability,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("la probabilite reste bornee entre 0 et 1", async () => {
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.simulation.insolvencyProbability).toBeGreaterThanOrEqual(0);
    expect(r.simulation.insolvencyProbability).toBeLessThanOrEqual(1);
  });

  it("les percentiles restent ordonnes", async () => {
    const r = await analyzeTreasuryRisk(orgId, RAPIDE);
    expect(r.simulation.projectedP5).toBeLessThanOrEqual(r.simulation.projectedMedian);
    expect(r.simulation.projectedMedian).toBeLessThanOrEqual(r.simulation.projectedP95);
  });
});
