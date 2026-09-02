import { afterEach,describe,expect,it,vi } from "vitest";
import { openSafeExternalUrl,parseSafeHttpUrl,safeLinkHref } from "./safe-url";

describe("safe external URLs", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "//evil.example/path",
    "/relative/path",
    "https://user:password@example.com",
    "https://example.com/\nattack",
    "not a url",
  ])("rejects unsafe URL %s", (value) => {
    expect(parseSafeHttpUrl(value)).toBeNull();
  });

  it("normalizes and opens an HTTPS URL with opener isolation", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    expect(openSafeExternalUrl(" https://example.com/docs?q=1 ")).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "https://example.com/docs?q=1",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("does not invoke window.open for rejected input", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    expect(openSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    [" /notifications?filter=unread ", "/notifications?filter=unread"],
    ["#security", "#security"],
    ["https://example.com/docs", "https://example.com/docs"],
  ])("accepts safe rendered link %s", (value, expected) => {
    expect(safeLinkHref(value)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "//evil.example/path",
    String.raw`\\evil.example\path`,
    "relative/path",
  ])("rejects unsafe rendered link %s", (value) => {
    expect(safeLinkHref(value)).toBeNull();
  });
});
