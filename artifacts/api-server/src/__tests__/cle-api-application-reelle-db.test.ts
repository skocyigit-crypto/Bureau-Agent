/**
 * La barriere des cles API, dans l'APPLICATION REELLE.
 *
 * Le premier test de cette barriere (cle-api-sans-identite-db) montait les
 * routeurs a la main. Il prouvait la regle, pas son emplacement : dans
 * `app.ts`, le porteur est hydrate pour CHAQUE requete /api/*, et le routeur
 * d'authentification est monte AVANT la garde globale. Les routes qui lisent
 * `req.session.userId` sans garde — /auth/mfa/*, /auth/sessions/revoke-all —
 * ne traversaient donc rien, et la barriere ne s'y appliquait pas.
 *
 * Ce qu'on pouvait faire avec la SEULE cle, sans mot de passe :
 *   1. POST /auth/mfa/setup  -> un nouveau secret MFA sur le compte du
 *      createur de la cle, rendu a l'appelant (QR compris) ;
 *   2. POST /auth/mfa/enable -> MFA active avec l'authentificateur de
 *      l'attaquant. Le proprietaire ne peut plus entrer chez lui, et
 *      l'attaquant recoit les codes de secours ;
 *   3. POST /auth/sessions/revoke-all (cle d'administrateur) -> toutes les
 *      sessions de l'organisation invalidees.
 *
 * Ici on monte la vraie application (createApp), donc le vrai ordre.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
// La protection CSRF refuse toute ecriture sans Origin, et une Origin
// etrangere a l'hote. Un appelant programmatique choisit ses en-tetes : elle
// ne le gene pas (elle protege les navigateurs). Sans cela, TOUTES les
// requetes de ce fichier recevraient un 403 de la CSRF et passeraient au vert
// sans jamais atteindre la barriere qu'elles sont censees mesurer.
//
// On envoie Host et Origin identiques plutot que de toucher a
// process.env.ALLOWED_ORIGINS : la variable est partagee par tout le
// processus, et la modifier ici faisait echouer les fichiers d'inscription
// qui tournent apres — un test qui casse ses voisins ne prouve rien.
const HOTE = "test.local";
const ORIGINE = `https://${HOTE}`;

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { apiKeysTable, contactsTable, db, organisationsTable, usersTable } from "@workspace/db";
// La VRAIE application, avec son ordre de montage reel : c'est tout l'objet
// de ce fichier (cf. l'en-tete).
import appli from "../app";
import { generateApiKey, HASH_ONLY_KEY_SENTINEL } from "../lib/api-key-auth";

const stamp = Date.now();
const ids: Record<string, number> = {};
let cle = "";

const avecCle = (r: request.Test) => r.set("Authorization", `Bearer ${cle}`).set("Host", HOTE).set("Origin", ORIGINE);
const lireUtilisateur = async (id: number) => (await db.select().from(usersTable).where(eq(usersTable.id, id)))[0]!;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `CleReelle ${stamp}`, slug: `cle-reelle-${stamp}`, maxUsers: 10, actif: true }).returning({ id: organisationsTable.id });
  ids.org = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: ids.org, email: `patron-${stamp}@exemple.test`, passwordHash: "x",
    prenom: "Ada", nom: "Patronne", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  ids.admin = u!.id;
  const k = generateApiKey();
  cle = k.full;
  await db.insert(apiKeysTable).values({
    organisationId: ids.org, name: "Integration comptable", keyPrefix: k.prefix, keyHash: k.hash,
    keyEncrypted: HASH_ONLY_KEY_SENTINEL, createdByUserId: ids.admin,
  });
  await db.insert(contactsTable).values({ organisationId: ids.org, firstName: "Leo", lastName: `Cle${stamp}`, phone: "+33600002222" });
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(apiKeysTable).where(eq(apiKeysTable.organisationId, ids.org));
    await db.delete(contactsTable).where(eq(contactsTable.organisationId, ids.org));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [ids.org]));
  } catch { /* le journal d'audit peut retenir l'organisation */ }
});

describe("dans l'application reelle, une cle API", () => {
  it("lit les dossiers : une integration doit continuer de marcher", async () => {
    const r = await avecCle(request(appli).get("/api/contacts"));
    expect(r.status, r.text).toBe(200);
  });

  it("garde-fou : une ecriture anodine passe la CSRF et arrive jusqu'au code", async () => {
    // Sans ce controle, un 403 de la CSRF ferait passer tous les tests
    // ci-dessous pour une bonne raison apparente.
    const r = await avecCle(request(appli).post("/api/contacts")).send({ firstName: "Test", lastName: `Csrf${stamp}`, phone: "+33600003333", category: "client" });
    expect(r.status, `la requete n'atteint pas le code metier : ${r.text.slice(0, 200)}`).toBeLessThan(400);
  });

  it("ne liste pas les appels en direct et ne detourne pas un appel en cours", async () => {
    // Piloter un appel client en temps reel (redirection Twilio) et lire sa
    // transcription est le geste d'une personne, pas d'une integration.
    const liste = await avecCle(request(appli).get("/api/appels-live"));
    expect(liste.status, liste.text.slice(0, 200)).toBe(403);
    expect(liste.body.code).toBe("cle_api_interdite");
    const devral = await avecCle(request(appli).post("/api/appels-live/CAinconnu123/devral")).send({ cible: "moi" });
    expect(devral.status, devral.text.slice(0, 200)).toBe(403);
    expect(devral.body.code).toBe("cle_api_interdite");
  });

  it("ne pose pas de secret MFA sur le compte de son createur", async () => {
    const avant = await lireUtilisateur(ids.admin);
    const r = await avecCle(request(appli).post("/api/auth/mfa/setup")).send({});
    expect(r.status, `le QR d'un nouveau secret MFA a ete rendu : ${r.text.slice(0, 200)}`).toBe(403);
    expect(r.body.code).toBe("cle_api_interdite");
    expect(r.body.secret, "le secret MFA ne doit pas sortir").toBeUndefined();
    const apres = await lireUtilisateur(ids.admin);
    expect(apres.mfaSecret).toBe(avant.mfaSecret ?? null);
  });

  it("n'active pas la double authentification a la place du proprietaire", async () => {
    const r = await avecCle(request(appli).post("/api/auth/mfa/enable")).send({ totpCode: "123456" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("cle_api_interdite");
    expect((await lireUtilisateur(ids.admin)).mfaActif).toBeFalsy();
  });

  it("ne desactive pas la double authentification", async () => {
    expect((await avecCle(request(appli).post("/api/auth/mfa/disable")).send({ password: "x" })).status).toBe(403);
  });

  it("ne deconnecte pas toute l'organisation", async () => {
    const avant = (await lireUtilisateur(ids.admin)).tokenInvalidatedAt;
    const r = await avecCle(request(appli).post("/api/auth/sessions/revoke-all")).send({});
    expect(r.status, "une cle d'integration pouvait invalider toutes les sessions du bureau").toBe(403);
    expect(r.body.code).toBe("cle_api_interdite");
    expect((await lireUtilisateur(ids.admin)).tokenInvalidatedAt).toEqual(avant);
  });

  it("ne change pas le mot de passe", async () => {
    expect((await avecCle(request(appli).post("/api/auth/change-password")).send({ currentPassword: "x", newPassword: "Nouveau-2026-!!" })).status).toBe(403);
  });

  it("ne cree pas d'administrateur et n'emet pas d'autre cle", async () => {
    const avant = (await db.select().from(usersTable).where(eq(usersTable.organisationId, ids.org))).length;
    expect((await avecCle(request(appli).post("/api/auth/users")).send({ email: `intrus-${stamp}@exemple.test`, password: "Intrus-2026-!!", prenom: "In", nom: "Trus", role: "administrateur" })).status).toBe(403);
    expect((await avecCle(request(appli).post("/api/api-keys")).send({ name: "Porte derobee" })).status).toBe(403);
    expect((await db.select().from(usersTable).where(eq(usersTable.organisationId, ids.org))).length).toBe(avant);
    expect(await db.select().from(apiKeysTable).where(eq(apiKeysTable.organisationId, ids.org))).toHaveLength(1);
  });

  it("ne se deconnecte pas non plus au nom du proprietaire", async () => {
    expect((await avecCle(request(appli).post("/api/auth/logout")).send({})).status).toBe(403);
  });

  // Express route sans tenir compte de la casse et tolere les barres
  // doublees. Une liste de refus qui compare la chaine brute laissait donc
  // passer la MEME route ecrite autrement — et avec elle la creation d'un
  // administrateur. Mesure : sans normalisation, ces requetes rendent 201.
  it.each([
    ["casse melangee", "/api/Auth/users"],
    ["tout en majuscules", "/api/AUTH/users"],
    ["barre doublee", "/api//auth/users"],
  ])("refuse la meme route ecrite autrement (%s)", async (_nom, chemin) => {
    const avant = (await db.select().from(usersTable).where(eq(usersTable.organisationId, ids.org))).length;
    const r = await avecCle(request(appli).post(chemin)).send({
      email: `contourne-${stamp}-${chemin.replace(/\W/g, "")}@exemple.test`,
      password: "Contourne-2026-!!", prenom: "Con", nom: "Tourne", role: "administrateur",
    });
    expect(r.status, `${chemin} a repondu ${r.status} : ${r.text.slice(0, 160)}`).not.toBe(201);
    expect((await db.select().from(usersTable).where(eq(usersTable.organisationId, ids.org))).length, "un administrateur a ete cree").toBe(avant);
  });

  it("ne coupe pas le raccordement Google du bureau", async () => {
    // /google-oauth/disconnect lit la session SANS garde : la barriere est
    // le seul rempart. Une integration comptable n'a pas a debrancher la
    // messagerie et l'agenda de toute l'entreprise.
    const r = await avecCle(request(appli).post("/api/google-oauth/disconnect")).send({});
    expect(r.status, r.text.slice(0, 200)).toBe(403);
    expect(r.body.code).toBe("cle_api_interdite");
  });

  it("n'ouvre pas le portail de paiement de l'abonnement", async () => {
    const r = await avecCle(request(appli).post("/api/stripe/create-portal-session")).send({});
    expect(r.status, r.text.slice(0, 200)).toBe(403);
    expect(r.body.code).toBe("cle_api_interdite");
  });
});
