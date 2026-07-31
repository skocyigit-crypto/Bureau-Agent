import { describe, expect, it } from "vitest";
import { evaluatePastDueAccess, PAYMENT_GRACE_DAYS } from "../services/payment-access-policy";

describe("past-due access policy", () => {
  const failedAt = new Date("2026-01-01T00:00:00.000Z");

  it("keeps full access during the payment grace period", () => {
    const result = evaluatePastDueAccess(failedAt, "POST", "/api/tasks", new Date("2026-01-05T00:00:00.000Z"));
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("payment_grace");
    expect(PAYMENT_GRACE_DAYS).toBeGreaterThanOrEqual(1);
  });

  it("blocks mutations after grace but preserves reading and billing", () => {
    const now = new Date("2026-01-20T00:00:00.000Z");
    expect(evaluatePastDueAccess(failedAt, "POST", "/api/tasks", now).allowed).toBe(false);
    expect(evaluatePastDueAccess(failedAt, "GET", "/api/tasks", now).allowed).toBe(true);
    expect(evaluatePastDueAccess(failedAt, "POST", "/api/subscription/portal", now).allowed).toBe(true);
  });
});