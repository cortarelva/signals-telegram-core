const fs = require("fs");
const path = require("path");

const STRATEGY_FILE = path.join(__dirname, "..", "strategy-config.json");
const ADAPTIVE_FILE = path.join(__dirname, "..", "adaptive-config.json");
const DEFAULTS_KEY = "DEFAULTS";

function resolveStrategyFilePath() {
  return process.env.STRATEGY_CONFIG_FILE_PATH || STRATEGY_FILE;
}

function resolveAdaptiveFilePath() {
  return process.env.ADAPTIVE_CONFIG_FILE_PATH || ADAPTIVE_FILE;
}

function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeSymbolConfig(defaults = {}, symbolConfig = {}) {
  const merged = {
    ...(isPlainObject(defaults) ? defaults : {}),
    ...(isPlainObject(symbolConfig) ? symbolConfig : {}),
  };

  for (const [key, defaultValue] of Object.entries(defaults || {})) {
    const symbolValue = symbolConfig?.[key];
    if (isPlainObject(defaultValue) || isPlainObject(symbolValue)) {
      merged[key] = {
        ...(isPlainObject(defaultValue) ? defaultValue : {}),
        ...(isPlainObject(symbolValue) ? symbolValue : {}),
      };
    }
  }

  return merged;
}

function buildBaseRangeConfig(b = {}) {
  return {
    enabled: b.RANGE_ENABLED ?? b.ENABLED ?? true,
    rsiMin: b.RANGE_RSI_MIN ?? b.RSI_MIN ?? 35,
    rsiMax: b.RANGE_RSI_MAX ?? b.RSI_MAX ?? 45,
    slAtrMult: b.RANGE_SL_ATR_MULT ?? b.SL_ATR_MULT ?? 2.5,
    tpAtrMult: b.RANGE_TP_ATR_MULT ?? b.TP_ATR_MULT ?? 1.8,
    minScore: b.RANGE_MIN_SCORE ?? b.MIN_SCORE ?? 65,
    minAdx: b.RANGE_MIN_ADX ?? b.MIN_ADX ?? 0,
    requireTrend: b.RANGE_REQUIRE_TREND ?? false,
    requireRange: b.RANGE_REQUIRE_RANGE ?? b.REQUIRE_RANGE ?? false,
    requireNearPullback:
      b.RANGE_REQUIRE_NEAR_PULLBACK ?? b.REQUIRE_NEAR_PULLBACK ?? false,
    requireStackedEma:
      b.RANGE_REQUIRE_STACKED_EMA ?? b.REQUIRE_STACKED_EMA ?? false,
    requireNearEma20:
      b.RANGE_REQUIRE_NEAR_EMA20 ?? b.REQUIRE_NEAR_EMA20 ?? false,
    requireRsiRising:
      b.RANGE_REQUIRE_RSI_RISING ?? b.REQUIRE_RSI_RISING ?? false,
    requireSr: b.RANGE_REQUIRE_SR ?? b.REQUIRE_SR ?? true,
    minSpaceToTargetAtr:
      b.RANGE_MIN_SPACE_TO_TARGET_ATR ?? b.MIN_SPACE_TO_TARGET_ATR ?? 0.8,
    maxDistanceFromSupportAtr:
      b.RANGE_MAX_DISTANCE_FROM_SUPPORT_ATR ??
      b.MAX_DISTANCE_FROM_SUPPORT_ATR ??
      1.2,
    tpResistanceBufferAtr:
      b.RANGE_TP_RESISTANCE_BUFFER_ATR ??
      b.TP_RESISTANCE_BUFFER_ATR ??
      0.15,
  };
}

function buildBaseTrendConfig(b = {}) {
  const trendCfg = isPlainObject(b.TREND) ? b.TREND : {};

  return {
    enabled: trendCfg.enabled ?? b.TREND_ENABLED ?? b.ENABLED ?? true,
    allow15m: trendCfg.allow15m ?? b.TREND_ALLOW_15M ?? false,
    rsiMin: trendCfg.rsiMin ?? b.TREND_RSI_MIN ?? b.RSI_MIN ?? 45,
    rsiMax: trendCfg.rsiMax ?? b.TREND_RSI_MAX ?? b.RSI_MAX ?? 60,
    slAtrMult: trendCfg.slAtrMult ?? b.TREND_SL_ATR_MULT ?? b.SL_ATR_MULT ?? 1.4,
    tpAtrMult: trendCfg.tpAtrMult ?? b.TREND_TP_ATR_MULT ?? b.TP_ATR_MULT ?? 2.8,
    minScore: trendCfg.minScore ?? b.TREND_MIN_SCORE ?? b.MIN_SCORE ?? 65,
    minAdx: trendCfg.minAdx ?? b.TREND_MIN_ADX ?? b.MIN_ADX ?? 25,
    requireTrend: trendCfg.requireTrend ?? b.TREND_REQUIRE_TREND ?? b.REQUIRE_TREND ?? true,
    requireRange: trendCfg.requireRange ?? b.TREND_REQUIRE_RANGE ?? false,
    requireNearPullback:
      trendCfg.requireNearPullback ??
      b.TREND_REQUIRE_NEAR_PULLBACK ??
      b.REQUIRE_NEAR_PULLBACK ??
      false,
    requireStackedEma:
      trendCfg.requireStackedEma ??
      b.TREND_REQUIRE_STACKED_EMA ??
      b.REQUIRE_STACKED_EMA ??
      false,
    requireNearEma20:
      trendCfg.requireNearEma20 ??
      b.TREND_REQUIRE_NEAR_EMA20 ??
      b.REQUIRE_NEAR_EMA20 ??
      false,
    requireRsiRising:
      trendCfg.requireRsiRising ??
      b.TREND_REQUIRE_RSI_RISING ??
      b.REQUIRE_RSI_RISING ??
      false,
    requireRsiFalling:
      trendCfg.requireRsiFalling ??
      b.TREND_REQUIRE_RSI_FALLING ??
      b.REQUIRE_RSI_FALLING ??
      false,
    requireSr: trendCfg.requireSr ?? b.TREND_REQUIRE_SR ?? b.REQUIRE_SR ?? false,
    minSpaceToTargetAtr:
      trendCfg.minSpaceToTargetAtr ??
      b.TREND_MIN_SPACE_TO_TARGET_ATR ??
      b.MIN_SPACE_TO_TARGET_ATR ??
      0.8,
    maxDistanceFromSupportAtr:
      trendCfg.maxDistanceFromSupportAtr ??
      b.TREND_MAX_DISTANCE_FROM_SUPPORT_ATR ??
      b.MAX_DISTANCE_FROM_SUPPORT_ATR ??
      1.2,
    tpResistanceBufferAtr:
      trendCfg.tpResistanceBufferAtr ??
      b.TREND_TP_RESISTANCE_BUFFER_ATR ??
      b.TP_RESISTANCE_BUFFER_ATR ??
      0.15,
  };
}

function buildFlatLegacyConfig(b = {}, a = {}) {
  const baseEnabled = b.ENABLED;
  const effectiveEnabled =
    baseEnabled === false ? false : a.enabled ?? baseEnabled;

  return {
    ...b,
    ENABLED: effectiveEnabled,
    RSI_MIN: a.rsiMin ?? b.RSI_MIN,
    RSI_MAX: a.rsiMax ?? b.RSI_MAX,
    SL_ATR_MULT: a.slAtrMult ?? b.SL_ATR_MULT,
    TP_ATR_MULT: a.tpAtrMult ?? b.TP_ATR_MULT,
    MIN_SCORE: a.minScore ?? b.MIN_SCORE ?? 70,
    MIN_ADX: a.minAdx ?? b.MIN_ADX ?? 0,
    REQUIRE_TREND: a.requireTrend ?? b.REQUIRE_TREND ?? false,
    REQUIRE_RANGE: a.requireRange ?? b.REQUIRE_RANGE ?? false,
    REQUIRE_SR: a.requireSr ?? b.REQUIRE_SR ?? true,
    REQUIRE_NEAR_PULLBACK:
      a.requireNearPullback ?? b.REQUIRE_NEAR_PULLBACK ?? false,
    REQUIRE_STACKED_EMA:
      a.requireStackedEma ?? b.REQUIRE_STACKED_EMA ?? false,
    REQUIRE_NEAR_EMA20: a.requireNearEma20 ?? b.REQUIRE_NEAR_EMA20 ?? false,
    REQUIRE_RSI_RISING: a.requireRsiRising ?? b.REQUIRE_RSI_RISING ?? false,
    REQUIRE_RSI_FALLING: a.requireRsiFalling ?? b.REQUIRE_RSI_FALLING ?? false,
    MIN_SPACE_TO_TARGET_ATR:
      a.minSpaceToTargetAtr ?? b.MIN_SPACE_TO_TARGET_ATR ?? 0.8,
    MAX_DISTANCE_FROM_SUPPORT_ATR:
      a.maxDistanceFromSupportAtr ?? b.MAX_DISTANCE_FROM_SUPPORT_ATR ?? 1.2,
    TP_RESISTANCE_BUFFER_ATR:
      a.tpResistanceBufferAtr ?? b.TP_RESISTANCE_BUFFER_ATR ?? 0.15,
  };
}

function loadRuntimeConfigFiles({
  strategyFile = resolveStrategyFilePath(),
  adaptiveFile = resolveAdaptiveFilePath(),
} = {}) {
  const base = loadJSON(strategyFile);
  const adaptive = loadJSON(adaptiveFile);
  const baseDefaults = isPlainObject(base?.[DEFAULTS_KEY])
    ? base[DEFAULTS_KEY]
    : {};

  const result = {};

  for (const symbol of Object.keys(base)) {
    if (symbol === DEFAULTS_KEY) continue;

    const b = mergeSymbolConfig(baseDefaults, base[symbol] || {});
    const a = adaptive.symbols?.[symbol] || {};

    const baseRange = buildBaseRangeConfig(b);
    const baseTrend = buildBaseTrendConfig(b);
    const baseTrendShort = {
      ...(isPlainObject(baseDefaults?.TREND_SHORT) ? baseDefaults.TREND_SHORT : {}),
      ...(isPlainObject(b?.TREND_SHORT) ? b.TREND_SHORT : {}),
    };

    const adaptiveRange = a.range || {};
    const adaptiveTrend = a.trend || {};
    const adaptiveTrendShort = a.trendShort || {};

    result[symbol] = {
      ...buildFlatLegacyConfig(b, a),

      RANGE: {
        ...baseRange,
        ...adaptiveRange,
      },

      TREND: {
        ...baseTrend,
        ...adaptiveTrend,
      },

      TREND_SHORT: {
        ...baseTrendShort,
        ...adaptiveTrendShort,
      },
    };
  }

  return result;
}

function loadRuntimeConfig() {
  return loadRuntimeConfigFiles();
}

module.exports = { loadRuntimeConfig, loadRuntimeConfigFiles };
