# Long History Backfill Plan

## Objective

Increase sample size for crypto backtests without burning Binance REST rate limits by using Binance's public historical archives.

Primary source:

- [Binance Public Data](https://github.com/binance/binance-public-data)

## First priorities

- `BTCUSDC`
  - `1h`
  - `15m`
- `ETHUSDC`
  - `1h`
- `ADAUSDC`
  - `5m`
  - `15m`
- `LINKUSDC`
  - `5m`
  - `15m`
- `1000SHIBUSDC`
  - `15m`
- `1000PEPEUSDC`
  - `15m`
  - `1h`

## Policy

- Use `monthly` archives for full closed months.
- Use `daily` archives for the current month through yesterday.
- Keep this history separate from live/runtime state.
- Only let backtests use it when explicitly enabled.

## Commands

Backfill the default crypto set for the last 12 full months plus current-month daily files:

```bash
cd /Users/joel/Documents/CoddingStuff/TorusAiTrading
npm run backfill:binance-public
```

Backfill a smaller set:

```bash
cd /Users/joel/Documents/CoddingStuff/TorusAiTrading
BINANCE_PUBLIC_BACKFILL_SYMBOLS=BTCUSDC,ETHUSDC,ADAUSDC,LINKUSDC \
BINANCE_PUBLIC_BACKFILL_INTERVALS=5m,15m,1h \
BINANCE_PUBLIC_BACKFILL_MONTHS=18 \
npm run backfill:binance-public
```

Use the public-history cache in the candidate backtester:

```bash
cd /Users/joel/Documents/CoddingStuff/TorusAiTrading
BACKTEST_USE_PUBLIC_HISTORY_CACHE=1 \
BACKTEST_SYMBOLS=BTCUSDC,ETHUSDC \
TF=1h HTF_TF=1d \
node research/backtest-candidate-strategies.js
```

## Why opt-in

The public archive is excellent for long history, but it is not the same thing as an intraday live sync. Keeping this path opt-in prevents accidental drift in current research runs that expect fresh REST candles.

## Next step after this layer

- add a freshness check so the backtester can combine public archives with recent REST candles automatically
- add a server-safe nightly backfill job for the priority symbols/timeframes
