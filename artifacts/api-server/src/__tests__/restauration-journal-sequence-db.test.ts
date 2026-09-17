process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, encaissementsTable, facturesClientTable, organisationsTable } from "@workspace/db";

import { RESTORABLE_TABLES, restaurerSequencesFactures, restoreMissingRows } from "../services/tenant-restore";
import { TENANT_TABLES } from "../services/tenant-backup";

/**
 * Une sauvegarde qu'on ne sait pas remettre en place n'est qu'un fichier.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * 83 tables sauvegardees, 25 restaurables. La plupart des 58 ecarts sont
 * justifies et documentes — authentification, facturation de la plateforme,
 * journaux append-only, telemetrie. Trois ne l'etaient pas, et le module de
 * SAUVEGARDE explique lui-meme pourquoi elles comptent :
 *
 *   « Le compteur de numerotation fait partie des donnees du client :
 *     restaurer ses factures sans sa sequence rouvrirait des numeros deja
 *     utilises. »
 *
 *   « Un journal qu'une restauration ne rendrait pas serait inalterable et
 *     perdu — ce qui ne vaut pas mieux qu'alterable. »
 *
 *   « Sans les clotures, le journal restaure ne pourrait plus prouver
 *     qu'aucune ecriture n'a disparu. »
 *
 * Les trois etaient sauvegardees et absentes des tables restaurables, tandis
 * que `factures_client` et `invoices`, elles, se restauraient. La regle etait
 * ecrite en toutes lettres d'un cote et contredite de l'autre — la forme exacte
 * du defaut que cet audit rencontre depuis le debut.
 *
 * CE QUE CELA PRODUISAIT
 *
 * Le client restaure apres une perte. Ses factures reviennent. Son compteur de
 * numerotation, non : la facture suivante reprend un numero deja attribue.
 * Deux pieces portent le meme numero, ce que l'article 242 nonies A interdit
 * et qu'un controle lit comme une sequence falsifiee. Son journal de
 * reglements, lui, ne revient pas du tout.
 */

const stamp = Date.now();
let org = 0;
const createdOrgs: number[] = [];
let numero = 0;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Org restauration ${stamp}`, slug: `restau-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  org = o!.id;
  createdOrgs.push(org);
});

afterAll(async () => {
  if (createdOrgs.length > 0) {
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, createdOrgs));
  }
});

async function creerFacture(): Promise<number> {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: org,
    reference: `F-RES-${stamp}-${++numero}`,
    title: "Travaux",
    clientName: "Client",
    items: [{ description: "T", quantity: 1, unitPrice: 100, taxRate: 20 }],
    subtotal: "100.00", taxAmount: "20.00", totalAmount: "120.00",
    status: "envoyee",
  } as never).returning({ id: facturesClientTable.id });
  return f!.id;
}

/** Une sauvegarde minimale au format attendu par le restaurateur. */
function sauvegarde(tables: Record<string, unknown[]>) {
  return { tables } as never;
}

describe("le perimetre de restauration couvre desormais le journal", () => {
  it("les encaissements sont restaurables", () => {
    expect(RESTORABLE_TABLES).toContain("encaissements");
  });

  it("les clotures comptables aussi", () => {
    // Sans elles, le journal restaure ne prouve plus qu'aucune ecriture n'a
    // disparu: la cloture est ce qui scelle une periode.
    expect(RESTORABLE_TABLES).toContain("clotures_comptables");
  });

  it("le journal vient APRES les factures qu'il reference", () => {
    // La restauration insere parents d'abord. Une ecriture dont la facture
    // manque encore echouerait seule.
    const iFactures = RESTORABLE_TABLES.indexOf("factures_client");
    const iEncaissements = RESTORABLE_TABLES.indexOf("encaissements");
    expect(iFactures).toBeGreaterThanOrEqual(0);
    expect(iEncaissements).toBeGreaterThan(iFactures);
  });

  it("les exclusions restent des exclusions", () => {
    // L'erreur symetrique compte: reinjecter un compte supprime ou un journal
    // append-only serait une faille, pas un service.
    for (const t of ["users", "api_keys", "subscriptions", "audit_logs", "ai_usage"]) {
      expect(RESTORABLE_TABLES as readonly string[], t).not.toContain(t);
    }
  });

  it("toute table restaurable est effectivement sauvegardee", () => {
    // Restaurer une table absente de la sauvegarde ne ferait jamais rien, et
    // l'apercu annoncerait une restauration qui n'aura pas lieu.
    for (const t of RESTORABLE_TABLES) {
      expect(TENANT_TABLES as readonly string[], t).toContain(t);
    }
  });
});

describe("le journal des reglements revient vraiment", () => {
  it("une ecriture effacee est reinseree avec son empreinte d'origine", async () => {
    // LA MESURE. Recalculer l'empreinte serait une falsification: la chaine
    // doit revenir a l'identique, sinon elle ne prouve plus rien.
    const factureId = await creerFacture();
    const ecriture = {
      id: 900_000 + (stamp % 10_000),
      organisation_id: org,
      numero: 1,
      facture_id: factureId,
      montant_centimes: 12_345,
      devise: "EUR",
      moyen: "virement",
      date_encaissement: new Date("2026-05-01T10:00:00Z").toISOString(),
      sens: "encaissement",
      empreinte_precedente: "graine-origine",
      empreinte: "empreinte-origine-a-preserver",
      created_at: new Date("2026-05-01T10:00:00Z").toISOString(),
    };

    const res = await restoreMissingRows(sauvegarde({ encaissements: [ecriture] }), org, {
      tables: ["encaissements"],
    });
    expect(res.restored, "l'ecriture n'a pas ete restauree").toBeGreaterThan(0);

    const [revenue] = await db.select()
      .from(encaissementsTable)
      .where(and(eq(encaissementsTable.organisationId, org), eq(encaissementsTable.numero, 1)));
    expect(revenue?.empreinte).toBe("empreinte-origine-a-preserver");
    expect(revenue?.empreintePrecedente).toBe("graine-origine");
    expect(Number(revenue?.montantCentimes)).toBe(12_345);
  });

  it("une ecriture deja presente n'est pas dupliquee", async () => {
    // La regle absolue du module: on n'ajoute que ce qui manque.
    const avant = await db.select({ n: sql<number>`count(*)::int` })
      .from(encaissementsTable).where(eq(encaissementsTable.organisationId, org));
    const [ligne] = await db.select().from(encaissementsTable)
      .where(eq(encaissementsTable.organisationId, org)).limit(1);
    if (!ligne) return;

    await restoreMissingRows(
      sauvegarde({ encaissements: [{ id: ligne.id, organisation_id: org, numero: ligne.numero, montant_centimes: 999, devise: "EUR", moyen: "virement", date_encaissement: new Date().toISOString(), sens: "encaissement", empreinte_precedente: "x", empreinte: "y" }] }),
      org,
      { tables: ["encaissements"] },
    );

    const apres = await db.select({ n: sql<number>`count(*)::int` })
      .from(encaissementsTable).where(eq(encaissementsTable.organisationId, org));
    expect(apres[0]!.n).toBe(avant[0]!.n);
  });

  it("le montant d'une ecriture existante n'est pas ecrase", async () => {
    // « La restauration n'AJOUTE que ce qui manque »: un client qui restaure
    // une sauvegarde d'hier ne doit rien perdre de ce qu'il a fait depuis.
    const [ligne] = await db.select().from(encaissementsTable)
      .where(and(eq(encaissementsTable.organisationId, org), eq(encaissementsTable.numero, 1)));
    expect(Number(ligne?.montantCentimes)).toBe(12_345);
  });
});

describe("le compteur de numerotation ne recule jamais", () => {
  async function lireCompteur(annee: number): Promise<number | null> {
    const res = await db.execute(sql`
      SELECT last_number FROM invoice_sequences
      WHERE organisation_id = ${org} AND year = ${annee}
    `);
    const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Array<{ last_number: number }>;
    return rows.length > 0 ? Number(rows[0]!.last_number) : null;
  }

  it("un compteur absent est cree a la valeur de la sauvegarde", async () => {
    const r = await restaurerSequencesFactures(
      sauvegarde({ invoice_sequences: [{ organisation_id: org, year: 2031, last_number: 42 }] }),
      org,
    );
    expect(r.avancees).toBe(1);
    expect(await lireCompteur(2031)).toBe(42);
  });

  it("un compteur EN RETARD est avance", async () => {
    // LE CAS QUE « inserer ce qui manque » NE COUVRAIT PAS. La ligne existe,
    // donc rien ne se passait, et la facture suivante reprenait un numero
    // deja attribue.
    await db.execute(sql`
      UPDATE invoice_sequences SET last_number = 7
      WHERE organisation_id = ${org} AND year = 2031
    `);
    expect(await lireCompteur(2031)).toBe(7);

    const r = await restaurerSequencesFactures(
      sauvegarde({ invoice_sequences: [{ organisation_id: org, year: 2031, last_number: 42 }] }),
      org,
    );
    expect(r.avancees).toBe(1);
    expect(await lireCompteur(2031), "le compteur n'a pas ete avance").toBe(42);
  });

  it("un compteur EN AVANCE n'est jamais abaisse", async () => {
    // Une sauvegarde plus ancienne que la base ne doit pas rouvrir des
    // numeros emis depuis. Un compteur qui recule est le probleme meme.
    await db.execute(sql`
      UPDATE invoice_sequences SET last_number = 100
      WHERE organisation_id = ${org} AND year = 2031
    `);
    const r = await restaurerSequencesFactures(
      sauvegarde({ invoice_sequences: [{ organisation_id: org, year: 2031, last_number: 42 }] }),
      org,
    );
    expect(r.avancees).toBe(0);
    expect(r.inchangees).toBe(1);
    expect(await lireCompteur(2031), "le compteur a recule").toBe(100);
  });

  it("une valeur egale ne compte pas comme une avancee", async () => {
    const r = await restaurerSequencesFactures(
      sauvegarde({ invoice_sequences: [{ organisation_id: org, year: 2031, last_number: 100 }] }),
      org,
    );
    expect(r.avancees).toBe(0);
  });

  it("une annee ou un compteur illisible est ignore, sans casser le reste", async () => {
    // Une sauvegarde ancienne peut porter des colonnes nulles. Elles ne
    // doivent pas interrompre la restauration des autres annees.
    const r = await restaurerSequencesFactures(
      sauvegarde({
        invoice_sequences: [
          { organisation_id: org, year: null, last_number: 5 },
          { organisation_id: org, year: 2032, last_number: "abc" },
          { organisation_id: org, year: 2033, last_number: 11 },
        ],
      }),
      org,
    );
    expect(r.avancees).toBe(1);
    expect(await lireCompteur(2033)).toBe(11);
  });

  it("une sauvegarde sans sequence ne fait rien", async () => {
    const r = await restaurerSequencesFactures(sauvegarde({}), org);
    expect(r).toEqual({ avancees: 0, inchangees: 0 });
  });

  it("le compteur d'une AUTRE organisation n'est pas touche", async () => {
    // La sauvegarde porte `organisation_id`, mais c'est l'organisation
    // APPELANTE qui fait foi: une sauvegarde d'un autre locataire ne doit pas
    // pouvoir ecrire chez lui.
    const [autre] = await db.insert(organisationsTable).values({
      name: `Org voisine ${stamp}`, slug: `restau-voisine-${stamp}`, maxUsers: 5, actif: true,
    }).returning({ id: organisationsTable.id });
    createdOrgs.push(autre!.id);

    await restaurerSequencesFactures(
      sauvegarde({ invoice_sequences: [{ organisation_id: autre!.id, year: 2031, last_number: 9999 }] }),
      org,
    );

    const res = await db.execute(sql`
      SELECT last_number FROM invoice_sequences
      WHERE organisation_id = ${autre!.id} AND year = 2031
    `);
    const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as unknown[];
    expect(rows.length, "une sauvegarde a ecrit chez un autre locataire").toBe(0);
  });
});

describe("la route enchaine les deux etapes dans le bon ordre", () => {
  it("le compteur est restaure APRES les factures", async () => {
    // Avancer le compteur puis echouer sur les factures laisserait un trou
    // dans la sequence — l'inverse exact du but.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "my-backups.ts"), "utf8");
    const iTables = source.indexOf("await restoreMissingRows(");
    const iSeq = source.indexOf("await restaurerSequencesFactures(");
    expect(iTables).toBeGreaterThan(0);
    expect(iSeq).toBeGreaterThan(iTables);
  });

  it("le resultat rend compte des deux", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "my-backups.ts"), "utf8");
    expect(source).toContain("res.json({ result, sequences })");
  });
});

describe("le compteur est protege deux fois, et c'est voulu", () => {
  it("GREATEST et la clause WHERE sont tous deux presents", async () => {
    // UNE MUTATION A SURVECU ET A REVELE CECI: retirer `GREATEST` ne faisait
    // tomber aucun test, parce que la clause `WHERE last_number < EXCLUDED`
    // suffit a elle seule. Et reciproquement.
    //
    // La protection est donc redondante. C'est une bonne chose — le compteur
    // qui recule est le defaut le plus couteux de ce module — mais une
    // redondance que rien ne verrouille finit par etre « simplifiee » par
    // quelqu'un qui la prend pour un doublon.
    //
    // Ce test rend la redondance deliberee plutot qu'accidentelle.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(import.meta.dirname, "..", "services", "tenant-restore.ts"),
      "utf8",
    );
    expect(source).toContain("GREATEST(invoice_sequences.last_number, EXCLUDED.last_number)");
    expect(source).toContain("WHERE invoice_sequences.last_number < EXCLUDED.last_number");
  });

  it("l'organisation appelante fait foi, pas celle de la sauvegarde", async () => {
    // Le fichier de sauvegarde porte `organisation_id`, mais c'est une donnee
    // d'entree: s'y fier permettrait d'ecrire chez un autre locataire.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(import.meta.dirname, "..", "services", "tenant-restore.ts"),
      "utf8",
    );
    const i = source.indexOf("INSERT INTO invoice_sequences");
    expect(i).toBeGreaterThan(0);
    const bloc = source.slice(i, i + 200);
    expect(bloc).toContain("${orgId}");
    expect(bloc).not.toContain("row.organisation_id");
  });
});
