require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const futuresExecutor = require("./futures-executor");
const { loadRuntimeConfig } = require("./config/load-runtime-config");
const { readJsonSafe, writeJsonAtomic } = require("./file-utils");
const { isLiveSymbolAllowed } = require("./symbol-universe");
const {
  calcEMA,
  calcRSISeries,
  calcATR,
  calcADX,
  detectMarketRegime,
} = require("../indicators/market-indicators");
const { evaluateAllStrategies } = require("../strategies");
const {
  detectSupportResistance,
  nearestSupportBelow,
  nearestResistanceAbove,
  evaluateTradeZone,
} = require("./support-resistance");
const { evaluateMarketStructure } = require("./market-structure");
const { resolveTradeOutcome } = require("./trade-outcome");
const { evaluateMetaModelCandidate } = require("./meta-model-filter");
const {
  rankExecutionCandidates,
} = require("./continuation-ranker");
const {
  resolveExternalHistoryProvider,
  fetchKlinesFromExternalProvider,
} = require("../research/external-history");

// =========================
// Config
// =========================

function getEnabledSymbols() {
  const strategyConfig = loadRuntimeConfig();
  return Object.keys(strategyConfig).filter(
    (symbol) => strategyConfig[symbol]?.ENABLED && isLiveSymbolAllowed(symbol)
  );
}

const TF = process.env.TF || "15m";
const HTF_TF = process.env.HTF_TF || "1d";
const LIMIT = Number(process.env.LIMIT || 1000);
const HTF_LIMIT = Number(process.env.HTF_LIMIT || 400);
const COOLDOWN_MINS = Number(process.env.COOLDOWN_MINS || 10);
const HTF_SWING_LOOKBACK = Number(process.env.HTF_SWING_LOOKBACK || 2);
const LTF_SWING_LOOKBACK = Number(process.env.LTF_SWING_LOOKBACK || 6);
const TREND_SWING_COUNT = Number(process.env.TREND_SWING_COUNT || 2);

const ENABLE_TELEGRAM =
  String(process.env.ENABLE_TELEGRAM ?? process.env.SEND_TELEGRAM ?? "0") ===
  "1";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const DEFAULT_PULLBACK_EMA20_ATR = Number(
  process.env.PULLBACK_EMA20_ATR || 0.8
);
const DEFAULT_PULLBACK_EMA50_ATR = Number(
  process.env.PULLBACK_EMA50_ATR || 1.2
);

const DEFAULT_RANGE_RSI_MIN = Number(process.env.RANGE_RSI_MIN || 35);
const DEFAULT_RANGE_RSI_MAX = Number(process.env.RANGE_RSI_MAX || 45);
const DEFAULT_RANGE_SL_ATR_MULT = Number(process.env.RANGE_SL_ATR_MULT || 2.5);
const DEFAULT_RANGE_TP_ATR_MULT = Number(process.env.RANGE_TP_ATR_MULT || 1.8);

const DEFAULT_TREND_RSI_MIN = Number(process.env.TREND_RSI_MIN || 45);
const DEFAULT_TREND_RSI_MAX = Number(process.env.TREND_RSI_MAX || 60);
const DEFAULT_TREND_SL_ATR_MULT = Number(process.env.TREND_SL_ATR_MULT || 1.4);
const DEFAULT_TREND_TP_ATR_MULT = Number(process.env.TREND_TP_ATR_MULT || 2.8);

const REGIME_MIN_EMA_SEPARATION_PCT = Number(
  process.env.REGIME_MIN_EMA_SEPARATION_PCT || 0.0010
);
const REGIME_MIN_ATR_PCT = Number(
  process.env.REGIME_MIN_ATR_PCT || 0.00045
);
const RANGE_MAX_ATR_PCT = Number(
  process.env.RANGE_MAX_ATR_PCT || 0.0015
);
const ADX_MIN_TREND = Number(process.env.ADX_MIN_TREND || 25);

const TREND_MIN_ADX = Number(process.env.TREND_MIN_ADX || 25);
const TREND_MAX_DIST_EMA20_ATR = Number(
  process.env.TREND_MAX_DIST_EMA20_ATR || 1.2
);
const TREND_MAX_DIST_EMA50_ATR = Number(
  process.env.TREND_MAX_DIST_EMA50_ATR || 1.8
);

const PAPER_MIN_SCORE = Number(process.env.PAPER_MIN_SCORE || 60);
const PAPER_MAX_OPEN_TRADES_TOTAL = Number(
  process.env.PAPER_MAX_OPEN_TRADES_TOTAL || 10
);
const PAPER_MAX_OPEN_TRADES_PER_SYMBOL = Number(
  process.env.PAPER_MAX_OPEN_TRADES_PER_SYMBOL || 2
);
const CONTINUATION_RANKER_ENABLED =
  String(process.env.CONTINUATION_RANKER_ENABLED || "1") === "1";
const CONTINUATION_RANKER_MAX_PER_CYCLE = Number(
  process.env.CONTINUATION_RANKER_MAX_PER_CYCLE || 1
);

const EXECUTION_MODE = String(process.env.EXECUTION_MODE || "paper").toLowerCase();
const FUTURES_ATTACH_TPSL_ON_ENTRY =
  String(process.env.FUTURES_ATTACH_TPSL_ON_ENTRY || "0") === "1";
const META_MODEL_FILTER_ENABLED =
  String(process.env.META_MODEL_FILTER_ENABLED || "1") === "1";
const META_MODEL_FILTER_MODE = String(
  process.env.META_MODEL_FILTER_MODE || "paper_only"
).toLowerCase();
const META_MODEL_MIN_PROB = Number(process.env.META_MODEL_MIN_PROB || 0.55);
const META_MODEL_MIN_TEST_F1 = Number(process.env.META_MODEL_MIN_TEST_F1 || 0.25);
const BINANCE_FUTURES_BASE =
  process.env.BINANCE_FUTURES_BASE || "https://fapi.binance.com";
const STATE_FILE =
  process.env.STATE_FILE_PATH || path.join(__dirname, "state.json");

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


function strategyNeedsGlobalMinAdx(strategy) {
  const s = String(strategy || "").toLowerCase();

  if (!s) return false;

  if (s === "range") return false;
  if (s === "oversoldbounce") return false;

  return true;
}

function shouldApplyMetaModelFilter() {
  if (!META_MODEL_FILTER_ENABLED) return false;
  if (META_MODEL_FILTER_MODE === "always") return true;
  if (META_MODEL_FILTER_MODE === "paper_only") return EXECUTION_MODE === "paper";
  return false;
}

function getPriceDigits(symbol) {
  if (!symbol) return 2;
  if (symbol.includes("SHIB")) return 8;
  if (symbol.includes("XRP")) return 4;
  if (symbol.includes("ADA")) return 4;
  return 2;
}

function fmtPrice(value, symbol) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(getPriceDigits(symbol));
}

function fmtQty(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(8);
}

function fmtUsd(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(digits);
}

function fmtPct(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "-";
  const n = Number(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function tfToMinutes(tf) {
  const m = String(tf || "").match(/^(\d+)(m|h)$/i);
  if (!m) return null;

  const amount = Number(m[1]);
  const unit = m[2].toLowerCase();

  if (unit === "m") return amount;
  if (unit === "h") return amount * 60;
  return null;
}

function getSignalValidityText(tf, candles = 2) {
  const minutesPerCandle = tfToMinutes(tf);
  if (!minutesPerCandle) return `${candles} velas`;
  const total = minutesPerCandle * candles;
  return `${candles} velas (≈ ${total} min)`;
}

function calcDurationText(openTs, closeTs = Date.now()) {
  if (!Number.isFinite(Number(openTs)) || !Number.isFinite(Number(closeTs))) {
    return "-";
  }

  const totalMinutes = Math.max(0, Math.round((closeTs - openTs) / 60000));

  if (totalMinutes < 60) return `${totalMinutes} min`;

  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}min`;
}

function calcPotentialPnLUsdc(entry, target, qty, direction = "LONG") {
  if (
    !Number.isFinite(Number(entry)) ||
    !Number.isFinite(Number(target)) ||
    !Number.isFinite(Number(qty))
  ) {
    return null;
  }

  const e = Number(entry);
  const t = Number(target);
  const q = Number(qty);
  const dir = String(direction || "LONG").toUpperCase();

  if (dir === "SHORT" || dir === "SELL") {
    return (e - t) * q;
  }

  return (t - e) * q;
}

function calcPnlPctByDirection(entry, exit, direction = "LONG") {
  const e = Number(entry);
  const x = Number(exit);
  const dir = String(direction || "LONG").toUpperCase();

  if (!Number.isFinite(e) || !Number.isFinite(x) || e <= 0) return null;

  if (dir === "SHORT" || dir === "SELL") {
    return ((e - x) / e) * 100;
  }

  return ((x - e) / e) * 100;
}

function aggregateCommissionByAsset(fills = []) {
  const totals = {};

  for (const fill of Array.isArray(fills) ? fills : []) {
    const asset = fill?.commissionAsset;
    const amount = Number(fill?.commission || 0);

    if (!asset || !Number.isFinite(amount) || amount <= 0) continue;
    totals[asset] = (totals[asset] || 0) + amount;
  }

  return totals;
}

function mergeCommissionMaps(...maps) {
  const merged = {};

  for (const map of maps) {
    for (const [asset, amount] of Object.entries(map || {})) {
      merged[asset] = (merged[asset] || 0) + amount;
    }
  }

  return merged;
}

function formatCommissionMap(map) {
  const parts = Object.entries(map || {})
    .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
    .map(([asset, amount]) => `${Number(amount).toFixed(8)} ${asset}`);

  return parts.length ? parts.join(" + ") : "-";
}

function getEntryCommissionText(order) {
  const entryMap = aggregateCommissionByAsset(order?.exchange?.entryFills || []);
  const actual = formatCommissionMap(entryMap);

  if (actual !== "-") return actual;

  const tradeUsd = Number(order?.tradeUsd || order?.positionUsd || 0);
  const commissionRate = Number(order?.commissionRate || 0);

  if (tradeUsd > 0 && commissionRate > 0) {
    return `${fmtUsd(tradeUsd * commissionRate, 4)} USDC (estimada)`;
  }

  return "-";
}

function getTotalCommissionText(closedExecution) {
  const entryMap = aggregateCommissionByAsset(
    closedExecution?.exchange?.entryFills || []
  );
  const exitMap = aggregateCommissionByAsset(
    closedExecution?.exchange?.exitFills || []
  );
  const merged = mergeCommissionMaps(entryMap, exitMap);
  const actual = formatCommissionMap(merged);

  if (actual !== "-") return actual;

  const entryQuoteQty = Number(closedExecution?.entryQuoteQty || 0);
  const exitQuoteQty = Number(closedExecution?.exitQuoteQty || 0);
  const tradeUsd = Number(closedExecution?.tradeUsd || 0);
  const commissionRate = Number(closedExecution?.commissionRate || 0);

  const estimatedBase =
    entryQuoteQty > 0 && exitQuoteQty > 0
      ? entryQuoteQty + exitQuoteQty
      : tradeUsd > 0
      ? tradeUsd * 2
      : 0;

  if (estimatedBase > 0 && commissionRate > 0) {
    return `${fmtUsd(estimatedBase * commissionRate, 4)} USDC (estimada)`;
  }

  return "-";
}

function loadState() {
  const parsed = readJsonSafe(STATE_FILE, {});
  return {
    lastSignal: parsed.lastSignal || {},
    lastProcessedClosedCandle:
      parsed.lastProcessedClosedCandle &&
      typeof parsed.lastProcessedClosedCandle === "object" &&
      !Array.isArray(parsed.lastProcessedClosedCandle)
        ? parsed.lastProcessedClosedCandle
        : {},
    openSignals: Array.isArray(parsed.openSignals) ? parsed.openSignals : [],
    closedSignals: Array.isArray(parsed.closedSignals)
      ? parsed.closedSignals
      : [],
    executions: Array.isArray(parsed.executions) ? parsed.executions : [],
    signalLog: Array.isArray(parsed.signalLog) ? parsed.signalLog : [],
  };
}

function saveState(state) {
  writeJsonAtomic(STATE_FILE, state);
}

function markProcessedClosedCandle(state, symbol, tf, candleCloseTime) {
  const normalizedCloseTime = Number(candleCloseTime);
  if (!Number.isFinite(normalizedCloseTime) || normalizedCloseTime <= 0) return;

  if (
    !state.lastProcessedClosedCandle ||
    typeof state.lastProcessedClosedCandle !== "object" ||
    Array.isArray(state.lastProcessedClosedCandle)
  ) {
    state.lastProcessedClosedCandle = {};
  }

  state.lastProcessedClosedCandle[keyFor(symbol, tf)] = normalizedCloseTime;
}

async function sendTelegramMessage(text) {
  if (EXECUTION_MODE === "paper") {
    console.log("[TG] paper mode — não envia Telegram.");
    return;
  }

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
        parse_mode: "Markdown",
      },
      { timeout: 15000 }
    );
  } catch (err) {
    console.error(
      "[TG] erro ao enviar mensagem:",
      err.response?.data || err.message
    );
  }
}

function buildExecutedTradeTelegramMessage({
  symbol,
  tf,
  direction,
  entry,
  sl,
  tp,
  execResult,
}) {
  const strategy = execResult?.order?.strategy || "unknown";
  const order = execResult?.order || {};
  const qty = Number(order.quantity || 0);
  const tradeUsd = Number(order.tradeUsd || order.positionUsd || 0);

  const potentialProfit = calcPotentialPnLUsdc(entry, tp, qty, direction);
  const maxLoss = calcPotentialPnLUsdc(entry, sl, qty, direction);

  const profitPct =
    tradeUsd > 0 && Number.isFinite(potentialProfit)
      ? (potentialProfit / tradeUsd) * 100
      : null;

  const lossPct =
    tradeUsd > 0 && Number.isFinite(maxLoss)
      ? (maxLoss / tradeUsd) * 100
      : null;

  const entryCommission = getEntryCommissionText(order);

  return (
    `🟢 *NOVA TRADE*\n` +
    `${symbol} · ${direction} · ${tf} · ${strategy}\n\n` +
    `*Preço de entrada:* ${fmtPrice(entry, symbol)}\n` +
    `*Take Profit:* ${fmtPrice(tp, symbol)}\n` +
    `*Stop Loss:* ${fmtPrice(sl, symbol)}\n\n` +
    `*Valor investido:* ${fmtUsd(tradeUsd)} USDC\n` +
    `*Quantidade:* ${fmtQty(qty)}\n` +
    `*Comissão de entrada:* ${entryCommission}\n\n` +
    `*Lucro potencial:* ${
      Number.isFinite(potentialProfit)
        ? `${fmtUsd(potentialProfit)} USDC (${fmtPct(profitPct)})`
        : "-"
    }\n` +
    `*Perda máxima:* ${
      Number.isFinite(maxLoss)
        ? `-${fmtUsd(Math.abs(maxLoss))} USDC (-${Math.abs(
            Number(lossPct || 0)
          ).toFixed(2)}%)`
        : "-"
    }\n\n` +
    `*Validade do sinal:* ${getSignalValidityText(tf)}`
  );
}

function buildClosedTradeTelegramMessage({
  symbol,
  tf,
  closedSignal,
  closedExecution = null,
}) {
  const outcomeInfo = resolveTradeOutcome({
    ...closedSignal,
    ...(closedExecution || {}),
  });
  const outcome = outcomeInfo.outcome;
  const realExitPrice = Number(closedExecution?.exitPrice);
  const theoreticalExit =
    outcome === "TP"
      ? Number(closedSignal.tp)
      : outcome === "SL" || outcome === "BE" || outcome === "PROTECTED_SL"
      ? Number(closedSignal.sl)
      : Number(closedSignal.exitRef || 0);

  const shownExit =
    Number.isFinite(realExitPrice) && realExitPrice > 0
      ? realExitPrice
      : theoreticalExit;

  const shownPnlPct = Number.isFinite(Number(closedExecution?.pnlPct))
    ? Number(closedExecution.pnlPct)
    : Number(closedSignal.pnlPct || 0);

  const qty = Number(
    closedExecution?.quantity ||
      closedExecution?.entryExecutedQty ||
      closedSignal?.quantity ||
      0
  );

  const tradeUsd = Number(
    closedExecution?.tradeUsd ||
      closedExecution?.positionUsd ||
      (Number(closedSignal.entry || 0) * qty)
  );

  const grossResultUsd = calcPotentialPnLUsdc(
    closedSignal.entry,
    shownExit,
    qty,
    closedSignal.direction || closedSignal.side || "LONG"
  );

  const commissionText = getTotalCommissionText(closedExecution);
  const durationText = calcDurationText(
    closedSignal.signalTs || closedSignal.ts,
    closedSignal.closedTs
  );

  const title = `${outcomeInfo.statusEmoji} *TRADE FECHADA — ${outcomeInfo.title}*`;

  return (
    `${title}\n` +
    `${symbol} · ${closedSignal.direction || closedSignal.side || "LONG"} · ${tf}\n\n` +
    `*Preço de entrada:* ${fmtPrice(closedSignal.entry, symbol)}\n` +
    `*Preço de saída:* ${fmtPrice(shownExit, symbol)}\n\n` +
    `*Valor investido:* ${fmtUsd(tradeUsd)} USDC\n` +
    `*Resultado:* ${
      Number.isFinite(grossResultUsd)
        ? `${grossResultUsd >= 0 ? "+" : ""}${fmtUsd(grossResultUsd)} USDC`
        : "-"
    }\n` +
    `*Rentabilidade:* ${fmtPct(shownPnlPct)}\n` +
    `*Comissões:* ${commissionText}\n` +
    `*RR:* ${round(closedSignal.rrRealized ?? 0, 2)}\n\n` +
    `*Duração:* ${durationText}`
  );
}

async function fetchKlines(symbol, interval, limit) {
  const externalProvider = resolveExternalHistoryProvider(
    symbol,
    interval,
    process.env
  );

  if (externalProvider) {
    try {
      const rows = await fetchKlinesFromExternalProvider(
        externalProvider,
        symbol,
        interval,
        limit,
        { env: process.env }
      );

      if (Array.isArray(rows) && rows.length > 0) {
        return rows.map((k) => ({
          openTime: Number(k.openTime),
          open: Number(k.open),
          high: Number(k.high),
          low: Number(k.low),
          close: Number(k.close),
          volume: Number(k.volume || 0),
          closeTime: Number(k.closeTime),
        }));
      }

      console.warn(
        `[HISTORY] ${symbol} ${interval} external provider returned no candles; fallback=binance`
      );
    } catch (err) {
      console.warn(
        `[HISTORY] ${symbol} ${interval} external provider failed; fallback=binance reason=${
          err?.message || err
        }`
      );
    }
  }

  const url = `${BINANCE_FUTURES_BASE}/fapi/v1/klines`;
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

function findOpenExecutionForSignal(state, signal) {
  const executions = Array.isArray(state?.executions) ? state.executions : [];

  return (
    executions.find((e) => signal.executionOrderId && e.id === signal.executionOrderId) ||
    executions.find(
      (e) =>
        e.symbol === signal.symbol &&
        e.tf === signal.tf &&
        e.status === "OPEN" &&
        e.direction === signal.direction
    ) ||
    null
  );
}

function getSignalTrackingBaselineCloseTime(signal) {
  const candleCandidates = [
    signal?.lastTrackedCandleCloseTime,
    signal?.signalCandleCloseTime,
    signal?.openedOnCandleCloseTime,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (candleCandidates.length) {
    return Math.max(...candleCandidates);
  }

  const timestampCandidates = [
    signal?.signalTs,
    signal?.ts,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  return timestampCandidates.length ? Math.max(...timestampCandidates) : 0;
}

async function updateTracker(
  state,
  { symbol, tf, candleHigh, candleLow, candleClose, candleCloseTime }
) {
  if (!Array.isArray(state.openSignals) || state.openSignals.length === 0) {
    return [];
  }

  const stillOpen = [];
  const closedNow = [];

  for (const s of state.openSignals) {
    if (s.symbol !== symbol || s.tf !== tf) {
      stillOpen.push(s);
      continue;
    }

    const normalizedCandleCloseTime = Number(candleCloseTime);
    const canDeduplicateByCandle =
      Number.isFinite(normalizedCandleCloseTime) && normalizedCandleCloseTime > 0;
    const trackingBaseline = getSignalTrackingBaselineCloseTime(s);

    if (canDeduplicateByCandle && normalizedCandleCloseTime <= trackingBaseline) {
      stillOpen.push(s);
      continue;
    }

    if (canDeduplicateByCandle) {
      s.lastTrackedCandleCloseTime = normalizedCandleCloseTime;
    }

    s.maxHighDuringTrade = Math.max(s.maxHighDuringTrade ?? candleHigh, candleHigh);
    s.minLowDuringTrade = Math.min(s.minLowDuringTrade ?? candleLow, candleLow);
    s.barsOpen = (s.barsOpen ?? 0) + 1;

    const direction = String(s.direction || s.side || "LONG").toUpperCase();

    let outcome = null;
    if (direction === "SHORT" || direction === "SELL") {
      if (candleHigh >= s.sl) outcome = "SL";
      else if (candleLow <= s.tp) outcome = "TP";
    } else {
      if (candleLow <= s.sl) outcome = "SL";
      else if (candleHigh >= s.tp) outcome = "TP";
    }
    if (!outcome) {
      // Break-even / trailing-to-non-negative (local tracker only)
      const BREAK_EVEN_ENABLED = Number(process.env.BREAK_EVEN_ENABLED || 0) === 1;
      const canApplyExchangeBreakEven =
        EXECUTION_MODE === "binance_real" && FUTURES_ATTACH_TPSL_ON_ENTRY;
      const canApplyLocalBreakEven = !canApplyExchangeBreakEven;
      if (BREAK_EVEN_ENABLED && !s.breakEvenApplied) {
        const BREAK_EVEN_TRIGGER_R = Number(process.env.BREAK_EVEN_TRIGGER_R || 0.65);
        const BREAK_EVEN_LOCK_R = Number(process.env.BREAK_EVEN_LOCK_R || 0.0);
        const BREAK_EVEN_MIN_BARS = Number(process.env.BREAK_EVEN_MIN_BARS || 1);
        const BREAK_EVEN_MIN_NET_USD = Number(process.env.BREAK_EVEN_MIN_NET_USD || 0);
        const BREAK_EVEN_COST_BUFFER_USD = Number(
          process.env.BREAK_EVEN_COST_BUFFER_USD || 0
        );

        const ageBars = Number(s.barsOpen || 0);
        if (ageBars >= BREAK_EVEN_MIN_BARS) {
          const initialRisk =
            Number.isFinite(Number(s.initialRisk)) && Number(s.initialRisk) > 0
              ? Number(s.initialRisk)
              : Math.abs(Number(s.entry) - Number(s.sl));

          if (Number.isFinite(initialRisk) && initialRisk > 0) {
            const favMove =
              direction === "LONG"
                ? Number(candleHigh) - Number(s.entry)
                : Number(s.entry) - Number(candleLow);

            const rNow = favMove / initialRisk;

            if (Number.isFinite(rNow) && rNow >= BREAK_EVEN_TRIGGER_R) {
              const matchedExecution =
                canApplyLocalBreakEven || canApplyExchangeBreakEven
                  ? findOpenExecutionForSignal(state, s)
                  : null;

              let newSL =
                direction === "LONG"
                  ? Number(s.entry) + initialRisk * BREAK_EVEN_LOCK_R
                  : Number(s.entry) - initialRisk * BREAK_EVEN_LOCK_R;

              const quantity = Number(
                s.quantity ?? matchedExecution?.quantity ?? matchedExecution?.filledQty ?? NaN
              );
              const minGrossUsdToLock = BREAK_EVEN_MIN_NET_USD + BREAK_EVEN_COST_BUFFER_USD;

              if (
                Number.isFinite(quantity) &&
                quantity > 0 &&
                Number.isFinite(minGrossUsdToLock) &&
                minGrossUsdToLock > 0
              ) {
                const minMovePerUnit = minGrossUsdToLock / quantity;
                const minProfitLockPrice =
                  direction === "LONG"
                    ? Number(s.entry) + minMovePerUnit
                    : Number(s.entry) - minMovePerUnit;

                newSL =
                  direction === "LONG"
                    ? Math.max(newSL, minProfitLockPrice)
                    : Math.min(newSL, minProfitLockPrice);
              }

              // Don't move SL past TP (keep a tiny gap to avoid equality edge cases)
              const EPS = 1e-12;
              if (direction === "LONG") newSL = Math.min(newSL, Number(s.tp) - EPS);
              else newSL = Math.max(newSL, Number(s.tp) + EPS);

              // Only tighten (never loosen)
              const tighten =
                (direction === "LONG" && newSL > Number(s.sl)) ||
                (direction === "SHORT" && newSL < Number(s.sl));

              if (tighten) {
                if (canApplyExchangeBreakEven) {
                  if (!matchedExecution) {
                    console.warn(
                      `[BREAK_EVEN] ${s.symbol} no matched execution to update on exchange`
                    );
                  } else {
                    try {
                      const updateResult =
                        await futuresExecutor.moveExecutionStopToBreakEven(
                          matchedExecution,
                          newSL,
                          { triggerR: rNow }
                        );

                      if (updateResult?.ok) {
                        s.prevSl = s.sl;
                        s.sl = Number(updateResult.stopPrice || newSL);
                        s.breakEvenApplied = true;
                        s.breakEvenAt = Date.now();
                        s.breakEvenAtR = rNow;

                        matchedExecution.prevSl = Number(
                          updateResult.previousStopPrice ?? matchedExecution.sl
                        );
                        matchedExecution.sl = Number(updateResult.stopPrice || newSL);
                        matchedExecution.breakEvenApplied = true;
                        matchedExecution.breakEvenAt = s.breakEvenAt;
                        matchedExecution.breakEvenAtR = rNow;
                      }
                    } catch (err) {
                      console.warn(
                        `[BREAK_EVEN] failed to update exchange stop for ${s.symbol}:`,
                        err.body || err.message || err
                      );
                    }
                  }
                } else if (canApplyLocalBreakEven) {
                  s.prevSl = s.sl;
                  s.sl = newSL;
                  s.breakEvenApplied = true;
                  s.breakEvenAt = Date.now();
                  s.breakEvenAtR = rNow;

                  if (matchedExecution) {
                    matchedExecution.prevSl = matchedExecution.sl;
                    matchedExecution.sl = newSL;
                    matchedExecution.breakEvenApplied = true;
                    matchedExecution.breakEvenAt = s.breakEvenAt;
                    matchedExecution.breakEvenAtR = rNow;
                  }
                }
              }
            }
          }
        }
      }

      stillOpen.push(s);
      continue;
    }

    const exitPrice = outcome === "TP" ? s.tp : s.sl;
    const risk = Math.abs(s.entry - s.sl);
    const reward =
      direction === "LONG"
        ? Number(exitPrice) - Number(s.entry)
        : Number(s.entry) - Number(exitPrice);

    s.closedTs = Date.now();
    s.outcome = outcome;
    s.exitRef = candleClose;
    s.pnlPct = calcPnlPctByDirection(s.entry, exitPrice, direction);
    s.rrRealized = safeRatio(reward, risk);

    closedNow.push(s);
  }

  state.openSignals = stillOpen;

  if (!Array.isArray(state.closedSignals)) state.closedSignals = [];
  state.closedSignals.push(...closedNow);

  return closedNow;
}

function shouldSendSignal(state, signalObj, cooldownMins = 10) {
  if (!state || !signalObj) return false;

  if (!state.lastSignal) state.lastSignal = {};

  const k = keyFor(signalObj.symbol, signalObj.tf);
  const last = state.lastSignal[k];
  if (!last) return true;

  const nowTs = Number(signalObj.ts || Date.now());
  const lastTs = Number(last.ts || 0);
  const elapsedMins = (nowTs - lastTs) / 60000;

  if (elapsedMins < cooldownMins) return false;

  const lastEntry = Number(last.entry || 0);
  const newEntry = Number(signalObj.entry || 0);

  if (lastEntry > 0 && newEntry > 0) {
    const diffPct = Math.abs(newEntry - lastEntry) / lastEntry;
    if (diffPct < 0.0005) return false;
  }

  return true;
}

function extractCandidate(strategyCandidates, name) {
  return (strategyCandidates || []).find((c) => c?.strategy === name) || null;
}

function updateSignalLogForCandidate(candidate, patch) {
  if (!candidate?.lastSignalLogEntry || !patch || typeof patch !== "object") return;
  Object.assign(candidate.lastSignalLogEntry, patch);
}

function markCandidateRejected(candidate, reason) {
  if (!candidate) return;

  const normalizedReason = String(reason || "candidate_rejected");
  candidate.signalObj.executionAttempted = false;
  candidate.signalObj.executionApproved = false;
  candidate.signalObj.executionReason = normalizedReason;
  candidate.signalObj.continuationRank = candidate.continuationRank ?? null;
  candidate.signalObj.continuationRankScore = candidate.continuationRankScore ?? null;
  candidate.signalObj.continuationRankGroupSize =
    candidate.continuationRankGroupSize ?? null;

  updateSignalLogForCandidate(candidate, {
    executionAttempted: false,
    executionApproved: false,
    executionReason: normalizedReason,
    decisionReason: normalizedReason,
    continuationRank: candidate.continuationRank ?? null,
    continuationRankScore: candidate.continuationRankScore ?? null,
    continuationRankGroupSize: candidate.continuationRankGroupSize ?? null,
  });

  console.log(
    `[RANKER] ${candidate.symbol} ${candidate.symbolTf} strategy=${candidate.selectedStrategy} ` +
      `rejected=${normalizedReason} rank=${candidate.continuationRank ?? "-"} ` +
      `rankScore=${round(candidate.continuationRankScore ?? 0, 2)}`
  );
}

async function executePreparedSignal(candidate, state) {
  if (!candidate?.signalObj) return { executed: false, reason: "missing_candidate" };

  const {
    signalObj,
    symbol,
    symbolTf,
    selectedStrategy,
    selectedSignalClass,
    selectedScore,
    selectedMinScore,
    entry,
    sl,
    tp,
    rawTp,
    tpCappedByResistance,
  } = candidate;

  if (candidate.continuationRank) {
    signalObj.continuationRank = candidate.continuationRank;
    signalObj.continuationRankScore = candidate.continuationRankScore;
    signalObj.continuationRankGroupSize = candidate.continuationRankGroupSize;
    updateSignalLogForCandidate(candidate, {
      continuationRank: candidate.continuationRank,
      continuationRankScore: candidate.continuationRankScore,
      continuationRankGroupSize: candidate.continuationRankGroupSize,
      decisionReason: "ranked_for_execution",
    });
  }

  console.log(
    `[EXECUTOR_CALL] ${symbol} strategy=${selectedStrategy} class=${selectedSignalClass} ` +
      `score=${selectedScore} entry=${entry} tp=${tp} rawTp=${rawTp} capped=${tpCappedByResistance} ` +
      `meta=${signalObj.metaModelApplied ? round(signalObj.metaModelProbability || 0, 4) : "na"} ` +
      `rank=${candidate.continuationRank ?? "-"} rankScore=${round(
        candidate.continuationRankScore ?? 0,
        2
      )}`
  );

  const currentStrategyConfig = loadRuntimeConfig();
  const allowedSymbols = Object.keys(currentStrategyConfig).filter(
    (s) => currentStrategyConfig[s]?.ENABLED
  );

  const execResult = await futuresExecutor.paperExecute(signalObj, state, {
    minScore: selectedMinScore,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: PAPER_MAX_OPEN_TRADES_TOTAL,
    maxOpenTradesPerSymbol: PAPER_MAX_OPEN_TRADES_PER_SYMBOL,
    allowedSymbols,
  });

  if (execResult.executed) {
    state.lastSignal[keyFor(symbol, symbolTf)] = {
      ts: signalObj.ts,
      side: signalObj.side,
      entry: Number(execResult.order?.entry || signalObj.entry),
    };
  }

  signalObj.executionAttempted = true;
  signalObj.executionApproved = execResult.executed;
  signalObj.executionReason = execResult.reason || null;
  signalObj.executionOrderId = execResult.order?.id || null;

  updateSignalLogForCandidate(candidate, {
    executionAttempted: true,
    executionApproved: execResult.executed,
    executionReason: execResult.reason || null,
    executionOrderId: execResult.order?.id || null,
  });

  if (!Array.isArray(state.executions)) state.executions = [];
  if (!Array.isArray(state.openSignals)) state.openSignals = [];

  if (execResult.executed && execResult.order) {
    signalObj.signalEntry = Number(signalObj.entry);
    signalObj.entry = Number(execResult.order.entry || signalObj.entry);
    signalObj.entryPrice = Number(execResult.order.entry || signalObj.entry);
    signalObj.initialRisk = Math.abs(Number(signalObj.entry) - Number(signalObj.sl));
    state.executions.push(execResult.order);
    state.openSignals.push(signalObj);
  }

  console.log(
    `[EXECUTOR] ${symbol} executed=${execResult.executed} reason=${execResult.reason}`
  );

  if (execResult.executed && execResult.order) {
    const execMsg = buildExecutedTradeTelegramMessage({
      symbol,
      tf: symbolTf,
      direction: candidate.selectedDirection,
      entry,
      sl,
      tp,
      execResult,
    });

    console.log(execMsg);
    await sendTelegramMessage(execMsg);
  } else {
    console.log(`[TG] ${symbol} sem execução — não envia Telegram.`);
  }

  return execResult;
}

// =========================
// Core per symbol
// =========================

async function processSymbol(symbol, state) {
  const strategyConfig = loadRuntimeConfig();
  const cfg = strategyConfig[symbol];

  if (!cfg || !cfg.ENABLED) {
    console.log(`[ADAPTIVE] ${symbol} disabled by runtime config`);
    return;
  }

  const symbolTf = String(cfg.TF || TF);
  const symbolHtfTf = String(cfg.HTF_TF || HTF_TF);
  const symbolLimit = Number(cfg.LIMIT || LIMIT);
  const symbolHtfLimit = Number(cfg.HTF_LIMIT || HTF_LIMIT);
  const symbolCooldownMins = Number(cfg.COOLDOWN_MINS || COOLDOWN_MINS);

  console.log(
    `[CORE] ${symbol} TF=${symbolTf} limit=${symbolLimit} HTF=${symbolHtfTf} (futures-ready)`
  );

  const candles = await fetchKlines(symbol, symbolTf, symbolLimit);
  const htfCandles = await fetchKlines(symbol, symbolHtfTf, symbolHtfLimit);

  if (!candles || candles.length < 220) {
    console.log(`[CORE] ${symbol} candles insuficientes.`);
    return;
  }

  const closedCandles = candles.slice(0, -1);
  if (!closedCandles || closedCandles.length < 220) {
    console.log(`[CORE] ${symbol} velas fechadas insuficientes.`);
    return;
  }

  const closedHtfCandles = Array.isArray(htfCandles) ? htfCandles.slice(0, -1) : [];
  if (!closedHtfCandles || closedHtfCandles.length < 50) {
    console.log(`[CORE] ${symbol} HTF candles insuficientes.`);
    return;
  }

  const marketStructure = evaluateMarketStructure({
    htfCandles: closedHtfCandles,
    ltfCandles: closedCandles,
    htfLookback: HTF_SWING_LOOKBACK,
    ltfLookback: LTF_SWING_LOOKBACK,
    trendSwingCount: TREND_SWING_COUNT,
  });

  const closes = closedCandles.map((c) => c.close);
  const last = closedCandles[closedCandles.length - 1];
  const symbolStateKey = keyFor(symbol, symbolTf);
  const lastProcessedClosedCandleTime = Number(
    state.lastProcessedClosedCandle?.[symbolStateKey] || 0
  );

  if (
    Number.isFinite(Number(last?.closeTime)) &&
    Number(last.closeTime) <= lastProcessedClosedCandleTime
  ) {
    console.log(
      `[CORE] ${symbol} ${symbolTf} sem nova vela fechada (lastCloseTime=${last.closeTime})`
    );
    return;
  }

  const markCurrentClosedCandleProcessed = () =>
    markProcessedClosedCandle(state, symbol, symbolTf, last?.closeTime);

  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const prevEma50 = calcEMA(closes.slice(0, -1), 50);
  const atr = calcATR(closedCandles, 14);
  const adx = calcADX(closedCandles, 14);
  const rsiSeries = calcRSISeries(closes, 14);

  if (
    !ema20 ||
    !ema50 ||
    !ema200 ||
    !prevEma50 ||
    !atr ||
    !adx ||
    rsiSeries.length < 2
  ) {
    console.log(`[CORE] ${symbol} indicadores insuficientes.`);
    return;
  }

  const regime = detectMarketRegime({
    lastClose: last.close,
    ema20,
    ema50,
    ema200,
    prevEma50,
    atr,
    adx,
    regimeMinEmaSeparationPct: REGIME_MIN_EMA_SEPARATION_PCT,
    regimeMinAtrPct: REGIME_MIN_ATR_PCT,
    adxMinTrend: ADX_MIN_TREND,
    rangeMaxAtrPct: RANGE_MAX_ATR_PCT,
  });

  const {
    bullish,
    bullishFast,
    stackedEma,
    isTrend,
    isRange,
    emaSeparationPct,
    emaSlopePct,
    atrPct,
  } = regime;

  console.log(
    `[HTF] ${symbol} ${symbolHtfTf} bias=${marketStructure?.htf?.bias || "NEUTRAL"} ` +
      `reason=${marketStructure?.htf?.reason || "-"} ` +
      `bullShift=${marketStructure?.ltf?.bullishShift ? 1 : 0} ` +
      `bearShift=${marketStructure?.ltf?.bearishShift ? 1 : 0}`
  );

  const rsi = rsiSeries[rsiSeries.length - 1];
  const prevRsi = rsiSeries[rsiSeries.length - 2];
  const rsiRising = rsi > prevRsi;
  const distToEma20 = Math.abs(last.close - ema20);
  const distToEma50 = Math.abs(last.close - ema50);

  const pullbackEma20Atr = Number(cfg.PULLBACK_EMA20_ATR ?? DEFAULT_PULLBACK_EMA20_ATR);
  const pullbackEma50Atr = Number(cfg.PULLBACK_EMA50_ATR ?? DEFAULT_PULLBACK_EMA50_ATR);

  const nearEma20 = distToEma20 <= pullbackEma20Atr * atr;
  const nearEma50 = distToEma50 <= pullbackEma50Atr * atr;
  const nearPullback = nearEma20 || nearEma50;
  const entry = last.close;

  const rangeCfg = cfg.RANGE || {};
  const rangeMinSpaceToTargetAtr = Number(
    rangeCfg.minSpaceToTargetAtr ?? cfg.MIN_SPACE_TO_TARGET_ATR ?? 0.8
  );
  const rangeMaxDistanceFromSupportAtr = Number(
    rangeCfg.maxDistanceFromSupportAtr ?? cfg.MAX_DISTANCE_FROM_SUPPORT_ATR ?? 1.2
  );

  const sr = detectSupportResistance(closedCandles, {
    lookback: 120,
    atr,
  });

  const nearestSupport = nearestSupportBelow(entry, sr.supports);
  const nearestResistance = nearestResistanceAbove(entry, sr.resistances);

  const srEval = evaluateTradeZone({
    entry,
    atr,
    support: nearestSupport,
    resistance: nearestResistance,
    minSpaceToTargetAtr: rangeMinSpaceToTargetAtr,
    maxDistanceFromSupportAtr: rangeMaxDistanceFromSupportAtr,
    direction: "LONG",
  });

  const srEvalShort = evaluateTradeZone({
    entry,
    atr,
    support: nearestSupport,
    resistance: nearestResistance,
    minSpaceToTargetAtr: rangeMinSpaceToTargetAtr,
    maxDistanceFromResistanceAtr: rangeMaxDistanceFromSupportAtr,
    direction: "SHORT",
  });

  const avgVol =
    closedCandles.length > 21
      ? closedCandles
          .slice(-21, -1)
          .reduce((a, c) => a + Number(c.volume || 0), 0) / 20
      : 0;

  const strategyDecision = evaluateAllStrategies({
    cfg,
    candles: closedCandles,
    srEval,
    srEvalLong: srEval,
    srEvalShort,
    nearestResistance,
    nearestSupport,
    marketStructure,
    helpers: {
      tf: symbolTf,
      round,
      safeRatio,
      paperMinScore: PAPER_MIN_SCORE,
      defaults: {
        rangeRsiMin: DEFAULT_RANGE_RSI_MIN,
        rangeRsiMax: DEFAULT_RANGE_RSI_MAX,
        rangeSlAtrMult: DEFAULT_RANGE_SL_ATR_MULT,
        rangeTpAtrMult: DEFAULT_RANGE_TP_ATR_MULT,
        trendRsiMin: DEFAULT_TREND_RSI_MIN,
        trendRsiMax: DEFAULT_TREND_RSI_MAX,
        trendSlAtrMult: DEFAULT_TREND_SL_ATR_MULT,
        trendTpAtrMult: DEFAULT_TREND_TP_ATR_MULT,
        trendMinAdx: TREND_MIN_ADX,
        trendMaxDistEma20Atr: TREND_MAX_DIST_EMA20_ATR,
        trendMaxDistEma50Atr: TREND_MAX_DIST_EMA50_ATR,
      },
    },
    indicators: {
      entry,
      atr,
      adx,
      rsi,
      prevRsi,
      ema20,
      ema50,
      ema200,
      bullish,
      bullishFast,
      stackedEma,
      isTrend,
      isRange,
      emaSeparationPct,
      emaSlopePct,
      atrPct,
      distToEma20,
      distToEma50,
      nearEma20,
      nearEma50,
      nearPullback,
      rsiRising,
      avgVol,
    },
  });

  const closedNow = await updateTracker(state, {
    symbol,
    tf: symbolTf,
    candleHigh: last.high,
    candleLow: last.low,
    candleClose: last.close,
    candleCloseTime: last.closeTime,
  });

  for (const c of closedNow) {
    let closedExec = null;

    try {
      closedExec = await futuresExecutor.closeExecutionForSignal(state, c);
    } catch (err) {
      console.error(
        `[EXECUTOR_CLOSE] erro ao fechar ${c.symbol}:`,
        err.body || err.message || err
      );
    }

    if (closedExec) {
      const direction = String(c.direction || c.side || "LONG").toUpperCase();
      const actualExit = Number(closedExec.exitPrice);
      const actualPnlPct = Number(closedExec.pnlPct);
      const entryRef = Number(c.entry ?? closedExec.entry);
      const riskRef =
        Number.isFinite(Number(c.initialRisk)) && Number(c.initialRisk) > 0
          ? Number(c.initialRisk)
          : Math.abs(Number(entryRef) - Number(c.sl ?? closedExec.sl));

      c.closedTs = Number(closedExec.closedTs || c.closedTs || Date.now());
      c.closeReason = closedExec.closeReason || c.closeReason || c.outcome || null;

      if (Number.isFinite(actualExit) && actualExit > 0) {
        c.exitRef = actualExit;
      }

      if (Number.isFinite(actualPnlPct)) {
        c.pnlPct = actualPnlPct;
      }

      if (Number.isFinite(Number(closedExec.pnlUsd))) {
        c.realizedPnlUsd = Number(closedExec.pnlUsd);
      }

      if (Number.isFinite(Number(closedExec.entryPlanned))) {
        c.entryPlanned = Number(closedExec.entryPlanned);
      }

      if (Number.isFinite(Number(closedExec.entryFill))) {
        c.entryFill = Number(closedExec.entryFill);
      }

      if (Number.isFinite(Number(closedExec.exitPlanned))) {
        c.exitPlanned = Number(closedExec.exitPlanned);
      }

      if (Number.isFinite(Number(closedExec.exitFill))) {
        c.exitFill = Number(closedExec.exitFill);
      }

      if (Number.isFinite(Number(closedExec.pnlTheoretical))) {
        c.pnlTheoretical = Number(closedExec.pnlTheoretical);
      }

      if (Number.isFinite(Number(closedExec.pnlRealizedGross))) {
        c.pnlRealizedGross = Number(closedExec.pnlRealizedGross);
      }

      if (Number.isFinite(Number(closedExec.fees))) {
        c.fees = Number(closedExec.fees);
      }

      if (Number.isFinite(Number(closedExec.pnlRealizedNet))) {
        c.pnlRealizedNet = Number(closedExec.pnlRealizedNet);
      }

      if (closedExec.closeReasonInternal) {
        c.closeReasonInternal = closedExec.closeReasonInternal;
      }

      if (closedExec.closeReasonExchange) {
        c.closeReasonExchange = closedExec.closeReasonExchange;
      }

      if (closedExec.pnlSource) {
        c.pnlSource = closedExec.pnlSource;
      }

      if (closedExec.exchange?.protectionStatus) {
        c.protectionStatus = closedExec.exchange.protectionStatus;
      }

      if (Number.isFinite(Number(closedExec.riskUsd))) {
        c.riskUsd = Number(closedExec.riskUsd);
      }

      if (Number.isFinite(Number(closedExec.positionNotional))) {
        c.positionSizeUsd = Number(closedExec.positionNotional);
      }

      if (Number.isFinite(Number(closedExec.leverage))) {
        c.leverage = Number(closedExec.leverage);
      }

      if (
        Number.isFinite(actualExit) &&
        actualExit > 0 &&
        Number.isFinite(entryRef) &&
        entryRef > 0 &&
        Number.isFinite(riskRef) &&
        riskRef > 0
      ) {
        const reward =
          direction === "SHORT" || direction === "SELL"
            ? entryRef - actualExit
            : actualExit - entryRef;
        c.rrRealized = safeRatio(reward, riskRef);
      }
    }

    const effectivePnl = Number.isFinite(Number(closedExec?.pnlPct))
      ? Number(closedExec.pnlPct)
      : Number(c.pnlPct || 0);

    const effectiveExit = Number.isFinite(Number(closedExec?.exitPrice))
      ? Number(closedExec.exitPrice)
      : Number(c.exitRef || 0);

    console.log(
      `[TRACKER] ${symbol} ${symbolTf} closed outcome=${c.outcome} entry=${round(
        c.entry,
        6
      )} exit=${round(effectiveExit, 6)} pnlPct=${round(
        effectivePnl,
        2
      )} rr=${round(c.rrRealized ?? 0, 2)}`
    );

    const closeMsg = buildClosedTradeTelegramMessage({
      symbol,
      tf: symbolTf,
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

  const strategyCandidates = strategyDecision.all || [];
  const selected = strategyDecision.selected;
  const visibleScore = strategyDecision.visibleScore;
  const visibleSignalClass = strategyDecision.visibleSignalClass;

  const rangeCandidate = extractCandidate(strategyCandidates, "range");
  const trendCandidate = extractCandidate(strategyCandidates, "trend");
  const bounceCandidate = extractCandidate(strategyCandidates, "oversoldBounce");
  const failedBreakdownCandidate = extractCandidate(strategyCandidates, "failedBreakdown");
  const momentumBreakoutLongCandidate = extractCandidate(
    strategyCandidates,
    "momentumBreakoutLong"
  );
  const cipherContinuationLongCandidate = extractCandidate(
    strategyCandidates,
    "cipherContinuationLong"
  );
  const ignitionContinuationLongCandidate = extractCandidate(
    strategyCandidates,
    "ignitionContinuationLong"
  );
  const cipherContinuationShortCandidate = extractCandidate(
    strategyCandidates,
    "cipherContinuationShort"
  );

  const rangeScore = rangeCandidate?.score ?? null;
  const rangeSignalClass = rangeCandidate?.signalClass ?? null;
  const rangeAllowed = !!rangeCandidate?.allowed;

  const trendScore = trendCandidate?.score ?? null;
  const trendSignalClass = trendCandidate?.signalClass ?? null;
  const trendAllowed = !!trendCandidate?.allowed;

  const bounceScore = bounceCandidate?.score ?? null;
  const bounceSignalClass = bounceCandidate?.signalClass ?? null;
  const bounceAllowed = !!bounceCandidate?.allowed;

  const failedBreakdownScore = failedBreakdownCandidate?.score ?? null;
  const failedBreakdownSignalClass = failedBreakdownCandidate?.signalClass ?? null;
  const failedBreakdownAllowed = !!failedBreakdownCandidate?.allowed;

  const momentumBreakoutLongScore = momentumBreakoutLongCandidate?.score ?? null;
  const momentumBreakoutLongSignalClass =
    momentumBreakoutLongCandidate?.signalClass ?? null;
  const momentumBreakoutLongAllowed = !!momentumBreakoutLongCandidate?.allowed;

  const cipherContinuationLongScore = cipherContinuationLongCandidate?.score ?? null;
  const cipherContinuationLongSignalClass =
    cipherContinuationLongCandidate?.signalClass ?? null;
  const cipherContinuationLongAllowed = !!cipherContinuationLongCandidate?.allowed;

  const ignitionContinuationLongScore = ignitionContinuationLongCandidate?.score ?? null;
  const ignitionContinuationLongSignalClass =
    ignitionContinuationLongCandidate?.signalClass ?? null;
  const ignitionContinuationLongAllowed = !!ignitionContinuationLongCandidate?.allowed;

  const cipherContinuationShortScore = cipherContinuationShortCandidate?.score ?? null;
  const cipherContinuationShortSignalClass =
    cipherContinuationShortCandidate?.signalClass ?? null;
  const cipherContinuationShortAllowed = !!cipherContinuationShortCandidate?.allowed;

  let selectedStrategy = selected?.strategy || null;
  let selectedDirection = String(selected?.direction || "LONG").toUpperCase();
  let selectedScore = selected?.score || 0;
  let selectedSignalClass = selected?.signalClass || "IGNORE";
  let selectedMinScore = selected?.minScore || PAPER_MIN_SCORE;
  let side = selectedDirection === "SHORT" ? "SELL" : "BUY";
  let sl = selected?.sl ?? null;
  let rawTp = selected?.tpRawAtr ?? null;
  let tp = selected?.tp ?? null;
  let tpCappedByResistance = selected?.tpCappedByResistance ?? false;
  let blockedReason = strategyDecision.blockedReason || "selected";
  const activeSrEval = selectedDirection === "SHORT" ? srEvalShort : srEval;

  if (!Array.isArray(state.signalLog)) {
    state.signalLog = [];
  }

  state.signalLog.push({
    ts: Date.now(),
    signalCandleCloseTime: last.closeTime,
    symbol,
    tf: symbolTf,
    price: last.close,
    score: visibleScore,
    signalClass: visibleSignalClass,
    rangeScore,
    rangeSignalClass,
    rangeAllowed,
    trendScore,
    trendSignalClass,
    trendAllowed,
    bounceScore,
    bounceSignalClass,
    bounceAllowed,
    failedBreakdownScore,
    failedBreakdownSignalClass,
    failedBreakdownAllowed,
    momentumBreakoutLongScore,
    momentumBreakoutLongSignalClass,
    momentumBreakoutLongAllowed,
    cipherContinuationLongScore,
    cipherContinuationLongSignalClass,
    cipherContinuationLongAllowed,
    ignitionContinuationLongScore,
    ignitionContinuationLongSignalClass,
    ignitionContinuationLongAllowed,
    cipherContinuationShortScore,
    cipherContinuationShortSignalClass,
    cipherContinuationShortAllowed,
    selectedStrategy,
    selectedDirection,
    selectedEntry: selected?.entry ?? null,
    selectedSl: selected?.sl ?? null,
    selectedTp: selected?.tp ?? null,
    selectedTpRawAtr: selected?.tpRawAtr ?? selected?.rawTp ?? null,
    selectedMinScore: selected?.minScore ?? null,
    selectedAllowed: selected?.allowed === true,
    decisionReason: blockedReason,
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
    rsiInBand: selected?.meta?.trendRsiInBand ?? selected?.meta?.rangeRsiInBand ?? false,
    rsiRising,
    isTrend,
    isRange,
    emaSeparationPct,
    emaSlopePct,
    distToEma20,
    distToEma50,
    nearestSupport: nearestSupport?.price ?? null,
    nearestSupportStrength: nearestSupport?.strength ?? null,
    nearestSupportTouches: nearestSupport?.touches ?? null,
    nearestResistance: nearestResistance?.price ?? null,
    nearestResistanceStrength: nearestResistance?.strength ?? null,
    nearestResistanceTouches: nearestResistance?.touches ?? null,
    srPassed: activeSrEval.passed,
    srReason: activeSrEval.reason,
    srSoftPassed: activeSrEval.passed,
    distanceToSupportAtr: activeSrEval.distanceToSupportAtr ?? null,
    distanceToResistanceAtr: activeSrEval.distanceToResistanceAtr ?? null,
    executionAttempted: false,
    executionApproved: false,
    executionReason: null,
    executionOrderId: null,
    avgVol,
    strategyCandidates,
  });

  if (state.signalLog.length > 5000) {
    state.signalLog.shift();
  }

  const lastSignalLogEntry = state.signalLog[state.signalLog.length - 1];

  console.log(
      `[SIGNAL] ${symbol} ${symbolTf} strategy=${selectedStrategy || "none"} ` +
      `rangeScore=${rangeScore ?? "-"} trendScore=${trendScore ?? "-"} bounceScore=${bounceScore ?? "-"} failedBreakdownScore=${failedBreakdownScore ?? "-"} momentumBreakoutScore=${momentumBreakoutLongScore ?? "-"} cipherLongScore=${cipherContinuationLongScore ?? "-"} ignitionLongScore=${ignitionContinuationLongScore ?? "-"} cipherShortScore=${cipherContinuationShortScore ?? "-"} ` +
      `class=${visibleSignalClass} decision=${blockedReason} ` +
      `bullish=${bullish} pullback=${nearPullback} sr=${activeSrEval.reason}`
  );


  if (!selectedStrategy) {
    console.log(
      `[STRATEGY] ${symbol} sem setup válido. ` +
        `range=${rangeAllowed} trend=${trendAllowed} bounce=${bounceAllowed} failedBreakdown=${failedBreakdownAllowed} momentumBreakout=${momentumBreakoutLongAllowed} cipherLong=${cipherContinuationLongAllowed} ignitionLong=${ignitionContinuationLongAllowed} cipherShort=${cipherContinuationShortAllowed} reason=${blockedReason}`
    );
    markCurrentClosedCandleProcessed();
    saveState(state);
    return;
  }

  const GLOBAL_MIN_ADX = Number(cfg.MIN_ADX ?? 0);
  const enforceGlobalMinAdx = strategyNeedsGlobalMinAdx(selectedStrategy);

  if (enforceGlobalMinAdx && Number(adx || 0) < GLOBAL_MIN_ADX) {
    console.log(
      `[ADAPTIVE] ${symbol} blocked: adx ${round(adx, 2)} < minAdx ${GLOBAL_MIN_ADX} strategy=${selectedStrategy}`
    );

    if (lastSignalLogEntry) {
      lastSignalLogEntry.decisionReason = `adx_below_global_min:${GLOBAL_MIN_ADX}`;
    }

    markCurrentClosedCandleProcessed();
    saveState(state);
    return;
  }

  const shouldBuy =
    (selectedSignalClass === "EXECUTABLE" || selectedSignalClass === "WATCH") &&
    selectedScore >= Math.max(55, selectedMinScore - 5);

  if (!shouldBuy) {
    if (lastSignalLogEntry) {
      lastSignalLogEntry.decisionReason = "selected_strategy_but_not_executable";
    }
    markCurrentClosedCandleProcessed();
    saveState(state);
    return;
  }

  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const plannedRr = safeRatio(reward, risk);

  if (risk === 0 || reward === 0) {
    console.log(`[CORE] ${symbol} risco/reward inválido — ignorado.`);
    if (lastSignalLogEntry) {
      lastSignalLogEntry.decisionReason = "invalid_risk_reward";
    }
    markCurrentClosedCandleProcessed();
    saveState(state);
    return;
  }

  const lastSignalForKey = state.lastSignal[keyFor(symbol, symbolTf)];
  const entryDiffPct =
    lastSignalForKey && lastSignalForKey.entry
      ? Math.abs(entry - lastSignalForKey.entry) / lastSignalForKey.entry
      : null;

  const signalObj = {
    symbol,
    tf: symbolTf,
    direction: selectedDirection,
    side,
    entry,
    sl,
    tp,
    tpRawAtr: rawTp,
    tpCappedByResistance,
    strategy: selectedStrategy,
    rangeScore,
    trendScore,
    bounceScore,
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
    rsiInBand: selected?.meta?.trendRsiInBand ?? selected?.meta?.rangeRsiInBand ?? false,
    rsiRising,
    isTrend,
    isRange,
    emaSeparationPct,
    emaSlopePct,
    nearestSupport: nearestSupport?.price ?? null,
    nearestSupportStrength: nearestSupport?.strength ?? null,
    nearestSupportTouches: nearestSupport?.touches ?? null,
    nearestResistance: nearestResistance?.price ?? null,
    nearestResistanceStrength: nearestResistance?.strength ?? null,
    nearestResistanceTouches: nearestResistance?.touches ?? null,
    srPassed: activeSrEval.passed,
    srReason: activeSrEval.reason,
    distanceToSupportAtr: activeSrEval.distanceToSupportAtr ?? null,
    distanceToResistanceAtr: activeSrEval.distanceToResistanceAtr ?? null,
    cooldownPassed:
      (Date.now() - (state.lastSignal[keyFor(symbol, symbolTf)]?.ts || 0)) / 60000 >=
      symbolCooldownMins,
    entryDiffPctFromLast: entryDiffPct,
    maxHighDuringTrade: entry,
    minLowDuringTrade: entry,
    barsOpen: 0,
    signalCandleCloseTime: last.closeTime,
    openedOnCandleCloseTime: last.closeTime,
    lastTrackedCandleCloseTime: last.closeTime,
    pnlPct: null,
    rrPlanned: plannedRr,
    rrRealized: null,
    score: selectedScore,
    signalClass: selectedSignalClass,
  };

  if (!shouldSendSignal(state, signalObj, symbolCooldownMins)) {
    console.log(`[CORE] ${symbol} sinal repetido/cooldown — ignorado.`);
    if (lastSignalLogEntry) {
      lastSignalLogEntry.decisionReason = "cooldown_or_duplicate_signal";
    }
    markCurrentClosedCandleProcessed();
    saveState(state);
    return;
  }

  let metaModelDecision = {
    applied: false,
    passed: true,
    reason: "meta_model_not_requested",
  };

  if (shouldApplyMetaModelFilter()) {
    metaModelDecision = evaluateMetaModelCandidate(
      {
        strategy: selectedStrategy,
        symbol,
        tf: symbolTf,
        direction: selectedDirection,
        signalObj,
        candidate: selected,
        activeSrEval,
        nearestSupport,
        nearestResistance,
      },
      {
        minProbability: META_MODEL_MIN_PROB,
        minTestF1: META_MODEL_MIN_TEST_F1,
      }
    );
  }

  signalObj.metaModelApplied = metaModelDecision.applied === true;
  signalObj.metaModelPassed = metaModelDecision.passed === true;
  signalObj.metaModelReason = metaModelDecision.reason || null;
  signalObj.metaModelProbability = Number.isFinite(Number(metaModelDecision.probability))
    ? Number(metaModelDecision.probability)
    : null;
  signalObj.metaModelThreshold = Number.isFinite(Number(metaModelDecision.threshold))
    ? Number(metaModelDecision.threshold)
    : null;
  signalObj.metaModelPredictedClass = Number.isFinite(
    Number(metaModelDecision.predictedClass)
  )
    ? Number(metaModelDecision.predictedClass)
    : null;
  signalObj.metaModelTestF1 = Number.isFinite(Number(metaModelDecision.modelTestF1))
    ? Number(metaModelDecision.modelTestF1)
    : null;

  if (lastSignalLogEntry) {
    lastSignalLogEntry.metaModelApplied = signalObj.metaModelApplied;
    lastSignalLogEntry.metaModelPassed = signalObj.metaModelPassed;
    lastSignalLogEntry.metaModelReason = signalObj.metaModelReason;
    lastSignalLogEntry.metaModelProbability = signalObj.metaModelProbability;
    lastSignalLogEntry.metaModelThreshold = signalObj.metaModelThreshold;
    lastSignalLogEntry.metaModelPredictedClass = signalObj.metaModelPredictedClass;
    lastSignalLogEntry.metaModelTestF1 = signalObj.metaModelTestF1;
  }

  if (!metaModelDecision.passed) {
    console.log(
      `[META_MODEL] ${symbol} ${selectedStrategy} rejected prob=${round(
        Number(metaModelDecision.probability || 0),
        4
      )} threshold=${round(Number(metaModelDecision.threshold || 0), 4)}`
    );
    if (lastSignalLogEntry) {
      lastSignalLogEntry.decisionReason = `meta_model_rejected:${selectedStrategy}`;
    }
    markCurrentClosedCandleProcessed();
    saveState(state);
    return;
  }

  markCurrentClosedCandleProcessed();
  saveState(state);

  return {
    candidate: {
      symbol,
      symbolTf,
      selectedStrategy,
      selectedDirection,
      selectedSignalClass,
      selectedScore,
      selectedMinScore,
      entry,
      sl,
      tp,
      rawTp,
      tpCappedByResistance,
      signalObj,
      lastSignalLogEntry,
    },
  };
}

// =========================
// Main
// =========================

async function main() {
  const state = loadState();
  const enabledSymbols = getEnabledSymbols();
  const preparedCandidates = [];

  console.log(`[CORE] enabled symbols: ${enabledSymbols.join(", ") || "none"}`);

  for (const symbol of enabledSymbols) {
    try {
      const result = await processSymbol(symbol, state);
      if (result?.candidate) {
        preparedCandidates.push(result.candidate);
      }
    } catch (err) {
      console.error(
        `[CORE] erro em ${symbol}:`,
        err.response?.data || err.message || err
      );
    }
  }

  const ranking = rankExecutionCandidates(preparedCandidates, {
    enabled: CONTINUATION_RANKER_ENABLED,
    maxContinuationPerCycle: CONTINUATION_RANKER_MAX_PER_CYCLE,
  });

  for (const candidate of ranking.rejected) {
    markCandidateRejected(candidate, "continuation_ranked_out");
  }

  for (const candidate of ranking.selected) {
    try {
      await executePreparedSignal(candidate, state);
    } catch (err) {
      console.error(
        `[EXECUTOR] erro em ${candidate.symbol}:`,
        err.response?.data || err.message || err
      );
      markCandidateRejected(candidate, "execution_error");
    }
  }

  saveState(state);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[CORE] erro fatal:", err.response?.data || err.message || err);
    process.exit(1);
  });
}

module.exports = {
  getEnabledSymbols,
  loadState,
  saveState,
  fetchKlines,
  findOpenExecutionForSignal,
  updateTracker,
  shouldSendSignal,
  processSymbol,
  main,
};
