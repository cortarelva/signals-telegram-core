const { clamp } = require("../indicators/market-indicators");

function classifySignal(score, minExecutableScore = 70) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function avg(values) {
  if (!Array.isArray(values) || !values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function highest(values) {
  return Math.max(...values.map((value) => Number(value || 0)));
}

function lowest(values) {
  return Math.min(...values.map((value) => Number(value || 0)));
}

function evaluateFlushReclaimLongStrategy(ctx) {
  const { cfg, indicators, candles, helpers } = ctx;

  const strategyCfg = cfg.FLUSH_RECLAIM_LONG || cfg.EARLY_EXPANSION_RECLAIM_LONG || {};
  const enabled = strategyCfg.enabled !== false;

  const minScore = Number(
    strategyCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(52, helpers.paperMinScore)
  );
  const flushLookback = Number(strategyCfg.flushLookback ?? 3);
  const minAdx = Number(strategyCfg.minAdx ?? 4);
  const maxAdx = Number(strategyCfg.maxAdx ?? 45);
  const minFlushRangeAtr = Number(strategyCfg.minFlushRangeAtr ?? 0.55);
  const maxFlushRangeAtr = Number(strategyCfg.maxFlushRangeAtr ?? 3.5);
  const minCloseLocation = Number(strategyCfg.minCloseLocation ?? 0.62);
  const minSignalVolRatio = Number(strategyCfg.minSignalVolRatio ?? 0.5);
  const maxSignalVolRatio = Number(strategyCfg.maxSignalVolRatio ?? 3.5);
  const minRsi = Number(strategyCfg.minRsi ?? 38);
  const maxRsi = Number(strategyCfg.maxRsi ?? 68);
  const minRsiRecovery = Number(strategyCfg.minRsiRecovery ?? 0);
  const minEntryVsEma20Atr = Number(strategyCfg.minEntryVsEma20Atr ?? -0.15);
  const maxEntryVsEma20Atr = Number(strategyCfg.maxEntryVsEma20Atr ?? 1.85);
  const minEntryVsEma50Atr = Number(strategyCfg.minEntryVsEma50Atr ?? -0.35);
  const maxEntryVsEma50Atr = Number(strategyCfg.maxEntryVsEma50Atr ?? 1.75);
  const flushBelowEma20Atr = Number(strategyCfg.flushBelowEma20Atr ?? 0.1);
  const slAtrBuffer = Number(strategyCfg.slAtrBuffer ?? 0.18);
  const tpAtrMult = Number(strategyCfg.tpAtrMult ?? 1.85);
  const minPlannedRr = Number(strategyCfg.minPlannedRr ?? 1.05);
  const minWeakCloseCount = Number(strategyCfg.minWeakCloseCount ?? 1);

  if (!enabled || !Array.isArray(candles) || candles.length < Math.max(50, flushLookback + 2)) {
    return {
      strategy: "flushReclaimLong",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "flushReclaimLong:not_enough_context",
      meta: {},
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const flushWindow = candles.slice(-(flushLookback + 1), -1);
  const avgVol20 =
    candles.length > 21
      ? avg(candles.slice(-21, -1).map((c) => Number(c.volume || 0)))
      : 0;

  const entry = Number(indicators.entry);
  const atr = Number(indicators.atr || 0);
  const adx = Number(indicators.adx || 0);
  const ema20 = Number(indicators.ema20 || 0);
  const ema50 = Number(indicators.ema50 || 0);
  const rsi = Number(indicators.rsi || 0);
  const prevRsi = Number(indicators.prevRsi || 0);

  const flushLow = lowest(flushWindow.map((c) => c.low));
  const flushHigh = highest(flushWindow.map((c) => c.high));
  const flushRangeAtr = atr > 0 ? (flushHigh - flushLow) / atr : null;
  const weakCloseCount = flushWindow.filter(
    (c) => Number(c.close) < Number(c.open) || Number(c.close) <= Number(c.low) + (Number(c.high) - Number(c.low)) * 0.4
  ).length;
  const closeLocation =
    Number(last.high) > Number(last.low)
      ? (Number(last.close) - Number(last.low)) /
        (Number(last.high) - Number(last.low))
      : 0;
  const signalVolRatio = avgVol20 > 0 ? Number(last.volume || 0) / avgVol20 : null;
  const entryVsEma20Atr = atr > 0 ? (entry - ema20) / atr : null;
  const entryVsEma50Atr = atr > 0 ? (entry - ema50) / atr : null;
  const rsiRecovery = rsi - prevRsi;
  const green = Number(last.close) > Number(last.open);
  const closeAbovePrevHigh = Number(last.close) > Number(prev.high);
  const closeAboveEma20 = Number(last.close) >= ema20;
  const prevBelowEma20 = Number(prev.close) <= ema20 + atr * 0.1;
  const flushBelowEma20 = atr > 0 ? flushLow <= ema20 - atr * flushBelowEma20Atr : false;
  const flushDetected =
    weakCloseCount >= minWeakCloseCount &&
    (Number(prev.low) < Number(flushWindow[Math.max(flushWindow.length - 2, 0)]?.low ?? prev.low) ||
      flushBelowEma20 ||
      indicators.nearPullback);
  const reclaimTriggered =
    green &&
    closeLocation >= minCloseLocation &&
    (closeAbovePrevHigh || (closeAboveEma20 && prevBelowEma20));

  let score = 0;
  if (flushDetected) score += 20;
  if (reclaimTriggered) score += 24;
  if (closeAbovePrevHigh) score += 10;
  if (closeAboveEma20) score += 8;
  if (indicators.nearPullback) score += 8;
  if (Number.isFinite(entryVsEma20Atr) && entryVsEma20Atr >= minEntryVsEma20Atr && entryVsEma20Atr <= maxEntryVsEma20Atr) score += 8;
  if (Number.isFinite(entryVsEma50Atr) && entryVsEma50Atr >= minEntryVsEma50Atr && entryVsEma50Atr <= maxEntryVsEma50Atr) score += 6;
  if (Number.isFinite(signalVolRatio) && signalVolRatio >= minSignalVolRatio && signalVolRatio <= maxSignalVolRatio) score += 5;
  if (Number.isFinite(flushRangeAtr) && flushRangeAtr >= minFlushRangeAtr && flushRangeAtr <= maxFlushRangeAtr) score += 5;
  if (rsi >= minRsi && rsi <= maxRsi) score += 4;
  if (rsiRecovery >= minRsiRecovery) score += 4;
  if (adx >= minAdx && adx <= maxAdx) score += 6;
  if (adx <= 24) score += 2;
  score = clamp(score, 0, 100);

  const signalClass = classifySignal(score, minScore);
  const sl = helpers.round(flushLow - slAtrBuffer * atr, 6);
  const minRewardAbs = Math.abs(entry - sl) * minPlannedRr;
  const tp = helpers.round(entry + Math.max(tpAtrMult * atr, minRewardAbs), 6);
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const plannedRr = helpers.safeRatio(reward, risk);
  const rrSatisfies = Number.isFinite(plannedRr) && plannedRr + 1e-9 >= minPlannedRr;
  const validRiskShape =
    Number.isFinite(entry) &&
    Number.isFinite(sl) &&
    Number.isFinite(tp) &&
    sl < entry &&
    tp > entry;

  const allowed =
    flushDetected &&
    reclaimTriggered &&
    Number.isFinite(flushRangeAtr) &&
    flushRangeAtr >= minFlushRangeAtr &&
    flushRangeAtr <= maxFlushRangeAtr &&
    Number.isFinite(signalVolRatio) &&
    signalVolRatio >= minSignalVolRatio &&
    signalVolRatio <= maxSignalVolRatio &&
    Number.isFinite(entryVsEma20Atr) &&
    entryVsEma20Atr >= minEntryVsEma20Atr &&
    entryVsEma20Atr <= maxEntryVsEma20Atr &&
    Number.isFinite(entryVsEma50Atr) &&
    entryVsEma50Atr >= minEntryVsEma50Atr &&
    entryVsEma50Atr <= maxEntryVsEma50Atr &&
    rsi >= minRsi &&
    rsi <= maxRsi &&
    rsiRecovery >= minRsiRecovery &&
    adx >= minAdx &&
    adx <= maxAdx &&
    validRiskShape &&
    signalClass === "EXECUTABLE" &&
    rrSatisfies;

  if (!allowed) {
    let reason = "flushReclaimLong:rules_not_met";

    if (!flushDetected) reason = "flushReclaimLong:no_recent_flush";
    else if (!reclaimTriggered) reason = "flushReclaimLong:reclaim_not_confirmed";
    else if (!Number.isFinite(flushRangeAtr) || flushRangeAtr < minFlushRangeAtr)
      reason = "flushReclaimLong:flush_too_small";
    else if (flushRangeAtr > maxFlushRangeAtr)
      reason = "flushReclaimLong:flush_too_wide";
    else if (
      !Number.isFinite(signalVolRatio) ||
      signalVolRatio < minSignalVolRatio ||
      signalVolRatio > maxSignalVolRatio
    )
      reason = "flushReclaimLong:signal_volume_invalid";
    else if (
      !Number.isFinite(entryVsEma20Atr) ||
      entryVsEma20Atr < minEntryVsEma20Atr ||
      entryVsEma20Atr > maxEntryVsEma20Atr
    )
      reason =
        entryVsEma20Atr < minEntryVsEma20Atr
          ? "flushReclaimLong:still_below_ema20"
          : "flushReclaimLong:too_extended_above_ema20";
    else if (
      !Number.isFinite(entryVsEma50Atr) ||
      entryVsEma50Atr < minEntryVsEma50Atr ||
      entryVsEma50Atr > maxEntryVsEma50Atr
    )
      reason =
        entryVsEma50Atr < minEntryVsEma50Atr
          ? "flushReclaimLong:still_below_ema50"
          : "flushReclaimLong:too_extended_above_ema50";
    else if (rsi < minRsi || rsi > maxRsi)
      reason = "flushReclaimLong:rsi_out_of_band";
    else if (rsiRecovery < minRsiRecovery)
      reason = "flushReclaimLong:rsi_not_recovering";
    else if (adx < minAdx || adx > maxAdx)
      reason = adx < minAdx ? "flushReclaimLong:adx_too_low" : "flushReclaimLong:adx_too_high";
    else if (!validRiskShape)
      reason = "flushReclaimLong:invalid_risk_shape";
    else if (signalClass !== "EXECUTABLE")
      reason = "flushReclaimLong:not_executable";
    else if (!rrSatisfies)
      reason = "flushReclaimLong:planned_rr_too_low";

    return {
      strategy: "flushReclaimLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason,
      meta: {
        flushLow,
        flushHigh,
        flushRangeAtr,
        weakCloseCount,
        closeLocation,
        signalVolRatio,
        entryVsEma20Atr,
        entryVsEma50Atr,
        rsiRecovery,
        plannedRr,
        flushDetected,
        reclaimTriggered,
      },
    };
  }

  return {
    strategy: "flushReclaimLong",
    direction: "LONG",
    allowed: true,
    score,
    signalClass,
    minScore,
    entry,
    sl,
    tp,
    reason: "selected",
    meta: {
      flushLow,
      flushHigh,
      flushRangeAtr,
      weakCloseCount,
      closeLocation,
      signalVolRatio,
      entryVsEma20Atr,
      entryVsEma50Atr,
      rsiRecovery,
      plannedRr,
      flushDetected,
      reclaimTriggered,
      closeAbovePrevHigh,
      closeAboveEma20,
    },
  };
}

module.exports = { evaluateFlushReclaimLongStrategy };
