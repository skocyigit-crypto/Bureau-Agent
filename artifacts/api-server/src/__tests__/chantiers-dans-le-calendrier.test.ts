/**
 * Un chantier occupe une PERIODE. Le calendrier n'en montrait qu'un point.
 *
 * CE QUI ETAIT FAUX, ET INVISIBLE
 *
 * Les chantiers etaient filtres ET affiches sur leur seule date de FIN. Deux
 * consequences, qu'aucun ecran ne pouvait reveler:
 *
 *   1. Un chantier qui TRAVERSE le mois affiche n'apparaissait pas du tout.
 *      Une renovation de mai a aout etait absente du calendrier de juin — le
 *      mois ou les equipes y sont. Le calendrier montrait un mois LIBRE
 *      pendant un chantier en cours. C'est le defaut le plus couteux des
 *      deux: on planifie un autre chantier par-dessus.
 *
 *   2. Meme present, il se reduisait a un point le dernier jour. Rien ne
 *      disait qu'il occupait les huit semaines precedentes, donc rien ne
 *      pouvait signaler deux chantiers qui se chevauchent.
 *
 * La condition est desormais un CHEVAUCHEMENT — la meme regle que les
 * evenements ordinaires appliquent depuis longtemps, deux fonctions plus
 * haut dans le meme fichier. C'est la forme la plus commune de defaut dans ce
 * depot: une regle connue, appliquee d'un seul cote.
 *
 * Ces tests passent par l'API reelle, avec de vraies lignes en base: c'est le
 * seul moyen de verifier une condition SQL, qu'aucune relecture ne garantit.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, organisationsTable, projetsTable, usersTable } from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";

const marque = Date.now();
const orgsCreees: number[] = [];
let orgId: number;
let token: string;

/** Fenetre affichee: juin 2026. */
const FENETRE_DEBUT = "2026-06-01T00:00:00.000Z";
const FENETRE_FIN = "2026-06-30T23:59:59.000Z";

async function creerProjet(
  titre: string,
  debut: string | null,
  fin: string | null,
  statut = "en_cours",
): Promise<number> {
  const [p] = await db
    .insert(projetsTable)
    .values({
      organisationId: orgId,
      title: titre,
      status: statut,
      startDate: debut ? new Date(debut) : null,
      endDate: fin ? new Date(fin) : null,
    })
    .returning({ id: projetsTable.id });
  return p.id;
}

async function evenementsDeJuin(): Promise<any[]> {
  const res = await request(app)
    .get(`/api/calendar/events?start=${FENETRE_DEBUT}&end=${FENETRE_FIN}`)
    .set("Authorization", `Bearer ${token}`)
    .set("Origin", "http://localhost");
  expect(res.status).toBe(200);
  return (res.body.projetEvents as any[]) ?? [];
}

function parTitre(evenements: any[], fragment: string) {
  return evenements.find((e) => String(e.title).includes(fragment));
}

beforeAll(async () => {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `Chantiers ${marque}`,
      slug: `chantiers-${marque}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgId = org.id;
  orgsCreees.push(org.id);

  const email = `chantiers-${marque}@example.test`;
  const [u] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: "x",
      nom: "Test",
      prenom: "User",
      role: "administrateur",
      organisationId: orgId,
      actif: true,
    })
    .returning({ id: usersTable.id });
  token = mintApiToken({
    userId: u.id,
    userRole: "administrateur",
    organisationId: orgId,
    userEmail: email,
    prenom: "Test",
    nom: "User",
  });
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

describe("un chantier qui traverse le mois affiche", () => {
  beforeAll(async () => {
    await creerProjet(
      `Traversant ${marque}`,
      "2026-05-01T08:00:00.000Z",
      "2026-08-31T18:00:00.000Z",
    );
  });

  it("apparait, alors qu'il commence avant et finit apres", async () => {
    // LE DEFAUT LE PLUS COUTEUX: ce chantier etait totalement absent du
    // calendrier de juin. On voyait un mois libre pendant que les equipes y
    // travaillaient.
    const e = parTitre(await evenementsDeJuin(), `Traversant ${marque}`);
    expect(e, "un chantier en cours reste invisible dans le mois affiche").toBeDefined();
  });

  it("porte sa periode reelle, pas un point", async () => {
    const e = parTitre(await evenementsDeJuin(), `Traversant ${marque}`);
    expect(new Date(e.startDate).getTime()).toBeLessThan(new Date(e.endDate).getTime());
    expect(new Date(e.startDate).toISOString()).toContain("2026-05-01");
    expect(new Date(e.endDate).toISOString()).toContain("2026-08-31");
  });
});

describe("les bornes de la fenetre", () => {
  beforeAll(async () => {
    // Se termine le premier jour affiche: doit apparaitre.
    await creerProjet(`Finit au debut ${marque}`, "2026-04-01T08:00:00.000Z", "2026-06-01T08:00:00.000Z");
    // Commence le dernier jour affiche: doit apparaitre.
    await creerProjet(`Commence a la fin ${marque}`, "2026-06-30T08:00:00.000Z", "2026-09-01T08:00:00.000Z");
    // Entierement avant la fenetre: ne doit pas apparaitre.
    await creerProjet(`Avant ${marque}`, "2026-02-01T08:00:00.000Z", "2026-03-01T08:00:00.000Z");
    // Entierement apres: ne doit pas apparaitre.
    await creerProjet(`Apres ${marque}`, "2026-11-01T08:00:00.000Z", "2026-12-01T08:00:00.000Z");
  });

  it("un chantier qui se termine le premier jour est inclus", async () => {
    expect(parTitre(await evenementsDeJuin(), `Finit au debut ${marque}`)).toBeDefined();
  });

  it("un chantier qui commence le dernier jour est inclus", async () => {
    expect(parTitre(await evenementsDeJuin(), `Commence a la fin ${marque}`)).toBeDefined();
  });

  it("un chantier entierement anterieur est exclu", async () => {
    // L'erreur inverse compte aussi: un calendrier qui montre tout ne montre
    // rien.
    expect(parTitre(await evenementsDeJuin(), `Avant ${marque}`)).toBeUndefined();
  });

  it("un chantier entierement posterieur est exclu", async () => {
    expect(parTitre(await evenementsDeJuin(), `Apres ${marque}`)).toBeUndefined();
  });
});

describe("les chantiers a dates partielles", () => {
  beforeAll(async () => {
    await creerProjet(`Sans fin ${marque}`, "2026-05-15T08:00:00.000Z", null);
    await creerProjet(`Sans debut ${marque}`, null, "2026-06-15T08:00:00.000Z");
    await creerProjet(`Sans aucune date ${marque}`, null, null);
  });

  it("un chantier commence et sans date de fin est en cours, donc affiche", async () => {
    // C'est le cas courant d'un chantier ouvert dont la fin n'est pas encore
    // arretee. L'exclure cacherait precisement le travail en cours.
    expect(parTitre(await evenementsDeJuin(), `Sans fin ${marque}`)).toBeDefined();
  });

  it("un chantier sans date de debut reste affiche sur sa date de fin", async () => {
    const e = parTitre(await evenementsDeJuin(), `Sans debut ${marque}`);
    expect(e).toBeDefined();
    // On n'extrapole pas une duree qu'on ignore: la periode se reduit a ce
    // jour-la, ce qui reste vrai.
    expect(new Date(e.startDate).getTime()).toBe(new Date(e.endDate).getTime());
  });

  it("un chantier sans aucune date n'est pas invente", async () => {
    // L'afficher supposerait une periode que personne n'a saisie.
    expect(parTitre(await evenementsDeJuin(), `Sans aucune date ${marque}`)).toBeUndefined();
  });
});

describe("ce que le chantier affiche dit", () => {
  beforeAll(async () => {
    await creerProjet(`En retard ${marque}`, "2026-01-01T08:00:00.000Z", "2026-06-10T08:00:00.000Z");
    await creerProjet(`Termine ${marque}`, "2026-05-01T08:00:00.000Z", "2026-06-20T08:00:00.000Z", "termine");
    await creerProjet(`Annule ${marque}`, "2026-05-01T08:00:00.000Z", "2026-06-20T08:00:00.000Z", "annule");
  });

  it("une echeance depassee est signalee", async () => {
    // Un chantier dont la date de fin est passee et qui n'est pas termine est
    // la seule ligne du calendrier qui appelle une decision aujourd'hui.
    const e = parTitre(await evenementsDeJuin(), `En retard ${marque}`);
    expect(e).toBeDefined();
    expect(e.enRetard).toBe(true);
    expect(String(e.description)).toMatch(/dépassée|depassee/i);
  });

  it("un chantier termine n'est pas signale en retard", async () => {
    const e = parTitre(await evenementsDeJuin(), `Termine ${marque}`);
    expect(e).toBeDefined();
    expect(e.enRetard).toBe(false);
  });

  it("le retard prime sur la priorite dans la couleur", async () => {
    // Deux informations se disputent la couleur; celle qui appelle une action
    // immediate gagne.
    const e = parTitre(await evenementsDeJuin(), `En retard ${marque}`);
    expect(e.color).toBe("#dc2626");
  });

  it("un chantier annule n'apparait pas", async () => {
    expect(parTitre(await evenementsDeJuin(), `Annule ${marque}`)).toBeUndefined();
  });

  it("l'avancement est lisible sans ouvrir le chantier", async () => {
    const e = parTitre(await evenementsDeJuin(), `Traversant ${marque}`);
    expect(String(e.description)).toMatch(/%/);
  });
});
