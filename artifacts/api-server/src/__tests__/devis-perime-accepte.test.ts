/**
 * Accepter un devis perime est refuse, comme le convertir l'est deja.
 *
 * La meme decision existait sur UN des deux chemins. Convertir un devis
 * echu en facture rendait 409 « validite depassee », avec la raison : la
 * duree de validite est ce qui protege l'entreprise contre la hausse du cout
 * des materiaux. Mais `PATCH /devis/:id` avec `status: "accepte"` ne
 * regardait rien.
 *
 * On pouvait donc marquer « accepte » un devis de l'an dernier. La fiche
 * l'affichait accepte, il comptait dans le taux d'acceptation, et
 * l'utilisateur n'apprenait qu'a l'etape facture — parfois des semaines plus
 * tard, apres avoir annonce l'accord au client — que son acceptation ne
 * valait rien.
 *
 * Une meme decision appliquee a un chemin et pas a l'autre coute plus cher
 * que pas de decision du tout : on croit le sujet traite, et on ne le
 * reexamine plus.
 *
 * CE QUE CE CORRECTIF NE DECIDE PAS : si l'entreprise veut honorer un vieux
 * prix, elle le peut — en prolongeant la date de validite, ce que la reponse
 * 409 nomme explicitement. Le code ne tranche pas a sa place ; il refuse
 * seulement de le faire en silence.
 *
 * (Asymetrie signalee par la session BatiFlow le 24/09/2026 : chez elle,
 * `dateValidite` n'est lue que pour l'affichage et jamais controlee sur le
 * chemin d'acceptation — un devis expire depuis des mois cree encore des
 * chantiers et une facture d'acompte.)
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, devisTable, organisationsTable, usersTable } from "@workspace/db";
import routeur from "../routes/devis";

const stamp = Date.now();
let orgId = 0, userId = 0;

const JOUR = 86_400_000;
const hier = () => new Date(Date.now() - JOUR);
const dansUnAn = () => new Date(Date.now() + 365 * JOUR);

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", routeur);
  return a;
}

async function devis(v: Record<string, unknown> = {}) {
  const [d] = await db.insert(devisTable).values({
    organisationId: orgId, reference: `DEV-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Ravalement de facade", clientName: "SCI Duval",
    status: "envoye", createdBy: userId, ...v,
  } as any).returning();
  return d!;
}
const relire = async (id: number) =>
  (await db.select().from(devisTable).where(eq(devisTable.id, id)))[0]!;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Devis perime ${stamp}`, slug: `devis-perime-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `perime-${stamp}@example.test`, passwordHash: "x",
    prenom: "P", nom: "R", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(devisTable).where(eq(devisTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* nettoyage au mieux */ }
});

const accepter = (id: number, corps: Record<string, unknown> = {}) =>
  request(appli()).patch(`/api/devis/${id}`).send({ status: "accepte", ...corps });

describe("un devis echu ne peut pas etre accepte", () => {
  it("la tentative rend 409, pas 200", async () => {
    const d = await devis({ validUntil: hier() });
    const r = await accepter(d.id);
    expect(r.status, r.text).toBe(409);
  });

  it("le statut n'a pas bouge en base", async () => {
    // Le test qui compte : une route peut refuser APRES avoir ecrit.
    const d = await devis({ validUntil: hier() });
    await accepter(d.id);
    expect((await relire(d.id)).status).toBe("envoye");
  });

  it("et la date d'acceptation reste vide", async () => {
    const d = await devis({ validUntil: hier() });
    await accepter(d.id);
    expect((await relire(d.id)).acceptedAt).toBeNull();
  });

  it("la reponse porte un code exploitable par l'ecran", async () => {
    const d = await devis({ validUntil: hier() });
    expect((await accepter(d.id)).body.code).toBe("devis_expire");
  });

  it("elle nomme l'action qui debloque, au lieu de trancher a sa place", async () => {
    // Un refus sans issue laisse l'utilisateur devant un mur : la reponse
    // doit dire que prolonger la validite est possible.
    const r = await accepter((await devis({ validUntil: hier() })).id);
    expect(String(r.body.remediation)).toMatch(/[Pp]rolongez la date de validite/);
  });

  it("elle rend la date depassee, pour que l'ecran puisse l'afficher", async () => {
    const d = await devis({ validUntil: hier() });
    expect((await accepter(d.id)).body.validUntil).toBeTruthy();
  });

  it("un devis deja marque « expire » est refuse aussi", async () => {
    // `devisExpire` ne regarde que les devis ENVOYES : sans la seconde
    // condition, un devis bascule par le cron redeviendrait acceptable.
    const d = await devis({ status: "expire", validUntil: hier() });
    expect((await accepter(d.id)).status).toBe(409);
  });
});

describe("ce que le refus ne doit pas emporter", () => {
  it("un devis encore valable s'accepte normalement", async () => {
    const d = await devis({ validUntil: dansUnAn() });
    const r = await accepter(d.id);
    expect(r.status, r.text).toBe(200);
    expect((await relire(d.id)).status).toBe("accepte");
  });

  it("et sa date d'acceptation est posee", async () => {
    const d = await devis({ validUntil: dansUnAn() });
    await accepter(d.id);
    expect((await relire(d.id)).acceptedAt).toBeInstanceOf(Date);
  });

  it("un devis SANS date de validite reste acceptable", async () => {
    // Une absence de terme n'est pas un terme depasse.
    const d = await devis({ validUntil: null });
    expect((await accepter(d.id)).status).toBe(200);
  });

  it("le dernier jour de validite compte encore", async () => {
    // « Valable jusqu'au 30/09 » vaut jusqu'a la FIN du 30/09 : c'est le jour
    // ou le client se decide, et il a deja fait l'objet d'un correctif.
    const aujourdHui = new Date();
    aujourdHui.setHours(0, 0, 0, 0);
    const d = await devis({ validUntil: aujourdHui });
    expect((await accepter(d.id)).status, "le devis mourrait le matin de son dernier jour").toBe(200);
  });

  it("refuser un devis echu reste possible", async () => {
    // Le refus ferme le dossier : l'interdire laisserait des devis morts en
    // « envoye » pour toujours, et fausserait le taux d'acceptation.
    const d = await devis({ validUntil: hier() });
    const r = await request(appli()).patch(`/api/devis/${d.id}`).send({ status: "refuse" });
    expect(r.status, r.text).toBe(200);
    expect((await relire(d.id)).status).toBe("refuse");
  });

  it("modifier autre chose qu'un statut n'est pas bloque", async () => {
    const d = await devis({ validUntil: hier() });
    const r = await request(appli()).patch(`/api/devis/${d.id}`).send({ notes: "Relancer le client" });
    expect(r.status, r.text).toBe(200);
  });
});

describe("prolonger et accepter dans le meme envoi", () => {
  it("la nouvelle date est prise en compte — c'est l'issue qu'on annonce", async () => {
    // La reponse 409 dit « prolongez la validite, puis acceptez ». Si l'ecran
    // envoie les deux d'un coup, le refus serait un mensonge : on aurait
    // nomme une issue qui ne marche pas.
    const d = await devis({ validUntil: hier() });
    const r = await accepter(d.id, { validUntil: dansUnAn().toISOString().slice(0, 10) });
    expect(r.status, r.text).toBe(200);
    expect((await relire(d.id)).status).toBe("accepte");
  });

  it("mais prolonger dans le passe ne debloque rien", async () => {
    const d = await devis({ validUntil: hier() });
    const avantHier = new Date(Date.now() - 2 * JOUR).toISOString().slice(0, 10);
    expect((await accepter(d.id, { validUntil: avantHier })).status).toBe(409);
  });
});

describe("les deux chemins disent la meme chose", () => {
  it("la conversion en facture refuse toujours un devis echu", async () => {
    // C'est la garde d'origine : si elle tombait, l'asymetrie reviendrait
    // par l'autre bout.
    //
    // Le chemin est ecrit exactement : j'avais d'abord tape
    // « /convertir-en-facture », qui n'existe pas. Le test passait au vert en
    // recevant un 404 — il ne verifiait plus rien, et c'est le mode de panne
    // le plus courant d'un test qui appelle une route par son nom.
    const d = await devis({ validUntil: hier() });
    const r = await request(appli()).post(`/api/devis/${d.id}/convert-to-facture`).send({});
    expect(r.status, `la route de conversion a change de nom : ${r.text}`).toBe(409);
    expect(r.body.code).toBe("devis_expire");
  });

  it("et cette meme route convertit bien un devis valable", async () => {
    // Le controle negatif du precedent : sans lui, une route qui refuserait
    // TOUT ferait passer le test ci-dessus pour une bonne raison apparente.
    const d = await devis({ validUntil: dansUnAn(), totalAmount: "1000.00" });
    const r = await request(appli()).post(`/api/devis/${d.id}/convert-to-facture`).send({});
    expect(r.status, r.text).toBeLessThan(400);
  });

  it("les deux refus portent le meme code", async () => {
    // Un ecran qui sait traiter l'un doit savoir traiter l'autre.
    const d = await devis({ validUntil: hier() });
    const acceptation = await accepter(d.id);
    expect(acceptation.body.code).toBe("devis_expire");
  });
});
