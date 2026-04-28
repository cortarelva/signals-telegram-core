const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseSymbols,
  parseStrategies,
  parseConfigOverrides,
  extractTradeRows,
  summarizeTradeReturns,
  percentile,
  bootstrapReturns,
  shuffleReturns,
  summarizeSimulationMetrics,
  classifyMonteCarloResult,
  deriveLowerBoundGate,
  derivePromotionDecision,
  runMonteCarloOnTrades,
  buildDefaultOutputPath,
} = require("../research/monte-carlo-trade-list");

test("parse helpers normalize input lists", () => {
  assert.deepEqual(parseSymbols(" adausdc, LINKUSDC ,adausdc "), ["ADAUSDC", "LINKUSDC"]);
  assert.deepEqual(parseStrategies(" cipherContinuationLong, breakdownRetestShort "), [
    "cipherContinuationLong",
    "breakdownRetestShort",
  ]);
  assert.deepEqual(parseConfigOverrides('{"DEFAULTS":{"BREAKDOWN_CONTINUATION_BASE_SHORT":{"enabled":true}}}'), {
    DEFAULTS: {
      BREAKDOWN_CONTINUATION_BASE_SHORT: {
        enabled: true,
      },
    },
  });
});

test("extractTradeRows flattens per-symbol trade arrays from a backtest row", () => {
  const rows = extractTradeRows({
    strategy: "cipherContinuationLong",
    direction: "LONG",
    bySymbol: {
      ADAUSDC: {
        trades: [{ netPnlPct: 0.4 }, { netPnlPct: -0.2 }],
      },
      LINKUSDC: {
        trades: [{ netPnlPct: 0.1 }],
      },
    },
  });

  assert.equal(rows.length, 3);
  assert.equal(rows[0].strategy, "cipherContinuationLong");
  assert.equal(rows[0].symbol, "ADAUSDC");
  assert.equal(rows[2].symbol, "LINKUSDC");
});

test("summarizeTradeReturns computes net, drawdown, and loss streak", () => {
  const summary = summarizeTradeReturns([0.5, -0.2, 0.1, -0.3]);

  assert.equal(summary.trades, 4);
  assert.equal(summary.winrate, 50);
  assert.equal(Number(summary.avgNetPnlPct.toFixed(6)), 0.025);
  assert.equal(Number(summary.netPnl.toFixed(6)), 0.1);
  assert.equal(Number(summary.profitFactorNet.toFixed(6)), 1.2);
  assert.equal(Number(summary.maxDrawdownPct.toFixed(6)), 0.4);
  assert.equal(summary.maxLossStreak, 1);
});

test("percentile interpolates expected quantiles", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4], 0.25), 1.75);
});

test("bootstrapReturns and shuffleReturns preserve sample size", () => {
  const sample = [1, 2, 3, 4];
  const rng = () => 0.4;

  const boot = bootstrapReturns(sample, rng);
  const shuffled = shuffleReturns(sample, () => 0.2);

  assert.equal(boot.length, sample.length);
  assert.equal(shuffled.length, sample.length);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), sample);
});

test("summarizeSimulationMetrics reports quantiles and hit rates", () => {
  const summary = summarizeSimulationMetrics([
    { avgNetPnlPct: 0.2, netPnl: 1, profitFactorNet: 1.2, maxDrawdownPct: 0.4, maxLossStreak: 1, winrate: 60 },
    { avgNetPnlPct: -0.1, netPnl: -0.5, profitFactorNet: 0.8, maxDrawdownPct: 1.1, maxLossStreak: 2, winrate: 40 },
    { avgNetPnlPct: 0.3, netPnl: 1.3, profitFactorNet: 1.5, maxDrawdownPct: 0.2, maxLossStreak: 1, winrate: 70 },
  ]);

  assert.equal(summary.positiveNetRate, 0.666667);
  assert.equal(summary.avgNetPositiveRate, 0.666667);
  assert.equal(summary.profitFactorAboveOneRate, 0.666667);
  assert.ok(summary.p05.maxDrawdownPct <= summary.p95.maxDrawdownPct);
});

test("classifyMonteCarloResult distinguishes robust from fragile samples", () => {
  assert.equal(
    classifyMonteCarloResult(
      { trades: 12, avgNetPnlPct: 0.2, profitFactorNet: 1.4, maxDrawdownPct: 1 },
      {
        p05: { avgNetPnlPct: 0.05, profitFactorNet: 1.1 },
        positiveNetRate: 0.8,
        profitFactorAboveOneRate: 0.75,
      },
      { p95: { maxDrawdownPct: 1.3 } }
    ),
    "promising"
  );

  assert.equal(
    classifyMonteCarloResult(
      { trades: 10, avgNetPnlPct: 0.05, profitFactorNet: 1.05, maxDrawdownPct: 2 },
      {
        p05: { avgNetPnlPct: -0.04, profitFactorNet: 0.8 },
        positiveNetRate: 0.6,
        profitFactorAboveOneRate: 0.55,
      },
      { p95: { maxDrawdownPct: 2.5 } }
    ),
    "exploratory"
  );

  assert.equal(
    classifyMonteCarloResult(
      { trades: 6, avgNetPnlPct: 0.2, profitFactorNet: 2, maxDrawdownPct: 1 },
      { p05: { avgNetPnlPct: 0.01, profitFactorNet: 1.1 }, positiveNetRate: 0.9, profitFactorAboveOneRate: 0.9 },
      { p95: { maxDrawdownPct: 1.2 } }
    ),
    "insufficient_sample"
  );
});

test("deriveLowerBoundGate and derivePromotionDecision map Monte Carlo into promotion statuses", () => {
  const strong = {
    original: { trades: 14, avgNetPnlPct: 0.2, profitFactorNet: 1.4, maxDrawdownPct: 2 },
    bootstrap: { p05: { avgNetPnlPct: 0.05, profitFactorNet: 1.1 } },
    shuffledOrder: { p95: { maxDrawdownPct: 2.6 } },
    recommendation: "promising",
  };

  const gate = deriveLowerBoundGate(strong);
  assert.equal(gate.minTradesPassed, true);
  assert.equal(gate.lowerBoundAvgPositive, true);
  assert.equal(derivePromotionDecision(strong).status, "core");

  const weakSample = {
    original: { trades: 5, avgNetPnlPct: 0.3, profitFactorNet: 1.8, maxDrawdownPct: 1 },
    bootstrap: { p05: { avgNetPnlPct: -0.2, profitFactorNet: 0.7 } },
    shuffledOrder: { p95: { maxDrawdownPct: 1.4 } },
    recommendation: "insufficient_sample",
  };

  assert.equal(derivePromotionDecision(weakSample).status, "exploratory");
  assert.equal(
    derivePromotionDecision({
      original: { trades: 15, avgNetPnlPct: -0.1, profitFactorNet: 0.8, maxDrawdownPct: 3 },
      bootstrap: { p05: { avgNetPnlPct: -0.4, profitFactorNet: 0.4 } },
      shuffledOrder: { p95: { maxDrawdownPct: 5 } },
      recommendation: "fragile",
    }).status,
    "reject"
  );
});

test("runMonteCarloOnTrades returns deterministic structured output", () => {
  const result = runMonteCarloOnTrades(
    [
      { netPnlPct: 0.5 },
      { netPnlPct: -0.2 },
      { netPnlPct: 0.1 },
      { netPnlPct: 0.3 },
      { netPnlPct: -0.1 },
      { netPnlPct: 0.2 },
      { netPnlPct: 0.4 },
      { netPnlPct: -0.05 },
    ],
    { iterations: 300, seed: "unit-test" }
  );

  assert.equal(result.original.trades, 8);
  assert.ok(Number.isFinite(result.bootstrap.p05.avgNetPnlPct));
  assert.ok(Number.isFinite(result.shuffledOrder.p95.maxDrawdownPct));
  assert.match(result.recommendation, /^(promising|exploratory|fragile|insufficient_sample)$/);
});

test("buildDefaultOutputPath reflects symbols, strategies, and timeframe", () => {
  const outputPath = buildDefaultOutputPath(["ADAUSDC", "BTCUSDC"], ["cipherContinuationLong"]);
  const expectedTf = String(process.env.MONTE_TF || process.env.TF || "15m")
    .trim()
    .toLowerCase();
  assert.match(
    outputPath,
    new RegExp(`monte-carlo-adausdc-btcusdc-ciphercontinuationlong-${expectedTf}\\.json$`)
  );
});
