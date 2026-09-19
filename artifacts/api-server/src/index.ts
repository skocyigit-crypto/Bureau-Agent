import app from "./app";
import { logger } from "./lib/logger";
import { startAutomationEngine } from "./services/automation-engine";
import { ensureSuperAdmin } from "./services/ensure-admin";
import { ensureAuditAppendOnly } from "./services/ensure-audit-append-only";
import { ensureUserQuotaTrigger } from "./services/ensure-user-quota";
import { startGoogleAutoPointage } from "./services/google-auto-pointage";
import { startDataProtectionMonitor } from "./services/data-protection-monitor";
import { startAiUsagePurgeJob, installGeminiModelFallback, onGeminiModelFallback } from "./services/ai-utils";
import { startRetentionCron } from "./services/retention-cron";
import { startAiCachePurgeJob } from "./services/ai-cache";
import { startBillingCron } from "./services/billing-cron";
import { startQuotaWarningCron } from "./services/quota-warning-cron";
import { startTrialWarningCron } from "./services/trial-warning-cron";
import { startClotureCron } from "./services/cloture-cron";
import { startAiInsightsCron } from "./services/ai-insights";
import { startTenantBackupCron } from "./services/tenant-backup-cron";
import { startLocationCleanupCron } from "./services/location-cleanup-cron";
import { startAccountRetentionCron } from "./services/account-retention-cron";
import { startPaymentMatchingCron } from "./services/payment-matching-cron";
import { startSecurityDigestCron } from "./services/security-digest-cron";
import { startProactiveEngine, recordModelFallbackSuggestion } from "./services/proactive-engine";
import { startAiLearning } from "./services/ai-learning";
import { startAutonomousSecretaryCron } from "./services/autonomous-secretary-cron";
import { startSuperAgentCron } from "./services/super-agent-cron";
import { startAutonomousInboxCron } from "./services/autonomous-inbox-cron";
import { startDailyDigestCron } from "./services/daily-digest-cron";
import { startInvoiceReminderCron } from "./services/invoice-reminder-cron";
import { startSaasAgentCron } from "./services/saas-agent-cron";
import { startAppAuditCron } from "./services/app-audit-cron";
import { startHealthAgentsCron } from "./services/health-agents-cron";
import { startAgentAutoRunScheduler, startAutopilotScheduler } from "./routes/ai-agents";
import { startWebhookEngine } from "./services/webhook-service";
import { startPushNotifications } from "./services/push-notifications";
import { startEventBus } from "./services/event-bus";
import { startAppointmentReminderCron } from "./services/appointment-reminder-cron";
import { attachVoiceLiveWs } from "./routes/voice-live";

import { closePool, checkDbHealth } from "@workspace/db";
import type { Server } from "http";

let server: Server;
let isShuttingDown = false;

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — shutting down");
  gracefulShutdown("uncaughtException").finally(() => process.exit(1));
});

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "Graceful shutdown initiated");

  const forceTimeout = setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 15000);

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      logger.info("HTTP server closed");
    }

    await closePool();
    logger.info("Database pool closed");
  } catch (err) {
    logger.error({ err }, "Error during shutdown");
  } finally {
    clearTimeout(forceTimeout);
  }
}

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM").finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT").finally(() => process.exit(0));
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  // Bind HTTP immediately while the database connector warms in parallel.
  const dbHealthPromise = checkDbHealth().then((dbOk) => {
    if (!dbOk) logger.warn("Database not reachable at startup — continuing anyway");
    else logger.info("Database connection verified");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Database startup check failed — continuing anyway");
  });

  server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    void dbHealthPromise;

    void installGeminiModelFallback();
    // Tâche #189 — un repli de modele IA alerte l'admin (suggestion proactive
    // cote org super-admin), au lieu de rester une simple ligne de log.
    onGeminiModelFallback((ev) => {
      void recordModelFallbackSuggestion({ from: ev.from, to: ev.to });
    });
    // ── Amorcage base de donnees: EN SERIE, avant le reste ───────────────
    //
    // Ces trois taches etaient lancees en parallele, au milieu d'une
    // trentaine d'autres demarrages qui touchent eux aussi la base. Le pool
    // vaut HUIT connexions par instance (`DB_POOL_MAX`), avec une attente
    // plafonnee a dix secondes: au-dela de huit demandeurs simultanes, les
    // suivants font la queue puis abandonnent sur
    // « timeout exceeded when trying to connect ».
    //
    // Mesure du 15/09, sur le demarrage de 15h54 — huit echecs etales sur
    // soixante secondes, tous a la connexion:
    //
    //     15:54:27  [audit] failed to install append-only triggers
    //     15:54:54  [security] failed to install user-quota trigger
    //     15:55:06  [cloture] echec du passage
    //     15:55:11  Erreur seed admin + [AutoBackup] Erreur critique
    //     15:55:17  [ai-utils] Purge ai_usage failed
    //     15:55:23  deux ticks de cron
    //
    // Ce n'est pas propre a ce demarrage: la meme rafale s'est produite a
    // 12h42 (douze echecs). Elle est intermittente — elle depend de l'ordre
    // d'arrivee — ce qui la rend invisible la plupart du temps.
    //
    // Les deux premieres posent du DDL, qui prend des verrous et dure: les
    // laisser se battre avec vingt-cinq autres taches pour huit connexions
    // etait le pire arrangement possible. En serie, elles prennent une
    // connexion a la fois et liberent le pool pour la suite. Le serveur HTTP
    // ecoute deja: ce sequencement ne retarde aucune requete utilisateur.
    const amorcageBase = ensureSuperAdmin()
      .catch((err: unknown) => logger.error({ err }, "Erreur seed admin"))
      .then(() => ensureAuditAppendOnly())
      .then(() => ensureUserQuotaTrigger())
      .catch((err: unknown) =>
        logger.error({ err }, "[demarrage] amorcage base incomplet"),
      );

    // Le RESTE attend cet amorcage. Sans cela, le sequencement ci-dessus ne
    // servirait a rien: les vingt-cinq demarrages suivants se disputeraient
    // les memes huit connexions pendant que le DDL les tient.
    // ── Demarrages de fond: ETALES, pas simultanes ──────────────────────
    //
    // Serialiser le seul amorcage ne suffisait pas. Mesure apres cette
    // premiere correction, sur le demarrage de 17h04: cinq echecs, TOUS sur
    // « timeout exceeded when trying to connect ». La rafale n'avait pas
    // disparu, elle s'etait DEPLACEE — les vingt-cinq demarrages restants
    // partaient toujours dans le meme tick, simplement plus tard.
    //
    // Progression mesuree sur trois demarrages comparables:
    //
    //     12h42  12 echecs   (avant toute correction)
    //     15h54   8 echecs
    //     17h04   5 echecs   (amorcage serialise seul)
    //
    // La plupart de ces `start*` inscrivent un minuteur ET font un premier
    // passage immediat, qui touche la base. Vingt-cinq premiers passages
    // pour huit connexions, c'est la meme famine, decalee de deux secondes.
    //
    // On les espace donc. Le delai est court et le total borne (environ
    // quatre secondes pour la liste entiere), pendant lesquelles le serveur
    // HTTP repond deja: aucune requete utilisateur n'attend. Un demarrage
    // qui jette n'interrompt pas la suite — sinon une seule tache fragile
    // priverait l'application de tous les crons suivants.
    const DELAI_ENTRE_DEMARRAGES_MS = 150;

    const demarrages: Array<[string, () => void]> = [
      ["automation-engine", startAutomationEngine],
      ["google-auto-pointage", startGoogleAutoPointage],
      // Sauvegarde automatique vers Google Drive desactivee explicitement
      // (choix client): les donnees plateforme ne doivent pas transiter par
      // un compte Google externe. Ne pas reactiver sans consigne explicite.
      ["data-protection-monitor", startDataProtectionMonitor],
      ["ai-usage-purge", startAiUsagePurgeJob],
      // Applique la duree de conservation annoncee pour les enregistrements
      // d'appel: elle etait publiee sans qu'aucun traitement ne l'applique.
      ["retention-cron", () => void startRetentionCron()],
      ["ai-cache-purge", startAiCachePurgeJob],
      ["billing-cron", startBillingCron],
      ["quota-warning-cron", startQuotaWarningCron],
      ["trial-warning-cron", startTrialWarningCron],
      // Cloture comptable: la conservation exigee par l'article 286-I-3 bis
      // du CGI n'est pas « le logiciel PEUT clore » mais « le logiciel
      // clot ». Compter sur un artisan pour cliquer chaque soir n'est pas un
      // dispositif.
      ["cloture-cron", startClotureCron],
      ["ai-insights-cron", startAiInsightsCron],
      ["tenant-backup-cron", startTenantBackupCron],
      ["location-cleanup-cron", startLocationCleanupCron],
      ["account-retention-cron", startAccountRetentionCron],
      ["payment-matching-cron", startPaymentMatchingCron],
      ["security-digest-cron", startSecurityDigestCron],
      ["proactive-engine", startProactiveEngine],
      ["ai-learning", startAiLearning],
      ["autonomous-secretary-cron", startAutonomousSecretaryCron],
      ["super-agent-cron", startSuperAgentCron],
      ["autonomous-inbox-cron", startAutonomousInboxCron],
      ["daily-digest-cron", startDailyDigestCron],
      ["invoice-reminder-cron", startInvoiceReminderCron],
      ["saas-agent-cron", startSaasAgentCron],
      ["app-audit-cron", startAppAuditCron],
      ["health-agents-cron", startHealthAgentsCron],
      ["agent-auto-run", startAgentAutoRunScheduler],
      ["autopilot", startAutopilotScheduler],
      ["webhook-engine", startWebhookEngine],
      ["push-notifications", startPushNotifications],
      ["event-bus", startEventBus],
      ["appointment-reminder-cron", startAppointmentReminderCron],
    ];

    void amorcageBase.then(async () => {
      for (const [nom, demarrer] of demarrages) {
        try {
          demarrer();
        } catch (err) {
          logger.error({ err, tache: nom }, "[demarrage] tache de fond en echec");
        }
        await new Promise((r) => setTimeout(r, DELAI_ENTRE_DEMARRAGES_MS));
      }
      logger.info({ taches: demarrages.length }, "[demarrage] taches de fond demarrees");
    });

    // Hors chaine: le point d entree WebSocket ne touche pas la base et ne
    // doit pas attendre.
    attachVoiceLiveWs(server);
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

startServer().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
