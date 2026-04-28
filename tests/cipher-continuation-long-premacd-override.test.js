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
          basis: 100.0,
          upper: 101.0,
          lower: 99.0,
        };
      },
      calcMACDSeries(values) {
        return values.map((_, index, arr) => {
          if (index === arr.length - 3) {
            return { macd: 0.22, signal: 0.16, hist: 0.06 };
          }
          if (index === arr.length - 2) {
            return { macd: 0.20, signal: 0.16, hist: 0.04 };
          }
          if (index === arr.length - 1) {
            return { macd: 0.18, signal: 0.16, hist: 0.02 };
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
    open: 98.6 + index * 0.025,
    high: 98.95 + index * 0.025,
    low: 98.35 + index * 0.025,
    close: 98.75 + index * 0.025,
    volume: 100,
  }));

  candles[54] = { open: 99.95, high: 100.18, low: 99.96, close: 100.05, volume: 100 };
  candles[55] = { open: 100.02, high: 100.22, low: 99.98, close: 100.08, volume: 100 };
  candles[56] = { open: 100.04, high: 100.18, low: 99.99, close: 100.07, volume: 100 };
  candles[57] = { open: 100.03, high: 100.20, low: 100.00, close: 100.09, volume: 100 };
  candles[58] = { open: 100.01, high: 100.16, low: 99.97, close: 100.06, volume: 100 };
  candles[59] = { open: 100.01, high: 100.22, low: 99.99, close: 100.12, volume: 80 };

  return candles;
}

function makeContext(cipherCfg = {}) {
  return {
    cfg: {
      CIPHER_CONTINUATION_LONG: {
        enabled: true,
        ...cipherCfg,
      },
    },
    helpers: makeHelpers(),
    candles: makeLongCandles(),
    nearestResistance: { price: 102.5 },
    indicators: {
      entry: 100.05,
      atr: 1,
      ema20: 100.0,
      ema50: 99.7,
      ema200: 99.3,
      adx: 12,
      rsi: 50.5,
    },
  };
}

test("cipherContinuationLong keeps blocking pre-MACD setups by default", () => {
  const result = evaluateCipherContinuationLongStrategy(makeContext());

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "cipherContinuationLong:macd_not_reaccelerating");
  assert.equal(result.meta.preMacdStructureOverrideAllowed, false);
});

test("cipherContinuationLong can allow a narrow pre-MACD structure override", () => {
  const result = evaluateCipherContinuationLongStrategy(
    makeContext({
      preMacdStructureOverride: {
        enabled: true,
        minRr: 0.6,
        minAdx: 8,
        minRsi: 49,
        maxExtensionAtr: 0.1,
        maxSignalVolRatio: 0.9,
        requireBullishStack: true,
        requirePullbackTouchesEma20: true,
        requirePullbackNearBbBasis: true,
        requirePullbackStaysAboveEma50: true,
      },
    })
  );

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "selected_premacd_structure");
  assert.equal(result.meta.macdReaccelerating, false);
  assert.equal(result.meta.preMacdStructureOverrideAllowed, true);
  assert.equal(result.meta.preMacdStructureOverrideRsiOk, true);
  assert.equal(result.meta.preMacdStructureOverrideSignalVolRatioOk, true);
  assert.equal(result.meta.preMacdStructureOverrideExtensionOk, true);
});
