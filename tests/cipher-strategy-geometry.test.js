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
      calcBollingerBands(values) {
        const last = Number(values.at(-1));
        const prev = Number(values.at(-2));

        if (last > prev) {
          return {
            basis: 101,
            upper: 102,
            lower: 100,
          };
        }

        return {
          basis: 98.4,
          upper: 99,
          lower: 97.8,
        };
      },
      calcMACDSeries(values) {
        const bullish = Number(values.at(-1)) > Number(values.at(-2));
        return values.map((_, index, arr) => {
          if (index === arr.length - 3 && bullish) {
            return { macd: 0.1, signal: 0.15, hist: 0.05 };
          }

          if (index === arr.length - 2 && bullish) {
            return { macd: 0.05, signal: 0.1, hist: -0.02 };
          }

          if (index === arr.length - 1 && bullish) {
            return { macd: 0.2, signal: 0.1, hist: 0.1 };
          }

          if (index === arr.length - 3 && !bullish) {
            return { macd: -0.04, signal: -0.02, hist: 0.01 };
          }

          if (index === arr.length - 2 && !bullish) {
            return { macd: -0.02, signal: 0.01, hist: 0.02 };
          }

          if (index === arr.length - 1 && !bullish) {
            return { macd: -0.15, signal: -0.05, hist: -0.08 };
          }

          return { macd: 0, signal: 0, hist: 0 };
        });
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const {
  evaluateCipherContinuationLongStrategy,
} = require("../strategies/cipher-continuation-long-strategy");
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

function makeLongCandles() {
  const candles = Array.from({ length: 60 }, (_, index) => ({
    open: 98 + index * 0.02,
    high: 98.4 + index * 0.02,
    low: 97.8 + index * 0.02,
    close: 98.2 + index * 0.02,
    volume: 100,
  }));

  candles[54] = { open: 101.0, high: 101.4, low: 101.18, close: 101.3, volume: 100 };
  candles[55] = { open: 101.1, high: 101.6, low: 101.3, close: 101.4, volume: 100 };
  candles[56] = { open: 101.0, high: 101.5, low: 101.25, close: 101.35, volume: 100 };
  candles[57] = { open: 101.05, high: 101.55, low: 101.22, close: 101.38, volume: 100 };
  candles[58] = { open: 101.2, high: 101.6, low: 101.24, close: 101.3, volume: 100 };
  candles[59] = { open: 100.7, high: 101.7, low: 100.9, close: 101.5, volume: 150 };

  return candles;
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

test("cipherContinuationLong blocks executable setups with stop above entry", () => {
  const result = evaluateCipherContinuationLongStrategy({
    cfg: {
      CIPHER_CONTINUATION_LONG: {
        enabled: true,
      },
    },
    helpers: makeHelpers(),
    candles: makeLongCandles(),
    nearestResistance: { price: 104 },
    indicators: {
      entry: 99.5,
      atr: 1,
      ema20: 101.1,
      ema50: 99.4,
      ema200: 98.7,
      adx: 15,
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "cipherContinuationLong:invalid_risk_shape");
  assert.equal(result.meta.validRiskShape, false);
});

test("cipherContinuationShort blocks executable setups with stop below entry", () => {
  const result = evaluateCipherContinuationShortStrategy({
    cfg: {
      CIPHER_CONTINUATION_SHORT: {
        enabled: true,
      },
    },
    helpers: makeHelpers(),
    candles: makeShortCandles(),
    nearestSupport: { price: 96.5 },
    indicators: {
      entry: 100,
      atr: 1,
      ema20: 98.9,
      ema50: 101.1,
      ema200: 102.2,
      adx: 15,
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "cipherContinuationShort:invalid_risk_shape");
  assert.equal(result.meta.validRiskShape, false);
});
