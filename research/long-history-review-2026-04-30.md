# Long-History Review 2026-04-30

## Scope

Long-window replay and backtest refresh using Binance public historical archives:

- `1h`: `BTCUSDC, ETHUSDC, ADAUSDC, LINKUSDC, 1000SHIBUSDC, 1000PEPEUSDC, SOLUSDC, XRPUSDC, BNBUSDC, DOGEUSDC`
- `15m`: `BTCUSDC, ETHUSDC, ADAUSDC, LINKUSDC, 1000SHIBUSDC, 1000PEPEUSDC, SOLUSDC, XRPUSDC`
- `5m`: `ADAUSDC, LINKUSDC`

Backfill cache:

- `research/cache/binance-public-history`

## Main findings

### BTC / ETH 1h

Source:

- `research/btc-eth-long-history-1h.json`

Results with costs:

- `BTCUSDC cipherContinuationLong`
  - `21` trades
  - `avgNet +0.0294%`
  - `PF 1.052`
  - `maxDD 4.8894%`
- `BTCUSDC breakdownRetestShort`
  - `67` trades
  - `avgNet -0.0676%`
  - `PF 0.886`
  - `maxDD 15.3568%`
- `BTCUSDC cipherContinuationShort`
  - `10` trades
  - `avgNet -0.1649%`
  - `PF 0.751`
  - `maxDD 4.6664%`
- `ETHUSDC cipherContinuationShort`
  - `14` trades
  - `avgNet -0.0674%`
  - `PF 0.933`
  - `maxDD 8.8524%`

Conclusion:

- `BTC` short lanes lost license.
- `ETH` short lane also lost license.
- `BTC` long survives only as a weak watchlist lane, not a strong core lane.

### ADA / LINK 5m

Sources:

- `research/ada-link-long-history-5m.json`
- `research/ada-long-history-5m-no-premacd.json`
- `research/ada-long-history-5m-strict.json`
- `research/ada-long-history-5m-require-sr.json`
- `research/ada-long-history-5m-resistance-only.json`
- `research/ada-long-history-5m-no-premacd-resistance.json`
- `research/link-long-history-5m-no-sr-hardblock.json`
- `research/link-long-history-5m-resistance-only.json`
- `research/link-long-history-5m-support-only.json`

`ADAUSDC`:

- current lane:
  - `44` trades
  - `avgNet -0.0723%`
  - `PF 0.736`
  - `maxDD 5.4593%`
- no `preMacdStructureOverride`:
  - `38` trades
  - `avgNet -0.0255%`
  - `PF 0.898`
  - `maxDD 5.2368%`
- strict trend mode:
  - `32` trades
  - `avgNet -0.0591%`
  - `PF 0.787`
- require SR pass:
  - `2` trades
  - `avgNet -0.1315%`
  - `PF 0.461`

Conclusion for `ADA`:

- the `preMacd` override hurts, but disabling it does not fully save the lane.
- no tested variant earned core license.

`LINKUSDC`:

- no SR hard block:
  - `37` trades
  - `avgNet +0.0921%`
  - `PF 1.466`
  - `maxDD 3.8812%`
- hard block `resistance_too_close` only:
  - `25` trades
  - `avgNet +0.0941%`
  - `PF 1.441`
  - `maxDD 2.7075%`
- hard block `too_far_from_support` only:
  - `14` trades
  - `avgNet -0.0477%`
  - `PF 0.819`

Conclusion for `LINK`:

- the lane remains viable.
- `resistance_too_close` is the right hard block.
- `too_far_from_support` overblocks and destroys too much edge.

### SHIB 15m

Source:

- `research/shib-long-history-15m.json`

Results:

- `1000SHIBUSDC cipherContinuationShort`
  - `49` trades
  - `avgNet +0.1586%`
  - `PF 1.431`
  - `maxDD 3.8196%`

Conclusion:

- `SHIB 15m short` remains one of the cleanest live lanes.

### Bearish 15m family

Source:

- `research/bearish-long-history-15m.json`

Results:

- `breakdownContinuationBaseShort`
  - `0` trades in the tested long-window run

Conclusion:

- current `15m` bearish family configuration is too dry to deserve live promotion.

## Live actions justified by this review

- disable `ADAUSDC 5m cipherContinuationLong`
- disable `ETHUSDC 1h cipherContinuationShort`
- disable `BTCUSDC 1h breakdownRetestShort`
- disable `BTCUSDC 1h cipherContinuationShort`
- keep `BTCUSDC 1h cipherContinuationLong` as a weaker bullish regime lane
- keep `LINKUSDC 5m cipherContinuationLong` with `srHardBlockReasons = [\"resistance_too_close\"]`
- keep `1000SHIBUSDC 15m cipherContinuationShort`
