/**
 * Les factures que la plateforme emet a ses propres clients.
 *
 * Elles n'en etaient pas. Aucun numero, aucune date d'emission, aucune TVA,
 * aucune identite d'acheteur: une periode, un plan, un montant. L'editeur d'un
 * logiciel de facturation emettait des documents que ce meme logiciel
 * refuserait — et le client qui les recevait ne pouvait ni deduire la TVA ni
 * les produire lors d'un controle.
 *
 * Trois exigences sont verrouillees ici:
 *
 *   - la SEQUENCE. L'article 242 nonies A de l'annexe II au CGI impose un
 *     numero « base sur une sequence chronologique continue, sans rupture ».
 *     D'ou le point le plus delicat: un brouillon ne prend pas de numero, sans
 *     quoi son abandon ouvrirait un trou.
 *   - la TVA. Les CGV annoncent des prix « hors taxes » et une TVA qui « s'y
 *     ajoute ». Le total affiche n'etait donc pas la somme due.
 *   - l'IDENTITE DE L'ACHETEUR, figee a l'emission. La lire a l'affichage
 *     donnerait le nom d'aujourd'hui: changer de raison sociale reecrirait
 *     dix ans de factures.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, invoicesTable, organisationsTable } from "@workspace/db";

import {
  emettreFacturePlateforme,
  nextPlatformInvoiceNumber,
  TAUX_TVA,
} from "../services/platform-invoice-issue";

const stamp = Date.now();
const orgs: number[] = [];

async function creerOrg(tag: string, nom: string) {
  const [org] = await db.insert(organisationsTable).values({
    name: nom,
    slug: `fact-${tag}-${stamp}`,
    address: "12 rue des Lilas, 67500 Haguenau",
    siret: "12345678900012",
    tvaNumber: "FR12345678900",
    maxUsers: 5,
    actif: true,
  }).returning({ id: organisationsTable.id });
  orgs.push(org.id);
  return org.id;
}

async function creerFacture(orgId: number, montantHt: string, statut: string) {
  const [f] = await db.insert(invoicesTable).values({
    organisationId: orgId,
    periodLabel: `2026-0${(orgs.length % 9) + 1}`,
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-02-01"),
    plan: "professionnel",
    baseAmount: montantHt,
    overageAmount: "0",
    totalAmount: montantHt,
    status: statut,
  }).returning({ id: invoicesTable.id });
  return f.id;
}

async function lire(id: number) {
  const [f] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  return f;
}

let orgId = 0;

beforeAll(async () => {
  orgId = await creerOrg("a", `Client Facture ${stamp}`);
});

afterAll(async () => {
  try {
    for (const id of orgs) {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, id));
    }
  } catch {
    // Menage « au mieux »: les identifiants portent l'horodatage du run.
  }
});

describe("emission d'une facture de la plateforme", () => {
  it("attribue un numero lisible et sequentiel", async () => {
    const a = await creerFacture(orgId, "79.00", "en_attente");
    const b = await creerFacture(orgId, "29.00", "en_attente");

    const ra = await emettreFacturePlateforme(a);
    const rb = await emettreFacturePlateforme(b);

    const annee = new Date().getFullYear();
    expect(ra.reference).toMatch(new RegExp(`^FAC-${annee}-\\d{6}$`));

    // Continuite: le second numero suit immediatement le premier. C'est
    // l'exigence du CGI, et la seule qu'un identifiant aleatoire ne remplit pas.
    const na = Number(ra.reference.split("-")[2]);
    const nb = Number(rb.reference.split("-")[2]);
    expect(nb).toBe(na + 1);
  });

  it("calcule la TVA et le total reellement du", async () => {
    const id = await creerFacture(orgId, "79.00", "en_attente");
    await emettreFacturePlateforme(id);
    const f = await lire(id);

    expect(Number(f.vatRate)).toBe(TAUX_TVA);
    expect(Number(f.vatAmount)).toBeCloseTo(79 * TAUX_TVA / 100, 2);
    expect(Number(f.totalTtc)).toBeCloseTo(79 + 79 * TAUX_TVA / 100, 2);
    // Le HT n'est pas reecrit: c'est ce que la colonne a toujours contenu.
    expect(Number(f.totalAmount)).toBe(79);
  });

  it("date l'emission", async () => {
    const id = await creerFacture(orgId, "29.00", "en_attente");
    await emettreFacturePlateforme(id);
    const f = await lire(id);
    expect(f.issuedAt, "une facture sans date d'emission n'est pas opposable").toBeTruthy();
  });

  it("fige l'identite de l'acheteur", async () => {
    const nomInitial = `Client Renomme ${stamp}`;
    const autreOrg = await creerOrg("renomme", nomInitial);
    const id = await creerFacture(autreOrg, "29.00", "en_attente");
    await emettreFacturePlateforme(id);

    // Le client change de raison sociale APRES l'emission.
    await db.update(organisationsTable)
      .set({ name: `Nouvelle Raison ${stamp}` })
      .where(eq(organisationsTable.id, autreOrg));

    const f = await lire(id);
    expect(f.buyerSnapshot?.name, "la facture emise doit garder le nom de l'epoque").toBe(nomInitial);
    expect(f.buyerSnapshot?.siret).toBe("12345678900012");
    expect(f.buyerSnapshot?.tvaNumber).toBe("FR12345678900");
  });

  it("n'attribue pas deux fois un numero a la meme facture", async () => {
    // Un cron qui repasse, un double clic sur « valider », une reprise apres
    // erreur: aucun ne doit consommer un second numero, ce qui creerait un
    // trou dans la sequence.
    const id = await creerFacture(orgId, "29.00", "en_attente");
    const premier = await emettreFacturePlateforme(id);
    const second = await emettreFacturePlateforme(id);
    expect(second.reference).toBe(premier.reference);
  });

  it("ne consomme pas de numero pour un brouillon", async () => {
    // Le point le plus delicat de toute la numerotation: un brouillon
    // abandonne qui aurait pris un numero laisserait une rupture que rien ne
    // peut combler apres coup.
    const brouillon = await creerFacture(orgId, "29.00", "brouillon");
    const f = await lire(brouillon);
    expect(f.reference).toBeNull();
    expect(f.issuedAt).toBeNull();

    const avant = await nextPlatformInvoiceNumber(db, 2099);
    const apres = await nextPlatformInvoiceNumber(db, 2099);
    expect(Number(apres.split("-")[2])).toBe(Number(avant.split("-")[2]) + 1);
  });

  it("refuse deux factures portant le meme numero", async () => {
    // Garde-fou en base: meme si le code qui numerote regressait, la
    // contrainte tiendrait. Une sequence garantie par le seul code applicatif
    // n'est pas une garantie.
    const a = await creerFacture(orgId, "29.00", "en_attente");
    const b = await creerFacture(orgId, "29.00", "en_attente");
    const ra = await emettreFacturePlateforme(a);

    await expect(
      db.update(invoicesTable).set({ reference: ra.reference }).where(eq(invoicesTable.id, b)),
    ).rejects.toThrow();
  });
});
