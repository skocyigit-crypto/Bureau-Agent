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
- Weather + geocoding: **open-meteo** — free, **no API key**. Geocode via
  `geocoding-api.open-meteo.com/v1/search` (returns lat/lon + IANA `timezone`); forecast via
  `api.open-meteo.com/v1/forecast`. Fixed hosts + `redirect: "error"` (anti-SSRF). The
  geocoder's `timezone` field also powers city-aware date/time answers (Intl + that tz).
- Date/time: fully local via `Intl.DateTimeFormat("fr-FR", { timeZone })`; only geocodes when
  a city is given.
- IBAN validation: 100 % local, no network — ISO 13616 length table per country + mod-97
  (ISO 7064, compute in 7-char chunks to avoid int overflow). Only declare valid if the
  country code is in the length table (never "valid" from mod-97 alone).
- Public holidays / jours fériés: **date.nager.at** — free, **no API key**.
  `date.nager.at/api/v3/PublicHolidays/{year}/{ISO2}` returns French `localName`. Fixed host
  + `redirect:"error"`. Default country FR for this French-first app; detect others by name.

## Instant-answer gating traps (learned the hard way)
- **Keyword regexes need explicit separators / word boundaries**, or partial-word prefixes
  fire network calls: `weather`→`weathering`, `meteo`→`meteora`. Require a separator
  (preposition / space / `:`) between the keyword and the location.
- **Date/time city tails must be preposition-introduced** (`à`/`in` + city), and otherwise
  the query must match the date/time phrase EXACTLY. A loose trailing `(.*)` lets
  `aujourd'hui paris` geocode "paris" and hijack a real web search.
- **Area units:** the unit-token regex must allow digits AND `normalizeUnitToken` must map
  `²→2`, `³→3`, or `m²`/`m2`/`km2` silently never match the UNITS table.
- Bound every user-key-influenced cache (city names, coords) with FIFO eviction — unbounded
  Maps grow for the process lifetime.
- **Cache negatives briefly, successes long.** A `null`/error result (transient outage) must
  use a SHORT TTL or one network blip disables the feature for the whole success-TTL window.
- **A local detector that strips spaces from the WHOLE query hijacks unrelated queries.** IBAN
  ran first and collapsed `"FR 2026 budget"` → `"FR2026BUDGET"` → matched. Without an explicit
  keyword, require the ENTIRE query to match the token shape (no other words/lowercase/accents).
