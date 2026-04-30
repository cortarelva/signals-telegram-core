const test = require("node:test");
const assert = require("node:assert/strict");

const {
  favorableProgress,
  touchedTp,
  computeBreakEvenTriggerPrice,
  computeBreakEvenLockPrice,
  summarizeLaneTrades,
} = require("../research/live-management-audit");

test("favorableProgress computes long path correctly", () => {
  const trade = {
    direction: "LONG",
    entryPrice: 100,
    tp: 110,
    maxHighDuringTrade: 108,
  };
  assert.equal(favorableProgress(trade), 0.8);
});

test("favorableProgress computes short path correctly", () => {
  const trade = {
    direction: "SHORT",
    entryPrice: 100,
    tp: 90,
    minLowDuringTrade: 94,
  };
  assert.equal(favorableProgress(trade), 0.6);
});

test("touchedTp detects long wick-through", () => {
  const trade = {
    direction: "LONG",
    entryPrice: 100,
    tp: 110,
    maxHighDuringTrade: 110.01,
  };
  assert.equal(touchedTp(trade), true);
});

test("touchedTp detects short wick-through", () => {
  const trade = {
    direction: "SHORT",
    entryPrice: 100,
    tp: 90,
    minLowDuringTrade: 89.9,
  };
  assert.equal(touchedTp(trade), true);
});

test("break-even prices use initial risk for short trades", () => {
  const trade = {
    direction: "SHORT",
    entryPrice: 100,
    initialSl: 110,
    managementBreakEvenTriggerR: 0.3,
    managementBreakEvenLockR: 0.1,
  };
  assert.equal(computeBreakEvenTriggerPrice(trade), 97);
  assert.equal(computeBreakEvenLockPrice(trade), 99);
});

test("summarizeLaneTrades counts near TP and wick-through non-TP correctly", () => {
  const trades = [
    {
      symbol: "ADAUSDC",
      tf: "5m",
      strategy: "cipherContinuationLong",
      direction: "LONG",
      outcome: "TP",
      pnlPct: 0.3,
      entryPrice: 100,
      tp: 101,
      sl: 99,
      exitRef: 101,
      maxHighDuringTrade: 101.2,
      minLowDuringTrade: 99.8,
      barsOpen: 3,
    },
    {
      symbol: "ADAUSDC",
      tf: "5m",
      strategy: "cipherContinuationLong",
      direction: "LONG",
      outcome: "SL",
      pnlPct: 0.05,
      entryPrice: 100,
      tp: 101,
      sl: 99,
      exitRef: 100.1,
      maxHighDuringTrade: 101.05,
      minLowDuringTrade: 99.9,
      barsOpen: 4,
      breakEvenApplied: true,
    },
    {
      symbol: "ADAUSDC",
      tf: "5m",
      strategy: "cipherContinuationLong",
      direction: "LONG",
      outcome: "SL",
      pnlPct: -0.2,
      entryPrice: 100,
      tp: 101,
      sl: 99,
      exitRef: 99,
      maxHighDuringTrade: 100.85,
      minLowDuringTrade: 98.9,
      barsOpen: 5,
      breakEvenApplied: false,
    },
  ];

  const summary = summarizeLaneTrades(trades);
  assert.equal(summary.trades, 3);
  assert.equal(summary.tpCount, 1);
  assert.equal(summary.nonTpCount, 2);
  assert.equal(summary.near80Count, 2);
  assert.equal(summary.near90Count, 1);
  assert.equal(summary.touchedTpButNonTpCount, 1);
  assert.equal(summary.breakEvenAppliedCount, 1);
});
