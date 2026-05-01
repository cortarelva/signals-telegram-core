const test = require("node:test");
const assert = require("node:assert/strict");

const {
  advanceHtfCursor,
  selectReplayCandidates,
  buildReplaySummary,
} = require("../research/build-historical-replay-dataset");

test("advanceHtfCursor returns exclusive index aligned to closed HTF candles", () => {
  const htfCandles = [
    { closeTime: 1000 },
    { closeTime: 2000 },
    { closeTime: 3000 },
  ];

  assert.equal(advanceHtfCursor(htfCandles, 1500, 0), 1);
  assert.equal(advanceHtfCursor(htfCandles, 2500, 1), 2);
  assert.equal(advanceHtfCursor(htfCandles, 3500, 2), 3);
});

test("selectReplayCandidates can keep all allowed rows or only the selected one", () => {
  const decision = {
    selected: { strategy: "trend", allowed: true, entry: 100, sl: 99, tp: 102 },
    all: [
      { strategy: "trend", allowed: true, entry: 100, sl: 99, tp: 102 },
      { strategy: "bullTrap", allowed: false, entry: 100, sl: 101, tp: 98 },
      { strategy: "trendShort", allowed: true, entry: 100, sl: 101, tp: 98 },
    ],
  };

  assert.deepEqual(
    selectReplayCandidates(decision, {
      includeAllAllowed: true,
      includeBlockedGeometry: false,
    }).map((row) => row.strategy),
    ["trend", "trendShort"]
  );
  assert.deepEqual(
    selectReplayCandidates(decision, {
      includeAllAllowed: false,
      includeBlockedGeometry: false,
    }).map((row) => row.strategy),
    ["trend"]
  );
  assert.deepEqual(
    selectReplayCandidates(decision, {
      includeAllAllowed: true,
      includeBlockedGeometry: true,
    }).map((row) => row.strategy),
    ["trend", "bullTrap", "trendShort"]
  );
});

test("buildReplaySummary aggregates outcomes and symbol-level stats", () => {
  const rows = [
    {
      symbol: "ETHUSDC",
      strategy: "trend",
      labelOutcome: "TP",
      labelRealizedPnlPct: 0.5,
    },
    {
      symbol: "ETHUSDC",
      strategy: "trendShort",
      labelOutcome: "SL",
      labelRealizedPnlPct: -0.2,
    },
    {
      symbol: "ADAUSDC",
      strategy: "trend",
      labelOutcome: "TIMEOUT",
      labelRealizedPnlPct: 0.0,
    },
  ];

  const summary = buildReplaySummary(rows, ["ETHUSDC", "ADAUSDC"], []);

  assert.equal(summary.totalRows, 3);
  assert.equal(summary.outcomes.TP, 1);
  assert.equal(summary.bySymbol.ETHUSDC.total, 2);
  assert.equal(summary.bySymbol.ETHUSDC.strategies.trend, 1);
  assert.equal(summary.bySymbol.ETHUSDC.strategies.trendShort, 1);
  assert.equal(summary.bySymbol.ADAUSDC.outcomes.TIMEOUT, 1);
});
