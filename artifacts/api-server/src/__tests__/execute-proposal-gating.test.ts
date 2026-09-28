/**
 * Regression: executeProposal ne doit jamais executer deux fois la meme action,
 * ni re-executer une proposition deja tranchee.
 *
 * Deux approbations concurrentes de la meme proposition (double clic, rejeu
 * reseau, deux instances Cloud Run) chargeaient toutes deux le statut
 * `en_attente` et appelaient toutes deux l'outil: e-mail parti deux fois, tache
 * creee en double. La serialisation repose sur un verrou consultatif Postgres
 * pris par `tryWithLock` (connexion dediee, contrat verifie dans
 * cron-lock.test.ts). Ce commentaire affirmait qu'un test d'integration
 * couvrait ce verrou : il n'en existait aucun, et le verrou passait par
 * `db.execute` — prise et liberation sur deux connexions du pool.
 *
 * Ici, avec une base simulee, on verrouille :
 *   - prise et liberation sur la MEME connexion, jamais par `db.execute`;
 *   - verrou deja pris : rien n'est execute, reponse `en_cours`;
 *   - une proposition `executee` renvoie son resultat memoise SANS re-executer;
 *   - une proposition `rejetee` est refusee SANS executer;
 *   - une proposition `en_attente` execute l'outil exactement une fois.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

let currentRow: Record<string, unknown> | null = null;
const executeToolSpy = vi.fn(async () => ({ ok: true, result: { sent: true } }));

// Verrou simule sur des connexions DISTINCTES du pool : chaque `connect()`
// rend une connexion qui journalise ses requetes. On peut ainsi verifier que
// la prise et la liberation passent par la MEME connexion — l'ancien code les
// envoyait par `db.execute` sur deux connexions au hasard.
let verrouLibre = true;
let connexions: Array<{ requetes: string[] }> = [];

// Base simulee: select renvoie la ligne courante, update la mute en memoire.
// `db.execute` refuse : un verrou de session n'a rien a y faire.
vi.mock("@workspace/db", () => ({
  pool: {
    connect: async () => {
      const c = { requetes: [] as string[] };
      connexions.push(c);
      return {
        query: async (q: string) => {
          c.requetes.push(q);
          return /pg_try_advisory_lock/.test(q) ? { rows: [{ acquired: verrouLibre }] } : { rows: [] };
        },
        release: () => {},
      };
    },
  },
  db: {
    execute: async () => { throw new Error("[test] verrou de session par db.execute (pool)"); },
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
    verrouLibre = true;
    connexions = [];
  });

  it("prend et relache le verrou sur la MEME connexion", async () => {
    currentRow = { id: 20, organisationId: 1, status: "en_attente", toolName: "send_email", args: {}, result: null };
    await executeProposal(20, CTX);
    const prise = connexions.find((c) => c.requetes.some((q) => /pg_try_advisory_lock/.test(q)));
    expect(prise, "aucune connexion n'a pris le verrou").toBeDefined();
    expect(prise!.requetes.some((q) => /pg_advisory_unlock/.test(q))).toBe(true);
  });

  it("verrou deja pris par une autre approbation : n'execute pas, repond en_cours", async () => {
    currentRow = { id: 21, organisationId: 1, status: "en_attente", toolName: "send_email", args: {}, result: null };
    verrouLibre = false;
    const r = await executeProposal(21, CTX);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("en_cours");
    expect(executeToolSpy).not.toHaveBeenCalled();
    expect(currentRow.status).toBe("en_attente");
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

  it("refuse une proposition expiree sans executer", async () => {
    // expireStaleProposals passe a `expiree` ce qui dort depuis 14 jours,
    // parce que l'action n'est plus pertinente. L'approuver ensuite relancait
    // une facture deja reglee ou rappelait un rendez-vous passe.
    currentRow = { id: 13, organisationId: 1, status: "expiree", toolName: "send_email", args: {}, result: null };
    const r = await executeProposal(13, CTX);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("expiree");
    expect(r.error).toMatch(/expir/i);
    expect(executeToolSpy).not.toHaveBeenCalled();
  });

  it("une proposition echouee reste rejouable (reprise apres panne)", async () => {
    currentRow = { id: 14, organisationId: 1, status: "echouee", toolName: "send_email", args: {}, result: null };
    const r = await executeProposal(14, CTX);
    expect(r.status).toBe("executee");
    expect(executeToolSpy).toHaveBeenCalledTimes(1);
  });

  it("renvoie introuvable si la proposition n'existe pas dans l'organisation", async () => {
    currentRow = null;
    const r = await executeProposal(999, CTX);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/introuvable/i);
    expect(executeToolSpy).not.toHaveBeenCalled();
  });
});
