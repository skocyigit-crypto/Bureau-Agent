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
import { db, organisationsTable, aiLearnedPreferencesTable, proactiveSuggestionsTable } from "@workspace/db";
import {
  getSuppressedSuggestionTypes,
  reactivateSuggestionType,
  recomputeLearnedPreferences,
} from "../services/ai-learning";

const stamp = Date.now();
let orgA: number;
let orgB: number;
let orgC: number;
let orgD: number;

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
  orgC = await seedOrg("c");
  orgD = await seedOrg("d");

  // orgA: cas variés
  await seedPref(orgA, "suggestion_type", "inactive_contact", -0.8, 0, 5); // SUPPRIMÉ
  await seedPref(orgA, "suggestion_type", "meeting_prep", -0.6, 1, 4); // SUPPRIMÉ
  await seedPref(orgA, "suggestion_type", "overdue_task", -0.5, 0, 3); // PAS supprimé (score pas < -0.5)
  await seedPref(orgA, "suggestion_type", "urgent_message", -0.9, 0, 2); // PAS supprimé (downCount < 3)
  await seedPref(orgA, "suggestion_type", "calendar_conflict", 0.7, 5, 0); // PAS supprimé (positif)
  await seedPref(orgA, "insight_category", "inactive_contact", -0.9, 0, 9); // PAS supprimé (autre kind)
  // Type fortement rejeté MAIS réactivé explicitement par le dirigeant -> PAS supprimé.
  await db.insert(aiLearnedPreferencesTable).values({
    organisationId: orgA,
    kind: "suggestion_type",
    key: "cash_crunch",
    score: -0.9,
    upCount: 0,
    downCount: 7,
    suppressionOverridden: 1,
  });

  // orgB: un type rejeté qui ne doit PAS fuiter vers orgA
  await seedPref(orgB, "suggestion_type", "missed_call_followup", -0.95, 0, 8); // SUPPRIMÉ (orgB only)

  // orgC: dédié au test de réactivation.
  await seedPref(orgC, "suggestion_type", "negative_call_followup", -0.85, 0, 6); // SUPPRIMÉ au départ

  // orgD: dédié au test de DURABILITÉ. On sème de vrais 👎 dans
  // proactive_suggestions pour que recomputeLearnedPreferences RECONSTRUISE la
  // préférence depuis la source (et ne la purge pas), afin de vérifier que la
  // réactivation survit au recalcul quotidien.
  await db.insert(proactiveSuggestionsTable).values(
    [0, 1, 2, 3].map((i) => ({
      organisationId: orgD,
      type: "overdue_task",
      title: `Tâche en retard #${i}`,
      dedupeKey: `overdue_task:d-${stamp}-${i}`,
      status: "done",
      feedback: "down",
    })),
  );
});

afterAll(async () => {
  try {
    await db.delete(aiLearnedPreferencesTable).where(inArray(aiLearnedPreferencesTable.organisationId, [orgA, orgB, orgC, orgD]));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [orgA, orgB, orgC, orgD]));
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

  it("n'inclut PAS un type explicitement réactivé (suppressionOverridden)", async () => {
    const set = await getSuppressedSuggestionTypes(orgA);
    expect(set.has("cash_crunch")).toBe(false);
  });
});

describe("reactivateSuggestionType — réactivation durable", () => {
  it("retire un type de l'ensemble supprimé après réactivation", async () => {
    const before = await getSuppressedSuggestionTypes(orgC);
    expect(before.has("negative_call_followup")).toBe(true);

    const ok = await reactivateSuggestionType(orgC, "negative_call_followup");
    expect(ok).toBe(true);

    // invalidateContextCache purge le cache 5 min -> effet immédiat.
    const after = await getSuppressedSuggestionTypes(orgC);
    expect(after.has("negative_call_followup")).toBe(false);
  });

  it("renvoie false pour un type inconnu ou un orgId invalide", async () => {
    expect(await reactivateSuggestionType(orgC, "type_inexistant")).toBe(false);
    expect(await reactivateSuggestionType(0, "negative_call_followup")).toBe(false);
  });

  it("la réactivation survit au recalcul quotidien (recomputeLearnedPreferences)", async () => {
    // 1) Le recalcul reconstruit la préférence depuis les 👎 -> supprimé.
    await recomputeLearnedPreferences(orgD);
    expect((await getSuppressedSuggestionTypes(orgD)).has("overdue_task")).toBe(true);

    // 2) Le dirigeant réactive le type.
    expect(await reactivateSuggestionType(orgD, "overdue_task")).toBe(true);
    expect((await getSuppressedSuggestionTypes(orgD)).has("overdue_task")).toBe(false);

    // 3) Un nouveau recalcul NE doit PAS ré-supprimer (le drapeau survit à l'upsert).
    await recomputeLearnedPreferences(orgD);
    expect((await getSuppressedSuggestionTypes(orgD)).has("overdue_task")).toBe(false);
  });
});
