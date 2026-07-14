import app from "./app";
import { logger } from "./lib/logger";
import { startAutoBackup } from "./services/auto-backup";
import { startAutomationEngine } from "./services/automation-engine";
import { ensureSuperAdmin } from "./services/ensure-admin";
import { ensureAuditAppendOnly } from "./services/ensure-audit-append-only";
import { startGoogleAutoPointage } from "./services/google-auto-pointage";
import { startDataProtectionMonitor } from "./services/data-protection-monitor";
import { startAiUsagePurgeJob, installGeminiModelFallback, onGeminiModelFallback } from "./services/ai-utils";
import { startAiCachePurgeJob } from "./services/ai-cache";
import { startBillingCron } from "./services/billing-cron";
import { startQuotaWarningCron } from "./services/quota-warning-cron";
import { startTrialWarningCron } from "./services/trial-warning-cron";
import { startAiInsightsCron } from "./services/ai-insights";
import { startLocationCleanupCron } from "./services/location-cleanup-cron";
import { startSecurityDigestCron } from "./services/security-digest-cron";
import { startProactiveEngine, recordModelFallbackSuggestion } from "./services/proactive-engine";
import { startAiLearning } from "./services/ai-learning";
import { startAutonomousSecretaryCron } from "./services/autonomous-secretary-cron";
import { startAutonomousInboxCron } from "./services/autonomous-inbox-cron";
import { startAppAuditCron } from "./services/app-audit-cron";
import { startAgentAutoRunScheduler } from "./routes/ai-agents";
import { startWebhookEngine } from "./services/webhook-service";
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
  const dbOk = await checkDbHealth();
  if (!dbOk) {
    logger.warn("Database not reachable at startup — continuing anyway");
  } else {
    logger.info("Database connection verified");
  }

  server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    void installGeminiModelFallback();
    // Tâche #189 — un repli de modele IA alerte l'admin (suggestion proactive
    // cote org super-admin), au lieu de rester une simple ligne de log.
    onGeminiModelFallback((ev) => {
      void recordModelFallbackSuggestion({ from: ev.from, to: ev.to });
    });
    ensureSuperAdmin().catch(err => logger.error({ err }, "Erreur seed admin"));
    void ensureAuditAppendOnly();
    startAutoBackup();
    startAutomationEngine();
    startGoogleAutoPointage();
    // Sauvegarde automatique vers Google Drive desactivee explicitement (choix
    // client) : les donnees plateforme ne doivent pas transiter par un compte
    // Google externe. Ne pas reactiver sans consigne explicite du client.
    startDataProtectionMonitor();
    startAiUsagePurgeJob();
    startAiCachePurgeJob();
    startBillingCron();
    startQuotaWarningCron();
    startTrialWarningCron();
    startAiInsightsCron();
    startLocationCleanupCron();
    startSecurityDigestCron();
    startProactiveEngine();
    startAiLearning();
    startAutonomousSecretaryCron();
    startAutonomousInboxCron();
    startAppAuditCron();
    startAgentAutoRunScheduler();
    startWebhookEngine();
    startAppointmentReminderCron();
    attachVoiceLiveWs(server);
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

startServer().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
