# Production Tune Log 2026-04-29

## Scope

- Strategy: `cipherContinuationLong`
- Symbols targeted: `ADAUSDC`, `LINKUSDC`
- Change type: fine-grained target quality filter

## Change

- Added a new `minTpPct` guard to `cipherContinuationLong`.
- Set `minTpPct: 0.001` (`0.10%`) for:
  - `ADAUSDC.CIPHER_CONTINUATION_LONG`
  - `LINKUSDC.CIPHER_CONTINUATION_LONG`

## Intent

- Filter out micro-target entries that can hit theoretical `TP` but do not leave enough room after fees.
- Keep the existing `too_extended` and pre-MACD structure logic intact.
- Avoid broad relaxations that would open low-quality continuation entries.

## Evidence From 2026-04-29 Live Audit

- `too_extended` `EXECUTABLE` blocked TPs: `14`
- Of those `14`:
  - `11` would still be net profitable after live-like fees
  - `2` were near break-even
  - `3` would be net negative despite hitting TP
- A `0.10%` gross target floor removed the clearly fee-sensitive micro-targets while preserving the stronger TPs in the `too_extended` subset.

## Safety Check Against Closed Live Trades

- Historical closed `cipherContinuationLong` trades inspected from live state were not hit by a `0.10%` target floor.
- The smallest observed planned TP in that closed sample was about `0.105%`, so `0.10%` stays below the live sample floor.

## Validation

- Focused test file:
  - `tests/cipher-continuation-long-premacd-override.test.js`
- Result:
  - `3/3` passing
- New assertion added:
  - tiny pre-MACD targets are rejected with `cipherContinuationLong:tp_pct_too_small`

## Notes

- This is not deployed by this note itself.
- Production promotion should preserve backups and be done only while the bot is flat.
