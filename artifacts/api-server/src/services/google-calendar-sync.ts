import { db, checkinsTable, platformSyncLogsTable, calendarEventsTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getCalendarForUser } from "../lib/google-auth";

interface SyncResult {
  imported: number;
  skipped: number;
  errors: number;
  details: string[];
}

function getLocalDateKey(dateTime: string, timeZone: string | undefined): string {
  try {
    const d = new Date(dateTime);
    const tz = timeZone || "Europe/Paris";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    return parts;
  } catch {
    return new Date(dateTime).toISOString().slice(0, 10);
  }
}

function dayBounds(dayKey: string, timeZone: string): { start: Date; end: Date } {
  const base = new Date(dayKey + "T00:00:00");
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });

    const startLocal = new Date(dayKey + "T00:00:00");
    const endLocal = new Date(dayKey + "T23:59:59.999");

    const tzOffset = (date: Date) => {
      const utcStr = date.toISOString();
      const localStr = formatter.format(date);
      return date;
    };

    const dayStart = new Date(dayKey + "T00:00:00");
    const dayEnd = new Date(dayKey + "T23:59:59.999");

    return { start: dayStart, end: dayEnd };
  } catch {
    return { start: base, end: new Date(base.getTime() + 86399999) };
  }
}

export async function syncGoogleCalendarToCheckins(params: {
  userId: number;
  organisationId: number;
  dateFrom: string;
  dateTo: string;
  employeeName: string;
  employeeRole: string;
}): Promise<SyncResult> {
  const { userId, organisationId, dateFrom, dateTo, employeeName, employeeRole } = params;
  const result: SyncResult = { imported: 0, skipped: 0, errors: 0, details: [] };

  // Client Calendar pret a l'emploi via la couche centralisee (lib/google-auth) :
  // resolution des identifiants, dechiffrement des jetons, et rafraichissement
  // automatique persiste sont geres la-bas — plus de bloc "expiresAt + refresh"
  // duplique ici.
  const calendar = await getCalendarForUser(userId);
  if (!calendar) {
    throw new Error("Aucun compte Google connecte. Connectez votre compte dans Parametres > Google Workspace.");
  }

  const timeMin = new Date(dateFrom);
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(dateTo);
  timeMax.setHours(23, 59, 59, 999);

  let calendarTimeZone = "Europe/Paris";
  try {
    const calInfo = await calendar.calendars.get({ calendarId: "primary" });
    calendarTimeZone = calInfo.data.timeZone || "Europe/Paris";
  } catch (err) { logger.warn({ err: err }, "[GoogleCalendarSync] operation failed:"); }

  let allEvents: any[] = [];
  let pageToken: string | undefined;

  do {
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
      timeZone: calendarTimeZone,
    });

    const events = response.data.items || [];
    allEvents = allEvents.concat(events);
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  const workEvents = allEvents.filter(event => {
    if (!event.start?.dateTime || !event.end?.dateTime) return false;
    if (event.status === "cancelled") return false;
    return true;
  });

  if (workEvents.length === 0) {
    result.details.push("Aucun evenement avec horaires trouves dans Google Agenda pour cette periode.");
    return result;
  }

  const dayGroups: Record<string, { start: Date; end: Date; events: string[]; tz: string }> = {};

  for (const event of workEvents) {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    const eventTz = event.start.timeZone || calendarTimeZone;
    const dayKey = getLocalDateKey(event.start.dateTime, eventTz);

    if (!dayGroups[dayKey]) {
      dayGroups[dayKey] = { start, end, events: [], tz: eventTz };
    } else {
      if (start < dayGroups[dayKey].start) dayGroups[dayKey].start = start;
      if (end > dayGroups[dayKey].end) dayGroups[dayKey].end = end;
    }
    dayGroups[dayKey].events.push(event.summary || "Sans titre");
  }

  const SYNC_SOURCE_TAG = "[google-sync]";

  for (const [dayKey, group] of Object.entries(dayGroups)) {
    try {
      const dayStart = group.start;
      const dayStartFloor = new Date(dayStart);
      dayStartFloor.setHours(dayStartFloor.getHours() - 2);
      const dayEndCeil = new Date(group.end);
      dayEndCeil.setHours(dayEndCeil.getHours() + 2);

      const existing = await db.select({ id: checkinsTable.id }).from(checkinsTable).where(
        and(
          eq(checkinsTable.organisationId, organisationId),
          eq(checkinsTable.employeeName, employeeName),
          gte(checkinsTable.checkInAt, dayStartFloor),
          lte(checkinsTable.checkInAt, dayEndCeil),
        )
      ).limit(1);

      if (existing.length > 0) {
        result.skipped++;
        result.details.push(`${dayKey}: Pointage existant, ignore.`);
        continue;
      }

      const totalMs = group.end.getTime() - group.start.getTime();
      const totalMinutes = Math.max(0, Math.round(totalMs / 60000));

      const eventsSummary = group.events.slice(0, 5).join(", ");
      const notesText = `${SYNC_SOURCE_TAG} ${group.events.length} evt: ${eventsSummary}${group.events.length > 5 ? "..." : ""}`;

      await db.insert(checkinsTable).values({
        organisationId,
        employeeName,
        employeeRole,
        type: "distance",
        status: "termine",
        location: "Google Workspace",
        notes: notesText,
        checkInAt: group.start,
        checkOutAt: group.end,
        breakMinutes: 0,
        totalMinutes,
      });

      result.imported++;
      result.details.push(`${dayKey}: ${group.events.length} evenement(s), ${Math.floor(totalMinutes / 60)}h${(totalMinutes % 60).toString().padStart(2, "0")} importees.`);
    } catch (err: any) {
      result.errors++;
      result.details.push(`${dayKey}: Erreur lors de l'import.`);
      logger.error({ err: err }, `Google sync error for ${dayKey}:`);
    }
  }

  await db.insert(platformSyncLogsTable).values({
    organisationId,
    platform: "google",
    serviceId: "calendar",
    action: "sync_pointage",
    status: result.errors > 0 ? "partiel" : "succes",
    details: `Synchronisation Google Agenda - Pointage: ${result.imported} importes, ${result.skipped} ignores, ${result.errors} erreurs.`,
    itemsProcessed: String(result.imported),
  });

  return result;
}

// ---------------------------------------------------------------------------
// Mirroring des rendez-vous (calendar_events) vers Google Agenda de
// l'utilisateur assigné. Toutes les fonctions sont best-effort : elles ne
// lèvent jamais d'exception vers l'appelant et ne bloquent jamais le flux
// local. En cas d'echec Google (quota, token absent, reseau), on logue en
// warn et on renvoie null/false — le rendez-vous reste valide en local.
// ---------------------------------------------------------------------------

/**
 * Crée un événement dans Google Agenda de l'utilisateur et stocke son id
 * sur la ligne `calendar_events`. Renvoie l'id Google ou null si indisponible.
 */
export async function pushAppointmentToGoogleCalendar(params: {
  calendarEventId: number;
  userId: number;
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  location?: string | null;
}): Promise<string | null> {
  try {
    const calendar = await getCalendarForUser(params.userId);
    if (!calendar) return null;
    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: params.title,
        description: params.description ?? undefined,
        location: params.location ?? undefined,
        start: { dateTime: params.startDate.toISOString() },
        end: { dateTime: params.endDate.toISOString() },
      },
    });
    const googleEventId = res.data.id ?? null;
    if (googleEventId) {
      await db
        .update(calendarEventsTable)
        .set({ googleEventId })
        .where(eq(calendarEventsTable.id, params.calendarEventId))
        .catch((err) =>
          logger.warn({ err, calendarEventId: params.calendarEventId }, "[google-calendar-sync] persistance googleEventId echouee"),
        );
    }
    return googleEventId;
  } catch (err) {
    logger.warn({ err, userId: params.userId }, "[google-calendar-sync] pushAppointmentToGoogleCalendar echoue");
    return null;
  }
}

/**
 * Met à jour un événement existant dans Google Agenda (après reprogrammation).
 * Renvoie true si la mise à jour a réussi.
 */
export async function updateAppointmentInGoogleCalendar(params: {
  userId: number;
  googleEventId: string;
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  location?: string | null;
}): Promise<boolean> {
  try {
    const calendar = await getCalendarForUser(params.userId);
    if (!calendar) return false;
    await calendar.events.patch({
      calendarId: "primary",
      eventId: params.googleEventId,
      requestBody: {
        summary: params.title,
        description: params.description ?? undefined,
        location: params.location ?? undefined,
        start: { dateTime: params.startDate.toISOString() },
        end: { dateTime: params.endDate.toISOString() },
      },
    });
    return true;
  } catch (err) {
    logger.warn({ err, userId: params.userId, googleEventId: params.googleEventId }, "[google-calendar-sync] updateAppointmentInGoogleCalendar echoue");
    return false;
  }
}

/**
 * Supprime (annule) un événement dans Google Agenda.
 * Renvoie true si la suppression a réussi (404 = déjà supprimé, aussi true).
 */
export async function deleteAppointmentFromGoogleCalendar(params: {
  userId: number;
  googleEventId: string;
}): Promise<boolean> {
  try {
    const calendar = await getCalendarForUser(params.userId);
    if (!calendar) return false;
    await calendar.events.delete({
      calendarId: "primary",
      eventId: params.googleEventId,
    });
    return true;
  } catch (err: any) {
    // 404 = événement déjà supprimé côté Google → considéré ok.
    if (err?.code === 404 || err?.response?.status === 404) return true;
    logger.warn({ err, userId: params.userId, googleEventId: params.googleEventId }, "[google-calendar-sync] deleteAppointmentFromGoogleCalendar echoue");
    return false;
  }
}

/**
 * Lit les evenements Google Agenda de l'utilisateur sur une fenetre donnee.
 *
 * Complete la direction manquante de la synchronisation: jusqu'ici rien ne
 * REMONTAIT de Google vers l'agenda de l'application. Un rendez-vous cree
 * directement dans Google Agenda n'apparaissait donc jamais dans l'application,
 * alors que l'utilisateur venait d'y connecter son compte — l'une des premieres
 * choses qu'il verifie apres connexion.
 *
 * Renvoie un tableau vide (jamais d'exception) si le compte n'est pas connecte
 * ou si Google est indisponible: l'agenda local doit rester affichable.
 */
export async function listGoogleEvents(params: {
  userId: number;
  start: Date;
  end: Date;
  max?: number;
}): Promise<Array<{
  googleEventId: string;
  title: string;
  description: string | null;
  location: string | null;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  htmlLink: string | null;
}>> {
  try {
    const calendar = await getCalendarForUser(params.userId);
    if (!calendar) return [];

    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: params.start.toISOString(),
      timeMax: params.end.toISOString(),
      singleEvents: true,        // developpe les recurrences en occurrences
      orderBy: "startTime",
      maxResults: Math.min(params.max ?? 250, 2500),
    });

    return (res.data.items ?? [])
      .filter((ev) => ev.status !== "cancelled" && ev.id)
      .map((ev) => {
        // Un evenement "journee entiere" utilise `date` (YYYY-MM-DD) au lieu
        // de `dateTime`; sans ce cas la date serait invalide.
        const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
        const startRaw = ev.start?.dateTime ?? ev.start?.date;
        const endRaw = ev.end?.dateTime ?? ev.end?.date;
        return {
          googleEventId: ev.id!,
          title: ev.summary || "(sans titre)",
          description: ev.description ?? null,
          location: ev.location ?? null,
          startDate: startRaw ? new Date(startRaw) : new Date(),
          endDate: endRaw ? new Date(endRaw) : new Date(),
          allDay,
          htmlLink: ev.htmlLink ?? null,
        };
      })
      .filter((ev) => !isNaN(ev.startDate.getTime()) && !isNaN(ev.endDate.getTime()));
  } catch (err) {
    logger.warn({ err, userId: params.userId }, "[google-calendar-sync] listGoogleEvents echoue");
    return [];
  }
}
