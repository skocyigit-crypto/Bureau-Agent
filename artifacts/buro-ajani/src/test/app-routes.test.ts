import fs from "node:fs";
import path from "node:path";
import { describe,expect,it } from "vitest";

describe("application route priority", () => {
  it("enables React StrictMode at the application root", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../main.tsx"), "utf8");

    expect(source).toContain('import { StrictMode } from "react"');
    expect(source).toContain("<StrictMode>");
  });

  it("declares the contact import route before the dynamic contact route", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../App.tsx"), "utf8");
    const importRoute = source.indexOf('path="/contacts/import"');
    const detailRoute = source.indexOf('path="/contacts/:id"');

    expect(importRoute).toBeGreaterThan(-1);
    expect(detailRoute).toBeGreaterThan(-1);
    expect(importRoute).toBeLessThan(detailRoute);
  });

  it("keeps API- and workflow-generated destinations reachable", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../App.tsx"), "utf8");

    for (const route of [
      "/prospects",
      "/prospects/:id",
      "/devis",
      "/factures",
    ]) {
      expect(source, `missing application route: ${route}`).toContain(`path="${route}"`);
    }
  });
});
