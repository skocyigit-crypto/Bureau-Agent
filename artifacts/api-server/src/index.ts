import app from "./app";
import { logger } from "./lib/logger";
import { startAutoBackup } from "./services/auto-backup";
import { startAutomationEngine } from "./services/automation-engine";
import { ensureSuperAdmin } from "./services/ensure-admin";
import { startGoogleAutoPointage } from "./services/google-auto-pointage";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  ensureSuperAdmin().catch(err => logger.error({ err }, "Erreur seed admin"));
  startAutoBackup();
  startAutomationEngine();
  startGoogleAutoPointage();
});
