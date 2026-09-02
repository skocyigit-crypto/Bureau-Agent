import fs from "node:fs";
import path from "node:path";
import { describe,expect,it } from "vitest";

const readSource = (relativePath: string) =>
  fs.readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8");

describe("custom modal accessibility", () => {
  it("uses the shared focus-managed dialog for the phone simulator", () => {
    const source = readSource("../components/phone-simulator.tsx");

    expect(source).toContain("<Dialog open={open} onOpenChange={onOpenChange}>");
    expect(source).toContain("<DialogTitle");
    expect(source).not.toContain('className="fixed inset-0 z-50 bg-black/60');
  });

  it("uses focus-managed dialogs for browser help panels", () => {
    const source = readSource("../components/smart-browser-panel.tsx");

    expect(source).toContain("<Dialog open={show} onOpenChange={setShow}>");
    expect(source.match(/<DialogTitle/g)).toHaveLength(2);
    expect(source).not.toContain('className="fixed inset-0 z-[100] bg-black/50');
  });
});
