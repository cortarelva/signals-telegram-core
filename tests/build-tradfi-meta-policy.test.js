const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDecision,
  buildPolicy,
} = require("../research/build-tradfi-meta-policy");

test("buildDecision promotes strong symbol models to core", () => {
  const decision = buildDecision({
    symbol: "AAPLUSDT",
    rows: 107,
    metricsTest: { f1: 0.625 },
    metricsValidation: { f1: 0.64 },
  });

  assert.equal(decision.status, "core");
});

test("buildDecision keeps middling symbol models in observe", () => {
  const decision = buildDecision({
    symbol: "QQQUSDT",
    rows: 83,
    metricsTest: { f1: 0.4286 },
    metricsValidation: { f1: 0.4706 },
  });

  assert.equal(decision.status, "observe");
});

test("buildPolicy emits aggregate fallback plus symbol-specific statuses", () => {
  const policy = buildPolicy({
    profileLabel: "equities_reversal_1h_1d_core",
    strategy: "oversoldBounce",
    results: [
      {
        symbol: "ALL",
        rows: 283,
        metricsValidation: { f1: 0.4082 },
        metricsTest: { f1: 0.3913 },
        modelFile: "/tmp/all.json",
      },
      {
        symbol: "AAPLUSDT",
        rows: 107,
        metricsValidation: { f1: 0.64 },
        metricsTest: { f1: 0.625 },
        modelFile: "/tmp/aapl.json",
      },
      {
        symbol: "QQQUSDT",
        rows: 83,
        metricsValidation: { f1: 0.4706 },
        metricsTest: { f1: 0.4286 },
        modelFile: "/tmp/qqq.json",
      },
      {
        symbol: "SPYUSDT",
        rows: 93,
        metricsValidation: { f1: 0.3529 },
        metricsTest: { f1: 0.6364 },
        modelFile: "/tmp/spy.json",
      },
    ],
  });

  assert.equal(policy.aggregateModel.modelFile, "/tmp/all.json");
  assert.equal(policy.symbols.AAPLUSDT.status, "core");
  assert.equal(policy.symbols.QQQUSDT.status, "observe");
  assert.equal(policy.symbols.SPYUSDT.status, "core");
  assert.equal(policy.symbols.SPYUSDT.fallbackModelFile, "/tmp/all.json");
});
