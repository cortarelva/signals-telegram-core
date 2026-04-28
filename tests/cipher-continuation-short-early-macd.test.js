const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;

Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "../indicators/market-indicators") {
    return {
      clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      },
      calcBollingerBands() {
        return {
          basis: 98.4,
          upper: 99.0,
          lower: 97.8,
        };
      },
      calcMACDSeries(values) {
        return values.map((_, index, arr) => {
          if (index === arr.length - 3) {
            return { macd: -0.03, signal: -0.06, hist: 0.03 };
          }
          if (index === arr.length - 2) {
            return { macd: -0.04, signal: -0.06, hist: 0.02 };
          }
          if (index === arr.length - 1) {
            return { macd: -0.05, signal: -0.06, hist: 0.01 };
          }
          return { macd: 0, signal: 0, hist: 0 };
        });
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const {
  evaluateCipherContinuationShortStrategy,
} = require("../strategies/cipher-continuation-short-strategy");

Module._load = originalLoad;

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

function makeShortCandles() {
  const candles = Array.from({ length: 60 }, (_, index) => ({
    open: 101 - index * 0.02,
    high: 101.2 - index * 0.02,
    low: 100.6 - index * 0.02,
    close: 100.8 - index * 0.02,
    volume: 100,
  }));

  candles[54] = { open: 98.8, high: 98.9, low: 98.3, close: 98.45, volume: 100 };
  candles[55] = { open: 98.7, high: 98.95, low: 98.2, close: 98.4, volume: 100 };
  candles[56] = { open: 98.8, high: 98.92, low: 98.25, close: 98.45, volume: 100 };
  candles[57] = { open: 98.75, high: 98.9, low: 98.22, close: 98.42, volume: 100 };
  candles[58] = { open: 98.5, high: 98.88, low: 98.18, close: 98.55, volume: 100 };
  candles[59] = { open: 98.7, high: 98.85, low: 97.9, close: 98.1, volume: 150 };

  return candles;
}

function evaluateWithMode(macdRolloverMode) {
  return evaluateCipherContinuationShortStrategy({
    cfg: {
      CIPHER_CONTINUATION_SHORT: {
        enabled: true,
        macdRolloverMode,
      },
    },
    helpers: makeHelpers(),
    candles: makeShortCandles(),
    nearestSupport: { price: 95.5 },
    indicators: {
      entry: 98.1,
      atr: 1,
      ema20: 98.9,
      ema50: 101.1,
      ema200: 102.2,
      adx: 15,
    },
  });
}

test("cipherContinuationShort keeps strict MACD rollover behaviour by default", () => {
  const result = evaluateWithMode("strict");

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "cipherContinuationShort:macd_not_rolling_over");
  assert.equal(result.meta.strictMacdRollingOver, false);
  assert.equal(result.meta.earlyMacdRollingOver, true);
});

test("cipherContinuationShort can allow early MACD rollover when requested", () => {
  const result = evaluateWithMode("early");

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "selected");
  assert.equal(result.meta.strictMacdRollingOver, false);
  assert.equal(result.meta.earlyMacdRollingOver, true);
  assert.equal(result.meta.macdRolloverMode, "early");
});
