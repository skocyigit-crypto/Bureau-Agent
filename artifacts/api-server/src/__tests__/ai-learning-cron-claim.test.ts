/**
 * Durabilité du cron d'apprentissage (réclamation atomique par organisation).
 *
 * Le recalcul quotidien (préférences + motifs + profils par employé) ne doit
 * tourner qu'AU PLUS une fois par fenêtre et par organisation, même si le
 * serveur redémarre fréquemment (cas Replit). L'état est 100% dérivé de la base
 * via `organisations.aiLearningLastRunAt` : un restart 90 s après le boot ne doit
 * pas relancer un cycle complet déjà fait dans la fenêtre.
 *
 * Cette suite verrouille la sélection atomique `claimOrgsDueForLearning(cutoff)` :
 *   - une org jamais recalculée (NULL) est réclamée ;
 *   - une org recalculée hors fenêtre (ancienne) est réclamée ;
 *   - une org recalculée dans la fenêtre (récente) n'est PAS réclamée ;
 *   - une org inactive n'est jamais réclamée ;
 *   - une 2e réclamation immédiate ne re-sélectionne pas (marqueur avancé).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, eq } from "drizzle-orm";
import { db, organisationsTable } from "@workspace/db";
import { claimOrgsDueForLearning } from "../services/ai-learning";

const stamp = Date.now();
const WINDOW_MS = 20 * 60 * 60 * 1000;

let orgNull: number; // jamais recalculée
let orgOld: number; // recalculée il y a 21 h (hors fenêtre)
let orgFresh: number; // recalculée il y a 1 h (dans la fenêtre)
let orgInactive: number; // hors fenêtre mais inactive

async function seedOrg(tag: string, lastRunAt: Date | null, actif = true): Promise<number> {
  const [row] = await db
    .insert(organisationsTable)
    .values({
      name: `Cron ${tag} ${stamp}`,
      slug: `cron-${tag}-${stamp}`,
      maxUsers: 10,
      actif,
      aiLearningLastRunAt: lastRunAt,
    })
    .returning({ id: organisationsTable.id });
  return row.id;
}

beforeAll(async () => {
  const now = Date.now();
  orgNull = await seedOrg("null", null);
  orgOld = await seedOrg("old", new Date(now - 21 * 60 * 60 * 1000));
  orgFresh = await seedOrg("fresh", new Date(now - 1 * 60 * 60 * 1000));
  orgInactive = await seedOrg("inactive", new Date(now - 21 * 60 * 60 * 1000), false);
});

afterAll(async () => {
  try {
    await db
      .delete(organisationsTable)
      .where(inArray(organisationsTable.id, [orgNull, orgOld, orgFresh, orgInactive]));
  } catch {
    // best-effort; slugs uniques par run (stamp).
  }
});

describe("Cron apprentissage — réclamation atomique par fenêtre", () => {
  it("réclame les org dues (NULL + hors fenêtre), ignore récentes et inactives", async () => {
    const cutoff = new Date(Date.now() - WINDOW_MS);
    const claimed = await claimOrgsDueForLearning(cutoff);

    expect(claimed).toContain(orgNull);
    expect(claimed).toContain(orgOld);
    expect(claimed).not.toContain(orgFresh);
    expect(claimed).not.toContain(orgInactive);
  });

  it("avance le marqueur: une 2e réclamation immédiate ne re-sélectionne pas", async () => {
    // La 1re réclamation (test précédent) a avancé aiLearningLastRunAt à now pour
    // orgNull et orgOld. Une 2e passe dans la même fenêtre ne doit rien reprendre.
    const cutoff = new Date(Date.now() - WINDOW_MS);
    const claimed = await claimOrgsDueForLearning(cutoff);

    expect(claimed).not.toContain(orgNull);
    expect(claimed).not.toContain(orgOld);

    // Le marqueur des deux org est bien renseigné (durable au redémarrage).
    const rows = await db
      .select({ id: organisationsTable.id, at: organisationsTable.aiLearningLastRunAt })
      .from(organisationsTable)
      .where(inArray(organisationsTable.id, [orgNull, orgOld]));
    for (const r of rows) {
      expect(r.at).not.toBeNull();
    }
  });

  it("orgInactive garde son marqueur inchangé (jamais réclamée)", async () => {
    const [row] = await db
      .select({ at: organisationsTable.aiLearningLastRunAt })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, orgInactive));
    // Toujours ~21 h dans le passé : non avancé par les réclamations.
    expect(row.at).not.toBeNull();
    expect(Date.now() - (row.at as Date).getTime()).toBeGreaterThan(WINDOW_MS);
  });
});
