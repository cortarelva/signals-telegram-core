const test = require("node:test");
const assert = require("node:assert/strict");

const {
  prepareStrategyRows,
  buildFeatureColumns,
  buildColumnKinds,
  buildTrainingRowKey,
  findTemporalSplit,
  sanitizeFileName,
} = require("../research/train-strategy-meta-models");

test("sanitizeFileName normalizes strategy names for artifact files", () => {
  assert.equal(sanitizeFileName("cipherContinuationShort"), "cipher-continuation-short");
  assert.equal(sanitizeFileName("breakdownRetestShort v2"), "breakdown-retest-short-v2");
});

test("prepareStrategyRows filters strategy rows, derives targets, and sorts by time", () => {
  const rows = [
    {
      strategy: "trend",
      signalTs: 2_000,
      labelRealizedPnlPct: 0.01,
    },
    {
      strategy: "cipherContinuationLong",
      signalTs: 3_000,
      labelRealizedPnlPct: 0.05,
    },
    {
      strategy: "cipherContinuationLong",
      signalCandleCloseTime: 1_500,
      signalTs: 1_600,
      labelRealizedPnlPct: -0.02,
    },
    {
      strategy: "cipherContinuationLong",
      signalTs: "bad",
      labelRealizedPnlPct: 0.12,
    },
  ];

  const prepared = prepareStrategyRows(rows, "cipherContinuationLong");

  assert.equal(prepared.length, 2);
  assert.deepEqual(
    prepared.map((row) => ({
      timeValue: row.timeValue,
      target: row.target,
    })),
    [
      { timeValue: 1_500, target: 0 },
      { timeValue: 3_000, target: 1 },
    ]
  );
});

test("buildTrainingRowKey deduplicates equivalent setups across datasets", () => {
  const a = buildTrainingRowKey({
    symbol: "ETHUSDC",
    tf: "5m",
    strategy: "cipherContinuationLong",
    direction: "LONG",
    signalCandleCloseTime: 1_000,
    entry: 100,
    sl: 99,
    tp: 102,
  });
  const b = buildTrainingRowKey({
    symbol: "ETHUSDC",
    tf: "5m",
    strategy: "cipherContinuationLong",
    direction: "LONG",
    signalTs: 1_000,
    entry: 100,
    sl: 99,
    tp: 102,
  });

  assert.equal(a, b);
});

test("buildFeatureColumns and buildColumnKinds keep varying columns and detect booleans", () => {
  const rows = [
    {
      symbol: "ETHUSDC",
      tf: "5m",
      direction: "LONG",
      signalClass: "EXECUTABLE",
      score: 80,
      srPassed: true,
      rrPlanned: 2.1,
      candidateMeta_bullishBias: true,
      candidateMeta_regimeLabel: "trend",
      candidateMeta_constantThing: "same",
    },
    {
      symbol: "ADAUSDC",
      tf: "1h",
      direction: "SHORT",
      signalClass: "WATCH",
      score: 65,
      srPassed: false,
      rrPlanned: 1.4,
      candidateMeta_bullishBias: false,
      candidateMeta_regimeLabel: "range",
      candidateMeta_constantThing: "same",
    },
  ];

  const featureColumns = buildFeatureColumns(rows);
  const kinds = buildColumnKinds(rows, featureColumns);

  assert.equal(featureColumns.includes("candidateMeta_bullishBias"), true);
  assert.equal(featureColumns.includes("candidateMeta_regimeLabel"), true);
  assert.equal(featureColumns.includes("candidateMeta_constantThing"), false);
  assert.equal(kinds.categoricalColumns.includes("symbol"), true);
  assert.equal(kinds.categoricalColumns.includes("tf"), true);
  assert.equal(kinds.categoricalColumns.includes("candidateMeta_regimeLabel"), true);
  assert.equal(kinds.boolColumns.includes("srPassed"), true);
  assert.equal(kinds.boolColumns.includes("candidateMeta_bullishBias"), true);
});

test("findTemporalSplit falls back to an adaptive contiguous split with class coverage", () => {
  const rows = Array.from({ length: 27 }, (_, index) => ({
    timeValue: index,
    target: [1, 5, 12, 14, 21].includes(index) ? 1 : 0,
  }));

  const split = findTemporalSplit(rows);

  assert.equal(split.mode, "adaptive");
  assert.equal(split.train.length >= 10, true);
  assert.equal(split.valid.length >= 5, true);
  assert.equal(split.test.length >= 5, true);
  assert.equal(split.train.some((row) => row.target === 1), true);
  assert.equal(split.valid.some((row) => row.target === 1), true);
  assert.equal(split.test.some((row) => row.target === 1), true);
});
