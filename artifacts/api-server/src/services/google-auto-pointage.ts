import { db, googleOAuthTokensTable, checkinsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getCalendarForUser } from "../lib/google-auth";
import { withDbRetry } from "../lib/db-retry";
import { withHeartbeat } from "./health-agents";
import { CRON_LOCK_NAMESPACE, tryWithLock } from "../lib/cron-lock";

/** Ce que rend une synchronisation pour un utilisateur. */
type ResultatSync = { imported: number; skipped: number; errors: number };

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const SYNC_TAG = "[google-auto]";

const FUSEAU_PAR_DEFAUT = "Europe/Paris";

/**
 * Decalage entre l'heure murale d'un fuseau et l'instant reel, en ms.
 */
function decalageMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const { type, value } of dtf.formatToParts(instant)) p[type] = value;
  const murale = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return murale - (instant.getTime() - instant.getMilliseconds());
}

/** Instant UTC correspondant a une heure murale donnee dans un fuseau. */
function instantDe(
  y: number, mo: number, d: number, h: number, mi: number, sec: number, ms: number,
  timeZone: string,
): Date {
  const cible = Date.UTC(y, mo - 1, d, h, mi, sec, ms);
  let t = cible;
  // Deux passes suffisent : la premiere corrige le decalage, la seconde le
  // reevalue au bon instant (indispensable les jours de bascule d'heure).
  for (let i = 0; i < 2; i++) t = cible - decalageMs(new Date(t), timeZone);
  return new Date(t);
}

/**
 * Bornes de la journee EN COURS dans le fuseau de l'agenda.
 *
 * LE DEFAUT CORRIGE (mesure le 16/09)
 *
 * Ces bornes etaient calculees ainsi :
 *
 *     const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
 *     const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
 *
 * `setHours` travaille dans le fuseau du SERVEUR. Sur Cloud Run, c'est UTC —
 * alors que le fuseau de l'agenda etait lu juste apres, dans
 * `calendarTimeZone`, et transmis a l'API Google. La fenetre interrogee et
 * les evenements rendus n'etaient donc pas dans le meme referentiel.
 *
 * En ete a Paris (UTC+2), « aujourd'hui » couvrait en realite de 02h00
 * aujourd'hui a 01h59 demain : les evenements de 00h00 a 02h00 du jour
 * etaient perdus, et ceux du lendemain matin comptes dans la journee.
 *
 * Les memes bornes servent a la requete anti-doublon sur `checkInAt` : une
 * fenetre decalee pouvait donc aussi manquer le pointage existant et en creer
 * un second pour la meme journee.
 *
 * C'est la meme famille que #161, corrige le meme jour dans la
 * synchronisation manuelle (`google-calendar-sync.ts`) : la regle n'avait ete
 * appliquee que d'un cote.
 */
export function bornesDuJourLocal(
  now: Date,
  timeZone: string | null | undefined,
): { debut: Date; fin: Date; fuseau: string } {
  const essayer = (tz: string) => {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const [y, mo, d] = f.format(now).split("-").map(Number);
    return {
      debut: instantDe(y, mo, d, 0, 0, 0, 0, tz),
      fin: instantDe(y, mo, d, 23, 59, 59, 999, tz),
      fuseau: tz,
    };
  };
  try {
    return essayer(timeZone || FUSEAU_PAR_DEFAUT);
  } catch {
    // Un fuseau illisible ne doit pas faire retomber sur UTC : le produit
    // s'adresse a des PME francaises, et un repli UTC deplacerait la journee
    // d'une a deux heures sans aucune erreur visible.
    return essayer(FUSEAU_PAR_DEFAUT);
  }
}

export function startGoogleAutoPointage() {
  if (intervalHandle) return;

  // BYOC : les identifiants OAuth sont resolus PAR ORGANISATION au runtime
  // (avec fallback env). On demarre donc toujours le scheduler ; chaque token
  // sans identifiants resolvables est simplement ignore dans doSync.
  logger.info("[GoogleAutoPointage] Demarrage - Intervalle: 30min (identifiants par organisation)");

  setTimeout(() => runAutoSync().catch(err => logger.error({ err: err }, "[GoogleAutoPointage] Erreur initiale:")), 10000);

  // `withHeartbeat` inscrit la tache au registre lu par le declencheur
  // externe (/api/cron/tick). Sans elle, avec min-instances=0, cette boucle
  // ne tournait que tant qu une instance restait eveillee par du trafic.
  intervalHandle = setInterval(withHeartbeat("google-auto-pointage", SYNC_INTERVAL_MS, runAutoSync), SYNC_INTERVAL_MS);

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
      // Un verrou par UTILISATEUR, parce que c'est par utilisateur qu'on
      // ecrit un pointage.
      //
      // `syncUserToday` cherche un pointage du jour, n'en trouve pas, puis
      // insere: un SELECT puis un INSERT, sans verrou et sans contrainte
      // d'unicite pour rattraper. Le garde `isRunning` ci-dessus est une
      // variable de module, donc un garde PAR PROCESSUS. Avec maxScale=3,
      // trois instances chaudes tiquent ensemble, les trois lisent « aucun
      // pointage » et les trois inserent.
      //
      // Le resultat n'est pas cosmetique: deux lignes pour le meme salarie le
      // meme jour, donc des heures comptees deux fois dans le suivi du temps
      // de travail — celui qui sert a la paie. C'est exactement le cas que
      // `lib/cron-lock.ts` decrit dans son en-tete, et que neuf autres crons
      // de ce depot traitent deja ainsi.
      const result = await verrouUtilisateur(token.userId, () => syncUserToday(token));
      totalImported += result.imported;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
    } catch (err: any) {
      totalErrors++;
      logger.error({ err: err }, `[GoogleAutoPointage] Erreur user ${token.userId}:`);
    }
  }

  if (totalImported > 0 || totalErrors > 0) {
    logger.info(`[GoogleAutoPointage] Sync termine: ${totalImported} importe(s), ${totalSkipped} ignore(s), ${totalErrors} erreur(s)`);
  }
}

/**
 * Execute `fn` sous le verrou de cet utilisateur, ou renonce au cycle.
 *
 * `tryWithLock` rend `false` quand le verrou est deja pris ailleurs: on saute,
 * sans compter d'erreur. Un cycle saute est sans consequence — le suivant
 * arrive dans quinze minutes, et le pointage porte sur la journee entiere.
 */
async function verrouUtilisateur(
  userId: number,
  fn: () => Promise<ResultatSync>,
): Promise<ResultatSync> {
  let resultat: ResultatSync = { imported: 0, skipped: 0, errors: 0 };
  const obtenu = await tryWithLock(CRON_LOCK_NAMESPACE.googleAutoPointage, userId, async () => {
    resultat = await fn();
  });
  if (!obtenu) {
    logger.info({ userId }, "[GoogleAutoPointage] Verrou deja pris, cycle saute pour cet utilisateur.");
    resultat = { imported: 0, skipped: 1, errors: 0 };
  }
  return resultat;
}

async function syncUserToday(token: {
  tokenId: number;
  userId: number;
  accessToken: string;
  refreshToken: string | null;
  scope: string;
  expiresAt: Date | null;
  organisationId: number | null;
}): Promise<ResultatSync> {
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

  let calendarTimeZone = FUSEAU_PAR_DEFAUT;
  try {
    const calInfo = await calendar.calendars.get({ calendarId: "primary" });
    calendarTimeZone = calInfo.data.timeZone || FUSEAU_PAR_DEFAUT;
  } catch (err: any) {
    logger.warn({ err: err }, `[GoogleAutoPointage] Calendrier inaccessible user ${token.userId}:`);
    result.errors++;
    return result;
  }

  // Les bornes ne peuvent etre calculees qu'APRES la lecture du fuseau de
  // l'agenda : c'est lui qui definit ce que « aujourd'hui » veut dire pour ce
  // salarie, pas le fuseau du serveur.
  const { debut: todayStart, fin: todayEnd } = bornesDuJourLocal(now, calendarTimeZone);

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
    logger.warn({ err: err }, `[GoogleAutoPointage] Evenements inaccessibles user ${token.userId}:`);
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
    logger.error({ err: err }, `[GoogleAutoPointage] Erreur creation pointage user ${token.userId}:`);
  }

  return result;
}
