import { google } from "googleapis";
import { db, googleOAuthTokensTable, checkinsTable, platformSyncLogsTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getOrgGoogleCredentials, getGoogleRedirectUri } from "../lib/google-auth";

interface SyncResult {
  imported: number;
  skipped: number;
  errors: number;
  details: string[];
}

async function getOAuth2Client(organisationId: number | null | undefined) {
  const creds = await getOrgGoogleCredentials(organisationId, { envOnly: true });
  if (!creds) return null;
  return new google.auth.OAuth2(creds.clientId, creds.clientSecret, getGoogleRedirectUri());
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

  const tokens = await db.select().from(googleOAuthTokensTable)
    .where(eq(googleOAuthTokensTable.userId, userId));

  if (tokens.length === 0) {
    throw new Error("Aucun compte Google connecte. Connectez votre compte dans Parametres > Google Workspace.");
  }

  const token = tokens[0];
  const oauth2Client = await getOAuth2Client(token.organisationId ?? organisationId);
  if (!oauth2Client) {
    throw new Error("Google Workspace n'est pas configure. Contactez votre administrateur.");
  }

  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
  });

  if (token.expiresAt && token.expiresAt < new Date()) {
    if (!token.refreshToken) {
      throw new Error("Token Google expire. Reconnectez votre compte dans Parametres.");
    }
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await db.update(googleOAuthTokensTable)
        .set({
          accessToken: credentials.access_token!,
          expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3600000),
          updatedAt: new Date(),
        })
        .where(eq(googleOAuthTokensTable.userId, userId));
      oauth2Client.setCredentials(credentials);
    } catch {
      throw new Error("Impossible de rafraichir le token Google. Reconnectez votre compte.");
    }
  }

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

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
    platform: "google",
    serviceId: "calendar",
    action: "sync_pointage",
    status: result.errors > 0 ? "partiel" : "succes",
    details: `Synchronisation Google Agenda - Pointage: ${result.imported} importes, ${result.skipped} ignores, ${result.errors} erreurs.`,
    itemsProcessed: String(result.imported),
  });

  return result;
}
