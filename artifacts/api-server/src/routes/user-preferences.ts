import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, type UserPreferences, type InlineSuggestFieldFlags } from "@workspace/db";

const router: IRouter = Router();

const SUPPORTED_LANGUAGES = new Set([
  "auto",
  "francais",
  "english",
  "deutsch",
  "espanol",
  "italiano",
  "portugues",
  "nederlands",
  "turkce",
  "arabic",
]);

const INLINE_SUGGEST_FIELD_KEYS: ReadonlyArray<keyof InlineSuggestFieldFlags> = [
  "note",
  "prospect_note",
  "email_body",
  "call_note",
  "task_description",
  "message_content",
  "project_description",
  "project_note",
  "quote_comment",
  "invoice_comment",
];

function parseInlineSuggestFields(value: unknown): InlineSuggestFieldFlags | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const out: InlineSuggestFieldFlags = {};
  for (const key of INLINE_SUGGEST_FIELD_KEYS) {
    if (key in src) {
      const v = src[key];
      if (typeof v !== "boolean") return null;
      out[key] = v;
    }
  }
  return out;
}

function parsePreferencesPatch(body: unknown): UserPreferences | null {
  if (!body || typeof body !== "object") return null;
  const out: UserPreferences = {};
  const src = body as Record<string, unknown>;
  if ("inlineSuggestEnabled" in src) {
    if (typeof src.inlineSuggestEnabled !== "boolean") return null;
    out.inlineSuggestEnabled = src.inlineSuggestEnabled;
  }
  if ("inlineSuggestLanguage" in src) {
    if (typeof src.inlineSuggestLanguage !== "string") return null;
    const v = src.inlineSuggestLanguage.trim().toLowerCase();
    if (!SUPPORTED_LANGUAGES.has(v)) return null;
    out.inlineSuggestLanguage = v;
  }
  if ("inlineSuggestFields" in src) {
    const parsed = parseInlineSuggestFields(src.inlineSuggestFields);
    if (parsed === null) return null;
    if (parsed !== undefined) out.inlineSuggestFields = parsed;
  }
  return out;
}

function normalizeInlineSuggestFields(
  flags: InlineSuggestFieldFlags | null | undefined,
): Required<InlineSuggestFieldFlags> {
  return {
    note: flags?.note ?? true,
    prospect_note: flags?.prospect_note ?? true,
    email_body: flags?.email_body ?? true,
    call_note: flags?.call_note ?? true,
    task_description: flags?.task_description ?? true,
    message_content: flags?.message_content ?? true,
    project_description: flags?.project_description ?? true,
    project_note: flags?.project_note ?? true,
    quote_comment: flags?.quote_comment ?? true,
    invoice_comment: flags?.invoice_comment ?? true,
  };
}

function normalizePreferences(prefs: UserPreferences | null | undefined): UserPreferences {
  return {
    inlineSuggestEnabled: prefs?.inlineSuggestEnabled ?? true,
    inlineSuggestLanguage: prefs?.inlineSuggestLanguage ?? "francais",
    inlineSuggestFields: normalizeInlineSuggestFields(prefs?.inlineSuggestFields),
  };
}

router.get("/me/preferences", async (req: Request, res: Response): Promise<void> => {
  const userId = req.session?.userId;
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
  const userId = req.session?.userId;
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
    const existingPrefs = existing.preferences ?? {};
    const merged: UserPreferences = {
      ...existingPrefs,
      ...parsed,
    };
    if (parsed.inlineSuggestFields !== undefined) {
      merged.inlineSuggestFields = {
        ...(existingPrefs.inlineSuggestFields ?? {}),
        ...parsed.inlineSuggestFields,
      };
    }
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
