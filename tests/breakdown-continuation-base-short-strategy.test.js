const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateBreakdownContinuationBaseShortStrategy,
} = require("../strategies/breakdown-continuation-base-short-strategy");

function makeHelpers() {
  return {
    paperMinScore: 60,
    round(value, decimals = 6) {
      return Number(Number(value).toFixed(decimals));
    },
    safeRatio(a, b) {
      if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
      return a / b;
    },
  };
}

function makeCandles() {
  return [
    { open: 104.2, high: 104.5, low: 103.6, close: 104.0, volume: 100 },
    { open: 104.0, high: 104.2, low: 103.1, close: 103.4, volume: 101 },
    { open: 103.4, high: 103.6, low: 102.6, close: 102.9, volume: 102 },
    { open: 102.9, high: 103.0, low: 102.2, close: 102.4, volume: 103 },
    { open: 102.4, high: 102.7, low: 101.7, close: 101.9, volume: 104 },
    { open: 101.8, high: 103.0, low: 101.2, close: 102.5, volume: 105 },
    { open: 102.5, high: 102.8, low: 100.9, close: 101.3, volume: 110 },
    { open: 101.3, high: 101.6, low: 100.0, close: 100.4, volume: 112 },
    { open: 100.4, high: 100.8, low: 99.6, close: 99.9, volume: 115 },
    { open: 99.9, high: 100.2, low: 99.2, close: 99.4, volume: 118 },
    { open: 99.4, high: 99.45, low: 98.97, close: 99.12, volume: 90 },
    { open: 99.12, high: 99.20, low: 98.98, close: 99.10, volume: 88 },
    { open: 99.10, high: 99.22, low: 99.00, close: 99.08, volume: 92 },
    { open: 99.08, high: 99.18, low: 98.99, close: 99.05, volume: 86 },
    { open: 99.05, high: 99.15, low: 98.97, close: 99.02, volume: 87 },
    { open: 99.02, high: 99.16, low: 98.98, close: 99.00, volume: 89 },
    { open: 99.00, high: 99.02, low: 98.55, close: 98.60, volume: 180 },
  ];
}

test("breakdownContinuationBaseShort allows a weak-base breakdown short", () => {
  const result = evaluateBreakdownContinuationBaseShortStrategy({
    cfg: {},
    helpers: makeHelpers(),
    candles: makeCandles(),
    nearestSupport: { price: 97.2 },
    indicators: {
      atr: 0.5,
      entry: 98.6,
      ema20: 99.0,
      ema50: 99.35,
      ema200: 100.1,
      bullish: false,
      bullishFast: false,
      adx: 24,
      rsi: 49,
      avgVol: 100,
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.direction, "SHORT");
  assert.equal(result.reason, "selected");
  assert.equal(result.signalClass, "EXECUTABLE");
});

test("breakdownContinuationBaseShort blocks when there is no real breakdown close", () => {
  const candles = makeCandles();
  candles[candles.length - 1] = {
    open: 99.0,
    high: 99.01,
    low: 98.92,
    close: 98.96,
    volume: 160,
  };

  const result = evaluateBreakdownContinuationBaseShortStrategy({
    cfg: {},
    helpers: makeHelpers(),
    candles,
    nearestSupport: { price: 97.2 },
    indicators: {
      atr: 0.5,
      entry: 98.96,
      ema20: 99.0,
      ema50: 99.35,
      ema200: 100.1,
      bullish: false,
      bullishFast: false,
      adx: 24,
      rsi: 49,
      avgVol: 100,
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "breakdownContinuationBaseShort:no_breakdown_close");
});
