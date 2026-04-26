# ETH Cipher Short 1h Management Sweep

Date: 2026-04-26

Scope:
- symbol: `ETHUSDC`
- strategy: `cipherContinuationShort`
- timeframe: `1h / 1d`
- window: `2025-04-26 -> 2026-04-26`

Artifacts:
- [`base-management.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/eth-cipher-short-1h-management-sweep/base-management.json)
- [`be040-lock002.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/eth-cipher-short-1h-management-sweep/be040-lock002.json)
- [`be040-lock002-tp090.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/eth-cipher-short-1h-management-sweep/be040-lock002-tp090.json)
- [`be035-lock002-tp090.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/eth-cipher-short-1h-management-sweep/be035-lock002-tp090.json)
- [`be030-lock002.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/eth-cipher-short-1h-management-sweep/be030-lock002.json)
- [`be030-lock002-tp090.json`](/Users/joel/Documents/CoddingStuff/TorusAiTrading/research/eth-cipher-short-1h-management-sweep/be030-lock002-tp090.json)

## Summary

| Variant | Trades | Winrate | Avg PnL % | PF | Max DD % |
|---|---:|---:|---:|---:|---:|
| Base | 10 | 60.00 | 0.3912 | 1.589 | 3.7102 |
| BE 0.40 / lock 0.02 | 11 | 36.36 | 0.3323 | 2.038 | 1.9119 |
| BE 0.40 / lock 0.02 / TP 0.90 | 11 | 36.36 | 0.2671 | 1.835 | 1.9119 |
| BE 0.35 / lock 0.02 / TP 0.90 | 12 | 33.33 | 0.2472 | 1.850 | 1.9119 |
| BE 0.30 / lock 0.02 | 12 | 25.00 | 0.2138 | 8.018 | 0.7429 |
| BE 0.30 / lock 0.02 / TP 0.90 | 12 | 25.00 | 0.1894 | 7.216 | 0.7429 |

## Main Learnings

- Moving break-even earlier clearly reduces drawdown.
- Reducing TP distance to `0.90x` did not help; it lowered expectancy in every tested case.
- `BE 0.40` is the best compromise in this sweep:
  - expectancy stays relatively close to base
  - max drawdown is roughly cut in half
  - profit factor improves
- `BE 0.30` protects trades like the recent ETH short much earlier, but it also cuts too many winners and collapses winrate.

## Recent ETH Short

The recent live loss around `2026-04-25` was not saved by the `BE 0.40` backtest variant because the replay entry for the equivalent signal was lower (`2307.69`), which moved the `0.40R` trigger down to roughly `2298.23`.

That same replayed trade is protected under `BE 0.30`:
- original stop: `2331.336846`
- adjusted stop after BE: `2307.21706308`
- outcome changes from `-1.0247%` to about `+0.0205%`

## Recommendation

- Keep the current global move to `BREAK_EVEN_TRIGGER_R=0.40`.
- Do not shorten ETH short TP globally based on this sweep.
- If ETH short continues to show the same pattern live, consider a symbol-specific experiment at `0.30R` only for `ETHUSDC` instead of changing the whole continuation family.
