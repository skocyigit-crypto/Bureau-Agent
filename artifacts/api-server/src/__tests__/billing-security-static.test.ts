import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dirname, "..", path), "utf8");

describe("billing and quota security invariants", () => {
  it("includes internal unpaid invoices in cached access state", () => {
    const source = read("middleware/license-check.ts");
    expect(source).toContain("oldestUnpaidAt");
    expect(source).toContain("'en_attente', 'retard', 'partiel'");
    expect(source).toContain("evaluatePastDueAccess(oldestUnpaidAt");
  });

  it("invalidates access cache on every invoice payment path", () => {
    const source = read("routes/billing.ts");
    expect((source.match(/invalidateLicenseCache\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("does not return bank identity or raw payment rows", () => {
    const source = read("routes/billing.ts");
    const responseSection = source.slice(source.indexOf('router.get("/billing/payments"'), source.indexOf('router.post("/billing/payments/:id/assign"'));
    expect(responseSection).not.toContain("...r.payment");
    expect(responseSection).not.toContain("payerIban:");
    expect(responseSection).not.toContain("payerName:");
    expect(responseSection).not.toContain("rawLine:");
  });

  it("installs a database-level serialized user quota guard", () => {
    const source = read("services/ensure-user-quota.ts");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("users_enforce_organisation_quota");
    expect(source).toContain("user_quota_exceeded");
  });
});