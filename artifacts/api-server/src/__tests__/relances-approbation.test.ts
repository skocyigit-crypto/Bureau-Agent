/**
 * Relances de paiement : rien ne part vers un client sans passer par le choix
 * de l'organisation, et ce qui part est enregistre.
 *
 * Mesure du 28/09 (audit « securite et controle humain ») :
 *   - le Commandant IA envoyait aux clients le texte ecrit par le modele,
 *     sans file d'approbation ;
 *   - une relance approuvee dans la file n'etait enregistree nulle part : le
 *     garde « pas deux relances en 7 jours » ne la voyait pas, et elle etait
 *     reproposee le lendemain ;
 *   - l'agent SaaS, sur un impaye de PLATEFORME, relancait les clients de
 *     l'organisation pour LEURS factures, en ignorant son approbation, son
 *     desabonnement et le verrou du cron ;
 *   - ni le desabonnement ni l'approbation des relances n'avaient d'ecran.
 *
 * Base reelle ; seul l'envoi d'e-mail est simule (et compte).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const envois = vi.hoisted(() => ({ liste: [] as Array<{ to: string; subject: string }> }));
vi.mock("../services/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/email")>();
  return {
    ...actual,
    sendEmail: async (to: string, subject: string) => { envois.liste.push({ to, subject }); return { success: true }; },
    sendInvoiceReminderEmail: async (p: { to: string; reference: string }) => {
      envois.liste.push({ to: p.to, subject: `abonnement ${p.reference}` });
      return { success: true };
    },
  };
});

import { and, eq } from "drizzle-orm";
import {
  db, organisationsTable, usersTable, facturesClientTable, paymentRemindersTable, agentProposalsTable,
  invoicesTable, licenseAuditLogTable,
} from "@workspace/db";
import {
  consignerRelance, lireRefRelance, niveauRelanceSuivant, proposerRelancesRedigees, refRelance, relancesSurApprobation,
  SOURCE_RELANCE,
} from "../services/relances-factures";
import { executeProposal } from "../services/autonomous-secretary";
import { relancerOrganisation } from "../routes/license-management";
import { relancerAbonnementPlateforme } from "../services/relance-abonnement";
import { CRON_LOCK_NAMESPACE, tryWithLock } from "../lib/cron-lock";

const stamp = Date.now();
const JOUR = 86400_000;
let n = 0;
let org = 0;
let admin = 0;

async function creerOrg(extra: Partial<typeof organisationsTable.$inferInsert> = {}): Promise<number> {
  const [o] = await db.insert(organisationsTable).values({
    name: `Relances ${stamp}-${++n}`, slug: `relances-${stamp}-${n}`, maxUsers: 5, actif: true,
    email: `org${n}.${stamp}@example.test`, ...extra,
  }).returning({ id: organisationsTable.id });
  return o!.id;
}
async function creerFacture(orgId: number, extra: Partial<typeof facturesClientTable.$inferInsert> = {}) {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId, reference: `FAC-${stamp}-${++n}`, title: "Ravalement", clientName: "SCI Duval",
    clientEmail: `client${n}.${stamp}@example.test`, status: "envoyee",
    totalAmount: "1200.00", paidAmount: "0", dueDate: new Date(Date.now() - 20 * JOUR), ...extra,
  } as any).returning();
  return f!;
}
const habiller = (titre: string, corps: string) => `<h1>${titre}</h1>${corps}`;
const propositions = (orgId: number) => db.select().from(agentProposalsTable).where(eq(agentProposalsTable.organisationId, orgId));
const relancesDe = (factureId: number) => db.select().from(paymentRemindersTable).where(eq(paymentRemindersTable.factureClientId, factureId));

beforeAll(async () => {
  org = await creerOrg();
  const [u] = await db.insert(usersTable).values({
    email: `admin.${stamp}@example.test`, passwordHash: "x", nom: "Duval", prenom: "Claire",
    role: "administrateur", organisationId: org, actif: true,
  } as any).returning({ id: usersTable.id });
  admin = u!.id;
}, 60_000);

beforeEach(() => { envois.liste.length = 0; });

afterAll(async () => {
  // Nettoyage au mieux : les journaux sont en ajout seul, la base de CI est jetable.
  try { await db.delete(agentProposalsTable).where(eq(agentProposalsTable.organisationId, org)); } catch { /* */ }
});

describe("regles pures", () => {
  it("le choix explicite de l'organisation l'emporte ; a defaut, l'ancien reglage commun", () => {
    expect(relancesSurApprobation({ remindersRequireApproval: null, billingRequiresApproval: false })).toBe(false);
    expect(relancesSurApprobation({ remindersRequireApproval: null, billingRequiresApproval: true })).toBe(true);
    expect(relancesSurApprobation({ remindersRequireApproval: true, billingRequiresApproval: false })).toBe(true);
    expect(relancesSurApprobation({ remindersRequireApproval: false, billingRequiresApproval: true })).toBe(false);
  });

  it("une reference de relance illisible n'est pas interpretee", () => {
    expect(lireRefRelance(refRelance(12, 3))).toEqual({ factureId: 12, niveau: 3 });
    for (const x of ["", "relance:12", "relance:a:1", "relance:0:1", "relance:5:0", "saas:relance:5:2026-09-28", null]) {
      expect(lireRefRelance(x as any), String(x)).toBeNull();
    }
  });
});

describe("Commandant IA : le texte du modele va en file, pas chez le client", () => {
  it("une proposition par facture, avec le texte exact et l'adresse de la FACTURE ; aucun envoi", async () => {
    const f = await creerFacture(org);
    const mises = await proposerRelancesRedigees({
      orgId: org, factures: [f], iban: null, habiller,
      relances: [{ invoiceRef: f.reference, message: "Merci de regler <b>vite</b>" }],
    });
    expect(mises).toBe(1);
    expect(envois.liste).toEqual([]);
    const [p] = (await propositions(org)).filter((x) => x.sourceRef === refRelance(f.id, 1));
    expect(p!.toolName).toBe("send_email");
    expect(p!.sourceType).toBe(SOURCE_RELANCE);
    expect((p!.args as any).to).toBe(f.clientEmail);
    expect((p!.args as any).body).toContain("Merci de regler &lt;b&gt;vite&lt;/b&gt;");
  });

  it("le modele ne choisit pas le destinataire : reference inconnue, facture d'une autre organisation, sans e-mail ou citee deux fois", async () => {
    const autre = await creerOrg();
    const etrangere = await creerFacture(autre);
    const sansEmail = await creerFacture(org, { clientEmail: null });
    const f = await creerFacture(org);
    const mises = await proposerRelancesRedigees({
      orgId: org, factures: [etrangere, sansEmail, f], iban: null, habiller,
      relances: [
        { invoiceRef: "FAC-INVENTEE" }, { invoiceRef: etrangere.reference }, { invoiceRef: sansEmail.reference },
        { invoiceRef: f.reference, message: "a" }, { invoiceRef: f.reference, message: "b" },
      ],
    });
    expect(mises).toBe(1);
    expect(await propositions(autre)).toEqual([]);
  });

  it("deux clics ne mettent pas deux fois la meme relance en file", async () => {
    const f = await creerFacture(org);
    const args = { orgId: org, factures: [f], iban: null, habiller, relances: [{ invoiceRef: f.reference, message: "x" }] };
    expect(await proposerRelancesRedigees(args)).toBe(1);
    expect(await proposerRelancesRedigees(args)).toBe(0);
    expect((await propositions(org)).filter((x) => x.sourceRef === refRelance(f.id, 1))).toHaveLength(1);
  });
});

describe("relance approuvee : envoyee une fois, enregistree, jamais hors de propos", () => {
  it("l'approbation envoie, ecrit payment_reminders et marque la facture", async () => {
    const f = await creerFacture(org);
    await proposerRelancesRedigees({ orgId: org, factures: [f], iban: null, habiller, relances: [{ invoiceRef: f.reference, message: "x" }] });
    const [p] = (await propositions(org)).filter((x) => x.sourceRef === refRelance(f.id, 1));
    const r = await executeProposal(p!.id, { orgId: org, userId: admin });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(envois.liste.map((e) => e.to)).toEqual([f.clientEmail]);
    const [ligne] = await relancesDe(f.id);
    expect(ligne!.status).toBe("sent");
    expect(ligne!.reminderLevel).toBe(1);
    const [apres] = await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, f.id));
    expect(apres!.reminderCount).toBe(1);
    expect(apres!.lastReminderAt).not.toBeNull();
    expect(await niveauRelanceSuivant(f.id)).toBe(2);
  });

  it("une relance de meme niveau deja partie ne repart pas (proposition en double)", async () => {
    const f = await creerFacture(org);
    await consignerRelance({ orgId: org, factureId: f.id, niveau: 1, destinataire: f.clientEmail!, sujet: "deja", envoyee: true });
    const [p] = await db.insert(agentProposalsTable).values({
      organisationId: org, runId: "test", toolName: "send_email", title: "t", summary: "s",
      args: { to: f.clientEmail, subject: "Rappel", body: "x" }, sourceType: SOURCE_RELANCE, sourceRef: refRelance(f.id, 1), status: "en_attente",
    }).returning({ id: agentProposalsTable.id });
    const r = await executeProposal(p!.id, { orgId: org, userId: admin });
    expect(r.status).toBe("expiree");
    expect(envois.liste).toEqual([]);
  });

  it("une facture reglee entre la proposition et le clic ne recoit pas de relance", async () => {
    const f = await creerFacture(org);
    await proposerRelancesRedigees({ orgId: org, factures: [f], iban: null, habiller, relances: [{ invoiceRef: f.reference, message: "x" }] });
    await db.update(facturesClientTable).set({ status: "payee", paidAmount: "1200.00" }).where(eq(facturesClientTable.id, f.id));
    const [p] = (await propositions(org)).filter((x) => x.sourceRef === refRelance(f.id, 1));
    const r = await executeProposal(p!.id, { orgId: org, userId: admin });
    expect(r.status).toBe("expiree");
    expect(r.error).toMatch(/reglee/);
    expect(envois.liste).toEqual([]);
    expect(await relancesDe(f.id)).toEqual([]);
  });
});

describe("relancerOrganisation : le choix de l'organisation, sous verrou", () => {
  it("une organisation desabonnee n'est pas relancee par un declencheur automatique", async () => {
    const o = await creerOrg({ autoRemindersEnabled: false });
    await creerFacture(o);
    const r = await relancerOrganisation(o);
    expect(r.statut).toBe("desactivee");
    expect(envois.liste).toEqual([]);
    expect(await propositions(o)).toEqual([]);
  });

  it("« voir avant envoi » : les relances vont en file, rien ne part", async () => {
    const o = await creerOrg({ remindersRequireApproval: true, billingRequiresApproval: false });
    const f = await creerFacture(o);
    const r = await relancerOrganisation(o);
    expect(r.statut === "fait" && r.mode).toBe("propose");
    expect(envois.liste).toEqual([]);
    expect((await propositions(o)).map((p) => p.sourceRef)).toEqual([refRelance(f.id, 1)]);
  });

  it("sans choix explicite, l'ancien comportement : envoi, ET la facture est marquee", async () => {
    const o = await creerOrg({ remindersRequireApproval: null, billingRequiresApproval: false });
    const f = await creerFacture(o);
    const r = await relancerOrganisation(o);
    expect(r.statut === "fait" && r.mode).toBe("send");
    expect(envois.liste.map((e) => e.to)).toEqual([f.clientEmail]);
    const [apres] = await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, f.id));
    expect(apres!.reminderCount, "la relance envoyee doit marquer la facture").toBe(1);
  });

  it("pendant qu'un cycle tient le verrou de l'organisation, un second n'envoie rien", async () => {
    const o = await creerOrg();
    await creerFacture(o);
    let pendant: Awaited<ReturnType<typeof relancerOrganisation>> | undefined;
    await tryWithLock(CRON_LOCK_NAMESPACE.invoiceReminder, o, async () => { pendant = await relancerOrganisation(o); });
    expect(pendant!.statut).toBe("en_cours");
    expect(envois.liste).toEqual([]);
  });
});

describe("impaye de plateforme : on relance l'organisation, jamais ses clients", () => {
  it("la relance va a l'organisation et a ses administrateurs, pas au client de sa facture", async () => {
    const o = await creerOrg();
    await db.insert(usersTable).values({
      email: `admin2.${stamp}@example.test`, passwordHash: "x", nom: "B", prenom: "A", role: "administrateur", organisationId: o, actif: true,
    } as any);
    const facturePropre = await creerFacture(o);
    await db.insert(invoicesTable).values({
      organisationId: o, periodLabel: "2026-08", periodStart: new Date("2026-08-01T00:00:00Z"), periodEnd: new Date("2026-08-31T00:00:00Z"),
      plan: "starter", reference: `PL-${stamp}-${n}`, issuedAt: new Date("2026-09-01T00:00:00Z"), status: "retard",
      totalAmount: "29.00", totalTtc: "34.80",
    } as any);
    const r = await relancerAbonnementPlateforme(o);
    expect(r.statut, JSON.stringify(r)).toBe("envoyee");
    const adresses = envois.liste.map((e) => e.to).sort();
    const [lue] = await db.select({ email: organisationsTable.email }).from(organisationsTable).where(eq(organisationsTable.id, o));
    // Une facture en retard, deux destinataires : l'organisation et son administrateur.
    expect(adresses).toEqual([lue!.email!, `admin2.${stamp}@example.test`].sort());
    expect(adresses).not.toContain(facturePropre.clientEmail);
    expect(await relancesDe(facturePropre.id)).toEqual([]);
    const journal = await db.select().from(licenseAuditLogTable).where(and(
      eq(licenseAuditLogTable.organisationId, o), eq(licenseAuditLogTable.action, "platform_payment_reminder"),
    ));
    expect(journal).toHaveLength(1);
  });

  it("pas deux relances d'abonnement en 7 jours", async () => {
    const o = await creerOrg();
    await db.insert(invoicesTable).values({
      organisationId: o, periodLabel: "2026-08", periodStart: new Date("2026-08-01T00:00:00Z"), periodEnd: new Date("2026-08-31T00:00:00Z"),
      plan: "starter", reference: `PL-${stamp}-${++n}`, issuedAt: new Date("2026-09-01T00:00:00Z"), status: "retard",
      totalAmount: "29.00", totalTtc: "34.80",
    } as any);
    expect((await relancerAbonnementPlateforme(o)).statut).toBe("envoyee");
    envois.liste.length = 0;
    expect((await relancerAbonnementPlateforme(o)).statut).toBe("deja_relancee");
    expect(envois.liste).toEqual([]);
  });

  it("rien d'emis en retard, aucun echec de paiement : aucune relance", async () => {
    const o = await creerOrg();
    await creerFacture(o);
    // Une facture d'abonnement jamais emise n'est pas en retard.
    await db.insert(invoicesTable).values({
      organisationId: o, periodLabel: "2026-07", periodStart: new Date("2026-07-01T00:00:00Z"), periodEnd: new Date("2026-07-31T00:00:00Z"),
      plan: "starter", status: "en_attente", totalAmount: "29.00",
    } as any);
    expect((await relancerAbonnementPlateforme(o)).statut).toBe("rien_a_relancer");
    expect(envois.liste).toEqual([]);
  });
});
