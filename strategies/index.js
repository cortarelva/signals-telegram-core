const { evaluateTrendStrategy } = require("./trend-strategy");
const { evaluateTrendShortStrategy } = require("./trend-short-strategy");
const {
  evaluateBreakdownRetestShortStrategy,
} = require("./breakdown-retest-short-strategy");
const { evaluateBullTrapStrategy } = require("./bull-trap-strategy");
const { evaluateFailedBreakdownStrategy } = require("./failed-breakdown-strategy");
const { evaluateOversoldBounceStrategy } = require("./oversold-bounce-strategy");
const {
  evaluateMomentumBreakoutLongStrategy,
} = require("./momentum-breakout-long-strategy");
const {
  evaluateCipherContinuationLongStrategy,
} = require("./cipher-continuation-long-strategy");
const {
  evaluateCipherContinuationShortStrategy,
} = require("./cipher-continuation-short-strategy");
const {
  evaluateIgnitionContinuationLongStrategy,
} = require("./ignition-continuation-long-strategy");
const {
  evaluateLiquiditySweepReclaimLongStrategy,
} = require("./liquidity-sweep-reclaim-long-strategy");
const {
  evaluateFlushReclaimLongStrategy,
} = require("./flush-reclaim-long-strategy");

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return !!fallback;

  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  return !!fallback;
}

function getStrategyConfig(ctx, keys) {
  const cfg = ctx?.cfg || {};
  for (const key of keys) {
    const value = cfg?.[key];
    if (value && typeof value === "object") return value;
  }
  return {};
}

function isStrategyEnabled(ctx, strategyKey) {
  switch (strategyKey) {
    case "TREND":
      return getStrategyConfig(ctx, ["TREND"]).enabled !== false;
    case "TREND_SHORT":
      return getStrategyConfig(ctx, ["TREND_SHORT"]).enabled !== false;
    case "BREAKDOWN_RETEST_SHORT":
      return getStrategyConfig(ctx, ["BREAKDOWN_RETEST_SHORT"]).enabled !== false;
    case "BULL_TRAP":
      return getStrategyConfig(ctx, ["BULL_TRAP"]).enabled !== false;
    case "FAILED_BREAKDOWN":
      return getStrategyConfig(ctx, ["FAILED_BREAKDOWN"]).enabled !== false;
    case "OVERSOLD_BOUNCE":
      return getStrategyConfig(ctx, ["OVERSOLD_BOUNCE"]).enabled === true;
    case "MOMENTUM_BREAKOUT_LONG":
      return envBool(
        "MOMENTUM_BREAKOUT_LONG_ENABLED",
        getStrategyConfig(ctx, [
          "MOMENTUM_BREAKOUT_LONG",
          "MOMENTUM_BREAKOUT",
          "BREAKOUT_LONG",
        ]).enabled === true
      );
    case "CIPHER_CONTINUATION_LONG":
      return getStrategyConfig(ctx, [
        "CIPHER_CONTINUATION_LONG",
        "CIPHER_CONTINUATION",
      ]).enabled !== false;
    case "CIPHER_CONTINUATION_SHORT":
      return getStrategyConfig(ctx, [
        "CIPHER_CONTINUATION_SHORT",
        "CIPHER_CONTINUATION",
      ]).enabled !== false;
    case "IGNITION_CONTINUATION_LONG":
      return getStrategyConfig(ctx, [
        "IGNITION_CONTINUATION_LONG",
        "EXPANSION_CONTINUATION_LONG",
      ]).enabled === true;
    case "LIQUIDITY_SWEEP_RECLAIM_LONG":
      return getStrategyConfig(ctx, [
        "LIQUIDITY_SWEEP_RECLAIM_LONG",
        "LIQUIDITY_SWEEP",
        "SWEEP_RECLAIM_LONG",
      ]).enabled === true;
    case "FLUSH_RECLAIM_LONG":
      return getStrategyConfig(ctx, [
        "FLUSH_RECLAIM_LONG",
        "EARLY_EXPANSION_RECLAIM_LONG",
      ]).enabled === true;
    default:
      return true;
  }
}

const STRATEGY_DESCRIPTORS = [
  {
    key: "TREND",
    evaluate: evaluateTrendStrategy,
  },
  {
    key: "TREND_SHORT",
    evaluate: evaluateTrendShortStrategy,
  },
  {
    key: "BREAKDOWN_RETEST_SHORT",
    evaluate: evaluateBreakdownRetestShortStrategy,
  },
  {
    key: "BULL_TRAP",
    evaluate: evaluateBullTrapStrategy,
  },
  {
    key: "FAILED_BREAKDOWN",
    evaluate: evaluateFailedBreakdownStrategy,
  },
  {
    key: "OVERSOLD_BOUNCE",
    evaluate: evaluateOversoldBounceStrategy,
  },
  {
    key: "MOMENTUM_BREAKOUT_LONG",
    evaluate: evaluateMomentumBreakoutLongStrategy,
  },
  {
    key: "CIPHER_CONTINUATION_LONG",
    evaluate: evaluateCipherContinuationLongStrategy,
  },
  {
    key: "CIPHER_CONTINUATION_SHORT",
    evaluate: evaluateCipherContinuationShortStrategy,
  },
  {
    key: "IGNITION_CONTINUATION_LONG",
    evaluate: evaluateIgnitionContinuationLongStrategy,
  },
  {
    key: "LIQUIDITY_SWEEP_RECLAIM_LONG",
    evaluate: evaluateLiquiditySweepReclaimLongStrategy,
  },
  {
    key: "FLUSH_RECLAIM_LONG",
    evaluate: evaluateFlushReclaimLongStrategy,
  },
];

function pickBestStrategy(results) {
  const allowed = results.filter((r) => r && r.allowed);

  if (!allowed.length) {
    return {
      selected: null,
      visibleScore: Math.max(...results.map((r) => r?.score || 0), 0),
      visibleSignalClass: "BLOCKED",
      blockedReason:
        results.filter(Boolean).map((r) => r.reason).filter(Boolean).join(" | ") || "no_strategy",
      all: results,
    };
  }

  allowed.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.minScore || 0) - (a.minScore || 0);
  });

  const selected = allowed[0];

  return {
    selected,
    visibleScore: selected.score,
    visibleSignalClass: selected.signalClass,
    blockedReason: "selected",
    all: results,
  };
}

function evaluateAllStrategies(ctx) {
  const results = STRATEGY_DESCRIPTORS.filter((descriptor) =>
    isStrategyEnabled(ctx, descriptor.key)
  ).map((descriptor) => descriptor.evaluate(ctx));

  return pickBestStrategy(results);
}

module.exports = { evaluateAllStrategies };
