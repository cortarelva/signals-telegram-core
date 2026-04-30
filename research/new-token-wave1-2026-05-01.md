# New Token Wave 1

Date: 2026-05-01

First deep research wave on newly added hunt symbols, keeping the same quality bar and using longer Binance public-history backfills where useful.

## Symbols tested

- `AVAXUSDT`
- `SUIUSDT`
- `NEARUSDT`
- `ARBUSDT`

## 1h results

- `AVAXUSDT 1h cipherContinuationLong`
  - `12` trades
  - `avgNet +1.3242%`
  - `PF 4.685`
  - `maxDD 2.8799%`
  - status: `observe`
  - read: strongest result of wave 1 so far

- `NEARUSDT 1h cipherContinuationLong`
  - `20` trades
  - `avgNet +0.5334%`
  - `PF 1.437`
  - `maxDD 18.0861%`
  - status: `observe`, but drawdown is too heavy

- `ARBUSDT 1h failedBreakdown`
  - `9` trades
  - `avgNet -0.1979%`
  - `PF 0.827`
  - `maxDD 8.4315%`
  - status: `archive`

- `NEARUSDT 1h oversoldBounce`
  - `67` trades
  - `avgNet -0.0408%`
  - `PF 0.969`
  - `maxDD 30.4146%`
  - status: `archive`

## 15m results

- `AVAXUSDT 15m breakdownContinuationBaseShort`
  - `24` trades
  - `avgNet +0.5053%`
  - `PF 3.369`
  - `maxDD 1.4005%`
  - status: `observe`
  - read: very promising bearish lane candidate

- `ARBUSDT 15m cipherContinuationLong`
  - `24` trades
  - `avgNet +0.2629%`
  - `PF 1.522`
  - `maxDD 3.8160%`
  - status: `observe`

- `NEARUSDT 15m failedBreakdown`
  - `12` trades
  - `avgNet +0.0426%`
  - `PF 1.089`
  - `maxDD 2.8346%`
  - status: weak `observe` at best

- `SUIUSDT`
  - no convincing lane found in wave 1
  - status: `archive for now`

## Conclusions

- `AVAXUSDT` is the best new symbol found in wave 1.
- `AVAXUSDT 1h cipherContinuationLong` and `AVAXUSDT 15m breakdownContinuationBaseShort` both deserve deeper validation.
- `ARBUSDT 15m cipherContinuationLong` is promising enough to keep in the lab.
- `NEARUSDT` shows directionality, but the cleaner 1h result still carries too much drawdown and the reversal lane failed on longer history.
- `SUIUSDT` does not yet justify more attention.

## Next steps

1. Run `Monte Carlo` and promotion-gate style checks for:
   - `AVAXUSDT 1h cipherContinuationLong`
   - `AVAXUSDT 15m breakdownContinuationBaseShort`
   - `ARBUSDT 15m cipherContinuationLong`
2. Open wave 2 on:
   - `APTUSDT`
   - `OPUSDT`
   - `UNIUSDT`
   - `ATOMUSDT`
   - `INJUSDT`
   - `FETUSDT`
3. Keep everything in `lab/observe` only until it survives the same long-history discipline.
