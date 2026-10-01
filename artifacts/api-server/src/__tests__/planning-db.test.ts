/**
 * Le planning en trois vues (plan du 29/09, section 7).
 *
 * Le scenario du plan : « l'equipe d'electricite ne peut pas venir jeudi ».
 * L'electricite glisse de deux jours ; le doublage, qui l'attend, glisse ; la
 * peinture, qui attend le doublage, glisse aussi. Rien n'est ecrit dans les
 * taches : le glissement est calcule et propose.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { calendarEventsTable, db, organisationsTable, projetsTable, taskDependancesTable, tasksTable, usersTable } from "@workspace/db";
import planningRouter from "../routes/planning";
import { calculerGlissements, fermeraitUneBoucle, type TachePlan } from "../services/planning";

const J = 86_400_000;
const T0 = new Date("2026-10-05T08:00:00.000Z"); // un lundi
const jour = (n: number) => new Date(T0.getTime() + n * J);
const stamp = Date.now();
const ids: Record<string, number> = {};

function appli(orgId = ids.orgA) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: ids.admin, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", planningRouter);
  return a;
}

const t = (id: number, d: number, f: number, statut = "en_attente"): TachePlan => ({ id, titre: `T${id}`, debut: jour(d), fin: jour(f), statut, projetId: 1, responsable: null });

describe("le glissement se propage (pur)", () => {
  it("l'electricite glisse de 2 jours : le doublage et la peinture glissent de 2 jours", () => {
    // Electricite prevue J0-J2 mais repoussee : on la modelise par une
    // tache amont (« attente electricien ») qui finit a J4 au lieu de J2.
    const taches = [t(1, 0, 4), t(2, 2, 5), t(3, 5, 7)];
    const liens = [{ tacheId: 2, dependDe: 1 }, { tacheId: 3, dependDe: 2 }];
    const { glissements, boucle } = calculerGlissements(taches, liens);
    expect(boucle).toBeNull();
    expect(glissements.get(2)!.jours).toBe(2);
    expect(glissements.get(2)!.causes).toEqual([1]);
    expect(glissements.get(3)!.jours, "la peinture herite du retard du doublage").toBe(2);
    expect(glissements.get(3)!.causes).toEqual([2]);
  });

  it("une tache qui tient ne glisse pas", () => {
    const { glissements } = calculerGlissements([t(1, 0, 2), t(2, 3, 5)], [{ tacheId: 2, dependDe: 1 }]);
    expect(glissements.get(2)!.jours).toBe(0);
    expect(glissements.get(2)!.causes).toEqual([]);
  });

  it("une tache terminee ne fait plus glisser personne", () => {
    const { glissements } = calculerGlissements([t(1, 0, 9, "termine"), t(2, 3, 5)], [{ tacheId: 2, dependDe: 1 }]);
    expect(glissements.get(2)!.jours).toBe(0);
  });

  it("deux taches attendues : la plus tardive decide", () => {
    const { glissements } = calculerGlissements([t(1, 0, 3), t(2, 0, 6), t(3, 4, 8)], [{ tacheId: 3, dependDe: 1 }, { tacheId: 3, dependDe: 2 }]);
    expect(glissements.get(3)!.jours).toBe(2);
    expect(glissements.get(3)!.causes).toEqual([2]);
  });

  it("une boucle est signalee, jamais parcourue a l'infini", () => {
    const { boucle } = calculerGlissements([t(1, 0, 2), t(2, 2, 4)], [{ tacheId: 1, dependDe: 2 }, { tacheId: 2, dependDe: 1 }]);
    expect(boucle?.sort()).toEqual([1, 2]);
  });

  it("detecte la boucle avant de l'ecrire, directe ou indirecte", () => {
    const liens = [{ tacheId: 2, dependDe: 1 }, { tacheId: 3, dependDe: 2 }];
    expect(fermeraitUneBoucle(liens, 1, 3)).toBe(true);
    expect(fermeraitUneBoucle(liens, 1, 1)).toBe(true);
    expect(fermeraitUneBoucle(liens, 3, 1)).toBe(false);
  });
});

beforeAll(async () => {
  for (const k of ["orgA", "orgB"]) {
    const [o] = await db.insert(organisationsTable).values({ name: `Plan ${k} ${stamp}`, slug: `plan-${k.toLowerCase()}-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
    ids[k] = o!.id;
  }
  const [u] = await db.insert(usersTable).values({ organisationId: ids.orgA, email: `plan-${stamp}@exemple.test`, passwordHash: "x", prenom: "P", nom: "L", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  ids.admin = u!.id;
  const [p] = await db.insert(projetsTable).values({ organisationId: ids.orgA, title: "Renovation Martin" }).returning();
  ids.projet = p!.id;
  const mk = async (titre: string, d: number, f: number, resp: string) =>
    (await db.insert(tasksTable).values({ organisationId: ids.orgA, projetId: ids.projet, title: titre, startDate: jour(d), dueDate: jour(f), assignedTo: resp, status: "en_attente" }).returning())[0]!.id;
  ids.elec = await mk("Electricite", 0, 4, "Equipe elec");
  ids.doublage = await mk("Doublage", 2, 5, "Equipe placo");
  ids.peinture = await mk("Peinture", 5, 7, "Equipe placo");
  ids.chevauche = await mk("Autre chantier placo", 4, 6, "Equipe placo");
  await db.insert(calendarEventsTable).values([
    { organisationId: ids.orgA, title: "Visite devis Dupont", type: "rendez_vous", startDate: jour(1), endDate: new Date(jour(1).getTime() + 3600e3) },
    { organisationId: ids.orgA, title: "Pose echafaudage", type: "chantier", projetId: ids.projet, startDate: jour(1), endDate: jour(2) },
  ]);
});

describe("les trois vues, sur une vraie base", () => {
  it("lier, puis voir le glissement en cascade dans le plan de travaux", async () => {
    expect((await request(appli()).post(`/api/planning/taches/${ids.doublage}/attend`).send({ dependDe: ids.elec })).status).toBe(201);
    expect((await request(appli()).post(`/api/planning/taches/${ids.peinture}/attend`).send({ dependDe: ids.doublage })).status).toBe(201);
    const r = await request(appli()).get(`/api/planning/travaux?projetId=${ids.projet}`);
    expect(r.status, r.text).toBe(200);
    const parId = new Map(r.body.taches.map((x: any) => [x.id, x]));
    expect((parId.get(ids.doublage) as any).glissementJours).toBe(2);
    expect((parId.get(ids.peinture) as any).glissementJours).toBe(2);
    expect((parId.get(ids.peinture) as any).causes).toEqual([ids.doublage]);
  });

  it("le glissement n'est PAS ecrit dans les taches", async () => {
    const [d] = await db.select().from(tasksTable).where(eq(tasksTable.id, ids.doublage));
    expect(new Date(d!.startDate!).getTime()).toBe(jour(2).getTime());
  });

  it("un lien qui fermerait une boucle est refuse", async () => {
    const r = await request(appli()).post(`/api/planning/taches/${ids.elec}/attend`).send({ dependDe: ids.peinture });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("boucle");
  });

  it("une tache d'une autre organisation ne se lie pas", async () => {
    const [x] = await db.insert(tasksTable).values({ organisationId: ids.orgB, title: "B" }).returning();
    const r = await request(appli()).post(`/api/planning/taches/${ids.elec}/attend`).send({ dependDe: x!.id });
    expect(r.status).toBe(404);
    expect(await db.select().from(taskDependancesTable).where(eq(taskDependancesTable.dependDe, x!.id))).toHaveLength(0);
  });

  it("le plan d'equipe signale qu'une personne est prise deux fois", async () => {
    const r = await request(appli()).get(`/api/planning/equipe?du=${jour(0).toISOString()}&au=${jour(8).toISOString()}`);
    expect(r.status).toBe(200);
    const placo = r.body.equipe.find((e: any) => e.personne === "Equipe placo");
    expect(placo.conflits.map((c: number[]) => c.slice().sort((a, b) => a - b))).toContainEqual([ids.peinture, ids.chevauche].sort((a, b) => a - b));
  });

  it("les rendez-vous ne montrent que les creneaux sans chantier", async () => {
    const r = await request(appli()).get(`/api/planning/rendez-vous?du=${jour(0).toISOString()}&au=${jour(3).toISOString()}`);
    const titres = r.body.rendezVous.map((x: any) => x.titre);
    expect(titres).toContain("Visite devis Dupont");
    expect(titres).not.toContain("Pose echafaudage");
  });

  it("une periode de plus de 92 jours est refusee", async () => {
    const r = await request(appli()).get(`/api/planning/equipe?du=${jour(0).toISOString()}&au=${jour(120).toISOString()}`);
    expect(r.status).toBe(400);
  });

  it("deplacer une tache : l'echeance ne peut pas preceder le debut", async () => {
    const r = await request(appli()).post(`/api/planning/taches/${ids.elec}/dates`).send({ debut: jour(5).toISOString(), fin: jour(3).toISOString() });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("dates_inversees");
    const ok = await request(appli()).post(`/api/planning/taches/${ids.elec}/dates`).send({ fin: jour(6).toISOString() });
    expect(ok.status).toBe(200);
    const v = await request(appli()).get(`/api/planning/travaux?projetId=${ids.projet}`);
    expect(v.body.taches.find((x: any) => x.id === ids.peinture).glissementJours, "l'electricite repoussee a J6 pousse la peinture de 4 jours").toBe(4);
  });

  it("une tache de chantier se cree avec ses dates et apparait au plan de travaux", async () => {
    const r = await request(appli()).post("/api/planning/taches").send({ projetId: ids.projet, titre: "Carrelage", responsable: "Equipe sol", debut: jour(8).toISOString(), fin: jour(10).toISOString() });
    expect(r.status, r.text).toBe(201);
    const v = await request(appli()).get(`/api/planning/travaux?projetId=${ids.projet}`);
    expect(v.body.taches.map((x: any) => x.titre)).toContain("Carrelage");
  });

  it("on ne cree pas de tache dans le chantier d'une autre organisation", async () => {
    const [pb] = await db.insert(projetsTable).values({ organisationId: ids.orgB, title: "B" }).returning();
    const r = await request(appli()).post("/api/planning/taches").send({ projetId: pb!.id, titre: "Intrus" });
    expect(r.status).toBe(400);
    expect(await db.select().from(tasksTable).where(eq(tasksTable.projetId, pb!.id))).toHaveLength(0);
  });

  it("une tache existante se rattache a un chantier, et pas a celui d'une autre organisation", async () => {
    const [libre] = await db.insert(tasksTable).values({ organisationId: ids.orgA, title: "Libre" }).returning();
    const [pb] = await db.insert(projetsTable).values({ organisationId: ids.orgB, title: "B2" }).returning();
    expect((await request(appli()).post(`/api/planning/taches/${libre!.id}/chantier`).send({ projetId: pb!.id })).status).toBe(400);
    const ok = await request(appli()).post(`/api/planning/taches/${libre!.id}/chantier`).send({ projetId: ids.projet });
    expect(ok.body.tache.projetId).toBe(ids.projet);
  });

  it("une autre organisation ne voit rien de ce plan", async () => {
    const r = await request(appli(ids.orgB)).get(`/api/planning/travaux?projetId=${ids.projet}`);
    expect(r.body.taches).toEqual([]);
  });

  it("retirer un lien supprime le glissement qu'il causait", async () => {
    const v = await request(appli()).get(`/api/planning/travaux?projetId=${ids.projet}`);
    const lien = v.body.taches.find((x: any) => x.id === ids.doublage).attend[0].lienId;
    expect((await request(appli()).delete(`/api/planning/liens/${lien}`)).status).toBe(200);
    const apres = await request(appli()).get(`/api/planning/travaux?projetId=${ids.projet}`);
    expect(apres.body.taches.find((x: any) => x.id === ids.doublage).glissementJours).toBe(0);
  });
});
