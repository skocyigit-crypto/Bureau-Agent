/**
 * Détecteur 9 — SLA de réponse aux messages entrants.
 *
 * `selectUnansweredInbound` est le cœur PUR (sans base) du détecteur : à partir
 * des messages entrants candidats et de la date de la DERNIÈRE réponse sortante
 * connue par numéro, il renvoie ceux qui restent SANS réponse. Cette suite
 * verrouille la sémantique « répondu » :
 *
 *   - aucune réponse connue ⇒ le message reste non répondu.
 *   - une réponse POSTÉRIEURE au message ⇒ répondu (auto-résolution).
 *   - une réponse ANTÉRIEURE (réponse à un échange plus ancien) ⇒ toujours
 *     non répondu.
 *   - une seule réponse récente « répond » à tous les entrants antérieurs du
 *     même numéro, mais pas à un entrant plus récent qu'elle.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { selectUnansweredInbound } from "../services/proactive-engine";

function msg(phoneNumber: string, createdAtMs: number, id: number) {
  return { id, phoneNumber, createdAt: new Date(createdAtMs) };
}

describe("selectUnansweredInbound", () => {
  it("garde un entrant sans aucune réponse connue", () => {
    const inbound = [msg("+33100", 1_000, 1)];
    const out = selectUnansweredInbound(inbound, new Map());
    expect(out.map((m) => m.id)).toEqual([1]);
  });

  it("retire un entrant suivi d'une réponse postérieure", () => {
    const inbound = [msg("+33100", 1_000, 1)];
    const replies = new Map<string, number>([["+33100", 2_000]]);
    const out = selectUnansweredInbound(inbound, replies);
    expect(out).toHaveLength(0);
  });

  it("garde un entrant plus récent que la dernière réponse", () => {
    const inbound = [msg("+33100", 3_000, 1)];
    const replies = new Map<string, number>([["+33100", 2_000]]);
    const out = selectUnansweredInbound(inbound, replies);
    expect(out.map((m) => m.id)).toEqual([1]);
  });

  it("une réponse répond à tous les entrants antérieurs du même numéro", () => {
    const inbound = [
      msg("+33100", 1_000, 1), // antérieur -> répondu
      msg("+33100", 1_500, 2), // antérieur -> répondu
      msg("+33100", 5_000, 3), // postérieur -> non répondu
    ];
    const replies = new Map<string, number>([["+33100", 2_000]]);
    const out = selectUnansweredInbound(inbound, replies);
    expect(out.map((m) => m.id)).toEqual([3]);
  });

  it("isole les numéros : une réponse sur un numéro n'affecte pas un autre", () => {
    const inbound = [msg("+33100", 1_000, 1), msg("+33200", 1_000, 2)];
    const replies = new Map<string, number>([["+33100", 2_000]]);
    const out = selectUnansweredInbound(inbound, replies);
    expect(out.map((m) => m.id)).toEqual([2]);
  });
});
