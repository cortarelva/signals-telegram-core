# Monte Carlo Promotion Notes

Inspired by Timothy Masters's emphasis on conservative future-performance estimation,
these notes treat historical backtests as optimistic point estimates and use
trade-list Monte Carlo as a stress test before promotion.

## Method

- Source: full trade lists from `research/backtest-candidate-strategies.js`
- Costs: `feeRate=0.0004`, `slippagePct=0.00025`
- Simulations:
  - `bootstrap`: resample trade returns with replacement to estimate future-performance uncertainty
  - `shuffledOrder`: keep returns unchanged but randomize order to stress drawdown and streak sensitivity
- Conservative fields watched most closely:
  - `bootstrap.p05.avgNetPnlPct`
  - `bootstrap.p05.profitFactorNet`
  - `shuffledOrder.p95.maxDrawdownPct`

## Current Candidates

### BTCUSDC core (`1h / 1d`)

Artifact:
- [`/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/monte-carlo-btcusdc-1h-core.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/monte-carlo-btcusdc-1h-core.json)

Read:
- `breakdownRetestShort` remains the only candidate with enough trades to be judged
- point estimate is decent, but conservative lower bounds are still negative
- recommendation: `exploratory`, not `core promotion`

### 1000SHIBUSDC `cipherContinuationShort` (`15m / 1d`)

Artifact:
- [`/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/monte-carlo-1000shibusdc-15m-short.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/monte-carlo-1000shibusdc-15m-short.json)

Read:
- current extended run is still positive
- but lower-bound robustness is weak
- recommendation: `exploratory`

### ADAUSDC + BTCUSDC `breakdownContinuationBaseShort` (`15m / 1d`)

Artifact:
- [`/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/monte-carlo-adausdc-btcusdc-bdcb-15m.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/monte-carlo-adausdc-btcusdc-bdcb-15m.json)

Read:
- combined sample is large enough to justify lab/exploratory work
- lower bounds still go negative under bootstrap
- order stress roughly doubles drawdown versus the observed path
- recommendation: `exploratory`

## Promotion Rule Of Thumb

Do not promote to `core live` unless a candidate shows all of:

- `trades >= 12`
- `original.avgNetPnlPct > 0`
- `original.profitFactorNet > 1`
- `bootstrap.p05.avgNetPnlPct > 0`
- `bootstrap.p05.profitFactorNet > 1`
- `shuffledOrder.p95.maxDrawdownPct` still within tolerable portfolio heat

If the point estimate is good but the lower bound is negative, keep it in:

- `research`
- or `exploratory live / paper`

not `core live`.
