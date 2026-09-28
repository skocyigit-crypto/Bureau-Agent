/**
 * Une tache periodique ne fait pas deux fois le meme travail parce que la
 * plateforme tourne sur plusieurs instances.
 *
 * Mesure du 28/09 (audit des taches periodiques, axe 3 « une operation
 * repetee ne produit pas deux fois le meme e-mail ») : sept taches pouvaient
 * doubler leur effet —
 *   - moteur d'automatisation : deux « Rappel imminent » en push et deux
 *     webhooks chez le client quand deux instances passaient ensemble ;
 *   - relance de webhook : reclamation sur le seul statut, qui revient a la
 *     meme valeur — une lecture ancienne reenvoyait l'evenement ;
 *   - regle « appel manque » : fenetre de deux intervalles, le meme appel
 *     declenchait deux SMS ;
 *   - audit de l'application et insights IA : aucun marqueur durable quand
 *     le passage ne produisait rien — appel au modele repaye a chaque heure
 *     et a chaque demarrage ;
 *   - super-agent : cycle relance sur une organisation deja traitee.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  db, organisationsTable, callsTable, webhookEndpointsTable, webhookDeliveriesTable, cronExecutionsTable,
  superAgentStateTable,
} from "@workspace/db";
import { abandonnerExecution, reclamerExecution, tranche } from "../lib/execution-unique";
import { reclamerLivraison } from "../services/webhook-service";
import { getTriggerItems } from "../services/automation-engine";
import { tryStartSuperAgentCycle } from "../services/super-agent-state";

const SRC = join(import.meta.dirname, "..");
const lire = (f: string) => readFileSync(join(SRC, f), "utf8");
const stamp = Date.now();
const job = `test-${stamp}`;
const MIN = 60_000;
let org = 0;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Periodiques ${stamp}`, slug: `periodiques-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  org = o!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(cronExecutionsTable).where(eq(cronExecutionsTable.job, job));
    await db.delete(webhookDeliveriesTable).where(eq(webhookDeliveriesTable.organisationId, org));
    await db.delete(webhookEndpointsTable).where(eq(webhookEndpointsTable.organisationId, org));
    await db.delete(callsTable).where(eq(callsTable.organisationId, org));
  } catch { /* base de CI jetable */ }
});

describe("tranches de periode", () => {
  it("deux instants de la meme tranche donnent la meme periode, la tranche suivante une autre", () => {
    const t0 = new Date(Math.floor(Date.now() / (30 * MIN)) * 30 * MIN);
    expect(tranche(30 * MIN, t0)).toBe(tranche(30 * MIN, new Date(t0.getTime() + 29 * MIN)));
    expect(tranche(30 * MIN, t0)).not.toBe(tranche(30 * MIN, new Date(t0.getTime() + 30 * MIN)));
  });

  it("une duree absurde (0, negative) ne produit pas une periode par milliseconde", () => {
    const t = new Date();
    expect(tranche(0, t)).toBe(tranche(MIN, t));
    expect(tranche(-5, t)).toBe(tranche(MIN, t));
  });
});

describe("reclamation d'une periode", () => {
  it("une seule reclamation reussit, meme simultanee", async () => {
    const r = await Promise.all([1, 2, 3, 4].map(() => reclamerExecution(job, org, "p1")));
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await reclamerExecution(job, org, "p1")).toBe(false);
  });

  it("une autre periode ou une autre entite se reclame independamment", async () => {
    expect(await reclamerExecution(job, org, "p2")).toBe(true);
    expect(await reclamerExecution(job, org + 1_000_000, "p1")).toBe(true);
  });

  it("un travail echoue rend sa periode : le passage suivant le refait", async () => {
    expect(await reclamerExecution(job, org, "p3")).toBe(true);
    await abandonnerExecution(job, org, "p3");
    expect(await reclamerExecution(job, org, "p3")).toBe(true);
  });
});

describe("relance de webhook : on reclame la ligne telle qu'elle a ete lue", () => {
  async function livraison(status: string) {
    const [e] = await db.insert(webhookEndpointsTable).values({
      organisationId: org, url: "https://exemple.test/hook", secret: "s",
    } as any).returning({ id: webhookEndpointsTable.id });
    const [d] = await db.insert(webhookDeliveriesTable).values({
      organisationId: org, endpointId: e!.id, eventType: "test.event", eventId: `ev-${stamp}-${Math.random()}`,
      payload: {}, status,
    } as any).returning();
    return d!;
  }

  it("la premiere reclamation passe, une seconde avec la meme lecture echoue", async () => {
    const lue = await livraison("retrying");
    expect(await reclamerLivraison(lue)).toBe(true);
    expect(await reclamerLivraison(lue)).toBe(false);
  });

  it("revenue a « retrying » apres un echec, elle n'est plus reclamable avec une lecture ANCIENNE", async () => {
    const lue = await livraison("retrying");
    // Une autre instance l'a reclamee, envoyee, puis un echec l'a reposee.
    await db.update(webhookDeliveriesTable).set({ status: "retrying", updatedAt: new Date(Date.now() + 5_000) })
      .where(eq(webhookDeliveriesTable.id, lue.id));
    expect(await reclamerLivraison(lue)).toBe(false);
  });

  it("une livraison inseree par la base (horodatage a la microseconde) reste reclamable", async () => {
    const lue = await livraison("pending");
    expect(await reclamerLivraison(lue)).toBe(true);
  });
});

describe("regle « appel manque » : chaque appel une seule fois", () => {
  async function appelManque(il_y_a_ms: number) {
    const [c] = await db.insert(callsTable).values({
      organisationId: org, phoneNumber: `+3361${String(stamp).slice(-7)}`, direction: "entrant", status: "manque",
      createdAt: new Date(Date.now() - il_y_a_ms),
    } as any).returning({ id: callsTable.id });
    return c!.id;
  }

  it("fenetre de reclamation : ni avant le passage precedent, ni apres la reclamation", async () => {
    const avant = await appelManque(20 * MIN);
    const dedans = await appelManque(7 * MIN);
    const apres = await appelManque(-1 * MIN); // horodate apres l'instant de reclamation
    const items = await getTriggerItems(
      { organisationId: org, trigger: "missed_call", schedule: "5m" },
      { depuis: new Date(Date.now() - 10 * MIN), jusqua: new Date() },
    );
    const ids = items.map((i: any) => i.id);
    expect(ids).toContain(dedans);
    expect(ids).not.toContain(avant);
    expect(ids).not.toContain(apres);
  });

  it("deux passages consecutifs ne voient pas le meme appel", async () => {
    const appel = await appelManque(3 * MIN);
    const t1 = new Date();
    const premier = await getTriggerItems({ organisationId: org, trigger: "missed_call", schedule: "5m" }, { depuis: new Date(t1.getTime() - 5 * MIN), jusqua: t1 });
    const second = await getTriggerItems({ organisationId: org, trigger: "missed_call", schedule: "5m" }, { depuis: t1, jusqua: new Date(t1.getTime() + 5 * MIN) });
    expect(premier.map((i: any) => i.id)).toContain(appel);
    expect(second.map((i: any) => i.id)).not.toContain(appel);
  });
});

describe("super-agent : le cycle n'est reclame que s'il est encore du", () => {
  it("dernier passage recent : refuse ; ancien : accepte", async () => {
    const o = org;
    await db.insert(superAgentStateTable).values({ organisationId: o, autoRunEnabled: true, lastRun: new Date(), running: false } as any)
      .onConflictDoUpdate({ target: superAgentStateTable.organisationId, set: { lastRun: new Date(), running: false } });
    const dueSince = new Date(Date.now() - 24 * 60 * MIN);
    expect(await tryStartSuperAgentCycle(o, dueSince)).toBe(false);
    await db.update(superAgentStateTable).set({ lastRun: new Date(Date.now() - 48 * 60 * MIN), running: false })
      .where(eq(superAgentStateTable.organisationId, o));
    expect(await tryStartSuperAgentCycle(o, dueSince)).toBe(true);
  });
});

describe("les taches sont branchees sur ces gardes", () => {
  it("le moteur d'automatisation passe sous verrou global", () => {
    expect(lire("services/automation-engine.ts")).toMatch(/tryWithLock\(CRON_LOCK_NAMESPACE\.automationEngine, 0, runAllAutomationsSousVerrou\)/);
  });

  it("l'audit et les insights reclament leur periode avant d'appeler le modele", () => {
    const audit = lire("services/app-audit-cron.ts");
    expect(audit.indexOf("reclamerExecution(\"app-audit\"")).toBeGreaterThan(-1);
    expect(audit.indexOf("reclamerExecution(\"app-audit\"")).toBeLessThan(audit.indexOf("await runAuditForOrg("));
    const ins = lire("services/ai-insights.ts");
    expect(ins.indexOf("reclamerExecution(\"ai-insights\"")).toBeGreaterThan(-1);
    expect(ins.indexOf("reclamerExecution(\"ai-insights\"")).toBeLessThan(ins.indexOf("total += await generateInsightsForOrg"));
  });

  it("une livraison de webhook nait « en cours d'envoi », jamais « pending »", () => {
    const w = lire("services/webhook-service.ts");
    const insertion = w.slice(w.indexOf(".insert(webhookDeliveriesTable)"), w.indexOf("void attemptDelivery(row, endpoint)"));
    expect(insertion).toMatch(/status: STATUT_ENVOI_EN_COURS/);
    expect(insertion).not.toMatch(/status: "pending"/);
  });

  it("le cron du super-agent passe l'echeance a la reclamation du cycle", () => {
    expect(lire("services/super-agent-cron.ts")).toMatch(/tryStartSuperAgentCycle\(orgId, dueSince\)/);
  });
});
