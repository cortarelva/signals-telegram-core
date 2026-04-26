const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractCandidateRows,
  labelCandidateWithCandles,
  tfToMs,
} = require("../research/build-candidate-labeled-dataset");

test("tfToMs converts supported timeframes", () => {
  assert.equal(tfToMs("5m"), 5 * 60 * 1000);
  assert.equal(tfToMs("1h"), 60 * 60 * 1000);
  assert.equal(tfToMs("1d"), 24 * 60 * 60 * 1000);
  assert.equal(tfToMs("bad"), null);
});

test("extractCandidateRows flattens candidates with trade geometry and deduplicates them", () => {
  const signalLog = [
    {
      ts: 1_000,
      signalCandleCloseTime: 900,
      symbol: "ETHUSDC",
      tf: "5m",
      selectedStrategy: "cipherContinuationLong",
      selectedDirection: "LONG",
      decisionReason: "selected",
      executionApproved: true,
      strategyCandidates: [
        {
          strategy: "cipherContinuationLong",
          direction: "LONG",
          allowed: true,
          score: 88,
          signalClass: "EXECUTABLE",
          minScore: 64,
          entry: 100,
          sl: 99,
          tp: 102,
          rawTp: 102.5,
          reason: "selected",
          meta: {
            plannedRr: 2,
            bullishBias: true,
          },
        },
      ],
    },
    {
      ts: 1_010,
      signalCandleCloseTime: 900,
      symbol: "ETHUSDC",
      tf: "5m",
      selectedStrategy: "cipherContinuationLong",
      selectedDirection: "LONG",
      strategyCandidates: [
        {
          strategy: "cipherContinuationLong",
          direction: "LONG",
          allowed: true,
          score: 88,
          signalClass: "EXECUTABLE",
          minScore: 64,
          entry: 100,
          sl: 99,
          tp: 102,
          rawTp: 102.5,
          reason: "selected",
          meta: {
            plannedRr: 2,
            bullishBias: true,
          },
        },
      ],
    },
  ];

  const rows = extractCandidateRows(signalLog);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "ETHUSDC");
  assert.equal(rows[0].strategy, "cipherContinuationLong");
  assert.equal(rows[0].signalCandleCloseTime, 900);
  assert.equal(rows[0].selectedCandidate, true);
  assert.equal(rows[0].entry, 100);
  assert.equal(rows[0].sl, 99);
  assert.equal(rows[0].tp, 102);
  assert.equal(rows[0].candidateMeta_plannedRr, 2);
  assert.equal(rows[0].candidateMeta_bullishBias, true);
});

test("extractCandidateRows also includes historical closed signals from state objects", () => {
  const rows = extractCandidateRows({
    signalLog: [],
    closedSignals: [
      {
        symbol: "BNBUSDC",
        tf: "1h",
        strategy: "cipherContinuationShort",
        direction: "SHORT",
        signalTs: 2_000,
        signalCandleCloseTime: 1_800,
        executionOrderId: "exec-1",
        entry: 600,
        sl: 610,
        tp: 590,
        score: 95,
        signalClass: "EXECUTABLE",
        rsi: 40,
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceType, "closedSignal");
  assert.equal(rows[0].executionOrderId, "exec-1");
  assert.equal(rows[0].strategy, "cipherContinuationShort");
  assert.equal(rows[0].entry, 600);
});

test("labelCandidateWithCandles marks TP before SL for long candidates", () => {
  const candidate = {
    symbol: "ETHUSDC",
    tf: "5m",
    direction: "LONG",
    signalCandleCloseTime: 1_000,
    entry: 100,
    sl: 99,
    tp: 102,
  };
  const candles = [
    { closeTime: 1_000, high: 100.5, low: 99.8, close: 100.2 },
    { closeTime: 2_000, high: 102.1, low: 100.1, close: 101.9 },
    { closeTime: 3_000, high: 102.3, low: 101.5, close: 102.0 },
  ];

  const label = labelCandidateWithCandles(candidate, candles, { horizonBars: 3 });

  assert.equal(label.labelOutcome, "TP");
  assert.equal(label.labelBucket, "win");
  assert.equal(label.barsToOutcome, 1);
  assert.equal(label.labelTpHit, 1);
});

test("labelCandidateWithCandles marks SL for short candidates", () => {
  const candidate = {
    symbol: "ETHUSDC",
    tf: "5m",
    direction: "SHORT",
    signalCandleCloseTime: 1_000,
    entry: 100,
    sl: 101,
    tp: 98,
  };
  const candles = [
    { closeTime: 1_000, high: 100.1, low: 99.8, close: 100.0 },
    { closeTime: 2_000, high: 101.2, low: 99.7, close: 101.1 },
  ];

  const label = labelCandidateWithCandles(candidate, candles, { horizonBars: 2 });

  assert.equal(label.labelOutcome, "SL");
  assert.equal(label.labelBucket, "loss");
  assert.equal(label.labelSlHit, 1);
  assert.equal(label.barsToOutcome, 1);
});

test("labelCandidateWithCandles marks TIMEOUT when neither target nor stop is hit", () => {
  const candidate = {
    symbol: "ADAUSDC",
    tf: "5m",
    direction: "LONG",
    signalCandleCloseTime: 1_000,
    entry: 1,
    sl: 0.9,
    tp: 1.2,
  };
  const candles = [
    { closeTime: 1_000, high: 1.01, low: 0.99, close: 1.0 },
    { closeTime: 2_000, high: 1.05, low: 0.98, close: 1.02 },
    { closeTime: 3_000, high: 1.04, low: 0.97, close: 1.01 },
  ];

  const label = labelCandidateWithCandles(candidate, candles, { horizonBars: 2 });

  assert.equal(label.labelOutcome, "TIMEOUT");
  assert.equal(label.labelBucket, "timeout");
  assert.equal(label.labelTimeout, 1);
  assert.equal(label.barsToOutcome, 2);
});
