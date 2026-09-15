/**
 * Gestion des licences: chaque route touche soit SON organisation, soit
 * N'IMPORTE LAQUELLE — et la seconde est reservee aux super-administrateurs.
 *
 * Ce fichier porte les leviers les plus lourds du produit: suspendre une
 * organisation cliente, regenerer sa cle de licence, prolonger son essai,
 * marquer une facture payee, exporter ses donnees. Il n'avait aucun test.
 *
 * DEUX FAMILLES DANS UN MEME FICHIER
 *
 * Seize routes y cohabitent. Onze prennent un `:id` d'organisation en
 * parametre — elles peuvent atteindre n'importe quel client — et verifient
 * `userRole !== "super_admin"` a la main, chacune dans son corps. Les cinq
 * autres ne lisent que `getOrgId(req)`: elles restent chez l'appelant, et
 * n'ont donc pas besoin de ce controle.
 *
 * Verifie a l'ecriture de ces tests: les cinq routes sans controle de role
 * (`client-invoices/:id`, `send-payment-reminder`, `send-invoice-email`,
 * `audit-log`, et la lecture du tableau de bord) filtrent TOUTES par
 * `organisationId`. Aucun trou inter-locataires a ce jour.
 *
 * CE QUI EST FRAGILE, ET POURQUOI CE TEST EXISTE
 *
 * Le controle est recopie onze fois. Rien dans le fichier ne dit qu'il est
 * obligatoire, aucun intergiciel ne le rattrape, et la dix-septieme route
 * s'ecrira par copier-coller d'une voisine — peut-etre d'une des cinq qui
 * n'en ont pas besoin. Le defaut serait alors invisible: la route marche, les
 * tests passent, et un agent d'une PME peut suspendre la licence d'une autre.
 *
 * Le premier test est donc STATIQUE: il lit le fichier, decoupe chaque route,
 * et exige que toute route prenant un `:id` d'organisation verifie le role.
 * Les suivants verifient le comportement reel des garde-fous.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  organisationsTable,
  subscriptionsTable,
  licenseAuditLogTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";

const SOURCE = readFileSync(
  join(import.meta.dirname, "..", "routes", "license-management.ts"),
  "utf8",
);

interface Route {
  methode: string;
  chemin: string;
  corps: string;
}

/** Decoupe le fichier en routes, chacune avec son corps. */
function routes(): Route[] {
  const lignes = SOURCE.split("\n");
  const debuts: Array<{ i: number; methode: string; chemin: string }> = [];
  lignes.forEach((l, i) => {
    const m = l.match(/^router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/);
    if (m) debuts.push({ i, methode: m[1].toUpperCase(), chemin: m[2] });
  });
  return debuts.map((d, k) => ({
    methode: d.methode,
    chemin: d.chemin,
    corps: lignes.slice(d.i, k + 1 < debuts.length ? debuts[k + 1].i : lignes.length).join("\n"),
  }));
}

const verifieLeRole = (r: Route) =>
  /userRole\s*!==\s*"super_admin"|requireRole\(/.test(r.corps);
const porteSurUneAutreOrg = (r: Route) => /\/orgs\/:id\b/.test(r.chemin);
const filtreParOrganisation = (r: Route) =>
  /getOrgId\(req\)/.test(r.corps) || /organisationId/.test(r.corps);

describe("la portee de chaque route est explicite", () => {
  it("le fichier expose bien des routes a examiner", () => {
    // Garde-fou: si le fichier change de forme, les tests suivants passeraient
    // sur un ensemble vide sans rien prouver.
    expect(routes().length).toBeGreaterThanOrEqual(12);
  });

  it("toute route pouvant atteindre une AUTRE organisation verifie le role", () => {
    // La regle est recopiee a la main dans chaque corps. C'est elle qui
    // separe « super-administrateur de la plateforme » de « agent d'une PME ».
    const trous = routes()
      .filter(porteSurUneAutreOrg)
      .filter((r) => !verifieLeRole(r))
      .map((r) => `${r.methode} ${r.chemin}`);
    expect(
      trous,
      "ces routes prennent un identifiant d'organisation en parametre sans " +
        "verifier que l'appelant est super-administrateur: un agent pourrait " +
        "agir sur la licence d'un autre client.",
    ).toEqual([]);
  });

  it("toute route sans controle de role reste chez l'appelant", () => {
    // L'autre moitie de la regle, et la plus facile a perdre: une route qui
    // ne verifie ni le role NI l'organisation est un trou inter-locataires.
    const trous = routes()
      .filter((r) => !verifieLeRole(r))
      .filter((r) => !filtreParOrganisation(r))
      .map((r) => `${r.methode} ${r.chemin}`);
    expect(
      trous,
      "ces routes ne verifient ni le role ni l'organisation: elles ne sont " +
        "bornees par rien.",
    ).toEqual([]);
  });

  it("les routes les plus lourdes sont bien du cote super-administrateur", () => {
    // Nommees une a une: si l'une d'elles disparaissait du fichier ou changeait
    // de chemin, ce test tomberait plutot que de passer sur un ensemble reduit.
    const attendues = [
      "/license-management/orgs/:id/suspend",
      "/license-management/orgs/:id/reactivate",
      "/license-management/orgs/:id/regenerate-key",
      "/license-management/orgs/:id/extend-trial",
      "/license-management/orgs/:id/export",
    ];
    const connues = routes().map((r) => r.chemin);
    for (const chemin of attendues) {
      expect(connues, `route disparue: ${chemin}`).toContain(chemin);
      const r = routes().find((x) => x.chemin === chemin)!;
      expect(verifieLeRole(r), `${chemin} ne verifie plus le role`).toBe(true);
    }
  });

  it("une suspension consigne toujours une trace d'audit", () => {
    // Suspendre coupe l'acces d'une entreprise a son outil de travail. Une
    // telle decision doit rester explicable des mois plus tard.
    const r = routes().find((x) => x.chemin.endsWith("/suspend"))!;
    expect(r.corps).toContain("logAudit");
  });

  it("une suspension invalide le cache de licence", () => {
    // Sans cela, la suspension ne prend effet qu'a l'expiration du cache de
    // 30 s cote intergiciel: une decision d'exploitation qui met un temps
    // indetermine a s'appliquer n'est pas une decision.
    for (const suffixe of ["/suspend", "/reactivate"]) {
      const r = routes().find((x) => x.chemin.endsWith(suffixe))!;
      expect(r.corps, `${suffixe} n'invalide pas le cache`).toContain(
        "invalidateLicenseCache",
      );
    }
  });
});

// ── Comportement reel ────────────────────────────────────────────────────

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
      name: `Licence ${tag} ${marque}`,
      slug: `licence-${tag}-${marque}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgsCreees.push(org.id);
  await db.insert(subscriptionsTable).values({
    organisationId: org.id,
    plan: "starter",
    status: "active",
    licenseKey: `LIC-${tag}-${marque}`,
  });
  return org.id;
}

async function creerCompte(tag: string, role: string, organisationId: number): Promise<Compte> {
  const email = `licence-${tag}-${marque}@example.test`;
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

function poster(chemin: string, token: string) {
  return request(app)
    .post(chemin)
    .set("Authorization", `Bearer ${token}`)
    .set("Origin", "http://localhost");
}

let orgCible: number;
let orgTierce: number;
let superAdmin: Compte;
let admin: Compte;
let agent: Compte;

beforeAll(async () => {
  orgCible = await creerOrg("cible");
  orgTierce = await creerOrg("tierce");
  superAdmin = await creerCompte("super", "super_admin", orgTierce);
  admin = await creerCompte("admin", "administrateur", orgTierce);
  agent = await creerCompte("agent", "agent", orgTierce);
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

async function statutAbonnement(orgId: number): Promise<string> {
  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.organisationId, orgId));
  return sub?.status ?? "(absent)";
}

describe("suspendre une organisation cliente", () => {
  it("est refuse a un administrateur d'organisation", async () => {
    // « administrateur » est le role le plus eleve DANS une PME. Il n'a
    // aucune autorite sur la plateforme, et surtout aucune sur les autres
    // clients.
    const res = await poster(
      `/api/license-management/orgs/${orgCible}/suspend`,
      admin.token,
    ).send({ reason: "test", confirmOrgName: `Licence cible ${marque}` });
    expect(res.status).toBe(403);
    expect(await statutAbonnement(orgCible)).toBe("active");
  });

  it("est refuse a un agent", async () => {
    const res = await poster(
      `/api/license-management/orgs/${orgCible}/suspend`,
      agent.token,
    ).send({ reason: "test", confirmOrgName: `Licence cible ${marque}` });
    expect(res.status).toBe(403);
    expect(await statutAbonnement(orgCible)).toBe("active");
  });

  it("exige une confirmation nommant l'organisation", async () => {
    // Une suspension coupe l'acces d'une entreprise a son outil de travail.
    // La confirmation par le nom empeche de suspendre la mauvaise ligne d'un
    // tableau.
    const res = await poster(
      `/api/license-management/orgs/${orgCible}/suspend`,
      superAdmin.token,
    ).send({ reason: "test" });
    expect(res.status).toBe(400);
    expect(await statutAbonnement(orgCible)).toBe("active");
  });

  it("refuse une confirmation qui ne correspond pas", async () => {
    const res = await poster(
      `/api/license-management/orgs/${orgCible}/suspend`,
      superAdmin.token,
    ).send({ reason: "test", confirmOrgName: "Une autre entreprise" });
    expect(res.status).toBe(400);
    expect(await statutAbonnement(orgCible)).toBe("active");
  });

  it("refuse qu'un super-administrateur suspende sa propre organisation", async () => {
    // Le cas ou personne ne peut plus rien reparer: l'outil d'administration
    // se coupe lui-meme.
    const res = await poster(
      `/api/license-management/orgs/${orgTierce}/suspend`,
      superAdmin.token,
    ).send({ reason: "test", confirmOrgName: `Licence tierce ${marque}` });
    expect(res.status).toBe(400);
    expect(await statutAbonnement(orgTierce)).toBe("active");
  });

  it("aboutit pour un super-administrateur, et laisse une trace", async () => {
    const res = await poster(
      `/api/license-management/orgs/${orgCible}/suspend`,
      superAdmin.token,
    ).send({ reason: "impaye de trois mois", confirmOrgName: `Licence cible ${marque}` });
    expect(res.status).toBe(200);
    expect(await statutAbonnement(orgCible)).toBe("suspended");

    const traces = await db
      .select()
      .from(licenseAuditLogTable)
      .where(eq(licenseAuditLogTable.organisationId, orgCible));
    expect(traces.length, "aucune trace d'audit pour une suspension").toBeGreaterThan(0);
    expect(traces.some((t) => String(t.action).includes("suspend"))).toBe(true);
  });

  it("la reactivation remet l'abonnement en service", async () => {
    const res = await poster(
      `/api/license-management/orgs/${orgCible}/reactivate`,
      superAdmin.token,
    ).send({});
    expect(res.status).toBe(200);
    expect(await statutAbonnement(orgCible)).toBe("active");
  });
});

describe("regenerer une cle de licence", () => {
  it("est refuse a un administrateur d'organisation", async () => {
    const res = await poster(
      `/api/license-management/orgs/${orgCible}/regenerate-key`,
      admin.token,
    ).send({ confirmOrgName: `Licence cible ${marque}` });
    expect(res.status).toBe(403);
  });

  it("ne change rien quand la confirmation manque", async () => {
    // Regenerer une cle invalide l'installation du client jusqu'a ce qu'il
    // saisisse la nouvelle: c'est une coupure, pas un reglage.
    const avant = (
      await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.organisationId, orgCible))
    )[0].licenseKey;
    const res = await poster(
      `/api/license-management/orgs/${orgCible}/regenerate-key`,
      superAdmin.token,
    ).send({});
    expect(res.status).toBe(400);
    const apres = (
      await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.organisationId, orgCible))
    )[0].licenseKey;
    expect(apres).toBe(avant);
  });
});

describe("les routes bornees a l'organisation de l'appelant", () => {
  it("le journal d'audit ne montre que sa propre organisation", async () => {
    // Ce journal contient les decisions d'exploitation prises sur un client:
    // suspensions, motifs, dates. Le montrer a un autre client serait une
    // fuite, et il n'y a aucun controle de role sur cette route — seule la
    // portee par organisation la protege.
    const res = await request(app)
      .get("/api/license-management/audit-log")
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    const logs = (res.body.logs as Array<{ organisationId: number }>) ?? [];
    for (const l of logs) {
      expect(l.organisationId, "une trace d'une autre organisation est visible").toBe(
        orgTierce,
      );
    }
  });
});
