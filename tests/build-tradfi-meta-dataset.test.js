const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractBacktestTradeRows,
  buildTradfiDatasetRow,
  summarizeTradfiDataset,
} = require("../research/build-tradfi-meta-dataset");

test("buildTradfiDatasetRow maps a backtest trade into trainer-friendly fields", () => {
  const row = buildTradfiDatasetRow(
    {
      signalCandleCloseTime: 1_700_000_000_000,
      signalCandleCloseIso: "2023-11-14T22:13:20.000Z",
      entry: 100,
      sl: 98,
      tp: 103,
      score: 87,
      signalClass: "EXECUTABLE",
      riskAbs: 2,
      rewardAbs: 3,
      rrPlanned: 1.5,
      rsi: 34,
      atr: 2,
      adx: 12,
      srPassed: true,
      candidateMeta_tpMode: "atr_raw",
      outcome: "TP",
      barsHeld: 4,
      closeTime: 1_700_000_360_000,
      exitPrice: 103,
      pnlPct: 3,
    },
    {
      symbol: "SPYUSDT",
      tf: "1h",
      htfTf: "1d",
      strategy: "oversoldBounce",
      direction: "LONG",
    }
  );

  assert.equal(row.symbol, "SPYUSDT");
  assert.equal(row.strategy, "oversoldBounce");
  assert.equal(row.labelOutcome, "TP");
  assert.equal(row.labelRealizedPnlPct, 3);
  assert.equal(row.labelTpHit, true);
  assert.equal(row.labelSlHit, false);
  assert.equal(row.candidateMeta_tpMode, "atr_raw");
});

test("extractBacktestTradeRows pulls all matching trades from full backtest output", () => {
  const rows = extractBacktestTradeRows(
    {
      tf: "1h",
      htfTf: "1d",
      ranked: [
        {
          strategy: "oversoldBounce",
          direction: "LONG",
          bySymbol: {
            AAPLUSDT: {
              trades: [
                { signalCandleCloseTime: 2_000, entry: 10, sl: 9, tp: 11, outcome: "TP", closeTime: 3_000, pnlPct: 10 },
              ],
            },
            QQQUSDT: {
              trades: [
                { signalCandleCloseTime: 1_000, entry: 20, sl: 19, tp: 22, outcome: "SL", closeTime: 2_000, pnlPct: -5 },
              ],
            },
          },
        },
        {
          strategy: "breakdownRetestShort",
          direction: "SHORT",
          bySymbol: {
            QQQUSDT: {
              trades: [{ signalCandleCloseTime: 4_000, entry: 100, sl: 101, tp: 98, outcome: "TP", closeTime: 5_000, pnlPct: 2 }],
            },
          },
        },
      ],
    },
    "oversoldBounce"
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.symbol), ["QQQUSDT", "AAPLUSDT"]);
  assert.equal(rows.every((row) => row.strategy === "oversoldBounce"), true);
});

test("extractBacktestTradeRows can filter to requested symbols", () => {
  const rows = extractBacktestTradeRows(
    {
      tf: "1h",
      htfTf: "1d",
      ranked: [
        {
          strategy: "oversoldBounce",
          direction: "LONG",
          bySymbol: {
            AAPLUSDT: {
              trades: [{ signalCandleCloseTime: 2_000, entry: 10, sl: 9, tp: 11, outcome: "TP", closeTime: 3_000, pnlPct: 10 }],
            },
            SPYUSDT: {
              trades: [{ signalCandleCloseTime: 1_000, entry: 20, sl: 19, tp: 22, outcome: "SL", closeTime: 2_000, pnlPct: -5 }],
            },
          },
        },
      ],
    },
    "oversoldBounce",
    ["SPYUSDT"]
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "SPYUSDT");
});

test("summarizeTradfiDataset aggregates outcomes and symbol stats", () => {
  const summary = summarizeTradfiDataset(
    [
      { symbol: "AAPLUSDT", labelOutcome: "TP", labelRealizedPnlPct: 1 },
      { symbol: "AAPLUSDT", labelOutcome: "SL", labelRealizedPnlPct: -0.5 },
      { symbol: "SPYUSDT", labelOutcome: "TP", labelRealizedPnlPct: 0.8 },
    ],
    {
      sourceFile: "/tmp/source.json",
      strategy: "oversoldBounce",
      tf: "1h",
      htfTf: "1d",
    }
  );

  assert.equal(summary.totalRows, 3);
  assert.deepEqual(summary.outcomes, { TP: 2, SL: 1 });
  assert.equal(summary.bySymbol.AAPLUSDT.rows, 2);
  assert.equal(summary.bySymbol.AAPLUSDT.avgPnlPct, 0.25);
  assert.equal(summary.bySymbol.SPYUSDT.tp, 1);
});
