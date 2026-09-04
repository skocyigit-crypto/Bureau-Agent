/**
 * La duree de conservation annoncee aux clients, effectivement appliquee.
 *
 * La politique de confidentialite promet, pour les donnees de compte:
 * « duree de l'abonnement + 3 ans apres resiliation ». Rien ne l'appliquait.
 * Un compte resilie en 2021 gardait indefiniment le nom, l'e-mail et le
 * telephone de chaque salarie — ce que l'article 5.1.e du RGPD (limitation de
 * la conservation) interdit, et ce qu'une promesse ecrite rend en plus
 * opposable.
 *
 * Pourquoi anonymiser plutot que supprimer. Deux contraintes rendent la
 * suppression pure impossible, et il vaut mieux les dire que les decouvrir en
 * production:
 *
 *   1. Les factures emises doivent etre conservees 10 ans (obligation
 *      comptable). Supprimer l'organisation les emporterait.
 *   2. `license_audit_log` est rendu append-only par un declencheur
 *      PostgreSQL: toute suppression en cascade echoue, ce qui ferait echouer
 *      le travail entier a chaque passage.
 *
 * On efface donc ce qui identifie des PERSONNES (nom, prenom, e-mail,
 * telephone, secret d'authentification), et on laisse intacte l'entite
 * juridique et sa comptabilite. C'est la ligne que trace le RGPD: une
 * organisation cliente n'est pas une personne physique.
 *
 * L'operation est irreversible. D'ou ces tests, qui verrouillent autant ce qui
 * DOIT etre efface que ce qui ne doit PAS l'etre — et surtout la borne des
 * 3 ans, la seule chose qui separe un menage legitime d'une destruction de
 * donnees clientes.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  organisationsTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db";

import { anonymiserComptesExpires, RETENTION_APRES_RESILIATION_JOURS } from "../services/account-retention-cron";

const stamp = Date.now();
const orgs: number[] = [];

/** Cree une organisation avec un abonnement dans l'etat demande. */
async function creerOrg(
  tag: string,
  statut: string,
  resilieeIlYAJours: number | null,
): Promise<{ orgId: number; userId: number; email: string }> {
  const [org] = await db.insert(organisationsTable).values({
    name: `Retention ${tag} ${stamp}`,
    slug: `retention-${tag}-${stamp}`,
    email: `org-${tag}-${stamp}@example.test`,
    phone: "+33123456789",
    maxUsers: 5,
    actif: true,
  }).returning({ id: organisationsTable.id });
  orgs.push(org.id);

  await db.insert(subscriptionsTable).values({
    organisationId: org.id,
    plan: "starter",
    status: statut,
    licenseKey: `RET-${tag}-${stamp}`,
    cancelledAt: resilieeIlYAJours === null
      ? null
      : new Date(Date.now() - resilieeIlYAJours * 86400_000),
  });

  const email = `retention-${tag}-${stamp}@example.test`;
  const [user] = await db.insert(usersTable).values({
    email,
    passwordHash: "hash-reel-a-effacer",
    nom: "Durand",
    prenom: "Marie",
    telephone: "+33612345678",
    role: "agent",
    organisationId: org.id,
    actif: true,
  }).returning({ id: usersTable.id });

  return { orgId: org.id, userId: user.id, email };
}

let expire: Awaited<ReturnType<typeof creerOrg>>;
let recente: Awaited<ReturnType<typeof creerOrg>>;
let active: Awaited<ReturnType<typeof creerOrg>>;

beforeAll(async () => {
  // Resiliee il y a plus de 3 ans: a anonymiser.
  expire = await creerOrg("expire", "annulee", RETENTION_APRES_RESILIATION_JOURS + 30);
  // Resiliee il y a 3 ans moins un jour: la borne compte, un jour aussi.
  recente = await creerOrg("recente", "annulee", RETENTION_APRES_RESILIATION_JOURS - 1);
  // Client en cours: ne doit jamais etre touche.
  active = await creerOrg("active", "active", null);

  await anonymiserComptesExpires();
});

afterAll(async () => {
  try {
    for (const id of orgs) {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, id));
    }
  } catch {
    // Menage « au mieux »: le declencheur append-only peut retenir une ligne.
  }
});

async function lireUtilisateur(userId: number) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return u;
}

describe("conservation des comptes apres resiliation", () => {
  it("efface les donnees personnelles au-dela de la duree annoncee", async () => {
    const u = await lireUtilisateur(expire.userId);
    expect(u.nom).not.toBe("Durand");
    expect(u.prenom).not.toBe("Marie");
    expect(u.email).not.toBe(expire.email);
    expect(u.telephone, "un numero de telephone identifie une personne").toBeNull();
    expect(u.passwordHash, "un condensat conserve reste une donnee exploitable").not.toBe("hash-reel-a-effacer");
  });

  it("laisse le compte inutilisable plutot que reactivable", async () => {
    // Anonymiser sans desactiver laisserait un compte fantome: plus de nom,
    // mais toujours une porte d'entree.
    const u = await lireUtilisateur(expire.userId);
    expect(u.actif).toBe(false);
  });

  it("garde un e-mail unique, sinon le travail echoue au deuxieme compte", async () => {
    // `users.email` porte une contrainte d'unicite: remplacer tous les
    // e-mails par la meme valeur ferait echouer l'anonymisation des le
    // deuxieme utilisateur, silencieusement, en laissant le reste en clair.
    const u = await lireUtilisateur(expire.userId);
    expect(u.email).toContain(String(expire.userId));
  });

  it("ne touche pas un compte resilie depuis moins de trois ans", async () => {
    const u = await lireUtilisateur(recente.userId);
    expect(u.nom).toBe("Durand");
    expect(u.email).toBe(recente.email);
    expect(u.actif).toBe(true);
  });

  it("ne touche pas un client en cours", async () => {
    const u = await lireUtilisateur(active.userId);
    expect(u.nom).toBe("Durand");
    expect(u.email).toBe(active.email);
    expect(u.actif).toBe(true);
  });

  it("conserve l'organisation et son abonnement", async () => {
    // Les factures emises se conservent 10 ans: elles designent une entite
    // juridique, qui doit rester identifiable. Une organisation cliente n'est
    // pas une personne physique.
    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, expire.orgId));
    expect(org, "l'organisation ne doit pas etre supprimee").toBeTruthy();
    expect(org.name).toContain("Retention expire");

    const [sub] = await db.select().from(subscriptionsTable)
      .where(eq(subscriptionsTable.organisationId, expire.orgId));
    expect(sub, "l'abonnement porte l'historique de facturation").toBeTruthy();
  });

  it("peut etre relance sans rien casser", async () => {
    // Un cron repasse toutes les 24h sur les memes lignes. La deuxieme passe
    // ne doit ni echouer sur l'unicite, ni re-anonymiser un compte deja
    // anonymise en changeant sa valeur.
    const avant = await lireUtilisateur(expire.userId);
    await anonymiserComptesExpires();
    const apres = await lireUtilisateur(expire.userId);
    expect(apres.email).toBe(avant.email);
    expect(apres.nom).toBe(avant.nom);
  });
});
