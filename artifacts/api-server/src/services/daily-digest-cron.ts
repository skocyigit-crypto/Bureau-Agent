/**
 * Cron du digest quotidien.
 *
 * Avant: /api/daily-digest n'etait genere qu'a la demande (ouverture de
 * l'ecran mobile) — "quotidien" etait trompeur, rien ne l'envoyait
 * proactivement. Ce cron genere et EMAIL le digest une fois par jour et par
 * utilisateur actif.
 *
 * Durabilite (meme pattern que autonomous-secretary-cron.ts): le garde "une
 * fois par jour" n'est PAS en memoire — il est derive des lignes audit_logs
 * deja ecrites aujourd'hui (action `daily_digest_sent`). Un redemarrage du
 * serveur ne provoque donc jamais de double envoi.
 */
import { and, eq, gte } from "drizzle-orm";
import { db, usersTable, auditLogsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { buildDailyDigest } from "../routes/daily-digest";
import { sendEmail } from "./email";

const TICK_MS = 60 * 60 * 1000; // 1h — verifie a chaque heure si c'est l'heure d'envoi
const SEND_HOUR_UTC = 6; // ~7-8h en France selon heure d'ete/hiver
const APP_URL = process.env.PUBLIC_URL || process.env.APP_URL || "https://agentdebureau.fr";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

function todayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function digestEmailHtml(digest: Awaited<ReturnType<typeof buildDailyDigest>>): string {
  const suggestions = (digest.ai?.suggestions ?? [])
    .map((s) => `<li style="margin-bottom:8px;"><strong>${s.priorite === "haute" ? "🔴" : s.priorite === "moyenne" ? "🟡" : "🟢"}</strong> ${s.texte}</li>`)
    .join("");
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
      <div style="background:#0f1729;padding:24px 32px;">
        <h1 style="color:#fff;font-size:18px;margin:0;">Bilan du ${digest.date}</h1>
      </div>
      <div style="padding:24px 32px;">
        <p style="font-size:15px;color:#1f2937;">${digest.ai?.resume ?? `Bonjour ${digest.prenom}, voici votre bilan du jour.`}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;color:#475569;">
          <tr>
            <td style="padding:6px 0;">📞 Appels</td><td style="text-align:right;">${digest.stats.calls.total} (${digest.stats.calls.missed} manqués)</td>
          </tr>
          <tr>
            <td style="padding:6px 0;">✅ Tâches terminées</td><td style="text-align:right;">${digest.stats.tasks.completed}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;">⏰ Tâches en retard</td><td style="text-align:right;">${digest.stats.tasks.overdue}</td>
          </tr>
        </table>
        ${suggestions ? `<ul style="padding-left:18px;font-size:13px;color:#334155;">${suggestions}</ul>` : ""}
        <a href="${APP_URL}" style="display:inline-block;margin-top:16px;background:#f59e0b;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;">Ouvrir Agent de Bureau</a>
      </div>
      <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
        <p style="color:#94a3b8;font-size:11px;margin:0;">&copy; ${new Date().getFullYear()} SK GROUP - Tous droits reserves</p>
      </div>
    </div>`;
}

async function sendDigestForUser(user: { id: number; organisationId: number | null; prenom: string; email: string }): Promise<void> {
  if (!user.organisationId) return;

  const already = await withDbRetry(
    () => db.select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.userId, user.id),
        eq(auditLogsTable.action, "daily_digest_sent"),
        gte(auditLogsTable.createdAt, todayStart()),
      ))
      .limit(1),
    { label: "daily-digest-cron:already-sent" },
  );
  if (already.length > 0) return;

  const digest = await buildDailyDigest(user.id, user.organisationId, user.prenom);
  const result = await sendEmail(
    user.email,
    `Votre bilan du ${digest.date}`,
    digestEmailHtml(digest),
    digest.ai?.resume ?? `Bonjour ${user.prenom}, votre bilan du jour est disponible sur Agent de Bureau.`,
    { orgId: user.organisationId },
  );

  // On journalise meme un echec d'envoi (avec le meme runId-du-jour) pour ne
  // pas re-tenter en boucle chaque heure si le provider email est en panne —
  // le prochain jour reessaiera normalement.
  await db.insert(auditLogsTable).values({
    organisationId: user.organisationId,
    userId: user.id,
    userEmail: user.email,
    action: "daily_digest_sent",
    resource: "daily_digest",
    details: { emailSuccess: result.success, error: result.error },
  });
}

async function tick(): Promise<void> {
  if (running) return;
  const nowHourUtc = new Date().getUTCHours();
  if (nowHourUtc !== SEND_HOUR_UTC) return;
  running = true;

  try {
    const users = await withDbRetry(
      () => db.select({
        id: usersTable.id,
        organisationId: usersTable.organisationId,
        prenom: usersTable.prenom,
        email: usersTable.email,
      }).from(usersTable).where(eq(usersTable.actif, true)),
      { label: "daily-digest-cron:active-users" },
    );

    for (const user of users) {
      try {
        await sendDigestForUser(user);
      } catch (err) {
        logger.warn({ err, userId: user.id }, "[DailyDigestCron] Échec pour un utilisateur");
      }
    }
  } catch (err) {
    logger.error({ err }, "[DailyDigestCron] Erreur du cycle");
  } finally {
    running = false;
  }
}

export function startDailyDigestCron(): void {
  if (intervalHandle) return;
  logger.info("[DailyDigestCron] Digest quotidien démarré");

  setTimeout(() => { tick().catch(() => {}); }, 120 * 1000);
  intervalHandle = setInterval(() => { tick().catch(() => {}); }, TICK_MS);

  const shutdown = () => {
    if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
