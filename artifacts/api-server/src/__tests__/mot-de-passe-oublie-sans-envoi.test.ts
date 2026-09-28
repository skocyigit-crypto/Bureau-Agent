/**
 * Une demande de reinitialisation qui n'envoie RIEN laisse une trace.
 *
 * `POST /auth/forgot-password` repond toujours la meme chose — meme corps,
 * meme code, meme latence — que le compte existe ou non. C'est delibere et
 * c'est juste : toute variation observable permet d'enumerer les comptes.
 *
 * Mais le silence vers l'utilisateur ne justifie pas le silence dans les
 * journaux. Jusqu'ici, une demande sans destinataire ne laissait AUCUNE
 * trace : l'ecran annoncait « un lien a ete envoye », la boite restait vide,
 * et personne — pas meme l'exploitant avec les journaux sous les yeux — ne
 * pouvait distinguer trois causes qui se reparent differemment :
 *
 *   - aucun compte a cette adresse  -> creer le compte ;
 *   - compte desactive              -> le reactiver ;
 *   - panne du fournisseur d'envoi  -> celle-la etait deja journalisee.
 *
 * MESURE QUI A MOTIVE CE CORRECTIF. En production le 24/09/2026, deux
 * demandes : 14:37 et 14:42. La seconde est suivie de
 * `[Email/Resend] Envoye a ...`. La premiere n'a laisse que son code 200 —
 * rien d'autre, nulle part. Le diagnostic demandait de lire le code source et
 * de deduire ; il devrait tenir dans une ligne de journal.
 *
 * CE QUE CE FICHIER VERROUILLE AUSSI : que la reponse reste indiscernable. Un
 * correctif qui rendrait la cause visible A L'UTILISATEUR rouvrirait
 * l'enumeration de comptes — on echangerait un defaut de diagnostic contre
 * une faille.
 *
 * LES LIMITEURS RESTENT REELS. La route en porte deux : trois demandes par
 * adresse et par heure, cinq par IP. Les neutraliser aurait ete le geste
 * facile ; ce fichier prefere leur donner ce qu'ils attendent — une adresse
 * neuve et une IP neuve a chaque demande. Un test qui desarme la protection
 * qu'il traverse ne dit plus rien de ce qui tourne en production.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const envois: Array<{ to: string }> = [];
vi.mock("../services/email", async (importOriginal) => {
  const reel = await importOriginal<Record<string, unknown>>();
  return {
    ...reel,
    sendEmail: async (to: string) => { envois.push({ to }); return { success: true, provider: "faux" }; },
  };
});

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import routeur from "../routes/auth";

const stamp = Date.now();
const crees: number[] = [];
let n = 0;

/** Les avertissements ecrits par la route, captures comme le ferait pino. */
const avertissements: Array<{ donnees: any; message: string }> = [];

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = {};
    (req as any).log = {
      info() {}, error() {},
      warn(donnees: any, message: string) { avertissements.push({ donnees, message }); },
    };
    next();
  });
  a.use("/api", routeur);
  return a;
}

/** Un compte neuf, avec une adresse que personne n'a encore demandee. */
async function compte(actif: boolean): Promise<string> {
  const email = `oubli-${stamp}-${n++}@exemple.fr`;
  const hash = await bcrypt.hash("un-mot-de-passe-de-test-assez-long", 10);
  const [u] = await db.insert(usersTable).values({
    email, passwordHash: hash, nom: "Test", prenom: "Oubli", role: "super_admin", actif,
  } as any).returning({ id: usersTable.id });
  crees.push(u!.id);
  return email;
}

/** Une adresse qui n'a jamais eu de compte. */
const inconnue = () => `oubli-inconnu-${stamp}-${n++}@exemple.fr`;

/**
 * Une demande, depuis une IP neuve.
 *
 * Le limiteur par IP autorise cinq demandes par heure. Une suite de tests en
 * fait davantage : sans IP distincte, les dernieres seraient refusees et les
 * assertions echoueraient sur la protection, pas sur le comportement mesure.
 */
async function demander(email: string) {
  envois.length = 0;
  avertissements.length = 0;
  const r = await request(appli())
    .post("/api/auth/forgot-password")
    .set("x-forwarded-for", `203.0.113.${(n++ % 250) + 1}`)
    .send({ email });
  return r;
}

beforeAll(async () => { await compte(true); }, 60_000);

afterAll(async () => {
  try { if (crees.length) await db.delete(usersTable).where(inArray(usersTable.id, crees)); } catch { /* au mieux */ }
});

describe("la reponse reste indiscernable — c'est la garde anti-enumeration", () => {
  it("un compte actif recoit le meme corps qu'une adresse inconnue", async () => {
    const a = await demander(await compte(true));
    const b = await demander(inconnue());
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
  });

  it("un compte desactive aussi", async () => {
    const a = await demander(await compte(true));
    const b = await demander(await compte(false));
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
  });

  it("le message ne nomme jamais la cause", async () => {
    const r = await demander(inconnue());
    const corps = JSON.stringify(r.body).toLowerCase();
    for (const fuite of ["inexistant", "inconnu", "desactive", "introuvable", "aucun compte"]) {
      expect(corps, `le corps revele « ${fuite} »`).not.toContain(fuite);
    }
  });
});

describe("mais le journal, lui, dit ce qui s'est passe", () => {
  it("aucun compte a cette adresse : un avertissement, avec la raison", async () => {
    const email = inconnue();
    await demander(email);
    const w = avertissements.find((x) => x.message.includes("aucun envoi"));
    expect(w, "aucune trace : la demande disparait sans laisser de quoi diagnostiquer").toBeTruthy();
    expect(w!.donnees.raison).toBe("aucun compte a cette adresse");
  });

  it("compte desactive : la raison est DIFFERENTE, parce que la reparation l'est", async () => {
    // Creer un compte et reactiver un compte ne sont pas le meme geste : une
    // trace qui confondrait les deux ferait chercher au mauvais endroit.
    await demander(await compte(false));
    const w = avertissements.find((x) => x.message.includes("aucun envoi"));
    expect(w).toBeTruthy();
    expect(w!.donnees.raison).toBe("compte desactive");
  });

  it("l'adresse demandee figure dans la trace", async () => {
    // Sans elle, on sait qu'une demande a echoue mais pas laquelle — et le
    // journal ne sert plus a rien.
    const email = inconnue();
    await demander(email);
    expect(avertissements[0]?.donnees.to).toBe(email);
  });

  it("un envoi REUSSI n'ecrit pas cet avertissement", async () => {
    // Sinon le journal crierait a chaque demande et cesserait d'etre lu.
    await demander(await compte(true));
    expect(avertissements.filter((x) => x.message.includes("aucun envoi"))).toEqual([]);
  });
});

describe("et l'envoi a bien lieu quand il doit avoir lieu", () => {
  it("un compte actif declenche un envoi", async () => {
    // Le controle qui donne son sens aux precedents : si plus rien ne partait
    // jamais, l'absence de trace serait normale.
    const email = await compte(true);
    await demander(email);
    expect(envois.map((e) => e.to)).toEqual([email]);
  });

  it("une adresse inconnue n'en declenche aucun", async () => {
    await demander(inconnue());
    expect(envois).toEqual([]);
  });

  it("un compte desactive non plus", async () => {
    await demander(await compte(false));
    expect(envois).toEqual([]);
  });

  it("le jeton n'est pose que pour un compte actif", async () => {
    // Poser un jeton sur un compte desactive ouvrirait un chemin de
    // reactivation involontaire.
    const email = await compte(false);
    await demander(email);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(u?.resetPasswordToken ?? null).toBeNull();
  });

  it("et il est bien pose pour un compte actif", async () => {
    const email = await compte(true);
    await demander(email);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(u?.resetPasswordToken).toBeTruthy();
  });
});

describe("les limiteurs sont toujours en place", () => {
  it("la quatrieme demande pour une MEME adresse n'envoie plus rien", async () => {
    // Trois par adresse et par heure. Si ce controle tombait, c'est que la
    // protection a saute — et les tests ci-dessus ne le diraient pas, puisque
    // chacun utilise une adresse neuve.
    const email = await compte(true);
    for (let i = 0; i < 3; i++) await demander(email);
    await demander(email);
    expect(envois, "la limite par adresse ne s'applique plus").toEqual([]);
  });

  it("et la reponse reste la meme — la limite ne se revele pas non plus", async () => {
    const email = await compte(true);
    for (let i = 0; i < 3; i++) await demander(email);
    const bloquee = await demander(email);
    const normale = await demander(await compte(true));
    expect(bloquee.status).toBe(normale.status);
    expect(bloquee.body).toEqual(normale.body);
  });
});
