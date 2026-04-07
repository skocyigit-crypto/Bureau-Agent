import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const SUPER_ADMIN_EMAIL = "admin@agentdebureau.fr";
const SUPER_ADMIN_PASSWORD = "Admin2024!";

export async function ensureSuperAdmin() {
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, SUPER_ADMIN_EMAIL));

  if (existing.length > 0) {
    return;
  }

  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);

  await db.insert(usersTable).values({
    email: SUPER_ADMIN_EMAIL,
    passwordHash,
    nom: "Benoit",
    prenom: "Aurelie",
    role: "super_admin",
    departement: "Direction",
    organisation: "Agent de Bureau SAS",
    avatar: "AB",
    mfaActif: true,
    actif: true,
  });

  console.log("[Seed] Super Admin cree: admin@agentdebureau.fr");
}
