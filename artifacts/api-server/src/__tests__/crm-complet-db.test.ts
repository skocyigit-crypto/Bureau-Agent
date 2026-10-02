/**
 * CRM complet (plan, section 5) : chronologie du client, doublons et fusion,
 * prochaine action, decouverte, estimation contre prix verifie.
 *
 * Vraie base, vrais routeurs, vrais utilisateurs (pas de userId:1 : le
 * journal d'audit avalerait l'erreur de cle etrangere et la trace se
 * perdrait). Chaque test decrit ce qui cassait ou pouvait casser.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import {
  appointmentOffersTable, auditLogsTable, calendarEventsTable, callsTable, compteClientTable, contactsTable, db,
  deletedRowsTable, devisTable, faceProfilesTable, facturesClientTable, messagesTable, organisationsTable, projetsTable,
  prospectsTable, tasksTable, usersTable, whatsappConversationsTable, whatsappMessagesTable,
} from "@workspace/db";
import contactsRouter from "../routes/contacts";
import prospectsRouter from "../routes/prospects";
import devisRouter from "../routes/devis";
import bulkRouter from "../routes/bulk-operations";
import { REFERENCES_CONTACT, REFERENCE_COMPTE_CLIENT, emailNormalise, grouperDoublons, telephoneE164, cleNomSociete } from "../services/crm-contacts";
import { POINTS_DECOUVERTE, contientLigneEstimee, pointsManquants, validerListeDecouverte } from "../services/crm-decouverte";
import { computeInvoiceTotals } from "../services/invoice-totals";
import { construireMasaBugun } from "../services/masa-bugun";
import { restoreFromTrash } from "../services/trash";

const stamp = Date.now();
const ids: Record<string, number> = {};
const JOUR = 86400000;
let seq = 0;
const ref = (p: string) => `${p}-${stamp}-${++seq}`;

function appli(role = "administrateur", userId = ids.admin, orgId = ids.orgA) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: role, role, userEmail: `crm-${stamp}@exemple.test` };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  for (const r of [contactsRouter, prospectsRouter, devisRouter, bulkRouter]) a.use("/api", r);
  return a;
}
const appliB = () => appli("administrateur", ids.adminB, ids.orgB);

async function unContact(v: Partial<typeof contactsTable.$inferInsert> = {}, orgId = ids.orgA) {
  const [c] = await db.insert(contactsTable).values({
    organisationId: orgId, firstName: `Prenom${++seq}`, lastName: `Nom${stamp}${seq}`, phone: `07${String(stamp).slice(-6)}${String(seq).padStart(2, "0")}`, ...v,
  }).returning();
  return c!;
}

async function unProspect(v: Partial<typeof prospectsTable.$inferInsert> = {}, orgId = ids.orgA) {
  const [p] = await db.insert(prospectsTable).values({ organisationId: orgId, title: `Renovation ${++seq}`, ...v }).returning();
  return p!;
}

/** Une ligne dans CHAQUE table qui reference un contact. */
async function lignesPour(contactId: number, orgId = ids.orgA) {
  const r: Record<string, number> = {};
  r.calls = (await db.insert(callsTable).values({ organisationId: orgId, contactId, phoneNumber: "0600000000", direction: "entrant", status: "repondu" }).returning())[0]!.id;
  r.messages = (await db.insert(messagesTable).values({ organisationId: orgId, contactId, phoneNumber: "0600000000", content: "Rappeler pour la visite", type: "sms" }).returning())[0]!.id;
  r.notes = (await db.insert(messagesTable).values({ organisationId: orgId, contactId, phoneNumber: "0600000000", content: "Prefere le matin", type: "note" }).returning())[0]!.id;
  r.devis = (await db.insert(devisTable).values({ organisationId: orgId, contactId, reference: ref("DV"), title: "Toiture", clientName: "Client", totalAmount: "1200.00" }).returning())[0]!.id;
  r.factures_client = (await db.insert(facturesClientTable).values({ organisationId: orgId, contactId, reference: ref("FA"), title: "Acompte", clientName: "Client", totalAmount: "500.00" } as any).returning())[0]!.id;
  r.projets = (await db.insert(projetsTable).values({ organisationId: orgId, contactId, title: "Chantier toiture" } as any).returning())[0]!.id;
  r.prospects = (await db.insert(prospectsTable).values({ organisationId: orgId, contactId, title: "Demande toiture" }).returning())[0]!.id;
  r.calendar_events = (await db.insert(calendarEventsTable).values({ organisationId: orgId, relatedContactId: contactId, title: "Visite", startDate: new Date(), endDate: new Date(Date.now() + 3600000) } as any).returning())[0]!.id;
  r.appointment_offers = (await db.insert(appointmentOffersTable).values({ organisationId: orgId, relatedContactId: contactId, token: ref("tok"), reason: "Metre" } as any).returning())[0]!.id;
  r.tasks = (await db.insert(tasksTable).values({ organisationId: orgId, relatedContactId: contactId, title: "Envoyer le devis" } as any).returning())[0]!.id;
  r.whatsapp_conversations = (await db.insert(whatsappConversationsTable).values({ organisationId: orgId, contactId, customerPhone: ref("+336") } as any).returning())[0]!.id;
  r.whatsapp_messages = (await db.insert(whatsappMessagesTable).values({ organisationId: orgId, conversationId: r.whatsapp_conversations, direction: "inbound", body: "Bonjour, des photos" } as any).returning())[0]!.id;
  r.face_profiles = (await db.insert(faceProfilesTable).values({ organisationId: orgId, contactId, name: "Visage" }).returning())[0]!.id;
  return r;
}

beforeAll(async () => {
  for (const k of ["orgA", "orgB"]) {
    const [o] = await db.insert(organisationsTable).values({ name: `CRM ${k} ${stamp}`, slug: `crm-${k.toLowerCase()}-${stamp}`, maxUsers: 9, actif: true }).returning({ id: organisationsTable.id });
    ids[k] = o!.id;
  }
  const mk = async (org: number, role: string, n: string) => (await db.insert(usersTable).values({ organisationId: org, email: `${n}-crm-${stamp}@exemple.test`, passwordHash: "x", prenom: n, nom: "T", role, actif: true }).returning({ id: usersTable.id }))[0]!.id;
  ids.admin = await mk(ids.orgA, "administrateur", "adm");
  ids.agent = await mk(ids.orgA, "agent", "agt");
  ids.lecteur = await mk(ids.orgA, "lecture_seule", "lec");
  ids.adminB = await mk(ids.orgB, "administrateur", "admb");
});

afterAll(async () => { /* base de test jetable */ });

// ===========================================================================
// 1. Chronologie
// ===========================================================================
describe("chronologie d'un client", () => {
  let contact: Awaited<ReturnType<typeof unContact>>;
  let lignes: Record<string, number>;
  let fil: Array<{ type: string; id: number; date: string; lien: string }>;
  const forges: Record<string, number> = {};

  beforeAll(async () => {
    contact = await unContact();
    lignes = await lignesPour(contact.id);
    // Lignes d'un AUTRE locataire forgees avec l'identifiant de ce contact :
    // la cle etrangere ne les empeche pas, seul le filtre d'organisation.
    const f = await lignesPour(contact.id, ids.orgB);
    Object.assign(forges, f);
    const r = await request(appli()).get(`/api/contacts/${contact.id}/chronologie?limit=100`);
    expect(r.status, r.text).toBe(200);
    fil = r.body.elements;
  });

  const attendus: Array<[string, string, (id: number) => string]> = [
    ["appel", "calls", (id) => `/appels/${id}`],
    ["message", "messages", () => "/messages"],
    ["note", "notes", () => "/messages"],
    ["whatsapp", "whatsapp_messages", () => "/whatsapp"],
    ["devis", "devis", (id) => `/devis?id=${id}`],
    ["facture", "factures_client", (id) => `/factures?id=${id}`],
    ["rendez_vous", "calendar_events", (id) => `/calendrier?id=${id}`],
    ["offre_rdv", "appointment_offers", () => "/calendrier"],
    ["tache", "tasks", (id) => `/taches?id=${id}`],
    ["chantier", "projets", (id) => `/projets/${id}`],
    ["opportunite", "prospects", (id) => `/prospects/${id}`],
  ];
  it.each(attendus)("contient l'element %s, avec le lien vers sa fiche", (type, cle, lien) => {
    const el = fil.find((e) => e.type === type && e.id === lignes[cle]);
    expect(el, `${type} absent`).toBeTruthy();
    expect(el!.lien).toBe(lien(lignes[cle]!));
  });

  it.each(attendus)("ne contient pas l'element %s forge par une autre organisation", (type, cle) => {
    expect(fil.some((e) => e.type === type && e.id === forges[cle])).toBe(false);
  });

  it("est triee du plus recent au plus ancien", () => {
    const dates = fil.map((e) => Date.parse(e.date));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("contient exactement les 11 elements du contact, rien de plus", () => {
    expect(fil).toHaveLength(11);
  });

  it("se pagine par curseur sans perte ni doublon", async () => {
    const vus: string[] = [];
    let curseur: string | null = null;
    for (let i = 0; i < 10; i++) {
      const url: string = `/api/contacts/${contact.id}/chronologie?limit=3${curseur ? `&avant=${encodeURIComponent(curseur)}` : ""}`;
      const r = await request(appli()).get(url);
      expect(r.status).toBe(200);
      vus.push(...r.body.elements.map((e: { type: string; id: number }) => `${e.type}:${e.id}`));
      curseur = r.body.suivant;
      if (!curseur) break;
    }
    expect(vus).toHaveLength(11);
    expect(new Set(vus).size).toBe(11);
  });

  it("refuse un curseur illisible (400)", async () => {
    expect((await request(appli()).get(`/api/contacts/${contact.id}/chronologie?avant=n-importe-quoi`)).status).toBe(400);
  });

  it("rend 404 pour le contact d'une autre organisation", async () => {
    expect((await request(appliB()).get(`/api/contacts/${contact.id}/chronologie`)).status).toBe(404);
  });

  it("un contact sans activite rend un fil vide, pas une erreur", async () => {
    const vide = await unContact();
    const r = await request(appli()).get(`/api/contacts/${vide.id}/chronologie`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ elements: [], suivant: null });
  });

  it("rend les montants des devis et factures", () => {
    expect(fil.find((e) => e.type === "devis")).toMatchObject({ montant: 1200 });
    expect(fil.find((e) => e.type === "facture")).toMatchObject({ montant: 500 });
  });
});

// ===========================================================================
// 2. Doublons et fusion
// ===========================================================================
describe("normalisation des cles de doublon", () => {
  it.each([
    ["06 12 34 56 78", "+33612345678"],
    ["+33 6 12 34 56 78", "+33612345678"],
    ["0033612345678", "+33612345678"],
    ["33612345678", "+33612345678"],
    ["06.12.34.56.78", "+33612345678"],
    ["+44 20 7946 0958", "+442079460958"],
    ["1234", null],
    ["", null],
  ])("telephone %s -> %s", (brut, attendu) => {
    expect(telephoneE164(brut)).toBe(attendu);
  });

  it("e-mail : casse et espaces ignores", () => {
    expect(emailNormalise("  Jean.Dupont@Exemple.FR ")).toBe("jean.dupont@exemple.fr");
    expect(emailNormalise("pas-un-email")).toBeNull();
  });

  it("nom + societe : sans accents ni casse, societe vide des deux cotes", () => {
    expect(cleNomSociete("Hélène", "Lefèvre", "BTP Sud")).toBe(cleNomSociete("helene", "LEFEVRE", "btp sud"));
    expect(cleNomSociete("Jean", "Martin", "A")).not.toBe(cleNomSociete("Jean", "Martin", "B"));
    expect(cleNomSociete("", "", null)).toBeNull();
  });

  it("un numero etranger sans indicatif n'est pas rattache a la France", () => {
    const g = grouperDoublons([
      { id: 1, firstName: "A", lastName: "Un", company: null, email: null, phone: "612345678", mobile: null, createdAt: new Date() },
      { id: 2, firstName: "B", lastName: "Deux", company: null, email: null, phone: "+33612345678", mobile: null, createdAt: new Date() },
    ]);
    expect(g).toHaveLength(0);
  });
});

describe("detection des doublons", () => {
  it("rapproche « 06 12 34 56 78 » et « +33612345678 » (motif telephone)", async () => {
    const tel = `06 ${String(stamp).slice(-8).replace(/(\d\d)(?=\d)/g, "$1 ")}`;
    const a = await unContact({ phone: tel });
    const b = await unContact({ phone: telephoneE164(tel)! });
    const r = await request(appli()).get("/api/contacts/doublons");
    expect(r.status).toBe(200);
    const g = r.body.groupes.find((x: any) => x.motif === "telephone" && x.contacts.some((c: any) => c.id === a.id));
    expect(g.contacts.map((c: any) => c.id)).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it("rapproche deux e-mails ne differant que par la casse (motif email)", async () => {
    const a = await unContact({ email: `Paul.${stamp}@Exemple.fr` });
    const b = await unContact({ email: ` paul.${stamp}@exemple.FR` });
    const r = await request(appli()).get(`/api/contacts/${a.id}/doublons`);
    expect(r.status).toBe(200);
    expect(r.body.candidats.find((c: any) => c.id === b.id).motifs).toContain("email");
  });

  it("rapproche nom + societe malgre les accents (motif nom_societe)", async () => {
    const a = await unContact({ firstName: "Hélène", lastName: `Lefèvre${stamp}`, company: "BTP Sud" });
    const b = await unContact({ firstName: "helene", lastName: `LEFEVRE${stamp}`, company: "btp sud" });
    const r = await request(appli()).get(`/api/contacts/${a.id}/doublons`);
    expect(r.body.candidats.find((c: any) => c.id === b.id).motifs).toContain("nom_societe");
  });

  it("ne rapproche jamais deux organisations", async () => {
    const a = await unContact({ email: `croise.${stamp}@exemple.fr` });
    await unContact({ email: `croise.${stamp}@exemple.fr` }, ids.orgB);
    const r = await request(appli()).get(`/api/contacts/${a.id}/doublons`);
    expect(r.body.candidats).toHaveLength(0);
  });

  it("donne pour chaque candidat ce qu'une fusion deplacerait", async () => {
    const a = await unContact({ email: `apercu.${stamp}@exemple.fr` });
    const b = await unContact({ email: `apercu.${stamp}@exemple.fr` });
    await lignesPour(b.id);
    const r = await request(appli()).get(`/api/contacts/${a.id}/doublons`);
    expect(r.body.candidats[0].references).toMatchObject({ calls: 1, devis: 1, messages: 2, tasks: 1 });
  });

  it("rend 404 pour les doublons d'un contact d'une autre organisation", async () => {
    const a = await unContact();
    expect((await request(appliB()).get(`/api/contacts/${a.id}/doublons`)).status).toBe(404);
  });

  it("deux fiches sans rien en commun ne sont pas des doublons", async () => {
    const a = await unContact({ email: `seul1.${stamp}@exemple.fr`, company: "X1" });
    const r = await request(appli()).get(`/api/contacts/${a.id}/doublons`);
    expect(r.body.candidats).toHaveLength(0);
  });
});

describe("fusion de deux fiches", () => {
  it("la liste des references couvre CHAQUE colonne de la base qui designe un contact", async () => {
    const r = await db.execute(sql`
      SELECT table_name AS t, column_name AS c FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name LIKE '%contact_id'
      UNION
      SELECT tc.table_name, kcu.column_name FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'contacts' AND tc.table_schema = 'public'
    `);
    const enBase = (r as unknown as { rows: Array<{ t: string; c: string }> }).rows.map((x) => `${x.t}.${x.c}`).sort();
    const couverts = [...REFERENCES_CONTACT, REFERENCE_COMPTE_CLIENT].map((x) => `${x.table}.${x.colonne}`).sort();
    expect(couverts).toEqual(enBase);
  });

  it("deplace TOUTES les lignes de la fiche absorbee vers la fiche conservee", async () => {
    const garde = await unContact();
    const absorbe = await unContact({ email: `abs.${stamp}@exemple.fr` });
    const lignes = await lignesPour(absorbe.id);
    await db.insert(compteClientTable).values({ organisationId: ids.orgA, contactId: absorbe.id, clientName: "Portail" });
    const r = await request(appli()).post(`/api/contacts/${garde.id}/fusion`).send({ absorbeId: absorbe.id });
    expect(r.status, r.text).toBe(200);
    for (const { table, colonne } of [...REFERENCES_CONTACT, REFERENCE_COMPTE_CLIENT]) {
      const restes = await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE ${sql.identifier(colonne)} = ${absorbe.id}`);
      expect((restes as unknown as { rows: Array<{ n: number }> }).rows[0]!.n, `${table} pointe encore vers la fiche absorbee`).toBe(0);
      const sur = await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE ${sql.identifier(colonne)} = ${garde.id}`);
      expect((sur as unknown as { rows: Array<{ n: number }> }).rows[0]!.n, `${table} n'a pas suivi`).toBeGreaterThan(0);
    }
    expect(r.body.deplaces.messages).toBe(2);
    expect(lignes.calls).toBeGreaterThan(0);
  });

  it("met la fiche absorbee a la corbeille, restaurable", async () => {
    const garde = await unContact();
    const absorbe = await unContact({ lastName: `Restaurable${stamp}` });
    await request(appli()).post(`/api/contacts/${garde.id}/fusion`).send({ absorbeId: absorbe.id });
    expect(await db.select().from(contactsTable).where(eq(contactsTable.id, absorbe.id))).toHaveLength(0);
    const [entree] = await db.select().from(deletedRowsTable)
      .where(and(eq(deletedRowsTable.organisationId, ids.orgA), eq(deletedRowsTable.tableName, "contacts"), eq(deletedRowsTable.rowId, absorbe.id)));
    expect(entree).toBeTruthy();
    expect(await restoreFromTrash(ids.orgA, entree!.id)).toEqual({ ok: true });
    const [revenu] = await db.select().from(contactsTable).where(eq(contactsTable.id, absorbe.id));
    expect(revenu!.lastName).toBe(`Restaurable${stamp}`);
  });

  it("complete les champs vides et met les notes bout a bout, sans rien ecraser", async () => {
    const garde = await unContact({ email: `garde.${stamp}@exemple.fr`, notes: "Note A", tags: ["vip"] });
    const absorbe = await unContact({ email: `autre.${stamp}@exemple.fr`, mobile: "0699999999", company: "SCI Neuve", notes: "Note B", tags: ["toiture"] });
    const r = await request(appli()).post(`/api/contacts/${garde.id}/fusion`).send({ absorbeId: absorbe.id });
    expect(r.body.contact.email).toBe(`garde.${stamp}@exemple.fr`);
    expect(r.body.contact.mobile).toBe("0699999999");
    expect(r.body.contact.company).toBe("SCI Neuve");
    expect(r.body.contact.notes).toContain("Note A");
    expect(r.body.contact.notes).toContain("Note B");
    expect(r.body.contact.tags).toEqual(expect.arrayContaining(["vip", "toiture"]));
  });

  it("refuse une fusion entre organisations (404) et ne touche a rien", async () => {
    const garde = await unContact();
    const etranger = await unContact({}, ids.orgB);
    const lignes = await lignesPour(etranger.id, ids.orgB);
    expect((await request(appli()).post(`/api/contacts/${garde.id}/fusion`).send({ absorbeId: etranger.id })).status).toBe(404);
    expect((await request(appli()).post(`/api/contacts/${etranger.id}/fusion`).send({ absorbeId: garde.id })).status).toBe(404);
    expect(await db.select().from(contactsTable).where(eq(contactsTable.id, etranger.id))).toHaveLength(1);
    expect(await db.select().from(contactsTable).where(eq(contactsTable.id, garde.id))).toHaveLength(1);
    const [appel] = await db.select().from(callsTable).where(eq(callsTable.id, lignes.calls!));
    expect(appel!.contactId).toBe(etranger.id);
  });

  it("ne deplace pas les lignes d'une autre organisation forgees sur la fiche absorbee", async () => {
    const garde = await unContact();
    const absorbe = await unContact();
    const forge = await lignesPour(absorbe.id, ids.orgB);
    await request(appli()).post(`/api/contacts/${garde.id}/fusion`).send({ absorbeId: absorbe.id });
    const [t] = await db.select().from(tasksTable).where(eq(tasksTable.id, forge.tasks!));
    expect(t!.relatedContactId).not.toBe(garde.id);
  });

  it("refuse quand les deux fiches ont un compte client (409), sans rien deplacer", async () => {
    const garde = await unContact();
    const absorbe = await unContact();
    await db.insert(compteClientTable).values([
      { organisationId: ids.orgA, contactId: garde.id, clientName: "A" },
      { organisationId: ids.orgA, contactId: absorbe.id, clientName: "B" },
    ]);
    const lignes = await lignesPour(absorbe.id);
    const r = await request(appli()).post(`/api/contacts/${garde.id}/fusion`).send({ absorbeId: absorbe.id });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("fusion_compte_client_double");
    const [appel] = await db.select().from(callsTable).where(eq(callsTable.id, lignes.calls!));
    expect(appel!.contactId).toBe(absorbe.id);
    expect(await db.select().from(contactsTable).where(eq(contactsTable.id, absorbe.id))).toHaveLength(1);
  });

  it("est refusee a un compte en lecture seule (403)", async () => {
    const garde = await unContact();
    const absorbe = await unContact();
    expect((await request(appli("lecture_seule", ids.lecteur)).post(`/api/contacts/${garde.id}/fusion`).send({ absorbeId: absorbe.id })).status).toBe(403);
    expect(await db.select().from(contactsTable).where(eq(contactsTable.id, absorbe.id))).toHaveLength(1);
  });

  it("est permise a un agent", async () => {
    const garde = await unContact();
    const absorbe = await unContact();
    expect((await request(appli("agent", ids.agent)).post(`/api/contacts/${garde.id}/fusion`).send({ absorbeId: absorbe.id })).status).toBe(200);
  });

  it("refuse de fusionner une fiche avec elle-meme (400)", async () => {
    const c = await unContact();
    const r = await request(appli()).post(`/api/contacts/${c.id}/fusion`).send({ absorbeId: c.id });
    expect(r.status).toBe(400);
    expect(await db.select().from(contactsTable).where(eq(contactsTable.id, c.id))).toHaveLength(1);
  });

  it("deux fusions croisees simultanees : une seule passe, aucune ligne perdue", async () => {
    for (let i = 0; i < 4; i++) {
      const a = await unContact();
      const b = await unContact();
      const la = await lignesPour(a.id);
      const lb = await lignesPour(b.id);
      const [r1, r2] = await Promise.all([
        request(appli()).post(`/api/contacts/${a.id}/fusion`).send({ absorbeId: b.id }),
        request(appli()).post(`/api/contacts/${b.id}/fusion`).send({ absorbeId: a.id }),
      ]);
      expect([r1.status, r2.status].sort(), `essai ${i}`).toEqual([200, 404]);
      const survivant = r1.status === 200 ? a.id : b.id;
      const restants = await db.select().from(contactsTable).where(sql`${contactsTable.id} IN (${a.id}, ${b.id})`);
      expect(restants.map((c) => c.id)).toEqual([survivant]);
      const appels = await db.select().from(callsTable).where(sql`${callsTable.id} IN (${la.calls}, ${lb.calls})`);
      expect(appels.every((c) => c.contactId === survivant)).toBe(true);
    }
  });

  it("journalise la fusion avec le nombre de lignes deplacees par table", async () => {
    const garde = await unContact();
    const absorbe = await unContact();
    await lignesPour(absorbe.id);
    await request(appli()).post(`/api/contacts/${garde.id}/fusion`).send({ absorbeId: absorbe.id });
    await new Promise((r) => setTimeout(r, 100));
    const [log] = await db.select().from(auditLogsTable)
      .where(and(eq(auditLogsTable.action, "contact.fusion"), eq(auditLogsTable.resourceId, String(garde.id))));
    expect(log).toBeTruthy();
    expect((log!.details as any).absorbeId).toBe(absorbe.id);
    expect((log!.details as any).deplaces).toMatchObject({ calls: 1, devis: 1, tasks: 1, face_profiles: 1 });
    expect(log!.userId).toBe(ids.admin);
  });
});

// ===========================================================================
// 3. Prochaine action
// ===========================================================================
describe("prochaine action d'une opportunite", () => {
  it("s'enregistre : texte, date et responsable", async () => {
    const p = await unProspect();
    const quand = new Date(Date.now() + 2 * JOUR).toISOString();
    const r = await request(appli()).patch(`/api/prospects/${p.id}`).send({ nextActionLabel: "Rappeler", nextActionAt: quand, nextActionOwnerId: ids.agent });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ nextActionLabel: "Rappeler", nextActionOwnerId: ids.agent });
    expect(new Date(r.body.nextActionAt).toISOString()).toBe(quand);
  });

  it("refuse un responsable d'une autre organisation (400)", async () => {
    const p = await unProspect();
    const r = await request(appli()).patch(`/api/prospects/${p.id}`).send({ nextActionOwnerId: ids.adminB });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("responsable_inconnu");
  });

  it("refuse une date illisible (400)", async () => {
    const p = await unProspect();
    expect((await request(appli()).patch(`/api/prospects/${p.id}`).send({ nextActionAt: "demain peut-etre" })).status).toBe(400);
  });

  it("une action en retard remonte dans « Aujourd'hui », avec son responsable et son lien", async () => {
    const p = await unProspect({ title: `En retard ${stamp}`, nextActionLabel: "Relancer le devis", nextActionAt: new Date(Date.now() - 3 * JOUR), nextActionOwnerId: ids.agent });
    const m = await construireMasaBugun(ids.orgA);
    const l = m.dosyalar.satirlar.find((s) => s.cle === `sonraki_adim:${p.id}`);
    expect(l).toBeTruthy();
    expect(l).toMatchObject({ tur: "sonraki_adim_gecikti", href: `/prospects/${p.id}`, sorumlu: "agt T", ton: "acil", baslik: "Relancer le devis" });
  });

  it("une action future n'apparait pas dans « Aujourd'hui »", async () => {
    const p = await unProspect({ nextActionLabel: "Plus tard", nextActionAt: new Date(Date.now() + 5 * JOUR) });
    const m = await construireMasaBugun(ids.orgA);
    expect(m.dosyalar.satirlar.some((s) => s.cle === `sonraki_adim:${p.id}`)).toBe(false);
  });

  it("une opportunite gagnee ou perdue n'a plus d'action a relancer", async () => {
    const g = await unProspect({ stage: "gagne", nextActionAt: new Date(Date.now() - JOUR) });
    const pe = await unProspect({ stage: "perdu", nextActionAt: new Date(Date.now() - JOUR) });
    const r = await request(appli()).get("/api/prospects/next-actions");
    const vus = r.body.actions.map((a: any) => a.id);
    expect(vus).not.toContain(g.id);
    expect(vus).not.toContain(pe.id);
  });

  it("n'affiche jamais les actions d'une autre organisation", async () => {
    const b = await unProspect({ nextActionAt: new Date(Date.now() - JOUR) }, ids.orgB);
    const r = await request(appli()).get("/api/prospects/next-actions");
    expect(r.body.actions.map((a: any) => a.id)).not.toContain(b.id);
    const m = await construireMasaBugun(ids.orgA);
    expect(m.dosyalar.satirlar.some((s) => s.cle === `sonraki_adim:${b.id}`)).toBe(false);
  });

  it("next-actions marque le retard et trie du plus ancien au plus recent", async () => {
    const vieux = await unProspect({ nextActionAt: new Date(Date.now() - 10 * JOUR) });
    const r = await request(appli()).get("/api/prospects/next-actions");
    expect(r.status).toBe(200);
    const a = r.body.actions.find((x: any) => x.id === vieux.id);
    expect(a.enRetard).toBe(true);
    const dates = r.body.actions.map((x: any) => Date.parse(x.nextActionAt));
    expect([...dates].sort((x, y) => x - y)).toEqual(dates);
  });

  it("scope=me ne rend que les actions dont la session est responsable", async () => {
    const mienne = await unProspect({ nextActionAt: new Date(Date.now() - JOUR), nextActionOwnerId: ids.agent });
    const autre = await unProspect({ nextActionAt: new Date(Date.now() - JOUR), nextActionOwnerId: ids.admin });
    const r = await request(appli("agent", ids.agent)).get("/api/prospects/next-actions?scope=me");
    const vus = r.body.actions.map((a: any) => a.id);
    expect(vus).toContain(mienne.id);
    expect(vus).not.toContain(autre.id);
  });

  it("effacer la date retire l'action d'« Aujourd'hui »", async () => {
    const p = await unProspect({ nextActionAt: new Date(Date.now() - JOUR) });
    await request(appli()).patch(`/api/prospects/${p.id}`).send({ nextActionAt: null });
    const m = await construireMasaBugun(ids.orgA);
    expect(m.dosyalar.satirlar.some((s) => s.cle === `sonraki_adim:${p.id}`)).toBe(false);
  });

  it("le changement est journalise", async () => {
    const p = await unProspect();
    await request(appli()).patch(`/api/prospects/${p.id}`).send({ nextActionLabel: "Visite" });
    await new Promise((r) => setTimeout(r, 100));
    const [log] = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.action, "prospect.suivi_modifie"), eq(auditLogsTable.resourceId, String(p.id))));
    expect((log!.details as any).champs).toContain("nextActionLabel");
  });

  it("rend 404 pour l'opportunite d'une autre organisation", async () => {
    const p = await unProspect({}, ids.orgB);
    expect((await request(appli()).patch(`/api/prospects/${p.id}`).send({ nextActionLabel: "x" })).status).toBe(404);
  });
});

// ===========================================================================
// 4. Decouverte
// ===========================================================================
describe("liste de decouverte", () => {
  it("se conserve et se relit", async () => {
    const p = await unProspect();
    const liste = { surface: { ok: true, valeur: "85 m2" }, acces: { ok: false } };
    expect((await request(appli()).patch(`/api/prospects/${p.id}`).send({ discoveryChecklist: liste })).status).toBe(200);
    const r = await request(appli()).get(`/api/prospects/${p.id}`);
    expect(r.body.discoveryChecklist).toEqual({ surface: { ok: true, valeur: "85 m2" }, acces: { ok: false, valeur: null } });
  });

  it("refuse un point inconnu (400) plutot que de l'ignorer", async () => {
    const p = await unProspect();
    const r = await request(appli()).patch(`/api/prospects/${p.id}`).send({ discoveryChecklist: { parking: { ok: true } } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("decouverte_invalide");
  });

  it("refuse un etat sans booleen (400)", async () => {
    const p = await unProspect();
    expect((await request(appli()).patch(`/api/prospects/${p.id}`).send({ discoveryChecklist: { surface: "oui" } })).status).toBe(400);
  });

  it("refuse une liste qui n'est pas un objet (400)", async () => {
    const p = await unProspect();
    expect((await request(appli()).patch(`/api/prospects/${p.id}`).send({ discoveryChecklist: ["surface"] })).status).toBe(400);
  });

  it("une opportunite neuve a ses 8 points a confirmer", () => {
    expect(pointsManquants({})).toEqual([...POINTS_DECOUVERTE]);
    expect(POINTS_DECOUVERTE).toHaveLength(8);
  });

  it("pointsManquants ne compte que les points confirmes", () => {
    expect(pointsManquants({ surface: { ok: true }, budget: { ok: false } })).not.toContain("surface");
    expect(pointsManquants({ surface: { ok: true }, budget: { ok: false } })).toContain("budget");
  });

  it("le devis cree depuis l'opportunite avertit des points manquants", async () => {
    const p = await unProspect({ discoveryChecklist: { surface: { ok: true }, adresse_chantier: { ok: true } } });
    const r = await request(appli()).post(`/api/prospects/${p.id}/create-devis`).send({});
    expect(r.status).toBe(201);
    expect(r.body.avertissements.decouverteManquante).toEqual(POINTS_DECOUVERTE.filter((x) => x !== "surface" && x !== "adresse_chantier"));
  });

  it("une decouverte complete ne laisse aucun avertissement", async () => {
    const complete = Object.fromEntries(POINTS_DECOUVERTE.map((k) => [k, { ok: true }]));
    const p = await unProspect({ discoveryChecklist: complete });
    const r = await request(appli()).post(`/api/prospects/${p.id}/create-devis`).send({});
    expect(r.body.avertissements.decouverteManquante).toEqual([]);
  });

  it("le journal garde les points encore manquants", async () => {
    const p = await unProspect();
    await request(appli()).patch(`/api/prospects/${p.id}`).send({ discoveryChecklist: { photos: { ok: true } } });
    await new Promise((r) => setTimeout(r, 100));
    const [log] = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.action, "prospect.suivi_modifie"), eq(auditLogsTable.resourceId, String(p.id))));
    expect((log!.details as any).manquants).not.toContain("photos");
    expect((log!.details as any).manquants).toHaveLength(7);
  });

  it("validerListeDecouverte tronque une valeur trop longue", () => {
    const r = validerListeDecouverte({ acces: { ok: true, valeur: "x".repeat(900) } });
    expect(r.ok && r.valeur.acces?.valeur?.length).toBe(500);
  });

  it("une nouvelle liste remplace l'ancienne", async () => {
    const p = await unProspect({ discoveryChecklist: { surface: { ok: true } } });
    await request(appli()).patch(`/api/prospects/${p.id}`).send({ discoveryChecklist: { budget: { ok: true } } });
    const [row] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, p.id));
    expect(Object.keys(row!.discoveryChecklist as object)).toEqual(["budget"]);
  });
});

// ===========================================================================
// 5. Estimation contre prix verifie
// ===========================================================================
describe("une estimation n'est pas un prix", () => {
  async function devisDepuisEstimation(valeur = "8000.00") {
    const p = await unProspect({ value: valeur, stage: "qualification" });
    const r = await request(appli()).post(`/api/prospects/${p.id}/create-devis`).send({});
    expect(r.status, r.text).toBe(201);
    return { prospect: p, devis: r.body.devis, avertissements: r.body.avertissements };
  }

  it("la ligne de depart est marquee comme estimation", async () => {
    const { devis, avertissements } = await devisDepuisEstimation();
    expect(devis.items).toHaveLength(1);
    expect(devis.items[0]).toMatchObject({ estimate: true, unitPrice: 8000 });
    expect(devis.items[0].description).toMatch(/^Estimation à vérifier — /);
    expect(avertissements.ligneEstimee).toBe(true);
  });

  it("sans valeur estimee, aucune ligne n'est inventee", async () => {
    const p = await unProspect();
    const r = await request(appli()).post(`/api/prospects/${p.id}/create-devis`).send({});
    expect(r.body.devis.items).toEqual([]);
    expect(r.body.avertissements.ligneEstimee).toBe(false);
  });

  it("accepter un devis qui porte encore l'estimation est refuse (409)", async () => {
    const { devis, prospect } = await devisDepuisEstimation();
    const r = await request(appli()).patch(`/api/devis/${devis.id}`).send({ status: "accepte" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("devis_ligne_estimee");
    const [d] = await db.select().from(devisTable).where(eq(devisTable.id, devis.id));
    expect(d!.status).toBe("brouillon");
    expect(d!.acceptedAt).toBeNull();
    const [p] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, prospect.id));
    expect(p!.stage).not.toBe("gagne");
  });

  it("une fois la ligne reprise, l'acceptation passe", async () => {
    const { devis } = await devisDepuisEstimation();
    const reprise = [{ description: "Couverture tuiles, 85 m2", quantity: 85, unitPrice: 92, taxRate: 10 }];
    expect((await request(appli()).patch(`/api/devis/${devis.id}`).send({ items: reprise })).status).toBe(200);
    const r = await request(appli()).patch(`/api/devis/${devis.id}`).send({ status: "accepte" });
    expect(r.status, r.text).toBe(200);
    expect(r.body.status).toBe("accepte");
  });

  it("reprendre la ligne et accepter dans le meme enregistrement est permis", async () => {
    const { devis } = await devisDepuisEstimation();
    const r = await request(appli()).patch(`/api/devis/${devis.id}`).send({ status: "accepte", items: [{ description: "Chiffre", quantity: 1, unitPrice: 7600, taxRate: 20 }] });
    expect(r.status, r.text).toBe(200);
  });

  it("renvoyer les lignes avec le drapeau ne le fait pas disparaitre", async () => {
    const { devis } = await devisDepuisEstimation();
    await request(appli()).patch(`/api/devis/${devis.id}`).send({ items: devis.items, notes: "relu" });
    const r = await request(appli()).patch(`/api/devis/${devis.id}`).send({ status: "accepte" });
    expect(r.status).toBe(409);
  });

  it("envoyer le devis reste possible (seule l'acceptation engage)", async () => {
    const { devis } = await devisDepuisEstimation();
    expect((await request(appli()).patch(`/api/devis/${devis.id}`).send({ status: "envoye" })).status).toBe(200);
  });

  it("l'acceptation groupee saute les devis qui portent une estimation", async () => {
    const { devis } = await devisDepuisEstimation();
    const r = await request(appli()).post("/api/bulk/devis/status").send({ ids: [devis.id], status: "accepte" });
    expect(r.status).toBe(200);
    const [d] = await db.select().from(devisTable).where(eq(devisTable.id, devis.id));
    expect(d!.status).toBe("brouillon");
  });

  it("le recalcul des totaux conserve le drapeau, et ne l'invente pas", () => {
    const t = computeInvoiceTotals([{ description: "a", quantity: 1, unitPrice: 10, taxRate: 20, estimate: true }, { description: "b", quantity: 1, unitPrice: 5, taxRate: 20 }]);
    expect(t.lines[0]!.estimate).toBe(true);
    expect("estimate" in t.lines[1]!).toBe(false);
  });

  it("contientLigneEstimee ne reconnait que le drapeau booleen", () => {
    expect(contientLigneEstimee([{ estimate: true }])).toBe(true);
    expect(contientLigneEstimee([{ estimate: "true" }])).toBe(false);
    expect(contientLigneEstimee(null)).toBe(false);
  });

  it("un devis ordinaire, sans estimation, s'accepte comme avant", async () => {
    const [d] = await db.insert(devisTable).values({ organisationId: ids.orgA, reference: ref("DV"), title: "Ordinaire", clientName: "C", items: [{ description: "x", quantity: 1, unitPrice: 100, taxRate: 20, total: 100 }], status: "brouillon", validUntil: new Date(Date.now() + 30 * JOUR) }).returning();
    expect((await request(appli()).patch(`/api/devis/${d!.id}`).send({ status: "accepte" })).status).toBe(200);
  });
});
