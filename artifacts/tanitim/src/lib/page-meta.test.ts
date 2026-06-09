import { describe, it, expect } from "vitest";
import { PAGE_META, SITE_NAME, composePageTitle } from "./page-meta";

const entries = Object.entries(PAGE_META);

describe("PAGE_META — per-route metadata", () => {
  it("ships a non-empty title and description for every route", () => {
    for (const [key, meta] of entries) {
      expect(meta.title.trim(), `${key} title`).not.toBe("");
      expect(meta.description.trim(), `${key} description`).not.toBe("");
    }
  });

  it("gives each route a DISTINCT title (no silent SEO/a11y duplicate)", () => {
    const titles = entries.map(([, m]) => m.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("gives each route a distinct rendered <title> too", () => {
    const rendered = entries.map(([, m]) => composePageTitle(m.title));
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it("gives routes with a canonical path a distinct path", () => {
    const paths = entries.map(([, m]) => m.path).filter((p): p is string => !!p);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("composePageTitle — full <title> composition", () => {
  it("appends the site name when the title does not already carry it", () => {
    expect(composePageTitle("Mentions légales")).toBe(`Mentions légales — ${SITE_NAME}`);
  });

  it("leaves a title that already includes the brand untouched", () => {
    expect(composePageTitle(PAGE_META.home.title)).toBe(PAGE_META.home.title);
  });
});
