# New Token Wave 2 (Partial)

Date: 2026-05-01

Second research wave on the expanded token universe, focused first on `APTUSDT` and `OPUSDT`.

Important note:

- the first raw `Monte Carlo` reruns used the default backtest window and understated the sample
- the final numbers below were rerun with long-history limits:
  - `1h`: `8760` LTF candles
  - `15m`: `35040` LTF candles
  - `HTF`: `600` daily candles

## Symbols covered in this partial wave

- `APTUSDT`
- `OPUSDT`
- `UNIUSDT`
- `ATOMUSDT`
- `INJUSDT`
- `FETUSDT`

## Hunt findings

### 1h

- `OPUSDT 1h bullTrap`
  - `27` trades
  - `avgNet +0.3077%`
  - `PF 1.351`
  - `maxDD 6.0284%`
  - initial hunt status: `live`

- `OPUSDT 1h cipherContinuationLong`
  - `23` trades
  - `avgNet +1.0214%`
  - `PF 2.249`
  - `maxDD 9.8088%`
  - initial hunt status: `observe`

- `APTUSDT 1h liquiditySweepReclaimLong`
  - `4` trades
  - `avgNet +0.7097%`
  - `PF 2.911`
  - `maxDD 1.4858%`
  - initial hunt status: `observe`, but sample short

### 15m

- `OPUSDT 15m cipherContinuationLong`
  - `29` trades
  - `avgNet +0.1726%`
  - `PF 1.308`
  - `maxDD 4.9842%`
  - initial hunt status: `live`

- `APTUSDT 15m bullTrap`
  - `38` trades
  - `avgNet +0.0860%`
  - `PF 1.197`
  - `maxDD 3.8086%`
  - initial hunt status: `observe`

## Long-window Monte Carlo follow-up

### `OPUSDT 1h bullTrap`

- `27` trades
- `avgNet +0.4377%`
- `PF 1.537`
- bootstrap `p05 avgNet = -0.2390%`
- bootstrap `p05 PF = 0.779`
- shuffled-order `p95 maxDD = 11.5145%`
- recommendation: `exploratory`

Read:

- point estimate is decent
- lower bound still breaks too easily
- better than random noise, but not strong enough yet for blind promotion

### `OPUSDT 15m cipherContinuationLong`

- `71` trades
- `avgNet +0.3258%`
- `PF 1.620`
- bootstrap `p05 avgNet = +0.0479%`
- bootstrap `p05 PF = 1.069`
- shuffled-order `p95 maxDD = 12.0400%`
- recommendation: `exploratory`

Read:

- this is the strongest result in the partial wave
- unlike several other candidates, its lower bound stayed positive
- drawdown stress is still meaningful, so it belongs in `exploratory/observe`, not live yet

### `APTUSDT 15m bullTrap`

- `123` trades
- `avgNet +0.1555%`
- `PF 1.394`
- bootstrap `p05 avgNet = -0.0033%`
- bootstrap `p05 PF = 0.993`
- shuffled-order `p95 maxDD = 12.0036%`
- recommendation: `exploratory`

Read:

- clearly better than the first short-window impression
- robust enough to keep in the lab
- not yet clean enough to call a true promotion candidate

## Provisional ranking

1. `OPUSDT 15m cipherContinuationLong`
   - best balance of sample size and positive lower bound
2. `OPUSDT 1h bullTrap`
   - solid enough to stay near the front of the queue
3. `APTUSDT 15m bullTrap`
   - useful, but a tier below `OP`

## Wave 2 extension: `UNI/ATOM/INJ/FET` on `1h`

Deep `1h` hunt with long public-history cache:

- `ATOMUSDT 1h bullTrap`
  - `22` trades
  - `avgNet +0.4930%`
  - `PF 1.922`
  - `maxDD 4.1752%`
  - status: `live` by hunt gate

- `ATOMUSDT 1h cipherContinuationLong`
  - `18` trades
  - `avgNet +0.4522%`
  - `PF 1.627`
  - `maxDD 4.4467%`
  - status: `live` by hunt gate

- `FETUSDT 1h bullTrap`
  - `16` trades
  - `avgNet +0.9225%`
  - `PF 2.313`
  - `maxDD 5.1389%`
  - status: `observe`

- `ATOMUSDT 1h liquiditySweepReclaimLong`
  - `4` trades
  - `avgNet +0.8730%`
  - `PF 4.208`
  - `maxDD 1.0885%`
  - status: `observe`, sample short

- `UNIUSDT 1h liquiditySweepReclaimLong`
  - `4` trades
  - `avgNet +0.8216%`
  - `PF 2.795`
  - `maxDD 1.8308%`
  - status: `observe`, sample short

Additional `observe`, but weaker or with heavy drawdown:

- `FETUSDT 1h breakdownContinuationBaseShort`
  - `34` trades
  - `avgNet +0.2863%`
  - `PF 1.188`
  - `maxDD 18.7786%`

- `FETUSDT 1h oversoldBounce`
  - `65` trades
  - `avgNet +0.2323%`
  - `PF 1.178`
  - `maxDD 13.6333%`

- `INJUSDT 1h oversoldBounce`
  - `62` trades
  - `avgNet +0.1754%`
  - `PF 1.132`
  - `maxDD 21.4692%`

- `UNIUSDT 1h bullTrap`
  - `22` trades
  - `avgNet +0.1721%`
  - `PF 1.184`
  - `maxDD 5.5956%`

- `UNIUSDT 1h breakdownRetestShort`
  - `62` trades
  - `avgNet +0.1653%`
  - `PF 1.148`
  - `maxDD 16.4197%`

Read:

- `ATOMUSDT` is the big surprise of the extension
- both `bullTrap` and `cipherContinuationLong` now deserve immediate `Monte Carlo`
- `FETUSDT` also deserves more respect than expected, especially `bullTrap`
- `UNI` and `INJ` are still more secondary than primary

## Monte Carlo follow-up on the best `1h` extension lanes

### `ATOMUSDT 1h bullTrap`

- `22` trades
- `avgNet +0.6230%`
- `PF 2.309`
- bootstrap `p05 avgNet = +0.0380%`
- bootstrap `p05 PF = 1.065`
- shuffled-order `p95 maxDD = 5.9412%`
- recommendation: `exploratory`

Read:

- strongest `ATOM` lane so far
- lower bound stayed positive
- drawdown stress stayed under control
- still not auto-promoted by the current Monte Carlo classifier, but this is one of the cleanest exploratory candidates found outside the original universe

### `ATOMUSDT 1h cipherContinuationLong`

- `18` trades
- `avgNet +0.5822%`
- `PF 1.850`
- bootstrap `p05 avgNet = -0.1928%`
- bootstrap `p05 PF = 0.829`
- shuffled-order `p95 maxDD = 8.4631%`
- recommendation: `exploratory`

Read:

- point estimate remains attractive
- lower-bound fragility is meaningfully worse than `ATOM bullTrap`
- worth keeping, but behind the `bullTrap` lane in priority

### `FETUSDT 1h bullTrap`

- `16` trades
- `avgNet +1.0525%`
- `PF 2.610`
- bootstrap `p05 avgNet = +0.0582%`
- bootstrap `p05 PF = 1.052`
- shuffled-order `p95 maxDD = 7.3409%`
- recommendation: `exploratory`

Read:

- this is the highest raw edge of the extension set
- sample is still smaller than `ATOM`
- but the lower bound stayed positive, which matters a lot
- this deserves to stand beside `ATOM bullTrap` near the top of the lab queue

## Execution note on `15m`

- a full long-history `15m` hunt across four symbols and all strategy families was too expensive for the information gained
- the right next step is to split `15m` into smaller chunks by:
  - fewer symbols at a time
  - or fewer strategy families per run
- that keeps the same standard while using compute more intelligently

## Conclusion

- `OPUSDT` is the first genuinely interesting symbol of wave 2
- the `15m cipherContinuationLong` lane deserves sustained attention
- `ATOMUSDT` is now the strongest new `1h` surprise after the wave 2 extension
- `FETUSDT 1h bullTrap` also upgraded itself from curiosity to serious exploratory candidate
- `APTUSDT` is not dead, but still reads more like lab material than promotion-ready edge
- next:
  - compare `AVAX`, `ATOM`, `FET`, `OP` under one promotion-style shortlist
  - `15m` reruns in smaller focused chunks
