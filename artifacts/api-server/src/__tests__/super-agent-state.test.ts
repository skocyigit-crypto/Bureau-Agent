process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, organisationsTable, superAgentStateTable } from "@workspace/db";
import {
  appendSuperAgentLog,
  bumpSuperAgentStats,
  finishSuperAgentCycle,
  getSuperAgentSnapshot,
  tryStartSuperAgentCycle,
} from "../services/super-agent-state";

/**
 * L'etat du Super Agent vivait dans une `Map` de module. Avec trois instances
 * derriere le meme domaine, cela produisait deux defauts qu'aucun test ne
 * pouvait attraper tant que l'etat restait en memoire du processus de test:
 * un cycle lance sur une instance etait invisible depuis les autres, et le
 * garde-fou `running` ne gardait qu'un processus sur trois.
 *
 * Ces tests parlent donc a la base, comme le font les instances entre elles.
 */

const stamp = Date.now();
let orgId = 0;

beforeAll(async () => {
  const [org] = await db.insert(organisationsTable).values({
    name: `Org super-agent ${stamp}`,
    slug: `super-agent-${stamp}`,
    maxUsers: 5,
    actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = org!.id;
});

afterAll(async () => {
  // La cascade emporte l'etat et les journaux avec l'organisation.
  if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
});

describe("drapeau d'execution partage", () => {
  it("n'est pris qu'une fois, meme par deux appels simultanes", async () => {
    const results = await Promise.all([
      tryStartSuperAgentCycle(orgId),
      tryStartSuperAgentCycle(orgId),
      tryStartSuperAgentCycle(orgId),
    ]);

    // Un seul « gagnant »: c'est precisement ce que la Map par processus ne
    // garantissait pas — trois instances pouvaient lancer le meme cycle.
    expect(results.filter(Boolean)).toHaveLength(1);

    await finishSuperAgentCycle(orgId, { completed: true });
    expect(await tryStartSuperAgentCycle(orgId)).toBe(true);
    await finishSuperAgentCycle(orgId, { completed: true });
  });

  it("compte un cycle a chaque prise, pas a chaque tentative", async () => {
    const before = (await getSuperAgentSnapshot(orgId)).stats.cyclesRun;

    expect(await tryStartSuperAgentCycle(orgId)).toBe(true);
    expect(await tryStartSuperAgentCycle(orgId)).toBe(false);
    await finishSuperAgentCycle(orgId, { completed: true });

    expect((await getSuperAgentSnapshot(orgId)).stats.cyclesRun).toBe(before + 1);
  });

  it("se reprend apres une instance tuee en plein cycle", async () => {
    expect(await tryStartSuperAgentCycle(orgId)).toBe(true);
    // Ce que laisse derriere elle une instance qui meurt: le drapeau leve,
    // sans personne pour le baisser. Sans reprise sur l'age, l'organisation ne
    // pourrait plus jamais lancer de cycle.
    await db.update(superAgentStateTable)
      .set({ runningSince: new Date(Date.now() - 45 * 60 * 1000) })
      .where(eq(superAgentStateTable.organisationId, orgId));

    expect(await tryStartSuperAgentCycle(orgId)).toBe(true);

    // Et un cycle abandonne ne s'affiche pas comme « en cours » entre-temps.
    await db.update(superAgentStateTable)
      .set({ runningSince: new Date(Date.now() - 45 * 60 * 1000) })
      .where(eq(superAgentStateTable.organisationId, orgId));
    expect((await getSuperAgentSnapshot(orgId)).running).toBe(false);

    await finishSuperAgentCycle(orgId, { completed: true });
  });

  it("ne date le dernier passage que si le cycle est alle au bout", async () => {
    await finishSuperAgentCycle(orgId, { completed: true });
    const after = (await getSuperAgentSnapshot(orgId)).lastRun;
    expect(after).toBeTruthy();

    await tryStartSuperAgentCycle(orgId);
    await finishSuperAgentCycle(orgId, { completed: false });
    // Un cycle interrompu ne doit pas se faire passer pour un passage reussi.
    expect((await getSuperAgentSnapshot(orgId)).lastRun).toBe(after);
  });
});

describe("compteurs", () => {
  it("s'additionnent au lieu de s'ecraser quand plusieurs cycles ecrivent", async () => {
    const before = (await getSuperAgentSnapshot(orgId)).stats.tasksCreated;

    // Cinq ecritures concurrentes: en relisant-puis-reecrivant un objet JSON,
    // il en resterait une seule.
    await Promise.all(Array.from({ length: 5 }, () => bumpSuperAgentStats(orgId, { tasksCreated: 2 })));

    expect((await getSuperAgentSnapshot(orgId)).stats.tasksCreated).toBe(before + 10);
  });

  it("ignore les deltas nuls plutot que d'ecrire pour rien", async () => {
    const before = await getSuperAgentSnapshot(orgId);
    await bumpSuperAgentStats(orgId, { tasksCreated: 0, emailsProcessed: 0 });
    expect((await getSuperAgentSnapshot(orgId)).stats).toEqual(before.stats);
  });
});

describe("journal", () => {
  it("est lisible depuis une autre instance, du plus ancien au plus recent", async () => {
    await appendSuperAgentLog(orgId, "info", "system", `debut ${stamp}`);
    await appendSuperAgentLog(orgId, "success", "tache", `fin ${stamp}`, "detail");

    const { recentLogs } = await getSuperAgentSnapshot(orgId);
    const mine = recentLogs.filter((l) => l.message.endsWith(String(stamp)));

    expect(mine.map((l) => l.message)).toEqual([`debut ${stamp}`, `fin ${stamp}`]);
    expect(mine[1]?.detail).toBe("detail");
  });

  it("ne rend qu'une page, meme si l'organisation en a ecrit davantage", async () => {
    for (let i = 0; i < 60; i++) {
      await appendSuperAgentLog(orgId, "info", "system", `ligne ${i}`);
    }
    const { recentLogs } = await getSuperAgentSnapshot(orgId);

    expect(recentLogs).toHaveLength(50);
    // La page est la fin du journal, pas son debut.
    expect(recentLogs.at(-1)?.message).toBe("ligne 59");
  });
});

describe("isolation entre locataires", () => {
  it("ne laisse pas l'etat d'une organisation apparaitre dans une autre", async () => {
    const [other] = await db.insert(organisationsTable).values({
      name: `Org super-agent voisine ${stamp}`,
      slug: `super-agent-voisine-${stamp}`,
      maxUsers: 5,
      actif: true,
    }).returning({ id: organisationsTable.id });

    try {
      await bumpSuperAgentStats(orgId, { emailsProcessed: 7 });
      const neighbour = await getSuperAgentSnapshot(other!.id);

      expect(neighbour.stats.emailsProcessed).toBe(0);
      expect(neighbour.recentLogs).toEqual([]);
    } finally {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, other!.id));
    }
  });
});
