# SHIB / PEPE Backtest Notes

## Universe

Confirmed Binance Futures symbols used for this research:

- `1000SHIBUSDC`
- `1000PEPEUSDC`

## Base Runs

- [`/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/shib-pepe-all-strategies-5m.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/shib-pepe-all-strategies-5m.json)
- [`/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/shib-pepe-all-strategies-15m.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/shib-pepe-all-strategies-15m.json)
- [`/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/shib-pepe-all-strategies-1h.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/shib-pepe-all-strategies-1h.json)
- [`/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/shib-pepe-1h-focus.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/shib-pepe-1h-focus.json)

## Best Candidates

### 1000SHIBUSDC

#### Best robust short candidate

- `cipherContinuationShort`
- `15m / 1d`
- `25` trades
- `60.00%` winrate
- `avgPnlPct +0.1831%`
- `profitFactor 1.488`
- `maxDrawdownPct 2.5196`

Why it matters:

- decent sample
- clean drawdown
- better robustness than the flashier but smaller-sample reversion setups

#### Best high-expectancy long candidate

- `cipherContinuationLong`
- `1h / 1d`
- `27` trades
- `74.07%` winrate
- `avgPnlPct +0.6163%`
- `profitFactor 1.688`
- `maxDrawdownPct 9.6400`

Why it matters:

- strongest SHIB expectancy found in this sweep
- continuation family remains the cleanest fit
- drawdown is higher than the short setup, so this is better as a research/paper candidate first

#### Secondary candidate

- `bullTrap`
- `15m / 1d`
- `36` trades
- `44.44%` winrate
- `avgPnlPct +0.1137%`
- `profitFactor 1.414`
- `maxDrawdownPct 2.7055`

Why it is secondary:

- positive and robust enough
- but less structurally aligned with the bot's current strongest continuation family

### 1000PEPEUSDC

#### Best clean continuation candidate

- `cipherContinuationLong`
- `1h / 1d`
- `19` trades
- `68.42%` winrate
- `avgPnlPct +0.6786%`
- `profitFactor 1.545`
- `maxDrawdownPct 7.0704`

Why it matters:

- strongest PEPE expectancy among the cleaner setups
- continuation logic looks more trustworthy than raw mean reversion
- sample is still slightly thin for immediate live inclusion

#### Best lower-timeframe short candidate

- `cipherContinuationShort`
- `5m / 1d`
- `25` trades
- `60.00%` winrate
- `avgPnlPct +0.0400%`
- `profitFactor 1.180`
- `maxDrawdownPct 1.9282`

Why it matters:

- stable enough to keep on the board
- edge is thinner than the SHIB short setup

## What Looks Good But Is Probably Too Risky

### 1000PEPEUSDC

- `oversoldBounce` on `1h / 1d`
  - `124` trades
  - `avgPnlPct +0.3226%`
  - `profitFactor 1.245`
  - `maxDrawdownPct 23.4166`
- `breakdownRetestShort` on `1h / 1d`
  - `108` trades
  - `avgPnlPct +0.2990%`
  - `profitFactor 1.233`
  - `maxDrawdownPct 29.8051`

Interpretation:

- these have signal on paper
- drawdowns are far too heavy for comfortable promotion into the current live runtime

## What I Would Actually Test Next

### Candidate research preset

1. `1000SHIBUSDC`
   - `CIPHER_CONTINUATION_SHORT` on `15m / 1d`
   - `CIPHER_CONTINUATION_LONG` on `1h / 1d`
2. `1000PEPEUSDC`
   - `CIPHER_CONTINUATION_LONG` on `1h / 1d`
   - `CIPHER_CONTINUATION_SHORT` on `5m / 1d` as a secondary candidate

### Candidate live promotion order

1. `1000SHIBUSDC` short continuation on `15m`
2. `1000SHIBUSDC` long continuation on `1h`
3. `1000PEPEUSDC` long continuation on `1h`

## Bottom Line

The family worth adapting for these meme contracts is not raw oversold reversion.

The strongest reusable edge is:

- `cipherContinuationShort` for SHIB on `15m`
- `cipherContinuationLong` for SHIB on `1h`
- `cipherContinuationLong` for PEPE on `1h`

That means SHIB and PEPE look more compatible with the bot's continuation stack than with the older mean-reversion stack.
