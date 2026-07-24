import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Routes in this list intentionally operate outside an organisation scope.
 * Every exception needs a reason: adding a filename without documenting its
 * ownership model defeats this guard.
 */
const NON_TENANT_DB_ROUTES: Record<string, string> = {
  "admin-saas-dashboard.ts": "SaaS-wide super-admin reporting",
  "backups.ts": "platform-wide super-admin backup administration",
  "cron-tick.ts": "secret-protected platform scheduler",
  "google-drive-backup.ts": "platform-wide super-admin encrypted backup",
  "org-profile.ts": "organisation identity is resolved from the authenticated session",
  "public-demo-chat.ts": "public demo handoff records have no customer tenant",
  "support-inbox.ts": "shared-secret inbound support webhook",
  "user-preferences.ts": "strictly scoped to req.session.userId",
  "google-workspace.ts": "strictly scoped to req.session.userId OAuth credentials",
};

const DB_ACCESS = /\.(?:from|insert|update|delete)\s*\(|db\.execute\s*\(/;
const TENANT_EVIDENCE =
  /\b(?:organisationId|organizationId|organisation_id|getOrgId|orgId|tenantId|tenant_id)\b/;

describe("route tenant-scope static guard", () => {
  it("requires every database-backed route to declare tenant evidence or an explicit exception", () => {
    const routesDir = join(import.meta.dirname, "..", "routes");
    const violations: string[] = [];

    for (const name of readdirSync(routesDir).filter((entry) => entry.endsWith(".ts"))) {
      const source = readFileSync(join(routesDir, name), "utf8");
      if (!DB_ACCESS.test(source)) continue;
      if (TENANT_EVIDENCE.test(source)) continue;
      if (NON_TENANT_DB_ROUTES[name]) continue;
      violations.push(basename(name));
    }

    expect(
      violations,
      [
        "Database-backed routes without visible tenant scope:",
        ...violations.map((name) => `- ${name}`),
        "Use getOrgId(req)/organisationId, or document a true non-tenant ownership model.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("keeps every exception documented", () => {
    for (const [name, reason] of Object.entries(NON_TENANT_DB_ROUTES)) {
      expect(name.endsWith(".ts")).toBe(true);
      expect(reason.trim().length).toBeGreaterThan(20);
    }
  });
});
