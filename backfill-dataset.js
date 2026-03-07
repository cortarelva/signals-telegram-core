const axios = require("axios")
const fs = require("fs")

const SYMBOL = "BTCUSDC"
const TF = "5m"
const LIMIT = 1000
const BATCHES = 10

const BINANCE = "https://api.binance.com/api/v3/klines"

const RSI_MIN = 30
const RSI_MAX = 60
const SL_ATR_MULT = 1.2
const TP_ATR_MULT = 1.6
const PULLBACK_BAND_ATR = 0.25

function ema(values, period) {
  const k = 2 / (period + 1)
  let ema = values[0]

  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k)
  }

  return ema
}

function calcEMA(values, period) {
  if (values.length < period) return null
  return ema(values.slice(values.length - period), period)
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null

  let gains = 0
  let losses = 0

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }

  if (losses === 0) return 100

  const rs = gains / losses
  return 100 - 100 / (1 + rs)
}

function calcATR(candles, period = 14) {

  if (candles.length < period + 1) return null

  let trs = []

  for (let i = candles.length - period; i < candles.length; i++) {

    const high = candles[i].high
    const low = candles[i].low
    const prevClose = candles[i - 1].close

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )

    trs.push(tr)
  }

  return trs.reduce((a, b) => a + b, 0) / period
}

async function fetchKlines() {

  let all = []
  let endTime = undefined

  for (let i = 0; i < BATCHES; i++) {

    const res = await axios.get(BINANCE, {
      params: {
        symbol: SYMBOL,
        interval: TF,
        limit: LIMIT,
        endTime
      }
    })

    const batch = res.data.map(k => ({
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      time: k[0]
    }))

    all = [...batch, ...all]

    endTime = batch[0].time - 1

    console.log("Fetched candles:", all.length)

    await new Promise(r => setTimeout(r, 200))
  }

  return all
}

async function main() {

  console.log("Fetching candles...")

  const candles = await fetchKlines()

  console.log("Simulating trades...")

  const trades = simulateTrades(candles)

  console.log("Trades generated:", trades.length)

  fs.writeFileSync(
    "backtest-dataset.json",
    JSON.stringify(trades, null, 2)
  )

  console.log("Dataset written to backtest-dataset.json")
}
function simulateTrades(candles) {

  const trades = []
  const closes = []

  for (let i = 0; i < candles.length; i++) {

    closes.push(candles[i].close)

    if (closes.length < 200) continue

    const ema50 = calcEMA(closes, 50)
    const ema200 = calcEMA(closes, 200)
    const rsi = calcRSI(closes)
    const atr = calcATR(candles.slice(0, i + 1))

    if (!ema50 || !ema200 || !rsi || !atr) continue

    const bullish = ema50 > ema200
    const dist = Math.abs(candles[i].close - ema50)
    const nearEma50 = dist <= PULLBACK_BAND_ATR * atr
    const rsiInBand = rsi >= RSI_MIN && rsi <= RSI_MAX

    if (!(bullish && nearEma50 && rsiInBand)) continue

    const entry = candles[i].close
    const sl = entry - SL_ATR_MULT * atr
    const tp = entry + TP_ATR_MULT * atr

    let outcome = "OPEN"
    let maxHigh = entry
    let minLow = entry
    let barsOpen = 0

    for (let j = i + 1; j < candles.length; j++) {

      const c = candles[j]

      maxHigh = Math.max(maxHigh, c.high)
      minLow = Math.min(minLow, c.low)

      barsOpen++

      if (c.low <= sl) {
        outcome = "SL"
        break
      }

      if (c.high >= tp) {
        outcome = "TP"
        break
      }
    }

    trades.push({
      symbol: SYMBOL,
      entry,
      sl,
      tp,
      rsi,
      atr,
      outcome,
      maxHighDuringTrade: maxHigh,
      minLowDuringTrade: minLow,
      barsOpen
    })
  }

  return trades
}
main()