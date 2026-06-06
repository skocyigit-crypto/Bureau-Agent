/**
 * Boucle de feedback -> suppression des suggestions proactives.
 *
 * Quand le dirigeant rejette de façon répétée et nette un type de suggestion
 * (👎), le moteur déterministe doit cesser d'en produire de NOUVELLES. C'est
 * ainsi que les votes influencent concrètement ce que l'utilisateur voit (et pas
 * seulement le ton des textes rédigés par l'IA).
 *
 * Invariant de sécurité verrouillé ici: la suppression ne s'applique JAMAIS aux
 * suggestions de sévérité « urgent » — un type mal noté ne doit pas masquer une
 * urgence réelle (trésorerie, appel tendu, etc.). Test PUR (sans base de données)
 * sur `filterSuppressedCandidates`.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { filterSuppressedCandidates, type Severity } from "../services/proactive-engine";

function cand(type: string, severity: Severity, id: number) {
  return {
    type,
    severity,
    title: `${type} #${id}`,
    dedupeKey: `${type}:${id}`,
  };
}

describe("filterSuppressedCandidates", () => {
  it("ne retire rien quand aucun type n'est supprimé", () => {
    const candidates = [
      cand("overdue_task", "warning", 1),
      cand("inactive_contact", "info", 2),
    ];
    const out = filterSuppressedCandidates(candidates, new Set());
    expect(out).toHaveLength(2);
  });

  it("retire les candidats non-urgents d'un type rejeté", () => {
    const candidates = [
      cand("inactive_contact", "info", 1),
      cand("inactive_contact", "info", 2),
      cand("overdue_task", "warning", 3),
    ];
    const out = filterSuppressedCandidates(candidates, new Set(["inactive_contact"]));
    expect(out.map((c) => c.type)).toEqual(["overdue_task"]);
  });

  it("garde TOUJOURS les candidats urgents, même d'un type rejeté", () => {
    const candidates = [
      cand("overdue_task", "warning", 1), // supprimé
      cand("overdue_task", "urgent", 2), // conservé (urgence)
    ];
    const out = filterSuppressedCandidates(candidates, new Set(["overdue_task"]));
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("urgent");
    expect(out[0].dedupeKey).toBe("overdue_task:2");
  });

  it("ne touche pas aux types non rejetés", () => {
    const candidates = [
      cand("inactive_contact", "info", 1), // supprimé
      cand("missed_call_followup", "warning", 2), // conservé
      cand("calendar_conflict", "urgent", 3), // conservé
    ];
    const out = filterSuppressedCandidates(candidates, new Set(["inactive_contact"]));
    expect(out.map((c) => c.type).sort()).toEqual(["calendar_conflict", "missed_call_followup"]);
  });
});
