const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseSymbolsOverride,
  buildOutputPaths,
  passesBtcGate,
  summarizeTrades,
} = require("../research/compare-btc-gated-breakdown");

test("parseSymbolsOverride normalizes symbol lists and falls back cleanly", () => {
  assert.deepEqual(parseSymbolsOverride("adausdc, LINKUSDC, adausdc"), [
    "ADAUSDC",
    "LINKUSDC",
  ]);
});

test("buildOutputPaths derives stable filenames from the symbol subset", () => {
  const paths = buildOutputPaths(["ADAUSDC", "LINKUSDC"]);
  assert.match(paths.outputJson, /btc-gated-breakdown-comparison-adausdc-linkusdc-15m\.json$/);
  assert.match(
    paths.outputSummary,
    /btc-gated-breakdown-comparison-summary-adausdc-linkusdc-15m\.json$/
  );
});

test("passesBtcGate requires a bearish BTC regime with enough breadth and follow-through", () => {
  assert.deepEqual(
    passesBtcGate({
      state: "risk_off_selloff",
      btc: { direction: "down" },
      alts: { negativeBreadth: 0.8, followRate: 0.7 },
    }),
    { allowed: true, reason: "btc_gate:passed" }
  );

  assert.equal(
    passesBtcGate({
      state: "mixed",
      btc: { direction: "down" },
      alts: { negativeBreadth: 0.8, followRate: 0.7 },
    }).allowed,
    false
  );

  assert.equal(
    passesBtcGate({
      state: "risk_off_selloff",
      btc: { direction: "up" },
      alts: { negativeBreadth: 0.8, followRate: 0.7 },
    }).reason,
    "btc_gate:btc_direction_up"
  );
});

test("summarizeTrades reports basic net stats and drawdown", () => {
  const summary = summarizeTrades([
    { netPnlPct: 0.5 },
    { netPnlPct: -0.2 },
    { netPnlPct: 0.1 },
  ]);

  assert.equal(summary.trades, 3);
  assert.equal(summary.winrate, 66.6667);
  assert.equal(summary.avgNetPnlPct, 0.133333);
  assert.equal(summary.profitFactorNet, 3);
  assert.equal(summary.maxDrawdownPct, 0.2);
});
