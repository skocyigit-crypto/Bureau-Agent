/**
 * Parses an absolute web URL that is safe to hand to a browser navigation API.
 * Relative URLs, credentials, control characters and non-HTTP schemes are
 * rejected so callers cannot accidentally open javascript:, data: or a
 * protocol-relative attacker URL.
 */
export function parseSafeHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || /[\u0000-\u001F\u007F]/.test(candidate)) return null;
  if (!/^https?:\/\//i.test(candidate)) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** Returns a browser-safe href for a rendered link. */
export function safeLinkHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || /[\u0000-\u001F\u007F\\]/.test(candidate)) return null;

  if (candidate.startsWith("#")) return candidate;
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;

  return parseSafeHttpUrl(candidate)?.href ?? null;
}

/** Opens a validated external URL without exposing window.opener. */
export function openSafeExternalUrl(value: unknown): boolean {
  const url = parseSafeHttpUrl(value);
  if (!url) return false;
  window.open(url.href, "_blank", "noopener,noreferrer");
  return true;
}
