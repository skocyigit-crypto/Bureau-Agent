---
name: Web-search enrichment data sources
description: Which data sources can/can't power the in-app web-search "Google-parity" features (images/videos/maps/shopping/instant-answers) at runtime.
---

# Web-search enrichment data sources

The in-app web search is built on Gemini `googleSearch` grounding, which returns a
**text answer + web link sources only** — no structured image/video/maps/shopping grids.

## What does NOT work at runtime
- **Replit-managed Brave passthrough** (external_apis skill) is (a) **image search only**
  and (b) a **code_execution agent-time callback**, NOT an HTTP endpoint the app server
  can call per end-user request. Cannot power live end-user image search.
- **Exa / Perplexity** connectors: AI/web-text search; no Google-style image/video/maps/
  shopping result grids.

**Why:** real Google-parity tabs (Images, Videos, Maps/Local, Shopping, knowledge panel,
"did you mean", pagination) need a runtime SERP source. The single provider covering all of
them with one user-supplied key is **SerpAPI** (paid beyond a small free tier).

**How to apply:** for any future "add real images/videos/maps/shopping to web search"
request, don't reach for Brave/Exa/Perplexity expecting runtime grids — require a SerpAPI
key (or another paid SERP API). Free/no-key enrichments can ship without asking for a key.

## Free / no-key instant-answer box
A Google-style "anlık cevap" card can be fully deterministic and quota-free:
- Calculator: implement a safe tokenizer + shunting-yard evaluator (**never `eval`**),
  with length caps and anchored regexes (no ReDoS). Support invoice-relevant percent
  patterns: `100 + 20%` (TTC), `100 - 10%` (remise), `20% de 150`.
- **Number-format trap:** normalize EVERY numeric literal through ONE locale-aware parser
  shared by calculator + units + currency. A naive `replace(/,/g,"")` mis-reads `1,234`
  (thousands) vs `3,5` (FR decimal) and gives inconsistent answers across modes.
- Unit conversion (length/mass/volume/area/time/data + affine temperature), FR/EN/TR aliases.
- Currency: **frankfurter** — free, **no API key**, ECB reference rates (TRY + EUR/USD
  included). Canonical host is `api.frankfurter.dev/v1/latest`; `api.frankfurter.app`
  **301-redirects** there. Call the `.dev/v1` URL directly AND set `redirect: "error"` on
  the fetch (anti-SSRF) — otherwise refusing redirects breaks the call. Cache rates ~1h.
