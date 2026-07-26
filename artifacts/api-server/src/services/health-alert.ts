/**
 * Alerte quand l'AUTOMATISATION elle-meme tombe en panne.
 *
 * Pourquoi ce fichier existe: les agents de sante (`health-agents.ts`)
 * detectent tres bien une tache planifiee morte — `schedulerAgent` compare
 * chaque battement a son intervalle attendu et pose un constat `echec` des
 * qu'un cron a plus de deux intervalles de retard. Mais ce constat n'allait
 * nulle part: une ligne dans `health_checks` et un `logger.warn`. Il fallait
 * donc que quelqu'un pense a ouvrir l'ecran de sante ou a lire les journaux
 * Cloud Run pour l'apprendre.
 *
 * Concretement, si `autonomous-secretary` ou `invoice-reminder` mourait, le
 * bureau cessait d'automatiser en silence: aucune proposition, aucune relance
 * de facture, et surtout aucun signe exterieur — l'application repond
 * normalement, les ecrans sont juste... vides. C'est le mode de panne le plus
 * dangereux d'un produit "autonome": rien ne casse, tout s'arrete.
 *
 * Regles:
 *  - seuls les constats `echec` de severite haute/critique alertent. Un
 *    `degrade` (le cron tourne mais a renvoye une erreur) est deja visible
 *    dans le panneau de sante et se resout souvent au cycle suivant; en faire
 *    un e-mail toutes les 15 minutes viderait l'alerte de son sens.
 *  - une alerte par constat et par jour, garde derivee de la BASE (comme
 *    daily-digest-cron / invoice-reminder-cron) et non de la memoire: le cycle
 *    tourne toutes les 15 minutes et l'instance Cloud Run est recyclee en
 *    permanence, un garde en memoire aurait envoye 96 e-mails par jour.
 *  - ne jette jamais: cette fonction est appelee depuis un cron, et le
 *    diagnostic de sante ne doit pas etre casse par son propre canal d'alerte.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, usersTable, auditLogsTable, notificationsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { getSuperAdminOrgId } from "../lib/super-admin-org";
import { sendEmail } from "./email";
import type { CheckResult, HealthRunSummary } from "./health-agents";

/** Marqueur d'alerte deja envoyee (une par constat et par jour). */
const AUDIT_ACTION = "health_alert_sent";
const AUDIT_RESOURCE = "health_check";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@agentdebureau.fr";
const APP_URL = process.env.PUBLIC_URL || process.env.APP_URL || "https://agentdebureau.fr";

type AlertableCheck = CheckResult & { agent: string };

/**
 * Constats qui meritent de reveiller quelqu'un. Fonction PURE, testee: c'est
 * elle qui decide du niveau de bruit, et une regression ici est silencieuse
 * dans les deux sens (trop d'alertes -> on les ignore; trop peu -> on rate la
 * panne qu'on voulait justement voir).
 */
export function selectAlertableChecks(
  results: Array<CheckResult & { agent: string }>,
): AlertableCheck[] {
  return results.filter(
    (r) => r.status === "echec" && (r.severity === "haute" || r.severity === "critique"),
  );
}

function todayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function alertEmailHtml(checks: AlertableCheck[]): string {
  const rows = checks
    .map(
      (c) => `
        <li style="margin-bottom:12px;">
          <strong style="color:#b91c1c;">${c.check}</strong><br/>
          <span style="color:#334155;font-size:13px;">${c.summary}</span>
          ${c.remediation ? `<br/><span style="color:#64748b;font-size:12px;">A faire : ${c.remediation}</span>` : ""}
        </li>`,
    )
    .join("");
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
      <div style="background:#7f1d1d;padding:24px 32px;">
        <h1 style="color:#fff;font-size:18px;margin:0;">L'automatisation est en panne</h1>
      </div>
      <div style="padding:24px 32px;">
        <p style="font-size:14px;color:#1f2937;">
          ${checks.length} controle(s) technique(s) en echec. Tant que ce n'est pas corrige,
          les taches concernees ne s'executent plus — sans autre signe visible dans l'application.
        </p>
        <ul style="padding-left:18px;font-size:14px;color:#334155;">${rows}</ul>
        <a href="${APP_URL}/sante-technique" style="display:inline-block;margin-top:8px;background:#b91c1c;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;">Ouvrir le panneau de sante</a>
      </div>
    </div>`;
}

/**
 * Envoie une alerte pour les constats en echec pas encore signales aujourd'hui.
 * Renvoie les constats effectivement alertes (utile aux tests et aux journaux).
 */
export async function notifyHealthFailures(summary: HealthRunSummary): Promise<AlertableCheck[]> {
  try {
    const candidates = selectAlertableChecks(summary.results);
    if (candidates.length === 0) return [];

    // Garde persistante: on lit ce qui a DEJA ete signale aujourd'hui plutot
    // que de tenir un etat en memoire (l'instance ne survit pas a la journee).
    const names = candidates.map((c) => c.check);
    const already = await db
      .select({ resourceId: auditLogsTable.resourceId })
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.action, AUDIT_ACTION),
          eq(auditLogsTable.resource, AUDIT_RESOURCE),
          gte(auditLogsTable.createdAt, todayStart()),
          inArray(auditLogsTable.resourceId, names),
        ),
      );
    const alreadySent = new Set(already.map((r) => r.resourceId));
    const fresh = candidates.filter((c) => !alreadySent.has(c.check));
    if (fresh.length === 0) return [];

    const orgId = await getSuperAdminOrgId();

    // Deux canaux volontairement: l'e-mail atteint le proprietaire meme quand
    // l'application est justement inutilisable, la notification interne laisse
    // une trace consultable ensuite.
    const superAdmins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "super_admin"), eq(usersTable.actif, true)));

    if (superAdmins.length > 0) {
      await db.insert(notificationsTable).values(
        superAdmins.map((admin) => ({
          userId: admin.id,
          organisationId: orgId ?? null,
          type: "alerte",
          title: "Automatisation en panne",
          message: fresh.map((c) => c.summary).join(" | ").slice(0, 1000),
          priority: "urgente",
          actionUrl: "/sante-technique",
          sourceType: "health_failure",
          sourceId: `health-${fresh[0].check}`,
        })),
      );
    }

    const result = await sendEmail(
      ADMIN_EMAIL,
      `[Ajant Bureau] Automatisation en panne — ${fresh.length} controle(s) en echec`,
      alertEmailHtml(fresh),
      fresh.map((c) => `${c.check}: ${c.summary}`).join("\n"),
    );

    // On marque MEME si l'e-mail a echoue: sinon un fournisseur e-mail en
    // panne ferait re-tenter l'envoi toutes les 15 minutes. La notification
    // interne, elle, est deja passee, et le lendemain reessaiera.
    await db.insert(auditLogsTable).values(
      fresh.map((c) => ({
        organisationId: orgId ?? null,
        action: AUDIT_ACTION,
        resource: AUDIT_RESOURCE,
        resourceId: c.check,
        details: { summary: c.summary, agent: c.agent, emailSuccess: result.success },
      })),
    );

    logger.warn(
      { checks: fresh.map((c) => c.check), emailSuccess: result.success },
      "[HealthAlert] Panne d'automatisation signalee",
    );
    return fresh;
  } catch (err) {
    logger.error({ err }, "[HealthAlert] Echec de l'alerte de sante");
    return [];
  }
}
