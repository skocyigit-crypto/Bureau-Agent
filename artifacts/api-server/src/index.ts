import app from "./app";
import { logger } from "./lib/logger";
import { startAutoBackup } from "./services/auto-backup";
import { startAutomationEngine } from "./services/automation-engine";
import { ensureSuperAdmin } from "./services/ensure-admin";
import { startGoogleAutoPointage } from "./services/google-auto-pointage";
import { startGoogleDriveBackupScheduler } from "./services/google-drive-backup";
import { startDataProtectionMonitor } from "./services/data-protection-monitor";
import { startAiUsagePurgeJob } from "./services/ai-utils";
import { startAiCachePurgeJob } from "./services/ai-cache";
import { startBillingCron } from "./services/billing-cron";
import { startAiInsightsCron } from "./services/ai-insights";

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

    ensureSuperAdmin().catch(err => logger.error({ err }, "Erreur seed admin"));
    startAutoBackup();
    startAutomationEngine();
    startGoogleAutoPointage();
    startGoogleDriveBackupScheduler().catch(err => logger.error({ err }, "[GoogleDriveBackup] Init error"));
    startDataProtectionMonitor();
    startAiUsagePurgeJob();
    startAiCachePurgeJob();
    startBillingCron();
    startAiInsightsCron();
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

startServer().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
