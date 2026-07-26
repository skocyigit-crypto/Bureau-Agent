/**
 * Invariant: une proposition mise en file ANNONCE son arrivee.
 *
 * La regle d'or du produit ("aucun effet reel sans approbation humaine") n'a de
 * valeur que si un humain apprend qu'il y a a decider. Avant cet evenement, la
 * supervision reposait entierement sur le fait que quelqu'un pense a ouvrir
 * l'ecran: une proposition jamais vue passait a `expiree` au bout de 14 jours,
 * et le travail de l'agent partait a la poubelle en silence.
 *
 * Ces tests figent trois choses:
 *   - toute mise en file reussie diffuse un evenement `proposition` (donc push
 *     mobile + SSE + webhooks sortants, qui partagent ce meme flux);
 *   - un DOUBLON ne re-notifie pas (les crons repassent sur les memes signaux
 *     a chaque cycle — sinon la meme relance sonnerait toutes les heures);
 *   - une panne de diffusion ne fait pas echouer la mise en file (la
 *     proposition est deja en base; la perdre serait pire que ne pas notifier).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const broadcast = vi.fn();

// Table factice: le code n'en lit que les colonnes passees a drizzle, qui est
// lui-meme neutralise ci-dessous.
vi.mock("@workspace/db/schema", () => ({ agentProposalsTable: {} }));

// `db` simule le strict minimum utilise par enqueueProposal: la recherche de
// doublon (select) et l'insertion (insert...returning).
const state = { duplicate: [] as Array<{ id: number }>, insertedId: 7 };
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => state.duplicate }) }) }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: state.insertedId }] }) }),
  },
}));

vi.mock("../services/broadcaster", () => ({ broadcaster: { broadcast } }));
vi.mock("../services/saas-tools", () => ({ getSaasTool: () => undefined }));
vi.mock("../services/assistant-tools", () => ({
  getTool: (name: string) => (name === "create_task" ? { fields: [] } : undefined),
  validateArgs: () => ({ ok: true, data: {} }),
}));

const { enqueueProposal } = await import("../services/proposal-queue");

function input(partial: Record<string, unknown> = {}) {
  return {
    orgId: 42,
    toolName: "create_task",
    title: "Relancer M. Durand",
    summary: "Creer une tache de relance",
    ...partial,
  } as Parameters<typeof enqueueProposal>[0];
}

beforeEach(() => {
  broadcast.mockReset();
  state.duplicate = [];
});

describe("enqueueProposal — reveil de l'humain", () => {
  it("diffuse un evenement 'proposition' des qu'une action attend une decision", async () => {
    const res = await enqueueProposal(input({ priority: "haute", category: "relance" }));

    expect(res.ok).toBe(true);
    expect(broadcast).toHaveBeenCalledTimes(1);
    const [orgId, event] = broadcast.mock.calls[0];
    expect(orgId).toBe(42);
    expect(event.type).toBe("proposition");
    expect(event.action).toBe("created");
    expect(event.resourceId).toBe(7);
    // La priorite voyage dans l'evenement: c'est elle qui decide si le
    // telephone sonne (cf. push-notifications.ts, anti-bruit).
    expect(event.meta).toMatchObject({ title: "Relancer M. Durand", priority: "haute", category: "relance" });
  });

  it("ne re-notifie pas un doublon deja en attente", async () => {
    state.duplicate = [{ id: 3 }];

    const res = await enqueueProposal(input({ sourceRef: "relance:42:2026-07-25" }));

    expect(res.duplicate).toBe(true);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("reste en succes si la diffusion echoue (la proposition est deja enregistree)", async () => {
    broadcast.mockImplementation(() => { throw new Error("bus indisponible"); });

    const res = await enqueueProposal(input());

    expect(res.ok).toBe(true);
    expect(res.id).toBe(7);
  });
});
