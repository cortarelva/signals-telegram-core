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

const { paperExecute } = require("../runtime/futures-executor");

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
