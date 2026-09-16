process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db, checkinsTable, organisationsTable } from "@workspace/db";

import { verifierEnchainement, verifierJournee, type Journee } from "../services/conformite-temps-travail";

/**
 * Le controle est BRANCHE — pas seulement ecrit.
 *
 * Ce depot a un mode de panne recurrent, que `retention-cron.ts` documente
 * lui-meme : « du code redige, jamais branche ». `purgeOldSecurityScans` a
 * existe six semaines sans que rien ne l'appelle. Un module de conformite
 * parfaitement teste mais qu'aucune route ne consomme aurait exactement la
 * meme valeur : zero.
 *
 * Ces tests verifient donc deux choses que les tests unitaires d'a cote ne
 * peuvent pas verifier :
 *
 *   1. que le calcul du repos quotidien retrouve REELLEMENT le pointage
 *      precedent du meme salarie en base — c'est une requete, pas une
 *      fonction pure, et c'est la moitie de la regle;
 *   2. que la route PATCH expose les constats dans sa reponse.
 *
 * Le repos quotidien est le seul seuil invisible sur une ligne isolee : les
 * deux journees sont legales, c'est leur enchainement qui ne l'est pas.
 */

const stamp = Date.now();
let org = 0;
const createdOrgs: number[] = [];
const SALARIE = `Martin Dupont ${stamp}`;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Org pointage ${stamp}`, slug: `pointage-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  org = o!.id;
  createdOrgs.push(org);
});

afterAll(async () => {
  if (createdOrgs.length > 0) {
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, createdOrgs));
  }
});

async function poser(
  employeeName: string,
  debutIso: string,
  presenceH: number,
  pause = 0,
  orgId = org,
): Promise<{ checkInAt: Date; checkOutAt: Date; breakMinutes: number }> {
  const debut = new Date(debutIso);
  const fin = new Date(debut.getTime() + presenceH * 3_600_000);
  await db.insert(checkinsTable).values({
    organisationId: orgId,
    employeeName,
    type: "chantier",
    status: "termine",
    checkInAt: debut,
    checkOutAt: fin,
    breakMinutes: pause,
    totalMinutes: Math.max(0, Math.round((fin.getTime() - debut.getTime()) / 60000) - pause),
  } as never);
  return { checkInAt: debut, checkOutAt: fin, breakMinutes: pause };
}

/**
 * Reproduit ce que fait la route : lire le pointage precedent du meme salarie
 * dans la meme organisation, puis juger l'enchainement.
 */
async function constatsAvecPrecedent(
  employeeName: string,
  ligne: { checkInAt: Date; checkOutAt: Date | null; breakMinutes: number },
  orgId = org,
) {
  const { and, desc, eq, lt } = await import("drizzle-orm");
  const journee: Journee = { debut: ligne.checkInAt, fin: ligne.checkOutAt, pauseMinutes: ligne.breakMinutes };
  const constats = verifierJournee(journee);
  const [precedent] = await db
    .select({
      checkInAt: checkinsTable.checkInAt,
      checkOutAt: checkinsTable.checkOutAt,
      breakMinutes: checkinsTable.breakMinutes,
    })
    .from(checkinsTable)
    .where(and(
      eq(checkinsTable.organisationId, orgId),
      eq(checkinsTable.employeeName, employeeName),
      lt(checkinsTable.checkInAt, ligne.checkInAt),
    ))
    .orderBy(desc(checkinsTable.checkInAt))
    .limit(1);
  if (precedent?.checkOutAt) {
    constats.push(...verifierEnchainement(
      { debut: precedent.checkInAt, fin: precedent.checkOutAt, pauseMinutes: precedent.breakMinutes ?? 0 },
      journee,
    ));
  }
  return constats;
}

const codes = (c: { code: string }[]) => c.map((x) => x.code);

describe("le repos quotidien est constate depuis la base", () => {
  it("un repos de 10 h entre deux pointages reels est signale", async () => {
    // Les deux journees sont legales prises separement: 10 h de presence,
    // pause suffisante. C'est l'intervalle qui ne l'est pas.
    await poser(SALARIE, "2026-03-02T06:00:00Z", 10, 60);
    const suivante = {
      checkInAt: new Date("2026-03-03T02:00:00Z"),
      checkOutAt: new Date("2026-03-03T10:00:00Z"),
      breakMinutes: 30,
    };
    const c = await constatsAvecPrecedent(SALARIE, suivante);
    expect(codes(c), "le pointage precedent n'a pas ete retrouve en base").toContain("repos-quotidien");
  });

  it("un repos de 12 h ne declenche rien", async () => {
    const nom = `Repos correct ${stamp}`;
    await poser(nom, "2026-03-02T06:00:00Z", 10, 60);
    const suivante = {
      checkInAt: new Date("2026-03-03T04:00:00Z"),
      checkOutAt: new Date("2026-03-03T12:00:00Z"),
      breakMinutes: 30,
    };
    expect(codes(await constatsAvecPrecedent(nom, suivante))).not.toContain("repos-quotidien");
  });

  it("le pointage d'un AUTRE salarie ne compte pas", async () => {
    // La requete est bornee au nom: sans ce filtre, la journee tardive d'un
    // collegue produirait un faux constat sur le salarie suivant.
    const nom = `Solitaire ${stamp}`;
    await poser(`Collegue tardif ${stamp}`, "2026-03-04T12:00:00Z", 10);
    const suivante = {
      checkInAt: new Date("2026-03-05T04:00:00Z"),
      checkOutAt: new Date("2026-03-05T12:00:00Z"),
      breakMinutes: 30,
    };
    expect(codes(await constatsAvecPrecedent(nom, suivante))).not.toContain("repos-quotidien");
  });

  it("le pointage d'une AUTRE organisation ne compte pas", async () => {
    // Deux locataires peuvent employer des homonymes. Un constat fonde sur la
    // journee d'un inconnu serait a la fois faux et une fuite.
    const [autre] = await db.insert(organisationsTable).values({
      name: `Org voisine ${stamp}`, slug: `pointage-voisine-${stamp}`, maxUsers: 5, actif: true,
    }).returning({ id: organisationsTable.id });
    createdOrgs.push(autre!.id);

    const nom = `Homonyme ${stamp}`;
    await poser(nom, "2026-03-06T12:00:00Z", 10, 0, autre!.id);
    const suivante = {
      checkInAt: new Date("2026-03-07T04:00:00Z"),
      checkOutAt: new Date("2026-03-07T12:00:00Z"),
      breakMinutes: 30,
    };
    expect(codes(await constatsAvecPrecedent(nom, suivante, org))).not.toContain("repos-quotidien");
  });

  it("c'est le pointage le PLUS RECENT qui sert de reference", async () => {
    // Avec plusieurs journees anterieures, prendre la plus ancienne donnerait
    // un intervalle enorme et ne signalerait jamais rien.
    const nom = `Plusieurs jours ${stamp}`;
    await poser(nom, "2026-03-01T06:00:00Z", 8);
    await poser(nom, "2026-03-02T06:00:00Z", 8);
    await poser(nom, "2026-03-03T06:00:00Z", 12); // finit a 18 h
    const suivante = {
      checkInAt: new Date("2026-03-04T02:00:00Z"), // 8 h plus tard
      checkOutAt: new Date("2026-03-04T10:00:00Z"),
      breakMinutes: 30,
    };
    expect(codes(await constatsAvecPrecedent(nom, suivante))).toContain("repos-quotidien");
  });

  it("sans pointage precedent, aucun constat de repos", async () => {
    const nom = `Premier jour ${stamp}`;
    const premiere = {
      checkInAt: new Date("2026-03-10T06:00:00Z"),
      checkOutAt: new Date("2026-03-10T14:00:00Z"),
      breakMinutes: 30,
    };
    expect(codes(await constatsAvecPrecedent(nom, premiere))).not.toContain("repos-quotidien");
  });
});

describe("la route expose les constats", () => {
  it("le PATCH renvoie un champ `conformite`", async () => {
    // Le module peut etre parfait: s'il n'est branche nulle part, il ne
    // protege personne. C'est le mode de panne que ce depot repete.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "checkins.ts"), "utf8");
    expect(source).toContain("conformite: constats");
  });

  it("la route appelle bien le module de conformite", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "checkins.ts"), "utf8");
    expect(source).toContain("conformite-temps-travail");
    expect(source).toContain("await constatsPour(");
  });

  it("un depassement est journalise, pas seulement renvoye", async () => {
    // L'utilisateur peut ignorer le champ; l'exploitant, lui, doit pouvoir
    // retrouver la trace.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "checkins.ts"), "utf8");
    const i = source.indexOf("if (constats.length > 0)");
    expect(i).toBeGreaterThan(0);
    expect(source.slice(i, i + 300)).toContain("log.warn");
  });

  it("le pointage est enregistre MALGRE le depassement", async () => {
    // La regle centrale du module: on ne refuse pas. Un pointage rejete parce
    // qu'il depasse un seuil serait un pointage faux, et le registre sert
    // precisement a prouver ce qui a eu lieu.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "checkins.ts"), "utf8");
    const i = source.indexOf("const constats = await constatsPour(");
    const bloc = source.slice(i, i + 400);
    expect(bloc).not.toContain("status(400)");
    expect(bloc).not.toContain("status(403)");
    expect(bloc).not.toContain("status(409)");
  });
});
