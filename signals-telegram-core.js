require("dotenv").config();

const strategyConfig = require("./strategy-config.json");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// =========================
// Config
// =========================

const SYMBOLS = Object.keys(strategyConfig).filter(
  (symbol) => strategyConfig[symbol]?.ENABLED
);

const TF = process.env.TF || "5m";
const LIMIT = Number(process.env.LIMIT || 1000);

const COOLDOWN_MINS = Number(process.env.COOLDOWN_MINS || 30);

const ENABLE_TELEGRAM =
  String(process.env.ENABLE_TELEGRAM ?? process.env.SEND_TELEGRAM ?? "0") === "1";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const BATCHES = 10

const RSI_MIN = Number(process.env.RSI_MIN || 35);
const RSI_MAX = Number(process.env.RSI_MAX || process.env.RSI_MAX_ENTRY || 45);
const PULLBACK_BAND_ATR = Number(process.env.PULLBACK_BAND_ATR || 0.4);

const SL_ATR_MULT = Number(process.env.SL_ATR_MULT || process.env.ATR_MULT_SL || 2.5);
const TP_ATR_MULT = Number(process.env.TP_ATR_MULT || process.env.ATR_MULT_TP || 1.8);

const BINANCE_BASE = "https://api.binance.com";
const STATE_FILE = path.join(__dirname, "state.json");



// =========================
// Utils
// =========================
function keyFor(symbol, tf) {
  return `${symbol}_${tf}`;
}

function round(n, decimals = 2) {
  return Number(n.toFixed(decimals));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastSignal: {}, openSignals: [], closedSignals: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sendTelegramMessage(text) {
  if (!ENABLE_TELEGRAM) {
    console.log("[TG] envio desativado.");
    return;
  }

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("[TG] token/chat id em falta.");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("[TG] erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

async function fetchKlines(symbol, interval, limit) {
  const url = `${BINANCE_BASE}/api/v3/klines`;
  const { data } = await axios.get(url, {
    params: { symbol, interval, limit },
    timeout: 15000,
  });

  return data.map((k) => ({
    openTime: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: k[6],
  }));
}
function calculateSignalScore({
  bullish,
  nearEma50,
  rsiInBand,
  rsiRising
}) {

  let score = 0;

  if (bullish) score += 25;
  if (nearEma50) score += 25;
  if (rsiInBand) score += 25;
  if (rsiRising) score += 25;

  return score;
}
// =========================
// Indicators
// =========================
function calcEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;

  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }

  return ema;
}

function calcRSISeries(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) return [];

  const rsis = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsis.push(100 - 100 / (1 + rs));

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsis.push(100 - 100 / (1 + rs));
  }

  return rsis;
}

function calcATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;

  const trs = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    trs.push(tr);
  }

  if (trs.length < period) return null;

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }

  return atr;
}
function calculateSignalScore({
  bullish,
  nearEma50,
  rsiInBand,
  rsiRising
}) {

  let score = 0

  if (bullish) score += 25
  if (nearEma50) score += 25
  if (rsiInBand) score += 25
  if (rsiRising) score += 25

  return score
}
// =========================
// Signal logic
// =========================
function buildSignal({ symbol, tf, entry, atr, ema50, ema200, rsi, slAtrMult, tpAtrMult }) {
  const side = "BUY";
  const sl = round(entry - slAtrMult * atr, 2);
  const tp = round(entry + tpAtrMult * atr, 2);

  const msg =
    `*SINAL (CORE)* — ${symbol} ${tf}\n` +
    `*Side:* ${side}\n` +
    `*Entry:* ${entry}\n` +
    `*SL:* ${sl}\n` +
    `*TP:* ${tp}\n\n` +
    `EMA50=${round(ema50, 2)} | EMA200=${round(ema200, 2)}\n` +
    `RSI14=${round(rsi, 1)} | ATR14=${round(atr, 2)}`;

  return { side, sl, tp, msg };
}

function shouldSendSignal(state, { symbol, tf, side, entry }, cooldownMins = 30) {
  const k = keyFor(symbol, tf);
  const last = state.lastSignal[k];
  const now = Date.now();

  if (!last) return true;

  const ageMin = (now - last.ts) / 60000;
  if (ageMin < cooldownMins) return false;

  const entryDiffPct = Math.abs(entry - last.entry) / (last.entry || entry);
  if (last.side === side && entryDiffPct < 0.0015) return false; // 0.15%

  return true;
}

function updateTracker(state, { symbol, tf, candleHigh, candleLow, candleClose }) {
  if (!Array.isArray(state.openSignals) || state.openSignals.length === 0) return;

  const stillOpen = [];
  const closedNow = [];

  for (const s of state.openSignals) {
    if (s.symbol !== symbol || s.tf !== tf) {
      stillOpen.push(s);
      continue;
    }

    s.maxHighDuringTrade = Math.max(s.maxHighDuringTrade ?? candleHigh, candleHigh);
    s.minLowDuringTrade = Math.min(s.minLowDuringTrade ?? candleLow, candleLow);
    s.barsOpen = (s.barsOpen ?? 0) + 1;

    let outcome = null;

    if (candleLow <= s.sl) outcome = "SL";
    else if (candleHigh >= s.tp) outcome = "TP";

    if (!outcome) {
      stillOpen.push(s);
      continue;
    }

    const exitPrice = outcome === "TP" ? s.tp : s.sl;

    s.closedTs = Date.now();
    s.outcome = outcome;
    s.exitRef = candleClose;
    s.pnlPct = ((exitPrice - s.entry) / s.entry) * 100;
    s.rrRealized = Math.abs(exitPrice - s.entry) / Math.abs(s.entry - s.sl);

    closedNow.push(s);
  }

  state.openSignals = stillOpen;

  if (!Array.isArray(state.closedSignals)) state.closedSignals = [];
  state.closedSignals.push(...closedNow);

  return closedNow;
}

async function processSymbol(symbol, state) {
  const cfg = strategyConfig[symbol];

  if (!cfg || !cfg.ENABLED) {
    return;
  }

  const RSI_MIN = Number(cfg.RSI_MIN);
  const RSI_MAX = Number(cfg.RSI_MAX);
  const SL_ATR_MULT = Number(cfg.SL_ATR_MULT);
  const TP_ATR_MULT = Number(cfg.TP_ATR_MULT);
  const PULLBACK_BAND_ATR = Number(cfg.PULLBACK_BAND_ATR ?? 0.4);

  console.log(`[CORE] ${symbol} TF=${TF} limit=${LIMIT} (spot-long only)`);

  const candles = await fetchKlines(symbol, TF, LIMIT);

  if (!candles || candles.length < 220) {
    console.log(`[CORE] ${symbol} candles insuficientes.`);
    return;
  }

  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];

  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const atr = calcATR(candles, 14);
  const rsiSeries = calcRSISeries(closes, 14);

  if (!ema50 || !ema200 || !atr || rsiSeries.length < 2) {
    console.log(`[CORE] ${symbol} indicadores insuficientes.`);
    return;
  }

  const rsi = rsiSeries[rsiSeries.length - 1];
  const prevRsi = rsiSeries[rsiSeries.length - 2];

  updateTracker(state, {
    symbol,
    tf: TF,
    candleHigh: last.high,
    candleLow: last.low,
    candleClose: last.close,
  });

  const bullish = ema50 > ema200;
  const distToEma50 = Math.abs(last.close - ema50);
  const nearEma50 = distToEma50 <= PULLBACK_BAND_ATR * atr;
  const rsiInBand = rsi >= RSI_MIN && rsi <= RSI_MAX;
  const rsiRising = rsi > prevRsi;

  console.log(
    `[CORE] ${symbol} close=${round(last.close, 2)} ema50=${round(ema50, 2)} ema200=${round(ema200, 2)} ` +
      `rsi=${round(rsi, 2)} prevRsi=${round(prevRsi, 2)} atr=${round(atr, 2)} ` +
      `bullish=${bullish} nearEma50=${nearEma50} rsiInBand=${rsiInBand} rsiRising=${rsiRising}`
  );

  const score = calculateSignalScore({
    bullish,
    nearEma50,
    rsiInBand,
    rsiRising,
  });

  const signalClass =
    score >= 75 ? "EXECUTABLE" : score >= 50 ? "WATCH" : "IGNORE";

    if (!Array.isArray(state.signalLog)) {
  state.signalLog = [];
}

state.signalLog.push({
  ts: Date.now(),
  symbol,
  tf: TF,
  price: last.close,
  score,
  signalClass,
  rsi,
  atr,
  ema50,
  ema200,
  bullish,
  nearEma50,
  rsiInBand,
  rsiRising
});

if (state.signalLog.length > 10000) {
  state.signalLog.shift();
}

  console.log(`[SIGNAL] ${symbol} ${TF} score=${score} class=${signalClass}`);

  const shouldBuy = bullish && nearEma50 && rsiInBand && rsiRising;

  if (!shouldBuy) {
    return;
  }

  const entry = round(last.close, 2);

  const { side, sl, tp, msg } = buildSignal({
    symbol,
    tf: TF,
    entry,
    atr,
    ema50,
    ema200,
    rsi,
    slAtrMult: SL_ATR_MULT,
    tpAtrMult: TP_ATR_MULT,
  });

  const lastSignalForKey = state.lastSignal[keyFor(symbol, TF)];
  const entryDiffPct =
    lastSignalForKey && lastSignalForKey.entry
      ? Math.abs(entry - lastSignalForKey.entry) / lastSignalForKey.entry
      : null;

  const signalObj = {
    symbol,
    tf: TF,
    side,
    entry,
    sl,
    tp,
    ts: Date.now(),
    ema50,
    ema200,
    rsi,
    atr,
    prevRsi,
    distToEma50,
    bullish,
    nearEma50,
    rsiInBand,
    rsiRising,
    cooldownPassed:
      (Date.now() - (state.lastSignal[keyFor(symbol, TF)]?.ts || 0)) / 60000 >=
      COOLDOWN_MINS,
    entryDiffPctFromLast: entryDiffPct,
    maxHighDuringTrade: entry,
    minLowDuringTrade: entry,
    barsOpen: 0,
    pnlPct: null,
    rrPlanned: Math.abs(tp - entry) / Math.abs(entry - sl),
    rrRealized: null,
    score,
    signalClass,
  };

  if (!shouldSendSignal(state, signalObj, COOLDOWN_MINS)) {
    console.log(`[CORE] ${symbol} sinal repetido/cooldown — ignorado.`);
    return;
  }

  state.lastSignal[keyFor(symbol, TF)] = {
    ts: signalObj.ts,
    side: signalObj.side,
    entry: signalObj.entry,
  };

  if (!Array.isArray(state.openSignals)) state.openSignals = [];
  state.openSignals.push(signalObj);

  console.log(msg);
  await sendTelegramMessage(msg);
}

// =========================
// Main
// =========================
async function main() {
  const state = loadState();

  for (const symbol of SYMBOLS) {
    try {
      await processSymbol(symbol, state);
    } catch (err) {
      console.error(
        `[CORE] erro em ${symbol}:`,
        err.response?.data || err.message || err
      );
    }
  }

  saveState(state);
}

main().catch((err) => {
  console.error("[CORE] erro fatal:", err.response?.data || err.message || err);
  process.exit(1);
});