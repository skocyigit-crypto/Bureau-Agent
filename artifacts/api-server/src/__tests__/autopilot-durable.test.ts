/**
 * L'Oto-Pilot ne tournait pas la ou il sert.
 *
 * Son etat vivait dans une `Map` du processus, alimentee par un `setInterval`
 * cree par la route `/ai/autopilot/start`. Trois consequences, mesurees le
 * 19/09 :
 *
 *  1. Cloud Run recycle les instances sans preavis et tourne a min-instances=0.
 *     Le minuteur partait avec l'instance : plus aucun cycle, alors que l'ecran
 *     continuait d'annoncer « actif ». La surveillance « continue » s'arretait
 *     precisement la nuit, quand personne n'utilise l'application.
 *  2. Le service tourne a maxScale=3. Deux instances ayant chacune recu un
 *     /start portaient chacune leur minuteur : deux cycles concurrents pour la
 *     meme organisation, sans verrou — alors que le declenchement MANUEL, lui,
 *     en prenait un.
 *  3. `/ai/autopilot/status` lisait cette meme memoire : la reponse dependait
 *     de l'instance qui repondait.
 *
 * L'etat vit desormais en base, la selection est atomique, et la boucle est
 * inscrite au declencheur externe (cf. `cron-registration.test.ts`, elargi aux
 * routes pour cette raison).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db, organisationsTable } from "@workspace/db";
import { reclamerAutopilot } from "../routes/ai-agents";

const stamp = Date.now();
const CADENCE_MS = 30 * 60 * 1000;

let orgJamais: number;   // activee, jamais passee
let orgAncienne: number; // activee, dernier cycle il y a 1 h
let orgRecente: number;  // activee, dernier cycle il y a 5 min
let orgEteinte: number;  // Oto-Pilot desactive
let orgInactive: number; // organisation desactivee

async function semer(tag: string, active: boolean, dernier: Date | null, actif = true): Promise<number> {
  const [row] = await db
    .insert(organisationsTable)
    .values({
      name: `Autopilot ${tag} ${stamp}`,
      slug: `autopilot-${tag}-${stamp}`,
      maxUsers: 10,
      actif,
      autopilotEnabled: active,
      autopilotLastRunAt: dernier,
    })
    .returning({ id: organisationsTable.id });
  return row.id;
}

beforeAll(async () => {
  const now = Date.now();
  orgJamais = await semer("jamais", true, null);
  orgAncienne = await semer("ancienne", true, new Date(now - 60 * 60 * 1000));
  orgRecente = await semer("recente", true, new Date(now - 5 * 60 * 1000));
  orgEteinte = await semer("eteinte", false, new Date(now - 60 * 60 * 1000));
  orgInactive = await semer("inactive", true, new Date(now - 60 * 60 * 1000), false);
});

afterAll(async () => {
  try {
    await db.delete(organisationsTable).where(
      inArray(organisationsTable.id, [orgJamais, orgAncienne, orgRecente, orgEteinte, orgInactive]),
    );
  } catch {
    // best-effort: les slugs portent l'horodatage du run.
  }
});

describe("qui est du, et qui ne l'est pas", () => {
  it("une organisation qui n'a jamais tourne est reclamee", async () => {
    const pris = await reclamerAutopilot();
    expect(pris, "sans cela, activer l'Oto-Pilot ne declencherait jamais rien").toContain(orgJamais);
  });

  it("une organisation hors cadence est reclamee", async () => {
    // Remise en etat: le controle precedent a avance le marqueur.
    await db.update(organisationsTable)
      .set({ autopilotLastRunAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(organisationsTable.id, orgAncienne));
    expect(await reclamerAutopilot()).toContain(orgAncienne);
  });

  it("une organisation dans la cadence ne l'est pas", async () => {
    await db.update(organisationsTable)
      .set({ autopilotLastRunAt: new Date(Date.now() - 5 * 60 * 1000) })
      .where(eq(organisationsTable.id, orgRecente));
    expect(await reclamerAutopilot(), "un cycle toutes les 5 min couterait 6 fois le prix annonce")
      .not.toContain(orgRecente);
  });

  it("l'Oto-Pilot eteint n'est jamais reclame", async () => {
    // Le marqueur est remis en arriere JUSTE avant: sans cela, une
    // reclamation d'un controle precedent l'aurait deja avance, et
    // l'organisation serait hors cadence pour une raison qui n'a rien a voir
    // avec ce qu'on mesure ici — le controle passerait meme sans le filtre.
    await db.update(organisationsTable)
      .set({ autopilotLastRunAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(organisationsTable.id, orgEteinte));
    expect(await reclamerAutopilot()).not.toContain(orgEteinte);
  });

  it("une organisation desactivee non plus", async () => {
    await db.update(organisationsTable)
      .set({ autopilotLastRunAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(organisationsTable.id, orgInactive));
    expect(await reclamerAutopilot()).not.toContain(orgInactive);
  });
});

describe("la reclamation est atomique — c'est ce qui remplace le minuteur par instance", () => {
  it("deux verifications simultanees ne reclament pas la meme organisation", async () => {
    await db.update(organisationsTable)
      .set({ autopilotLastRunAt: null })
      .where(eq(organisationsTable.id, orgJamais));

    const [a, b] = await Promise.all([reclamerAutopilot(), reclamerAutopilot()]);
    const fois = [a, b].filter((r) => r.includes(orgJamais)).length;
    expect(fois, "deux instances lanceraient deux cycles pour la meme organisation").toBe(1);
  });

  it("une seconde passe immediate ne reprend rien", async () => {
    const pris = await reclamerAutopilot();
    expect(pris).not.toContain(orgJamais);
    expect(pris).not.toContain(orgAncienne);
  });

  it("le marqueur est avance AU MOMENT de reclamer, pas a la fin du cycle", async () => {
    await db.update(organisationsTable)
      .set({ autopilotLastRunAt: null })
      .where(eq(organisationsTable.id, orgJamais));
    const avant = Date.now();
    await reclamerAutopilot();
    const [org] = await db
      .select({ dernier: organisationsTable.autopilotLastRunAt })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, orgJamais));
    expect(org?.dernier, "avancer le marqueur a la fin laisserait la fenetre ouverte pendant tout le cycle")
      .not.toBeNull();
    expect(org!.dernier!.getTime()).toBeGreaterThanOrEqual(avant - 1000);
  });

  it("la cadence de reference est bien celle annoncee a l'utilisateur", async () => {
    // « cycles toutes les 30 minutes » est ecrit dans la reponse de /start.
    await db.update(organisationsTable)
      .set({ autopilotLastRunAt: new Date(Date.now() - CADENCE_MS - 60_000) })
      .where(eq(organisationsTable.id, orgRecente));
    expect(await reclamerAutopilot()).toContain(orgRecente);
  });
});

describe("l'etat vit en base, pas dans la memoire d'une instance", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "routes", "ai-agents.ts"), "utf8");
  const bloc = source.slice(source.indexOf('router.post("/ai/autopilot/start"'), source.indexOf('router.post("/ai/agents/auto-fix"'));

  it("activer ecrit en base", () => {
    expect(bloc).toMatch(/autopilotEnabled: true/);
  });

  it("desactiver aussi", () => {
    expect(bloc).toMatch(/autopilotEnabled: false/);
  });

  it("plus aucune route ne cree de minuteur par organisation", () => {
    expect(
      bloc,
      "un setInterval cree par une requete meurt avec son instance, et se duplique sur les autres",
    ).not.toMatch(/setInterval\(/);
  });

  it("le statut est lu en base, pas dans la Map", () => {
    const statut = source.slice(source.indexOf('router.get("/ai/autopilot/status"'), source.indexOf('router.get("/ai/autopilot/logs"'));
    expect(statut).toMatch(/organisationsTable\.autopilotEnabled/);
  });

  it("le cycle planifie reste protege par le verrou partage", () => {
    const planif = source.slice(source.indexOf("export function startAutopilotScheduler"));
    expect(planif.slice(0, 2000)).toMatch(/tryWithLock\(CRON_LOCK_NAMESPACE\.autopilot/);
  });
});
