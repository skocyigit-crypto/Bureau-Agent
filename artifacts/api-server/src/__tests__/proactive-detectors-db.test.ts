/**
 * Détecteurs 9 & 10 — SLA de réponse aux messages entrants & client devenu
 * silencieux, vérifiés DE BOUT EN BOUT contre la base (et plus seulement sur
 * leur cœur pur). Cette suite verrouille le comportement DANS LE TEMPS, ce qui
 * ne peut pas l'être par un test pur :
 *
 *   1. À partir de données réelles (un message entrant resté sans réponse au
 *      delà du SLA + un client autrefois actif mais silencieux depuis ~30 j),
 *      `runProactiveForOrg` crée EXACTEMENT une suggestion `pending` de chaque
 *      type (message_sla_breach, quiet_customer).
 *   2. Ré-exécuter le moteur (tick suivant) NE DUPLIQUE PAS : toujours une
 *      seule `pending` de chaque type (dédup (org, dedupeKey) + index unique).
 *   3. Une fois la condition levée (une réponse sortante est envoyée / un
 *      nouvel appel rafraîchit lastCallAt), le tick suivant AUTO-RÉSOUT les
 *      deux suggestions en `done`, sans en recréer ni en dupliquer.
 *
 * Test À BASE DE DONNÉES : seed un org isolé (ids uniques par run via `stamp`),
 * nettoyage best-effort en fin de suite.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  organisationsTable,
  usersTable,
  contactsTable,
  callsTable,
  messagesTable,
  proactiveSuggestionsTable,
} from "@workspace/db";
import { runProactiveForOrg } from "../services/proactive-engine";

const DAY_MS = 24 * 60 * 60 * 1000;
const stamp = Date.now();
const PHONE = `+3360${String(stamp).slice(-7)}`;

let orgId: number;
let userId: number;
let contactId: number;
let inboundMsgId: number;

async function pendingOfType(type: string) {
  return db
    .select({ id: proactiveSuggestionsTable.id })
    .from(proactiveSuggestionsTable)
    .where(
      and(
        eq(proactiveSuggestionsTable.organisationId, orgId),
        eq(proactiveSuggestionsTable.type, type),
        eq(proactiveSuggestionsTable.status, "pending"),
      ),
    );
}

async function allOfType(type: string) {
  return db
    .select({ id: proactiveSuggestionsTable.id, status: proactiveSuggestionsTable.status })
    .from(proactiveSuggestionsTable)
    .where(
      and(
        eq(proactiveSuggestionsTable.organisationId, orgId),
        eq(proactiveSuggestionsTable.type, type),
      ),
    );
}

beforeAll(async () => {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `Proactive DB ${stamp}`,
      slug: `proactive-db-${stamp}`,
      maxUsers: 10,
      actif: true,
      proactiveEngineEnabled: true,
    })
    .returning({ id: organisationsTable.id });
  orgId = org.id;

  const [user] = await db
    .insert(usersTable)
    .values({
      email: `proactive-db-${stamp}@example.test`,
      passwordHash: "x",
      nom: "Test",
      prenom: "Agent",
      role: "agent",
      organisationId: orgId,
      actif: true,
    })
    .returning({ id: usersTable.id });
  userId = user.id;

  const now = Date.now();

  // Message ENTRANT (rédigé par l'extérieur -> createdBy NULL), priorité par
  // défaut (« moyenne », donc hors urgent_message), reçu il y a ~2 jours :
  // au-delà du SLA (8 h) mais dans la fenêtre bornée (14 j) -> message_sla_breach.
  const [msg] = await db
    .insert(messagesTable)
    .values({
      organisationId: orgId,
      phoneNumber: PHONE,
      contactName: "Client Sans Réponse",
      content: "Bonjour, avez-vous reçu mon devis ?",
      type: "sms",
      createdAt: new Date(now - 2 * DAY_MS),
    })
    .returning({ id: messagesTable.id });
  inboundMsgId = msg.id;

  // Contact client AUTREFOIS actif (totalCalls >= 2) mais silencieux depuis
  // ~30 j : dans la fenêtre [21 ; 60[ jours -> quiet_customer (et pas encore
  // inactive_contact, qui se base sur updatedAt et un seuil de 60 j).
  const [contact] = await db
    .insert(contactsTable)
    .values({
      organisationId: orgId,
      firstName: "Sami",
      lastName: "Discret",
      phone: PHONE,
      category: "client",
      totalCalls: 5,
      lastCallAt: new Date(now - 30 * DAY_MS),
    })
    .returning({ id: contactsTable.id });
  contactId = contact.id;
});

afterAll(async () => {
  try {
    await db
      .delete(proactiveSuggestionsTable)
      .where(eq(proactiveSuggestionsTable.organisationId, orgId));
    await db.delete(messagesTable).where(eq(messagesTable.organisationId, orgId));
    await db.delete(callsTable).where(eq(callsTable.organisationId, orgId));
    await db.delete(contactsTable).where(eq(contactsTable.organisationId, orgId));
    await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch {
    // best-effort : ids uniques par run (stamp).
  }
});

describe("Détecteurs proactifs (SLA messages & client silencieux) sur la base", () => {
  it("crée EXACTEMENT une suggestion pending de chaque nouveau type", async () => {
    await runProactiveForOrg(orgId);

    const sla = await pendingOfType("message_sla_breach");
    const quiet = await pendingOfType("quiet_customer");
    expect(sla).toHaveLength(1);
    expect(quiet).toHaveLength(1);
  });

  it("ne duplique pas au tick suivant (dédup org+dedupeKey)", async () => {
    // Deux ticks supplémentaires : la condition est toujours vraie, donc le
    // moteur doit RÉ-IDENTIFIER les mêmes candidats sans créer de doublon.
    await runProactiveForOrg(orgId);
    await runProactiveForOrg(orgId);

    expect(await pendingOfType("message_sla_breach")).toHaveLength(1);
    expect(await pendingOfType("quiet_customer")).toHaveLength(1);
    // Aucun doublon non plus en comptant toutes statuts confondus.
    expect(await allOfType("message_sla_breach")).toHaveLength(1);
    expect(await allOfType("quiet_customer")).toHaveLength(1);
  });

  it("auto-résout les deux en `done` une fois la condition levée, sans doublon", async () => {
    // Réponse SORTANTE (createdBy renseigné) vers le même numéro, postérieure au
    // message entrant -> le SLA est satisfait (selectUnansweredInbound le retire).
    await db.insert(messagesTable).values({
      organisationId: orgId,
      phoneNumber: PHONE,
      contactName: "Client Sans Réponse",
      content: "Oui, je vous l'envoie tout de suite.",
      type: "sms",
      createdBy: userId,
      createdAt: new Date(),
    });

    // Nouvel appel : on enregistre l'appel ET on rafraîchit lastCallAt (signal
    // lu par le détecteur) -> le contact sort de la fenêtre « silencieux ».
    await db.insert(callsTable).values({
      organisationId: orgId,
      contactId,
      phoneNumber: PHONE,
      direction: "entrant",
      status: "repondu",
    });
    await db
      .update(contactsTable)
      .set({ lastCallAt: new Date(), totalCalls: 6 })
      .where(eq(contactsTable.id, contactId));

    await runProactiveForOrg(orgId);

    // Plus aucune `pending` : les deux suggestions sont auto-résolues.
    expect(await pendingOfType("message_sla_breach")).toHaveLength(0);
    expect(await pendingOfType("quiet_customer")).toHaveLength(0);

    // Et elles existent toujours, en `done`, une seule de chaque (pas de doublon
    // ni de recréation).
    const slaAll = await allOfType("message_sla_breach");
    const quietAll = await allOfType("quiet_customer");
    expect(slaAll).toHaveLength(1);
    expect(quietAll).toHaveLength(1);
    expect(slaAll[0].status).toBe("done");
    expect(quietAll[0].status).toBe("done");

    // Un tick de plus ne ressuscite rien (condition toujours levée).
    await runProactiveForOrg(orgId);
    expect(await pendingOfType("message_sla_breach")).toHaveLength(0);
    expect(await pendingOfType("quiet_customer")).toHaveLength(0);
    expect(await allOfType("message_sla_breach")).toHaveLength(1);
    expect(await allOfType("quiet_customer")).toHaveLength(1);
  });
});
