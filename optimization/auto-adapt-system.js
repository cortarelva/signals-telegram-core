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
  mode: "balanced",
  lookbackClosedTrades: 3,
  minClosedTradesForUpdate: 12,
  minExpectedR: 0.0,
  disableBelowAvgR: -999,
  maxScoreStepPerCycle: 3,
  maxRsiStepPerCycle: 3,
  maxAdxStepPerCycle: 2,
  maxAllowedSlippagePct: 0.0015,
  maxAllowedLatencyMs: 1800,
  contextMinTradesPerBucket: 6,
};


// Recent-weighting for adaptive stats (prevents overreacting to old regimes)
const ADAPT_HALF_LIFE = Number(process.env.ADAPT_HALF_LIFE || 50); // trades

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


function computeDecayWeights(n, halfLife) {
  // Exponential decay weights: newest item gets highest weight.
  // halfLife is in "number of samples"; after halfLife steps, weight halves.
  if (!Number.isFinite(halfLife) || halfLife <= 0) return Array(n).fill(1);
  const lambda = Math.log(2) / halfLife;
  const w = new Array(n);
  for (let i = 0; i < n; i++) {
    // i=0 oldest, i=n-1 newest
    const age = (n - 1) - i;
    w[i] = Math.exp(-lambda * age);
  }
  return w;
}

function weightedMean(values, weights) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const w = weights[i];
    if (!Number.isFinite(v) || !Number.isFinite(w)) continue;
    num += v * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

function weightedRate(bools, weights) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < bools.length; i++) {
    const b = bools[i] ? 1 : 0;
    const w = weights[i];
    if (!Number.isFinite(w)) continue;
    num += b * w;
    den += w;
  }
  return den > 0 ? num / den : null;
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

  // Ensure stable ordering for "recency" (oldest -> newest).
  const ordered = [...resolved].sort((a, b) => {
    const ta = Number(a.closedTs ?? a.closedAt ?? a.closeTs ?? a.closed) || 0;
    const tb = Number(b.closedTs ?? b.closedAt ?? b.closeTs ?? b.closed) || 0;
    if (ta !== tb) return ta - tb;
    const oa = Number(a.openTs ?? a.openAt ?? a.signalTs ?? a.opened) || 0;
    const ob = Number(b.openTs ?? b.openAt ?? b.signalTs ?? b.opened) || 0;
    return oa - ob;
  });

  const weights = computeDecayWeights(ordered.length, ADAPT_HALF_LIFE);

  const tp = ordered.filter((t) => t.outcome === "TP").length;
  const sl = ordered.filter((t) => t.outcome === "SL").length;

  const rr = ordered.map((t) => t.rrRealized);
  const pnl = ordered.map((t) => t.pnlPct);
  const slip = ordered.map((t) => t.slippagePct);
  const lat = ordered.map((t) => t.latencyTotal);
  const isWin = ordered.map((t) => t.outcome === "TP");

  const avgR = avg(rr);
  const avgPnlPct = avg(pnl);
  const avgSlippagePct = avg(slip);
  const avgLatencyTotal = avg(lat);

  const wAvgR = weightedMean(rr, weights);
  const wAvgPnlPct = weightedMean(pnl, weights);
  const wAvgSlippagePct = weightedMean(slip, weights);
  const wAvgLatencyTotal = weightedMean(lat, weights);
  const wWinrate = weightedRate(isWin, weights);

  return {
    trades: trades.length,
    resolved: ordered.length,
    tp,
    sl,

    // Classic stats
    winrate: ordered.length ? (tp / ordered.length) * 100 : 0,
    avgR: avgR ?? 0,
    avgPnlPct: avgPnlPct ?? 0,
    avgSlippagePct: avgSlippagePct ?? 0,
    avgLatencyTotal: avgLatencyTotal ?? 0,

    // Recent-weighted stats (used for decisions)
    wWinrate: wWinrate == null ? 0 : wWinrate * 100,
    wAvgR: wAvgR ?? 0,
    wAvgPnlPct: wAvgPnlPct ?? 0,
    wAvgSlippagePct: wAvgSlippagePct ?? 0,
    wAvgLatencyTotal: wAvgLatencyTotal ?? 0,
  };
}


function getRecentTradesBySymbol(trades, symbol, limit) {
  return trades
    .filter((t) => t.symbol === symbol && isResolvedTrade(t))
    .sort((a, b) => (a.closedTs || a.openTs || 0) - (b.closedTs || b.openTs || 0))
    .slice(-limit);
}

function thresholdStats(trades, selector, thresholds) {
  return thresholds.map((thr) => {
    const subset = trades.filter((t) => {
      const v = selector(t);
      return Number.isFinite(v) && v >= thr;
    });

    const s = summarizeTrades(subset);
    return {
      thr,
      ...s,
      // Use recent-weighted metrics for selection; keep raw for debugging.
      winrate_raw: s.winrate,
      avgR_raw: s.avgR,
      winrate: s.wWinrate,
      avgR: s.wAvgR,
    };
  });
}


function bucketStats(trades, selector, buckets) {
  const out = [];

  for (const b of buckets) {
    const subset = trades.filter((t) => {
      const v = selector(t);
      return Number.isFinite(v) && v >= b.min && v < b.max;
    });

    const s = summarizeTrades(subset);
    out.push({
      bucket: b,
      ...s,
      // Use recent-weighted metrics for selection; keep raw for debugging.
      winrate_raw: s.winrate,
      avgR_raw: s.avgR,
      winrate: s.wWinrate,
      avgR: s.wAvgR,
    });
  }

  return out;
}


function boolStats(trades, selector) {
  const t = trades.filter((x) => selector(x));
  const f = trades.filter((x) => !selector(x));

  const ts = summarizeTrades(t);
  const fs = summarizeTrades(f);

  return {
    trueStats: { ...ts, winrate_raw: ts.winrate, avgR_raw: ts.avgR, winrate: ts.wWinrate, avgR: ts.wAvgR },
    falseStats: { ...fs, winrate_raw: fs.winrate, avgR_raw: fs.avgR, winrate: fs.wWinrate, avgR: fs.wAvgR },
  };
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

function getBaseSymbolConfig(baseConfig, symbol) {
  return baseConfig?.[symbol] || baseConfig?.symbols?.[symbol] || {};
}

function getPrevAdaptiveSymbolConfig(prevAdaptive, symbol) {
  return prevAdaptive?.symbols?.[symbol] || {};
}

function currentBucketMidpoint(value, buckets) {
  if (!Number.isFinite(value)) return null;
  for (let i = 0; i < buckets.length - 1; i++) {
    const min = buckets[i];
    const max = buckets[i + 1];
    if (value >= min && value < max) {
      return (min + max) / 2;
    }
  }
  return null;
}

function adjustScoreFromContext({
  trades,
  stats,
  currentMinScore,
  globals,
  reasons,
  contextInfo,
}) {
  let targetScore = currentMinScore;

  const volBuckets = [0, 0.7, 1.0, 1.3, 2.0, 999];
  const atrBuckets = [0, 0.0005, 0.0010, 0.0015, 0.0025, 999];
  const slopeBuckets = [0, 0.00003, 0.00007, 0.00012, 0.00025, 999];
  const sepBuckets = [0, 0.0010, 0.0020, 0.0040, 0.0070, 999];

  const contexts = [
    {
      name: "relativeVol",
      field: "relativeVol",
      buckets: volBuckets,
      currentValue: avg(trades.map((t) => t.relativeVol)),
    },
    {
      name: "atrPct",
      field: "atrPct",
      buckets: atrBuckets,
      currentValue: avg(trades.map((t) => t.atrPct)),
    },
    {
      name: "emaSlopePct",
      field: "emaSlopePct",
      buckets: slopeBuckets,
      currentValue: avg(trades.map((t) => t.emaSlopePct)),
    },
    {
      name: "emaSeparationPct",
      field: "emaSeparationPct",
      buckets: sepBuckets,
      currentValue: avg(trades.map((t) => t.emaSeparationPct)),
    },
  ];

  for (const ctx of contexts) {
    const statsByBucket = bucketStats(trades, ctx.field, ctx.buckets);
    const best = pickBestBucket(statsByBucket, globals.contextMinTradesPerBucket);

    contextInfo[ctx.name] = {
      currentValue: ctx.currentValue ?? null,
      best: best || null,
      buckets: statsByBucket,
    };

    if (!best) continue;
    if (best.avgR <= stats.wAvgR + 0.05) continue;

    const currentMid = currentBucketMidpoint(ctx.currentValue, ctx.buckets);
    const bestMid = (best.bucketMin + best.bucketMax) / 2;

    if (!Number.isFinite(currentMid)) continue;

    const distanceRatio =
      Math.abs(bestMid - currentMid) / Math.max(Math.abs(bestMid), 1e-9);

    if (distanceRatio > 0.5) {
      targetScore += 1;
      reasons.push(`context_${ctx.name}_far_from_best`);
    } else if (distanceRatio < 0.2) {
      targetScore -= 1;
      reasons.push(`context_${ctx.name}_near_best`);
    }
  }

  return clamp(targetScore, 55, 65);
}

function decideSymbolConfig(symbol, trades, baseCfg, prevAdaptive, globals) {
  const stats = summarizeTrades(trades);

  const current = {
    enabled: prevAdaptive.enabled ?? baseCfg.ENABLED ?? true,
    minScore:
      prevAdaptive.minScore ??
      baseCfg.MIN_SCORE ??
      baseCfg.minScore ??
      60,
    rsiMin:
      prevAdaptive.rsiMin ??
      baseCfg.RSI_MIN ??
      baseCfg.rsiMin ??
      35,
    rsiMax:
      prevAdaptive.rsiMax ??
      baseCfg.RSI_MAX ??
      baseCfg.rsiMax ??
      55,
    minAdx:
      prevAdaptive.minAdx ??
      baseCfg.MIN_ADX ??
      baseCfg.minAdx ??
      5,
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
      true,
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
  };

  const next = { ...current };
  const reasons = [];
  const contextInfo = {};

  if (stats.resolved < globals.minClosedTradesForUpdate) {
    next.enabled = true;
    next.requireTrend = false;
    next.requireRange = false;
    next.requireNearPullback = false;
    next.requireStackedEma = false;
    next.requireNearEma20 = false;
    next.requireRsiRising = false;
    reasons.push("insufficient_sample_soft_defaults");
    return { symbol, stats, config: next, reasons, contextInfo };
  }

  next.enabled = true;

  if (
    stats.wAvgSlippagePct > globals.maxAllowedSlippagePct ||
    stats.wAvgLatencyTotal > globals.maxAllowedLatencyMs
  ) {
    reasons.push("microstructure_warning");
  }

  if (stats.wAvgR < globals.disableBelowAvgR) {
    next.minScore = Math.min((next.minScore || 60) + 2, 65);
    next.minAdx = Math.min((next.minAdx || 5) + 1, 18);
    next.requireTrend = false;
    next.requireRange = false;
    reasons.push("avgR_bad_stricter_filters");
  } else {
    reasons.push("keep_learning");
  }

  const scoreCandidates = thresholdStats(trades, "score", [55, 60, 65, 70]);
  const bestScore = pickBestThreshold(
    scoreCandidates,
    globals.minClosedTradesForUpdate,
    stats.wAvgR
  );

  if (bestScore) {
    next.minScore = stepToward(
      current.minScore,
      Math.min(bestScore.threshold, 65),
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

  const adxCandidates = thresholdStats(trades, "adx", [5, 8, 10, 12, 15, 18]);
  const bestAdx = pickBestThreshold(
    adxCandidates,
    globals.minClosedTradesForUpdate,
    stats.wAvgR
  );

  if (bestAdx) {
    next.minAdx = stepToward(
      current.minAdx,
      bestAdx.threshold,
      globals.maxAdxStepPerCycle
    );
    reasons.push(`adx_target_${bestAdx.threshold}`);
  }

  next.requireTrend = false;
  next.requireRange = false;
  reasons.push("no_forced_regime");

  const allowExtraRestrictions = stats.wAvgR > -0.10;

  const nearPullbackStats = boolStats(trades, "nearPullback");
  if (
    allowExtraRestrictions &&
    nearPullbackStats.trueStats.resolved >= globals.minClosedTradesForUpdate &&
    nearPullbackStats.trueStats.avgR > nearPullbackStats.falseStats.avgR + 0.25
  ) {
    next.requireNearPullback = true;
    reasons.push("require_nearPullback");
  } else {
    next.requireNearPullback = false;
  }

  const stackedEmaStats = boolStats(trades, "stackedEma");
  if (
    allowExtraRestrictions &&
    stackedEmaStats.trueStats.resolved >= globals.minClosedTradesForUpdate &&
    stackedEmaStats.trueStats.avgR > stackedEmaStats.falseStats.avgR + 0.30
  ) {
    next.requireStackedEma = true;
    reasons.push("require_stackedEma");
  } else {
    next.requireStackedEma = false;
  }

  const nearEma20Stats = boolStats(trades, "nearEma20");
  if (
    allowExtraRestrictions &&
    nearEma20Stats.trueStats.resolved >= globals.minClosedTradesForUpdate &&
    nearEma20Stats.trueStats.avgR > nearEma20Stats.falseStats.avgR + 0.25
  ) {
    next.requireNearEma20 = true;
    reasons.push("require_nearEma20");
  } else {
    next.requireNearEma20 = false;
  }

  const rsiRisingStats = boolStats(trades, "rsiRising");
  if (
    allowExtraRestrictions &&
    rsiRisingStats.trueStats.resolved >= globals.minClosedTradesForUpdate &&
    rsiRisingStats.trueStats.avgR > rsiRisingStats.falseStats.avgR + 0.25
  ) {
    next.requireRsiRising = true;
    reasons.push("require_rsiRising");
  } else {
    next.requireRsiRising = false;
  }

  next.requireSr = true;

  const activeRestrictions = [
    next.requireNearPullback,
    next.requireStackedEma,
    next.requireNearEma20,
    next.requireRsiRising,
  ].filter(Boolean).length;

  if (activeRestrictions > 2) {
    next.requireNearPullback = false;
    next.requireStackedEma = false;
    next.requireNearEma20 = false;
    next.requireRsiRising = false;
    reasons.push("restriction_cap_applied");
  }

  const contextAdjustedScore = adjustScoreFromContext({
    trades,
    stats,
    currentMinScore: next.minScore,
    globals,
    reasons,
    contextInfo,
  });

  next.minScore = stepToward(
    next.minScore,
    contextAdjustedScore,
    globals.maxScoreStepPerCycle
  );

  next.minScore = clamp(next.minScore, 55, 65);
  next.rsiMin = clamp(next.rsiMin, 35, 55);
  next.rsiMax = clamp(next.rsiMax, 45, 65);
  next.minAdx = clamp(next.minAdx, 5, 18);
  next.minSpaceToTargetAtr = clamp(next.minSpaceToTargetAtr, 0.5, 1.2);
  next.maxDistanceFromSupportAtr = clamp(next.maxDistanceFromSupportAtr, 1.0, 1.8);
  next.tpResistanceBufferAtr = clamp(next.tpResistanceBufferAtr, 0.05, 0.35);

  if (next.rsiMin >= next.rsiMax) {
    next.rsiMin = Math.max(35, next.rsiMax - 8);
    reasons.push("rsi_bounds_repaired");
  }

  return {
    symbol,
    stats,
    config: next,
    reasons,
    contextInfo,
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
      ...result.config,
      reason: result.reasons.join(",") || "no_change",
      stats: result.stats,
      context: result.contextInfo,
    };

    historySnapshot.symbols[symbol] = {
      config: result.config,
      reasons: result.reasons,
      stats: result.stats,
      context: result.contextInfo,
    };
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
        `minScore=${String(row.minScore).padEnd(3)}`,
        `rsi=${String(row.rsiMin)}-${String(row.rsiMax)}`,
        `minAdx=${String(row.minAdx).padEnd(2)}`,
        `trend=${String(row.requireTrend).padEnd(5)}`,
        `range=${String(row.requireRange).padEnd(5)}`,
        `pullback=${String(row.requireNearPullback).padEnd(5)}`,
        `stacked=${String(row.requireStackedEma).padEnd(5)}`,
        `near20=${String(row.requireNearEma20).padEnd(5)}`,
        `rsiRise=${String(row.requireRsiRising).padEnd(5)}`,
        `sr=${String(row.requireSr).padEnd(5)}`,
        `minSpace=${String(row.minSpaceToTargetAtr).padEnd(4)}`,
        `maxSupDist=${String(row.maxDistanceFromSupportAtr).padEnd(4)}`,
        `tpBuf=${String(row.tpResistanceBufferAtr).padEnd(4)}`,
        `avgR=${row.stats.wAvgR.toFixed(4)}`,
        `resolved=${row.stats.resolved}`,
        `reason=${row.reason}`,
      ].join(" | ")
    );
  }
}

main();