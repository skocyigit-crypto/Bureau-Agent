/**
 * Regression: executeProposal ne doit jamais executer deux fois la meme action,
 * ni re-executer une proposition deja tranchee.
 *
 * Deux approbations concurrentes de la meme proposition (double clic, rejeu
 * reseau, deux instances Cloud Run) chargeaient toutes deux le statut
 * `en_attente` et appelaient toutes deux l'outil: e-mail parti deux fois, tache
 * creee en double. La serialisation reelle repose sur un verrou consultatif
 * Postgres (teste en integration cote CI). Ici, avec une base simulee, on
 * verrouille la partie DETERMINISTE du contrat, celle que le refactor du verrou
 * ne devait pas casser:
 *   - une proposition `executee` renvoie son resultat memoise SANS re-executer;
 *   - une proposition `rejetee` est refusee SANS executer;
 *   - une proposition `en_attente` execute l'outil exactement une fois.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

let currentRow: Record<string, unknown> | null = null;
const executeToolSpy = vi.fn(async () => ({ ok: true, result: { sent: true } }));

// Base simulee: pas de vrai verrou (db.execute est un no-op), select renvoie la
// ligne courante, update la mute en memoire.
vi.mock("@workspace/db", () => ({
  db: {
    execute: async () => ({ rows: [{}] }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (currentRow ? [currentRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          if (currentRow) Object.assign(currentRow, patch);
          return undefined;
        },
      }),
    }),
  },
  agentProposalsTable: {
    id: "id", organisationId: "organisationId", status: "status",
  },
}));

vi.mock("../services/assistant-tools", () => ({
  executeTool: (...args: unknown[]) => executeToolSpy(...(args as [])),
  getTool: () => ({ requiresConfirmation: true }),
}));

const { executeProposal } = await import("../services/autonomous-secretary");

const CTX = { orgId: 1, userId: 7 };

describe("executeProposal — garde d'execution", () => {
  beforeEach(() => {
    executeToolSpy.mockClear();
  });

  it("execute une proposition en attente exactement une fois", async () => {
    currentRow = { id: 10, organisationId: 1, status: "en_attente", toolName: "send_email", args: {}, result: null };
    const r = await executeProposal(10, CTX);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("executee");
    expect(executeToolSpy).toHaveBeenCalledTimes(1);
  });

  it("ne re-execute pas une proposition deja executee (resultat memoise)", async () => {
    currentRow = { id: 11, organisationId: 1, status: "executee", toolName: "send_email", args: {}, result: { sent: true } };
    const r = await executeProposal(11, CTX);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("executee");
    expect(r.result).toEqual({ sent: true });
    expect(executeToolSpy).not.toHaveBeenCalled();
  });

  it("refuse une proposition rejetee sans executer", async () => {
    currentRow = { id: 12, organisationId: 1, status: "rejetee", toolName: "send_email", args: {}, result: null };
    const r = await executeProposal(12, CTX);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("rejetee");
    expect(executeToolSpy).not.toHaveBeenCalled();
  });

  it("renvoie introuvable si la proposition n'existe pas dans l'organisation", async () => {
    currentRow = null;
    const r = await executeProposal(999, CTX);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/introuvable/i);
    expect(executeToolSpy).not.toHaveBeenCalled();
  });
});
