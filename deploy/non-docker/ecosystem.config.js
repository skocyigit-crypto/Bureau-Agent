/**
 * PM2 Ecosystem Configuration — Ajant Bureau
 * Usage:
 *   pm2 start deploy/ecosystem.config.js
 *   pm2 save && pm2 startup  (auto-start on server reboot)
 */

module.exports = {
  apps: [
    {
      // -----------------------------------------------------------------------
      // API Server (Express)
      // -----------------------------------------------------------------------
      name: "adb-api",
      script: "node",
      args: "--enable-source-maps artifacts/api-server/dist/index.mjs",
      cwd: "/var/www/agentdebureau",
      instances: 1,           // Increase to 'max' for multi-core if session store uses Redis
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      min_uptime: "10s",

      env: {
        NODE_ENV: "production",
        PORT: "8080",
        // All other env vars must be set in .env or passed by your secret manager.
        // PM2 will merge them from the system environment or from an .env file
        // if you start with: pm2 start ecosystem.config.js --env production
      },

      // Log rotation (requires pm2-logrotate module)
      log_file: "/var/log/agentdebureau/api-combined.log",
      out_file: "/var/log/agentdebureau/api-out.log",
      error_file: "/var/log/agentdebureau/api-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    },
  ],
};
