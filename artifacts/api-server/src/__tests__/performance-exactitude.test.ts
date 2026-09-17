/**
 * Evaluation de salaries : les heures d'un autre ne doivent pas vous etre
 * attribuees, et les modeles n'ont pas besoin de savoir qui vous etes.
 * Voir services/performance-garde-fous.ts.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { checkinsTable, db, organisationsTable, tasksTable, usersTable } from "@workspace/db";
import { gatherUserMetrics } from "../services/performance-analyzer";
import {
  debutPeriode, idEmploye, normaliserNom, periodeValide, pseudonymiser, reidentifier, scoreSalarie,
} from "../services/performance-garde-fous";

const SERVICE = readFileSync(join(import.meta.dirname, "..", "services", "performance-analyzer.ts"), "utf8");
const ROUTE = readFileSync(join(import.meta.dirname, "..", "routes", "performance.ts"), "utf8");
const stamp = Date.now();
let orgId = 0;

beforeAll(async () => {
  const [org] = await db.insert(organisationsTable).values({
    name: `Perf ${stamp}`, slug: `perf-${stamp}`, email: `perf-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = org!.id;
  for (const [prenom, nom] of [["Jean", "Martin"], ["Jean", "Martinez"]] as const) {
    await db.insert(usersTable).values({ organisationId: orgId, email: `${nom}-${stamp}@example.test`, passwordHash: "x", prenom, nom, role: "agent", actif: true });
  }
  const now = new Date();
  // Seul « Jean Martinez » a pointe (8 h, 45 min de pause) et termine une tache.
  await db.insert(checkinsTable).values({ organisationId: orgId, employeeName: "Jean Martinez", type: "arrivee", status: "termine", checkInAt: now, totalMinutes: 480, breakMinutes: 45 } as any);
  await db.insert(tasksTable).values({ organisationId: orgId, title: "T", status: "termine", assignedTo: "  jean   MARTINEZ " } as any);
}, 60_000);

afterAll(async () => { if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); });

describe("attribution exacte (base reelle)", () => {
  it("« Jean Martin » ne recoit PAS les heures de « Jean Martinez »", async () => {
    const m = await gatherUserMetrics(new Date(Date.now() - 86400000), new Date(Date.now() + 60000), orgId);
    const martin = m.find((x) => x.nom === "Martin")!;
    expect(martin.heuresTravaillees).toBe(0);
    expect(martin.pausesMinutes).toBe(0);
    expect(martin.tachesTerminees).toBe(0);
  }, 60_000);
  it("« Jean Martinez » garde les siennes, casse et espaces ignores", async () => {
    const m = await gatherUserMetrics(new Date(Date.now() - 86400000), new Date(Date.now() + 60000), orgId);
    const martinez = m.find((x) => x.nom === "Martinez")!;
    expect(martinez.heuresTravaillees).toBe(8);
    expect(martinez.pausesMinutes).toBe(45);
    expect(martinez.tachesTerminees).toBe(1);
  }, 60_000);
  it("plus de ILIKE %nom% dans le service", () => expect(SERVICE).not.toMatch(/ILIKE \$\{`%\$\{fullName\}%`\}/));
  it("normalisation", () => expect(normaliserNom("  Jean   MARTIN ")).toBe("jean martin"));
});

describe("minimisation vers les modeles", () => {
  const metr = [
    { userId: 41, email: "a@x.fr", nom: "Martin", prenom: "Jean", departement: "Chantier", role: "agent", heuresTravaillees: 7 },
    { userId: 42, email: "b@x.fr", nom: "Durand", prenom: "Anne", departement: null, role: "agent", heuresTravaillees: 9 },
  ];
  it("aucune identite dans ce qui part", () => {
    const { donnees } = pseudonymiser(metr);
    const json = JSON.stringify(donnees);
    for (const x of ["Martin", "Jean", "a@x.fr", "Chantier", "Durand", "41"]) expect(json).not.toContain(x);
    expect(donnees[0]).toMatchObject({ userId: 1, salarie: "Salarie-1", heuresTravaillees: 7 });
  });
  it("re-identification dans toute la reponse", () => {
    const { table } = pseudonymiser(metr);
    expect(reidentifier({ a: ["Salarie-2 est le plus assidu"], b: { c: "Salarie-1" } }, table))
      .toEqual({ a: ["Anne Durand est le plus assidu"], b: { c: "Jean Martin" } });
  });
  it("un rang inconnu reste tel quel", () => expect(reidentifier("Salarie-9", pseudonymiser(metr).table)).toBe("Salarie-9"));
  it("le rapport envoie les donnees pseudonymisees", () => {
    expect(SERVICE).toContain("const metricsJSON = JSON.stringify(donnees, null, 2);");
    expect(SERVICE).not.toContain("JSON.stringify(allMetrics");
  });
  it("plus de profil comportemental ni de blague demandes", () => {
    expect(SERVICE).not.toContain('"profilsComportementaux"');
    expect(SERVICE).not.toContain("blague legere");
    expect(SERVICE).not.toContain('"citationMotivante"');
  });
});

describe("export, periode, identifiant, score", () => {
  it("l'export lit des champs qui existent", () => {
    for (const absent of ["m.callCount", "m.performanceScore", "m.userName"]) expect(ROUTE).not.toContain(absent);
    expect(ROUTE).toContain("m.heuresTravaillees");
  });
  it("l'export est trace", () => expect(ROUTE).toContain('"performance_export_csv"'));
  it("une seule definition de periode (plus de « 24 h » dans l'export)", () => {
    expect(ROUTE).not.toContain("setDate(now.getDate() - 1)");
    const d = debutPeriode("jour", new Date(2026, 6, 15, 14, 30));
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
  });
  it("periode invalide : semaine", () => expect(periodeValide("annee")).toBe("semaine"));
  it("employeId « 12 » devient 12", () => {
    expect(idEmploye("12")).toBe(12);
    expect(idEmploye("abc")).toBeUndefined();
    expect(idEmploye(-1)).toBeUndefined();
  });
  it("score borne, absent = pas de note enregistree", () => {
    expect(scoreSalarie(130)).toBe(100);
    expect(scoreSalarie(undefined)).toBeNull();
  });
  it("sans score lisible, aucune ligne n'est ecrite sur la personne", () => {
    // Mutation survivante mesuree : retirer la garde laissait passer les tests
    // unitaires. On verrouille son ordre par rapport a l'insertion.
    const garde = SERVICE.indexOf("if (score === null) continue;");
    expect(garde).toBeGreaterThan(0);
    expect(garde).toBeLessThan(SERVICE.indexOf("db.insert(performanceReportsTable)"));
    expect(SERVICE).toContain("scoreGlobal: score,");
  });
});
