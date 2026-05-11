// Shared HTML escaping helpers for outbound email/HTML rendering.
//
// Three nearly-identical copies of escapeHtml() previously lived in
// services/email.ts, routes/ai-commandant.ts and routes/license-management.ts
// (one of them did not escape `'`). Centralising avoids drift and lets new
// email templates reach for the same helper without re-implementing it.
//
// All helpers accept null/undefined defensively so they can be applied to
// optional fields without sprinkling `?? ""` at every call site.

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// For values that will land inside an HTML attribute. escapeHtml() already
// covers " and ', so for double-quoted attributes this is identical — exposed
// as a separate name so call sites read clearly.
export const escapeAttr = escapeHtml;

// Validate a URL is safe to drop into an HTML href/src attribute. Blocks
// javascript:, data:, vbscript:, file: and similar dangerous schemes; only
// allows http(s), mailto, tel, and same-origin relative paths. Returns "#"
// for anything that doesn't match — chosen over throwing so a bad URL in a
// template doesn't crash an outbound email.
export function safeUrl(value: unknown): string {
  if (value === null || value === undefined) return "#";
  const s = String(value).trim();
  if (s === "") return "#";
  // Same-origin / relative
  if (s.startsWith("/") && !s.startsWith("//")) return escapeAttr(s);
  // Allowlisted schemes
  const lower = s.toLowerCase();
  if (
    lower.startsWith("https://") ||
    lower.startsWith("http://") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:")
  ) {
    return escapeAttr(s);
  }
  return "#";
}
