const test = require("node:test");
const assert = require("node:assert/strict");

const {
  tfToMs,
  buildEventRow,
  buildSummary,
} = require("../research/mine-opportunity-events");

test("tfToMs converts supported timeframe strings to milliseconds", () => {
  assert.equal(tfToMs("5m"), 5 * 60 * 1000);
  assert.equal(tfToMs("1h"), 60 * 60 * 1000);
  assert.equal(tfToMs("1d"), 24 * 60 * 60 * 1000);
  assert.equal(tfToMs("bad"), null);
});

test("buildEventRow returns null when the future move does not meet opportunity thresholds", () => {
  const row = buildEventRow({
    symbol: "LINKUSDC",
    candleIndex: 10,
    candle: {
      close: 100,
      closeTime: Date.UTC(2026, 3, 26, 18, 0, 0),
      volume: 100,
    },
    lookaheadCandles: [
      { high: 101, low: 99.4, close: 100.4 },
      { high: 101.2, low: 99.5, close: 100.3 },
      { high: 101.3, low: 99.6, close: 100.2 },
    ],
    ctx: {
      indicators: {
        atr: 1,
        avgVol: 100,
      },
    },
    direction: "LONG",
  });

  assert.equal(row, null);
});

test("buildEventRow captures a valid long opportunity snapshot with archetype features", () => {
  const row = buildEventRow({
    symbol: "LINKUSDC",
    candleIndex: 42,
    candle: {
      close: 100,
      closeTime: Date.UTC(2026, 3, 26, 18, 5, 0),
      volume: 120,
    },
    lookaheadCandles: [
      { high: 101.2, low: 99.4, close: 100.8 },
      { high: 102.2, low: 99.3, close: 101.1 },
      { high: 102.0, low: 99.5, close: 101.4 },
    ],
    ctx: {
      indicators: {
        atr: 1,
        atrPct: 0.01,
        adx: 28,
        rsi: 58,
        prevRsi: 52,
        ema20: 99.5,
        ema50: 98.8,
        ema200: 96.2,
        bullish: true,
        bullishFast: true,
        nearEma20: true,
        nearEma50: false,
        nearPullback: true,
        stackedEma: true,
        isTrend: true,
        isRange: false,
        emaSeparationPct: 0.006,
        emaSlopePct: 0.002,
        distToEma20: 0.5,
        distToEma50: 1.2,
        avgVol: 100,
      },
      nearestSupport: { price: 98.9 },
      nearestResistance: { price: 103.4 },
    },
    direction: "LONG",
  });

  assert.ok(row);
  assert.equal(row.symbol, "LINKUSDC");
  assert.equal(row.direction, "LONG");
  assert.equal(row.archetype, "trend_continuation_pullback");
  assert.equal(row.relativeVol, 1.2);
  assert.equal(row.moveAtr, 2.2);
  assert.equal(row.maeAtr, 0.7);
  assert.equal(row.closeProgress, 0.636364);
  assert.equal(row.nearPullback, true);
  assert.equal(row.stackedEma, true);
});

test("buildSummary aggregates counts and averages by direction, symbol, and archetype", () => {
  const rows = [
    {
      symbol: "LINKUSDC",
      direction: "LONG",
      archetype: "trend_continuation_pullback",
      moveAtr: 2.2,
      maeAtr: 0.7,
      closeProgress: 0.63,
    },
    {
      symbol: "LINKUSDC",
      direction: "LONG",
      archetype: "trend_continuation_pullback",
      moveAtr: 2.4,
      maeAtr: 0.6,
      closeProgress: 0.71,
    },
    {
      symbol: "XRPUSDC",
      direction: "SHORT",
      archetype: "clean_impulse_expansion",
      moveAtr: 1.9,
      maeAtr: 0.4,
      closeProgress: 0.56,
    },
  ];

  const summary = buildSummary(rows, ["LINKUSDC", "XRPUSDC"], ["DOGEUSDC"]);

  assert.equal(summary.total, 3);
  assert.equal(summary.byDirection.LONG, 2);
  assert.equal(summary.byDirection.SHORT, 1);
  assert.equal(summary.bySymbol.LINKUSDC.total, 2);
  assert.equal(summary.bySymbol.LINKUSDC.avgMoveAtr, 2.3);
  assert.equal(summary.bySymbol.LINKUSDC.byArchetype.trend_continuation_pullback, 2);
  assert.equal(summary.byArchetype.clean_impulse_expansion.total, 1);
  assert.deepEqual(summary.unavailableSymbols, ["DOGEUSDC"]);
});
