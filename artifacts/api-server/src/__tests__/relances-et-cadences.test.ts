/**
 * Trois envois vers le CLIENT pouvaient partir deux fois.
 *
 *  - `POST /commandant/overdue-reminders` envoyait une relance de paiement a
 *    l'adresse du client final SANS marquer la facture. La relance restait
 *    donc invisible pour le detecteur de `services/payment-reminder.ts`, qui
 *    lit `factures_client.lastReminderAt` pour son espacement : le client
 *    relance ici pouvait recevoir une seconde relance des le lendemain —
 *    exactement le martelement que ce detecteur promet d'eviter.
 *    `ai-analysis.ts` fait ce marquage et son commentaire explique pourquoi ;
 *    la regle n'avait ete appliquee que d'un cote.
 *
 *  - `automation-engine` selectionnait les regles dues puis n'avancait
 *    `nextRun` qu'a la FIN de l'execution. Entre les deux, une autre instance
 *    — il y en a jusqu'a trois — selectionnait les memes regles : deux taches
 *    creees, deux notifications, deux propositions pour un declenchement.
 *
 *  - `security-digest-cron` lisait `lastSecurityDigestAt`, comparait,
 *    envoyait, et n'ecrivait qu'ensuite. L'en-tete du fichier promet « un
 *    envoi par semaine garanti, SANS doublon » : vrai pour le redemarrage,
 *    faux pour la concurrence.
 *
 * Les controles de concurrence lancent de VRAIS appels simultanes contre la
 * VRAIE base.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import { automationRulesTable, db, organisationsTable } from "@workspace/db";

const SRC = join(import.meta.dirname, "..");
const stamp = Date.now();
let orgId = 0;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Relances ${stamp}`, slug: `relances-${stamp}`, maxUsers: 10, actif: true,
    email: `relances-${stamp}@example.test`, weeklySecurityEmail: true,
  } as any).returning({ id: organisationsTable.id });
  orgId = o!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(automationRulesTable).where(eq(automationRulesTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* journaux en ajout seul */ }
});

// ── La relance de paiement laisse une trace ─────────────────────────────────

describe("une relance envoyee par le commandant se voit", () => {
  const source = readFileSync(join(SRC, "routes", "ai-commandant.ts"), "utf8");
  const bloc = (() => {
    const i = source.indexOf("Rappel - Facture ${invoice.reference}");
    return source.slice(i, i + 1600);
  })();

  it("la facture est marquee apres l'envoi", () => {
    expect(bloc, "la relance reste invisible pour l'anti-spam").toMatch(/lastReminderAt: relanceLe/);
  });

  it("et le compteur de relances avance", () => {
    expect(bloc).toMatch(/reminderCount.*\+ 1/);
  });

  it("le marquage est borne a l'organisation", () => {
    expect(bloc).toMatch(/eq\(facturesClientTable\.organisationId, orgId\)/);
  });

  it("il ne se declenche que si l'envoi a reussi", () => {
    // Marquer une relance qui n'est pas partie ferait taire l'anti-spam
    // pendant des jours pour rien.
    expect(bloc).toMatch(/if \(sent\) \{/);
  });

  it("c'est le meme champ que lit l'anti-spam", () => {
    // Sans cela, on marquerait un champ que personne ne regarde — le defaut
    // precedent, sous une autre forme.
    const detecteur = readFileSync(join(SRC, "services", "payment-reminder.ts"), "utf8");
    expect(detecteur).toMatch(/lastReminderAt/);
  });
});

// ── Les regles d'automatisation se reclament ────────────────────────────────

async function regle(nextRun: Date | null) {
  const [r] = await db.insert(automationRulesTable).values({
    organisationId: orgId,
    name: `Regle ${stamp}-${Math.floor(Math.random() * 1e6)}`,
    type: "scheduled",
    trigger: "tache_en_retard",
    actions: [],
    schedule: "hourly",
    enabled: true,
    nextRun,
  } as any).returning();
  return r!;
}

/** La reclamation telle que `runAllAutomations` la fait. */
async function reclamerRegle(id: number) {
  const maintenant = new Date();
  const r = await db.update(automationRulesTable)
    .set({ nextRun: new Date(Date.now() + 3600_000), lastRun: maintenant })
    .where(and(
      eq(automationRulesTable.id, id),
      or(
        isNull(automationRulesTable.nextRun),
        lte(automationRulesTable.nextRun, maintenant),
      ),
    ))
    .returning({ id: automationRulesTable.id });
  return r.length > 0;
}

describe("une regle d'automatisation ne tourne qu'une fois par cadence", () => {
  it("deux instances concurrentes: une seule obtient la regle", async () => {
    const r = await regle(new Date(Date.now() - 60_000));
    const [a, b] = await Promise.all([reclamerRegle(r.id), reclamerRegle(r.id)]);
    expect([a, b].filter(Boolean).length, "la regle a tourne deux fois").toBe(1);
  });

  it("et sur trois, comme a maxScale=3", async () => {
    const r = await regle(new Date(Date.now() - 60_000));
    const res = await Promise.all([reclamerRegle(r.id), reclamerRegle(r.id), reclamerRegle(r.id)]);
    expect(res.filter(Boolean).length).toBe(1);
  });

  it("une regle jamais executee est bien prise", async () => {
    const r = await regle(null);
    expect(await reclamerRegle(r.id)).toBe(true);
  });

  it("une regle pas encore due n'est pas prise", async () => {
    const r = await regle(new Date(Date.now() + 3600_000));
    expect(await reclamerRegle(r.id), "la cadence n'est pas respectee").toBe(false);
  });

  it("la cadence est avancee AVANT l'execution", () => {
    // La reposer apres coup la decalerait de la duree du traitement, et
    // surtout rouvrirait la fenetre que la reclamation vient de fermer.
    const source = readFileSync(join(SRC, "services", "automation-engine.ts"), "utf8");
    const iReclame = source.indexOf("const reclamee = await db.update(automationRulesTable)");
    const iExecute = source.indexOf("await executeRule(rule);", iReclame);
    expect(iReclame, "la reclamation a disparu").toBeGreaterThan(0);
    expect(iExecute).toBeGreaterThan(iReclame);
    expect(source.slice(iReclame, iExecute)).toMatch(/if \(reclamee\.length === 0\) continue;/);
  });

  it("et elle n'est plus reposee a la fin", () => {
    const source = readFileSync(join(SRC, "services", "automation-engine.ts"), "utf8");
    const i = source.indexOf("runCount: sql`${automationRulesTable.runCount} + 1`");
    const bloc = source.slice(Math.max(0, i - 300), i + 200);
    expect(bloc, "la cadence est reposee apres l'execution").not.toMatch(/nextRun,/);
  });
});

// ── La synthese hebdomadaire se reclame aussi ───────────────────────────────

const SEMAINE_MS = 7 * 24 * 3600 * 1000;

async function reclamerSynthese(id: number) {
  const seuil = new Date(Date.now() - SEMAINE_MS);
  const r = await db.update(organisationsTable)
    .set({ lastSecurityDigestAt: new Date() })
    .where(and(
      eq(organisationsTable.id, id),
      or(
        isNull(organisationsTable.lastSecurityDigestAt),
        lt(organisationsTable.lastSecurityDigestAt, seuil),
      ),
    ))
    .returning({ id: organisationsTable.id });
  return r.length > 0;
}

describe("la synthese de securite ne part qu'une fois par semaine", () => {
  beforeEach(async () => {
    await db.update(organisationsTable).set({ lastSecurityDigestAt: null })
      .where(eq(organisationsTable.id, orgId));
  });

  it("deux instances concurrentes: un seul envoi", async () => {
    const [a, b] = await Promise.all([reclamerSynthese(orgId), reclamerSynthese(orgId)]);
    expect([a, b].filter(Boolean).length, "la synthese est partie deux fois").toBe(1);
  });

  it("un deuxieme tic dans la semaine ne repart pas", async () => {
    await reclamerSynthese(orgId);
    expect(await reclamerSynthese(orgId)).toBe(false);
  });

  it("passee la semaine, elle repart", async () => {
    await db.update(organisationsTable)
      .set({ lastSecurityDigestAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) })
      .where(eq(organisationsTable.id, orgId));
    expect(await reclamerSynthese(orgId)).toBe(true);
  });

  it("la fenetre est reclamee AVANT l'envoi", () => {
    const source = readFileSync(join(SRC, "services", "security-digest-cron.ts"), "utf8");
    const iReclame = source.indexOf("const reclamee = await db");
    const iEnvoi = source.indexOf("await sendDigest(", iReclame);
    expect(iReclame, "la reclamation a disparu").toBeGreaterThan(0);
    expect(iEnvoi).toBeGreaterThan(iReclame);
  });

  it("un envoi qui echoue rend la fenetre", () => {
    // Sinon l'organisation resterait silencieuse une semaine pour une
    // synthese jamais partie.
    const source = readFileSync(join(SRC, "services", "security-digest-cron.ts"), "utf8");
    const i = source.indexOf("[security-digest] envoi echoue");
    expect(i).toBeGreaterThan(0);
    expect(source.slice(Math.max(0, i - 500), i)).toMatch(/lastSecurityDigestAt: fenetrePrecedente/);
  });
});
