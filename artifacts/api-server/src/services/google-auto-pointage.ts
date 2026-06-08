import { db, googleOAuthTokensTable, checkinsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getCalendarForUser } from "../lib/google-auth";
import { withDbRetry } from "../lib/db-retry";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const SYNC_TAG = "[google-auto]";

export function startGoogleAutoPointage() {
  if (intervalHandle) return;

  // BYOC : les identifiants OAuth sont resolus PAR ORGANISATION au runtime
  // (avec fallback env). On demarre donc toujours le scheduler ; chaque token
  // sans identifiants resolvables est simplement ignore dans doSync.
  logger.info("[GoogleAutoPointage] Demarrage - Intervalle: 30min (identifiants par organisation)");

  setTimeout(() => runAutoSync().catch(err => logger.error({ err: err.message }, "[GoogleAutoPointage] Erreur initiale:")), 10000);

  intervalHandle = setInterval(() => {
    runAutoSync().catch(err => logger.error({ err: err.message }, "[GoogleAutoPointage] Erreur periodique:"));
  }, SYNC_INTERVAL_MS);

  const shutdown = () => {
    stopGoogleAutoPointage();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function stopGoogleAutoPointage() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info("[GoogleAutoPointage] Arrete.");
  }
}

async function runAutoSync() {
  if (isRunning) {
    logger.info("[GoogleAutoPointage] Sync deja en cours, ignore.");
    return;
  }

  isRunning = true;
  try {
    await doSync();
  } finally {
    isRunning = false;
  }
}

async function doSync() {
  const allTokens = await withDbRetry(
    () => db.select({
      tokenId: googleOAuthTokensTable.id,
      userId: googleOAuthTokensTable.userId,
      accessToken: googleOAuthTokensTable.accessToken,
      refreshToken: googleOAuthTokensTable.refreshToken,
      scope: googleOAuthTokensTable.scope,
      expiresAt: googleOAuthTokensTable.expiresAt,
      organisationId: googleOAuthTokensTable.organisationId,
    }).from(googleOAuthTokensTable),
    { label: "google-auto-pointage:all-tokens" },
  );

  if (allTokens.length === 0) return;

  const calendarTokens = allTokens.filter(t =>
    t.scope && t.scope.includes("calendar")
  );

  if (calendarTokens.length === 0) return;

  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const token of calendarTokens) {
    try {
      const result = await syncUserToday(token);
      totalImported += result.imported;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
    } catch (err: any) {
      totalErrors++;
      logger.error({ err: err.message }, `[GoogleAutoPointage] Erreur user ${token.userId}:`);
    }
  }

  if (totalImported > 0 || totalErrors > 0) {
    logger.info(`[GoogleAutoPointage] Sync termine: ${totalImported} importe(s), ${totalSkipped} ignore(s), ${totalErrors} erreur(s)`);
  }
}

async function syncUserToday(token: {
  tokenId: number;
  userId: number;
  accessToken: string;
  refreshToken: string | null;
  scope: string;
  expiresAt: Date | null;
  organisationId: number | null;
}): Promise<{ imported: number; skipped: number; errors: number }> {
  const result = { imported: 0, skipped: 0, errors: 0 };

  const [user] = await withDbRetry(
    () => db.select({
      id: usersTable.id,
      prenom: usersTable.prenom,
      nom: usersTable.nom,
      role: usersTable.role,
      organisationId: usersTable.organisationId,
      actif: usersTable.actif,
    }).from(usersTable).where(eq(usersTable.id, token.userId)).limit(1),
    { label: "google-auto-pointage:user" },
  );

  if (!user || !user.organisationId || !user.actif) return result;

  // Client Calendar pret a l'emploi via la couche centralisee (lib/google-auth) :
  // dechiffrement des jetons + rafraichissement automatique persiste sont geres
  // la-bas — plus de bloc "expiresAt + refreshAccessToken + UPDATE" duplique ici.
  const calendar = await getCalendarForUser(token.userId);
  if (!calendar) return result;

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  let calendarTimeZone = "Europe/Paris";
  try {
    const calInfo = await calendar.calendars.get({ calendarId: "primary" });
    calendarTimeZone = calInfo.data.timeZone || "Europe/Paris";
  } catch (err: any) {
    logger.warn({ err: err.message }, `[GoogleAutoPointage] Calendrier inaccessible user ${token.userId}:`);
    result.errors++;
    return result;
  }

  let allEvents: any[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const response = await calendar.events.list({
        calendarId: "primary",
        timeMin: todayStart.toISOString(),
        timeMax: todayEnd.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 100,
        pageToken,
        timeZone: calendarTimeZone,
      });
      const events = response.data.items || [];
      allEvents = allEvents.concat(events);
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
  } catch (err: any) {
    logger.warn({ err: err.message }, `[GoogleAutoPointage] Evenements inaccessibles user ${token.userId}:`);
    result.errors++;
    return result;
  }

  const workEvents = allEvents.filter(event => {
    if (!event.start?.dateTime || !event.end?.dateTime) return false;
    if (event.status === "cancelled") return false;
    return true;
  });

  if (workEvents.length === 0) return result;

  const pastEvents = workEvents.filter(e => new Date(e.end.dateTime) <= now);
  if (pastEvents.length === 0) return result;

  const employeeName = `${user.prenom} ${user.nom}`;
  const organisationId = user.organisationId;

  const existing = await withDbRetry(
    () => db.select({ id: checkinsTable.id, notes: checkinsTable.notes })
      .from(checkinsTable)
      .where(and(
        eq(checkinsTable.organisationId, organisationId),
        eq(checkinsTable.employeeName, employeeName),
        gte(checkinsTable.checkInAt, todayStart),
        lte(checkinsTable.checkInAt, todayEnd),
        // Anti-duplication: ignorer si un pointage Google existe deja pour ce
        // jour, qu'il vienne de l'auto-sync ([google-auto]) OU d'un import manuel
        // depuis l'agenda ([google-sync], cf. google-calendar-sync.ts). Sans le
        // second tag, un pointage importe manuellement aujourd'hui ne serait pas
        // detecte et l'auto-sync creerait une ligne en double pour les memes
        // evenements.
        sql`(${checkinsTable.notes} LIKE '%[google-auto]%' OR ${checkinsTable.notes} LIKE '%[google-sync]%')`,
      ))
      .limit(1),
    { label: "google-auto-pointage:existing-checkin" },
  );

  if (existing.length > 0) {
    result.skipped++;
    return result;
  }

  const firstStart = pastEvents.reduce((min, e) => {
    const s = new Date(e.start.dateTime);
    return s < min ? s : min;
  }, new Date(pastEvents[0].start.dateTime));

  const lastEnd = pastEvents.reduce((max, e) => {
    const end = new Date(e.end.dateTime);
    return end > max ? end : max;
  }, new Date(pastEvents[0].end.dateTime));

  const totalMs = lastEnd.getTime() - firstStart.getTime();
  const totalMinutes = Math.max(0, Math.round(totalMs / 60000));

  const notesText = `${SYNC_TAG} ${pastEvents.length} evenement(s) synchronise(s) depuis Google Agenda`;

  try {
    await db.insert(checkinsTable).values({
      organisationId,
      employeeName,
      employeeRole: user.role,
      type: "distance",
      status: "termine",
      location: "Google Workspace",
      notes: notesText,
      checkInAt: firstStart,
      checkOutAt: lastEnd,
      breakMinutes: 0,
      totalMinutes,
    });
    result.imported++;
  } catch (err: any) {
    result.errors++;
    logger.error({ err: err.message }, `[GoogleAutoPointage] Erreur creation pointage user ${token.userId}:`);
  }

  return result;
}
