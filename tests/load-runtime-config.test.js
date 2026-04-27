const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  loadRuntimeConfigFiles,
} = require("../runtime/config/load-runtime-config");

test("loadRuntimeConfigFiles merges DEFAULTS and adaptive trendShort overrides", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-config-"));
  const strategyFile = path.join(dir, "strategy-config.json");
  const adaptiveFile = path.join(dir, "adaptive-config.json");

  fs.writeFileSync(
    strategyFile,
    JSON.stringify(
      {
        DEFAULTS: {
          ENABLED: true,
          REQUIRE_SR: true,
          BULL_TRAP: {
            enabled: false,
          },
          TREND: {
            enabled: false,
            minScore: 61,
            allow15m: false,
          },
          TREND_SHORT: {
            minScore: 68,
            requireSr: true,
            requireNearPullback: true,
          },
        },
        ETHUSDC: {
          BULL_TRAP: {
            enabled: true,
          },
          EXTRA_RUNS: [
            {
              id: "eth_short_15m",
              ENABLED: true,
              TF: "15m",
              BREAKDOWN_RETEST_SHORT: {
                enabled: true,
              },
            },
          ],
          TREND: {
            enabled: true,
            allow15m: true,
            rsiMax: 58,
          },
          TREND_SHORT: {
            rsiMax: 52,
          },
        },
        XRPUSDC: {
          ENABLED: false,
        },
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    adaptiveFile,
    JSON.stringify(
      {
        symbols: {
          ETHUSDC: {
            trend: { minScore: 77 },
            trendShort: { minAdx: 21 },
          },
          XRPUSDC: {
            enabled: true,
          },
        },
      },
      null,
      2
    ),
    "utf8"
  );

  const config = loadRuntimeConfigFiles({ strategyFile, adaptiveFile });

  assert.equal(config.DEFAULTS, undefined);
  assert.equal(config.ETHUSDC.ENABLED, true);
  assert.equal(config.ETHUSDC.BULL_TRAP.enabled, true);
  assert.equal(config.ETHUSDC.TREND.enabled, true);
  assert.equal(config.ETHUSDC.TREND.allow15m, true);
  assert.equal(config.ETHUSDC.TREND.minScore, 77);
  assert.equal(config.ETHUSDC.TREND.rsiMax, 58);
  assert.equal(config.ETHUSDC.TREND_SHORT.minScore, 68);
  assert.equal(config.ETHUSDC.TREND_SHORT.requireSr, true);
  assert.equal(config.ETHUSDC.TREND_SHORT.requireNearPullback, true);
  assert.equal(config.ETHUSDC.TREND_SHORT.rsiMax, 52);
  assert.equal(config.ETHUSDC.TREND_SHORT.minAdx, 21);
  assert.equal(Array.isArray(config.ETHUSDC.EXTRA_RUNS), true);
  assert.equal(config.ETHUSDC.EXTRA_RUNS[0].TF, "15m");
  assert.equal(config.ETHUSDC.EXTRA_RUNS[0].BREAKDOWN_RETEST_SHORT.enabled, true);
  assert.equal(config.XRPUSDC.ENABLED, false);
  assert.equal(config.XRPUSDC.BULL_TRAP.enabled, false);
});

test("loadRuntimeConfigFiles uses env override paths when explicit files are omitted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-config-env-"));
  const strategyFile = path.join(dir, "strategy-env.json");
  const adaptiveFile = path.join(dir, "adaptive-env.json");

  fs.writeFileSync(
    strategyFile,
    JSON.stringify(
      {
        TESTUSDC: {
          ENABLED: true,
          TF: "15m",
          CIPHER_CONTINUATION_LONG: { enabled: true },
        },
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(adaptiveFile, JSON.stringify({ symbols: {} }, null, 2), "utf8");

  const previousStrategyFile = process.env.STRATEGY_CONFIG_FILE_PATH;
  const previousAdaptiveFile = process.env.ADAPTIVE_CONFIG_FILE_PATH;

  process.env.STRATEGY_CONFIG_FILE_PATH = strategyFile;
  process.env.ADAPTIVE_CONFIG_FILE_PATH = adaptiveFile;

  try {
    const config = loadRuntimeConfigFiles();
    assert.equal(config.TESTUSDC.ENABLED, true);
    assert.equal(config.TESTUSDC.TF, "15m");
    assert.equal(config.TESTUSDC.CIPHER_CONTINUATION_LONG.enabled, true);
  } finally {
    if (previousStrategyFile == null) delete process.env.STRATEGY_CONFIG_FILE_PATH;
    else process.env.STRATEGY_CONFIG_FILE_PATH = previousStrategyFile;

    if (previousAdaptiveFile == null) delete process.env.ADAPTIVE_CONFIG_FILE_PATH;
    else process.env.ADAPTIVE_CONFIG_FILE_PATH = previousAdaptiveFile;
  }
});
