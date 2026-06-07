// Heures silencieuses : determine si un instant donne tombe dans la fenetre
// "ne pas deranger" configuree par un utilisateur. Utilise pour supprimer les
// notifications push sortantes (WhatsApp) sans bloquer les autres canaux.

import type { QuietHoursPrefs } from "@workspace/db";

const DEFAULT_TIMEZONE = "Europe/Paris";

/** Parse "HH:MM" -> minutes depuis minuit, ou null si invalide. */
function parseHHMM(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/** Minutes depuis minuit + jour de la semaine (0=dimanche) dans une timezone. */
function localParts(now: Date, timezone: string): { minutes: number; weekday: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "long",
    });
    const parts = fmt.formatToParts(now);
    let hour = 0;
    let minute = 0;
    let weekday = -1;
    for (const p of parts) {
      if (p.type === "hour") hour = Number(p.value) % 24;
      else if (p.type === "minute") minute = Number(p.value);
      else if (p.type === "weekday") weekday = WEEKDAY_INDEX[p.value] ?? -1;
    }
    if (weekday < 0) return null;
    return { minutes: hour * 60 + minute, weekday };
  } catch {
    return null;
  }
}

/**
 * Retourne true si `now` tombe dans les heures silencieuses configurees.
 * Fail-open : toute config invalide -> false (on n'avale jamais une notif
 * a cause d'une config malformee).
 */
export function isWithinQuietHours(quietHours: QuietHoursPrefs | null | undefined, now: Date = new Date()): boolean {
  if (!quietHours || quietHours.enabled !== true) return false;
  const start = parseHHMM(quietHours.start);
  const end = parseHHMM(quietHours.end);
  if (start == null || end == null || start === end) return false;

  const tz = typeof quietHours.timezone === "string" && quietHours.timezone.trim()
    ? quietHours.timezone.trim()
    : DEFAULT_TIMEZONE;
  const parts = localParts(now, tz);
  if (!parts) return false;
  const { minutes, weekday } = parts;

  const days = Array.isArray(quietHours.days) ? quietHours.days : [];
  const dayActive = (d: number): boolean => days.length === 0 || days.includes(d);

  if (start < end) {
    // Fenetre dans la meme journee (ex. 12:00 -> 14:00).
    return dayActive(weekday) && minutes >= start && minutes < end;
  }
  // Fenetre de nuit (ex. 22:00 -> 07:00), rattachee au jour de DEBUT.
  if (minutes >= start) {
    return dayActive(weekday); // portion du soir : appartient a aujourd'hui
  }
  if (minutes < end) {
    const prevDay = (weekday + 6) % 7;
    return dayActive(prevDay); // portion du petit matin : appartient a hier
  }
  return false;
}
