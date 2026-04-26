const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateAllStrategies } = require("../strategies");
const { evaluateTrendStrategy } = require("../strategies/trend-strategy");
const { evaluateTrendShortStrategy } = require("../strategies/trend-short-strategy");

function makeHelpers(tf = "1h") {
  return {
    tf,
    defaults: {
      trendRsiMin: 45,
      trendRsiMax: 60,
      trendSlAtrMult: 1.4,
      trendTpAtrMult: 2.4,
      trendMinAdx: 18,
    },
    round(value, decimals = 2) {
      return Number(Number(value).toFixed(decimals));
    },
    safeRatio(a, b) {
      if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
      return a / b;
    },
  };
}

test("trend strategy respects TREND.enabled=false", () => {
  const result = evaluateTrendStrategy({
    indicators: {
      rsi: 52,
      adx: 24,
      nearEma20: true,
      nearEma50: false,
      rsiRising: true,
      entry: 100,
      ema50: 99,
      atr: 1.2,
    },
    marketStructure: {
      htf: { bullish: true, bias: "bullish" },
      ltf: { bullishShift: true, pullbackToLastHtfLowPct: 0.01 },
    },
    helpers: makeHelpers(),
    cfg: {
      TREND: {
        enabled: false,
      },
      REQUIRE_SR: true,
    },
    srEvalLong: { passed: true, reason: "ok" },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "trend:disabled");
});

test("trend strategy blocks 15m by default", () => {
  const result = evaluateTrendStrategy({
    indicators: {
      rsi: 52,
      adx: 24,
      nearEma20: true,
      nearEma50: false,
      rsiRising: true,
      entry: 100,
      ema50: 99,
      atr: 1.2,
    },
    marketStructure: {
      htf: { bullish: true, bias: "bullish" },
      ltf: { bullishShift: true, pullbackToLastHtfLowPct: 0.01 },
    },
    helpers: makeHelpers("15m"),
    cfg: {
      TREND: {
        enabled: true,
      },
      REQUIRE_SR: true,
    },
    srEvalLong: { passed: true, reason: "ok" },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "trend:disabled_on_15m");
});

test("trend strategy can trade on 15m when TREND.allow15m=true", () => {
  const result = evaluateTrendStrategy({
    indicators: {
      rsi: 52,
      adx: 24,
      nearEma20: true,
      nearEma50: false,
      rsiRising: true,
      entry: 100,
      ema50: 99,
      atr: 1.2,
    },
    marketStructure: {
      htf: { bullish: true, bias: "bullish" },
      ltf: { bullishShift: true, pullbackToLastHtfLowPct: 0.01 },
    },
    helpers: makeHelpers("15m"),
    cfg: {
      TREND: {
        enabled: true,
        allow15m: true,
        minScore: 60,
        minAdx: 20,
        rsiMin: 45,
        rsiMax: 60,
      },
      REQUIRE_SR: true,
    },
    srEvalLong: { passed: true, reason: "ok" },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "selected");
});

test("trendShort strategy respects TREND_SHORT.enabled=false", () => {
  const result = evaluateTrendShortStrategy({
    indicators: {
      rsi: 48,
      adx: 24,
      nearEma20: true,
      nearEma50: false,
      rsiRising: false,
      entry: 98,
      ema50: 99,
      atr: 1.2,
    },
    marketStructure: {
      htf: { bearish: true, bias: "bearish" },
      ltf: { bearishShift: true, pullbackToLastHtfHighPct: 0.01 },
    },
    helpers: makeHelpers(),
    cfg: {
      TREND_SHORT: {
        enabled: false,
      },
      REQUIRE_SR: true,
    },
    srEvalShort: { passed: true, reason: "ok" },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "trendShort:disabled");
});

test("evaluateAllStrategies only evaluates enabled strategies", () => {
  const result = evaluateAllStrategies({
    candles: [],
    helpers: {
      paperMinScore: 70,
    },
    cfg: {
      TREND: { enabled: false },
      TREND_SHORT: { enabled: false },
      BREAKDOWN_RETEST_SHORT: { enabled: false },
      BULL_TRAP: { enabled: false },
      FAILED_BREAKDOWN: { enabled: false },
      MOMENTUM_BREAKOUT_LONG: { enabled: false },
      CIPHER_CONTINUATION_LONG: { enabled: false },
      CIPHER_CONTINUATION_SHORT: { enabled: true },
      IGNITION_CONTINUATION_LONG: { enabled: false },
    },
  });

  assert.equal(result.all.length, 1);
  assert.equal(result.all[0].strategy, "cipherContinuationShort");
  assert.equal(result.blockedReason, "cipherContinuationShort:not_enough_context");
});
