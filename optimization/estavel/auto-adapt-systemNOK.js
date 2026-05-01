const fs = require("fs");
const path = require("path");

const CONSOLIDATED_FILE = path.join(
  __dirname,
  "..",
  "research",
  "consolidated-trades.json"
);

const BASE_CONFIG_FILE = path.join(
  __dirname,
  "..",
  "runtime",
  "strategy-config.json"
);

const ADAPTIVE_CONFIG_FILE = path.join(
  __dirname,
  "..",
  "runtime",
  "adaptive-config.json"
);

const ADAPTIVE_HISTORY_FILE = path.join(
  __dirname,
  "..",
  "runtime",
  "adaptive-history.json"
);

const DEFAULTS = {
  mode: "aggressive_safe",
  lookbackClosedTrades: 30,
  minClosedTradesForUpdate: 12,
  minExpectedR: 0.0,
  disableBelowAvgR: -0.6,
  maxScoreStepPerCycle: 5,
  maxRsiStepPerCycle: 2,
  maxAdxStepPerCycle: 3,
  maxAllowedSlippagePct: 0.0015,
  maxAllowedLatencyMs: 1800,
};

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function isResolvedTrade(t) {
  return t && (t.outcome === "TP" || t.outcome === "SL");
}

function avg(values) {
  const arr = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stepToward(current, target, maxStep) {
  if (current == null || !Number.isFinite(current)) return target;
  if (target == null || !Number.isFinite(target)) return current;

  if (target > current) return Math.min(current + maxStep, target);
  if (target < current) return Math.max(current - maxStep, target);
  return current;
}

function summarizeTrades(trades) {
  const resolved = trades.filter(isResolvedTrade);
  const tp = resolved.filter((t) => t.outcome === "TP").length;
  const sl = resolved.filter((t) => t.outcome === "SL").length;

  const avgR = avg(resolved.map((t) => t.rrRealized));
  const avgPnlPct = avg(resolved.map((t) => t.pnlPct));
  const avgSlippagePct = avg(resolved.map((t) => t.slippagePct));
  const avgLatencyTotal = avg(resolved.map((t) => t.latencyTotal));

  return {
    trades: trades.length,
    resolved: resolved.length,
    tp,
    sl,
    winrate: resolved.length ? (tp / resolved.length) * 100 : 0,
    avgR: avgR ?? 0,
    avgPnlPct: avgPnlPct ?? 0,
    avgSlippagePct: avgSlippagePct ?? 0,
    avgLatencyTotal: avgLatencyTotal ?? 0,
  };
}

function getRecentTradesBySymbol(trades, symbol, limit) {
  return trades
    .filter((t) => t.symbol === symbol && isResolvedTrade(t))
    .sort((a, b) => (a.closedTs || a.openTs || 0) - (b.closedTs || b.openTs || 0))
    .slice(-limit);
}

function thresholdStats(trades, field, thresholds) {
  const out = [];
  for (const threshold of thresholds) {
    const subset = trades.filter(
      (t) => typeof t[field] === "number" && t[field] >= threshold
    );
    out.push({
      threshold,
      ...summarizeTrades(subset),
    });
  }
  return out;
}

function bucketStats(trades, field, buckets) {
  const out = [];

  for (let i = 0; i < buckets.length - 1; i++) {
    const min = buckets[i];
    const max = buckets[i + 1];
    const subset = trades.filter(
      (t) =>
        typeof t[field] === "number" &&
        Number.isFinite(t[field]) &&
        t[field] >= min &&
        t[field] < max
    );

    out.push({
      bucketMin: min,
      bucketMax: max,
      label: `${min}-${max}`,
      ...summarizeTrades(subset),
    });
  }

  return out;
}

function boolStats(trades, field) {
  const t = trades.filter((x) => x[field] === true);
  const f = trades.filter((x) => x[field] === false);

  return {
    trueStats: summarizeTrades(t),
    falseStats: summarizeTrades(f),
  };
}

function valueStats(trades, field, values) {
  return values.map((value) => {
    const subset = trades.filter((t) => t[field] === value);
    return {
      value,
      ...summarizeTrades(subset),
    };
  });
}

function pickBestThreshold(candidates, minTrades, baselineAvgR) {
  const valid = candidates.filter((c) => c.resolved >= minTrades);
  if (!valid.length) return null;

  valid.sort((a, b) => {
    if (b.avgR !== a.avgR) return b.avgR - a.avgR;
    if (b.winrate !== a.winrate) return b.winrate - a.winrate;
    return b.resolved - a.resolved;
  });

  const best = valid[0];
  if (best.avgR <= baselineAvgR) return null;
  return best;
}

function pickBestBucket(candidates, minTrades) {
  const valid = candidates.filter((c) => c.resolved >= minTrades);
  if (!valid.length) return null;

  valid.sort((a, b) => {
    if (b.avgR !== a.avgR) return b.avgR - a.avgR;
    if (b.winrate !== a.winrate) return b.winrate - a.winrate;
    return b.resolved - a.resolved;
  });

  return valid[0];
}

function pickBestValue(candidates, minTrades, baselineAvgR = -Infinity) {
  const valid = candidates.filter((c) => c.resolved >= minTrades);
  if (!valid.length) return null;

  valid.sort((a, b) => {
    if (b.avgR !== a.avgR) return b.avgR - a.avgR;
    if (b.winrate !== a.winrate) return b.winrate - a.winrate;
    return b.resolved - a.resolved;
  });

  const best = valid[0];
  if (best.avgR <= baselineAvgR) return null;
  return best;
}

function getBaseSymbolConfig(baseConfig, symbol) {
  return baseConfig?.[symbol] || baseConfig?.symbols?.[symbol] || {};
}

function getPrevAdaptiveSymbolConfig(prevAdaptive, symbol) {
  return prevAdaptive?.symbols?.[symbol] || {};
}

function decideSymbolConfig(symbol, trades, baseCfg, prevAdaptive, globals) {
  const stats = summarizeTrades(trades);

  const current = {
    enabled: prevAdaptive.enabled ?? baseCfg.ENABLED ?? true,
    minScore:
      prevAdaptive.minScore ??
      baseCfg.MIN_SCORE ??
      baseCfg.minScore ??
      65,
    rsiMin:
      prevAdaptive.rsiMin ??
      baseCfg.RSI_MIN ??
      baseCfg.rsiMin ??
      38,
    rsiMax:
      prevAdaptive.rsiMax ??
      baseCfg.RSI_MAX ??
      baseCfg.rsiMax ??
      50,
    minAdx:
      prevAdaptive.minAdx ??
      baseCfg.MIN_ADX ??
      baseCfg.minAdx ??
      10,
    requireTrend:
      prevAdaptive.requireTrend ??
      baseCfg.REQUIRE_TREND ??
      baseCfg.requireTrend ??
      false,
    requireRange:
      prevAdaptive.requireRange ??
      baseCfg.REQUIRE_RANGE ??
      baseCfg.requireRange ??
      false,
    requireNearPullback:
      prevAdaptive.requireNearPullback ??
      baseCfg.REQUIRE_NEAR_PULLBACK ??
      baseCfg.requireNearPullback ??
      false,
    requireStackedEma:
      prevAdaptive.requireStackedEma ??
      baseCfg.REQUIRE_STACKED_EMA ??
      baseCfg.requireStackedEma ??
      false,
    requireNearEma20:
      prevAdaptive.requireNearEma20 ??
      baseCfg.REQUIRE_NEAR_EMA20 ??
      baseCfg.requireNearEma20 ??
      false,
    requireRsiRising:
      prevAdaptive.requireRsiRising ??
      baseCfg.REQUIRE_RSI_RISING ??
      baseCfg.requireRsiRising ??
      false,
    requireSr:
      prevAdaptive.requireSr ??
      baseCfg.REQUIRE_SR ??
      baseCfg.requireSr ??
      false,
    minSpaceToTargetAtr:
      prevAdaptive.minSpaceToTargetAtr ??
      baseCfg.MIN_SPACE_TO_TARGET_ATR ??
      baseCfg.minSpaceToTargetAtr ??
      0.8,
    maxDistanceFromSupportAtr:
      prevAdaptive.maxDistanceFromSupportAtr ??
      baseCfg.MAX_DISTANCE_FROM_SUPPORT_ATR ??
      baseCfg.maxDistanceFromSupportAtr ??
      1.2,
    tpResistanceBufferAtr:
      prevAdaptive.tpResistanceBufferAtr ??
      baseCfg.TP_RESISTANCE_BUFFER_ATR ??
      baseCfg.tpResistanceBufferAtr ??
      0.15,
    minTpDistancePct:
      prevAdaptive.minTpDistancePct ??
      baseCfg.MIN_TP_DISTANCE_PCT ??
      baseCfg.minTpDistancePct ??
      0.0015,
    minTpAtrMult:
      prevAdaptive.minTpAtrMult ??
      baseCfg.MIN_TP_ATR_MULT ??
      baseCfg.minTpAtrMult ??
      0.35,
    entryProjectionAtrMult:
      prevAdaptive.entryProjectionAtrMult ??
      baseCfg.ENTRY_PROJECTION_ATR_MULT ??
      baseCfg.entryProjectionAtrMult ??
      0.08,
  };

  const next = { ...current };
  const reasons = [];

  if (stats.resolved < globals.minClosedTradesForUpdate) {
    reasons.push("insufficient_sample");
    return {
      symbol,
      stats,
      config: next,
      reasons,
    };
  }

  if (
    stats.avgSlippagePct > globals.maxAllowedSlippagePct ||
    stats.avgLatencyTotal > globals.maxAllowedLatencyMs
  ) {
    next.enabled = false;
    reasons.push("microstructure_guard");
  } else if (stats.avgR < globals.disableBelowAvgR) {
    next.enabled = false;
    reasons.push("avgR_below_disable_threshold");
  } else {
    next.enabled = true;
    reasons.push("keep_learning");
  }

  const scoreCandidates = thresholdStats(trades, "score", [55, 60, 65, 70, 75]);
  const bestScore = pickBestThreshold(
    scoreCandidates,
    globals.minClosedTradesForUpdate,
    stats.avgR
  );

  if (bestScore) {
    next.minScore = stepToward(
      current.minScore,
      bestScore.threshold,
      globals.maxScoreStepPerCycle
    );
    reasons.push(`score_target_${bestScore.threshold}`);
  }

  const rsiCandidates = bucketStats(trades, "rsi", [0, 35, 40, 45, 50, 55, 60, 100]);
  const bestRsiBucket = pickBestBucket(
    rsiCandidates,
    globals.minClosedTradesForUpdate
  );

  if (bestRsiBucket) {
    next.rsiMin = stepToward(
      current.rsiMin,
      bestRsiBucket.bucketMin,
      globals.maxRsiStepPerCycle
    );
    next.rsiMax = stepToward(
      current.rsiMax,
      bestRsiBucket.bucketMax,
      globals.maxRsiStepPerCycle
    );
    reasons.push(`rsi_bucket_${bestRsiBucket.label}`);
  }

  const adxCandidates = thresholdStats(trades, "adx", [8, 10, 12, 15, 20, 25]);
  const bestAdx = pickBestThreshold(
    adxCandidates,
    globals.minClosedTradesForUpdate,
    stats.avgR
  );

  if (bestAdx) {
    next.minAdx = stepToward(
      current.minAdx,
      bestAdx.threshold,
      globals.maxAdxStepPerCycle
    );
    reasons.push(`adx_target_${bestAdx.threshold}`);
  }

  const trendStats = boolStats(trades, "isTrend");
  const rangeStats = boolStats(trades, "isRange");

  const trendOK = trendStats.trueStats.resolved >= globals.minClosedTradesForUpdate;
  const rangeOK = rangeStats.trueStats.resolved >= globals.minClosedTradesForUpdate;

  if (trendOK || rangeOK) {
    const trendR = trendStats.trueStats.avgR;
    const rangeR = rangeStats.trueStats.avgR;

    if (rangeOK && rangeR > trendR + 0.12) {
      next.requireRange = true;
      next.requireTrend = false;
      reasons.push("prefer_range_regime");
    } else if (trendOK && trendR > rangeR + 0.12) {
      next.requireTrend = true;
      next.requireRange = false;
      reasons.push("prefer_trend_regime");
    } else {
      next.requireTrend = false;
      next.requireRange = false;
      reasons.push("no_strong_regime_edge");
    }
  }

  const nearPullbackStats = boolStats(trades, "nearPullback");
  if (
    nearPullbackStats.trueStats.resolved >= globals.minClosedTradesForUpdate &&
    nearPullbackStats.trueStats.avgR > nearPullbackStats.falseStats.avgR + 0.12
  ) {
    next.requireNearPullback = true;
    reasons.push("require_nearPullback");
  } else {
    next.requireNearPullback = false;
  }

  const stackedEmaStats = boolStats(trades, "stackedEma");
  if (
    stackedEmaStats.trueStats.resolved >= globals.minClosedTradesForUpdate &&
    stackedEmaStats.trueStats.avgR > stackedEmaStats.falseStats.avgR + 0.12
  ) {
    next.requireStackedEma = true;
    reasons.push("require_stackedEma");
  } else {
    next.requireStackedEma = false;
  }

  const nearEma20Stats = boolStats(trades, "nearEma20");
  if (
    nearEma20Stats.trueStats.resolved >= globals.minClosedTradesForUpdate &&
    nearEma20Stats.trueStats.avgR > nearEma20Stats.falseStats.avgR + 0.12
  ) {
    next.requireNearEma20 = true;
    reasons.push("require_nearEma20");
  } else {
    next.requireNearEma20 = false;
  }

  const rsiRisingStats = boolStats(trades, "rsiRising");
  if (
    rsiRisingStats.trueStats.resolved >= globals.minClosedTradesForUpdate &&
    rsiRisingStats.trueStats.avgR > rsiRisingStats.falseStats.avgR + 0.12
  ) {
    next.requireRsiRising = true;
    reasons.push("require_rsiRising");
  } else {
    next.requireRsiRising = false;
  }

  const srPassedStats = boolStats(trades, "srPassed");
  if (
    srPassedStats.trueStats.resolved >= globals.minClosedTradesForUpdate &&
    srPassedStats.trueStats.avgR > srPassedStats.falseStats.avgR + 0.08
  ) {
    next.requireSr = true;
    reasons.push("require_sr");
  } else if (srPassedStats.falseStats.resolved >= globals.minClosedTradesForUpdate) {
    next.requireSr = false;
  }

  const srSpaceCandidates = thresholdStats(
    trades.filter((t) => typeof t.distanceToResistanceAtr === "number"),
    "distanceToResistanceAtr",
    [0.6, 0.8, 1.0, 1.2, 1.5]
  );
  const bestSrSpace = pickBestThreshold(
    srSpaceCandidates,
    globals.minClosedTradesForUpdate,
    stats.avgR
  );

  if (bestSrSpace) {
    next.minSpaceToTargetAtr = Math.max(
      0.5,
      Math.min(1.6, Number(bestSrSpace.threshold))
    );
    reasons.push(`sr_space_target_${bestSrSpace.threshold}`);
  }

  const supportDistanceBuckets = bucketStats(
    trades.filter((t) => typeof t.distanceToSupportAtr === "number"),
    "distanceToSupportAtr",
    [0, 0.4, 0.8, 1.2, 1.6, 3]
  );
  const bestSupportBucket = pickBestBucket(
    supportDistanceBuckets,
    globals.minClosedTradesForUpdate
  );

  if (bestSupportBucket) {
    next.maxDistanceFromSupportAtr = clamp(
      bestSupportBucket.bucketMax,
      0.8,
      1.8
    );
    reasons.push(`support_dist_bucket_${bestSupportBucket.label}`);
  }

  const tpCapStats = valueStats(trades, "tpCappedByResistance", [true, false]);
  const bestTpCap = pickBestValue(
    tpCapStats,
    globals.minClosedTradesForUpdate,
    stats.avgR
  );

  if (bestTpCap) {
    next.requireSr = true;
    reasons.push(`tp_cap_pref_${String(bestTpCap.value)}`);
  }

  const tpDistancePctCandidates = thresholdStats(
    trades.filter((t) => typeof t.tpDistancePct === "number"),
    "tpDistancePct",
    [0.0010, 0.0015, 0.0020, 0.0025, 0.0030]
  );
  const bestTpDistancePct = pickBestThreshold(
    tpDistancePctCandidates,
    globals.minClosedTradesForUpdate,
    stats.avgR
  );

  if (bestTpDistancePct) {
    next.minTpDistancePct = clamp(bestTpDistancePct.threshold, 0.0010, 0.0030);
    reasons.push(`min_tp_distance_pct_${bestTpDistancePct.threshold}`);
  }

  const tpDistanceAtrCandidates = thresholdStats(
    trades.filter((t) => typeof t.tpDistanceAtr === "number"),
    "tpDistanceAtr",
    [0.25, 0.35, 0.5, 0.7, 1.0]
  );
  const bestTpDistanceAtr = pickBestThreshold(
    tpDistanceAtrCandidates,
    globals.minClosedTradesForUpdate,
    stats.avgR
  );

  if (bestTpDistanceAtr) {
    next.minTpAtrMult = clamp(bestTpDistanceAtr.threshold, 0.25, 1.0);
    reasons.push(`min_tp_atr_mult_${bestTpDistanceAtr.threshold}`);
  }

  const projectionGapTrades = trades
    .map((t) => {
      const rawEntry = typeof t.rawEntry === "number" ? t.rawEntry : null;
      const projectedEntry =
        typeof t.projectedEntry === "number" ? t.projectedEntry : null;

      if (
        rawEntry == null ||
        projectedEntry == null ||
        rawEntry <= 0 ||
        !Number.isFinite(rawEntry) ||
        !Number.isFinite(projectedEntry)
      ) {
        return null;
      }

      return {
        ...t,
        entryProjectionPct: (projectedEntry - rawEntry) / rawEntry,
      };
    })
    .filter(Boolean);

  const projectionBuckets = bucketStats(
    projectionGapTrades,
    "entryProjectionPct",
    [0, 0.0003, 0.0006, 0.0010, 0.0020]
  );
  const bestProjectionBucket = pickBestBucket(
    projectionBuckets,
    globals.minClosedTradesForUpdate
  );

  if (bestProjectionBucket) {
    next.entryProjectionAtrMult = clamp(
      bestProjectionBucket.bucketMax,
      0.02,
      0.20
    );
    reasons.push(`entry_projection_atr_mult_${bestProjectionBucket.bucketMax}`);
  }

  next.minScore = clamp(next.minScore, 55, 75);
  next.rsiMin = clamp(next.rsiMin, 30, 60);
  next.rsiMax = clamp(next.rsiMax, 40, 65);
  next.minAdx = clamp(next.minAdx, 8, 25);
  next.minSpaceToTargetAtr = clamp(next.minSpaceToTargetAtr, 0.5, 1.6);
  next.maxDistanceFromSupportAtr = clamp(next.maxDistanceFromSupportAtr, 0.8, 1.8);
  next.tpResistanceBufferAtr = clamp(next.tpResistanceBufferAtr, 0.05, 0.35);
  next.minTpDistancePct = clamp(next.minTpDistancePct, 0.0010, 0.0030);
  next.minTpAtrMult = clamp(next.minTpAtrMult, 0.25, 1.0);
  next.entryProjectionAtrMult = clamp(next.entryProjectionAtrMult, 0.02, 0.20);

  if (next.rsiMin >= next.rsiMax) {
    next.rsiMin = Math.max(30, next.rsiMax - 5);
    reasons.push("rsi_bounds_repaired");
  }

  return {
    symbol,
    stats,
    config: next,
    reasons,
    diagnostics: {
      scoreCandidates,
      rsiCandidates,
      adxCandidates,
      trendStats,
      rangeStats,
      nearPullbackStats,
      stackedEmaStats,
      nearEma20Stats,
      rsiRisingStats,
      srPassedStats,
      srSpaceCandidates,
      supportDistanceBuckets,
      tpCapStats,
      tpDistancePctCandidates,
      tpDistanceAtrCandidates,
      projectionBuckets,
    },
  };
}

function mergeForHistory(snapshot, previousHistory) {
  const arr = Array.isArray(previousHistory) ? previousHistory : [];
  arr.push(snapshot);
  return arr.slice(-200);
}

function main() {
  const trades = readJson(CONSOLIDATED_FILE, []);
  const baseConfig = readJson(BASE_CONFIG_FILE, {});
  const prevAdaptive = readJson(ADAPTIVE_CONFIG_FILE, {
    generatedAt: null,
    mode: DEFAULTS.mode,
    global: { ...DEFAULTS },
    symbols: {},
  });
  const prevHistory = readJson(ADAPTIVE_HISTORY_FILE, []);

  if (!Array.isArray(trades)) {
    throw new Error("consolidated-trades.json deve ser um array.");
  }

  const resolvedTrades = trades.filter(isResolvedTrade);
  const symbols = Array.from(
    new Set(resolvedTrades.map((t) => t.symbol).filter(Boolean))
  ).sort();

  const globalStats = summarizeTrades(
    resolvedTrades.slice(-DEFAULTS.lookbackClosedTrades)
  );

  const adaptive = {
    generatedAt: Date.now(),
    mode: DEFAULTS.mode,
    global: {
      ...DEFAULTS,
      recentGlobalStats: globalStats,
    },
    symbols: {},
  };

  const historySnapshot = {
    generatedAt: adaptive.generatedAt,
    mode: adaptive.mode,
    global: adaptive.global,
    symbols: {},
  };

  for (const symbol of symbols) {
    const recentTrades = getRecentTradesBySymbol(
      resolvedTrades,
      symbol,
      DEFAULTS.lookbackClosedTrades
    );

    const result = decideSymbolConfig(
      symbol,
      recentTrades,
      getBaseSymbolConfig(baseConfig, symbol),
      getPrevAdaptiveSymbolConfig(prevAdaptive, symbol),
      DEFAULTS
    );

    adaptive.symbols[symbol] = {
      enabled: result.config.enabled,
      MIN_SCORE: result.config.minScore,
      RSI_MIN: result.config.rsiMin,
      RSI_MAX: result.config.rsiMax,
      MIN_ADX: result.config.minAdx,
      REQUIRE_TREND: result.config.requireTrend,
      REQUIRE_RANGE: result.config.requireRange,
      REQUIRE_NEAR_PULLBACK: result.config.requireNearPullback,
      REQUIRE_STACKED_EMA: result.config.requireStackedEma,
      REQUIRE_NEAR_EMA20: result.config.requireNearEma20,
      REQUIRE_RSI_RISING: result.config.requireRsiRising,
      REQUIRE_SR: result.config.requireSr,
      MIN_SPACE_TO_TARGET_ATR: result.config.minSpaceToTargetAtr,
      MAX_DISTANCE_FROM_SUPPORT_ATR: result.config.maxDistanceFromSupportAtr,
      TP_RESISTANCE_BUFFER_ATR: result.config.tpResistanceBufferAtr,
      MIN_TP_DISTANCE_PCT: result.config.minTpDistancePct,
      MIN_TP_ATR_MULT: result.config.minTpAtrMult,
      ENTRY_PROJECTION_ATR_MULT: result.config.entryProjectionAtrMult,
      reason: result.reasons.join(",") || "no_change",
      stats: result.stats,
    };

    historySnapshot.symbols[symbol] = {
      config: result.config,
      reasons: result.reasons,
      stats: result.stats,
      diagnostics: result.diagnostics,
    };
  }

  const enabledSymbols = Object.entries(adaptive.symbols)
    .filter(([, cfg]) => cfg.enabled === true)
    .map(([symbol]) => symbol);

  if (enabledSymbols.length === 0) {
    let fallbackSymbol = null;
    let bestAvgR = -Infinity;

    for (const [symbol, cfg] of Object.entries(adaptive.symbols)) {
      const avgR = Number(cfg?.stats?.avgR ?? -999);
      if (avgR > bestAvgR) {
        bestAvgR = avgR;
        fallbackSymbol = symbol;
      }
    }

    if (fallbackSymbol) {
      adaptive.symbols[fallbackSymbol].enabled = true;
      adaptive.symbols[fallbackSymbol].reason =
        `${adaptive.symbols[fallbackSymbol].reason},forced_fallback_enable`;

      if (historySnapshot.symbols[fallbackSymbol]) {
        historySnapshot.symbols[fallbackSymbol].reasons.push(
          "forced_fallback_enable"
        );
      }
    }
  }

  writeJson(ADAPTIVE_CONFIG_FILE, adaptive);
  writeJson(
    ADAPTIVE_HISTORY_FILE,
    mergeForHistory(historySnapshot, prevHistory)
  );

  console.log("Adaptive config generated:", ADAPTIVE_CONFIG_FILE);
  console.log("Adaptive history updated:", ADAPTIVE_HISTORY_FILE);
  console.log("Symbols processed:", symbols.length);

  for (const symbol of symbols) {
    const row = adaptive.symbols[symbol];
    console.log(
      [
        symbol.padEnd(8),
        `enabled=${String(row.enabled).padEnd(5)}`,
        `minScore=${String(row.MIN_SCORE).padEnd(3)}`,
        `rsi=${String(row.RSI_MIN)}-${String(row.RSI_MAX)}`,
        `minAdx=${String(row.MIN_ADX).padEnd(2)}`,
        `trend=${String(row.REQUIRE_TREND).padEnd(5)}`,
        `range=${String(row.REQUIRE_RANGE).padEnd(5)}`,
        `pullback=${String(row.REQUIRE_NEAR_PULLBACK).padEnd(5)}`,
        `stacked=${String(row.REQUIRE_STACKED_EMA).padEnd(5)}`,
        `near20=${String(row.REQUIRE_NEAR_EMA20).padEnd(5)}`,
        `rsiRise=${String(row.REQUIRE_RSI_RISING).padEnd(5)}`,
        `sr=${String(row.REQUIRE_SR).padEnd(5)}`,
        `minSpace=${String(row.MIN_SPACE_TO_TARGET_ATR).padEnd(4)}`,
        `maxSupDist=${String(row.MAX_DISTANCE_FROM_SUPPORT_ATR).padEnd(4)}`,
        `tpBuf=${String(row.TP_RESISTANCE_BUFFER_ATR).padEnd(4)}`,
        `minTpPct=${String(row.MIN_TP_DISTANCE_PCT).padEnd(6)}`,
        `minTpAtr=${String(row.MIN_TP_ATR_MULT).padEnd(4)}`,
        `entryProj=${String(row.ENTRY_PROJECTION_ATR_MULT).padEnd(4)}`,
        `avgR=${row.stats.avgR.toFixed(4)}`,
        `resolved=${row.stats.resolved}`,
        `reason=${row.reason}`,
      ].join(" | ")
    );
  }
}

main();