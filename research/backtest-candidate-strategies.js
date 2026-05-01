require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const {
  calcEMA,
  calcRSISeries,
  calcATR,
  calcADX,
  detectMarketRegime,
} = require("../indicators/market-indicators");
const {
  detectSupportResistance,
  nearestSupportBelow,
  nearestResistanceAbove,
  evaluateTradeZone,
} = require("../runtime/support-resistance");
const { evaluateMarketStructure } = require("../runtime/market-structure");
const { loadRuntimeConfig } = require("../runtime/config/load-runtime-config");

const { evaluateRangeStrategy } = require("../strategies/range-strategy");
const { evaluateOversoldBounceStrategy } = require("../strategies/oversold-bounce-strategy");
const { evaluateFailedBreakdownStrategy } = require("../strategies/failed-breakdown-strategy");
const {
  evaluateBreakdownRetestShortStrategy,
} = require("../strategies/breakdown-retest-short-strategy");
const { evaluateBullTrapStrategy } = require("../strategies/bull-trap-strategy");
const {
  evaluateLiquiditySweepReclaimLongStrategy,
} = require("../strategies/liquidity-sweep-reclaim-long-strategy");
const {
  evaluateMomentumBreakoutLongStrategy,
} = require("../strategies/momentum-breakout-long-strategy");
const {
  evaluateCompressionBreakoutLongStrategy,
} = require("../strategies/compression-breakout-long-strategy");
const {
  evaluateCompressionBreakdownShortStrategy,
} = require("../strategies/compression-breakdown-short-strategy");
const {
  evaluateBreakdownContinuationBaseShortStrategy,
} = require("../strategies/breakdown-continuation-base-short-strategy");
const {
  evaluateImpulseBreakoutLongStrategy,
} = require("../strategies/impulse-breakout-long-strategy");
const {
  evaluateImpulseBreakoutShortStrategy,
} = require("../strategies/impulse-breakout-short-strategy");
const {
  evaluateTrendRunnerLongStrategy,
} = require("../strategies/trend-runner-long-strategy");
const {
  evaluateTrendRunnerShortStrategy,
} = require("../strategies/trend-runner-short-strategy");
const {
  evaluateCipherContinuationShortStrategy,
} = require("../strategies/cipher-continuation-short-strategy");
const {
  evaluateCipherContinuationLongStrategy,
} = require("../strategies/cipher-continuation-long-strategy");
const {
  evaluateIgnitionContinuationLongStrategy,
} = require("../strategies/ignition-continuation-long-strategy");
const {
  resolveExternalHistoryProvider,
  fetchKlinesFromExternalProvider,
} = require("./external-history");
const { readBackfilledSlice } = require("./binance-public-history");

const TF = process.env.TF || "15m";
const HTF_TF = process.env.HTF_TF || "1d";
const LTF_LIMIT = Number(process.env.BACKTEST_LTF_LIMIT || 3000);
const HTF_LIMIT = Number(process.env.BACKTEST_HTF_LIMIT || 400);
const RUNTIME_CONFIG = loadRuntimeConfig();
const DEFAULT_SYMBOLS = Object.entries(RUNTIME_CONFIG)
  .filter(([, cfg]) => cfg?.ENABLED !== false)
  .map(([symbol]) => symbol);
const DISABLED_SYMBOLS = Object.entries(RUNTIME_CONFIG)
  .filter(([, cfg]) => cfg?.ENABLED === false)
  .map(([symbol]) => symbol);
const BINANCE_FUTURES_BASE =
  process.env.BINANCE_FUTURES_BASE ||
  process.env.BINANCE_FAPI_BASE_URL ||
  "https://fapi.binance.com";

const HTF_SWING_LOOKBACK = Number(process.env.HTF_SWING_LOOKBACK || 2);
const LTF_SWING_LOOKBACK = Number(process.env.LTF_SWING_LOOKBACK || 6);
const TREND_SWING_COUNT = Number(process.env.TREND_SWING_COUNT || 2);
const MIN_LTF_CANDLES = Number(process.env.BACKTEST_MIN_LTF_CANDLES || 220);
const MIN_HTF_CANDLES = Number(process.env.BACKTEST_MIN_HTF_CANDLES || 50);
const DEFAULT_PULLBACK_EMA20_ATR = Number(process.env.PULLBACK_EMA20_ATR || 0.8);
const DEFAULT_PULLBACK_EMA50_ATR = Number(process.env.PULLBACK_EMA50_ATR || 1.2);
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
const REGIME_MIN_ATR_PCT = Number(process.env.REGIME_MIN_ATR_PCT || 0.00045);
const RANGE_MAX_ATR_PCT = Number(process.env.RANGE_MAX_ATR_PCT || 0.0015);
const ADX_MIN_TREND = Number(process.env.ADX_MIN_TREND || 25);
const TREND_MIN_ADX = Number(process.env.TREND_MIN_ADX || 25);
const TREND_MAX_DIST_EMA20_ATR = Number(process.env.TREND_MAX_DIST_EMA20_ATR || 1.2);
const TREND_MAX_DIST_EMA50_ATR = Number(process.env.TREND_MAX_DIST_EMA50_ATR || 1.8);
const PAPER_MIN_SCORE = Number(process.env.PAPER_MIN_SCORE || 60);

const CACHE_DIR = path.join(__dirname, "cache", "strategy-backtests");
const BACKTEST_USE_PUBLIC_HISTORY_CACHE =
  String(process.env.BACKTEST_USE_PUBLIC_HISTORY_CACHE || "0") === "1";
const DEFAULT_OUTPUT_FILE = process.env.BACKTEST_OUTPUT_FILE
  ? path.resolve(process.cwd(), process.env.BACKTEST_OUTPUT_FILE)
  : path.join(__dirname, "candidate-strategy-backtest.json");
const BACKTEST_INCLUDE_TRADES =
  String(process.env.BACKTEST_INCLUDE_TRADES || "0") === "1";
const BACKTEST_FEE_RATE = Number(process.env.BACKTEST_FEE_RATE || 0);
const BACKTEST_SLIPPAGE_PCT = Number(process.env.BACKTEST_SLIPPAGE_PCT || 0);

function round(n, decimals = 6) {
  if (!Number.isFinite(Number(n))) return 0;
  return Number(Number(n).toFixed(decimals));
}

function safeRatio(numerator, denominator) {
  if (
    !Number.isFinite(Number(numerator)) ||
    !Number.isFinite(Number(denominator)) ||
    Number(denominator) === 0
  ) {
    return null;
  }
  return Number(numerator) / Number(denominator);
}

function formatIso(ts) {
  return new Date(ts).toISOString();
}

function normalizeScalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  return null;
}

function flattenCandidateMeta(meta = {}) {
  const out = {};

  for (const [key, value] of Object.entries(meta || {})) {
    const normalized = normalizeScalar(value);
    if (normalized === null) continue;
    out[`candidateMeta_${key}`] = normalized;
  }

  return out;
}

function buildExecutionCostModel() {
  return {
    feeRate: Number.isFinite(BACKTEST_FEE_RATE) && BACKTEST_FEE_RATE > 0 ? BACKTEST_FEE_RATE : 0,
    slippagePct:
      Number.isFinite(BACKTEST_SLIPPAGE_PCT) && BACKTEST_SLIPPAGE_PCT > 0
        ? BACKTEST_SLIPPAGE_PCT
        : 0,
  };
}

function applyExecutionCostsToTrade(baseTrade, costModel = buildExecutionCostModel()) {
  const trade = { ...baseTrade };
  const estimatedFeesPct = Number(costModel.feeRate || 0) * 2 * 100;
  const estimatedSlippagePct = Number(costModel.slippagePct || 0) * 2 * 100;
  const grossPnlPct = Number(trade.pnlPct || 0);
  const netPnlPct = grossPnlPct - estimatedFeesPct - estimatedSlippagePct;

  trade.grossPnlPct = grossPnlPct;
  trade.estimatedFeesPct = estimatedFeesPct;
  trade.estimatedSlippagePct = estimatedSlippagePct;
  trade.netPnlPct = netPnlPct;
  trade.grossPnl = grossPnlPct;
  trade.estimatedFees = estimatedFeesPct;
  trade.estimatedSlippage = estimatedSlippagePct;
  trade.netPnl = netPnlPct;

  return trade;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cacheFile(symbol, tf, total, providerKey = "binance") {
  const safeProvider = String(providerKey || "binance").replace(/[^a-z0-9._-]+/gi, "_");
  return path.join(CACHE_DIR, `${safeProvider}_${symbol}_${tf}_${total}.json`);
}

function parseSymbolsOverride(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return [];

  return [...new Set(
    rawValue
      .split(",")
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  )];
}

function parseStrategiesOverride(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return [];

  return [...new Set(
    rawValue
      .split(",")
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function createFallbackSymbolConfig(symbol) {
  return {
    SYMBOL: symbol,
    ENABLED: true,
    RSI_MIN: 35,
    RSI_MAX: 55,
    SL_ATR_MULT: 0.75,
    TP_ATR_MULT: 3.0,
    PULLBACK_BAND_ATR: 0.6,
    REQUIRE_SR: true,
    MIN_SPACE_TO_TARGET_ATR: 0.8,
    MAX_DISTANCE_FROM_SUPPORT_ATR: 1.2,
    TP_RESISTANCE_BUFFER_ATR: 0.15,
    REQUIRE_TREND: false,
    MIN_RR_PLANNED: 0.8,
    TREND_REQUIRE_RSI_FALLING: false,
    TREND: {
      enabled: true,
      allow15m: true,
      minScore: 60,
      minAdx: 12,
      rsiMin: 40,
      rsiMax: 60,
      requireSr: true,
      requireNearPullback: true,
      requireRsiFalling: false,
    },
    TREND_SHORT: {
      enabled: true,
      minScore: 72,
      minAdx: 18,
      rsiMin: 38,
      rsiMax: 52,
      requireSr: true,
      requireNearPullback: true,
      requireRsiFalling: true,
      maxPullbackPct: 0.03,
    },
  };
}

function resolveRequestedSymbols(explicitSymbols = null) {
  const requested = Array.isArray(explicitSymbols) && explicitSymbols.length
    ? explicitSymbols
    : parseSymbolsOverride(process.env.BACKTEST_SYMBOLS);

  return requested.length ? requested : DEFAULT_SYMBOLS;
}

function parseConfigOverrides(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return {};

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveTradeManagement(explicitOptions = null) {
  const options =
    explicitOptions && typeof explicitOptions === "object" ? explicitOptions : {};

  const breakEvenTriggerR = parseOptionalNumber(
    options.breakEvenTriggerR ?? process.env.BACKTEST_BREAK_EVEN_TRIGGER_R
  );
  const breakEvenLockR = parseOptionalNumber(
    options.breakEvenLockR ?? process.env.BACKTEST_BREAK_EVEN_LOCK_R
  );
  const breakEvenMinBars = parseOptionalNumber(
    options.breakEvenMinBars ?? process.env.BACKTEST_BREAK_EVEN_MIN_BARS
  );
  const tpFactor = parseOptionalNumber(options.tpFactor ?? process.env.BACKTEST_TP_FACTOR);

  return {
    breakEvenTriggerR:
      Number.isFinite(breakEvenTriggerR) && breakEvenTriggerR > 0
        ? breakEvenTriggerR
        : null,
    breakEvenLockR:
      Number.isFinite(breakEvenLockR) && breakEvenLockR >= 0 ? breakEvenLockR : 0,
    breakEvenMinBars:
      Number.isFinite(breakEvenMinBars) && breakEvenMinBars >= 1
        ? Math.floor(breakEvenMinBars)
        : 1,
    tpFactor: Number.isFinite(tpFactor) && tpFactor > 0 ? tpFactor : 1,
  };
}

function mergeDeep(baseValue, overrideValue) {
  const baseIsObject =
    baseValue && typeof baseValue === "object" && !Array.isArray(baseValue);
  const overrideIsObject =
    overrideValue && typeof overrideValue === "object" && !Array.isArray(overrideValue);

  if (!baseIsObject && !overrideIsObject) {
    return overrideValue === undefined ? baseValue : overrideValue;
  }

  const result = {
    ...(baseIsObject ? baseValue : {}),
    ...(overrideIsObject ? overrideValue : {}),
  };

  const keys = new Set([
    ...Object.keys(baseIsObject ? baseValue : {}),
    ...Object.keys(overrideIsObject ? overrideValue : {}),
  ]);

  for (const key of keys) {
    result[key] = mergeDeep(baseValue?.[key], overrideValue?.[key]);
  }

  return result;
}

function buildRequestedConfig(symbols, configOverrides = {}) {
  const defaultOverrides =
    configOverrides && typeof configOverrides === "object" && !Array.isArray(configOverrides)
      ? configOverrides.DEFAULTS || {}
      : {};
  const config = {};

  for (const symbol of symbols) {
    const baseConfig = RUNTIME_CONFIG[symbol] || createFallbackSymbolConfig(symbol);
    const symbolOverrides =
      configOverrides && typeof configOverrides === "object" && !Array.isArray(configOverrides)
        ? configOverrides[symbol] || {}
        : {};

    config[symbol] = mergeDeep(mergeDeep(baseConfig, defaultOverrides), symbolOverrides);
  }

  return config;
}

async function fetchAvailableFuturesSymbols() {
  const response = await axios.get(`${BINANCE_FUTURES_BASE}/fapi/v1/exchangeInfo`, {
    timeout: 20000,
  });

  return new Set(
    (response.data?.symbols || []).map((item) => String(item.symbol || "").toUpperCase())
  );
}

function normalizeKlineRow(row) {
  return {
    openTime: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Number(row[6]),
  };
}

async function fetchKlines(symbol, interval, total) {
  ensureDir(CACHE_DIR);
  const externalProvider = resolveExternalHistoryProvider(symbol, interval);
  const providerKey = externalProvider
    ? `${externalProvider.name}_${String(externalProvider.ticker || symbol).replace(/[^a-z0-9._-]+/gi, "_")}`
    : "binance";
  const file = cacheFile(symbol, interval, total, providerKey);

  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  if (externalProvider) {
    const rows = await fetchKlinesFromExternalProvider(
      externalProvider,
      symbol,
      interval,
      total
    );
    fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
    return rows;
  }

  if (BACKTEST_USE_PUBLIC_HISTORY_CACHE) {
    const backfilledRows = readBackfilledSlice({
      symbol,
      interval,
      limit: total,
    });

    if (Array.isArray(backfilledRows) && backfilledRows.length > 0) {
      fs.writeFileSync(file, JSON.stringify(backfilledRows, null, 2), "utf8");
      return backfilledRows;
    }
  }

  const limit = 1000;
  const rows = [];
  let endTime = Date.now();

  while (rows.length < total) {
    const response = await axios.get(`${BINANCE_FUTURES_BASE}/fapi/v1/klines`, {
      params: {
        symbol,
        interval,
        limit: Math.min(limit, total - rows.length),
        endTime,
      },
      timeout: 20000,
    });

    const batch = response.data.map(normalizeKlineRow);
    if (!batch.length) break;

    rows.unshift(...batch);
    endTime = batch[0].openTime - 1;

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const trimmed = rows.slice(-total);
  fs.writeFileSync(file, JSON.stringify(trimmed, null, 2), "utf8");
  return trimmed;
}

function resolveNearestLevels(entry, candles, atr, cfg) {
  const rangeCfg = cfg.RANGE || {};
  const minSpaceToTargetAtr = Number(
    rangeCfg.minSpaceToTargetAtr ?? cfg.MIN_SPACE_TO_TARGET_ATR ?? 0.8
  );
  const maxDistanceFromSupportAtr = Number(
    rangeCfg.maxDistanceFromSupportAtr ?? cfg.MAX_DISTANCE_FROM_SUPPORT_ATR ?? 1.2
  );

  const sr = detectSupportResistance(candles, { lookback: 120, atr });
  const nearestSupport = nearestSupportBelow(entry, sr.supports);
  const nearestResistance = nearestResistanceAbove(entry, sr.resistances);

  const srEvalLong = evaluateTradeZone({
    entry,
    atr,
    support: nearestSupport,
    resistance: nearestResistance,
    minSpaceToTargetAtr,
    maxDistanceFromSupportAtr,
    direction: "LONG",
  });

  const srEvalShort = evaluateTradeZone({
    entry,
    atr,
    support: nearestSupport,
    resistance: nearestResistance,
    minSpaceToTargetAtr,
    maxDistanceFromResistanceAtr: maxDistanceFromSupportAtr,
    direction: "SHORT",
  });

  return { nearestSupport, nearestResistance, srEvalLong, srEvalShort };
}

function buildBaseContext({ symbol, cfg, candles, htfCandles }) {
  if (!candles || candles.length < MIN_LTF_CANDLES) return null;
  if (!htfCandles || htfCandles.length < MIN_HTF_CANDLES) return null;

  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];

  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const prevEma50 = calcEMA(closes.slice(0, -1), 50);
  const atr = calcATR(candles, 14);
  const adx = calcADX(candles, 14);
  const rsiSeries = calcRSISeries(closes, 14);

  if (
    !Number.isFinite(ema20) ||
    !Number.isFinite(ema50) ||
    !Number.isFinite(ema200) ||
    !Number.isFinite(prevEma50) ||
    !Number.isFinite(atr) ||
    !Number.isFinite(adx) ||
    rsiSeries.length < 2
  ) {
    return null;
  }

  const marketStructure = evaluateMarketStructure({
    htfCandles,
    ltfCandles: candles,
    htfLookback: HTF_SWING_LOOKBACK,
    ltfLookback: LTF_SWING_LOOKBACK,
    trendSwingCount: TREND_SWING_COUNT,
  });

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

  const { nearestSupport, nearestResistance, srEvalLong, srEvalShort } =
    resolveNearestLevels(entry, candles, atr, cfg);

  const avgVol =
    candles.length > 21
      ? candles.slice(-21, -1).reduce((sum, c) => sum + Number(c.volume || 0), 0) / 20
      : 0;

  const indicators = {
    entry,
    price: entry,
    atr,
    adx,
    rsi,
    prevRsi,
    ema20,
    ema50,
    ema200,
    bullish: regime.bullish,
    bearish: ema50 < ema200,
    bullishFast: regime.bullishFast,
    stackedEma: regime.stackedEma,
    isTrend: regime.isTrend,
    isRange: regime.isRange,
    emaSeparationPct: regime.emaSeparationPct,
    emaSlopePct: regime.emaSlopePct,
    atrPct: regime.atrPct,
    distToEma20,
    distToEma50,
    nearEma20,
    nearEma50,
    nearPullback,
    rsiRising,
    avgVol,
    candles,
    priceClose: entry,
  };

  const helpers = {
    tf: TF,
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
  };

  return {
    symbol,
    cfg,
    candles,
    htfCandles,
    marketStructure,
    indicators,
    helpers,
    srEval: srEvalLong,
    srEvalLong,
    srEvalShort,
    nearestSupport,
    nearestResistance,
    atr,
    adx,
    ema20,
    ema50,
    ema200,
    price: entry,
    bullish: regime.bullish,
    bearish: ema50 < ema200,
  };
}

function resolveDirection(result, fallbackDirection) {
  if (result?.direction) {
    return String(result.direction).toUpperCase();
  }

  if (result?.side) {
    const side = String(result.side).toUpperCase();
    if (side === "SELL") return "SHORT";
    if (side === "BUY") return "LONG";
  }

  return String(fallbackDirection).toUpperCase();
}

function normalizeResult(result, fallbackStrategy, fallbackDirection, entry) {
  if (!result || result.allowed !== true) return null;

  const strategy = result.strategy || result.name || fallbackStrategy;
  const direction = resolveDirection(result, fallbackDirection);

  const signalClass = result.signalClass || result.class || "EXECUTABLE";
  const finalEntry = Number.isFinite(Number(result.entry)) ? Number(result.entry) : Number(entry);
  const sl = Number(result.sl);
  const tp = Number(result.tp);

  if (!Number.isFinite(finalEntry) || !Number.isFinite(sl) || !Number.isFinite(tp)) {
    return null;
  }

  return {
    strategy,
    direction,
    score: Number(result.score || 0),
    signalClass,
    minScore: Number.isFinite(Number(result.minScore)) ? Number(result.minScore) : null,
    entry: finalEntry,
    sl,
    tp,
    tpRawAtr: Number.isFinite(Number(result.tpRawAtr)) ? Number(result.tpRawAtr) : null,
    tpCappedByResistance:
      typeof result.tpCappedByResistance === "boolean" ? result.tpCappedByResistance : null,
    tpCappedBySupport:
      typeof result.tpCappedBySupport === "boolean" ? result.tpCappedBySupport : null,
    reason: result.reason || "selected",
    meta: result.meta || {},
  };
}

function applyTradeManagementToResult(result, tradeManagement) {
  if (!result) return result;

  const management = resolveTradeManagement(tradeManagement);
  const tpFactor = Number(management.tpFactor || 1);

  if (!Number.isFinite(tpFactor) || tpFactor === 1) {
    return {
      ...result,
      management,
    };
  }

  const entry = Number(result.entry);
  const tp = Number(result.tp);

  if (!Number.isFinite(entry) || !Number.isFinite(tp)) {
    return {
      ...result,
      management,
    };
  }

  const direction = String(result.direction || "LONG").toUpperCase();
  const rewardAbs = Math.abs(tp - entry);
  const adjustedRewardAbs = rewardAbs * tpFactor;
  const adjustedTp =
    direction === "SHORT" ? entry - adjustedRewardAbs : entry + adjustedRewardAbs;

  return {
    ...result,
    tp: adjustedTp,
    management,
    meta: {
      ...(result.meta || {}),
      managementTpFactor: tpFactor,
      managementOriginalTp: tp,
      managementAdjustedTp: adjustedTp,
    },
  };
}

function buildTradeFeatureSnapshot({ symbol, ctx, result, currentClosed }) {
  const indicators = ctx?.indicators || {};
  const direction = String(result?.direction || "LONG").toUpperCase();
  const atr = Number(indicators.atr);
  const entry = Number(result?.entry);
  const sl = Number(result?.sl);
  const tp = Number(result?.tp);
  const nearestSupport = Number(ctx?.nearestSupport?.price);
  const nearestResistance = Number(ctx?.nearestResistance?.price);
  const riskAbs = Math.abs(entry - sl);
  const rewardAbs = Math.abs(tp - entry);
  const srEval = direction === "SHORT" ? ctx?.srEvalShort : ctx?.srEvalLong;

  const distanceToSupportAtr =
    Number.isFinite(nearestSupport) && Number.isFinite(atr) && atr > 0
      ? (entry - nearestSupport) / atr
      : null;
  const distanceToResistanceAtr =
    Number.isFinite(nearestResistance) && Number.isFinite(atr) && atr > 0
      ? (nearestResistance - entry) / atr
      : null;

  return {
    signalTs: currentClosed.closeTime,
    signalIso: formatIso(currentClosed.closeTime),
    signalCandleCloseTime: currentClosed.closeTime,
    signalCandleCloseIso: formatIso(currentClosed.closeTime),
    referenceCandleCloseTime: currentClosed.closeTime,
    referenceCandleCloseIso: formatIso(currentClosed.closeTime),
    symbol,
    tf: TF,
    htfTf: HTF_TF,
    strategy: result.strategy,
    direction,
    score: Number(result.score || 0),
    signalClass: result.signalClass || "EXECUTABLE",
    minScore: Number.isFinite(Number(result.minScore)) ? Number(result.minScore) : null,
    price: entry,
    entry,
    sl,
    tp,
    tpRawAtr: Number.isFinite(Number(result.tpRawAtr)) ? Number(result.tpRawAtr) : null,
    tpCappedByResistance:
      typeof result.tpCappedByResistance === "boolean" ? result.tpCappedByResistance : null,
    tpCappedBySupport:
      typeof result.tpCappedBySupport === "boolean" ? result.tpCappedBySupport : null,
    riskAbs,
    rewardAbs,
    rrPlanned: safeRatio(rewardAbs, riskAbs),
    rsi: Number.isFinite(Number(indicators.rsi)) ? Number(indicators.rsi) : null,
    prevRsi: Number.isFinite(Number(indicators.prevRsi)) ? Number(indicators.prevRsi) : null,
    atr: Number.isFinite(atr) ? atr : null,
    atrPct: Number.isFinite(Number(indicators.atrPct)) ? Number(indicators.atrPct) : null,
    adx: Number.isFinite(Number(indicators.adx)) ? Number(indicators.adx) : null,
    ema20: Number.isFinite(Number(indicators.ema20)) ? Number(indicators.ema20) : null,
    ema50: Number.isFinite(Number(indicators.ema50)) ? Number(indicators.ema50) : null,
    ema200: Number.isFinite(Number(indicators.ema200)) ? Number(indicators.ema200) : null,
    bullish: indicators.bullish ?? null,
    bullishFast: indicators.bullishFast ?? null,
    nearEma20: indicators.nearEma20 ?? null,
    nearEma50: indicators.nearEma50 ?? null,
    nearPullback: indicators.nearPullback ?? null,
    stackedEma: indicators.stackedEma ?? null,
    rsiRising: indicators.rsiRising ?? null,
    isTrend: indicators.isTrend ?? null,
    isRange: indicators.isRange ?? null,
    emaSeparationPct:
      Number.isFinite(Number(indicators.emaSeparationPct))
        ? Number(indicators.emaSeparationPct)
        : null,
    emaSlopePct:
      Number.isFinite(Number(indicators.emaSlopePct)) ? Number(indicators.emaSlopePct) : null,
    distToEma20:
      Number.isFinite(Number(indicators.distToEma20)) ? Number(indicators.distToEma20) : null,
    distToEma50:
      Number.isFinite(Number(indicators.distToEma50)) ? Number(indicators.distToEma50) : null,
    nearestSupport: Number.isFinite(nearestSupport) ? nearestSupport : null,
    nearestResistance: Number.isFinite(nearestResistance) ? nearestResistance : null,
    distanceToSupportAtr,
    distanceToResistanceAtr,
    srPassed:
      typeof srEval?.passed === "boolean"
        ? srEval.passed
        : srEval?.passed === undefined
          ? null
          : Boolean(srEval?.passed),
    srReason: typeof srEval?.reason === "string" ? srEval.reason : null,
    avgVol: Number.isFinite(Number(indicators.avgVol)) ? Number(indicators.avgVol) : null,
    ...flattenCandidateMeta(result.meta),
  };
}

const STRATEGY_REGISTRY = [
  {
    name: "range",
    direction: "LONG",
    evaluate: (ctx) => evaluateRangeStrategy(ctx),
  },
  {
    name: "oversoldBounce",
    direction: "LONG",
    evaluate: (ctx) => evaluateOversoldBounceStrategy(ctx),
  },
  {
    name: "failedBreakdown",
    direction: "LONG",
    evaluate: (ctx) => evaluateFailedBreakdownStrategy(ctx),
  },
  {
    name: "breakdownRetestShort",
    direction: "SHORT",
    evaluate: (ctx) => evaluateBreakdownRetestShortStrategy(ctx),
  },
  {
    name: "bullTrap",
    direction: "SHORT",
    evaluate: (ctx) => evaluateBullTrapStrategy(ctx),
  },
  {
    name: "liquiditySweepReclaimLong",
    direction: "LONG",
    evaluate: (ctx) => evaluateLiquiditySweepReclaimLongStrategy(ctx),
  },
  {
    name: "momentumBreakoutLong",
    direction: "LONG",
    evaluate: (ctx) => evaluateMomentumBreakoutLongStrategy(ctx),
  },
  {
    name: "compressionBreakoutLong",
    direction: "LONG",
    evaluate: (ctx) => evaluateCompressionBreakoutLongStrategy(ctx),
  },
  {
    name: "compressionBreakdownShort",
    direction: "SHORT",
    evaluate: (ctx) => evaluateCompressionBreakdownShortStrategy(ctx),
  },
  {
    name: "breakdownContinuationBaseShort",
    direction: "SHORT",
    evaluate: (ctx) => evaluateBreakdownContinuationBaseShortStrategy(ctx),
  },
  {
    name: "impulseBreakoutLong",
    direction: "LONG",
    evaluate: (ctx) =>
      evaluateImpulseBreakoutLongStrategy({
        ...ctx,
        atr: ctx.atr,
        price: ctx.price,
        ema50: ctx.ema50,
        ema200: ctx.ema200,
        adx: ctx.adx,
        bullish: ctx.bullish,
        nearestResistance: ctx.nearestResistance?.price ?? null,
      }),
  },
  {
    name: "impulseBreakoutShort",
    direction: "SHORT",
    evaluate: (ctx) =>
      evaluateImpulseBreakoutShortStrategy({
        ...ctx,
        atr: ctx.atr,
        price: ctx.price,
        ema50: ctx.ema50,
        ema200: ctx.ema200,
        adx: ctx.adx,
        bearish: ctx.bearish,
        nearestSupport: ctx.nearestSupport?.price ?? null,
      }),
  },
  {
    name: "trendRunner",
    direction: "LONG",
    evaluate: (ctx) =>
      evaluateTrendRunnerLongStrategy({
        ...ctx,
        indicators: {
          ...ctx.indicators,
          candles: ctx.candles,
          price: ctx.price,
        },
      }),
  },
  {
    name: "trendRunnerShort",
    direction: "SHORT",
    evaluate: (ctx) =>
      evaluateTrendRunnerShortStrategy({
        ...ctx,
        indicators: {
          ...ctx.indicators,
          candles: ctx.candles,
          price: ctx.price,
        },
      }),
  },
  {
    name: "cipherContinuationShort",
    direction: "SHORT",
    evaluate: (ctx) => evaluateCipherContinuationShortStrategy(ctx),
  },
  {
    name: "cipherContinuationLong",
    direction: "LONG",
    evaluate: (ctx) => evaluateCipherContinuationLongStrategy(ctx),
  },
  {
    name: "ignitionContinuationLong",
    direction: "LONG",
    evaluate: (ctx) => evaluateIgnitionContinuationLongStrategy(ctx),
  },
];

function resolveRequestedStrategies(explicitStrategies = null) {
  const requested =
    Array.isArray(explicitStrategies) && explicitStrategies.length
      ? explicitStrategies
      : parseStrategiesOverride(process.env.BACKTEST_STRATEGIES);

  if (!requested.length) {
    return STRATEGY_REGISTRY;
  }

  const requestedSet = new Set(requested);
  const selected = STRATEGY_REGISTRY.filter((strategyDef) =>
    requestedSet.has(strategyDef.name)
  );

  const missing = requested.filter(
    (name) => !selected.some((strategyDef) => strategyDef.name === name)
  );

  if (missing.length) {
    throw new Error(`Estratégias não encontradas: ${missing.join(", ")}`);
  }

  return selected;
}

function getHtfCandlesForTime(allHtfCandles, closeTime) {
  const rows = [];
  for (const candle of allHtfCandles) {
    if (Number(candle.closeTime) <= Number(closeTime)) rows.push(candle);
    else break;
  }
  return rows;
}

function closeTradeIfNeeded(trade, candle, tradeManagement = null) {
  if (!trade) return null;

  const management = tradeManagement || trade.management || resolveTradeManagement();
  const high = Number(candle.high);
  const low = Number(candle.low);
  const initialRiskAbs =
    Number.isFinite(Number(trade.initialRiskAbs)) && Number(trade.initialRiskAbs) > 0
      ? Number(trade.initialRiskAbs)
      : Math.abs(Number(trade.entry) - Number(trade.initialSl ?? trade.sl));

  if (trade.direction === "LONG") {
    const slHit = low <= trade.sl;
    const tpHit = high >= trade.tp;

    if (!slHit && !tpHit) return null;

    const exitPrice = slHit ? trade.sl : trade.tp;
    const outcome = slHit ? "SL" : "TP";
    const pnlPct = safeRatio(exitPrice - trade.entry, trade.entry) * 100;
    const rr = safeRatio(exitPrice - trade.entry, initialRiskAbs);

    return applyExecutionCostsToTrade({
      ...trade,
      outcome,
      exitPrice,
      pnlPct,
      rr,
      closeTime: candle.closeTime,
      barsHeld: trade.barsHeld + 1,
    });
  }

  const slHit = high >= trade.sl;
  const tpHit = low <= trade.tp;

  if (slHit || tpHit) {
    const exitPrice = slHit ? trade.sl : trade.tp;
    const outcome = slHit ? "SL" : "TP";
    const pnlPct = safeRatio(trade.entry - exitPrice, trade.entry) * 100;
    const rr = safeRatio(trade.entry - exitPrice, initialRiskAbs);

    return applyExecutionCostsToTrade({
      ...trade,
      outcome,
      exitPrice,
      pnlPct,
      rr,
      closeTime: candle.closeTime,
      barsHeld: trade.barsHeld + 1,
    });
  }

  const breakEvenTriggerR = Number(management.breakEvenTriggerR || 0);
  const breakEvenLockR = Number(management.breakEvenLockR || 0);
  const breakEvenMinBars = Number(management.breakEvenMinBars || 1);
  const ageBars = Number(trade.barsHeld || 0) + 1;

  if (
    Number.isFinite(initialRiskAbs) &&
    initialRiskAbs > 0 &&
    !trade.breakEvenApplied &&
    Number.isFinite(breakEvenTriggerR) &&
    breakEvenTriggerR > 0 &&
    ageBars >= breakEvenMinBars
  ) {
    const favMove =
      trade.direction === "LONG"
        ? Number(candle.high) - Number(trade.entry)
        : Number(trade.entry) - Number(candle.low);
    const rNow = favMove / initialRiskAbs;

    if (Number.isFinite(rNow) && rNow >= breakEvenTriggerR) {
      const newSl =
        trade.direction === "LONG"
          ? Number(trade.entry) + initialRiskAbs * breakEvenLockR
          : Number(trade.entry) - initialRiskAbs * breakEvenLockR;

      trade.prevSl = trade.sl;
      trade.sl = newSl;
      trade.breakEvenApplied = true;
      trade.breakEvenAtR = rNow;
    }
  }

  return null;
}

function summarizeTrades(trades) {
  const wins = trades.filter((t) => t.outcome === "TP");
  const losses = trades.filter((t) => t.outcome === "SL");
  const grossProfit = wins.reduce(
    (sum, t) => sum + Number((t.grossPnlPct ?? t.pnlPct) || 0),
    0
  );
  const grossLossAbs = Math.abs(
    losses.reduce((sum, t) => sum + Number((t.grossPnlPct ?? t.pnlPct) || 0), 0)
  );
  const netProfit = trades
    .filter((t) => Number(t.netPnlPct || 0) > 0)
    .reduce((sum, t) => sum + Number(t.netPnlPct || 0), 0);
  const netLossAbs = Math.abs(
    trades
      .filter((t) => Number(t.netPnlPct || 0) < 0)
      .reduce((sum, t) => sum + Number(t.netPnlPct || 0), 0)
  );
  const avgGrossPnlPct = trades.length
    ? trades.reduce((sum, t) => sum + Number((t.grossPnlPct ?? t.pnlPct) || 0), 0) / trades.length
    : 0;
  const avgNetPnlPct = trades.length
    ? trades.reduce((sum, t) => sum + Number((t.netPnlPct ?? t.pnlPct) || 0), 0) / trades.length
    : 0;
  const avgR = trades.length
    ? trades.reduce((sum, t) => sum + Number(t.rr || 0), 0) / trades.length
    : 0;
  const estimatedFees = trades.reduce(
    (sum, t) => sum + Number(t.estimatedFeesPct || 0),
    0
  );
  const estimatedSlippage = trades.reduce(
    (sum, t) => sum + Number(t.estimatedSlippagePct || 0),
    0
  );
  const grossPnl = trades.reduce(
    (sum, t) => sum + Number((t.grossPnlPct ?? t.pnlPct) || 0),
    0
  );
  const netPnl = trades.reduce(
    (sum, t) => sum + Number((t.netPnlPct ?? t.pnlPct) || 0),
    0
  );

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += Number((trade.netPnlPct ?? trade.pnlPct) || 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }

  return {
    trades: trades.length,
    tp: wins.length,
    sl: losses.length,
    winrate: trades.length ? (wins.length / trades.length) * 100 : 0,
    avgPnlPct: avgNetPnlPct,
    avgGrossPnlPct,
    avgNetPnlPct,
    avgR,
    profitFactor: netLossAbs > 0 ? netProfit / netLossAbs : netProfit > 0 ? 999 : 0,
    profitFactorGross: grossLossAbs > 0 ? grossProfit / grossLossAbs : wins.length ? 999 : 0,
    profitFactorNet: netLossAbs > 0 ? netProfit / netLossAbs : netProfit > 0 ? 999 : 0,
    grossPnl,
    estimatedFees,
    estimatedSlippage,
    netPnl,
    grossProfit,
    grossLossAbs,
    netProfit,
    netLossAbs,
    maxDrawdownPct: Math.abs(maxDrawdown),
  };
}

async function backtestStrategyOnSymbol(
  strategyDef,
  symbol,
  ltfCandles,
  htfCandles,
  cfg,
  tradeManagement = null
) {
  const closedTrades = [];
  let openTrade = null;

  for (let i = 220; i < ltfCandles.length - 1; i += 1) {
    const closedLtf = ltfCandles.slice(0, i + 1);
    const currentClosed = closedLtf[closedLtf.length - 1];
    const usableHtf = getHtfCandlesForTime(htfCandles, currentClosed.closeTime);
    const ctx = buildBaseContext({
      symbol,
      cfg,
      candles: closedLtf,
      htfCandles: usableHtf,
    });

    if (!ctx) continue;

    if (openTrade) {
      const closed = closeTradeIfNeeded(openTrade, currentClosed, tradeManagement);
      if (closed) {
        closedTrades.push(closed);
        openTrade = null;
      } else {
        openTrade.barsHeld += 1;
      }
    }

    if (openTrade) continue;

    let rawResult;
    try {
      rawResult = strategyDef.evaluate(ctx);
    } catch (error) {
      rawResult = null;
    }

    const result = normalizeResult(
      rawResult,
      strategyDef.name,
      strategyDef.direction,
      ctx.indicators.entry
    );

    if (!result) continue;
    const managedResult = applyTradeManagementToResult(result, tradeManagement);

    openTrade = {
      symbol,
      strategy: managedResult.strategy,
      direction: managedResult.direction,
      openTime: currentClosed.closeTime,
      entry: managedResult.entry,
      sl: managedResult.sl,
      tp: managedResult.tp,
      initialSl: managedResult.sl,
      initialTp: managedResult.tp,
      score: managedResult.score,
      signalClass: managedResult.signalClass,
      minScore: managedResult.minScore,
      reason: managedResult.reason,
      barsHeld: 0,
      breakEvenApplied: false,
      breakEvenAtR: null,
      prevSl: null,
      initialRiskAbs: Math.abs(Number(managedResult.entry) - Number(managedResult.sl)),
      management: resolveTradeManagement(tradeManagement),
      ...buildTradeFeatureSnapshot({
        symbol,
        ctx,
        result: managedResult,
        currentClosed,
      }),
    };
  }

  return closedTrades;
}

function rankStrategies(results) {
  return [...results].sort((a, b) => {
    const sampleGateA = a.summary.trades >= 8 ? 1 : 0;
    const sampleGateB = b.summary.trades >= 8 ? 1 : 0;
    if (sampleGateB !== sampleGateA) return sampleGateB - sampleGateA;
    if (b.summary.avgPnlPct !== a.summary.avgPnlPct) {
      return b.summary.avgPnlPct - a.summary.avgPnlPct;
    }
    if (b.summary.profitFactor !== a.summary.profitFactor) {
      return b.summary.profitFactor - a.summary.profitFactor;
    }
    if (b.summary.winrate !== a.summary.winrate) {
      return b.summary.winrate - a.summary.winrate;
    }
    return b.summary.trades - a.summary.trades;
  });
}

async function runCandidateStrategyBacktest({
  symbols: explicitSymbols,
  strategies: explicitStrategies,
  outputFile = DEFAULT_OUTPUT_FILE,
  configOverrides: explicitConfigOverrides,
  includeTrades: explicitIncludeTrades,
  tradeManagement: explicitTradeManagement,
} = {}) {
  const symbols = resolveRequestedSymbols(explicitSymbols);
  const selectedStrategies = resolveRequestedStrategies(explicitStrategies);
  const configOverrides =
    explicitConfigOverrides || parseConfigOverrides(process.env.BACKTEST_CONFIG_OVERRIDES);
  const includeTrades =
    typeof explicitIncludeTrades === "boolean"
      ? explicitIncludeTrades
      : BACKTEST_INCLUDE_TRADES;
  const tradeManagement = resolveTradeManagement(explicitTradeManagement);
  const runtimeConfig = buildRequestedConfig(symbols, configOverrides);
  const symbolData = {};
  const availableSymbols = await fetchAvailableFuturesSymbols();
  const unavailableSymbols = symbols.filter((symbol) => !availableSymbols.has(symbol));

  if (unavailableSymbols.length) {
    throw new Error(
      `Símbolos não disponíveis em Binance Futures: ${unavailableSymbols.join(", ")}`
    );
  }

  for (const symbol of symbols) {
    console.log(`[FETCH] ${symbol} ${TF}/${HTF_TF}`);
    const [ltfCandles, htfCandles] = await Promise.all([
      fetchKlines(symbol, TF, LTF_LIMIT),
      fetchKlines(symbol, HTF_TF, HTF_LIMIT),
    ]);

    symbolData[symbol] = { ltfCandles, htfCandles };
  }

  const backtestResults = [];

  for (const strategyDef of selectedStrategies) {
    const allTrades = [];
    const bySymbol = {};

    console.log(`\n[BACKTEST] ${strategyDef.name}`);

    for (const symbol of symbols) {
      const cfg = runtimeConfig[symbol];
      const { ltfCandles, htfCandles } = symbolData[symbol];
      const trades = await backtestStrategyOnSymbol(
        strategyDef,
        symbol,
        ltfCandles,
        htfCandles,
        cfg,
        tradeManagement
      );

      bySymbol[symbol] = {
        summary: summarizeTrades(trades),
        sampleTrades: trades.slice(-3),
        ...(includeTrades ? { trades } : {}),
      };

      allTrades.push(...trades);
    }

    backtestResults.push({
      strategy: strategyDef.name,
      direction: strategyDef.direction,
      summary: summarizeTrades(allTrades),
      bySymbol,
    });
  }

  const ranked = rankStrategies(backtestResults);
  const representativeSymbol = symbols[0];
  const representativeCandles = symbolData[representativeSymbol]?.ltfCandles || [];
  const windowStart = representativeCandles[0]?.openTime || null;
  const windowEnd =
    representativeCandles[representativeCandles.length - 1]?.closeTime || null;

  const output = {
    generatedAt: new Date().toISOString(),
    tf: TF,
    htfTf: HTF_TF,
    symbols,
    strategiesBacktested: selectedStrategies.map((row) => row.name),
    disabledSymbols: DISABLED_SYMBOLS,
    unavailableSymbols,
    configOverrides,
    tradeManagement,
    executionCosts: buildExecutionCostModel(),
    includeTrades,
    window: {
      start: windowStart ? formatIso(windowStart) : null,
      end: windowEnd ? formatIso(windowEnd) : null,
      ltfCandlesPerSymbol: LTF_LIMIT,
      htfCandlesPerSymbol: HTF_LIMIT,
    },
    ranked,
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");

  console.log(`\nWindow: ${output.window.start} -> ${output.window.end}`);
  console.log(`Saved: ${outputFile}`);

  ranked.slice(0, 8).forEach((row, index) => {
    console.log(
      `#${index + 1} ${row.strategy} ` +
        `trades=${row.summary.trades} ` +
        `winrate=${row.summary.winrate.toFixed(2)}% ` +
        `avgGross=${row.summary.avgGrossPnlPct.toFixed(4)}% ` +
        `avgNet=${row.summary.avgNetPnlPct.toFixed(4)}% ` +
        `pfNet=${row.summary.profitFactorNet.toFixed(3)} ` +
        `maxDD=${row.summary.maxDrawdownPct.toFixed(4)}`
    );
  });

  return output;
}

if (require.main === module) {
  runCandidateStrategyBacktest().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  runCandidateStrategyBacktest,
  parseSymbolsOverride,
  parseStrategiesOverride,
  parseConfigOverrides,
  parseOptionalNumber,
  resolveTradeManagement,
  resolveRequestedStrategies,
  createFallbackSymbolConfig,
  mergeDeep,
  fetchAvailableFuturesSymbols,
  fetchKlines,
  buildBaseContext,
  buildTradeFeatureSnapshot,
  applyTradeManagementToResult,
  buildExecutionCostModel,
  applyExecutionCostsToTrade,
  closeTradeIfNeeded,
  flattenCandidateMeta,
  buildRequestedConfig,
  resolveRequestedSymbols,
  normalizeResult,
  formatIso,
  round,
  STRATEGY_REGISTRY,
};
