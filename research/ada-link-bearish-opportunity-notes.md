# ADA/LINK bearish opportunity notes

Date: 2026-04-27

## Question

The relevant question was not "why did the current long setup not fire?" but:

- what clues were present before the ADA/LINK selloff happened?
- can those clues be turned into a profitable bearish family?

## What the event miner found

Short-only mining on `ADAUSDC` and `LINKUSDC` (`5m / 1d`) found `817` downside events:

- `ADAUSDC`: `409`
- `LINKUSDC`: `408`

Main archetypes:

- `generic_breakdown`: `363`
- `breakdown_continuation_base`: `285`
- `trend_acceleration_breakdown`: `69`
- `clean_impulse_breakdown`: `58`
- `late_selloff_extension`: `42`

The most important discovery is that many selloffs do **not** begin in a clean bearish trend. The dominant pattern is closer to:

- HTF neutral or mixed
- no formal trend and no formal range on LTF
- weak base around `EMA20/EMA50`
- no bullish stack
- volume expansion on breakdown
- strong downside follow-through with low MAE

For `breakdown_continuation_base` specifically:

- `count`: `285`
- `avgMoveAtr`: `3.14`
- `avgMaeAtr`: `0.27`
- `avgCloseProgress`: `0.756`
- `avgAdx`: `24.08`
- `avgRelativeVol`: `2.17x`
- `trendRate`: `0`
- `rangeRate`: `0`

## Experimental family tested

An experimental research-only strategy named `breakdownContinuationBaseShort` was built to capture that archetype.

It was **discarded** after testing.

Backtest results with costs:

- `5m`: `2` trades, `avgNet -0.0409%`, `pfNet 0.801`
- `15m`: `2` trades, `avgNet -0.6721%`, `pfNet 0.000`
- `1h`: `2` trades, `avgNet +2.4263%`, but sample far too small to trust

Why it was discarded:

- too few trades
- costs kill the small edge in `5m`
- `15m` is outright weak
- `1h` looks good but is only `2` trades, which is not enough to justify keeping the family

## Practical conclusion

What we learned is still useful:

- the current live `LONG` filters were not the main issue
- the missing capability is a bearish family for neutral-to-weak breakdowns
- the first detector built from these clues was not robust enough

So the right conclusion today is:

- keep the clues
- discard the first implementation
- revisit with a new bearish family only when we can encode the archetype with more sample and better frequency

## Second iteration: promising 15m version

The family was rebuilt as a new research-only `breakdownContinuationBaseShort` detector with a looser base definition:

- `baseBars = 4`
- `minImpulseAtr = 0.5`
- `maxBaseRangeAtr = 2.25`
- `maxBaseRecoveryFrac = 0.58`
- `maxBaseCloseRecoveryFrac = 0.48`
- `minPlannedRr = 0.8`
- volume kept optional

This version is still weak in `5m` and `1h`, but the `15m / 1d` profile became usable.

Focused backtest with costs on `ADAUSDC + LINKUSDC + BTCUSDC`:

- `30` trades
- `60%` winrate
- `avgNet +0.0507%`
- `pfNet 1.133`
- `maxDD 2.91%`

Symbol breakdown:

- `ADAUSDC`: `14` trades, `avgNet +0.0766%`, `pfNet 1.192`
- `BTCUSDC`: `7` trades, `avgNet +0.0654%`, `pfNet 1.239`
- `LINKUSDC`: `9` trades, `avgNet -0.0010%`, `pfNet 0.998`

Combined subsets:

- `ADAUSDC + BTCUSDC`: `21` trades, `avgNet +0.0729%`, `pfNet 1.204`
- `ADAUSDC + LINKUSDC`: `23` trades, `avgNet +0.0462%`, `pfNet 1.111`
- `BTCUSDC + LINKUSDC`: `16` trades, `avgNet +0.0281%`, `pfNet 1.076`

Practical conclusion of the second iteration:

- the family is now good enough to keep in research
- `15m` is the only timeframe that deserves attention
- `ADAUSDC` and `BTCUSDC` are the cleanest candidates
- `LINKUSDC` is neutral-to-weak and should not lead promotion decisions
