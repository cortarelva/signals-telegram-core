# Vortex Filter Comparison

Generated: 2026-04-29T21:25:22.202Z
Symbols: BTCUSDC, ETHUSDC
Strategies: breakdownRetestShort, cipherContinuationLong, cipherContinuationShort
TF: 1h | HTF: 1d

## Baseline

- trades: 15
- avgNet: 0.8499%
- profitFactor: 4.926
- maxDD: 1.2085%

- cipherContinuationLong: trades=3, avgNet=1.2115%, pf=999.000, maxDD=0.0000%
- cipherContinuationShort: trades=3, avgNet=0.8415%, pf=3.464, maxDD=1.0247%
- breakdownRetestShort: trades=9, avgNet=0.7321%, pf=3.965, maxDD=1.2085%

## Vortex aligned (14, spread>=0.03)

- trades: 15
- avgNet: 0.8499%
- profitFactor: 4.926
- maxDD: 1.2085%

- cipherContinuationLong: trades=3, avgNet=1.2115%, pf=999.000, maxDD=0.0000%
- cipherContinuationShort: trades=3, avgNet=0.8415%, pf=3.464, maxDD=1.0247%
- breakdownRetestShort: trades=9, avgNet=0.7321%, pf=3.965, maxDD=1.2085%

## Vortex fresh cross (14, <=4 bars)

- trades: 4
- avgNet: 0.2569%
- profitFactor: 1.504
- maxDD: 2.0387%

- breakdownRetestShort: trades=3, avgNet=0.6841%, pf=3.024, maxDD=1.0140%
- cipherContinuationLong: trades=0, avgNet=0.0000%, pf=0.000, maxDD=0.0000%
- cipherContinuationShort: trades=1, avgNet=-1.0247%, pf=0.000, maxDD=1.0247%

