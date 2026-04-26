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
  assert.equal(config.XRPUSDC.ENABLED, false);
  assert.equal(config.XRPUSDC.BULL_TRAP.enabled, false);
});
