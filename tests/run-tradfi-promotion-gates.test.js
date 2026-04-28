const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  OUTPUT_DIR,
  SUMMARY_FILE,
  getProfileMonteOutputPath,
  buildMonteProfileEnv,
  buildSummaryReport,
} = require("../research/run-tradfi-promotion-gates");

test("getProfileMonteOutputPath stores tradfi monte artifacts in the promotion-gates cache", () => {
  const output = getProfileMonteOutputPath({ label: "equities_reversal_1h_1d_core" });
  assert.match(output, /tradfi-twelve-equities-promotion-gates\/equities_reversal_1h_1d_core\.monte-carlo\.json$/);
  assert.equal(path.dirname(output), OUTPUT_DIR);
});

test("buildMonteProfileEnv wires a self-contained tradfi monte environment", () => {
  const env = buildMonteProfileEnv(
    {
      label: "qqq_breakdown_short_30m_1d_core",
      tf: "30m",
      htfTf: "1d",
      ltfLimit: 2500,
      htfLimit: 400,
      symbols: ["QQQUSDT"],
      strategies: ["breakdownRetestShort"],
      configOverrides: {
        DEFAULTS: {
          BREAKDOWN_RETEST_SHORT: { enabled: true },
        },
      },
    },
    "/tmp/tradfi-monte.json",
    { PATH: process.env.PATH }
  );

  assert.equal(env.EXTERNAL_HISTORY_PROVIDER, "twelvedata");
  assert.equal(env.MONTE_SYMBOLS, "QQQUSDT");
  assert.equal(env.MONTE_STRATEGIES, "breakdownRetestShort");
  assert.equal(env.MONTE_TF, "30m");
  assert.equal(env.MONTE_HTF_TF, "1d");
  assert.equal(env.MONTE_LTF_LIMIT, "2500");
  assert.equal(env.MONTE_HTF_LIMIT, "400");
  assert.equal(env.MONTE_OUTPUT_FILE, "/tmp/tradfi-monte.json");
  assert.match(env.MONTE_CONFIG_OVERRIDES, /BREAKDOWN_RETEST_SHORT/);
});

test("buildSummaryReport aggregates tradfi monte artifacts into promotion buckets", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tradfi-promo-"));
  const fileA = path.join(tempDir, "equities_reversal_1h_1d_core.monte-carlo.json");
  const fileB = path.join(tempDir, "qqq_breakdown_short_30m_1d_core.monte-carlo.json");

  fs.writeFileSync(
    fileA,
    JSON.stringify({
      tf: "1h",
      htfTf: "1d",
      symbols: ["AAPLUSDT", "QQQUSDT", "SPYUSDT"],
      ranked: [
        {
          strategy: "oversoldBounce",
          direction: "LONG",
          monteCarlo: {
            original: { trades: 20, avgNetPnlPct: 0.11, profitFactorNet: 1.3, maxDrawdownPct: 4.1 },
            lowerBoundGate: {
              lowerBoundAvgNetPnlPct: -0.08,
              lowerBoundProfitFactorNet: 0.7,
              stressedMaxDrawdownPct: 5.4,
            },
            recommendation: "exploratory",
            promotionDecision: {
              status: "exploratory",
              reason: "point_estimate_positive_but_lower_bound_weak",
            },
          },
        },
      ],
    }),
    "utf8"
  );

  fs.writeFileSync(
    fileB,
    JSON.stringify({
      tf: "30m",
      htfTf: "1d",
      symbols: ["QQQUSDT"],
      ranked: [
        {
          strategy: "breakdownRetestShort",
          direction: "SHORT",
          monteCarlo: {
            original: { trades: 14, avgNetPnlPct: 0.2, profitFactorNet: 1.6, maxDrawdownPct: 2.1 },
            lowerBoundGate: {
              lowerBoundAvgNetPnlPct: 0.03,
              lowerBoundProfitFactorNet: 1.1,
              stressedMaxDrawdownPct: 2.9,
            },
            recommendation: "promising",
            promotionDecision: {
              status: "core",
              reason: "lower_bound_passed",
            },
          },
        },
      ],
    }),
    "utf8"
  );

  const report = buildSummaryReport([fileA, fileB], [
    {
      profileLabel: "aapl_failed_breakdown_1h_1d_observe",
      error: "TradFi Monte Carlo failed: aapl_failed_breakdown_1h_1d_observe",
    },
  ]);

  assert.equal(report.counts.total, 2);
  assert.equal(report.counts.core, 1);
  assert.equal(report.counts.exploratory, 1);
  assert.equal(report.counts.failedProfiles, 1);
  assert.equal(report.failedProfiles[0].profileLabel, "aapl_failed_breakdown_1h_1d_observe");
  assert.equal(report.summary.core[0].profileLabel, "qqq_breakdown_short_30m_1d_core");
  assert.equal(report.summary.exploratory[0].profileLabel, "equities_reversal_1h_1d_core");
  assert.equal(path.dirname(SUMMARY_FILE).endsWith("research"), true);
});
