/**
 * Trois taches planifiees pouvaient faire deux fois la meme chose.
 *
 * Le service tourne sur Cloud Run avec `maxScale=3` : trois instances chaudes
 * tiquent ensemble, et le declencheur externe les reveille toutes. Un garde
 * `let isRunning = false` au niveau du module est donc un garde PAR PROCESSUS
 * — il ne protege rien contre la concurrence reelle.
 *
 *  - `webhook-service` : `SELECT ... WHERE status='retrying'` puis POST, sans
 *    revendication. Le client recevait deux ou trois fois le meme evenement
 *    — le meme paiement, la meme facture — sur SON systeme. Le commentaire du
 *    retry manuel affirmait pourtant que le worker « elimine par construction
 *    tout double envoi ».
 *  - `google-auto-pointage` : cherche un pointage du jour, n'en trouve pas,
 *    insere. Deux lignes pour le meme salarie le meme jour, donc des heures
 *    comptees deux fois dans le suivi du temps de travail — celui qui sert a
 *    la paie.
 *  - `quota-warning-cron` : fenetre anti-repetition de 72 heures rangee dans
 *    une `Map` de module. Avec min-instances=0, l'instance est recyclee des
 *    que le trafic cesse : la Map repartait vide et le client recevait
 *    l'alerte a CHAQUE redemarrage.
 *
 * Les controles ci-dessous lancent de VRAIS appels concurrents contre la VRAIE
 * base. Lire le code dirait que la revendication est ecrite, pas que Postgres
 * n'en laisse passer qu'une.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db, organisationsTable, webhookDeliveriesTable, webhookEndpointsTable } from "@workspace/db";
import { CRON_LOCK_NAMESPACE, tryWithLock } from "../lib/cron-lock";

const stamp = Date.now();
let orgId = 0;
let endpointId = 0;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Crons ${stamp}`, slug: `crons-${stamp}`, maxUsers: 10, actif: true,
    email: `crons-${stamp}@example.test`,
  } as any).returning({ id: organisationsTable.id });
  orgId = o!.id;
  // La table porte une cle etrangere COMPOSITE (endpoint_id, organisation_id):
  // une livraison ne peut pas designer l endpoint d un autre client.
  const [e] = await db.insert(webhookEndpointsTable).values({
    organisationId: orgId,
    url: "https://exemple.test/webhook",
    events: ["*"],
    secret: "enc:v1:factice",
    active: true,
  } as any).returning({ id: webhookEndpointsTable.id });
  endpointId = e!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(webhookDeliveriesTable).where(eq(webhookDeliveriesTable.organisationId, orgId));
    await db.delete(webhookEndpointsTable).where(eq(webhookEndpointsTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* journaux en ajout seul */ }
});

// ── Webhooks : la revendication atomique ─────────────────────────────────────

async function livraison(status: string) {
  const [d] = await db.insert(webhookDeliveriesTable).values({
    organisationId: orgId,
    endpointId,
    eventType: "facture.payee",
    payload: { test: true },
    status,
    attempts: 0,
  } as any).returning();
  return d!;
}

/** La revendication telle que `processRetryQueue` la fait. */
async function reclamer(id: number, statutAttendu: string) {
  const r = await db
    .update(webhookDeliveriesTable)
    .set({ status: "envoi_en_cours", updatedAt: new Date() })
    .where(and(
      eq(webhookDeliveriesTable.id, id),
      eq(webhookDeliveriesTable.status, statutAttendu),
    ))
    .returning({ id: webhookDeliveriesTable.id });
  return r.length > 0;
}

describe("une livraison de webhook ne part qu'une fois", () => {
  it("une seule revendication aboutit sur deux tentatives", async () => {
    const d = await livraison("retrying");
    const [a, b] = await Promise.all([reclamer(d.id, "retrying"), reclamer(d.id, "retrying")]);
    expect([a, b].filter(Boolean).length, "les deux instances ont envoye").toBe(1);
  });

  it("et sur trois, comme a maxScale=3", async () => {
    const d = await livraison("retrying");
    const r = await Promise.all([
      reclamer(d.id, "retrying"), reclamer(d.id, "retrying"), reclamer(d.id, "retrying"),
    ]);
    expect(r.filter(Boolean).length).toBe(1);
  });

  it("la ligne porte l'etat transitoire apres revendication", async () => {
    const d = await livraison("retrying");
    await reclamer(d.id, "retrying");
    const [apres] = await db.select().from(webhookDeliveriesTable).where(eq(webhookDeliveriesTable.id, d.id));
    expect(apres!.status).toBe("envoi_en_cours");
  });

  it("une livraison deja revendiquee n'est plus prise", async () => {
    const d = await livraison("retrying");
    await reclamer(d.id, "retrying");
    expect(await reclamer(d.id, "retrying")).toBe(false);
  });

  it("le filet « perime » recupere une revendication abandonnee", async () => {
    // Une instance tuee entre la revendication et la reponse laisserait sinon
    // la ligne bloquee pour toujours.
    const d = await livraison("retrying");
    await reclamer(d.id, "retrying");
    const vieux = new Date(Date.now() - 10 * 60 * 1000);
    await db.update(webhookDeliveriesTable).set({ updatedAt: vieux })
      .where(eq(webhookDeliveriesTable.id, d.id));

    const perimees = await db.select().from(webhookDeliveriesTable).where(and(
      eq(webhookDeliveriesTable.status, "envoi_en_cours"),
      lt(webhookDeliveriesTable.updatedAt, new Date(Date.now() - 2 * 60 * 1000)),
      eq(webhookDeliveriesTable.id, d.id),
    ));
    expect(perimees.length, "la livraison reste bloquee pour toujours").toBe(1);
  });

  it("le service pose bien cette revendication avant l'appel sortant", async () => {
    const source = readFileSync(join(import.meta.dirname, "..", "services", "webhook-service.ts"), "utf8");
    const i = source.indexOf("const reclamee = await db");
    const j = source.indexOf("await attemptDelivery(delivery, endpoint);", i);
    expect(i, "la revendication a disparu").toBeGreaterThan(0);
    expect(j, "l'envoi ne suit plus la revendication").toBeGreaterThan(i);
    expect(source.slice(i, j)).toMatch(/if \(reclamee\.length === 0\) continue;/);
  });
});

// ── Pointage Google : le verrou par utilisateur ──────────────────────────────

describe("un pointage automatique ne se cree qu'une fois", () => {
  it("deux tics concurrents n'entrent pas ensemble", async () => {
    const userId = 800_000 + Math.floor(Math.random() * 100_000);
    let dedans = 0;
    let maxSimultane = 0;
    const travail = async () => {
      dedans++;
      maxSimultane = Math.max(maxSimultane, dedans);
      await new Promise((r) => setTimeout(r, 120));
      dedans--;
    };
    await Promise.all([
      tryWithLock(CRON_LOCK_NAMESPACE.googleAutoPointage, userId, travail),
      tryWithLock(CRON_LOCK_NAMESPACE.googleAutoPointage, userId, travail),
    ]);
    expect(maxSimultane, "les deux tics ont insere en meme temps").toBe(1);
  });

  it("le perdant renonce au lieu d'attendre", async () => {
    const userId = 900_000 + Math.floor(Math.random() * 100_000);
    const lent = async () => { await new Promise((r) => setTimeout(r, 200)); };
    const [a, b] = await Promise.all([
      tryWithLock(CRON_LOCK_NAMESPACE.googleAutoPointage, userId, lent),
      tryWithLock(CRON_LOCK_NAMESPACE.googleAutoPointage, userId, lent),
    ]);
    expect([a, b].filter(Boolean).length, "les deux ont obtenu le verrou").toBe(1);
  });

  it("deux utilisateurs differents ne se genent pas", async () => {
    // Un verrou trop large serialiserait toute la synchronisation.
    const u1 = 910_000 + Math.floor(Math.random() * 10_000);
    const u2 = u1 + 1;
    const lent = async () => { await new Promise((r) => setTimeout(r, 150)); };
    const [a, b] = await Promise.all([
      tryWithLock(CRON_LOCK_NAMESPACE.googleAutoPointage, u1, lent),
      tryWithLock(CRON_LOCK_NAMESPACE.googleAutoPointage, u2, lent),
    ]);
    expect(a && b, "le verrou serialise des utilisateurs sans rapport").toBe(true);
  });

  it("le cron prend bien ce verrou", async () => {
    const source = readFileSync(join(import.meta.dirname, "..", "services", "google-auto-pointage.ts"), "utf8");
    expect(source).toMatch(/verrouUtilisateur\(token\.userId/);
    expect(source).toMatch(/CRON_LOCK_NAMESPACE\.googleAutoPointage/);
  });

  it("et son namespace est unique", async () => {
    // Deux crons qui partagent un namespace se bloquent l'un l'autre sans
    // raison — et le comptage ci-dessous le dirait.
    const source = readFileSync(join(import.meta.dirname, "..", "lib", "cron-lock.ts"), "utf8");
    const valeurs = [...source.matchAll(/^\s+\w+: (\d{4}),$/gm)].map((m) => m[1]);
    expect(valeurs.length).toBeGreaterThan(5);
    expect(new Set(valeurs).size, "deux crons partagent un namespace").toBe(valeurs.length);
  });
});

// ── Alerte de quota : la fenetre persistee ───────────────────────────────────

const SEUIL_72H = () => new Date(Date.now() - 72 * 3600 * 1000);

/** La reclamation telle que `checkOrganisation` la fait. */
async function reclamerAlerte(id: number) {
  const r = await db
    .update(organisationsTable)
    .set({ lastQuotaWarningAt: new Date() })
    .where(and(
      eq(organisationsTable.id, id),
      or(
        isNull(organisationsTable.lastQuotaWarningAt),
        lt(organisationsTable.lastQuotaWarningAt, SEUIL_72H()),
      ),
    ))
    .returning({ id: organisationsTable.id });
  return r.length > 0;
}

describe("l'alerte de quota ne part pas a chaque redemarrage", () => {
  beforeEach(async () => {
    await db.update(organisationsTable).set({ lastQuotaWarningAt: null })
      .where(eq(organisationsTable.id, orgId));
  });

  it("la fenetre survit au redemarrage: elle est en base", async () => {
    expect(await reclamerAlerte(orgId)).toBe(true);
    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
    expect(org!.lastQuotaWarningAt, "la fenetre n'est pas persistee").toBeTruthy();
  });

  it("une deuxieme alerte dans la fenetre est refusee", async () => {
    await reclamerAlerte(orgId);
    expect(await reclamerAlerte(orgId), "le client recoit l'alerte deux fois").toBe(false);
  });

  it("deux instances concurrentes n'en envoient qu'une", async () => {
    const [a, b] = await Promise.all([reclamerAlerte(orgId), reclamerAlerte(orgId)]);
    expect([a, b].filter(Boolean).length).toBe(1);
  });

  it("passee la fenetre, l'alerte repart", async () => {
    // Le garde-fou ne doit pas rendre l'alerte muette pour toujours.
    await db.update(organisationsTable)
      .set({ lastQuotaWarningAt: new Date(Date.now() - 80 * 3600 * 1000) })
      .where(eq(organisationsTable.id, orgId));
    expect(await reclamerAlerte(orgId)).toBe(true);
  });

  it("le cron ne garde plus sa fenetre en memoire", async () => {
    const source = readFileSync(join(import.meta.dirname, "..", "services", "quota-warning-cron.ts"), "utf8");
    expect(source, "la Map de module est revenue").not.toMatch(/new Map<number, number>\(\)/);
    expect(source).toMatch(/lastQuotaWarningAt/);
  });

  it("un envoi qui echoue rend la fenetre", async () => {
    // Sinon l'organisation resterait silencieuse 72 heures pour un courriel
    // qui n'est jamais parti.
    const source = readFileSync(join(import.meta.dirname, "..", "services", "quota-warning-cron.ts"), "utf8");
    const i = source.indexOf("[quota-warning] envoi echoue");
    expect(i).toBeGreaterThan(0);
    expect(source.slice(Math.max(0, i - 400), i)).toMatch(/lastQuotaWarningAt: dernierAvertissement/);
  });
});
