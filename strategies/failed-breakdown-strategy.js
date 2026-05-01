const { clamp } = require("../indicators/market-indicators");

function classifySignal(score, minExecutableScore = 80) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function evaluateFailedBreakdownStrategy(ctx) {
  const { cfg, indicators, candles, nearestResistance, helpers } = ctx;

  const trapCfg = cfg.FAILED_BREAKDOWN || cfg.BEAR_TRAP || {};
  const enabled = trapCfg.enabled !== false;

  const minScore = Number(
    trapCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(62, helpers.paperMinScore)
  );
  const minAdx = Number(trapCfg.minAdx ?? 0);
  const maxAdx = Number(trapCfg.maxAdx ?? 22);

  const maxRsi = Number(trapCfg.maxRsi ?? 52);
  const minRsiRecovery = Number(trapCfg.minRsiRecovery ?? 1.0);

  const lookbackCandles = Number(trapCfg.lookbackCandles ?? 10);
  const minBreakAtr = Number(trapCfg.minBreakAtr ?? 0.10);
  const minRecoveryCloseAtr = Number(trapCfg.minRecoveryCloseAtr ?? 0.10);
  const minBullBodyAtr = Number(trapCfg.minBullBodyAtr ?? 0.10);
  const minLowerWickAtr = Number(trapCfg.minLowerWickAtr ?? 0.15);

  const requireVolume = trapCfg.requireVolume ?? true;
  const minRelativeVolume = Number(trapCfg.minRelativeVolume ?? 1.05);

  const slAtrMult = Number(trapCfg.slAtrMult ?? 1.15);
  const tpAtrMult = Number(trapCfg.tpAtrMult ?? 1.9);
  const minPlannedRr = Number(trapCfg.minPlannedRr ?? 1.0);
  const tpResistanceBufferAtr = Number(
    trapCfg.tpResistanceBufferAtr ??
      cfg.FAILED_BREAKDOWN_TP_RESISTANCE_BUFFER_ATR ??
      cfg.TP_RESISTANCE_BUFFER_ATR ??
      0.18
  );
  const minRrAfterCap = Number(
    trapCfg.minRrAfterCap ??
      cfg.FAILED_BREAKDOWN_MIN_RR_AFTER_CAP ??
      cfg.MIN_RR_AFTER_CAP ??
      0.8
  );
  const minTpPctAfterCap = Number(
    trapCfg.minTpPctAfterCap ??
      cfg.FAILED_BREAKDOWN_MIN_TP_PCT_AFTER_CAP ??
      cfg.MIN_TP_PCT_AFTER_CAP ??
      0.0013
  );
  const minTpAtrAfterCap = Number(
    trapCfg.minTpAtrAfterCap ??
      cfg.FAILED_BREAKDOWN_MIN_TP_ATR_AFTER_CAP ??
      cfg.MIN_TP_ATR_AFTER_CAP ??
      0.60
  );

  if (!enabled || !Array.isArray(candles) || candles.length < lookbackCandles + 2) {
    return {
      strategy: "failedBreakdown",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "failedBreakdown:not_enough_context",
      meta: {},
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const refCandles = candles.slice(-(lookbackCandles + 1), -1);

  const previousRangeLow = Math.min(...refCandles.map((c) => Number(c.low)));
  const previousRangeHigh = Math.max(...refCandles.map((c) => Number(c.high)));

  const breakDepthAtr =
    indicators.atr > 0 ? (previousRangeLow - Number(last.low)) / indicators.atr : 0;

  const reclaimedLow = Number(last.close) > previousRangeLow;
  const closeRecoveryAtr =
    indicators.atr > 0 ? (Number(last.close) - previousRangeLow) / indicators.atr : 0;

  const body = Math.abs(Number(last.close) - Number(last.open));
  const bodyAtr = indicators.atr > 0 ? body / indicators.atr : 0;

  const lowerWick =
    Math.min(Number(last.open), Number(last.close)) - Number(last.low);
  const lowerWickAtr = indicators.atr > 0 ? lowerWick / indicators.atr : 0;

  const relativeVol =
    indicators.avgVol > 0 ? Number(last.volume || 0) / indicators.avgVol : null;

  const rsiRecovery = Number(indicators.rsi) - Number(indicators.prevRsi);
  const reclaimAbovePrevClose = Number(last.close) > Number(prev.close);
  const closeBackInsideRange = Number(last.close) > previousRangeLow;
  const notTooExtended =
    Number(last.close) < previousRangeHigh &&
    Number(indicators.rsi) <= maxRsi;

  let score = 0;

  if (breakDepthAtr >= minBreakAtr) score += 25;
  if (reclaimedLow) score += 20;
  if (closeRecoveryAtr >= minRecoveryCloseAtr) score += 10;
  if (reclaimAbovePrevClose) score += 10;
  if (bodyAtr >= minBullBodyAtr) score += 10;
  if (lowerWickAtr >= minLowerWickAtr) score += 10;
  if (rsiRecovery >= minRsiRecovery) score += 10;
  if (Number(indicators.adx || 0) <= maxAdx) score += 5;
  if (Number.isFinite(relativeVol) && relativeVol >= minRelativeVolume) score += 10;

  score = clamp(score, 0, 100);
  const signalClass = classifySignal(score, minScore);

  const sl = helpers.round(
    Math.min(Number(last.low), indicators.entry - slAtrMult * indicators.atr),
    6
  );

  const rawTp = helpers.round(indicators.entry + tpAtrMult * indicators.atr, 6);
  const tpCandidates = [rawTp];

  if (
    Number.isFinite(Number(previousRangeHigh)) &&
    Number(previousRangeHigh) > Number(indicators.entry) &&
    Number.isFinite(Number(indicators.atr)) &&
    Number(indicators.atr) > 0
  ) {
    const rangeHighCap = helpers.round(
      Number(previousRangeHigh) - Number(indicators.atr) * tpResistanceBufferAtr,
      6
    );

    if (rangeHighCap > Number(indicators.entry)) {
      tpCandidates.push(rangeHighCap);
    }
  }

  if (
    nearestResistance &&
    Number.isFinite(Number(nearestResistance.price)) &&
    Number(nearestResistance.price) > Number(indicators.entry) &&
    Number.isFinite(Number(indicators.atr)) &&
    Number(indicators.atr) > 0
  ) {
    const resistanceCap = helpers.round(
      Number(nearestResistance.price) - Number(indicators.atr) * tpResistanceBufferAtr,
      6
    );

    if (resistanceCap > Number(indicators.entry)) {
      tpCandidates.push(resistanceCap);
    }
  }

  let tp = Math.min(...tpCandidates.filter((v) => Number.isFinite(Number(v)) && Number(v) > Number(indicators.entry)));
  if (!Number.isFinite(tp)) tp = rawTp;

  const tpCappedByResistance = Number(tp) < Number(rawTp);
  const risk = Math.abs(indicators.entry - sl);
  const reward = Math.abs(tp - indicators.entry);
  const plannedRr = helpers.safeRatio(reward, risk);
  const tpPctAfterCap = Number(indicators.entry) > 0 ? reward / Number(indicators.entry) : null;
  const tpAtrAfterCap = Number(indicators.atr) > 0 ? reward / Number(indicators.atr) : null;

  const allowed =
    enabled &&
    Number(indicators.adx || 0) >= minAdx &&
    Number(indicators.adx || 0) <= maxAdx &&
    breakDepthAtr >= minBreakAtr &&
    reclaimedLow &&
    closeBackInsideRange &&
    reclaimAbovePrevClose &&
    closeRecoveryAtr >= minRecoveryCloseAtr &&
    bodyAtr >= minBullBodyAtr &&
    lowerWickAtr >= minLowerWickAtr &&
    rsiRecovery >= minRsiRecovery &&
    notTooExtended &&
    (!requireVolume ||
      (Number.isFinite(relativeVol) && relativeVol >= minRelativeVolume)) &&
    signalClass === "EXECUTABLE" &&
    Number.isFinite(plannedRr) &&
    plannedRr >= minPlannedRr;

  if (!allowed) {
    let reason = "failedBreakdown:rules_not_met";

    if (breakDepthAtr < minBreakAtr) reason = "failedBreakdown:no_real_break";
    else if (!reclaimedLow) reason = "failedBreakdown:not_reclaimed";
    else if (!reclaimAbovePrevClose) reason = "failedBreakdown:no_close_strength";
    else if (closeRecoveryAtr < minRecoveryCloseAtr) reason = "failedBreakdown:weak_recovery";
    else if (bodyAtr < minBullBodyAtr) reason = "failedBreakdown:body_too_small";
    else if (lowerWickAtr < minLowerWickAtr) reason = "failedBreakdown:wick_too_small";
    else if (rsiRecovery < minRsiRecovery) reason = "failedBreakdown:rsi_not_recovering";
    else if (!notTooExtended) reason = "failedBreakdown:too_extended";
    else if (Number(indicators.adx || 0) > maxAdx) reason = "failedBreakdown:adx_too_high";
    else if (
      requireVolume &&
      (!Number.isFinite(relativeVol) || relativeVol < minRelativeVolume)
    ) {
      reason = "failedBreakdown:volume_too_low";
    } else if (!Number.isFinite(plannedRr) || plannedRr < minPlannedRr) {
      reason = "failedBreakdown:planned_rr_too_low";
    } else if (signalClass !== "EXECUTABLE") {
      reason = "failedBreakdown:not_executable";
    }

    return {
      strategy: "failedBreakdown",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason,
      meta: {
        previousRangeLow,
        previousRangeHigh,
        breakDepthAtr,
        closeRecoveryAtr,
        bodyAtr,
        lowerWickAtr,
        relativeVol,
        rsiRecovery,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  if (tpCappedByResistance && (!Number.isFinite(plannedRr) || plannedRr < minRrAfterCap)) {
    return {
      strategy: "failedBreakdown",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "failedBreakdown:tp_capped_rr_too_low",
      meta: {
        previousRangeLow,
        previousRangeHigh,
        breakDepthAtr,
        closeRecoveryAtr,
        bodyAtr,
        lowerWickAtr,
        relativeVol,
        rsiRecovery,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  if (tpCappedByResistance && (!Number.isFinite(tpPctAfterCap) || tpPctAfterCap < minTpPctAfterCap)) {
    return {
      strategy: "failedBreakdown",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "failedBreakdown:tp_after_cap_too_small_pct",
      meta: {
        previousRangeLow,
        previousRangeHigh,
        breakDepthAtr,
        closeRecoveryAtr,
        bodyAtr,
        lowerWickAtr,
        relativeVol,
        rsiRecovery,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  if (tpCappedByResistance && (!Number.isFinite(tpAtrAfterCap) || tpAtrAfterCap < minTpAtrAfterCap)) {
    return {
      strategy: "failedBreakdown",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "failedBreakdown:tp_after_cap_too_small_atr",
      meta: {
        previousRangeLow,
        previousRangeHigh,
        breakDepthAtr,
        closeRecoveryAtr,
        bodyAtr,
        lowerWickAtr,
        relativeVol,
        rsiRecovery,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  return {
    strategy: "failedBreakdown",
    direction: "LONG",
    allowed: true,
    score,
    signalClass,
    minScore,
    sl,
    tp,
    tpRawAtr: rawTp,
    tpCappedByResistance,
    reason: "selected",
    meta: {
      previousRangeLow,
      previousRangeHigh,
      breakDepthAtr,
      closeRecoveryAtr,
      bodyAtr,
      lowerWickAtr,
      relativeVol,
      rsiRecovery,
      plannedRr,
      tpPctAfterCap,
      tpAtrAfterCap,
      tpMode: tpCappedByResistance ? "structure_capped" : "atr_raw",
    },
  };
}

module.exports = { evaluateFailedBreakdownStrategy };
