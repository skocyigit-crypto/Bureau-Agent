import { describe, expect, it } from "vitest";
import { jourLocal } from "./jour-local";

describe("jourLocal (appareil)", () => {
  it("lit la date LOCALE, pas la date UTC", () => {
    const d = new Date(2026, 6, 15, 0, 30); // 00h30 heure locale
    expect(jourLocal(d)).toBe("2026-07-15");
  });
  it("remplit les zeros", () => expect(jourLocal(new Date(2026, 0, 5, 12))).toBe("2026-01-05"));
  it("fin d'annee", () => expect(jourLocal(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31"));
});
