const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;

Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "node-binance-api") {
    return function BinanceMock() {
      return {
        options() {
          return {};
        },
      };
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const {
  paperExecute,
  resolveAccountSizeReference,
} = require("../runtime/futures-executor");

Module._load = originalLoad;

test("paperExecute rejects long signals with stop above entry", async () => {
  const result = await paperExecute(
    {
      symbol: "ADAUSDC",
      tf: "5m",
      direction: "LONG",
      side: "BUY",
      entry: 0.2494,
      sl: 0.249425,
      tp: 0.25021,
      strategy: "cipherContinuationLong",
      score: 100,
      signalClass: "EXECUTABLE",
    },
    { executions: [] }
  );

  assert.equal(result.executed, false);
  assert.equal(result.reason, "invalid_stop_geometry");
});

test("paperExecute applies per-strategy risk override to sizing", async () => {
  const result = await paperExecute(
    {
      symbol: "ADAUSDC",
      tf: "15m",
      direction: "SHORT",
      side: "SELL",
      entry: 100,
      sl: 101,
      tp: 98,
      strategy: "breakdownContinuationBaseShort",
      score: 88,
      signalClass: "EXECUTABLE",
      executionBucket: "exploratory",
      executionRiskPerTrade: 0.0025,
      executionMaxPositionUsd: 25,
    },
    { executions: [] },
    {
      minScore: 70,
      allowedClasses: ["EXECUTABLE"],
      maxOpenTradesTotal: 5,
      maxOpenTradesPerSymbol: 1,
      allowedSymbols: ["ADAUSDC"],
      accountSize: 1000,
      riskPerTrade: 0.0025,
      maxPositionUsd: 25,
    }
  );

  assert.equal(result.executed, true);
  assert.equal(result.order.executionBucket, "exploratory");
  assert.equal(result.order.riskPerTrade, 0.0025);
  assert.equal(result.order.positionNotional, 25);
  assert.equal(result.order.riskUsd, 0.25);
});

test("resolveAccountSizeReference prefers available balance in auto mode", () => {
  const auto = resolveAccountSizeReference({
    configuredAccountSize: 1000,
    availableBalance: 87.25,
    mode: "auto",
  });
  const fallback = resolveAccountSizeReference({
    configuredAccountSize: 1000,
    availableBalance: null,
    mode: "auto",
  });
  const forcedStatic = resolveAccountSizeReference({
    configuredAccountSize: 1000,
    availableBalance: 87.25,
    mode: "static",
  });

  assert.equal(auto.accountSize, 87.25);
  assert.equal(auto.source, "available_balance");
  assert.equal(fallback.accountSize, 1000);
  assert.equal(fallback.source, "static_fallback");
  assert.equal(forcedStatic.accountSize, 1000);
  assert.equal(forcedStatic.source, "static");
});
