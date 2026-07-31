import fs from "node:fs";
import path from "node:path";
import { describe,expect,it } from "vitest";

describe("application route priority", () => {
  it("declares the contact import route before the dynamic contact route", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../App.tsx"), "utf8");
    const importRoute = source.indexOf('path="/contacts/import"');
    const detailRoute = source.indexOf('path="/contacts/:id"');

    expect(importRoute).toBeGreaterThan(-1);
    expect(detailRoute).toBeGreaterThan(-1);
    expect(importRoute).toBeLessThan(detailRoute);
  });
});