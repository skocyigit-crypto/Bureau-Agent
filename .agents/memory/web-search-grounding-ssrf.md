---
name: Web search via Gemini grounding + URL safety
description: How in-app web search sources links (Gemini Google Search grounding) and the SSRF rule for resolving redirect URLs before antivirus scanning.
---

# In-app secure web search

The app has no third-party search API (Brave/Bing/SerpAPI/Google CSE). In-app web
search is powered by **Gemini Google Search grounding** (`config.tools: [{ googleSearch: {} }]`),
the same mechanism already used for voice. The AI answer is shown plus the grounding
source links, each passed through the existing URL-safety layer (`analyzeUrlsBatch`)
so the user sees safe/suspicious/dangerous before clicking.

## Grounding source URLs are redirects — resolve them safely
`groundingMetadata.groundingChunks[].web.uri` are **redirect** URLs on
`vertexaisearch.cloud.google.com`, not the real destination. To scan the true
target you must resolve the redirect.

**Rule (anti-SSRF — do not regress):** when resolving a model-derived redirect,
NEVER do `fetch(url, { redirect: "follow" })` on arbitrary hosts.
- Only contact allowlisted Google grounding hosts (`vertexaisearch.cloud.google.com`
  / `*.cloud.google.com`), over https.
- Use `redirect: "manual"` and read the `Location` header — never auto-follow to an
  arbitrary target.
- Never fetch the destination itself; only return it for Safe Browsing lookup +
  display. Validate the destination host against private/loopback/link-local/metadata
  ranges and reject non-http(s).
- Fail closed: on any non-conforming case, fall back to the original (harmless
  Google) redirect URL.

**Why:** an earlier version fetched-and-followed model-provided URLs unrestricted —
a classic SSRF sink (could hit `169.254.169.254`, RFC1918, loopback). Code review
blocked it.

## Other constraints
- Route `POST /api/web-search` is tenant-scoped + `assertAiQuota` + org-scoped
  `buildAiCacheKey` (same pattern as other AI routes), cached MEDIUM.
- Added `/web-search` to the threat-detection `SCAN_BYPASS_PATHS` (like the scan-*
  endpoints) so a query containing a URL/base64 isn't blocked by the generic
  injection regex. The query is plain text; results are not request-scanned.
