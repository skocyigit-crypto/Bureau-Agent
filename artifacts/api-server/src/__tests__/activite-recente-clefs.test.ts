/**
 * « Activite recente » lit les reponses sous le nom que les routes emploient.
 *
 * L'ecran interroge huit routes et agrege leurs resultats. Pour six d'entre
 * elles il lisait la bonne clef. Pour les devis et les factures il lisait
 * `.data` — un nom qu'aucune de ces deux routes n'a jamais rendu :
 *
 *     GET /api/devis            -> { devis, total }
 *     GET /api/factures-client  -> { factures, total }
 *
 * `(devisR?.data || [])` vaut alors la liste vide. Aucune erreur, aucun ecran
 * rouge : simplement un flux d'activite d'ou les devis et les factures sont
 * absents. C'est le pire mode de panne pour un tableau de bord — il a l'air
 * de marcher, et il rassure a tort. Un artisan qui vient d'envoyer trois
 * devis voit « aucune activite » et en conclut que l'envoi n'a pas eu lieu.
 *
 * Ce fichier compare donc les clefs LUES PAR L'ECRAN aux clefs REELLEMENT
 * rendues par les routes — pas a une liste ecrite a la main, qui ne protege
 * que ce qu'on a pense a y mettre.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  db, organisationsTable, usersTable, devisTable, facturesClientTable,
} from "@workspace/db";

import routeurDevis from "../routes/devis";
import routeurFactures from "../routes/factures-client";
import routeurProspects from "../routes/prospects";
import routeurContacts from "../routes/contacts";
import routeurCalls from "../routes/calls";
import routeurTasks from "../routes/tasks";
import routeurMessages from "../routes/messages";
import routeurProjets from "../routes/projets";

const ECRAN = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "mobile", "app", "activite-recente.tsx"),
  "utf8",
);

/**
 * Les sources que l'ecran agrege : sa variable de reponse, la route appelee,
 * et le routeur qui la sert.
 */
const SOURCES = [
  { variable: "devisR", chemin: "/api/devis", routeur: routeurDevis },
  { variable: "facturesR", chemin: "/api/factures-client", routeur: routeurFactures },
  { variable: "prospectsR", chemin: "/api/prospects", routeur: routeurProspects },
  { variable: "contactsR", chemin: "/api/contacts", routeur: routeurContacts },
  { variable: "callsR", chemin: "/api/calls", routeur: routeurCalls },
  { variable: "tasksR", chemin: "/api/tasks", routeur: routeurTasks },
  { variable: "messagesR", chemin: "/api/messages", routeur: routeurMessages },
  { variable: "projetsR", chemin: "/api/projets", routeur: routeurProjets },
] as const;

/**
 * Les clefs que l'ecran essaie de lire sur une reponse, dans l'ordre.
 *
 * `(devisR?.devis || devisR?.data || [])` rend ["devis", "data"].
 */
function clefsLues(variable: string): string[] {
  const motif = new RegExp(`\\(${variable}\\?\\.(\\w+)((?:\\s*\\|\\|\\s*${variable}\\?\\.\\w+)*)`);
  const m = ECRAN.match(motif);
  if (!m) return [];
  const suite = [...(m[2] ?? "").matchAll(new RegExp(`${variable}\\?\\.(\\w+)`, "g"))].map((x) => x[1]!);
  return [m[1]!, ...suite];
}

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  for (const s of SOURCES) a.use("/api", s.routeur);
  return a;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Activite ${stamp}`, slug: `activite-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `act-${stamp}@example.test`, passwordHash: "x",
    prenom: "A", nom: "C", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;

  // Les deux seules sources qui etaient perdues : on pose de quoi les voir.
  await db.insert(devisTable).values({
    organisationId: orgId, reference: `DEV-${stamp}`, title: "Ravalement",
    clientName: "SCI Duval", status: "brouillon", createdBy: userId,
  } as any);
  await db.insert(facturesClientTable).values({
    organisationId: orgId, reference: `FAC-${stamp}`, title: "Ravalement", clientName: "SCI Duval",
    status: "brouillon", createdBy: userId,
  } as any);
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(devisTable).where(eq(devisTable.organisationId, orgId));
    await db.delete(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* nettoyage au mieux */ }
});

describe("le releve de l'ecran mesure bien quelque chose", () => {
  it("les huit sources sont retrouvees dans la source de l'ecran", () => {
    // Un ecran restructure rendrait des listes vides, et une liste vide est
    // satisfaite par n'importe quelle reponse.
    for (const s of SOURCES) {
      expect(clefsLues(s.variable), `aucune lecture trouvee pour ${s.variable}`).not.toEqual([]);
    }
  });

  it("l'ecran appelle bien les huit routes attendues", () => {
    for (const s of SOURCES) expect(ECRAN).toContain(`${s.chemin}?`);
  });
});

describe("chaque route rend la clef que l'ecran attend", () => {
  it.each(SOURCES.map((s) => [s.chemin, s] as const))("%s", async (_chemin, s) => {
    const r = await request(appli()).get(`${s.chemin}?limit=5`);
    expect(r.status, r.text).toBe(200);
    const clefs = clefsLues(s.variable);
    const trouvee = clefs.find((k) => Array.isArray(r.body?.[k]));
    expect(
      trouvee,
      `l'ecran lit ${clefs.join(" puis ")} ; la route rend ${Object.keys(r.body ?? {}).join(", ")}`,
    ).toBeTruthy();
  });

  it("la toute premiere clef lue est la bonne, pas un repli", () => {
    // Un repli qui sauve la mise cache le desaccord : la clef reelle doit
    // etre celle qu'on tente d'abord.
    const desaccords: string[] = [];
    for (const s of SOURCES) {
      const attendue = s.chemin === "/api/factures-client" ? "factures" : s.chemin.split("/").pop()!;
      if (clefsLues(s.variable)[0] !== attendue) desaccords.push(`${s.variable} lit ${clefsLues(s.variable)[0]}`);
    }
    expect(desaccords).toEqual([]);
  });
});

describe("les devis et les factures apparaissent vraiment dans le flux", () => {
  it("la route devis rend le devis pose", async () => {
    const r = await request(appli()).get("/api/devis?limit=30");
    expect(r.body.devis.map((d: any) => d.reference)).toContain(`DEV-${stamp}`);
  });

  it("et l'ecran le trouve la ou il regarde", async () => {
    const r = await request(appli()).get("/api/devis?limit=30");
    const lu = clefsLues("devisR").map((k) => r.body?.[k]).find(Array.isArray) ?? [];
    expect(lu.length, "le flux resterait vide malgre un devis existant").toBeGreaterThan(0);
  });

  it("la route factures rend la facture posee", async () => {
    const r = await request(appli()).get("/api/factures-client?limit=30");
    expect(r.body.factures.map((f: any) => f.reference)).toContain(`FAC-${stamp}`);
  });

  it("et l'ecran la trouve la ou il regarde", async () => {
    const r = await request(appli()).get("/api/factures-client?limit=30");
    const lu = clefsLues("facturesR").map((k) => r.body?.[k]).find(Array.isArray) ?? [];
    expect(lu.length, "le flux resterait vide malgre une facture existante").toBeGreaterThan(0);
  });

  it("aucune des deux routes ne rend « data » — le nom qui etait lu", async () => {
    // Le defaut d'origine, nomme : si `data` apparaissait un jour, la lecture
    // de repli deviendrait vraie par accident et masquerait le desaccord.
    for (const chemin of ["/api/devis", "/api/factures-client"]) {
      const r = await request(appli()).get(`${chemin}?limit=1`);
      expect(r.body).not.toHaveProperty("data");
    }
  });

  it("le flux agrege les deux, cote a cote", async () => {
    // Le comportement attendu par l'utilisateur : un devis ET une facture du
    // jour figurent tous les deux dans « activite recente ».
    const [d, f] = await Promise.all([
      request(appli()).get("/api/devis?limit=30"),
      request(appli()).get("/api/factures-client?limit=30"),
    ]);
    const flux = [
      ...(clefsLues("devisR").map((k) => d.body?.[k]).find(Array.isArray) ?? []),
      ...(clefsLues("facturesR").map((k) => f.body?.[k]).find(Array.isArray) ?? []),
    ];
    expect(flux.map((x: any) => x.reference)).toEqual(
      expect.arrayContaining([`DEV-${stamp}`, `FAC-${stamp}`]),
    );
  });
});
