/**
 * Accepter un devis engage l'entreprise : on sait QUI, et le prix ne bouge plus.
 *
 * DECISIONS PRISES ICI, et pourquoi elles le sont ainsi.
 *
 * 1. COMMENT L'ACCEPTATION EST ETABLIE. Par un nom, une date et une ligne de
 *    journal — pas par un PDF signe televerse ni par un lien envoye au
 *    client. Ces deux-la sont des fonctionnalites, pas des preuves : un PDF
 *    televerse ne dit pas qui l'a televerse, et il faudrait de toute facon la
 *    meme trace nominative en dessous. Le minimum qui rende le mot
 *    « accepte » opposable, c'est de pouvoir repondre a la question qu'on
 *    pose le jour d'un differend : qui a dit oui, et quand.
 *
 *    La date existait deja. Le NOM manquait : un devis pouvait porter
 *    « accepte le 12 mars » sans qu'on sache de qui venait l'engagement.
 *
 * 2. QUI PEUT ACCEPTER. Le plancher de mutation du serveur laisse passer le
 *    role `agent`, qui prepare les devis — et pouvait donc lier l'entreprise
 *    a un prix. Accepter rejoint les actions reservees a l'administration,
 *    comme les reglages de securite ou la facturation. Un agent prepare, un
 *    administrateur engage.
 *
 * 3. UN DEVIS ACCEPTE NE CHANGE PLUS DE PRIX. Laisser modifier les lignes ou
 *    le total apres coup revient a reecrire un accord sans que rien ne le
 *    dise — ni au client, ni au dossier. Les champs commerciaux sont figes.
 *    Ce qui reste modifiable : notes, conditions, coordonnees. Corriger un
 *    numero de telephone n'est pas renegocier.
 *
 *    La sortie n'est pas bloquee : refuser le devis rouvre le dossier, et un
 *    nouveau devis porte le nouveau prix. C'est la forme que prend une
 *    renegociation quand elle laisse une trace.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, devisTable, organisationsTable, usersTable } from "@workspace/db";
import routeur from "../routes/devis";

const JOUR = 86_400_000;
const stamp = Date.now();
let orgId = 0;
const users: Record<string, number> = {};

function appli(role: string) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = {
      userId: users[role], organisationId: orgId, userRole: role,
      userEmail: `${role}-${stamp}@example.test`,
    };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", routeur);
  return a;
}

async function devis(v: Record<string, unknown> = {}) {
  const [d] = await db.insert(devisTable).values({
    organisationId: orgId, reference: `DEV-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Ravalement", clientName: "SCI Duval", status: "envoye",
    validUntil: new Date(Date.now() + 30 * JOUR),
    totalAmount: "5000.00", subtotal: "5000.00", taxAmount: "0.00",
    createdBy: users.administrateur, ...v,
  } as any).returning();
  return d!;
}
const relire = async (id: number) =>
  (await db.select().from(devisTable).where(eq(devisTable.id, id)))[0]!;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Acceptation ${stamp}`, slug: `accept-${stamp}`, maxUsers: 10, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  for (const role of ["administrateur", "agent", "super_admin"]) {
    const [u] = await db.insert(usersTable).values({
      organisationId: orgId, email: `${role}-${stamp}@example.test`, passwordHash: "x",
      prenom: role, nom: "Test", role, actif: true,
    }).returning({ id: usersTable.id });
    users[role] = u!.id;
  }
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(devisTable).where(eq(devisTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* au mieux */ }
});

const accepter = (role: string, id: number, corps: Record<string, unknown> = {}) =>
  request(appli(role)).patch(`/api/devis/${id}`).send({ status: "accepte", ...corps });

describe("on sait qui a accepte", () => {
  it("le nom de celui qui accepte est enregistre", async () => {
    const d = await devis();
    const r = await accepter("administrateur", d.id);
    expect(r.status, r.text).toBe(200);
    expect((await relire(d.id)).acceptedBy).toBe(users.administrateur);
  });

  it("la date aussi", async () => {
    const d = await devis();
    await accepter("administrateur", d.id);
    expect((await relire(d.id)).acceptedAt).toBeInstanceOf(Date);
  });

  it("un devis non accepte n'a personne", async () => {
    // Le controle negatif : si la colonne etait remplie a la creation, le
    // premier test passerait sans rien prouver.
    const d = await devis();
    expect((await relire(d.id)).acceptedBy).toBeNull();
  });

  it("refuser un devis n'y inscrit personne", async () => {
    const d = await devis();
    await request(appli("administrateur")).patch(`/api/devis/${d.id}`).send({ status: "refuse" });
    const apres = await relire(d.id);
    expect(apres.status).toBe("refuse");
    expect(apres.acceptedBy).toBeNull();
  });
});

describe("un agent prepare, un administrateur engage", () => {
  it("un agent ne peut pas accepter", async () => {
    const d = await devis();
    const r = await accepter("agent", d.id);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("acceptation_reservee");
  });

  it("et le devis n'a pas bouge en base", async () => {
    // Un 403 rendu APRES ecriture serait pire qu'un 200.
    const d = await devis();
    await accepter("agent", d.id);
    const apres = await relire(d.id);
    expect(apres.status).toBe("envoye");
    expect(apres.acceptedBy).toBeNull();
  });

  it("le refus nomme ce qu'il faut faire", async () => {
    const r = await accepter("agent", (await devis()).id);
    expect(String(r.body.remediation)).toMatch(/administrateur/);
  });

  it("un super-admin le peut", async () => {
    const d = await devis();
    expect((await accepter("super_admin", d.id)).status).toBe(200);
  });

  it("un agent garde le droit de PREPARER un devis", async () => {
    // La restriction porte sur l'engagement, pas sur le travail commercial.
    const d = await devis();
    const r = await request(appli("agent")).patch(`/api/devis/${d.id}`)
      .send({ items: [{ description: "Echafaudage", quantity: 1, unitPrice: 6000 }] });
    expect(r.status, r.text).toBe(200);
    expect((await relire(d.id)).totalAmount).toBe("6000.00");
  });

  it("et celui de le refuser", async () => {
    const d = await devis();
    const r = await request(appli("agent")).patch(`/api/devis/${d.id}`).send({ status: "refuse" });
    expect(r.status, r.text).toBe(200);
  });
});

describe("un devis accepte ne change plus de prix", () => {
  const accepte = async () => {
    const d = await devis();
    await accepter("administrateur", d.id);
    return d;
  };

  // MESURE SUR CETTE ROUTE : les totaux sont recalcules cote serveur a
  // partir des LIGNES. `totalAmount` envoye directement est ignore — il ne
  // figure pas dans la liste des champs appliques. Le vecteur reel d un
  // changement de prix est donc `items`, et `currency` pour la devise.
  //
  // J avais d abord fige les quatre champs, dont trois qu on ne peut pas
  // ecrire. Le test l a dit : « un devis non accepte se modifie librement »
  // est tombe parce que l ecriture directe de `totalAmount` ne prend pas,
  // acceptation ou non.
  it.each(["items", "currency"])(
    "%s est refuse apres acceptation",
    async (champ) => {
      const d = await accepte();
      const corps: Record<string, unknown> = { [champ]: champ === "items" ? [] : "USD" };
      const r = await request(appli("administrateur")).patch(`/api/devis/${d.id}`).send(corps);
      expect(r.status, `${champ} : ${r.text}`).toBe(409);
      expect(r.body.code).toBe("devis_accepte_fige");
    },
  );

  it("le montant est intact en base apres une tentative", async () => {
    const d = await accepte();
    await request(appli("administrateur")).patch(`/api/devis/${d.id}`)
      .send({ items: [{ description: "Autre chose", quantity: 1, unitPrice: 9999 }] });
    expect((await relire(d.id)).totalAmount).toBe("5000.00");
  });

  it("le refus nomme le champ touche et la sortie", async () => {
    const d = await accepte();
    const r = await request(appli("administrateur")).patch(`/api/devis/${d.id}`)
      .send({ items: [{ description: "Autre chose", quantity: 1, unitPrice: 9999 }] });
    expect(r.body.champs).toContain("items");
    expect(String(r.body.remediation)).toMatch(/nouveau/);
  });

  it("corriger un telephone reste possible — ce n'est pas renegocier", async () => {
    const d = await accepte();
    const r = await request(appli("administrateur")).patch(`/api/devis/${d.id}`)
      .send({ clientPhone: "0102030405", notes: "Rappeler le client" });
    expect(r.status, r.text).toBe(200);
  });

  it("refuser un devis accepte reste possible — c'est la sortie annoncee", async () => {
    // Sans cette sortie, un prix errone serait fige pour toujours.
    const d = await accepte();
    const r = await request(appli("administrateur")).patch(`/api/devis/${d.id}`).send({ status: "refuse" });
    expect(r.status, r.text).toBe(200);
  });

  it("un devis NON accepte se modifie librement", async () => {
    // Le controle negatif du blocage : sans lui, une route qui refuserait
    // tout ferait passer les tests ci-dessus.
    const d = await devis();
    const r = await request(appli("administrateur")).patch(`/api/devis/${d.id}`)
      .send({ items: [{ description: "Ravalement", quantity: 1, unitPrice: 7000 }] });
    expect(r.status, r.text).toBe(200);
    expect((await relire(d.id)).totalAmount).toBe("7000.00");
  });
});
