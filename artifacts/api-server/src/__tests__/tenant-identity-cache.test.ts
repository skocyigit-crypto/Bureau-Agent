import { describe, expect, it, vi } from "vitest";
import { TenantIdentityCache } from "../middleware/tenant-identity-cache";

describe("TenantIdentityCache", () => {
  it("collapses concurrent lookups for one customer into one database load", async () => {
    const cache = new TenantIdentityCache(5_000);
    const identity = { organisationId: 42, role: "agent", actif: true };
    const loader = vi.fn(async () => {
      await Promise.resolve();
      return identity;
    });

    const results = await Promise.all(Array.from({ length: 40 }, () => cache.get(7, loader)));

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array(40).fill(identity));
  });

  it("reloads immediately after an administrative invalidation", async () => {
    const cache = new TenantIdentityCache(60_000);
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ organisationId: 10, role: "agent", actif: true })
      .mockResolvedValueOnce({ organisationId: 20, role: "lecteur", actif: true });

    await cache.get(9, loader);
    cache.invalidate(9);

    await expect(cache.get(9, loader)).resolves.toMatchObject({ organisationId: 20, role: "lecteur" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not cache database failures", async () => {
    const cache = new TenantIdentityCache();
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({ organisationId: 5, role: "agent", actif: true });

    await expect(cache.get(3, loader)).rejects.toThrow("database unavailable");
    await expect(cache.get(3, loader)).resolves.toMatchObject({ organisationId: 5 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});