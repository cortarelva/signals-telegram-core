require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { paperExecute, closeExecutionForSignal } = require("./paper-executor");

const BASE_CONFIG = require("./strategy-config.json");
const GENERATED_CONFIG_FILE = path.join(__dirname, "strategy-config.generated.json");

function loadStrategyConfig() {
  let generatedConfig = {};

  try {
    generatedConfig = JSON.parse(
      fs.readFileSync(GENERATED_CONFIG_FILE, "utf8")
    );
  } catch {
    generatedConfig = {};
  }

  const mergedConfig = { ...BASE_CONFIG };

  for (const symbol of Object.keys(generatedConfig)) {
    mergedConfig[symbol] = {
      ...(BASE_CONFIG[symbol] || {}),
      ...generatedConfig[symbol],
    };
  }

  return mergedConfig;
}

const strategyConfig = loadStrategyConfig();

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

const DEFAULT_RSI_MIN = Number(process.env.RSI_MIN || 35);
const DEFAULT_RSI_MAX = Number(
  process.env.RSI_MAX || process.env.RSI_MAX_ENTRY || 45
);

const DEFAULT_PULLBACK_EMA20_ATR = Number(
  process.env.PULLBACK_EMA20_ATR || 0.8
);
const DEFAULT_PULLBACK_EMA50_ATR = Number(
  process.env.PULLBACK_EMA50_ATR || 1.2
);

const DEFAULT_SL_ATR_MULT = Number(
  process.env.SL_ATR_MULT || process.env.ATR_MULT_SL || 2.5
);
const DEFAULT_TP_ATR_MULT = Number(
  process.env.TP_ATR_MULT || process.env.ATR_MULT_TP || 1.8
);

const BINANCE_BASE = "https://api.binance.com";
const STATE_FILE = path.join(__dirname, "state.json");

// regime defaults
const REGIME_MIN_EMA_SEPARATION_PCT = Number(
  process.env.REGIME_MIN_EMA_SEPARATION_PCT || 0.0010
);
const REGIME_MIN_EMA_SLOPE_PCT = Number(
  process.env.REGIME_MIN_EMA_SLOPE_PCT || 0.00006
);
const REGIME_MIN_ATR_PCT = Number(
  process.env.REGIME_MIN_ATR_PCT || 0.00045
);

const RANGE_MAX_EMA_SLOPE_PCT = Number(
  process.env.RANGE_MAX_EMA_SLOPE_PCT || 0.00009
);
const RANGE_MAX_ATR_PCT = Number(
  process.env.RANGE_MAX_ATR_PCT || 0.0010
);

const ADX_MIN_TREND = Number(process.env.ADX_MIN_TREND || 20);

// executor defaults
const PAPER_MIN_SCORE = Number(process.env.PAPER_MIN_SCORE || 70);
const PAPER_MAX_OPEN_TRADES_TOTAL = Number(
  process.env.PAPER_MAX_OPEN_TRADES_TOTAL || 3
);
const PAPER_MAX_OPEN_TRADES_PER_SYMBOL = Number(
  process.env.PAPER_MAX_OPEN_TRADES_PER_SYMBOL || 1
);

// =========================
// Utils
// =========================

function keyFor(symbol, tf) {
  return `${symbol}_${tf}`;
}

function round(n, decimals = 2) {
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(decimals));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeRatio(numerator, denominator) {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return numerator / denominator;
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      lastSignal: parsed.lastSignal || {},
      openSignals: Array.isArray(parsed.openSignals) ? parsed.openSignals : [],
      closedSignals: Array.isArray(parsed.closedSignals)
        ? parsed.closedSignals
        : [],
      executions: Array.isArray(parsed.executions) ? parsed.executions : [],
      signalLog: Array.isArray(parsed.signalLog) ? parsed.signalLog : [],
    };
  } catch {
    return {
      lastSignal: {},
      openSignals: [],
      closedSignals: [],
      executions: [],
      signalLog: [],
    };
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
    await axios.post(
      url,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text,
      },
      { timeout: 15000 }
    );
  } catch (err) {
    console.error("[TG] erro ao enviar mensagem:", err.response?.data || err.message);
  }
}


function buildExecutedTradeTelegramMessage({
  symbol,
  tf,
  side,
  entry,
  sl,
  tp,
  score,
  signalClass,
  execResult,
}) {
  const order = execResult?.order || {};
  const qty = Number(order.quantity || 0);
  const tradeUsd = Number(order.tradeUsd || order.positionUsd || 0);
  const mode = order.mode || execResult?.mode || "unknown";

  return (
    `*TRADE EXECUTADA* 🟢\n` +
    `${symbol} ${tf}\n\n` +
    `*Side:* ${side}\n` +
    `*Entry:* ${round(entry, 6)}\n` +
    `*SL:* ${round(sl, 6)}\n` +
    `*TP:* ${round(tp, 6)}\n` +
    `*Qty:* ${round(qty, 8)}\n` +
    `*Notional:* ${round(tradeUsd, 2)}\n` +
    `*Mode:* ${mode}\n\n` +
    `*Score:* ${score}\n` +
    `*Class:* ${signalClass}`
  );
}

function buildClosedTradeTelegramMessage({
  symbol,
  tf,
  closedSignal,
  closedExecution = null,
}) {
  const outcomeLabel = closedSignal.outcome === "TP" ? "✅ TP" : "❌ SL";

  const realExitPrice = Number(closedExecution?.exitPrice);
  const theoreticalExit =
    closedSignal.outcome === "TP"
      ? Number(closedSignal.tp)
      : closedSignal.outcome === "SL"
      ? Number(closedSignal.sl)
      : Number(closedSignal.exitRef || 0);

  const shownExit =
    Number.isFinite(realExitPrice) && realExitPrice > 0
      ? realExitPrice
      : theoreticalExit;

  const shownPnl = Number.isFinite(Number(closedExecution?.pnlPct))
    ? Number(closedExecution.pnlPct)
    : Number(closedSignal.pnlPct || 0);

  const mode = closedExecution?.mode || "unknown";

  return (
    `*TRADE FECHADA* ${outcomeLabel}\n` +
    `${symbol} ${tf}\n\n` +
    `*Mode:* ${mode}\n` +
    `*Entry:* ${round(closedSignal.entry, 6)}\n` +
    `*Exit:* ${round(shownExit, 6)}\n` +
    `*PnL:* ${round(shownPnl, 2)}%\n` +
    `*RR:* ${round(closedSignal.rrRealized ?? 0, 2)}`
  );
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

function calcADX(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 2) return null;

  const trs = [];
  const plusDMs = [];
  const minusDMs = [];

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];

    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;

    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );

    trs.push(tr);
  }

  if (trs.length < period) return null;

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let plusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let minusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  let plusDI = atr === 0 ? 0 : (100 * plusDM) / atr;
  let minusDI = atr === 0 ? 0 : (100 * minusDM) / atr;
  let dx =
    plusDI + minusDI === 0
      ? 0
      : (100 * Math.abs(plusDI - minusDI)) / (plusDI + minusDI);

  const dxs = [dx];

  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    plusDM = (plusDM * (period - 1) + plusDMs[i]) / period;
    minusDM = (minusDM * (period - 1) + minusDMs[i]) / period;

    plusDI = atr === 0 ? 0 : (100 * plusDM) / atr;
    minusDI = atr === 0 ? 0 : (100 * minusDM) / atr;
    dx =
      plusDI + minusDI === 0
        ? 0
        : (100 * Math.abs(plusDI - minusDI)) / (plusDI + minusDI);

    dxs.push(dx);
  }

  return dxs.length ? dxs[dxs.length - 1] : null;
}

// =========================
// Regime / Scoring
// =========================

function detectMarketRegime({
  lastClose,
  ema20,
  ema50,
  ema200,
  prevEma50,
  atr,
  adx,
}) {
  const bullish = ema50 > ema200;
  const bullishFast = ema20 > ema50;
  const stackedEma = ema20 > ema50 && ema50 > ema200;

  const emaSeparationPct =
    lastClose > 0 ? Math.abs(ema50 - ema200) / lastClose : 0;

  const emaSlopePct =
    prevEma50 && prevEma50 !== 0
      ? Math.abs(ema50 - prevEma50) / prevEma50
      : 0;

  const atrPct = lastClose > 0 ? atr / lastClose : 0;

  const isTrend =
    emaSeparationPct >= REGIME_MIN_EMA_SEPARATION_PCT &&
    emaSlopePct >= REGIME_MIN_EMA_SLOPE_PCT &&
    atrPct >= REGIME_MIN_ATR_PCT &&
    Number(adx || 0) >= ADX_MIN_TREND;

  const isRange =
    emaSlopePct < RANGE_MAX_EMA_SLOPE_PCT &&
    atrPct < RANGE_MAX_ATR_PCT &&
    Number(adx || 0) < ADX_MIN_TREND;

  return {
    bullish,
    bullishFast,
    stackedEma,
    isTrend,
    isRange,
    emaSeparationPct,
    emaSlopePct,
    atrPct,
  };
}

function calculateSignalScore({
  bullish,
  nearPullback,
  rsiInBand,
  rsiRising,
}) {
  let score = 0;

  if (bullish) score += 30;
  if (nearPullback) score += 25;
  if (rsiInBand) score += 25;
  if (rsiRising) score += 20;

  return clamp(score, 0, 100);
}

function classifySignal(score) {
  if (score >= 70) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

// =========================
// Signal / Tracking
// =========================

function buildSignal({
  symbol,
  tf,
  entry,
  atr,
  ema20,
  ema50,
  ema200,
  rsi,
  adx,
  slAtrMult,
  tpAtrMult,
  score,
  signalClass,
  isTrend,
  emaSeparationPct,
  emaSlopePct,
}) {
  const side = "BUY";
  const sl = round(entry - slAtrMult * atr, 6);
  const tp = round(entry + tpAtrMult * atr, 6);

  const msg =
    `*SINAL (CORE)* — ${symbol} ${tf}\n` +
    `*Side:* ${side}\n` +
    `*Entry:* ${entry}\n` +
    `*SL:* ${sl}\n` +
    `*TP:* ${tp}\n` +
    `*Class:* ${signalClass}\n` +
    `*Score:* ${score}\n\n` +
    `EMA20=${round(ema20, 6)} | EMA50=${round(ema50, 6)} | EMA200=${round(ema200, 6)}\n` +
    `RSI14=${round(rsi, 1)} | ATR14=${round(atr, 6)} | ADX14=${round(adx || 0, 2)}\n` +
    `Trend=${isTrend} | Sep=${round(emaSeparationPct * 100, 3)}% | Slope=${round(
      emaSlopePct * 100,
      3
    )}%`;

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
  if (last.side === side && entryDiffPct < 0.0015) return false;

  return true;
}

function updateTracker(state, { symbol, tf, candleHigh, candleLow, candleClose }) {
  if (!Array.isArray(state.openSignals) || state.openSignals.length === 0) return [];

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
    const risk = Math.abs(s.entry - s.sl);
    const reward = Math.abs(exitPrice - s.entry);

    s.closedTs = Date.now();
    s.outcome = outcome;
    s.exitRef = candleClose;
    s.pnlPct = s.entry !== 0 ? ((exitPrice - s.entry) / s.entry) * 100 : null;
    s.rrRealized = safeRatio(reward, risk);

    closedNow.push(s);
  }

  state.openSignals = stillOpen;

  if (!Array.isArray(state.closedSignals)) state.closedSignals = [];
  state.closedSignals.push(...closedNow);

  return closedNow;
}

// =========================
// Core per symbol
// =========================

async function processSymbol(symbol, state) {
  const cfg = strategyConfig[symbol];

  if (!cfg || !cfg.ENABLED) return;

  const RSI_MIN = Number(cfg.RSI_MIN ?? DEFAULT_RSI_MIN);
  const RSI_MAX = Number(cfg.RSI_MAX ?? DEFAULT_RSI_MAX);
  const SL_ATR_MULT = Number(cfg.SL_ATR_MULT ?? DEFAULT_SL_ATR_MULT);
  const TP_ATR_MULT = Number(cfg.TP_ATR_MULT ?? DEFAULT_TP_ATR_MULT);
  const PULLBACK_EMA20_ATR = Number(
    cfg.PULLBACK_EMA20_ATR ?? DEFAULT_PULLBACK_EMA20_ATR
  );
  const PULLBACK_EMA50_ATR = Number(
    cfg.PULLBACK_EMA50_ATR ?? DEFAULT_PULLBACK_EMA50_ATR
  );

  console.log(`[CORE] ${symbol} TF=${TF} limit=${LIMIT} (spot-long only)`);

  const candles = await fetchKlines(symbol, TF, LIMIT);

  if (!candles || candles.length < 220) {
    console.log(`[CORE] ${symbol} candles insuficientes.`);
    return;
  }

  const closedCandles = candles.slice(0, -1);

  if (!closedCandles || closedCandles.length < 220) {
    console.log(`[CORE] ${symbol} velas fechadas insuficientes.`);
    return;
  }

  const closes = closedCandles.map((c) => c.close);
  const last = closedCandles[closedCandles.length - 1];

  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const prevEma50 = calcEMA(closes.slice(0, -1), 50);
  const atr = calcATR(closedCandles, 14);
  const adx = calcADX(closedCandles, 14);
  const rsiSeries = calcRSISeries(closes, 14);

  if (!ema20 || !ema50 || !ema200 || !prevEma50 || !atr || !adx || rsiSeries.length < 2) {
    console.log(`[CORE] ${symbol} indicadores insuficientes.`);
    return;
  }

  const {
    bullish,
    bullishFast,
    stackedEma,
    isTrend,
    isRange,
    emaSeparationPct,
    emaSlopePct,
    atrPct,
  } = detectMarketRegime({
    lastClose: last.close,
    ema20,
    ema50,
    ema200,
    prevEma50,
    atr,
    adx,
  });

  const rsi = rsiSeries[rsiSeries.length - 1];
  const prevRsi = rsiSeries[rsiSeries.length - 2];

  const distToEma20 = Math.abs(last.close - ema20);
  const distToEma50 = Math.abs(last.close - ema50);

  const nearEma20 = distToEma20 <= PULLBACK_EMA20_ATR * atr;
  const nearEma50 = distToEma50 <= PULLBACK_EMA50_ATR * atr;
  const nearPullback = nearEma20 || nearEma50;

  const rsiInBand = rsi >= RSI_MIN && rsi <= RSI_MAX;
  const rsiRising = rsi > prevRsi;

  const closedNow = updateTracker(state, {
    symbol,
    tf: TF,
    candleHigh: last.high,
    candleLow: last.low,
    candleClose: last.close,
  });

  for (const c of closedNow) {
    let closedExec = null;

    try {
      closedExec = await closeExecutionForSignal(state, c);
    } catch (err) {
      console.error(
        `[EXECUTOR_CLOSE] erro ao fechar ${c.symbol}:`,
        err.body || err.message || err
      );
    }

    const effectivePnl = Number.isFinite(Number(closedExec?.pnlPct))
      ? Number(closedExec.pnlPct)
      : Number(c.pnlPct || 0);

    const effectiveExit = Number.isFinite(Number(closedExec?.exitPrice))
      ? Number(closedExec.exitPrice)
      : Number(c.exitRef || 0);

    console.log(
      `[TRACKER] ${symbol} ${TF} closed outcome=${c.outcome} entry=${round(
        c.entry,
        6
      )} exit=${round(effectiveExit, 6)} pnlPct=${round(
        effectivePnl,
        2
      )} rr=${round(c.rrRealized ?? 0, 2)}`
    );

    const closeMsg = buildClosedTradeTelegramMessage({
      symbol,
      tf: TF,
      closedSignal: c,
      closedExecution: closedExec,
    });

    await sendTelegramMessage(closeMsg);
  }

  console.log(
    `[REGIME] ${symbol} trend=${isTrend} range=${isRange} ` +
      `sep=${round(emaSeparationPct * 100, 3)}% ` +
      `slope=${round(emaSlopePct * 100, 3)}% ` +
      `atrPct=${round(atrPct * 100, 3)}% adx=${round(adx, 2)}`
  );

  console.log(
    `[CORE] ${symbol} close=${round(last.close, 6)} ema20=${round(ema20, 6)} ema50=${round(
      ema50,
      6
    )} ema200=${round(ema200, 6)} ` +
      `rsi=${round(rsi, 2)} prevRsi=${round(prevRsi, 2)} atr=${round(atr, 6)} adx=${round(adx, 2)} ` +
      `bullish=${bullish} bullishFast=${bullishFast} stackedEma=${stackedEma} ` +
      `nearEma20=${nearEma20} nearEma50=${nearEma50} nearPullback=${nearPullback} ` +
      `rsiInBand=${rsiInBand} rsiRising=${rsiRising}`
  );

  const score = calculateSignalScore({
    bullish,
    nearPullback,
    rsiInBand,
    rsiRising,
  });

  const signalClass = classifySignal(score);
  const entry = last.close;

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
    prevRsi,
    atr,
    atrPct,
    adx,
    ema20,
    ema50,
    ema200,
    bullish,
    bullishFast,
    nearEma20,
    nearEma50,
    nearPullback,
    stackedEma,
    rsiInBand,
    rsiRising,
    isTrend,
    isRange,
    emaSeparationPct,
    emaSlopePct,
    distToEma20,
    distToEma50,
    executionAttempted: false,
    executionApproved: false,
    executionReason: null,
    executionOrderId: null,
  });

  if (state.signalLog.length > 5000) {
    state.signalLog.shift();
  }

  console.log(
    `[SIGNAL] ${symbol} ${TF} score=${score} class=${signalClass} ` +
      `bullish=${bullish} pullback=${nearPullback} rsiBand=${rsiInBand} rsiUp=${rsiRising}`
  );

  const shouldBuy = signalClass === "EXECUTABLE";

  if (!shouldBuy) {
    return;
  }

  const { side, sl, tp } = buildSignal({
    symbol,
    tf: TF,
    entry,
    atr,
    ema20,
    ema50,
    ema200,
    rsi,
    adx,
    slAtrMult: SL_ATR_MULT,
    tpAtrMult: TP_ATR_MULT,
    score,
    signalClass,
    isTrend,
    emaSeparationPct,
    emaSlopePct,
  });

  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);

  if (risk === 0 || reward === 0) {
    console.log(`[CORE] ${symbol} risco/reward inválido — ignorado.`);
    return;
  }

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
    signalTs: Date.now(),
    ema20,
    ema50,
    ema200,
    rsi,
    atr,
    atrPct,
    adx,
    prevRsi,
    distToEma20,
    distToEma50,
    bullish,
    bullishFast,
    nearEma20,
    nearEma50,
    nearPullback,
    stackedEma,
    rsiInBand,
    rsiRising,
    isTrend,
    isRange,
    emaSeparationPct,
    emaSlopePct,
    cooldownPassed:
      (Date.now() - (state.lastSignal[keyFor(symbol, TF)]?.ts || 0)) / 60000 >=
      COOLDOWN_MINS,
    entryDiffPctFromLast: entryDiffPct,
    maxHighDuringTrade: entry,
    minLowDuringTrade: entry,
    barsOpen: 0,
    pnlPct: null,
    rrPlanned: safeRatio(reward, risk),
    rrRealized: null,
    score,
    signalClass,
  };

  if (!shouldSendSignal(state, signalObj, COOLDOWN_MINS)) {
    console.log(`[CORE] ${symbol} sinal repetido/cooldown — ignorado.`);
    return;
  }

  console.log(
    `[EXECUTOR_CALL] ${symbol} class=${signalClass} score=${score} entry=${entry}`
  );

  const execResult = await paperExecute(signalObj, state, {
    minScore: PAPER_MIN_SCORE,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: PAPER_MAX_OPEN_TRADES_TOTAL,
    maxOpenTradesPerSymbol: PAPER_MAX_OPEN_TRADES_PER_SYMBOL,
    allowedSymbols: SYMBOLS,
  });

  if (execResult.executed) {
    state.lastSignal[keyFor(symbol, TF)] = {
      ts: signalObj.ts,
      side: signalObj.side,
      entry: signalObj.entry,
    };
  }

  signalObj.executionAttempted = true;
  signalObj.executionApproved = execResult.executed;
  signalObj.executionReason = execResult.reason || null;
  signalObj.executionOrderId = execResult.order?.id || null;

  const lastSignalLogEntry = state.signalLog[state.signalLog.length - 1];
  if (lastSignalLogEntry) {
    lastSignalLogEntry.executionAttempted = true;
    lastSignalLogEntry.executionApproved = execResult.executed;
    lastSignalLogEntry.executionReason = execResult.reason || null;
    lastSignalLogEntry.executionOrderId = execResult.order?.id || null;
  }

  if (!Array.isArray(state.executions)) {
    state.executions = [];
  }

  if (!Array.isArray(state.openSignals)) {
    state.openSignals = [];
  }

  if (execResult.executed && execResult.order) {
    state.executions.push(execResult.order);
    state.openSignals.push(signalObj);
  }

  console.log(
    `[EXECUTOR] ${symbol} executed=${execResult.executed} reason=${execResult.reason}`
  );

  saveState(state);

  if (execResult.executed && execResult.order) {
    const execMsg = buildExecutedTradeTelegramMessage({
      symbol,
      tf: TF,
      side,
      entry,
      sl,
      tp,
      score,
      signalClass,
      execResult,
    });

    console.log(execMsg);
    await sendTelegramMessage(execMsg);
  } else {
    console.log(`[TG] ${symbol} sem execução — não envia Telegram.`);
  }
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