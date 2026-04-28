const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  parseFileList,
  buildCandidateRows,
  summarizeCandidates,
} = require("../research/build-promotion-gate-report");

test("parseFileList resolves csv paths and removes duplicates", () => {
  const rows = parseFileList("research/a.json, /tmp/b.json, research/a.json");

  assert.equal(rows.length, 2);
  assert.equal(rows[1], "/tmp/b.json");
  assert.match(rows[0], /research\/a\.json$/);
});

test("buildCandidateRows extracts promotion and lower-bound fields", () => {
  const source = path.join(process.cwd(), "research/example.json");
  const rows = buildCandidateRows(source, {
    tf: "15m",
    htfTf: "1d",
    symbols: ["ADAUSDC", "BTCUSDC"],
    ranked: [
      {
        strategy: "breakdownContinuationBaseShort",
        direction: "SHORT",
        monteCarlo: {
          original: {
            trades: 21,
            avgNetPnlPct: 0.07,
            profitFactorNet: 1.2,
            maxDrawdownPct: 2.5,
          },
          lowerBoundGate: {
            lowerBoundAvgNetPnlPct: -0.23,
            lowerBoundProfitFactorNet: 0.56,
            stressedMaxDrawdownPct: 4.9,
          },
          recommendation: "exploratory",
          promotionDecision: {
            status: "exploratory",
            reason: "point_estimate_positive_but_lower_bound_weak",
          },
        },
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].promotionStatus, "exploratory");
  assert.equal(rows[0].lowerBoundProfitFactorNet, 0.56);
  assert.equal(rows[0].source, source);
});

test("summarizeCandidates groups and sorts statuses", () => {
  const summary = summarizeCandidates([
    { strategy: "a", promotionStatus: "reject", avgNetPnlPct: -0.1, profitFactorNet: 0.8, trades: 10 },
    { strategy: "b", promotionStatus: "core", avgNetPnlPct: 0.2, profitFactorNet: 1.5, trades: 12 },
    { strategy: "c", promotionStatus: "exploratory", avgNetPnlPct: 0.1, profitFactorNet: 1.1, trades: 20 },
    { strategy: "d", promotionStatus: "exploratory", avgNetPnlPct: 0.15, profitFactorNet: 1.05, trades: 8 },
  ]);

  assert.equal(summary.core.length, 1);
  assert.equal(summary.exploratory.length, 2);
  assert.equal(summary.reject.length, 1);
  assert.equal(summary.exploratory[0].strategy, "d");
});
