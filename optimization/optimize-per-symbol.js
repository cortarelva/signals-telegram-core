const axios = require("axios")

const SYMBOLS = [
  "BTCUSDC",
  "ETHUSDC",
  "BNBUSDC",
  "SOLUSDC",
  "LINKUSDC",
  "SHIBUSDC",
]

const TF = "5m"

const RSI_MIN_VALUES = [30, 35, 38, 40, 42]
const RSI_MAX_VALUES = [45, 48, 50, 52, 55]

const SL_VALUES = [1.5, 2.0, 2.5]
const TP_VALUES = [1.5, 1.8, 2.0, 2.5]

const PULLBACK_BAND_ATR = 0.4


async function fetchCandles(symbol, total = 2000) {

  const limit = 1000
  const candles = []

  let endTime = Date.now()

  while (candles.length < total) {

    const res = await axios.get(
      "https://api.binance.com/api/v3/klines",
      {
        params: {
          symbol,
          interval: TF,
          limit,
          endTime
        }
      }
    )

    const batch = res.data.map(c => ({
      open: +c[1],
      high: +c[2],
      low: +c[3],
      close: +c[4],
      time: c[0]
    }))

    candles.unshift(...batch)

    endTime = batch[0].time - 1

    console.log(symbol, "candles:", candles.length)

    await new Promise(r => setTimeout(r, 300))
  }

  return candles.slice(-total)
}


function ema(values, period) {

  const k = 2 / (period + 1)

  let ema = values[0]

  const result = []

  for (let v of values) {
    ema = v * k + ema * (1 - k)
    result.push(ema)
  }

  return result
}


function calcRSI(values, period = 14) {

  const rsi = []

  for (let i = period; i < values.length; i++) {

    let gains = 0
    let losses = 0

    for (let j = i - period + 1; j <= i; j++) {

      const diff = values[j] - values[j - 1]

      if (diff > 0) gains += diff
      else losses -= diff
    }

    const rs = gains / losses || 0

    rsi.push(100 - 100 / (1 + rs))
  }

  return rsi
}


function calcATR(candles, period = 14) {

  const atr = []

  for (let i = period; i < candles.length; i++) {

    let sum = 0

    for (let j = i - period + 1; j <= i; j++) {

      const high = candles[j].high
      const low = candles[j].low
      const prevClose = candles[j - 1].close

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      )

      sum += tr
    }

    atr.push(sum / period)
  }

  return atr
}


function backtest(candles, params) {

  const closes = candles.map(c => c.close)

  const ema50 = ema(closes, 50)
  const ema200 = ema(closes, 200)

  const rsi = calcRSI(closes)
  const atr = calcATR(candles)

  let openTrade = null

  let tp = 0
  let sl = 0

  for (let i = 200; i < candles.length; i++) {

    const price = closes[i]

    const r = rsi[i - 14]
    const atrVal = atr[i - 14]

    const bullish = ema50[i] > ema200[i]

    const distToEma = Math.abs(price - ema50[i])

    const nearEma50 = distToEma <= PULLBACK_BAND_ATR * atrVal

    const rsiInBand =
      r >= params.rsiMin &&
      r <= params.rsiMax

    if (!openTrade) {

      if (bullish && nearEma50 && rsiInBand) {

        const entry = price
        const slPrice = entry - params.sl * atrVal
        const tpPrice = entry + params.tp * atrVal

        openTrade = { entry, slPrice, tpPrice }
      }

    } else {

      const candle = candles[i]

      if (candle.low <= openTrade.slPrice) {

        sl++
        openTrade = null
      }

      else if (candle.high >= openTrade.tpPrice) {

        tp++
        openTrade = null
      }
    }
  }

  const total = tp + sl

  if (total === 0) return null

  const winrate = tp / total

  const expectancy =
    winrate * params.tp -
    (1 - winrate) * params.sl

  return {
    total,
    tp,
    sl,
    winrate,
    expectancy
  }
}


async function main() {

  for (const symbol of SYMBOLS) {

    console.log("\n===== OPTIMIZING", symbol, "=====")

    const candles = await fetchCandles(symbol)

    let best = null

    for (const rsiMin of RSI_MIN_VALUES)
    for (const rsiMax of RSI_MAX_VALUES)
    for (const sl of SL_VALUES)
    for (const tp of TP_VALUES) {

      if (rsiMin >= rsiMax) continue

      const params = {
        rsiMin,
        rsiMax,
        sl,
        tp
      }

      const stats = backtest(candles, params)

      if (!stats) continue

      const result = {
        ...params,
        ...stats
      }

      if (!best || result.expectancy > best.expectancy) {
        best = result
      }
    }

    console.log("BEST RESULT")

    console.log(best)
  }
}

main()