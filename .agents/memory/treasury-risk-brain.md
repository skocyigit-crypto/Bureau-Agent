---
name: Treasury cash-crunch risk brain
description: Design constraints for the Monte-Carlo cash-flow risk feature and any MC-backed proactive detector.
---

# Trésorerie / cash-crunch risk

Reuses real `factures_client` data (no invented numbers). Collectible = statuses
`envoyee` / `partiellement_payee` / `en_retard` with `remaining = max(0, totalAmount - paidAmount) > 0`.
Autoliquidation invoices collect HT not TTC, so `collectible = remaining * (HT/TTC)`.
The only net-new business input is one `treasury_settings` row per org
(currentCash, monthlyFixedCosts, defaultAutoliquidation). Presence of that row ==
"configured" — a zero cash value is legitimate, do NOT also require non-zero values.

## Rule: cash-crunch probability must be PATH-based, not terminal-balance
Simulate the cash balance day-by-day over the horizon and flag insolvency if it
crosses below zero AT ANY POINT — not just if the final balance is negative.
Smear fixed costs daily (`monthly/30`); schedule each invoice's inflow on a
sampled collection day (due day + normal delay, clamped ≥ 0).
**Why:** a single terminal-balance check (`cash - fixedCosts*3 + allCollected`)
collapses timing — it lumps 3 months of costs at t0 and ignores mid-horizon dips,
so it both over- and under-states real risk. The objective is "passe sous zéro
d'ici 90 jours", which is inherently a path property.

## Rule: an MC-backed proactive detector needs hysteresis
A detector that re-runs Monte Carlo each engine tick must trigger on a HIGH
threshold but only auto-resolve below a LOWER threshold (e.g. 15% / 12%), and
query its own pending suggestion to decide which band applies.
**Why:** the proactive engine's contract auto-resolves any pending suggestion
whose candidate isn't re-emitted on a tick. With unseeded sampling noise (~±1%
at 2000 sims near the threshold), a fixed cutoff makes the same unchanged data
flap create→resolve→create every 10 min. Hysteresis (plus more sims) absorbs the
noise. Applies to any future detector backed by a stochastic estimate.
