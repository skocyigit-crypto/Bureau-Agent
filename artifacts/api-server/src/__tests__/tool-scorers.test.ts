/**
 * Tests de regression du classement PAR OUTIL (helpers/tool-scorers).
 *
 * helpers/relevance verrouille les primitives PARTAGEES (paliers, normalisation,
 * pipeline de tri). Mais chaque outil de resolution nom -> id de l'assistant
 * (find_contact, find_task, find_event, find_recent_call, find_project) cable sa
 * PROPRE correspondance champ -> palier par-dessus : quels champs comptent comme
 * EXACT vs PREFIX vs SUBSTRING, comment les chiffres du telephone se replient, et
 * le repli Math.max() des scores par champ. Une mauvaise correspondance dans un
 * seul outil passerait quand meme les tests du helper partage tout en resolvant
 * le MAUVAIS enregistrement avant une ecriture.
 *
 * Cette suite verrouille, pour chaque scoreur :
 *   1. le bon resultat en tete pour des requetes exact / prefixe / sous-chaine /
 *      telephone ;
 *   2. l'ordre relatif des paliers par champ ;
 *   3. le repli d'accents et de casse traverse bien chaque outil.
 */
import { describe, expect, it } from "vitest";

import { prepareQuery, rankByRelevance, RELEVANCE } from "../helpers/relevance";
import {
  scoreContact,
  scoreTask,
  scoreEvent,
  scoreCall,
  scoreProject,
  PROJECT_RELEVANCE,
  type ContactScoreRow,
  type TaskScoreRow,
  type EventScoreRow,
  type CallScoreRow,
  type ProjectScoreRow,
} from "../helpers/tool-scorers";

/** Rang du PREMIER resultat (le plus pertinent) apres tri partage. */
function topId<T extends { id: string; createdAt: Date }>(
  rows: T[],
  score: (r: T) => number,
): string {
  const ranked = rankByRelevance(rows, score, { limit: rows.length });
  return ranked[0]!.row.id;
}

// ---------------------------------------------------------------------------
// scoreContact
// ---------------------------------------------------------------------------
describe("scoreContact — find_contact", () => {
  const mk = (
    id: string,
    over: Partial<ContactScoreRow> & { createdAt?: Date } = {},
  ): ContactScoreRow & { id: string; createdAt: Date } => ({
    id,
    firstName: null,
    lastName: null,
    company: null,
    email: null,
    phone: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...over,
  });

  it("classe le nom complet exact (EXACT) au-dessus d'un prefixe de prenom", () => {
    const exact = mk("exact", { firstName: "Ali", lastName: "Yilmaz" });
    const prefix = mk("prefix", { firstName: "Alice", lastName: "Durand" });
    const q = prepareQuery("Ali Yilmaz");
    expect(scoreContact(exact, q)).toBe(RELEVANCE.EXACT);
    expect(topId([prefix, exact], (r) => scoreContact(r, q))).toBe("exact");
  });

  it("accepte le nom complet dans l'ordre inverse (nom prenom)", () => {
    const r = mk("r", { firstName: "Ali", lastName: "Yilmaz" });
    expect(scoreContact(r, prepareQuery("Yilmaz Ali"))).toBe(RELEVANCE.EXACT);
  });

  it("note un champ identifiant unique (prenom/nom/email) en FIELD_EXACT", () => {
    const byFirst = mk("f", { firstName: "Ali", lastName: "Durand" });
    const byEmail = mk("e", { firstName: "Zoe", email: "ali@ex.com" });
    expect(scoreContact(byFirst, prepareQuery("Ali"))).toBe(RELEVANCE.FIELD_EXACT);
    expect(scoreContact(byEmail, prepareQuery("ali@ex.com"))).toBe(RELEVANCE.FIELD_EXACT);
  });

  it("note l'entreprise exacte en COMPANY_EXACT, sous le champ identifiant", () => {
    const r = mk("r", { firstName: "Zoe", company: "Acme" });
    expect(scoreContact(r, prepareQuery("Acme"))).toBe(RELEVANCE.COMPANY_EXACT);
    expect(RELEVANCE.FIELD_EXACT).toBeGreaterThan(RELEVANCE.COMPANY_EXACT);
  });

  it("prefere le prefixe de prenom/nom (PREFIX) au prefixe de nom complet/entreprise (FULL_PREFIX)", () => {
    const namePrefix = mk("name", { firstName: "Alexandre", lastName: "Petit" });
    const q = prepareQuery("Alex");
    expect(scoreContact(namePrefix, q)).toBe(RELEVANCE.PREFIX);
    const companyPrefix = mk("company", { firstName: "Zoe", company: "Alexis SARL" });
    expect(scoreContact(companyPrefix, q)).toBe(RELEVANCE.FULL_PREFIX);
    expect(topId([companyPrefix, namePrefix], (r) => scoreContact(r, q))).toBe("name");
  });

  it("fait gagner un telephone exact (PHONE_EXACT) sur une sous-chaine de nom", () => {
    const phone = mk("phone", { firstName: "Bob", phone: "+33 6 12 34 56 78" });
    const sub = mk("sub", { firstName: "Jean", lastName: "33612" });
    const q = prepareQuery("+33 6 12 34 56 78");
    expect(scoreContact(phone, q)).toBe(RELEVANCE.PHONE_EXACT);
    expect(topId([sub, phone], (r) => scoreContact(r, q))).toBe("phone");
  });

  it("note une sous-chaine (nom complet/entreprise/email) en FIELD_SUBSTRING", () => {
    const r = mk("r", { firstName: "Marie", lastName: "Bernardin" });
    expect(scoreContact(r, prepareQuery("ernar"))).toBe(RELEVANCE.FIELD_SUBSTRING);
  });

  it("ignore une requete telephone trop courte (< 3 chiffres)", () => {
    const r = mk("r", { firstName: "Zoe", phone: "+33612345678" });
    expect(scoreContact(r, prepareQuery("06"))).toBe(0);
  });

  it("est insensible aux accents et a la casse", () => {
    const r = mk("r", { firstName: "Léa", lastName: "Léveque" });
    expect(scoreContact(r, prepareQuery("LEA LEVEQUE"))).toBe(RELEVANCE.EXACT);
  });
});

// ---------------------------------------------------------------------------
// scoreTask
// ---------------------------------------------------------------------------
describe("scoreTask — find_task", () => {
  const mk = (
    id: string,
    over: Partial<TaskScoreRow> & { createdAt?: Date } = {},
  ): TaskScoreRow & { id: string; createdAt: Date } => ({
    id,
    title: null,
    description: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...over,
  });

  it("ordonne titre exact > prefixe > sous-chaine > description", () => {
    const q = prepareQuery("devis");
    expect(scoreTask(mk("x", { title: "devis" }), q)).toBe(RELEVANCE.EXACT);
    expect(scoreTask(mk("x", { title: "devis cuisine" }), q)).toBe(RELEVANCE.PREFIX);
    expect(scoreTask(mk("x", { title: "envoyer devis" }), q)).toBe(RELEVANCE.SUBSTRING);
    expect(scoreTask(mk("x", { title: "autre", description: "le devis" }), q)).toBe(
      RELEVANCE.DESC_SUBSTRING,
    );
  });

  it("choisit le titre exact face a un titre seulement prefixe", () => {
    const exact = mk("exact", { title: "devis" });
    const prefix = mk("prefix", { title: "devis cuisine" });
    const q = prepareQuery("devis");
    expect(topId([prefix, exact], (r) => scoreTask(r, q))).toBe("exact");
  });

  it("ne classe pas une tache sans correspondance (score 0)", () => {
    expect(scoreTask(mk("x", { title: "facture" }), prepareQuery("devis"))).toBe(0);
  });

  it("est insensible aux accents et a la casse", () => {
    expect(scoreTask(mk("x", { title: "Réunion Équipe" }), prepareQuery("reunion equipe"))).toBe(
      RELEVANCE.EXACT,
    );
  });
});

// ---------------------------------------------------------------------------
// scoreEvent
// ---------------------------------------------------------------------------
describe("scoreEvent — find_event", () => {
  const mk = (
    id: string,
    over: Partial<EventScoreRow> & { createdAt?: Date } = {},
  ): EventScoreRow & { id: string; createdAt: Date } => ({
    id,
    title: null,
    description: null,
    location: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...over,
  });

  it("ordonne titre exact > prefixe > sous-chaine > lieu > description", () => {
    const q = prepareQuery("chantier");
    expect(scoreEvent(mk("x", { title: "chantier" }), q)).toBe(RELEVANCE.EXACT);
    expect(scoreEvent(mk("x", { title: "chantier nord" }), q)).toBe(RELEVANCE.PREFIX);
    expect(scoreEvent(mk("x", { title: "visite chantier" }), q)).toBe(RELEVANCE.SUBSTRING);
    expect(scoreEvent(mk("x", { title: "rdv", location: "chantier rue X" }), q)).toBe(
      RELEVANCE.FIELD_SUBSTRING,
    );
    expect(scoreEvent(mk("x", { title: "rdv", description: "voir chantier" }), q)).toBe(
      RELEVANCE.DESC_SUBSTRING,
    );
  });

  it("place le lieu (FIELD_SUBSTRING) au-dessus de la description (DESC_SUBSTRING)", () => {
    const loc = mk("loc", { title: "rdv", location: "paris" });
    const desc = mk("desc", { title: "rdv", description: "paris" });
    const q = prepareQuery("paris");
    expect(scoreEvent(loc, q)).toBeGreaterThan(scoreEvent(desc, q));
  });

  it("est insensible aux accents et a la casse", () => {
    expect(scoreEvent(mk("x", { title: "Réunion" }), prepareQuery("reunion"))).toBe(
      RELEVANCE.EXACT,
    );
  });
});

// ---------------------------------------------------------------------------
// scoreCall
// ---------------------------------------------------------------------------
describe("scoreCall — find_recent_call", () => {
  const mk = (
    id: string,
    over: Partial<CallScoreRow> & { createdAt?: Date } = {},
  ): CallScoreRow & { id: string; createdAt: Date } => ({
    id,
    contactName: null,
    phoneNumber: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...over,
  });

  it("ordonne nom exact > prefixe > sous-chaine", () => {
    const q = prepareQuery("ali yilmaz");
    expect(scoreCall(mk("x", { contactName: "Ali Yilmaz" }), q)).toBe(RELEVANCE.EXACT);
    expect(scoreCall(mk("x", { contactName: "Ali Yilmaz Junior" }), q)).toBe(RELEVANCE.PREFIX);
    expect(scoreCall(mk("x", { contactName: "M. Ali Yilmaz" }), q)).toBe(RELEVANCE.SUBSTRING);
  });

  it("fait gagner le telephone exact (PHONE_EXACT) sur une sous-chaine de nom", () => {
    const phone = mk("phone", { contactName: "Inconnu", phoneNumber: "+33 6 12 34 56 78" });
    const q = prepareQuery("+33 6 12 34 56 78");
    expect(scoreCall(phone, q)).toBe(RELEVANCE.PHONE_EXACT);
  });

  it("note le telephone partiel (PHONE_PARTIAL) au-dessus du nom prefixe", () => {
    const r = mk("r", { contactName: "Zoe", phoneNumber: "+33612345678" });
    expect(scoreCall(r, prepareQuery("345"))).toBe(RELEVANCE.PHONE_PARTIAL);
    expect(RELEVANCE.PHONE_PARTIAL).toBeGreaterThan(RELEVANCE.PREFIX);
  });

  it("ne plante pas quand contactName est absent", () => {
    expect(scoreCall(mk("x", { contactName: null }), prepareQuery("ali"))).toBe(0);
  });

  it("est insensible aux accents et a la casse", () => {
    expect(scoreCall(mk("x", { contactName: "Léveque" }), prepareQuery("LEVEQUE"))).toBe(
      RELEVANCE.EXACT,
    );
  });
});

// ---------------------------------------------------------------------------
// scoreProject
// ---------------------------------------------------------------------------
describe("scoreProject — find_project", () => {
  const mk = (
    id: string,
    over: Partial<ProjectScoreRow> & { createdAt?: Date } = {},
  ): ProjectScoreRow & { id: string; createdAt: Date } => ({
    id,
    title: null,
    clientName: null,
    clientCompany: null,
    address: null,
    description: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...over,
  });

  it("ordonne titre exact > prefixe > sous-chaine", () => {
    const q = prepareQuery("cuisine");
    expect(scoreProject(mk("x", { title: "cuisine" }), q)).toBe(PROJECT_RELEVANCE.TITLE_EXACT);
    expect(scoreProject(mk("x", { title: "cuisine dupont" }), q)).toBe(PROJECT_RELEVANCE.TITLE_PREFIX);
    expect(scoreProject(mk("x", { title: "renovation cuisine" }), q)).toBe(
      PROJECT_RELEVANCE.TITLE_SUBSTRING,
    );
  });

  it("classe client > societe > adresse > description pour une sous-chaine", () => {
    const q = prepareQuery("dupont");
    const client = scoreProject(mk("x", { title: "t", clientName: "Dupont" }), q);
    const company = scoreProject(mk("x", { title: "t", clientCompany: "Dupont SARL" }), q);
    const addr = scoreProject(mk("x", { title: "t", address: "rue Dupont" }), q);
    const desc = scoreProject(mk("x", { title: "t", description: "chez Dupont" }), q);
    expect(client).toBeGreaterThan(company);
    expect(company).toBeGreaterThan(addr);
    expect(addr).toBeGreaterThan(desc);
    expect(client).toBe(PROJECT_RELEVANCE.CLIENT_SUBSTRING);
    expect(company).toBe(PROJECT_RELEVANCE.COMPANY_SUBSTRING);
    expect(addr).toBe(PROJECT_RELEVANCE.ADDRESS_SUBSTRING);
    expect(desc).toBe(PROJECT_RELEVANCE.DESC_SUBSTRING);
  });

  it("place le titre sous-chaine au-dessus de toute correspondance client", () => {
    const titleSub = mk("title", { title: "cuisine Dupont" });
    const clientSub = mk("client", { title: "autre", clientName: "Dupont" });
    const q = prepareQuery("dupont");
    expect(topId([clientSub, titleSub], (r) => scoreProject(r, q))).toBe("title");
  });

  it("est insensible aux accents et a la casse", () => {
    expect(scoreProject(mk("x", { title: "Rénovation Étage" }), prepareQuery("renovation etage"))).toBe(
      PROJECT_RELEVANCE.TITLE_EXACT,
    );
  });
});
