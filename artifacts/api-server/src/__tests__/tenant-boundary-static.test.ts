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

  it("keeps global SaaS data aggregate-only and customer records tenant-scoped", () => {
    const routes = source("routes/index.ts");
    expect(routes).toContain('router.use("/admin/saas-dashboard", requireSuperAdmin)');

    // Customer content must be mounted AFTER requireTenant: mounted above it,
    // the handlers would run with no organisation bound to the session and
    // getOrgId would be the only thing standing between a super-admin and
    // every tenant's records.
    const tenantBoundary = routes.indexOf("router.use(requireTenant)");
    expect(tenantBoundary).toBeGreaterThan(-1);
    for (const mount of ["router.use(prospectsRouter)", "router.use(devisRouter)", "router.use(facturesClientRouter)"]) {
      expect(routes).toContain(mount);
      expect(routes.indexOf(mount), `${mount} must be mounted after requireTenant`).toBeGreaterThan(tenantBoundary);
    }
  });

  it("binds every customer-content query to the session organisation", () => {
    // These three routers were once SaaS-global and read `?organisationId=` /
    // `body.organisationId` from the caller. Under tenant scope that would let
    // one customer address another customer's rows, so the caller-supplied
    // organisation must stay gone and `getOrgId` must be the only source.
    for (const file of ["routes/prospects.ts", "routes/devis.ts", "routes/factures-client.ts"]) {
      const routeSource = source(file);
      expect(routeSource, `${file} must derive the organisation from the session`).toContain('getOrgId(req)');
      expect(routeSource, `${file} must not accept a caller-chosen organisation`).not.toContain("parseOrgFilter");
      expect(routeSource, `${file} must not read organisationId from the body`).not.toMatch(/const\s+orgFromBody\s*=/);
    }
  });
});