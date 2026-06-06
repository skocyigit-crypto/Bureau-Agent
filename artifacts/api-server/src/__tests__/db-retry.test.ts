import { describe, it, expect, vi } from "vitest";
import { withDbRetry } from "../lib/db-retry";

describe("withDbRetry", () => {
  it("renvoie le résultat sans réessayer quand l'opération réussit", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const out = await withDbRetry(fn);
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("réessaie sur une erreur de connexion transitoire puis réussit", async () => {
    const transient = Object.assign(new Error("Connection terminated unexpectedly"), {});
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValue("recovered");
    const out = await withDbRetry(fn, { baseDelayMs: 1 });
    expect(out).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("réessaie sur un code d'erreur de connexion transitoire (ECONNRESET)", async () => {
    const transient = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const fn = vi.fn().mockRejectedValueOnce(transient).mockResolvedValue(42);
    const out = await withDbRetry(fn, { baseDelayMs: 1 });
    expect(out).toBe(42);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("détecte une erreur transitoire enveloppée via cause (drizzle)", async () => {
    const wrapped = Object.assign(new Error("Failed query: select ..."), {
      cause: Object.assign(new Error("timeout exceeded when trying to connect"), {}),
    });
    const fn = vi.fn().mockRejectedValueOnce(wrapped).mockResolvedValue("ok");
    const out = await withDbRetry(fn, { baseDelayMs: 1 });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("ne réessaie PAS une erreur SQL non transitoire et la propage", async () => {
    const sqlErr = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: "23505",
    });
    const fn = vi.fn().mockRejectedValue(sqlErr);
    await expect(withDbRetry(fn, { baseDelayMs: 1 })).rejects.toThrow(/duplicate key/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("abandonne après le nombre maximal de tentatives sur erreur transitoire persistante", async () => {
    const transient = Object.assign(new Error("Connection terminated due to connection timeout"), {});
    const fn = vi.fn().mockRejectedValue(transient);
    await expect(withDbRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow(/Connection terminated/);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
