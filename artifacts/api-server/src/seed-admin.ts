import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, organisationsTable, subscriptionsTable } from "@workspace/db";

const SUPER_ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@agentdebureau.fr";
const SUPER_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function ensureDefaultOrganisation(): Promise<number> {
  const [existing] = await db.select({ id: organisationsTable.id }).from(organisationsTable).where(eq(organisationsTable.slug, "agent-de-bureau-sas"));
  if (existing) return existing.id;

  const [org] = await db.insert(organisationsTable).values({
    name: "Agent de Bureau SAS",
    slug: "agent-de-bureau-sas",
    email: SUPER_ADMIN_EMAIL,
    maxUsers: 3,
    isActive: true,
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

  console.log(`Organisation par defaut creee (id=${org.id}) avec abonnement essai.`);
  return org.id;
}

async function seedSuperAdmin() {
  if (!SUPER_ADMIN_PASSWORD) {
    console.error("ADMIN_PASSWORD environment variable is required to seed the admin user.");
    console.error("Set it with: export ADMIN_PASSWORD=YourSecurePassword123!");
    process.exit(1);
  }

  if (SUPER_ADMIN_PASSWORD.length < 8) {
    console.error("ADMIN_PASSWORD must be at least 8 characters long.");
    process.exit(1);
  }

  const orgId = await ensureDefaultOrganisation();

  const existing = await db.select({ id: usersTable.id, organisationId: usersTable.organisationId }).from(usersTable).where(eq(usersTable.email, SUPER_ADMIN_EMAIL));

  if (existing.length > 0) {
    if (!existing[0].organisationId) {
      await db.update(usersTable).set({ organisationId: orgId }).where(eq(usersTable.id, existing[0].id));
      console.log("Super Admin existant: organisationId mis a jour.");
    } else {
      console.log("Super Admin deja existant, aucune action necessaire.");
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

  console.log("Super Admin cree avec succes !");
  console.log(`Email: ${SUPER_ADMIN_EMAIL}`);
}

seedSuperAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erreur:", err);
    process.exit(1);
  });
