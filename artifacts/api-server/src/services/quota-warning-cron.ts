import { db, organisationsTable, subscriptionsTable, callsTable, contactsTable, usersTable } from "@workspace/db";
import { and, eq, gte, isNull, lt, or, count as sqlCount } from "drizzle-orm";
import { sendEmail } from "./email";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { withHeartbeat } from "./health-agents";

const WARN_THRESHOLD = 0.8;
const COOLDOWN_HOURS = 72;
let timer: NodeJS.Timeout | null = null;

/**
 * Un seul avertissement par organisation et par fenetre, meme a trois
 * instances.
 *
 * La fenetre vivait dans une `Map` de module et l'envoi n'etait protege par
 * aucun verrou. Deux defauts cumules sur un courriel qui part chez le CLIENT :
 *
 *  - avec min-instances=0, Cloud Run recycle l'instance des que le trafic
 *    cesse. La Map repartait vide, et l'organisation a 85 % recevait l'alerte
 *    a chaque redemarrage au lieu de toutes les 72 heures ;
 *  - trois instances chaudes avaient trois Maps distinctes, donc trois
 *    courriels pour le meme tic.
 *
 * La fenetre est desormais en base (`lastQuotaWarningAt`), comme
 * `lastSecurityDigestAt` le fait deja, et l'envoi passe sous verrou.
 */
async function checkOrganisation(orgId: number, orgEmail: string | null, orgName: string, dernierAvertissement: Date | null) {
  const [sub] = await withDbRetry(
    () => db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)).limit(1),
    { label: "quota-warning:subscription" },
  );
  if (!sub || sub.status === "annulee" || sub.status === "cancelled") return;

  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

  const [usersAgg] = await withDbRetry(
    () => db.select({ c: sqlCount() }).from(usersTable).where(and(eq(usersTable.organisationId, orgId), eq(usersTable.actif, true))),
    { label: "quota-warning:users-count" },
  );
  const [contactsAgg] = await withDbRetry(
    () => db.select({ c: sqlCount() }).from(contactsTable).where(eq(contactsTable.organisationId, orgId)),
    { label: "quota-warning:contacts-count" },
  );
  const [callsAgg] = await withDbRetry(
    () => db.select({ c: sqlCount() }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, monthStart))),
    { label: "quota-warning:calls-count" },
  );

  const usage = {
    users: { used: Number(usersAgg?.c ?? 0), max: sub.maxUsers ?? 0 },
    contacts: { used: Number(contactsAgg?.c ?? 0), max: sub.maxContacts ?? 0 },
    calls: { used: Number(callsAgg?.c ?? 0), max: sub.maxCallsPerMonth ?? 0 },
  };

  const breached: string[] = [];
  for (const [key, { used, max }] of Object.entries(usage)) {
    if (max > 0 && used / max >= WARN_THRESHOLD) breached.push(`${key}: ${used}/${max} (${Math.round((used / max) * 100)}%)`);
  }
  if (breached.length === 0) return;
  if (!orgEmail) return;

  const last = dernierAvertissement ? dernierAvertissement.getTime() : 0;
  if (Date.now() - last < COOLDOWN_HOURS * 3600 * 1000) return;

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f6f9;padding:24px;">
    <div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:32px;">
      <h2 style="color:#0f1729;">Alerte quota — Ajant Bureau</h2>
      <p>Bonjour <strong>${orgName}</strong>,</p>
      <p>Votre organisation a atteint <strong>80% ou plus</strong> de la limite de votre plan <strong>${sub.plan}</strong> sur les ressources suivantes :</p>
      <ul>${breached.map(b => `<li>${b}</li>`).join("")}</ul>
      <p>Pour eviter toute interruption de service, envisagez de passer a un plan superieur depuis votre portail de facturation.</p>
      <p style="color:#94a3b8;font-size:12px;">Vous recevez cet email parce que votre organisation est administree via Ajant Bureau.</p>
    </div></body></html>`;
  const text = `Alerte quota Ajant Bureau\n\nVotre organisation ${orgName} a atteint 80%+ de la limite du plan ${sub.plan}:\n${breached.map(b => `- ${b}`).join("\n")}\n\nEnvisagez de passer a un plan superieur.`;

  // La fenetre est POSEE AVANT l'envoi, et de facon conditionnelle: c'est
  // elle qui reclame l'organisation. Si une autre instance l'a deja
  // reclamee, la ligne ne matche plus et on renonce — un courriel de moins
  // vaut mieux qu'un doublon chez le client.
  const seuil = new Date(Date.now() - COOLDOWN_HOURS * 3600 * 1000);
  const reclamee = await db
    .update(organisationsTable)
    .set({ lastQuotaWarningAt: new Date() })
    .where(and(
      eq(organisationsTable.id, orgId),
      or(
        isNull(organisationsTable.lastQuotaWarningAt),
        lt(organisationsTable.lastQuotaWarningAt, seuil),
      ),
    ))
    .returning({ id: organisationsTable.id });
  if (reclamee.length === 0) return;

  const result = await sendEmail(orgEmail, `[Ajant Bureau] Alerte quota 80% - ${orgName}`, html, text);
  if (result.success) {
    logger.info({ orgId, breached }, "[quota-warning] alerte envoyee");
  } else {
    // L'envoi a echoue: on rend la main, sinon l'organisation resterait
    // silencieuse 72 heures pour un courriel qui n'est jamais parti.
    await db.update(organisationsTable)
      .set({ lastQuotaWarningAt: dernierAvertissement })
      .where(eq(organisationsTable.id, orgId));
    logger.warn({ orgId, err: result.error }, "[quota-warning] envoi echoue");
  }
}

async function tick() {
  try {
    const orgs = await withDbRetry(
      () => db.select({
        id: organisationsTable.id,
        email: organisationsTable.email,
        name: organisationsTable.name,
        actif: organisationsTable.actif,
        lastQuotaWarningAt: organisationsTable.lastQuotaWarningAt,
      }).from(organisationsTable).where(eq(organisationsTable.actif, true)),
      { label: "quota-warning:orgs" },
    );

    for (const org of orgs) {
      try {
        await checkOrganisation(org.id, org.email, org.name, org.lastQuotaWarningAt);
      } catch (err) {
        logger.warn({ orgId: org.id, err }, "[quota-warning] erreur organisation");
      }
    }
  } catch (err) {
    logger.error({ err }, "[quota-warning] tick failed");
  }
}

export function startQuotaWarningCron(): void {
  if (timer) return;
  setTimeout(() => { void tick(); }, 60 * 1000);
  timer = setInterval(withHeartbeat("quota-warning", 12 * 60 * 60 * 1000, tick), 12 * 60 * 60 * 1000);
  logger.info("[quota-warning] cron demarre — verification toutes les 12h, seuil 80%, cooldown 72h");
}

export function stopQuotaWarningCron(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
