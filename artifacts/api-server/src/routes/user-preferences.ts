import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, type UserPreferences, type InlineSuggestFieldFlags, type WhatsAppNotificationFlags, type QuietHoursPrefs, type BadgeMuteFlags } from "@workspace/db";

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

const WHATSAPP_NOTIFICATION_KEYS: ReadonlyArray<keyof WhatsAppNotificationFlags> = [
  "task",
  "call",
  "appointment",
  "message",
];

function parseWhatsAppNotifications(value: unknown): WhatsAppNotificationFlags | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const out: WhatsAppNotificationFlags = {};
  for (const key of WHATSAPP_NOTIFICATION_KEYS) {
    if (key in src) {
      const v = src[key];
      if (typeof v !== "boolean") return null;
      out[key] = v;
    }
  }
  return out;
}

function normalizeWhatsAppNotifications(
  flags: WhatsAppNotificationFlags | null | undefined,
): Required<WhatsAppNotificationFlags> {
  return {
    task: flags?.task ?? false,
    call: flags?.call ?? false,
    appointment: flags?.appointment ?? false,
    message: flags?.message ?? false,
  };
}

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;
function isValidHHMM(value: string): boolean {
  const m = HHMM_RE.exec(value);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

function normalizeHHMM(value: string): string {
  const m = HHMM_RE.exec(value)!;
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

/**
 * Parse `quietHours`. Renvoie `undefined` si absent, `null` si invalide
 * (rejette toute la requete), sinon l'objet valide normalise.
 */
function parseQuietHours(value: unknown): QuietHoursPrefs | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const out: QuietHoursPrefs = {};
  if ("enabled" in src) {
    if (typeof src.enabled !== "boolean") return null;
    out.enabled = src.enabled;
  }
  if ("start" in src) {
    if (typeof src.start !== "string" || !isValidHHMM(src.start)) return null;
    out.start = normalizeHHMM(src.start);
  }
  if ("end" in src) {
    if (typeof src.end !== "string" || !isValidHHMM(src.end)) return null;
    out.end = normalizeHHMM(src.end);
  }
  if ("days" in src) {
    if (!Array.isArray(src.days)) return null;
    const days: number[] = [];
    for (const d of src.days) {
      if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) return null;
      if (!days.includes(d)) days.push(d);
    }
    out.days = days.sort((a, b) => a - b);
  }
  if ("timezone" in src) {
    if (typeof src.timezone !== "string") return null;
    const tz = src.timezone.trim();
    if (tz.length > 64) return null;
    out.timezone = tz;
  }
  return out;
}

function normalizeQuietHours(qh: QuietHoursPrefs | null | undefined): Required<QuietHoursPrefs> {
  return {
    enabled: qh?.enabled ?? false,
    start: qh?.start ?? "22:00",
    end: qh?.end ?? "07:00",
    days: Array.isArray(qh?.days) ? qh!.days! : [],
    timezone: qh?.timezone && qh.timezone.trim() ? qh.timezone.trim() : "Europe/Paris",
  };
}

const BADGE_MUTE_KEYS: ReadonlyArray<keyof BadgeMuteFlags> = [
  "rappel",
  "call",
  "message",
  "prospect",
  "task",
  "note",
  "agentQueue",
];

function parseMutedBadges(value: unknown): BadgeMuteFlags | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const out: BadgeMuteFlags = {};
  for (const key of BADGE_MUTE_KEYS) {
    if (key in src) {
      const v = src[key];
      if (typeof v !== "boolean") return null;
      out[key] = v;
    }
  }
  return out;
}

function normalizeMutedBadges(flags: BadgeMuteFlags | null | undefined): Required<BadgeMuteFlags> {
  return {
    rappel: flags?.rappel ?? false,
    call: flags?.call ?? false,
    message: flags?.message ?? false,
    prospect: flags?.prospect ?? false,
    task: flags?.task ?? false,
    note: flags?.note ?? false,
    agentQueue: flags?.agentQueue ?? false,
  };
}

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
  if ("whatsappNotifications" in src) {
    const parsed = parseWhatsAppNotifications(src.whatsappNotifications);
    if (parsed === null) return null;
    if (parsed !== undefined) out.whatsappNotifications = parsed;
  }
  if ("quietHours" in src) {
    const parsed = parseQuietHours(src.quietHours);
    if (parsed === null) return null;
    if (parsed !== undefined) out.quietHours = parsed;
  }
  if ("mutedBadges" in src) {
    const parsed = parseMutedBadges(src.mutedBadges);
    if (parsed === null) return null;
    if (parsed !== undefined) out.mutedBadges = parsed;
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
    whatsappNotifications: normalizeWhatsAppNotifications(prefs?.whatsappNotifications),
    quietHours: normalizeQuietHours(prefs?.quietHours),
    mutedBadges: normalizeMutedBadges(prefs?.mutedBadges),
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
    if (parsed.whatsappNotifications !== undefined) {
      merged.whatsappNotifications = {
        ...(existingPrefs.whatsappNotifications ?? {}),
        ...parsed.whatsappNotifications,
      };
    }
    if (parsed.quietHours !== undefined) {
      merged.quietHours = {
        ...(existingPrefs.quietHours ?? {}),
        ...parsed.quietHours,
      };
    }
    if (parsed.mutedBadges !== undefined) {
      merged.mutedBadges = {
        ...(existingPrefs.mutedBadges ?? {}),
        ...parsed.mutedBadges,
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
