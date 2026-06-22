import { db, calendarEventsTable, organisationsTable, organisationClosuresTable } from "@workspace/db";
import { and, eq, lt, gt, ne } from "drizzle-orm";
import { getCalendarForUser } from "../lib/google-auth";
import { logger } from "../lib/logger";

/**
 * Service de disponibilites — calcule les creneaux REELLEMENT libres a partir
 * des horaires d'ouverture de l'organisation et des evenements deja planifies
 * (agenda local + agenda Google en lecture, best-effort).
 *
 * La logique de chevauchement est identique a celle du detecteur
 * `calendar_conflict` (proactive-engine) et du voice receptionist:
 *   chevauchement <=> aStart < bEnd && bStart < aEnd
 * Deux creneaux qui se touchent bord a bord (fin == debut) NE chevauchent PAS.
 *
 * Les fermetures exceptionnelles (jours feries, conges, fermetures ponctuelles)
 * sont chargees depuis `organisation_closures` et font sauter les journees
 * concernees dans la grille de creneaux. `isSlotFree` reflechit egalement les
 * fermetures pour empecher toute confirmation sur un jour ferme.
 */

export interface TimeSlot {
  start: string; // ISO 8601 (UTC)
  end: string; // ISO 8601 (UTC)
}

interface BusyInterval {
  start: number; // epoch ms
  end: number; // epoch ms
}

export interface WorkingHoursConfig {
  workingDays: number[]; // ISO weekday numbers 1=lundi .. 7=dimanche
  startMinutes: number; // minutes depuis minuit (heure locale)
  endMinutes: number;
  timezone: string; // IANA
  defaultDurationMinutes: number;
}

const DEFAULT_CONFIG: WorkingHoursConfig = {
  workingDays: [1, 2, 3, 4, 5],
  startMinutes: 9 * 60,
  endMinutes: 18 * 60,
  timezone: "Europe/Paris",
  defaultDurationMinutes: 30,
};

function parseHHMM(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return fallback;
  return h * 60 + min;
}

function parseWorkingDays(value: string | null | undefined): number[] {
  if (!value) return DEFAULT_CONFIG.workingDays;
  const days = value
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return days.length > 0 ? Array.from(new Set(days)) : DEFAULT_CONFIG.workingDays;
}

/** Charge la configuration d'horaires d'ouverture d'une organisation. */
export async function getWorkingHoursConfig(orgId: number): Promise<WorkingHoursConfig> {
  const [org] = await db
    .select({
      workingDays: organisationsTable.workingDays,
      workingHoursStart: organisationsTable.workingHoursStart,
      workingHoursEnd: organisationsTable.workingHoursEnd,
      appointmentTimezone: organisationsTable.appointmentTimezone,
      appointmentDurationMinutes: organisationsTable.appointmentDurationMinutes,
    })
    .from(organisationsTable)
    .where(eq(organisationsTable.id, orgId))
    .limit(1);
  if (!org) return { ...DEFAULT_CONFIG };
  const startMinutes = parseHHMM(org.workingHoursStart, DEFAULT_CONFIG.startMinutes);
  let endMinutes = parseHHMM(org.workingHoursEnd, DEFAULT_CONFIG.endMinutes);
  if (endMinutes <= startMinutes) endMinutes = DEFAULT_CONFIG.endMinutes;
  return {
    workingDays: parseWorkingDays(org.workingDays),
    startMinutes,
    endMinutes,
    timezone: org.appointmentTimezone || DEFAULT_CONFIG.timezone,
    defaultDurationMinutes:
      org.appointmentDurationMinutes && org.appointmentDurationMinutes > 0
        ? org.appointmentDurationMinutes
        : DEFAULT_CONFIG.defaultDurationMinutes,
  };
}

// --- Conversions de fuseau horaire ----------------------------------------
// On evite toute dependance lourde (luxon/moment) en s'appuyant sur
// Intl.DateTimeFormat pour obtenir le decalage d'un fuseau a un instant donne.

/** Decalage (minutes) tel que: heure_locale = heure_utc + offset. */
function tzOffsetMinutes(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  let hour = map.hour;
  if (hour === 24) hour = 0; // certains environnements rendent "24" a minuit
  const asUTC = Date.UTC(map.year, (map.month ?? 1) - 1, map.day, hour, map.minute, map.second);
  return Math.round((asUTC - instant.getTime()) / 60000);
}

/** Convertit une heure murale (dans `tz`) en instant UTC. Gere les bascules DST. */
function wallClockToUtc(y: number, mo: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const offset1 = tzOffsetMinutes(new Date(guess), tz);
  let utc = guess - offset1 * 60000;
  const offset2 = tzOffsetMinutes(new Date(utc), tz);
  if (offset2 !== offset1) utc = guess - offset2 * 60000;
  return new Date(utc);
}

/** Renvoie l'annee/mois/jour CALENDAIRES (dans `tz`) d'un instant donne. */
function tzDateParts(instant: Date, tz: string): { y: number; mo: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  return { y: map.year, mo: map.month, d: map.day };
}

/** Renvoie la chaine YYYY-MM-DD (dans `tz`) d'un instant donne. */
function tzDateString(instant: Date, tz: string): string {
  const { y, mo, d } = tzDateParts(instant, tz);
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Jour ISO (1=lundi .. 7=dimanche) d'une date calendaire. */
function isoWeekday(y: number, mo: number, d: number): number {
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0=dim .. 6=sam
  return dow === 0 ? 7 : dow;
}

function overlaps(aStart: number, aEnd: number, b: BusyInterval): boolean {
  return aStart < b.end && b.start < aEnd;
}

// --- Fermetures exceptionnelles -------------------------------------------

interface ClosureRange {
  dateStart: string; // YYYY-MM-DD
  dateEnd: string;   // YYYY-MM-DD inclusive
}

/**
 * Charge les fermetures exceptionnelles de l'organisation (jours feries,
 * conges, fermetures ponctuelles). Toute erreur renvoie un tableau vide
 * (best-effort: une fermeture non chargee se traduit par des creneaux
 * proposes a tort, pas par une panne totale).
 */
async function loadClosures(orgId: number): Promise<ClosureRange[]> {
  try {
    const rows = await db
      .select({
        dateStart: organisationClosuresTable.dateStart,
        dateEnd: organisationClosuresTable.dateEnd,
      })
      .from(organisationClosuresTable)
      .where(eq(organisationClosuresTable.organisationId, orgId));
    return rows;
  } catch (err) {
    logger.warn({ err, orgId }, "[availability] chargement des fermetures echoue — fermetures ignorees");
    return [];
  }
}

/** Renvoie true si la date YYYY-MM-DD est couverte par au moins une fermeture. */
function isDateClosed(dateStr: string, closures: ClosureRange[]): boolean {
  return closures.some((c) => dateStr >= c.dateStart && dateStr <= c.dateEnd);
}

// --- Recuperation des intervalles occupes ---------------------------------

/** Evenements locaux (agenda interne) qui chevauchent [from, to]. */
async function localBusyIntervals(orgId: number, from: Date, to: Date): Promise<BusyInterval[]> {
  const rows = await db
    .select({
      startDate: calendarEventsTable.startDate,
      endDate: calendarEventsTable.endDate,
      allDay: calendarEventsTable.allDay,
      status: calendarEventsTable.status,
    })
    .from(calendarEventsTable)
    .where(
      and(
        eq(calendarEventsTable.organisationId, orgId),
        lt(calendarEventsTable.startDate, to),
        gt(calendarEventsTable.endDate, from),
        ne(calendarEventsTable.status, "annule"),
      ),
    );
  const intervals: BusyInterval[] = [];
  for (const r of rows) {
    if (r.allDay) continue; // les evenements "journee entiere" ne bloquent pas les creneaux horaires
    const s = r.startDate.getTime();
    const e = r.endDate.getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) intervals.push({ start: s, end: e });
  }
  return intervals;
}

/** Intervalles occupes Google (freebusy), best-effort et borne en latence. */
async function googleBusyIntervals(userId: number, from: Date, to: Date): Promise<BusyInterval[]> {
  try {
    const calendar = await getCalendarForUser(userId);
    if (!calendar) return [];
    const resp = await calendar.freebusy.query({
      requestBody: {
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: "primary" }],
      },
    });
    const busy = resp.data.calendars?.primary?.busy ?? [];
    const intervals: BusyInterval[] = [];
    for (const b of busy) {
      if (!b.start || !b.end) continue;
      const s = new Date(b.start).getTime();
      const e = new Date(b.end).getTime();
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) intervals.push({ start: s, end: e });
    }
    return intervals;
  } catch (err) {
    logger.warn({ err, userId }, "[availability] freebusy Google indisponible — agenda local uniquement");
    return [];
  }
}

// --- API publique ----------------------------------------------------------

export interface ComputeFreeSlotsInput {
  orgId: number;
  userId?: number | null; // si fourni et connecte: inclut l'agenda Google
  from: Date;
  to: Date;
  durationMinutes?: number;
  /** Pas de la grille (minutes). Defaut = duree du creneau. */
  stepMinutes?: number;
  /** Nombre maximum de creneaux retournes. Defaut 3. */
  limit?: number;
  /** Marge minimale (minutes) entre maintenant et le premier creneau. Defaut 60. */
  leadMinutes?: number;
}

/**
 * Calcule les creneaux libres dans [from, to], au sein des horaires d'ouverture,
 * en excluant tout chevauchement avec un evenement existant et en sautant les
 * jours fermes (fermetures exceptionnelles de l'organisation).
 */
export async function computeFreeSlots(input: ComputeFreeSlotsInput): Promise<TimeSlot[]> {
  const cfg = await getWorkingHoursConfig(input.orgId);
  const duration = input.durationMinutes && input.durationMinutes > 0 ? input.durationMinutes : cfg.defaultDurationMinutes;
  const step = input.stepMinutes && input.stepMinutes > 0 ? input.stepMinutes : duration;
  const limit = input.limit && input.limit > 0 ? input.limit : 3;
  const lead = input.leadMinutes ?? 60;

  const now = Date.now();
  const earliest = now + lead * 60000;
  // On ne genere jamais de creneau dans le passe (ni avant la marge de lead).
  let windowFrom = input.from.getTime();
  if (windowFrom < earliest) windowFrom = earliest;
  const windowTo = input.to.getTime();
  if (windowTo <= windowFrom) return [];

  const from = new Date(windowFrom);
  const to = new Date(windowTo);

  const [local, google, closures] = await Promise.all([
    localBusyIntervals(input.orgId, from, to),
    input.userId ? googleBusyIntervals(input.userId, from, to) : Promise.resolve([] as BusyInterval[]),
    loadClosures(input.orgId),
  ]);
  const busy = [...local, ...google];

  const slots: TimeSlot[] = [];
  const workingDays = new Set(cfg.workingDays);

  // On itere jour calendaire par jour calendaire dans le fuseau de l'org.
  const seenDays = new Set<string>();
  const MAX_DAYS = 62; // garde-fou
  for (let i = 0; i < MAX_DAYS && slots.length < limit; i++) {
    const dayInstant = new Date(windowFrom + i * 24 * 60 * 60 * 1000);
    if (dayInstant.getTime() > windowTo) break;
    const { y, mo, d } = tzDateParts(dayInstant, cfg.timezone);
    const key = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (seenDays.has(key)) continue;
    seenDays.add(key);
    if (!workingDays.has(isoWeekday(y, mo, d))) continue;
    // Sauter les jours couverts par une fermeture exceptionnelle.
    if (isDateClosed(key, closures)) continue;

    const dayStart = wallClockToUtc(y, mo, d, Math.floor(cfg.startMinutes / 60), cfg.startMinutes % 60, cfg.timezone);
    const dayEnd = wallClockToUtc(y, mo, d, Math.floor(cfg.endMinutes / 60), cfg.endMinutes % 60, cfg.timezone);

    for (
      let slotStart = dayStart.getTime();
      slotStart + duration * 60000 <= dayEnd.getTime() && slots.length < limit;
      slotStart += step * 60000
    ) {
      const slotEnd = slotStart + duration * 60000;
      if (slotStart < windowFrom || slotEnd > windowTo) continue;
      if (busy.some((b) => overlaps(slotStart, slotEnd, b))) continue;
      slots.push({ start: new Date(slotStart).toISOString(), end: new Date(slotEnd).toISOString() });
    }
  }

  return slots;
}

export interface IsSlotWithinWorkingHoursInput {
  orgId: number;
  start: Date;
  end: Date;
  /** Marge minimale (minutes) entre maintenant et le debut du creneau. Defaut 60. */
  leadMinutes?: number;
}

/**
 * Verifie qu'un creneau respecte les contraintes metier de l'organisation:
 *   1. Debut au moins `leadMinutes` dans le futur (anti-spam / impossible).
 *   2. Jour ouvrable configurer.
 *   3. Debut >= heure d'ouverture ET fin <= heure de fermeture (dans le fuseau
 *      de l'org).
 *
 * NE verifie PAS les chevauchements (utiliser `isSlotFree` pour ca).
 * Utilise avant d'accepter un creneau fourni par le client (lien public).
 */
export async function isSlotWithinWorkingHours(input: IsSlotWithinWorkingHoursInput): Promise<boolean> {
  const s = input.start.getTime();
  const e = input.end.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return false;

  const lead = input.leadMinutes ?? 60;
  if (s < Date.now() + lead * 60000) return false;

  const cfg = await getWorkingHoursConfig(input.orgId);

  const { y, mo, d } = tzDateParts(input.start, cfg.timezone);
  if (!new Set(cfg.workingDays).has(isoWeekday(y, mo, d))) return false;

  const dayStart = wallClockToUtc(y, mo, d, Math.floor(cfg.startMinutes / 60), cfg.startMinutes % 60, cfg.timezone);
  const dayEnd = wallClockToUtc(y, mo, d, Math.floor(cfg.endMinutes / 60), cfg.endMinutes % 60, cfg.timezone);

  if (s < dayStart.getTime()) return false;
  if (e > dayEnd.getTime()) return false;

  return true;
}

export interface IsSlotFreeInput {
  orgId: number;
  userId?: number | null;
  start: Date;
  end: Date;
  /** Ignore cet evenement (utile lors d'une reprogrammation). */
  excludeEventId?: number;
}

/**
 * Verifie qu'un creneau precis est libre (aucun chevauchement). Utilise au moment
 * de la confirmation pour eviter toute course (double reservation).
 * Renvoie false si le jour du creneau est couvert par une fermeture exceptionnelle.
 */
export async function isSlotFree(input: IsSlotFreeInput): Promise<boolean> {
  const s = input.start.getTime();
  const e = input.end.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return false;

  // Verifier les fermetures exceptionnelles.
  const [closures, cfg] = await Promise.all([
    loadClosures(input.orgId),
    getWorkingHoursConfig(input.orgId),
  ]);
  const dateStr = tzDateString(input.start, cfg.timezone);
  if (isDateClosed(dateStr, closures)) return false;

  const local = await localBusyIntervals(input.orgId, input.start, input.end);
  // localBusyIntervals ne renvoie pas l'id; pour l'exclusion on refait une requete ciblee.
  let busy = local;
  if (input.excludeEventId) {
    const rows = await db
      .select({
        id: calendarEventsTable.id,
        startDate: calendarEventsTable.startDate,
        endDate: calendarEventsTable.endDate,
        allDay: calendarEventsTable.allDay,
        status: calendarEventsTable.status,
      })
      .from(calendarEventsTable)
      .where(
        and(
          eq(calendarEventsTable.organisationId, input.orgId),
          lt(calendarEventsTable.startDate, input.end),
          gt(calendarEventsTable.endDate, input.start),
          ne(calendarEventsTable.status, "annule"),
        ),
      );
    busy = rows
      .filter((r: typeof rows[number]) => r.id !== input.excludeEventId && !r.allDay)
      .map((r: typeof rows[number]) => ({ start: r.startDate.getTime(), end: r.endDate.getTime() }));
  }
  if (busy.some((b) => overlaps(s, e, b))) return false;

  if (input.userId) {
    const google = await googleBusyIntervals(input.userId, input.start, input.end);
    if (google.some((b) => overlaps(s, e, b))) return false;
  }
  return true;
}
