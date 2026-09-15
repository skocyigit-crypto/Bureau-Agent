/**
 * Le registre des depenses: cloisonnement, roles, et arithmetique de TVA.
 *
 * Ce registre porte la TVA deductible d'une PME du BTP. Trois familles de
 * defauts y sont silencieuses, et aucune n'etait couverte:
 *
 *   1. Le cloisonnement. Chaque route filtre par `organisationId`, mais c'est
 *      une condition qu'on peut oublier dans un `where` sans qu'aucun test ne
 *      change de couleur. Une depense modifiee ou supprimee d'une autre
 *      organisation ne produit pas d'erreur: elle produit une reussite.
 *
 *   2. Le plancher de role. La suppression est reservee aux responsables, la
 *      saisie est ouverte aux agents. Rien ne le rappelle a la relecture:
 *      `requireRole(...)` est une ligne qui se deplace facilement.
 *
 *   3. L'arithmetique. Les tests ci-dessous FIXENT le comportement quand on
 *      ne saisit qu'un montant TTC — le cas le plus courant, puisque c'est le
 *      chiffre imprime en gras sur un ticket. Le registre en deduit alors
 *      HT = TTC et TVA = 0. Ce n'est pas un choix anodin: la TVA d'une
 *      depense est recuperable, et une ligne a zero ne se reclame pas. Le
 *      test l'ecrit noir sur blanc pour que ce comportement soit un choix
 *      assume, verifiable, et non une surprise decouverte par un comptable.
 *
 * La detection de doublon est testee separement: elle ne bloque pas la
 * saisie, elle la signale. C'est deliberé — deux factures identiques d'un
 * meme fournisseur le meme jour existent vraiment — mais cela n'a de valeur
 * que si le signal est effectivement leve.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, depensesTable, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";

const marque = Date.now();
const orgsCreees: number[] = [];

interface Compte {
  id: number;
  token: string;
}

async function creerOrg(tag: string): Promise<number> {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `Depenses ${tag} ${marque}`,
      slug: `depenses-${tag}-${marque}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgsCreees.push(org.id);
  return org.id;
}

async function creerCompte(tag: string, role: string, organisationId: number): Promise<Compte> {
  const email = `depenses-${tag}-${marque}@example.test`;
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: "x",
      nom: "Test",
      prenom: "User",
      role,
      organisationId,
      actif: true,
    })
    .returning({ id: usersTable.id });
  return {
    id: row.id,
    token: mintApiToken({
      userId: row.id,
      userRole: role,
      organisationId,
      userEmail: email,
      prenom: "Test",
      nom: "User",
    }),
  };
}

function appel(methode: "get" | "post" | "patch" | "delete", chemin: string, token: string) {
  return request(app)[methode](chemin)
    .set("Authorization", `Bearer ${token}`)
    .set("Origin", "http://localhost");
}

let orgA: number;
let orgB: number;
let agentA: Compte;
let adminA: Compte;
let adminB: Compte;

beforeAll(async () => {
  orgA = await creerOrg("a");
  orgB = await creerOrg("b");
  agentA = await creerCompte("agent-a", "agent", orgA);
  adminA = await creerCompte("admin-a", "administrateur", orgA);
  adminB = await creerCompte("admin-b", "administrateur", orgB);
});

afterAll(async () => {
  for (const id of orgsCreees) {
    try {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, id));
    } catch {
      // Le nettoyage ne doit jamais faire echouer la suite.
    }
  }
});

/** Cree une depense via l'API et renvoie la reponse complete. */
async function creerDepense(
  token: string,
  corps: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await appel("post", "/api/depenses", token).send(corps);
  return { status: res.status, body: res.body };
}

describe("la saisie d'une depense", () => {
  it("exige un fournisseur", async () => {
    const r = await creerDepense(agentA.token, { amountTtc: 120 });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/fournisseur/i);
  });

  it("exige un montant", async () => {
    const r = await creerDepense(agentA.token, { vendor: "Point P" });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/montant/i);
  });

  it("accepte une depense complete et la rattache a l'organisation de l'auteur", async () => {
    const r = await creerDepense(agentA.token, {
      vendor: "Point P",
      amountHt: 100,
      amountTva: 20,
      amountTtc: 120,
      category: "materiaux",
      expenseDate: "2026-09-01",
    });
    expect(r.status).toBe(201);
    const d = r.body.depense as Record<string, unknown>;
    expect(d.organisationId).toBe(orgA);
    expect(Number(d.amountHt)).toBeCloseTo(100, 2);
    expect(Number(d.amountTva)).toBeCloseTo(20, 2);
    expect(Number(d.amountTtc)).toBeCloseTo(120, 2);
  });

  it("entre en file d'inspection par defaut, pas au registre", async () => {
    // Une depense saisie n'est pas une depense validee: c'est le sens meme de
    // la file d'inspection. La faire entrer directement en « approuve »
    // supprimerait le controle sans supprimer le bouton.
    const r = await creerDepense(agentA.token, { vendor: "Brico", amountTtc: 50 });
    expect(r.status).toBe(201);
    expect((r.body.depense as Record<string, unknown>).status).toBe("en_attente");
  });

  it("refuse une categorie inventee en retombant sur « autre »", async () => {
    // Une categorie libre casserait les statistiques et l'export comptable.
    const r = await creerDepense(agentA.token, {
      vendor: "Divers",
      amountTtc: 10,
      category: "categorie-qui-n-existe-pas",
    });
    expect(r.status).toBe(201);
    expect((r.body.depense as Record<string, unknown>).category).toBe("autre");
  });
});

describe("l'arithmetique des montants", () => {
  it("deduit le TTC quand seuls le HT et la TVA sont saisis", async () => {
    const r = await creerDepense(agentA.token, { vendor: "Rexel", amountHt: 200, amountTva: 40 });
    expect(r.status).toBe(201);
    expect(Number((r.body.depense as Record<string, unknown>).amountTtc)).toBeCloseTo(240, 2);
  });

  it("n'invente aucune TVA quand seul le TTC est saisi", async () => {
    // Comportement FIXE, et consequent: avec seulement 120 EUR TTC saisis, le
    // registre enregistre HT = 120 et TVA = 0. Le logiciel ne connait pas le
    // taux applicable et refuse de le deviner — mais la TVA d'une depense est
    // recuperable, et une ligne a zero ne se reclame pas.
    //
    // Si ce comportement change un jour (par exemple: deduire 20 % par
    // defaut), ce test doit tomber, et le changement doit etre voulu.
    const r = await creerDepense(agentA.token, { vendor: "Ticket", amountTtc: 120 });
    expect(r.status).toBe(201);
    const d = r.body.depense as Record<string, unknown>;
    expect(Number(d.amountTtc)).toBeCloseTo(120, 2);
    expect(Number(d.amountHt)).toBeCloseTo(120, 2);
    expect(Number(d.amountTva)).toBeCloseTo(0, 2);
  });

  it("ne laisse jamais un montant negatif entrer au registre", async () => {
    const r = await creerDepense(agentA.token, {
      vendor: "Avoir",
      amountTtc: 100,
      amountTva: -50,
    });
    expect(r.status).toBe(201);
    const d = r.body.depense as Record<string, unknown>;
    expect(Number(d.amountHt)).toBeGreaterThanOrEqual(0);
    expect(Number(d.amountTva)).toBeGreaterThanOrEqual(0);
  });
});

describe("la detection de doublon", () => {
  it("signale une seconde saisie identique sans la bloquer", async () => {
    // Bloquer serait faux: deux factures identiques du meme fournisseur le
    // meme jour existent vraiment. Mais un signal qui ne se leve pas ne vaut
    // rien — c'est la moitié qui casse en silence.
    const corps = { vendor: `Doublon ${marque}`, amountTtc: 333.33, expenseDate: "2026-08-12" };
    const premier = await creerDepense(agentA.token, corps);
    expect(premier.status).toBe(201);
    expect(premier.body.duplicate).toBe(false);

    const second = await creerDepense(agentA.token, corps);
    expect(second.status).toBe(201);
    expect(second.body.duplicate).toBe(true);
    expect((second.body.depense as Record<string, unknown>).duplicateOfId).toBe(
      (premier.body.depense as Record<string, unknown>).id,
    );
  });

  it("ne confond pas les organisations", async () => {
    // Une empreinte partagee entre organisations ferait apparaitre, chez un
    // client, une depense d'un autre comme « doublon presume ».
    const corps = { vendor: `Inter-org ${marque}`, amountTtc: 777.77, expenseDate: "2026-08-13" };
    const chezA = await creerDepense(agentA.token, corps);
    const chezB = await creerDepense(adminB.token, corps);
    expect(chezA.body.duplicate).toBe(false);
    expect(chezB.body.duplicate).toBe(false);
  });
});

describe("le cloisonnement entre organisations", () => {
  let depenseA: number;

  beforeAll(async () => {
    const r = await creerDepense(agentA.token, { vendor: "Cloison", amountTtc: 99 });
    depenseA = (r.body.depense as Record<string, number>).id;
  });

  it("une depense d'une autre organisation n'est pas listee", async () => {
    const res = await appel("get", "/api/depenses", adminB.token);
    expect(res.status).toBe(200);
    const ids = (res.body.depenses as Array<{ id: number }> | undefined) ?? [];
    expect(ids.some((d) => d.id === depenseA)).toBe(false);
  });

  it("une depense d'une autre organisation ne se modifie pas", async () => {
    const res = await appel("patch", `/api/depenses/${depenseA}`, adminB.token).send({
      vendor: "Detourne",
    });
    expect(res.status).toBe(404);
    const [apres] = await db
      .select()
      .from(depensesTable)
      .where(eq(depensesTable.id, depenseA));
    expect(apres.vendor).toBe("Cloison");
  });

  it("une depense d'une autre organisation ne s'approuve pas", async () => {
    const res = await appel("post", `/api/depenses/${depenseA}/approve`, adminB.token).send({});
    expect(res.status).toBe(404);
    const [apres] = await db
      .select()
      .from(depensesTable)
      .where(eq(depensesTable.id, depenseA));
    expect(apres.status).toBe("en_attente");
  });

  it("une depense d'une autre organisation ne se supprime pas", async () => {
    const res = await appel("delete", `/api/depenses/${depenseA}`, adminB.token);
    expect(res.status).toBe(404);
    const restantes = await db
      .select()
      .from(depensesTable)
      .where(eq(depensesTable.id, depenseA));
    expect(restantes.length, "la depense a ete supprimee par une autre organisation").toBe(1);
  });
});

describe("le plancher de role", () => {
  it("un agent ne peut pas supprimer une depense", async () => {
    // La suppression est definitive et sort une piece du registre. Elle est
    // reservee aux responsables.
    const r = await creerDepense(agentA.token, { vendor: "A supprimer", amountTtc: 12 });
    const id = (r.body.depense as Record<string, number>).id;
    const res = await appel("delete", `/api/depenses/${id}`, agentA.token);
    expect(res.status).toBe(403);
    const restantes = await db.select().from(depensesTable).where(eq(depensesTable.id, id));
    expect(restantes.length).toBe(1);
  });

  it("un responsable le peut", async () => {
    const r = await creerDepense(agentA.token, { vendor: "A supprimer 2", amountTtc: 12 });
    const id = (r.body.depense as Record<string, number>).id;
    const res = await appel("delete", `/api/depenses/${id}`, adminA.token);
    expect(res.status).toBe(200);
    const restantes = await db.select().from(depensesTable).where(eq(depensesTable.id, id));
    expect(restantes.length).toBe(0);
  });
});

describe("la correction d'une depense", () => {
  it("refuse une requete qui ne change rien", async () => {
    // Sans ce refus, l'interface peut croire avoir enregistre une correction
    // que personne n'a ecrite.
    const r = await creerDepense(agentA.token, { vendor: "Corrigeable", amountTtc: 60 });
    const id = (r.body.depense as Record<string, number>).id;
    const res = await appel("patch", `/api/depenses/${id}`, agentA.token).send({
      champInconnu: "valeur",
    });
    expect(res.status).toBe(400);
  });

  it("recalcule le doublon quand le montant change", async () => {
    // Corriger un montant peut CREER un doublon avec une piece deja saisie.
    // Si l'empreinte n'est pas recalculee, le signal reste eteint pour
    // toujours.
    const date = "2026-07-04";
    const vendeur = `Recalcul ${marque}`;
    const original = await creerDepense(agentA.token, {
      vendor: vendeur,
      amountTtc: 500,
      expenseDate: date,
    });
    const autre = await creerDepense(agentA.token, {
      vendor: vendeur,
      amountTtc: 501,
      expenseDate: date,
    });
    expect(autre.body.duplicate).toBe(false);

    const id = (autre.body.depense as Record<string, number>).id;
    const res = await appel("patch", `/api/depenses/${id}`, agentA.token).send({ amountTtc: 500 });
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect((res.body.depense as Record<string, unknown>).duplicateOfId).toBe(
      (original.body.depense as Record<string, number>).id,
    );
  });

  it("refuse un identifiant qui n'en est pas un", async () => {
    const res = await appel("patch", "/api/depenses/zero", agentA.token).send({ vendor: "x" });
    expect(res.status).toBe(400);
  });
});

describe("l'approbation", () => {
  it("fait passer la depense au registre et note qui a valide", async () => {
    // Sans trace du valideur, un controle ne peut plus remonter la chaine de
    // responsabilite.
    const r = await creerDepense(agentA.token, { vendor: "A valider", amountTtc: 42 });
    const id = (r.body.depense as Record<string, number>).id;
    const res = await appel("post", `/api/depenses/${id}/approve`, adminA.token).send({});
    expect(res.status).toBe(200);
    const d = res.body.depense as Record<string, unknown>;
    expect(d.status).toBe("approuve");
    expect(d.reviewedBy).toBe(adminA.id);
    expect(d.reviewedAt).toBeTruthy();
  });

  it("le rejet ecarte la depense sans la detruire", async () => {
    // Ecarter n'est pas supprimer: la piece reste consultable, et le rejet
    // doit pouvoir etre explique.
    const r = await creerDepense(agentA.token, { vendor: "A rejeter", amountTtc: 42 });
    const id = (r.body.depense as Record<string, number>).id;
    const res = await appel("post", `/api/depenses/${id}/reject`, adminA.token).send({});
    expect(res.status).toBe(200);
    expect((res.body.depense as Record<string, unknown>).status).toBe("rejete");
    const restantes = await db.select().from(depensesTable).where(eq(depensesTable.id, id));
    expect(restantes.length).toBe(1);
  });

  it("une depense inexistante renvoie 404, pas une reussite vide", async () => {
    const res = await appel("post", "/api/depenses/999999999/approve", adminA.token).send({});
    expect(res.status).toBe(404);
  });
});
