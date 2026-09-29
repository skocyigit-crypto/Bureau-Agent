/**
 * La table « Aujourd'hui » (services/masa-bugun.ts), sur une vraie base.
 *
 * Ce qu'on verifie : chaque ligne vient d'un enregistrement de L'ORGANISATION,
 * la regle qui la fait entrer (ou sortir) est la bonne, et elle dit qui en
 * repond et quand. Une ligne inventee, une ligne d'une autre organisation ou
 * une ligne deja traitee sont des defauts.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db, organisationsTable, usersTable, callsTable, voiceCallSessionsTable, messagesTable, tasksTable, calendarEventsTable,
  projetsTable, prospectsTable, devisTable, facturesClientTable, agentRunsTable, agentProposalsTable, telephonyProvidersTable,
} from "@workspace/db";
import { construireMasaBugun, echeanceProposition, type MasaBugun, type Satir } from "../services/masa-bugun";
import { bornesDuJour } from "../lib/jour-local";
import bugunRouter from "../routes/bugun";
import { iaUtilisable } from "../services/ai-providers";

const stamp = Date.now();
const JOUR = 24 * 60 * 60 * 1000;
const maintenant = new Date();
const { debut, fin } = bornesDuJour(maintenant);
const ids: Record<string, number> = {};
let masa: MasaBugun;

const toutes = (m: MasaBugun): Satir[] => [m.simdi, m.onaylar, m.plan, m.dosyalar, m.finans, m.ajanlar].flatMap((r) => r.satirlar);
const ligne = (m: MasaBugun, cle: string) => toutes(m).find((s) => s.cle === cle);

async function utilisateur(orgId: number, prenom: string, nom: string) {
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `${prenom}-${stamp}-${Math.random().toString(36).slice(2, 7)}@exemple.test`.toLowerCase(),
    passwordHash: "x", prenom, nom, role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  return u!.id;
}

beforeAll(async () => {
  for (const k of ["orgA", "orgB"]) {
    const [o] = await db.insert(organisationsTable).values({ name: `Bugun ${k} ${stamp}`, slug: `bugun-${k.toLowerCase()}-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
    ids[k] = o!.id;
  }
  const A = ids.orgA, B = ids.orgB;
  ids.marie = await utilisateur(A, "Marie", "Martin");
  ids.paul = await utilisateur(A, "Paul", "Durand");
  ids.bUser = await utilisateur(B, "Bea", "Autre");

  // Appels.
  const [manque, manqueTraite, manqueVieux, enCours, manqueB] = await db.insert(callsTable).values([
    { organisationId: A, phoneNumber: "+33600000001", contactName: "Client Rappel", direction: "entrant", status: "manque" },
    { organisationId: A, phoneNumber: "+33600000002", direction: "entrant", status: "manque" },
    { organisationId: A, phoneNumber: "+33600000003", direction: "entrant", status: "manque", createdAt: new Date(maintenant.getTime() - 10 * JOUR) },
    { organisationId: A, phoneNumber: "+33600000004", direction: "sortant", status: "en_cours", createdBy: ids.marie },
    { organisationId: B, phoneNumber: "+33600000005", direction: "entrant", status: "manque" },
  ]).returning({ id: callsTable.id });
  Object.assign(ids, { manque: manque!.id, manqueTraite: manqueTraite!.id, manqueVieux: manqueVieux!.id, enCours: enCours!.id, manqueB: manqueB!.id });

  // Taches.
  const [chantierUrgent, chantierVivant] = await db.insert(projetsTable).values([
    { organisationId: A, title: "Chantier livre bientot", status: "en_cours", endDate: new Date(maintenant.getTime() + 3 * JOUR), assignedTo: String(ids.paul) },
    { organisationId: A, title: "Chantier en retard", status: "en_cours", endDate: new Date(maintenant.getTime() - 5 * JOUR), clientName: "Dupont" },
  ]).returning({ id: projetsTable.id });
  const [projTermine, projDepasse] = await db.insert(projetsTable).values([
    { organisationId: A, title: "Chantier termine", status: "termine", endDate: new Date(maintenant.getTime() - 5 * JOUR) },
    { organisationId: A, title: "Chantier au-dessus du budget", status: "en_cours", budget: "10000", spent: "12500", currency: "EUR", assignedTo: "Chef Martin" },
  ]).returning({ id: projetsTable.id });
  Object.assign(ids, { livraison: chantierUrgent!.id, retard: chantierVivant!.id, projTermine: projTermine!.id, depasse: projDepasse!.id });

  const [urgente, urgenteSansChantier, urgenteFinie, duJour, rappelTache] = await db.insert(tasksTable).values([
    { organisationId: A, title: "Fuite sur le chantier", priority: "haute", status: "en_attente", projetId: ids.retard, assignedTo: String(ids.paul) },
    { organisationId: A, title: "Urgent hors chantier", priority: "haute", status: "en_attente" },
    { organisationId: A, title: "Urgent deja fait", priority: "haute", status: "termine", projetId: ids.retard },
    { organisationId: A, title: "Tache du jour", status: "en_cours", dueDate: new Date(debut.getTime() + 60 * 60 * 1000), assignedTo: "Sophie (saisie)" },
    { organisationId: A, title: "Rappeler le client", relatedCallId: ids.manqueTraite },
  ]).returning({ id: tasksTable.id });
  Object.assign(ids, { urgente: urgente!.id, urgenteSansChantier: urgenteSansChantier!.id, urgenteFinie: urgenteFinie!.id, duJour: duJour!.id, rappelTache: rappelTache!.id });

  // Secretaire IA : session vivante, session muette depuis une heure, session close.
  const [vivante, muette, close] = await db.insert(voiceCallSessionsTable).values([
    { organisationId: A, callSid: `CA-vivant-${stamp}`, status: "en_cours", state: { callerNumber: "+33611111111", callerName: "Mme Vivante" } },
    { organisationId: A, callSid: `CA-muet-${stamp}`, status: "en_cours", state: {}, updatedAt: new Date(maintenant.getTime() - 60 * 60 * 1000) },
    { organisationId: A, callSid: `CA-clos-${stamp}`, status: "terminee", state: {}, finalizedAt: maintenant },
  ]).returning({ id: voiceCallSessionsTable.id });
  Object.assign(ids, { vivante: vivante!.id, muette: muette!.id, close: close!.id });

  const [demande, demandeLue] = await db.insert(messagesTable).values([
    { organisationId: A, phoneNumber: "+33622222222", contactName: "M. Rappel", content: "Merci de me rappeler pour le devis", type: "rappel", isRead: false },
    { organisationId: A, phoneNumber: "+33622222223", content: "Deja traite", type: "rappel", isRead: true },
  ]).returning({ id: messagesTable.id });
  Object.assign(ids, { demande: demande!.id, demandeLue: demandeLue!.id });

  // Agenda : visite du jour, rendez-vous propose par l'IA, demain, annule.
  const h = (ms: number) => new Date(debut.getTime() + ms);
  const [visite, propose, demain, annule] = await db.insert(calendarEventsTable).values([
    { organisationId: A, title: "Visite technique Dupont", type: "visite", startDate: h(2 * 3600e3), endDate: h(3 * 3600e3), location: "12 rue X", status: "confirme", createdBy: ids.marie },
    { organisationId: A, title: "RDV propose par l'IA", type: "rendez_vous", startDate: h(4 * 3600e3), endDate: h(5 * 3600e3), status: "en_attente" },
    { organisationId: A, title: "Demain", type: "rendez_vous", startDate: new Date(fin.getTime() + 3600e3), endDate: new Date(fin.getTime() + 7200e3) },
    { organisationId: A, title: "Annule", type: "rendez_vous", startDate: h(6 * 3600e3), endDate: h(7 * 3600e3), status: "annule" },
  ]).returning({ id: calendarEventsTable.id });
  Object.assign(ids, { visite: visite!.id, propose: propose!.id, demain: demain!.id, annule: annule!.id });

  // Dossiers commerciaux.
  const [nouveau, vieux] = await db.insert(prospectsTable).values([
    { organisationId: A, title: "Renovation cuisine", stage: "nouveau", contactName: "Mme Neuve", assignedTo: String(ids.marie) },
    { organisationId: A, title: "Vieille demande", stage: "nouveau", createdAt: new Date(maintenant.getTime() - 10 * JOUR) },
  ]).returning({ id: prospectsTable.id });
  Object.assign(ids, { nouveau: nouveau!.id, vieux: vieux!.id });
  const [envoye, accepte, factureDejaFaite] = await db.insert(devisTable).values([
    { organisationId: A, reference: `DV-E-${stamp}`, title: "Salle de bain", clientName: "Mme Neuve", status: "envoye", prospectId: ids.nouveau, totalAmount: "4200", validUntil: new Date(maintenant.getTime() + 10 * JOUR) },
    { organisationId: A, reference: `DV-A-${stamp}`, title: "Toiture", clientName: "M. Toit", status: "accepte", totalAmount: "9000", acceptedAt: maintenant, acceptedBy: ids.marie },
    { organisationId: A, reference: `DV-F-${stamp}`, title: "Deja facture", clientName: "M. Fait", status: "accepte", totalAmount: "100", convertedToInvoice: 1 },
  ]).returning({ id: devisTable.id });
  Object.assign(ids, { envoye: envoye!.id, accepte: accepte!.id, factureDejaFaite: factureDejaFaite!.id });

  const hier = new Date(maintenant.getTime() - JOUR);
  const [echue, brouillon, payee] = await db.insert(facturesClientTable).values([
    { organisationId: A, reference: `FC-1-${stamp}`, title: "Travaux", clientName: "Client En Retard", status: "envoyee", totalAmount: "1000", paidAmount: "400", dueDate: hier },
    { organisationId: A, reference: `FC-2-${stamp}`, title: "Brouillon", clientName: "X", status: "brouillon", totalAmount: "500", dueDate: hier },
    { organisationId: A, reference: `FC-3-${stamp}`, title: "Payee", clientName: "Y", status: "payee", totalAmount: "500", paidAmount: "500", dueDate: hier },
  ]).returning({ id: facturesClientTable.id });
  Object.assign(ids, { echue: echue!.id, brouillon: brouillon!.id, payee: payee!.id });

  // Agents.
  const [enErreur, rendu, vieilleErreur] = await db.insert(agentRunsTable).values([
    { organisationId: A, agentId: "agent-vente", trigger: "manuel", status: "echouee", error: "Quota du fournisseur atteint", requestedBy: ids.paul },
    { organisationId: A, agentId: "agent-planning", trigger: "manuel", status: "en_attente", requestedBy: ids.paul },
    { organisationId: A, agentId: "agent-vieux", trigger: "manuel", status: "echouee", startedAt: new Date(maintenant.getTime() - 2 * JOUR) },
  ]).returning({ id: agentRunsTable.id });
  Object.assign(ids, { enErreur: enErreur!.id, rendu: rendu!.id, vieilleErreur: vieilleErreur!.id });

  const [expire, recente, autreOrg] = await db.insert(agentProposalsTable).values([
    { organisationId: A, runId: "auto-2026-09-17", toolName: "send_email", title: "Relancer M. Toit", summary: "E-mail de relance", reason: "Devis sans reponse", category: "email", sourceType: "automation_rule", createdAt: new Date(maintenant.getTime() - 12 * JOUR) },
    { organisationId: A, runId: `agent-run:${ids.rendu}`, toolName: "create_task", title: "Planifier la visite", summary: "Tache", reason: "Demande entrante", category: "tache", sourceType: "orchestrateur" },
    { organisationId: B, runId: "auto-x", toolName: "send_email", title: "Autre bureau", summary: "x" },
  ]).returning({ id: agentProposalsTable.id, createdAt: agentProposalsTable.createdAt });
  Object.assign(ids, { expire: expire!.id, recente: recente!.id, autreOrg: autreOrg!.id });
  ids.expireCree = expire!.createdAt.getTime();

  await db.insert(telephonyProvidersTable).values({ organisationId: B, provider: "twilio", label: "Ligne B", isActive: true });

  masa = await construireMasaBugun(A, maintenant);
});

afterAll(async () => {
  try {
    for (const org of [ids.orgA, ids.orgB]) {
      await db.delete(agentProposalsTable).where(eq(agentProposalsTable.organisationId, org));
      await db.delete(agentRunsTable).where(eq(agentRunsTable.organisationId, org));
      await db.delete(tasksTable).where(eq(tasksTable.organisationId, org));
    }
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [ids.orgA, ids.orgB]));
  } catch { /* le journal d'audit peut retenir l'organisation ; sans effet sur les tests */ }
});

describe("maintenant", () => {
  it("montre l'appel en cours et la secretaire IA encore en ligne, pas la session muette ni la close", () => {
    expect(ligne(masa, `cagri_canli:${ids.enCours}`)).toMatchObject({ href: `/appels/${ids.enCours}`, sorumlu: "Marie Martin" });
    expect(ligne(masa, `cagri_canli:v${ids.vivante}`)).toMatchObject({ baslik: "Mme Vivante", detay: "+33611111111" });
    expect(ligne(masa, `cagri_canli:v${ids.muette}`)).toBeUndefined();
    expect(ligne(masa, `cagri_canli:v${ids.close}`)).toBeUndefined();
  });

  it("liste l'appel manque a rappeler — ni celui deja suivi d'une tache, ni celui de plus de 7 jours", () => {
    expect(ligne(masa, `geri_arama:${ids.manque}`)).toMatchObject({ tur: "geri_arama", baslik: "Client Rappel", href: `/appels/${ids.manque}`, ton: "onay" });
    expect(ligne(masa, `geri_arama:${ids.manqueTraite}`)).toBeUndefined();
    expect(ligne(masa, `geri_arama:${ids.manqueVieux}`)).toBeUndefined();
  });

  it("reprend la demande de rappel prise par la secretaire IA tant qu'elle n'est pas lue", () => {
    expect(ligne(masa, `geri_arama_istegi:${ids.demande}`)?.detay).toContain("rappeler");
    expect(ligne(masa, `geri_arama_istegi:${ids.demandeLue}`)).toBeUndefined();
  });

  it("signale le probleme urgent d'un chantier, avec son responsable nomme", () => {
    expect(ligne(masa, `acil_saha:${ids.urgente}`)).toMatchObject({ ton: "acil", sorumlu: "Paul Durand", href: `/taches?id=${ids.urgente}` });
    expect(ligne(masa, `acil_saha:${ids.urgenteSansChantier}`)).toBeUndefined();
    expect(ligne(masa, `acil_saha:${ids.urgenteFinie}`)).toBeUndefined();
  });

  it("avertit de l'approbation qui expire dans moins de trois jours, avec son echeance", () => {
    const l = ligne(masa, `onay_suresi:${ids.expire}`);
    expect(l?.zaman).toBe(echeanceProposition(new Date(ids.expireCree)).toISOString());
    expect(ligne(masa, `onay_suresi:${ids.recente}`)).toBeUndefined();
  });
});

describe("approbations", () => {
  it("compte et liste celles du bureau seulement, la plus ancienne d'abord", () => {
    expect(masa.onaylar.toplam).toBe(2);
    expect(masa.onaylar.satirlar.map((s) => s.cle)).toEqual([`onay:${ids.expire}`, `onay:${ids.recente}`]);
    expect(ligne(masa, `onay:${ids.autreOrg}`)).toBeUndefined();
  });

  it("dit sur quoi l'agent s'appuie, qui a demande, et de quelle source vient la proposition", () => {
    expect(ligne(masa, `onay:${ids.expire}`)).toMatchObject({ detay: "Devis sans reponse", para: "automation_rule", sorumlu: null });
    expect(ligne(masa, `onay:${ids.recente}`)).toMatchObject({ sorumlu: "Paul Durand", para: "orchestrateur", tur: "onay_tache" });
  });
});

describe("plan du jour", () => {
  it("distingue la visite du rendez-vous, et le rendez-vous non confirme", () => {
    expect(ligne(masa, `kesif:${ids.visite}`)).toMatchObject({ tur: "kesif", detay: "12 rue X", sorumlu: "Marie Martin", href: `/calendrier?id=${ids.visite}` });
    expect(ligne(masa, `randevu:${ids.propose}`)).toMatchObject({ tur: "randevu_onaysiz", ton: "onay" });
    expect(ligne(masa, `randevu:${ids.demain}`)).toBeUndefined();
    expect(ligne(masa, `randevu:${ids.annule}`)).toBeUndefined();
  });

  it("montre les taches du jour et les livraisons a sept jours, responsable nomme ou saisi", () => {
    expect(ligne(masa, `gorev:${ids.duJour}`)?.sorumlu).toBe("Sophie (saisie)");
    expect(ligne(masa, `teslim:${ids.livraison}`)).toMatchObject({ sorumlu: "Paul Durand" });
  });
});

describe("dossiers", () => {
  it("nouvelle demande de la semaine, devis envoye (responsable du prospect), chantier en retard", () => {
    expect(ligne(masa, `talep:${ids.nouveau}`)).toMatchObject({ href: `/prospects/${ids.nouveau}`, sorumlu: "Marie Martin" });
    expect(ligne(masa, `talep:${ids.vieux}`)).toBeUndefined();
    expect(ligne(masa, `teklif:${ids.envoye}`)).toMatchObject({ tutar: 4200, sorumlu: "Marie Martin" });
    expect(ligne(masa, `santiye_gecikti:${ids.retard}`)).toMatchObject({ ton: "acil", detay: "Dupont" });
    expect(ligne(masa, `santiye_gecikti:${ids.projTermine}`)).toBeUndefined();
  });
});

describe("finances", () => {
  it("chaque montant a sa source : reste du sur la facture echue, depassement saisi a la main, devis accepte a facturer", () => {
    expect(ligne(masa, `fatura_gecikti:${ids.echue}`)).toMatchObject({ tutar: 600, href: "/factures" });
    expect(ligne(masa, `fatura_gecikti:${ids.brouillon}`)).toBeUndefined();
    expect(ligne(masa, `fatura_gecikti:${ids.payee}`)).toBeUndefined();
    expect(ligne(masa, `butce_asimi:${ids.depasse}`)).toMatchObject({ tutar: 2500, detay: "manuel", sorumlu: "Chef Martin" });
    expect(ligne(masa, `faturasiz_kabul:${ids.accepte}`)).toMatchObject({ tutar: 9000, sorumlu: "Marie Martin" });
    expect(ligne(masa, `faturasiz_kabul:${ids.factureDejaFaite}`)).toBeUndefined();
  });
});

describe("agents", () => {
  it("dit ce qui a echoue (avec l'erreur), ce qui attend un humain, et compte sur 24 h", () => {
    expect(ligne(masa, `ajan_hata:${ids.enErreur}`)).toMatchObject({ detay: "Quota du fournisseur atteint", sorumlu: "Paul Durand", ton: "acil" });
    expect(ligne(masa, `ajan_devretti:${ids.rendu}`)).toMatchObject({ ton: "onay" });
    expect(ligne(masa, `ajan_hata:${ids.vieilleErreur}`)).toBeUndefined();
    expect(masa.ajanlar.sayac).toEqual({ calisiyor: 0, bekliyor: 1, hata: 1 });
  });

  it("tient pour utilisable un fournisseur d'IA configure sur la plateforme", async () => {
    // La lecture de configuration vit dans services/ai-providers.ts (classe au
    // registre IA) : la table du jour ne touche pas elle-meme a un modele.
    expect(await iaUtilisable(ids.orgA, { OPENAI_API_KEY: "sk-test" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("signale la ligne telephonique manquante — pour ce bureau, pas pour celui qui en a une", async () => {
    expect(ligne(masa, "baglanti_eksik:telefon")).toMatchObject({ href: "/telephonie", ton: "acil" });
    const b = await construireMasaBugun(ids.orgB, maintenant);
    expect(ligne(b, "baglanti_eksik:telefon")).toBeUndefined();
  });
});

describe("isolation et route", () => {
  it("ne laisse passer aucun enregistrement d'une autre organisation", async () => {
    const b = await construireMasaBugun(ids.orgB, maintenant);
    const clesB = toutes(b).map((s) => s.cle);
    expect(clesB).toContain(`geri_arama:${ids.manqueB}`);
    expect(clesB).toContain(`onay:${ids.autreOrg}`);
    expect(toutes(masa).map((s) => s.cle)).not.toContain(`geri_arama:${ids.manqueB}`);
    expect(clesB.filter((c) => /:(\d+)$/.test(c) && [ids.manque, ids.expire, ids.visite, ids.echue].includes(Number(c.split(":")[1])))).toEqual([]);
  });

  it("GET /api/bugun rend la table de l'organisation de la session", async () => {
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).session = { userId: ids.marie, organisationId: ids.orgA, userRole: "administrateur" };
      (req as any).log = { info() {}, warn() {}, error() {} };
      next();
    });
    app.use("/api", bugunRouter);
    const res = await request(app).get("/api/bugun");
    expect(res.status).toBe(200);
    expect(res.body.onaylar.toplam).toBe(2);
    expect(Object.keys(res.body)).toEqual(expect.arrayContaining(["simdi", "onaylar", "plan", "dosyalar", "finans", "ajanlar", "uretildi"]));
  });
});
