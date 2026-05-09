import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, type UserPreferences } from "@workspace/db";

const router: IRouter = Router();

function parsePreferencesPatch(body: unknown): UserPreferences | null {
  if (!body || typeof body !== "object") return null;
  const out: UserPreferences = {};
  const src = body as Record<string, unknown>;
  if ("inlineSuggestEnabled" in src) {
    if (typeof src.inlineSuggestEnabled !== "boolean") return null;
    out.inlineSuggestEnabled = src.inlineSuggestEnabled;
  }
  return out;
}

function normalizePreferences(prefs: UserPreferences | null | undefined): UserPreferences {
  return {
    inlineSuggestEnabled: prefs?.inlineSuggestEnabled ?? true,
  };
}

router.get("/me/preferences", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Non authentifie." });
    return;
  }
  try {
    const [user] = await db
      .select({ preferences: usersTable.preferences })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "Utilisateur introuvable." });
      return;
    }
    res.json(normalizePreferences(user.preferences));
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation preferences utilisateur");
    res.status(500).json({ error: "Erreur lors de la recuperation des preferences." });
  }
});

router.patch("/me/preferences", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Non authentifie." });
    return;
  }
  const parsed = parsePreferencesPatch(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Donnees de preferences invalides." });
    return;
  }
  try {
    const [existing] = await db
      .select({ preferences: usersTable.preferences })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!existing) {
      res.status(404).json({ error: "Utilisateur introuvable." });
      return;
    }
    const merged: UserPreferences = {
      ...(existing.preferences ?? {}),
      ...parsed,
    };
    await db
      .update(usersTable)
      .set({ preferences: merged, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
    res.json(normalizePreferences(merged));
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour preferences utilisateur");
    res.status(500).json({ error: "Erreur lors de la mise a jour des preferences." });
  }
});

export default router;
