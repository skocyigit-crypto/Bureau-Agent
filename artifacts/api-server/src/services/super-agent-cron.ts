/**
 * Passage quotidien du Super Agent.
 *
 * Jusqu'ici le Super Agent ne tournait que si quelqu'un appuyait sur le bouton:
 * une automatisation qui attend qu'on la lance n'automatise rien. Ce cron lui
 * donne une cadence.
 *
 * OPT-IN, volontairement. Le Super Agent n'ecrit pas un rapport: il cree des
 * taches et remonte des priorites, sans passer par la file d'approbation. Le
 * brancher pour tout le monde ferait apparaitre, du jour au lendemain et chez
 * chaque client, des taches que personne n'a demandees. Chaque organisation
 * l'allume depuis son ecran (`PATCH /ai/super-agent/auto-run`); tant qu'elle ne
 * l'a pas fait, ce cron ne la regarde meme pas.
 *
 * Durabilite: le garde « une fois par jour » vient de `super_agent_state.lastRun`,
 * pas d'une variable de processus — un redemarrage ne relance donc pas un cycle
 * deja fait, et les trois instances lisent la meme reponse.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, googleOAuthTokensTable, organisationsTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { CRON_LOCK_NAMESPACE, withCronLock } from "../lib/cron-lock";
import { recordCronHeartbeat } from "./health-agents";
import { registerRunnableCron } from "./cron-registry";
import {
  finishSuperAgentCycle,
  listOrgsDueForAutoRun,
  tryStartSuperAgentCycle,
} from "./super-agent-state";
import { runSuperAgentCycle } from "../routes/ai-agents";

const TICK_MS = 60 * 60 * 1000; // 1 h — le garde quotidien fait le reste.
const DAY_MS = 24 * 60 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Sous quelle identite tourne le cycle. Le seul usage de `userId` est la boite
 * Gmail: on prefere donc un compte qui a REELLEMENT un jeton Google, sinon le
 * volet e-mail se contenterait de journaliser « Gmail non connecte » alors que
 * l'organisation a bien connecte un compte — sur un autre utilisateur.
 * A defaut, un administrateur actif, pour que les autres volets (chantier,
 * taches, appels) tournent quand meme.
 */
async function pickRunnerUser(orgId: number): Promise<number | null> {
  const [withGoogle] = await withDbRetry(
    () => db.select({ id: usersTable.id })
      .from(usersTable)
      .innerJoin(googleOAuthTokensTable, eq(googleOAuthTokensTable.userId, usersTable.id))
      .where(and(
        eq(usersTable.organisationId, orgId),
        eq(usersTable.actif, true),
        isNotNull(googleOAuthTokensTable.refreshToken),
      ))
      .limit(1),
    { label: "super-agent-cron:runner-google" },
  );
  if (withGoogle) return withGoogle.id;

  const [admin] = await withDbRetry(
    () => db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.organisationId, orgId), eq(usersTable.actif, true)))
      // `admin` avant `agent`: l'ordre alphabetique descendant placerait
      // `super_admin` en tete, ce qui reste un compte legitime de l'org.
      .orderBy(desc(usersTable.role), usersTable.id)
      .limit(1),
    { label: "super-agent-cron:runner-admin" },
  );
  return admin?.id ?? null;
}

export async function runSuperAgentCronTick(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const due = await listOrgsDueForAutoRun(new Date(Date.now() - DAY_MS));

    for (const orgId of due) {
      try {
        // Verrou consultatif: `listOrgsDueForAutoRun` puis le lancement ne sont
        // pas atomiques. Le drapeau en base attrape deja la course, mais le
        // verrou evite qu'une seconde instance fasse tout le travail de
        // selection pour rien.
        await withCronLock(CRON_LOCK_NAMESPACE.superAgent, orgId, async () => {
          const [org] = await withDbRetry(
            () => db.select({ actif: organisationsTable.actif })
              .from(organisationsTable)
              .where(eq(organisationsTable.id, orgId))
              .limit(1),
            { label: "super-agent-cron:org" },
          );
          // Une organisation suspendue ne doit pas continuer a voir des taches
          // apparaitre toute seule.
          if (!org?.actif) return;

          const userId = await pickRunnerUser(orgId);
          if (!userId) {
            logger.warn({ orgId }, "[SuperAgentCron] aucune identite disponible — cycle saute");
            return;
          }

          if (!(await tryStartSuperAgentCycle(orgId))) return;
          try {
            await runSuperAgentCycle(orgId, userId);
          } catch (err) {
            // `runSuperAgentCycle` libere le drapeau dans son `finally`; ce
            // filet ne sert qu'a un echec survenu avant d'y entrer.
            await finishSuperAgentCycle(orgId, { completed: false }).catch(() => {});
            throw err;
          }
        });
      } catch (err) {
        logger.warn({ err, orgId }, "[SuperAgentCron] echec pour une organisation");
      }
    }

    await recordCronHeartbeat("super-agent", TICK_MS / 1000);
  } catch (err) {
    logger.error({ err }, "[SuperAgentCron] erreur du cycle");
    await recordCronHeartbeat("super-agent", TICK_MS / 1000, err instanceof Error ? err.message : "erreur inconnue");
  } finally {
    running = false;
  }
}

export function startSuperAgentCron(): void {
  if (intervalHandle) return;
  logger.info("[SuperAgentCron] passage quotidien du Super Agent arme");

  const run = (): Promise<void> => runSuperAgentCronTick().catch(() => {});

  // Declenchement EXTERNE (Cloud Scheduler -> /api/cron/tick): avec
  // min-instances=0, un conteneur inactif emporte ses minuteurs, et une
  // cadence horaire ne serait presque jamais atteinte par le seul setInterval.
  registerRunnableCron("super-agent", TICK_MS, run);

  // Premier passage differe: ne pas alourdir le demarrage.
  setTimeout(run, 120 * 1000);
  intervalHandle = setInterval(run, TICK_MS);

  const shutdown = () => {
    if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
