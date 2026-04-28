# BTC Factor Context Notes

Date: 2026-04-27

## Goal

Test whether a BTC-led regime classifier can help us identify when alts have reliable follow-through over the next few candles.

This was inspired by Ernie Chan's recurring emphasis on:

- regime-aware strategy families
- factor exposures over single-instrument narratives
- simple models with honest out-of-sample validation

## Artifact

- `/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/analyze-btc-factor-context.js`
- `/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/btc-factor-context-analysis.json`
- `/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/btc-factor-context-transitions.json`
- `/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/btc-factor-context-summary.json`

## Run

- symbols: `ADAUSDC, LINKUSDC, XRPUSDC, 1000SHIBUSDC, 1000PEPEUSDC`
- BTC anchor: `BTCUSDC`
- timeframe: `5m`
- horizon: next `6` candles
- sample: `1200` candles

## Findings

### 1. Ongoing BTC-led selloffs do have usable alt follow-through

Across all rows inside `risk_off_selloff`:

- `avgAlignedReturnPct = +0.0648%`
- best followers:
  - `1000PEPEUSDC +0.0976%`
  - `1000SHIBUSDC +0.0728%`
  - `ADAUSDC +0.0723%`

Interpretation:

- once the market is already in a BTC-led risk-off tape, alts do continue to bleed modestly over the next handful of candles
- this supports using BTC regime as a continuation gate for bearish setups

### 2. Alt follow rallies looked weaker than expected

Across all rows inside `alt_follow_rally`:

- `avgAlignedReturnPct = +0.0238%`
- strongest follower:
  - `1000PEPEUSDC +0.0791%`

But BTC itself had:

- `avgBtcFutureReturnPct = -0.0114%`

Interpretation:

- this regime label is often arriving after part of the move has already happened
- as an actionable trigger, it is late

### 3. Transition points are worse than ongoing states

When keeping only rows where the regime changed:

- `risk_off_selloff transitions`: `avgAlignedReturnPct = -0.0194%`
- `alt_follow_rally transitions`: `avgAlignedReturnPct = -0.0348%`

Interpretation:

- the current regime classifier is not good as an onset detector
- it is better as a context layer after the move is already in progress

### 4. Practical implication

The current BTC context should be treated as:

- `good continuation filter`
- `bad standalone trigger`

That is useful. It means we should not build entries like:

- "BTC entered risk_off_selloff, therefore short alt immediately"

Instead, we should test:

- "if a symbol-specific bearish setup appears while BTC is already in risk_off_selloff, allow it more easily"

## Next Research Tasks

### A. Build onset detector, not just regime detector

Look for:

- fresh BTC impulse down or up
- alt not yet fully moved
- expanding volume
- weak reclaim / underreaction in the alt

This is likely closer to a leader-follower trigger.

### B. Add BTC regime as a gate to existing families

Candidates:

- `breakdownContinuationBaseShort`
- `liquiditySweepReclaimLong`
- `cipherContinuationShort`

Example:

- only allow exploratory bearish continuation if `BTC context = risk_off_selloff`

### C. Compare factor-aware vs factor-blind backtests

For each family, test:

- normal version
- BTC-gated version

Key metrics:

- trade count
- avg net pnl
- profit factor
- max drawdown

## Decision

Do not promote any BTC-context-only trigger to live.

Do use this as a research direction:

- `BTC context as regime gate`
- not `BTC context as direct entry`
