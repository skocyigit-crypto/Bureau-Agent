import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, organisationsTable, subscriptionsTable } from "@workspace/db";

const SUPER_ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@agentdebureau.fr";
const SUPER_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin2024!";

async function ensureDefaultOrganisation(): Promise<number> {
  const [existing] = await db.select({ id: organisationsTable.id }).from(organisationsTable).limit(1);
  if (existing) return existing.id;

  const [org] = await db.insert(organisationsTable).values({
    name: "Agent de Bureau SAS",
    slug: "agent-de-bureau-sas",
    email: SUPER_ADMIN_EMAIL,
    maxUsers: 3,
    actif: true,
  }).returning({ id: organisationsTable.id });

  const trialEnd = new Date(Date.now() + 14 * 86400000);
  await db.insert(subscriptionsTable).values({
    organisationId: org.id,
    plan: "essai",
    status: "active",
    maxUsers: 3,
    maxContacts: 100,
    maxCallsPerMonth: 50,
    aiEnabled: false,
    stockEnabled: false,
    automationEnabled: false,
    price: "0",
    trialEndsAt: trialEnd,
    currentPeriodStart: new Date(),
    currentPeriodEnd: trialEnd,
  });

  console.log(`[Seed] Organisation par defaut creee (id=${org.id})`);
  return org.id;
}

export async function ensureSuperAdmin() {
  const orgId = await ensureDefaultOrganisation();

  const existing = await db.select({ id: usersTable.id, organisationId: usersTable.organisationId }).from(usersTable).where(eq(usersTable.email, SUPER_ADMIN_EMAIL));

  if (existing.length > 0) {
    if (!existing[0].organisationId) {
      await db.update(usersTable).set({ organisationId: orgId }).where(eq(usersTable.id, existing[0].id));
      console.log("[Seed] Super Admin: organisationId mis a jour.");
    }
    return;
  }

  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);

  await db.insert(usersTable).values({
    email: SUPER_ADMIN_EMAIL,
    passwordHash,
    nom: "Administrateur",
    prenom: "Super",
    role: "super_admin",
    departement: "Direction",
    organisation: "Agent de Bureau SAS",
    organisationId: orgId,
    avatar: "SA",
    mfaActif: false,
    actif: true,
  });

  console.log(`[Seed] Super Admin cree: ${SUPER_ADMIN_EMAIL}`);
}
