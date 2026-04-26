const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canExecute,
  deriveProjectedSignalNotionalUsd,
  deriveProjectedSignalRiskUsd,
} = require("../runtime/risk-manager");

test("deriveProjectedSignalSizing respects max position cap", () => {
  const signal = {
    symbol: "ETHUSDC",
    entry: 100,
    sl: 99,
  };

  const projectedNotional = deriveProjectedSignalNotionalUsd(signal, {
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
  });
  const projectedRisk = deriveProjectedSignalRiskUsd(signal, {
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
  });

  assert.equal(projectedNotional, 40);
  assert.equal(projectedRisk, 0.4);
});

test("canExecute blocks duplicate positions", () => {
  const signal = {
    symbol: "ETHUSDC",
    tf: "15m",
    side: "BUY",
    direction: "LONG",
    signalClass: "EXECUTABLE",
    score: 80,
    entry: 100,
    sl: 99,
  };
  const state = {
    executions: [
      {
        status: "OPEN",
        symbol: "ETHUSDC",
        tf: "15m",
        side: "BUY",
        direction: "LONG",
        positionNotional: 40,
      },
    ],
  };

  const result = canExecute(signal, state, {
    minScore: 70,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: 4,
    maxOpenTradesPerSymbol: 2,
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "duplicate_open_trade");
});

test("canExecute enforces same-side notional limits without blocking opposite side", () => {
  const state = {
    executions: [
      {
        status: "OPEN",
        symbol: "BNBUSDC",
        tf: "15m",
        side: "SELL",
        direction: "SHORT",
        positionNotional: 40,
      },
    ],
  };

  const shortSignal = {
    symbol: "ETHUSDC",
    tf: "15m",
    side: "SELL",
    direction: "SHORT",
    signalClass: "EXECUTABLE",
    score: 82,
    entry: 100,
    sl: 101,
  };
  const longSignal = {
    ...shortSignal,
    side: "BUY",
    direction: "LONG",
    sl: 99,
  };

  const shortResult = canExecute(shortSignal, state, {
    minScore: 70,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: 4,
    maxOpenTradesPerSymbol: 2,
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
    maxSideNotionalUsd: 60,
  });
  const longResult = canExecute(longSignal, state, {
    minScore: 70,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: 4,
    maxOpenTradesPerSymbol: 2,
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
    maxSideNotionalUsd: 60,
  });

  assert.equal(shortResult.ok, false);
  assert.equal(shortResult.reason, "side_notional_limit_reached");
  assert.equal(longResult.ok, true);
});
