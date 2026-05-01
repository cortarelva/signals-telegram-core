const test = require("node:test");
const assert = require("node:assert/strict");

const {
  inferExpectedDirection,
  buildFollowThroughRow,
  buildSummary,
  filterTransitionRows,
} = require("../research/analyze-btc-factor-context");

function makeCandle(close, volume = 100, closeTime = Date.UTC(2026, 3, 27, 12, 0, 0)) {
  return {
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume,
    closeTime,
  };
}

test("inferExpectedDirection maps selloff and rally regimes cleanly", () => {
  assert.equal(
    inferExpectedDirection({ state: "risk_off_selloff", btc: { direction: "down" } }),
    "SHORT"
  );
  assert.equal(
    inferExpectedDirection({ state: "alt_follow_rally", btc: { direction: "up" } }),
    "LONG"
  );
  assert.equal(
    inferExpectedDirection({ state: "mixed", btc: { direction: "down" } }),
    "SHORT"
  );
  assert.equal(
    inferExpectedDirection({ state: "coiled_follow", btc: { direction: "flat" } }),
    null
  );
});

test("buildFollowThroughRow aligns return and excursion for short regimes", () => {
  const row = buildFollowThroughRow({
    symbol: "ADAUSDC",
    candle: makeCandle(100, 100, Date.UTC(2026, 3, 27, 12, 0, 0)),
    futureCandles: [
      { high: 100.4, low: 98.5, close: 99.2 },
      { high: 99.8, low: 97.9, close: 98.0 },
      { high: 99.1, low: 97.5, close: 97.8 },
    ],
    snapshot: {
      state: "risk_off_selloff",
      label: "BTC-led selloff",
      summary: "BTC down | alts follow",
      btc: {
        direction: "down",
        return1hPct: -1.2,
        return4hPct: -2.8,
      },
      alts: {
        followRate: 0.8,
        positiveBreadth: 0.1,
        negativeBreadth: 0.9,
        strongestFollower: { symbol: "LINKUSDC", return1hPct: -2.2 },
      },
    },
    expectedDirection: "SHORT",
    btcFutureReturnPct: -1.8,
  });

  assert.ok(row);
  assert.equal(row.success, true);
  assert.equal(row.expectedDirection, "SHORT");
  assert.equal(row.futureReturnPct, -2.2);
  assert.equal(row.alignedReturnPct, 2.2);
  assert.equal(row.favorableMovePct, 2.5);
  assert.equal(row.adverseMovePct, 0.4);
});

test("buildSummary aggregates rows by regime and symbol", () => {
  const rows = [
    {
      regimeState: "risk_off_selloff",
      symbol: "ADAUSDC",
      success: true,
      futureReturnPct: -1.2,
      alignedReturnPct: 1.2,
      favorableMovePct: 1.6,
      adverseMovePct: 0.3,
      btcFutureReturnPct: -1.5,
    },
    {
      regimeState: "risk_off_selloff",
      symbol: "ADAUSDC",
      success: false,
      futureReturnPct: 0.4,
      alignedReturnPct: -0.4,
      favorableMovePct: 0.5,
      adverseMovePct: 0.8,
      btcFutureReturnPct: -0.2,
    },
    {
      regimeState: "alt_follow_rally",
      symbol: "LINKUSDC",
      success: true,
      futureReturnPct: 0.9,
      alignedReturnPct: 0.9,
      favorableMovePct: 1.1,
      adverseMovePct: 0.2,
      btcFutureReturnPct: 0.7,
    },
  ];

  const summary = buildSummary(rows, {
    symbols: ["ADAUSDC", "LINKUSDC"],
    unavailableSymbols: ["DOGEUSDC"],
    btcSymbol: "BTCUSDC",
  });

  assert.equal(summary.totalRows, 3);
  assert.deepEqual(summary.unavailableSymbols, ["DOGEUSDC"]);
  assert.equal(summary.byState.risk_off_selloff.total, 2);
  assert.equal(summary.byState.risk_off_selloff.successRate, 0.5);
  assert.equal(summary.byState.risk_off_selloff.bySymbol.ADAUSDC.avgAlignedReturnPct, 0.4);
  assert.equal(summary.byState.alt_follow_rally.bySymbol.LINKUSDC.successRate, 1);
});

test("filterTransitionRows keeps only timestamps where regime changes", () => {
  const rows = [
    { signalTs: 1000, regimeState: "mixed", symbol: "ADAUSDC" },
    { signalTs: 1000, regimeState: "mixed", symbol: "LINKUSDC" },
    { signalTs: 2000, regimeState: "mixed", symbol: "ADAUSDC" },
    { signalTs: 2000, regimeState: "mixed", symbol: "LINKUSDC" },
    { signalTs: 3000, regimeState: "risk_off_selloff", symbol: "ADAUSDC" },
    { signalTs: 3000, regimeState: "risk_off_selloff", symbol: "LINKUSDC" },
    { signalTs: 4000, regimeState: "risk_off_selloff", symbol: "ADAUSDC" },
    { signalTs: 5000, regimeState: "alt_follow_rally", symbol: "ADAUSDC" },
  ];

  const filtered = filterTransitionRows(rows);

  assert.deepEqual(
    filtered.map((row) => row.signalTs),
    [1000, 1000, 3000, 3000, 5000]
  );
});
