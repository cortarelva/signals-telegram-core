const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseSymbolsOverride,
  parseStrategiesOverride,
  buildOutputPaths,
  summarizeTrades,
  buildFibPullbackContext,
  passesFibGate,
} = require("../research/compare-fibonacci-filter");

test("parse helpers normalize symbol and strategy overrides", () => {
  assert.deepEqual(parseSymbolsOverride("btcusdc, ETHUSDC, btcusdc"), [
    "BTCUSDC",
    "ETHUSDC",
  ]);
  assert.deepEqual(parseStrategiesOverride("cipherContinuationShort, breakdownRetestShort"), [
    "cipherContinuationShort",
    "breakdownRetestShort",
  ]);
});

test("buildOutputPaths derives stable filenames for the fib comparison", () => {
  const paths = buildOutputPaths(["BTCUSDC", "ETHUSDC"], [
    "breakdownRetestShort",
    "cipherContinuationShort",
  ]);
  assert.match(paths.outputJson, /fibonacci-filter-comparison-btcusdc-ethusdc-breakdownretestshort-ciphercontinuationshort-1h\.json$/);
  assert.match(paths.outputMd, /fibonacci-filter-comparison-btcusdc-ethusdc-breakdownretestshort-ciphercontinuationshort-1h\.md$/);
});

function makeCandle({ high, low, close }, index) {
  return {
    openTime: index * 60_000,
    closeTime: (index + 1) * 60_000 - 1,
    open: close,
    high,
    low,
    close,
    volume: 1000,
  };
}

test("buildFibPullbackContext finds a valid short retracement zone", () => {
  const candles = [
    { high: 100, low: 99, close: 99.5 },
    { high: 105, low: 103, close: 104 },
    { high: 103, low: 101, close: 102 },
    { high: 100, low: 95, close: 96 },
    { high: 98, low: 90, close: 91 },
    { high: 97, low: 94, close: 96 },
    { high: 98, low: 96, close: 97.5 },
  ].map(makeCandle);

  const fib = buildFibPullbackContext({
    candles,
    candleIndex: 6,
    direction: "SHORT",
    pivotLookback: 1,
    maxImpulseAgeBars: 6,
  });

  assert.equal(fib.valid, true);
  assert.equal(fib.direction, "SHORT");
  assert.equal(Number(fib.retracementFrac.toFixed(3)), 0.533);
  assert.equal(fib.impulseStart, 105);
  assert.equal(fib.impulseEnd, 90);
  assert.equal(fib.pullbackExtreme, 98);
});

test("passesFibGate blocks shallow and accepts in-zone pullbacks", () => {
  const candles = [
    { high: 100, low: 99, close: 99.5 },
    { high: 105, low: 103, close: 104 },
    { high: 103, low: 101, close: 102 },
    { high: 100, low: 95, close: 96 },
    { high: 98, low: 90, close: 91 },
    { high: 97, low: 94, close: 96 },
    { high: 98, low: 96, close: 97.5 },
  ].map(makeCandle);

  const allowed = passesFibGate({
    candles,
    candleIndex: 6,
    direction: "SHORT",
    variant: {
      gated: true,
      pivotLookback: 1,
      minRetrace: 0.382,
      maxRetrace: 0.618,
      maxImpulseAgeBars: 6,
    },
  });

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, "fib_gate:passed");

  const shallowCandles = [
    { high: 100, low: 99, close: 99.5 },
    { high: 105, low: 103, close: 104 },
    { high: 103, low: 101, close: 102 },
    { high: 100, low: 95, close: 96 },
    { high: 98, low: 90, close: 91 },
    { high: 95, low: 92, close: 93 },
    { high: 95, low: 92, close: 94 },
  ].map(makeCandle);

  const blocked = passesFibGate({
    candles: shallowCandles,
    candleIndex: 6,
    direction: "SHORT",
    variant: {
      gated: true,
      pivotLookback: 1,
      minRetrace: 0.382,
      maxRetrace: 0.618,
      maxImpulseAgeBars: 6,
    },
  });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "fib_gate:retracement_too_shallow");
});

test("summarizeTrades reports net stats and drawdown", () => {
  const summary = summarizeTrades([
    { netPnlPct: 0.6 },
    { netPnlPct: -0.2 },
    { netPnlPct: 0.1 },
  ]);

  assert.equal(summary.trades, 3);
  assert.equal(summary.winrate, 66.6667);
  assert.equal(summary.avgNetPnlPct, 0.166667);
  assert.equal(summary.profitFactorNet, 3.5);
  assert.equal(summary.maxDrawdownPct, 0.2);
});
