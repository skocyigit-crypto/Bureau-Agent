process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, organisationsTable, superAgentStateTable } from "@workspace/db";
import {
  finishSuperAgentCycle,
  getSuperAgentSnapshot,
  listOrgsDueForAutoRun,
  setSuperAgentAutoRun,
  tryStartSuperAgentCycle,
} from "../services/super-agent-state";

/**
 * Le passage quotidien du Super Agent est OPT-IN, et ce test existe surtout
 * pour cela: l'agent cree des taches et remonte des priorites sans passer par
 * la file d'approbation. Une organisation qui n'a rien demande ne doit jamais
 * apparaitre dans la selection du cron — c'est la difference entre une
 * automatisation et des taches surgies de nulle part chez un client.
 */

const stamp = Date.now();
let orgId = 0;

beforeAll(async () => {
  const [org] = await db.insert(organisationsTable).values({
    name: `Org auto-run ${stamp}`,
    slug: `auto-run-${stamp}`,
    maxUsers: 5,
    actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = org!.id;
});

afterAll(async () => {
  if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
});

const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

describe("selection du passage quotidien", () => {
  it("ignore une organisation qui ne l'a pas demande", async () => {
    // L'etat existe (un cycle manuel a deja eu lieu), mais l'interrupteur est
    // eteint: c'est l'etat par defaut de tous les clients existants.
    await tryStartSuperAgentCycle(orgId);
    await finishSuperAgentCycle(orgId, { completed: true });
    await db.update(superAgentStateTable)
      .set({ lastRun: yesterday() })
      .where(eq(superAgentStateTable.organisationId, orgId));

    expect(await listOrgsDueForAutoRun(new Date())).not.toContain(orgId);
  });

  it("la retient une fois qu'elle l'a demande et que la journee est passee", async () => {
    expect(await setSuperAgentAutoRun(orgId, true)).toBe(true);
    await db.update(superAgentStateTable)
      .set({ lastRun: yesterday() })
      .where(eq(superAgentStateTable.organisationId, orgId));

    expect(await listOrgsDueForAutoRun(new Date())).toContain(orgId);
  });

  it("ne la reprend pas deux fois le meme jour", async () => {
    await setSuperAgentAutoRun(orgId, true);
    // Le garde vient de `lastRun` en base, pas d'une variable de processus:
    // un redemarrage ne peut donc pas relancer un cycle deja fait.
    await db.update(superAgentStateTable)
      .set({ lastRun: new Date() })
      .where(eq(superAgentStateTable.organisationId, orgId));

    const due = await listOrgsDueForAutoRun(new Date(Date.now() - 24 * 60 * 60 * 1000));
    expect(due).not.toContain(orgId);
  });

  it("retient une organisation qui n'a jamais tourne", async () => {
    await setSuperAgentAutoRun(orgId, true);
    await db.update(superAgentStateTable)
      .set({ lastRun: null })
      .where(eq(superAgentStateTable.organisationId, orgId));

    expect(await listOrgsDueForAutoRun(new Date())).toContain(orgId);
  });

  it("la relache des qu'elle eteint l'interrupteur", async () => {
    await setSuperAgentAutoRun(orgId, false);
    expect(await listOrgsDueForAutoRun(new Date())).not.toContain(orgId);
    expect((await getSuperAgentSnapshot(orgId)).autoRunEnabled).toBe(false);
  });
});

describe("reglage", () => {
  it("est faux par defaut pour une organisation qui n'a jamais rien regle", async () => {
    const [fresh] = await db.insert(organisationsTable).values({
      name: `Org auto-run neuve ${stamp}`,
      slug: `auto-run-neuve-${stamp}`,
      maxUsers: 5,
      actif: true,
    }).returning({ id: organisationsTable.id });

    try {
      expect((await getSuperAgentSnapshot(fresh!.id)).autoRunEnabled).toBe(false);
      expect(await listOrgsDueForAutoRun(new Date())).not.toContain(fresh!.id);
    } finally {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, fresh!.id));
    }
  });

  it("se lit tel qu'il a ete ecrit, depuis n'importe quelle instance", async () => {
    await setSuperAgentAutoRun(orgId, true);
    expect((await getSuperAgentSnapshot(orgId)).autoRunEnabled).toBe(true);
    await setSuperAgentAutoRun(orgId, false);
    expect((await getSuperAgentSnapshot(orgId)).autoRunEnabled).toBe(false);
  });
});
