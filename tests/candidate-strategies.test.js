const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateFailedBreakdownStrategy } = require("../strategies/failed-breakdown-strategy");

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

test("failedBreakdown returns LONG direction when setup is allowed", () => {
  const candles = [
    { open: 101.2, high: 102.5, low: 99.8, close: 101.4, volume: 100 },
    { open: 101.0, high: 103.0, low: 100.1, close: 102.2, volume: 100 },
    { open: 102.0, high: 103.5, low: 100.3, close: 101.8, volume: 100 },
    { open: 101.6, high: 104.2, low: 99.9, close: 102.8, volume: 100 },
    { open: 102.7, high: 104.5, low: 100.4, close: 103.2, volume: 100 },
    { open: 103.0, high: 104.8, low: 100.2, close: 102.9, volume: 100 },
    { open: 102.8, high: 105.0, low: 99.7, close: 103.5, volume: 100 },
    { open: 103.3, high: 104.1, low: 100.0, close: 102.6, volume: 100 },
    { open: 102.4, high: 103.9, low: 99.5, close: 101.9, volume: 100 },
    { open: 101.7, high: 103.2, low: 99.0, close: 100.6, volume: 100 },
    { open: 100.4, high: 101.2, low: 99.4, close: 99.7, volume: 100 },
    { open: 99.5, high: 100.8, low: 98.7, close: 100.2, volume: 160 },
  ];

  const result = evaluateFailedBreakdownStrategy({
    cfg: {},
    helpers: makeHelpers(),
    candles,
    nearestResistance: { price: 110 },
    indicators: {
      atr: 1,
      entry: 100.2,
      avgVol: 100,
      adx: 18,
      rsi: 45,
      prevRsi: 43.5,
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.direction, "LONG");
  assert.equal(result.reason, "selected");
});
