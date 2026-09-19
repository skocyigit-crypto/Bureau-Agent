/**
 * L'avertissement de fin d'essai : un envoi rate ne doit pas etre oublie.
 *
 * A l'expiration, `middleware/license-check.ts` bascule le compte en lecture
 * seule. Cet email est la seule chose qui separe « j'ai ete prevenu trois
 * fois » de « le logiciel s'est arrete sans rien dire ».
 *
 * Mesure le 18/09 : la trace de notification etait ecrite AVANT l'envoi, et la
 * deduplication porte sur (bucket, trialEndsAt) — donc definitive. Un envoi
 * echoue (SMTP indisponible, adresse temporairement refusee) etait memorise
 * comme « notifie » : les cycles suivants de la fenetre se sautaient, et le
 * client perdait l'ecriture sans avoir jamais ete prevenu. La panne ne
 * laissait qu'un `logger.warn` que personne ne relit.
 *
 * Second defaut mesure au meme endroit : aucun verrou. La deduplication est un
 * SELECT suivi d'une ecriture, et Cloud Run porte ce cron sur jusqu'a trois
 * instances — le meme avertissement partait plusieurs fois.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const envois: { to: string; expired: boolean; daysLeft: number }[] = [];
let echoue = false;

vi.mock("../services/email", () => ({
  sendTrialEndingEmail: vi.fn(async (p: { to: string; expired: boolean; daysLeft: number }) => {
    envois.push({ to: p.to, expired: p.expired, daysLeft: p.daysLeft });
    return echoue ? { success: false, error: "SMTP indisponible" } : { success: true };
  }),
}));

const { db, organisationsTable, subscriptionsTable, licenseAuditLogTable } = await import("@workspace/db");
const { tick, bucketPourHeures } = await import("../services/trial-warning-cron");

const marque = Date.now();
const orgsCreees: number[] = [];

async function semer(etiquette: string, finEssai: Date, statut = "active"): Promise<number> {
  const [org] = await db.insert(organisationsTable).values({
    name: `Essai ${etiquette} ${marque}`,
    slug: `essai-${etiquette}-${marque}`,
    email: `essai-${etiquette}-${marque}@example.com`,
    maxUsers: 5,
    actif: true,
  }).returning({ id: organisationsTable.id });
  await db.insert(subscriptionsTable).values({
    organisationId: org.id,
    plan: "essai",
    status: statut,
    licenseKey: `ESSAI-${etiquette}-${marque}`,
    maxUsers: 5,
    maxContacts: 100,
    maxCallsPerMonth: 100,
    price: "0",
    trialEndsAt: finEssai,
  });
  orgsCreees.push(org.id);
  return org.id;
}

const traces = async (orgId: number) =>
  db.select({ id: licenseAuditLogTable.id, action: licenseAuditLogTable.action })
    .from(licenseAuditLogTable)
    .where(eq(licenseAuditLogTable.organisationId, orgId));

const dans = (heures: number) => new Date(Date.now() + heures * 3600000);

beforeEach(() => {
  envois.length = 0;
  echoue = false;
});

// Pas de menage: le journal de licence est APPEND-ONLY (garde SQL
// audit_log_append_only_guard), et supprimer l organisation emporterait la
// trace avec elle. Ces quelques lignes marquees d un horodatage restent donc
// dans la base de test — c est le prix d une piste d audit qui tient.

describe("choix de la fenetre d'avertissement", () => {
  it("trois jours avant : T-3", () => expect(bucketPourHeures(70)).toBe("T-3"));
  it("le dernier jour : T-1", () => expect(bucketPourHeures(12)).toBe("T-1"));
  it("juste apres l'expiration : T-0", () => expect(bucketPourHeures(-2)).toBe("T-0"));
  it("trop tot : aucune notification", () => expect(bucketPourHeures(100)).toBeNull());
  it("trop tard : on ne reveille pas un essai expire depuis deux jours", () =>
    expect(bucketPourHeures(-48)).toBeNull());
  it("la borne exacte de l'expiration appartient a T-0", () =>
    expect(bucketPourHeures(0)).toBe("T-0"));
});

describe("un envoi echoue est retente", () => {
  it("n'ecrit aucune trace quand l'email ne part pas", async () => {
    const orgId = await semer("echec", dans(12));
    echoue = true;
    await tick();
    // La base de test est partagee, ET ce fichier laisse ses propres essais
    // d une execution a l autre: filtrer sur « echec » seul comptait aussi
    // ceux du run precedent. Le marqueur du run est donc dans le filtre.
    expect(envois.filter(e => e.to.includes(`echec-${marque}`)), "l'email aurait du etre tente").toHaveLength(1);
    expect(
      await traces(orgId),
      "trace ecrite malgre l'echec: la deduplication condamne le client au silence",
    ).toHaveLength(0);
  });

  it("le cycle suivant reessaie et, s'il aboutit, laisse la trace", async () => {
    const orgId = await semer("reprise", dans(12));
    echoue = true;
    await tick();
    expect(envois.filter(e => e.to.includes(`reprise-${marque}`))).toHaveLength(1);

    envois.length = 0;
    echoue = false;
    await tick();
    expect(envois.filter(e => e.to.includes(`reprise-${marque}`)), "aucune seconde tentative").toHaveLength(1);
    const t = await traces(orgId);
    expect(t).toHaveLength(1);
    expect(t[0].action).toBe("trial_ending_warning");
  });
});

describe("un envoi reussi n'est pas repete", () => {
  it("le meme bucket ne part qu'une fois", async () => {
    const orgId = await semer("unique", dans(12));
    await tick();
    envois.length = 0;
    await tick();
    expect(envois.filter(e => e.to.includes("unique")), "second envoi pour le meme bucket").toHaveLength(0);
    expect(await traces(orgId)).toHaveLength(1);
  });

  it("un essai expire produit la notification T-0, marquee expiree", async () => {
    const orgId = await semer("expire", dans(-2));
    await tick();
    const envoi = envois.find(e => e.to.includes("expire"));
    expect(envoi?.expired, "l'email annonce encore des jours restants").toBe(true);
    const t = await traces(orgId);
    expect(t[0]?.action).toBe("trial_expired");
  });
});

describe("qui ne doit pas etre notifie", () => {
  it("un essai encore loin de la fin ne recoit rien", async () => {
    await semer("loin", dans(240));
    await tick();
    expect(envois.filter(e => e.to.includes("loin"))).toHaveLength(0);
  });

  it("un abonnement suspendu n'est pas relance sur son essai", async () => {
    await semer("suspendu", dans(12), "suspended");
    await tick();
    expect(envois.filter(e => e.to.includes("suspendu"))).toHaveLength(0);
  });
});

describe("le cron est protege contre le multi-instance", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "services", "trial-warning-cron.ts"), "utf8",
  );

  it("prend un verrou par organisation", () => {
    expect(
      source,
      "SELECT puis ecriture sans verrou: deux instances envoient le meme avertissement",
    ).toMatch(/withCronLock\(CRON_LOCK_NAMESPACE\.trialWarning, row\.id/);
  });

  it("son namespace de verrou lui est propre", () => {
    const lock = readFileSync(join(import.meta.dirname, "..", "lib", "cron-lock.ts"), "utf8");
    const valeurs = [...lock.matchAll(/: (\d{4}),/g)].map(m => m[1]);
    expect(new Set(valeurs).size, "deux crons partagent un namespace").toBe(valeurs.length);
  });
});
