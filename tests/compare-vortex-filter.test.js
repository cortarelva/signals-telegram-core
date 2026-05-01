const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseSymbolsOverride,
  parseStrategiesOverride,
  buildOutputPaths,
  summarizeTrades,
  passesVortexGate,
  findDirectionStreakLength,
} = require("../research/compare-vortex-filter");

test("parse helpers normalize symbol and strategy overrides", () => {
  assert.deepEqual(parseSymbolsOverride("btcusdc, ETHUSDC, btcusdc"), [
    "BTCUSDC",
    "ETHUSDC",
  ]);
  assert.deepEqual(parseStrategiesOverride("cipherContinuationLong, breakdownRetestShort"), [
    "cipherContinuationLong",
    "breakdownRetestShort",
  ]);
});

test("buildOutputPaths derives stable filenames for the vortex comparison", () => {
  const paths = buildOutputPaths(["BTCUSDC", "ETHUSDC"], [
    "breakdownRetestShort",
    "cipherContinuationLong",
  ]);
  assert.match(paths.outputJson, /vortex-filter-comparison-btcusdc-ethusdc-breakdownretestshort-ciphercontinuationlong-1h\.json$/);
  assert.match(paths.outputMd, /vortex-filter-comparison-btcusdc-ethusdc-breakdownretestshort-ciphercontinuationlong-1h\.md$/);
});

test("findDirectionStreakLength measures the active directional run", () => {
  const series = [
    null,
    { direction: "down" },
    { direction: "down" },
    { direction: "up" },
    { direction: "up" },
  ];

  assert.equal(findDirectionStreakLength(series, 4, "up"), 2);
  assert.equal(findDirectionStreakLength(series, 2, "down"), 2);
});

test("passesVortexGate supports aligned and fresh-cross variants", () => {
  const series = [
    null,
    { direction: "down", viPlus: 0.8, viMinus: 1.1, spread: 0.3 },
    { direction: "down", viPlus: 0.75, viMinus: 1.12, spread: 0.37 },
    { direction: "down", viPlus: 0.7, viMinus: 1.14, spread: 0.44 },
  ];

  assert.deepEqual(
    passesVortexGate({
      series,
      candleIndex: 3,
      direction: "SHORT",
      variant: { gated: true, minSpread: 0.03, requireFreshCross: false },
    }).allowed,
    true
  );

  assert.equal(
    passesVortexGate({
      series,
      candleIndex: 3,
      direction: "LONG",
      variant: { gated: true, minSpread: 0.03, requireFreshCross: false },
    }).reason,
    "vortex_gate:direction_down"
  );

  assert.equal(
    passesVortexGate({
      series,
      candleIndex: 3,
      direction: "SHORT",
      variant: {
        gated: true,
        minSpread: 0.03,
        requireFreshCross: true,
        maxCrossLookbackBars: 2,
      },
    }).reason,
    "vortex_gate:cross_stale"
  );
});

test("summarizeTrades reports net stats and drawdown", () => {
  const summary = summarizeTrades([
    { netPnlPct: 0.6 },
    { netPnlPct: -0.2 },
    { netPnlPct: 0.1 },
  ]);

  assert.equal(summary.trades, 3);
  assert.equal(summary.winrate, 66.6667);
  assert.equal(summary.avgNetPnlPct, 0.166667);
  assert.equal(summary.profitFactorNet, 3.5);
  assert.equal(summary.maxDrawdownPct, 0.2);
});
