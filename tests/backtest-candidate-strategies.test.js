const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseSymbolsOverride,
  parseConfigOverrides,
  parseOptionalNumber,
  resolveTradeManagement,
  createFallbackSymbolConfig,
  mergeDeep,
  flattenCandidateMeta,
  buildTradeFeatureSnapshot,
  applyTradeManagementToResult,
  applyExecutionCostsToTrade,
  closeTradeIfNeeded,
} = require("../research/backtest-candidate-strategies");

test("parseSymbolsOverride normalizes, deduplicates, and uppercases symbols", () => {
  const symbols = parseSymbolsOverride(" xauusdt, AAPLUSDT, , spyusdt, aaplusdt ");

  assert.deepEqual(symbols, ["XAUUSDT", "AAPLUSDT", "SPYUSDT"]);
});

test("createFallbackSymbolConfig enables tradfi backtests without live config entries", () => {
  const cfg = createFallbackSymbolConfig("AAPLUSDT");

  assert.equal(cfg.ENABLED, true);
  assert.equal(cfg.REQUIRE_SR, true);
  assert.equal(cfg.TREND.allow15m, true);
  assert.equal(cfg.TREND.enabled, true);
  assert.equal(cfg.TREND_SHORT.enabled, true);
});

test("config override helpers parse and merge nested profile overrides", () => {
  const parsed = parseConfigOverrides('{"DEFAULTS":{"OVERSOLD_BOUNCE":{"enabled":true,"minScore":55}}}');
  const merged = mergeDeep(
    { OVERSOLD_BOUNCE: { enabled: false, maxRsi: 38 } },
    parsed.DEFAULTS
  );

  assert.equal(parsed.DEFAULTS.OVERSOLD_BOUNCE.minScore, 55);
  assert.equal(merged.OVERSOLD_BOUNCE.enabled, true);
  assert.equal(merged.OVERSOLD_BOUNCE.minScore, 55);
  assert.equal(merged.OVERSOLD_BOUNCE.maxRsi, 38);
});

test("trade management helpers normalize optional numeric controls", () => {
  assert.equal(parseOptionalNumber("0.4"), 0.4);
  assert.equal(parseOptionalNumber(""), null);

  const management = resolveTradeManagement({
    breakEvenTriggerR: "0.4",
    breakEvenLockR: "0.02",
    breakEvenMinBars: "2",
    tpFactor: "0.9",
  });

  assert.deepEqual(management, {
    breakEvenTriggerR: 0.4,
    breakEvenLockR: 0.02,
    breakEvenMinBars: 2,
    tpFactor: 0.9,
  });
});

test("flattenCandidateMeta keeps only scalar candidate meta fields", () => {
  const flattened = flattenCandidateMeta({
    plannedRr: 1.4,
    bullishBias: true,
    tpMode: "structure_capped",
    nested: { nope: true },
    arr: [1, 2, 3],
  });

  assert.deepEqual(flattened, {
    candidateMeta_plannedRr: 1.4,
    candidateMeta_bullishBias: true,
    candidateMeta_tpMode: "structure_capped",
  });
});

test("buildTradeFeatureSnapshot captures trade features for downstream meta datasets", () => {
  const snapshot = buildTradeFeatureSnapshot({
    symbol: "QQQUSDT",
    currentClosed: { closeTime: 1_700_000_000_000 },
    result: {
      strategy: "oversoldBounce",
      direction: "LONG",
      score: 88,
      signalClass: "EXECUTABLE",
      minScore: 55,
      entry: 100,
      sl: 98,
      tp: 103,
      meta: {
        plannedRr: 1.5,
        tpMode: "atr_raw",
      },
    },
    ctx: {
      indicators: {
        rsi: 34,
        prevRsi: 30,
        atr: 2,
        atrPct: 0.02,
        adx: 12,
        ema20: 101,
        ema50: 104,
        ema200: 110,
        bullish: false,
        bullishFast: false,
        nearEma20: true,
        nearEma50: false,
        nearPullback: true,
        stackedEma: false,
        rsiRising: true,
        isTrend: false,
        isRange: true,
        emaSeparationPct: 0.01,
        emaSlopePct: -0.002,
        distToEma20: 1,
        distToEma50: 4,
        avgVol: 12345,
      },
      nearestSupport: { price: 96 },
      nearestResistance: { price: 105 },
      srEvalLong: { passed: true, reason: "ok" },
    },
  });

  assert.equal(snapshot.symbol, "QQQUSDT");
  assert.equal(snapshot.tf, process.env.TF || "15m");
  assert.equal(snapshot.score, 88);
  assert.equal(snapshot.rrPlanned, 1.5);
  assert.equal(snapshot.distanceToSupportAtr, 2);
  assert.equal(snapshot.distanceToResistanceAtr, 2.5);
  assert.equal(snapshot.srPassed, true);
  assert.equal(snapshot.candidateMeta_tpMode, "atr_raw");
});

test("applyTradeManagementToResult can shrink take profit toward entry", () => {
  const managed = applyTradeManagementToResult(
    {
      strategy: "cipherContinuationShort",
      direction: "SHORT",
      entry: 100,
      sl: 105,
      tp: 90,
      meta: {},
    },
    { tpFactor: 0.5 }
  );

  assert.equal(managed.tp, 95);
  assert.equal(managed.meta.managementOriginalTp, 90);
  assert.equal(managed.meta.managementAdjustedTp, 95);
});

test("applyExecutionCostsToTrade reports gross, fees, slippage, and net fields", () => {
  const trade = applyExecutionCostsToTrade(
    {
      pnlPct: 0.5,
    },
    {
      feeRate: 0.0004,
      slippagePct: 0.0002,
    }
  );

  assert.equal(trade.grossPnlPct, 0.5);
  assert.equal(trade.estimatedFeesPct, 0.08);
  assert.equal(trade.estimatedSlippagePct, 0.04);
  assert.equal(trade.netPnlPct, 0.38);
});

test("closeTradeIfNeeded arms break-even for later candles before returning a close", () => {
  const trade = {
    direction: "SHORT",
    entry: 100,
    sl: 105,
    tp: 90,
    initialSl: 105,
    initialRiskAbs: 5,
    barsHeld: 0,
    breakEvenApplied: false,
  };

  const firstCandle = { high: 101, low: 97.5, closeTime: 1 };
  const closedNow = closeTradeIfNeeded(trade, firstCandle, {
    breakEvenTriggerR: 0.4,
    breakEvenLockR: 0.02,
    breakEvenMinBars: 1,
  });

  assert.equal(closedNow, null);
  assert.equal(trade.breakEvenApplied, true);
  assert.equal(trade.prevSl, 105);
  assert.equal(trade.sl, 99.9);

  const secondCandle = { high: 100.2, low: 99.4, closeTime: 2 };
  const closedLater = closeTradeIfNeeded(trade, secondCandle, {
    breakEvenTriggerR: 0.4,
    breakEvenLockR: 0.02,
    breakEvenMinBars: 1,
  });

  assert.equal(closedLater.outcome, "SL");
  assert.equal(closedLater.exitPrice, 99.9);
  assert.ok(closedLater.pnlPct > 0);
  assert.ok(Number.isFinite(closedLater.grossPnlPct));
  assert.ok(Number.isFinite(closedLater.netPnlPct));
});
