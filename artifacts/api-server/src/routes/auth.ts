import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logAudit } from "./audit";

const router: IRouter = Router();

const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email et mot de passe sont obligatoires." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));

  if (!user) {
    res.status(401).json({ error: "Identifiants invalides." });
    return;
  }

  if (!user.actif) {
    res.status(403).json({ error: "Ce compte est desactive. Contactez votre administrateur." });
    return;
  }

  if (user.verrouilleJusqua && new Date(user.verrouilleJusqua) > new Date()) {
    const remaining = Math.ceil((new Date(user.verrouilleJusqua).getTime() - Date.now()) / 60000);
    res.status(423).json({ error: `Compte verrouille. Reessayez dans ${remaining} minute(s).` });
    return;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);

  if (!isValid) {
    const newAttempts = user.tentativesEchouees + 1;
    const updateData: Record<string, any> = { tentativesEchouees: newAttempts };

    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      updateData.verrouilleJusqua = new Date(Date.now() + LOCKOUT_DURATION_MS);
    }

    await db.update(usersTable).set(updateData).where(eq(usersTable.id, user.id));
    res.status(401).json({ error: "Identifiants invalides." });
    return;
  }

  await db.update(usersTable).set({
    tentativesEchouees: 0,
    verrouilleJusqua: null,
    dernierAcces: new Date(),
  }).where(eq(usersTable.id, user.id));

  (req.session as any).userId = user.id;
  (req.session as any).userRole = user.role;
  (req.session as any).organisationId = user.organisationId;
  (req.session as any).userEmail = user.email;

  logAudit(user.id, user.email, "login", "auth", undefined, { role: user.role }, req.ip, req.get("user-agent"));

  res.json({
    id: user.id,
    email: user.email,
    nom: user.nom,
    prenom: user.prenom,
    role: user.role,
    departement: user.departement,
    organisation: user.organisation,
    organisationId: user.organisationId,
    avatar: user.avatar,
    mfaActif: user.mfaActif,
  });
});

router.post("/auth/logout", (req: Request, res: Response): void => {
  const userId = (req.session as any)?.userId;
  const userEmail = (req.session as any)?.userEmail;
  if (userId) logAudit(userId, userEmail, "logout", "auth");
  res.clearCookie("adb.sid", { path: "/" });
  if (req.session) {
    req.session.destroy(() => {
      res.json({ message: "Deconnecte avec succes." });
    });
  } else {
    res.json({ message: "Deconnecte avec succes." });
  }
});

router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;

  if (!userId) {
    res.status(401).json({ error: "Non authentifie." });
    return;
  }

  const [user] = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    nom: usersTable.nom,
    prenom: usersTable.prenom,
    role: usersTable.role,
    departement: usersTable.departement,
    organisation: usersTable.organisation,
    organisationId: usersTable.organisationId,
    telephone: usersTable.telephone,
    avatar: usersTable.avatar,
    mfaActif: usersTable.mfaActif,
    actif: usersTable.actif,
    dernierAcces: usersTable.dernierAcces,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.id, userId));

  if (!user || !user.actif) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Session invalide." });
    return;
  }

  res.json(user);
});

router.post("/auth/change-password", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Mot de passe actuel et nouveau mot de passe sont obligatoires." });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ error: "Le nouveau mot de passe doit contenir au moins 8 caracteres." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(401).json({ error: "Utilisateur non trouve." }); return; }

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) { res.status(401).json({ error: "Mot de passe actuel incorrect." }); return; }

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db.update(usersTable).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(usersTable.id, userId));

  res.json({ message: "Mot de passe modifie avec succes." });
});

router.get("/auth/users", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;

  if (!userId || (userRole !== "super_admin" && userRole !== "administrateur")) {
    res.status(403).json({ error: "Acces interdit." });
    return;
  }

  const conditions = [];
  if (organisationId) {
    conditions.push(eq(usersTable.organisationId, organisationId));
  }

  const users = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    nom: usersTable.nom,
    prenom: usersTable.prenom,
    role: usersTable.role,
    departement: usersTable.departement,
    organisation: usersTable.organisation,
    organisationId: usersTable.organisationId,
    actif: usersTable.actif,
    mfaActif: usersTable.mfaActif,
    dernierAcces: usersTable.dernierAcces,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(conditions.length > 0 ? and(...conditions) : undefined);

  res.json({ users, total: users.length });
});

router.post("/auth/users", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Seuls les administrateurs peuvent creer des utilisateurs." });
    return;
  }

  const { email, password, nom, prenom, role, departement, organisation, telephone } = req.body;

  if (!email || !password || !nom || !prenom) {
    res.status(400).json({ error: "Email, mot de passe, nom et prenom sont obligatoires." });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caracteres." });
    return;
  }

  const validRoles = ["super_admin", "administrateur", "agent", "lecture_seule"];
  if (role && !validRoles.includes(role)) {
    res.status(400).json({ error: "Role invalide." });
    return;
  }

  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
  if (existing.length > 0) {
    res.status(409).json({ error: "Un utilisateur avec cet email existe deja." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const avatar = `${(prenom as string)[0]}${(nom as string)[0]}`.toUpperCase();

  const [newUser] = await db.insert(usersTable).values({
    email: email.toLowerCase().trim(),
    passwordHash,
    nom,
    prenom,
    role: role || "agent",
    departement,
    organisation: organisation || "Agent de Bureau SAS",
    organisationId: organisationId || null,
    telephone,
    avatar,
  }).returning({
    id: usersTable.id,
    email: usersTable.email,
    nom: usersTable.nom,
    prenom: usersTable.prenom,
    role: usersTable.role,
    departement: usersTable.departement,
    organisation: usersTable.organisation,
    actif: usersTable.actif,
    createdAt: usersTable.createdAt,
  });

  res.status(201).json(newUser);
});

router.patch("/auth/users/:id", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces interdit." });
    return;
  }

  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const { nom, prenom, role, departement, organisation, telephone, actif, password } = req.body;
  const updateData: Record<string, any> = { updatedAt: new Date() };

  if (nom !== undefined) updateData.nom = nom;
  if (prenom !== undefined) updateData.prenom = prenom;
  if (role !== undefined) updateData.role = role;
  if (departement !== undefined) updateData.departement = departement;
  if (organisation !== undefined) updateData.organisation = organisation;
  if (telephone !== undefined) updateData.telephone = telephone;
  if (actif !== undefined) updateData.actif = actif;
  if (prenom && nom) updateData.avatar = `${prenom[0]}${nom[0]}`.toUpperCase();

  if (password) {
    if (password.length < 8) {
      res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caracteres." });
      return;
    }
    updateData.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  }

  const [updated] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, id)).returning({
    id: usersTable.id,
    email: usersTable.email,
    nom: usersTable.nom,
    prenom: usersTable.prenom,
    role: usersTable.role,
    actif: usersTable.actif,
  });

  if (!updated) { res.status(404).json({ error: "Utilisateur non trouve." }); return; }
  res.json(updated);
});

router.delete("/auth/users/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces interdit." });
    return;
  }

  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  if (id === userId) {
    res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte." });
    return;
  }

  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Utilisateur non trouve." }); return; }
  res.status(204).send();
});

export default router;
