# Institutional Quant Strategy Map

## Goal

Translate the public playbooks of large systematic investors into a research roadmap that fits this bot's current architecture.

This is not a "copy Citadel" document. It is a filter:

1. Which institutional families are real and persistent?
2. Which ones are compatible with our data, venue, and latency?
3. Which ones can be expressed with the strategy engine we already have?

## How To Infer Institutional Strategy Families

The exact recipes are private, but the family of strategy is often visible through:

- SEC Form ADV / IAPD disclosures
- SEC Form 13F position disclosures
- Official research and product pages from quant firms
- Public descriptions of execution, portfolio construction, and risk systems

## Strategy Families

| Family | Public Example | What It Typically Does | Fit For This Bot | Current Bot Analogue | Verdict |
| --- | --- | --- | --- | --- | --- |
| Multi-asset trend / CTA | Man AHL | Trades persistent trends across futures using systematic rules, often across many markets and horizons | High | `trend`, `trendShort`, `momentumBreakoutLong`, `trendRunner*`, `ignitionContinuationLong` | Core family worth pursuing |
| Style / factor momentum and value | AQR | Combines value, momentum, quality, defensive, and related factors in diversified portfolios | Medium | weakly analogous to `cipher`, `momentumBreakoutLong`; no true cross-sectional ranking yet | Add as portfolio/ranker layer, not single-chart entry logic |
| Cross-sectional stat arb | Two Sigma style research stack | Combines many weak signals, data enrichment, ML, and portfolio construction | Medium | meta-models, adaptive config, candidate replay datasets | Strong direction for research layer |
| Mean reversion with regime filters | Common in systematic equities / futures | Buys oversold pullbacks or fades failed moves only when regime supports it | High | `oversoldBounce`, `failedBreakdown`, `bullTrap`, `range` | Keep, but only with stronger regime gating |
| Continuation after impulse / pullback | Common discretionary-to-systematic bridge | Enters after expansion, pullback, and re-acceleration inside trend | High | `cipherContinuationLong`, `cipherContinuationShort`, `ignitionContinuationLong` | Best current live fit |
| Carry / basis / funding | Common in futures and macro systematic books | Uses roll yield, carry, term structure, or funding to tilt entries and sizing | Medium-High | none yet | Good new family for Binance futures research |
| Market making / execution alpha | Citadel Securities style | Prices inventory continuously, captures spread, manages microstructure risk | Low | none | Do not pursue with current infra |
| Volatility / options relative value | Institutional derivatives desks | Trades implied vs realized vol, skew, dispersion, convexity | Low | none | Out of scope for now |
| Portfolio construction / regime allocation | AQR / Two Sigma / many systematic shops | Combines signals, caps correlated risk, adapts exposure by regime | High | strategy selector, meta-model filter, runtime config, adaptive tuning | Must strengthen |

## What Institutions Suggest We Should Copy

### 1. Continuation + Trend, Not Lone Candlestick Setups

Institutional systematic trend is usually not "one candle = one trade". It is:

- multi-horizon trend confirmation
- volatility-aware entry
- portfolio-level diversification
- disciplined stop and risk sizing

That points us toward strengthening:

- `cipherContinuationLong`
- `cipherContinuationShort`
- `ignitionContinuationLong`
- selected trend-following variants with better regime filters

### 2. Portfolio Construction Matters As Much As Entry Logic

Public Two Sigma and AQR material makes it clear that signal generation is only one layer. The rest is:

- data enrichment
- signal combination
- portfolio construction
- execution

For this bot, that means edge is more likely to come from:

- ranking symbols against each other
- not running too many correlated legs at once
- filtering by regime before entry
- allocating more to stronger contexts and less to marginal ones

### 3. Mean Reversion Needs Context, Not Blind Oversold Rules

Institutional mean reversion is usually conditional. It works better when paired with:

- higher-timeframe structure
- liquidity/sweep context
- trend exhaustion
- volatility normalization

That matches the repo's experience so far: raw `oversoldBounce` or `bullTrap` alone are too crude, but the family is still valid if gated properly.

### 4. Market Making Is The Wrong Hill To Climb

Citadel-style edge lives in:

- latency
- inventory management
- order book microstructure
- continuous quoting infrastructure

This repo is not built for that. We should not spend time there.

## Mapping To Current Repo

### Best Existing Institutional Fit

- `cipherContinuationLong`
  - closest to a systematic continuation / pullback engine
  - strongest live evidence today
- `cipherContinuationShort`
  - same family on the short side
  - promising, but still thinner evidence
- `ignitionContinuationLong`
  - compatible with institutional "impulse then continuation" logic
  - should stay in research

### Useful But Underdeveloped

- `trend`, `trendShort`
  - conceptually aligned with CTA logic
  - implementation and filters have not yet produced strong enough results
- `oversoldBounce`, `failedBreakdown`, `bullTrap`, `range`
  - belong to valid mean-reversion families
  - currently too simple or too weakly filtered

### Missing Families We Can Actually Build

- cross-sectional relative strength ranking across symbols
- carry / funding-aware futures tilts
- portfolio exposure caps by correlated cluster
- regime classifier that routes symbols to continuation vs reversion logic

## Priority Roadmap

### Priority 1: Deepen The Continuation Stack

Why:

- best live evidence today
- closest to a real institutional systematic family we can execute now

Work:

1. keep `ADAUSDC` and `LINKUSDC` continuation-long as the benchmark live cluster
2. keep `ETHUSDC` continuation-short in observation mode with richer telemetry
3. expand research around `ignitionContinuationLong` for `SOL` and `XRP`
4. build symbol ranking inside continuation family so the best setup wins capital

### Priority 2: Add Portfolio Construction

Why:

- institutional shops do not stop at entry logic

Work:

1. create a portfolio exposure layer with caps by cluster:
   - majors
   - L1 beta
   - alt momentum
   - TradFi beta
2. penalize simultaneous entries with nearly identical factor exposure
3. add quality ranking using:
   - planned RR
   - higher timeframe alignment
   - volatility regime
   - meta-model probability

### Priority 3: Build A Carry / Funding Family

Why:

- native to Binance futures
- institutional futures books often use carry-like information
- distinct from pure chart pattern logic

Work:

1. collect funding-rate history per symbol
2. add funding and open-interest context into the dataset
3. test simple hypotheses:
   - continuation longs when trend is up and funding is not excessively crowded
   - continuation shorts when trend is down and funding is overly positive
   - avoid shorts after already-negative funding extremes

### Priority 4: Rebuild Mean Reversion With Regime Gates

Why:

- the family is real
- our crude versions have mostly been too permissive or too context-free

Work:

1. only allow reversion in explicitly non-trending or exhaustion regimes
2. require structure events such as:
   - failed breakdown
   - liquidity sweep reclaim
   - volatility compression release
3. retrain meta-models specifically for reversion families

### Priority 5: Cross-Sectional Factor Layer

Why:

- this is the closest practical bridge toward AQR / Two Sigma style investing

Work:

1. compute rolling ranks across the active symbol universe:
   - relative momentum
   - volatility-adjusted momentum
   - distance from moving-average stack
   - carry/funding tilt
2. let rank modulate:
   - whether a strategy may fire
   - position size
   - max concurrent exposure

## Do Not Prioritize

- market making
- latency arbitrage
- options vol arbitrage
- pure 13F-clone investing
- trying to reverse-engineer a single firm's exact secret sauce

These either do not fit our infrastructure or do not map well to Binance-perp execution.

## Concrete Next Experiments

### Experiment A: Continuation Symbol Ranker

Goal:

- choose among multiple valid continuation setups instead of taking all of them equally

Inputs:

- ADX
- EMA stack distance
- pullback depth in ATR
- volume ratio
- planned RR
- meta-model score

Success bar:

- higher average PnL than unranked continuation entries
- lower correlated overlap

### Experiment B: Funding-Aware Futures Filter

Goal:

- test whether funding and crowding improve futures entries

Inputs:

- current funding
- trailing funding percentile
- open interest change
- basis if available

Success bar:

- better continuation-short selectivity
- fewer crowded late entries

### Experiment C: Regime Router

Goal:

- route each symbol into continuation, reversion, or no-trade mode

Inputs:

- trend strength
- volatility compression/expansion
- distance to HTF structure
- breadth of current market move

Success bar:

- mean reversion stops losing in trending tapes
- continuation families avoid chop

## Public Sources Worth Reusing

- AQR on value and momentum across markets:
  - https://www.aqr.com/Insights/Datasets/Value-and-Momentum-Everywhere-Factors-Monthly/
  - https://www.aqr.com/learning-center/systematic-equities/systematic-equities-a-closer-look
- Man AHL on systematic trend following:
  - https://www.man.com/ahl-alpha
  - https://www.man.com/insights/trend-following-optimal-market-mix
- Two Sigma on data, signals, and portfolio construction:
  - https://www.twosigma.com/businesses/investment-management/
- Citadel Securities on market making:
  - https://www.citadelsecurities.com/what-we-do/
- SEC disclosure tools for inferring manager style:
  - https://adviserinfo.sec.gov/IAPD/Content/IapdMain/IAPD_Disclaimer.asp
  - https://www.sec.gov/rules-regulations/staff-guidance/frequently-asked-questions-about-form-13f

## Bottom Line

The best institutional template for this repo is not "high-frequency quant." It is:

- systematic continuation and trend
- conditional mean reversion
- cross-sectional ranking
- portfolio construction
- data-driven filtering

That means the right next build path is:

1. strengthen continuation and regime routing
2. add portfolio construction
3. add carry/funding context
4. only then revisit weaker reversion families
