/**
 * Sélection des types de suggestions proactives à SUPPRIMER (boucle de feedback).
 *
 * `getSuppressedSuggestionTypes(orgId)` ne doit retenir qu'un type NETTEMENT et
 * DURABLEMENT rejeté: score < -0.5 ET downCount >= 3. Tout le reste (score pas
 * assez négatif, échantillon trop faible, autre `kind`) est ignoré pour ne pas
 * sur-supprimer sur du bruit. Vérifie aussi l'isolation par organisation.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db, organisationsTable, aiLearnedPreferencesTable } from "@workspace/db";
import { getSuppressedSuggestionTypes } from "../services/ai-learning";

const stamp = Date.now();
let orgA: number;
let orgB: number;

async function seedOrg(tag: string): Promise<number> {
  const [row] = await db
    .insert(organisationsTable)
    .values({ name: `Suppr ${tag} ${stamp}`, slug: `suppr-${tag}-${stamp}`, maxUsers: 10, actif: true })
    .returning({ id: organisationsTable.id });
  return row.id;
}

async function seedPref(
  orgId: number,
  kind: string,
  key: string,
  score: number,
  upCount: number,
  downCount: number,
): Promise<void> {
  await db.insert(aiLearnedPreferencesTable).values({ organisationId: orgId, kind, key, score, upCount, downCount });
}

beforeAll(async () => {
  orgA = await seedOrg("a");
  orgB = await seedOrg("b");

  // orgA: cas variés
  await seedPref(orgA, "suggestion_type", "inactive_contact", -0.8, 0, 5); // SUPPRIMÉ
  await seedPref(orgA, "suggestion_type", "meeting_prep", -0.6, 1, 4); // SUPPRIMÉ
  await seedPref(orgA, "suggestion_type", "overdue_task", -0.5, 0, 3); // PAS supprimé (score pas < -0.5)
  await seedPref(orgA, "suggestion_type", "urgent_message", -0.9, 0, 2); // PAS supprimé (downCount < 3)
  await seedPref(orgA, "suggestion_type", "calendar_conflict", 0.7, 5, 0); // PAS supprimé (positif)
  await seedPref(orgA, "insight_category", "inactive_contact", -0.9, 0, 9); // PAS supprimé (autre kind)

  // orgB: un type rejeté qui ne doit PAS fuiter vers orgA
  await seedPref(orgB, "suggestion_type", "missed_call_followup", -0.95, 0, 8); // SUPPRIMÉ (orgB only)
});

afterAll(async () => {
  try {
    await db.delete(aiLearnedPreferencesTable).where(inArray(aiLearnedPreferencesTable.organisationId, [orgA, orgB]));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [orgA, orgB]));
  } catch {
    // best-effort; slugs uniques par run (stamp).
  }
});

describe("getSuppressedSuggestionTypes — seuils & isolation", () => {
  it("ne retient que score < -0.5 ET downCount >= 3 du kind suggestion_type", async () => {
    const set = await getSuppressedSuggestionTypes(orgA);
    expect([...set].sort()).toEqual(["inactive_contact", "meeting_prep"]);
  });

  it("exclut le seuil exact -0.5 et les échantillons trop faibles", async () => {
    const set = await getSuppressedSuggestionTypes(orgA);
    expect(set.has("overdue_task")).toBe(false); // score === -0.5 (non strict)
    expect(set.has("urgent_message")).toBe(false); // downCount === 2 < 3
    expect(set.has("calendar_conflict")).toBe(false); // positif
  });

  it("est isolé par organisation (pas de fuite inter-tenant)", async () => {
    const setA = await getSuppressedSuggestionTypes(orgA);
    expect(setA.has("missed_call_followup")).toBe(false); // appartient à orgB
    const setB = await getSuppressedSuggestionTypes(orgB);
    expect([...setB]).toEqual(["missed_call_followup"]);
  });

  it("renvoie un ensemble vide pour un orgId invalide (fail-soft)", async () => {
    expect((await getSuppressedSuggestionTypes(undefined)).size).toBe(0);
    expect((await getSuppressedSuggestionTypes(0)).size).toBe(0);
  });
});
