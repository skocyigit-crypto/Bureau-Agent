/**
 * Apprentissage déterministe du STYLE D'ÉCRITURE par employé.
 *
 * `recomputeUserProfile` mine les messages (createdBy=employé) et notes
 * internes (userId=employé) pour en déduire UN fait `writing_style` agrégé,
 * SANS jamais stocker le texte brut. La logique est 100% déterministe (pas
 * d'IA) : seuils sur la longueur moyenne, le registre (vous/tu), les emojis
 * et le ton (points d'exclamation). Cette suite verrouille ces seuils pour
 * éviter une régression silencieuse du profilage :
 *
 *   - garde anti-bruit : < 5 échantillons ⇒ aucun fait `writing_style`.
 *   - messages courts + vouvoiement + emojis + exclamations ⇒ label complet.
 *   - messages longs + tutoiement (sans emoji/exclamation) ⇒ label sobre.
 *   - aucune fuite de texte brut : la `value` reste "profil".
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import {
  db,
  aiUserProfileFactsTable,
  messagesTable,
  notesInternesTable,
  organisationsTable,
  usersTable,
} from "@workspace/db";
import {
  recomputeUserProfile,
  getUserLearningProfile,
} from "../services/ai-learning";

const stamp = Date.now();

let orgId: number;
let userGuard: number; // < 5 échantillons
let userVous: number; // courts + vouvoiement + emoji + exclamation
let userTu: number; // longs + tutoiement, sobre

async function seedUser(tag: string): Promise<number> {
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `ws-${tag}-${stamp}@example.test`,
      passwordHash: "x",
      nom: tag,
      prenom: "Test",
      role: "agent",
      organisationId: orgId,
      actif: true,
    })
    .returning({ id: usersTable.id });
  return row.id;
}

async function seedMessages(userId: number, contents: string[]): Promise<void> {
  for (const content of contents) {
    await db.insert(messagesTable).values({
      organisationId: orgId,
      phoneNumber: "0000000000",
      content,
      type: "note",
      createdBy: userId,
    });
  }
}

async function seedNotes(userId: number, contents: string[]): Promise<void> {
  for (const content of contents) {
    await db.insert(notesInternesTable).values({
      organisationId: orgId,
      userId,
      content,
    });
  }
}

function writingStyleLabel(
  profile: Awaited<ReturnType<typeof getUserLearningProfile>>,
): string | null {
  const fact = profile.facts.find((f) => f.factType === "writing_style");
  return fact ? fact.label : null;
}

beforeAll(async () => {
  const [org] = await db
    .insert(organisationsTable)
    .values({ name: `WStyle Org ${stamp}`, slug: `wstyle-${stamp}`, maxUsers: 10, actif: true })
    .returning({ id: organisationsTable.id });
  orgId = org.id;

  userGuard = await seedUser("guard");
  userVous = await seedUser("vous");
  userTu = await seedUser("tu");

  // userGuard : seulement 4 échantillons ⇒ sous le seuil minimal (5).
  await seedMessages(userGuard, [
    "Bonjour, c'est noté.",
    "Merci beaucoup.",
    "À bientôt.",
    "Bien reçu.",
  ]);

  // userVous : 3 messages + 3 notes = 6 échantillons, courts (< 80 car.),
  // vouvoiement, emojis et points d'exclamation.
  const vousShort = "Bonjour, merci pour votre message, je vous réponds vite ! \u{1F642}";
  await seedMessages(userVous, [vousShort, vousShort, vousShort]);
  await seedNotes(userVous, [vousShort, vousShort, vousShort]);

  // userTu : 5 messages longs (> 250 car.), tutoiement, sans emoji ni "!".
  const tuLong =
    "Salut, je pense que tu devrais regarder ton dossier car toi seul connais " +
    "les détails de ce travail, et je crois sincèrement que tu pourras avancer " +
    "si tu prends le temps nécessaire pour bien comprendre chaque étape de ton " +
    "projet avant de continuer plus loin dans ta démarche quotidienne habituelle " +
    "comme tu le fais toujours avec ton sérieux légendaire.";
  await seedMessages(userTu, [tuLong, tuLong, tuLong, tuLong, tuLong]);
});

afterAll(async () => {
  try {
    await db
      .delete(aiUserProfileFactsTable)
      .where(inArray(aiUserProfileFactsTable.organisationId, [orgId]));
    await db
      .delete(messagesTable)
      .where(inArray(messagesTable.organisationId, [orgId]));
    await db
      .delete(notesInternesTable)
      .where(inArray(notesInternesTable.organisationId, [orgId]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [userGuard, userVous, userTu]));
    await db
      .delete(organisationsTable)
      .where(inArray(organisationsTable.id, [orgId]));
  } catch {
    // nettoyage best-effort; ids uniques par run (stamp).
  }
});

describe("Style d'écriture — mineur déterministe", () => {
  it("garde anti-bruit : < 5 échantillons ⇒ aucun fait writing_style", async () => {
    await recomputeUserProfile(orgId, userGuard);
    const profile = await getUserLearningProfile(orgId, userGuard);
    expect(writingStyleLabel(profile)).toBeNull();
  });

  it("courts + vouvoiement + emojis + exclamations ⇒ label complet", async () => {
    await recomputeUserProfile(orgId, userVous);
    const profile = await getUserLearningProfile(orgId, userVous);
    const label = writingStyleLabel(profile);
    expect(label).not.toBeNull();
    expect(label).toContain("messages courts et directs");
    expect(label).toContain("vouvoiement (vous)");
    expect(label).toContain("emojis fréquents");
    expect(label).toContain("ton expressif");

    // Aucune fuite de texte brut : la value est stable ("profil").
    const fact = profile.facts.find((f) => f.factType === "writing_style");
    expect(fact?.value).toBe("profil");
    expect(fact?.occurrences).toBe(6);
  });

  it("longs + tutoiement (sobre) ⇒ label sans emoji ni ton expressif", async () => {
    await recomputeUserProfile(orgId, userTu);
    const profile = await getUserLearningProfile(orgId, userTu);
    const label = writingStyleLabel(profile);
    expect(label).not.toBeNull();
    expect(label).toContain("messages détaillés");
    expect(label).toContain("tutoiement (tu)");
    expect(label).not.toContain("emojis");
    expect(label).not.toContain("ton expressif");
  });

  it("recompute idempotent : relancer ne duplique pas le fait writing_style", async () => {
    await recomputeUserProfile(orgId, userVous);
    await recomputeUserProfile(orgId, userVous);
    const profile = await getUserLearningProfile(orgId, userVous);
    const styleFacts = profile.facts.filter((f) => f.factType === "writing_style");
    expect(styleFacts.length).toBe(1);
  });
});
