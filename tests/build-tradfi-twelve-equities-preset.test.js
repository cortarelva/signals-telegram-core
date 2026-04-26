const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStrategyEntry,
  buildPresetSymbol,
  buildArtifacts,
} = require("../research/build-tradfi-twelve-equities-preset");

function makeBacktest(tf, htfTf, rows) {
  return {
    tf,
    htfTf,
    ranked: rows,
  };
}

test("buildStrategyEntry extracts summary stats for one symbol", () => {
  const backtest = makeBacktest("1h", "1d", [
    {
      strategy: "oversoldBounce",
      bySymbol: {
        AAPLUSDT: {
          summary: {
            trades: 10,
            avgPnlPct: 0.1234567,
            profitFactor: 1.23456,
            winrate: 55.55555,
            maxDrawdownPct: 2.34567,
          },
        },
      },
    },
  ]);

  assert.deepEqual(
    buildStrategyEntry({
      backtest,
      strategyName: "oversoldBounce",
      strategyKey: "OVERSOLD_BOUNCE",
      symbol: "AAPLUSDT",
      label: "primary",
    }),
    {
      label: "primary",
      strategyKey: "OVERSOLD_BOUNCE",
      sourceStrategy: "oversoldBounce",
      enabled: true,
      tf: "1h",
      htfTf: "1d",
      trades: 10,
      avgPnlPct: 0.123457,
      profitFactor: 1.23456,
      winrate: 55.5555,
      maxDrawdownPct: 2.34567,
    }
  );
});

test("buildPresetSymbol switches to per-strategy mode for mixed profiles", () => {
  const preset = buildPresetSymbol([
    {
      strategyKey: "OVERSOLD_BOUNCE",
      sourceStrategy: "oversoldBounce",
      tf: "1h",
      htfTf: "1d",
      trades: 20,
      avgPnlPct: 0.05,
      profitFactor: 1.2,
      winrate: 50,
      maxDrawdownPct: 3,
    },
    {
      strategyKey: "BREAKDOWN_RETEST_SHORT",
      sourceStrategy: "breakdownRetestShort",
      tf: "30m",
      htfTf: "1d",
      trades: 15,
      avgPnlPct: 0.04,
      profitFactor: 1.1,
      winrate: 44,
      maxDrawdownPct: 2.5,
    },
  ]);

  assert.equal(preset.profileMode, "per-strategy");
  assert.deepEqual(preset.profiles, [
    { tf: "1h", htfTf: "1d" },
    { tf: "30m", htfTf: "1d" },
  ]);
  assert.equal(preset.defaultTf, "1h");
  assert.ok(preset.strategies.OVERSOLD_BOUNCE);
  assert.ok(preset.strategies.BREAKDOWN_RETEST_SHORT);
});

test("buildArtifacts keeps AAPL watchlist separate from enabled preset", () => {
  const thirtyMinuteBacktest = makeBacktest("30m", "1d", [
    {
      strategy: "breakdownRetestShort",
      bySymbol: {
        QQQUSDT: {
          summary: {
            trades: 22,
            avgPnlPct: 0.0916646,
            profitFactor: 1.290339,
            winrate: 45.4545,
            maxDrawdownPct: 2.6057,
          },
        },
      },
    },
  ]);

  const oneHourBacktest = makeBacktest("1h", "1d", [
    {
      strategy: "oversoldBounce",
      bySymbol: {
        AAPLUSDT: {
          summary: {
            trades: 107,
            avgPnlPct: 0.0362,
            profitFactor: 1.081,
            winrate: 48.6,
            maxDrawdownPct: 8.225,
          },
        },
        QQQUSDT: {
          summary: {
            trades: 83,
            avgPnlPct: 0.0635,
            profitFactor: 1.196,
            winrate: 49.4,
            maxDrawdownPct: 3.9256,
          },
        },
        SPYUSDT: {
          summary: {
            trades: 93,
            avgPnlPct: 0.0797,
            profitFactor: 1.329,
            winrate: 51.61,
            maxDrawdownPct: 2.9413,
          },
        },
      },
    },
    {
      strategy: "failedBreakdown",
      bySymbol: {
        AAPLUSDT: {
          summary: {
            trades: 7,
            avgPnlPct: 0.3131,
            profitFactor: 2.02,
            winrate: 57.14,
            maxDrawdownPct: 2.1497,
          },
        },
      },
    },
  ]);

  const { preset, recommendations } = buildArtifacts({
    thirtyMinuteBacktest,
    oneHourBacktest,
  });

  assert.deepEqual(Object.keys(preset.symbols), ["AAPLUSDT", "QQQUSDT", "SPYUSDT"]);
  assert.ok(preset.symbols.QQQUSDT.strategies.OVERSOLD_BOUNCE);
  assert.ok(preset.symbols.QQQUSDT.strategies.BREAKDOWN_RETEST_SHORT);
  assert.equal(recommendations.symbols.AAPLUSDT.enabled.length, 1);
  assert.equal(recommendations.symbols.AAPLUSDT.observe.length, 1);
  assert.equal(
    recommendations.symbols.AAPLUSDT.observe[0].strategyKey,
    "FAILED_BREAKDOWN"
  );
});
