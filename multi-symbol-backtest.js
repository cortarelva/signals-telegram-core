const axios = require("axios")

const SYMBOLS = [
  "BTCUSDC",
  "ETHUSDC",
  "BNBUSDC",
  "SOLUSDC",
  "LINKUSDC"
]

const TF = "5m"

const RSI_MIN = 35
const RSI_MAX = 45
const SL_ATR_MULT = 2.5
const TP_ATR_MULT = 1.8
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


function backtest(symbol, candles) {

  const closes = candles.map(c => c.close)

  const ema50 = ema(closes, 50)
  const ema200 = ema(closes, 200)

  const rsi = calcRSI(closes)
  const atr = calcATR(candles)

  let openTrade = null

  const trades = []

  for (let i = 200; i < candles.length; i++) {

    const price = closes[i]

    const r = rsi[i - 14]
    const atrVal = atr[i - 14]

    const bullish = ema50[i] > ema200[i]

    const distToEma = Math.abs(price - ema50[i])

    const nearEma50 = distToEma <= PULLBACK_BAND_ATR * atrVal

    const rsiInBand = r >= RSI_MIN && r <= RSI_MAX

    if (!openTrade) {

      if (bullish && nearEma50 && rsiInBand) {

        const entry = price
        const sl = entry - SL_ATR_MULT * atrVal
        const tp = entry + TP_ATR_MULT * atrVal

        openTrade = { entry, sl, tp }
      }

    } else {

      const candle = candles[i]

      if (candle.low <= openTrade.sl) {

        trades.push("SL")
        openTrade = null
      }

      else if (candle.high >= openTrade.tp) {

        trades.push("TP")
        openTrade = null
      }
    }
  }

  return trades
}


function analyzeSymbol(symbol, trades) {

  const tp = trades.filter(t => t === "TP").length
  const sl = trades.filter(t => t === "SL").length

  const total = trades.length

  const winrate = (tp / total) * 100

  const expectancy =
    (tp / total) * TP_ATR_MULT -
    (sl / total) * SL_ATR_MULT

  return {
    symbol,
    total,
    tp,
    sl,
    winrate,
    expectancy
  }
}


async function main() {

  let allTrades = []

  const results = []

  for (const symbol of SYMBOLS) {

    console.log("\nFetching", symbol)

    const candles = await fetchCandles(symbol)

    const trades = backtest(symbol, candles)

    const stats = analyzeSymbol(symbol, trades)

    results.push(stats)

    allTrades = allTrades.concat(trades)
  }

  console.log("\n====== PER SYMBOL ======")

  results.forEach(r => {

    console.log(
      r.symbol,
      "trades:", r.total,
      "TP:", r.tp,
      "SL:", r.sl,
      "winrate:", r.winrate.toFixed(2) + "%",
      "expectancy:", r.expectancy.toFixed(3)
    )
  })


  const tp = allTrades.filter(t => t === "TP").length
  const sl = allTrades.filter(t => t === "SL").length

  const total = allTrades.length

  const winrate = (tp / total) * 100

  const expectancy =
    (tp / total) * TP_ATR_MULT -
    (sl / total) * SL_ATR_MULT

  console.log("\n====== GLOBAL RESULT ======")

  console.log("Trades:", total)
  console.log("TP:", tp)
  console.log("SL:", sl)
  console.log("Winrate:", winrate.toFixed(2) + "%")
  console.log("Expectancy:", expectancy.toFixed(3))
}

main()