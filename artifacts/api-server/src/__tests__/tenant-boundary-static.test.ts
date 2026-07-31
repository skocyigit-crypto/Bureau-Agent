import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe,expect,it } from "vitest";

const source = (relativePath: string) => readFileSync(join(import.meta.dirname, "..", relativePath), "utf8");

describe("tenant boundary invariants", () => {
  it("revalidates the current tenant instead of trusting the session claim", () => {
    const tenant = source("middleware/tenant.ts");
    expect(tenant).toContain("usersTable.organisationId");
    expect(tenant).toContain("usersTable.actif");
    expect(tenant).toContain("req.session.organisationId = user.organisationId");
    expect(tenant).not.toMatch(/if \(organisationId\) \{\s*next\(\)/);
  });

  it("scopes user administration for every role including super admin", () => {
    const auth = source("routes/auth.ts");
    expect(auth).toContain('router.use("/auth/users", requireAuth, requireTenant)');
    expect(auth).not.toContain('organisationId && userRole !== "super_admin"');
  });

  it("does not bypass user ownership checks for super admins", () => {
    const guard = source("middleware/tenant-guard.ts");
    const ownership = guard.slice(guard.indexOf("export async function assertOrgOwnsUser"), guard.indexOf("export function assertTargetNotSuperAdmin"));
    expect(ownership).not.toContain("isSuperAdmin(req)");
    expect(ownership).toContain("usersTable.organisationId");
  });

  it("keeps global SaaS data behind explicit super-admin guards", () => {
    const routes = source("routes/index.ts");
    for (const path of ["/admin/saas-dashboard", "/prospects", "/devis", "/factures-client"]) {
      expect(routes).toContain(`router.use("${path}", requireSuperAdmin)`);
    }
  });
});