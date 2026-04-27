const { clamp } = require("../indicators/market-indicators");

function classifySignal(score, minExecutableScore = 70) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function avg(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function highest(values) {
  return Math.max(...values.map((value) => Number(value || 0)));
}

function lowest(values) {
  return Math.min(...values.map((value) => Number(value || 0)));
}

function evaluateMicroBaseReclaimLongStrategy(ctx) {
  const { cfg, indicators, candles, nearestResistance, helpers } = ctx;

  const strategyCfg = cfg.MICRO_BASE_RECLAIM_LONG || cfg.EXPANSION_RECLAIM_LONG || {};
  const enabled = strategyCfg.enabled !== false;

  const minScore = Number(
    strategyCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(58, helpers.paperMinScore)
  );
  const baseLookback = Number(strategyCfg.baseLookback ?? 6);
  const minAdx = Number(strategyCfg.minAdx ?? 0);
  const maxAdx = Number(strategyCfg.maxAdx ?? 45);
  const minBaseRangeAtr = Number(strategyCfg.minBaseRangeAtr ?? 0.35);
  const maxBaseRangeAtr = Number(strategyCfg.maxBaseRangeAtr ?? 2.2);
  const maxBaseDriftAtr = Number(strategyCfg.maxBaseDriftAtr ?? 1.4);
  const nearBaseHighAtr = Number(strategyCfg.nearBaseHighAtr ?? 0.16);
  const breakoutBufferAtr = Number(strategyCfg.breakoutBufferAtr ?? 0.03);
  const maxDistanceAboveEma20Atr = Number(strategyCfg.maxDistanceAboveEma20Atr ?? 1.25);
  const maxBaseBelowEma20Atr = Number(strategyCfg.maxBaseBelowEma20Atr ?? 0.75);
  const minSignalVolRatio = Number(strategyCfg.minSignalVolRatio ?? 0.75);
  const maxSignalVolRatio = Number(strategyCfg.maxSignalVolRatio ?? 3.8);
  const minCloseLocation = Number(strategyCfg.minCloseLocation ?? 0.58);
  const minRsi = Number(strategyCfg.minRsi ?? 38);
  const maxRsi = Number(strategyCfg.maxRsi ?? 72);
  const minRsiRecovery = Number(strategyCfg.minRsiRecovery ?? 0);
  const slAtrMult = Number(strategyCfg.slAtrMult ?? 0.55);
  const tpAtrMult = Number(strategyCfg.tpAtrMult ?? 1.45);
  const minPlannedRr = Number(strategyCfg.minPlannedRr ?? 0.55);
  const tpResistanceBufferAtr = Number(
    strategyCfg.tpResistanceBufferAtr ??
      cfg.MICRO_BASE_RECLAIM_LONG_TP_RESISTANCE_BUFFER_ATR ??
      cfg.TP_RESISTANCE_BUFFER_ATR ??
      0.14
  );
  const minRrAfterCap = Number(
    strategyCfg.minRrAfterCap ??
      cfg.MICRO_BASE_RECLAIM_LONG_MIN_RR_AFTER_CAP ??
      cfg.MIN_RR_AFTER_CAP ??
      0.65
  );
  const minTpPctAfterCap = Number(
    strategyCfg.minTpPctAfterCap ??
      cfg.MICRO_BASE_RECLAIM_LONG_MIN_TP_PCT_AFTER_CAP ??
      cfg.MIN_TP_PCT_AFTER_CAP ??
      0.0009
  );

  if (!enabled || !Array.isArray(candles) || candles.length < Math.max(50, baseLookback + 2)) {
    return {
      strategy: "microBaseReclaimLong",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "microBaseReclaimLong:not_enough_context",
      meta: {},
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const baseWindow = candles.slice(-(baseLookback + 1), -1);
  const avgVol20 =
    candles.length > 21
      ? avg(candles.slice(-21, -1).map((c) => Number(c.volume || 0)))
      : 0;

  const entry = Number(indicators.entry);
  const atr = Number(indicators.atr || 0);
  const adx = Number(indicators.adx || 0);
  const ema20 = Number(indicators.ema20 || 0);
  const ema50 = Number(indicators.ema50 || 0);
  const ema200 = Number(indicators.ema200 || 0);
  const rsi = Number(indicators.rsi || 0);
  const prevRsi = Number(indicators.prevRsi || 0);

  const baseHigh = highest(baseWindow.map((c) => c.high));
  const baseLow = lowest(baseWindow.map((c) => c.low));
  const baseRange = baseHigh - baseLow;
  const baseRangeAtr = atr > 0 ? baseRange / atr : null;
  const baseFirstClose = Number(baseWindow[0]?.close || entry);
  const baseLastClose = Number(baseWindow[baseWindow.length - 1]?.close || entry);
  const baseDriftAtr = atr > 0 ? Math.abs(baseLastClose - baseFirstClose) / atr : null;
  const baseLowVsEma20Atr = atr > 0 ? (baseLow - ema20) / atr : null;
  const distanceAboveEma20Atr = atr > 0 ? (entry - ema20) / atr : null;
  const closeLocation =
    Number(last.high) > Number(last.low)
      ? (Number(last.close) - Number(last.low)) /
        (Number(last.high) - Number(last.low))
      : 0;
  const signalVolRatio = avgVol20 > 0 ? Number(last.volume || 0) / avgVol20 : null;
  const breakoutAboveBase = atr > 0 ? entry >= baseHigh + breakoutBufferAtr * atr : false;
  const reclaimNearBaseHigh =
    atr > 0 ? entry >= baseHigh - nearBaseHighAtr * atr : entry >= baseHigh;
  const bullishClose = Number(last.close) > Number(last.open) && Number(last.close) >= Number(prev.close);
  const rsiRecovery = rsi - prevRsi;
  const trendSupport =
    ema20 >= ema50 &&
    (ema50 >= ema200 || entry >= ema200 * 0.998) &&
    entry >= ema20;

  let score = 0;
  if (trendSupport) score += 14;
  if (Number.isFinite(baseRangeAtr) && baseRangeAtr >= minBaseRangeAtr && baseRangeAtr <= maxBaseRangeAtr) score += 14;
  if (Number.isFinite(baseDriftAtr) && baseDriftAtr <= maxBaseDriftAtr) score += 10;
  if (Number.isFinite(baseLowVsEma20Atr) && baseLowVsEma20Atr >= -maxBaseBelowEma20Atr) score += 10;
  if (Number.isFinite(distanceAboveEma20Atr) && distanceAboveEma20Atr <= maxDistanceAboveEma20Atr) score += 10;
  if (reclaimNearBaseHigh) score += 10;
  if (breakoutAboveBase) score += 10;
  if (bullishClose) score += 8;
  if (closeLocation >= minCloseLocation) score += 6;
  if (Number.isFinite(signalVolRatio) && signalVolRatio >= minSignalVolRatio && signalVolRatio <= maxSignalVolRatio) score += 8;
  if (rsi >= minRsi && rsi <= maxRsi) score += 6;
  if (rsiRecovery >= minRsiRecovery) score += 4;
  if (adx >= minAdx && adx <= maxAdx) score += 5;
  score = clamp(score, 0, 100);

  const signalClass = classifySignal(score, minScore);

  const sl = helpers.round(baseLow - slAtrMult * atr, 6);
  const rawTp = helpers.round(entry + tpAtrMult * atr, 6);
  let tp = rawTp;
  let tpCappedByResistance = false;

  if (
    nearestResistance &&
    Number.isFinite(Number(nearestResistance.price)) &&
    Number(nearestResistance.price) > entry &&
    atr > 0
  ) {
    const cappedTp = helpers.round(
      Number(nearestResistance.price) - atr * tpResistanceBufferAtr,
      6
    );
    if (cappedTp > entry && cappedTp < tp) {
      tp = cappedTp;
      tpCappedByResistance = true;
    }
  }

  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const plannedRr = helpers.safeRatio(reward, risk);
  const tpPctAfterCap = entry > 0 ? reward / entry : null;
  const validRiskShape =
    Number.isFinite(entry) &&
    Number.isFinite(sl) &&
    Number.isFinite(tp) &&
    sl < entry &&
    tp > entry;

  const allowed =
    trendSupport &&
    Number.isFinite(baseRangeAtr) &&
    baseRangeAtr >= minBaseRangeAtr &&
    baseRangeAtr <= maxBaseRangeAtr &&
    Number.isFinite(baseDriftAtr) &&
    baseDriftAtr <= maxBaseDriftAtr &&
    Number.isFinite(baseLowVsEma20Atr) &&
    baseLowVsEma20Atr >= -maxBaseBelowEma20Atr &&
    Number.isFinite(distanceAboveEma20Atr) &&
    distanceAboveEma20Atr <= maxDistanceAboveEma20Atr &&
    reclaimNearBaseHigh &&
    bullishClose &&
    closeLocation >= minCloseLocation &&
    Number.isFinite(signalVolRatio) &&
    signalVolRatio >= minSignalVolRatio &&
    signalVolRatio <= maxSignalVolRatio &&
    rsi >= minRsi &&
    rsi <= maxRsi &&
    rsiRecovery >= minRsiRecovery &&
    adx >= minAdx &&
    adx <= maxAdx &&
    validRiskShape &&
    signalClass === "EXECUTABLE" &&
    Number.isFinite(plannedRr) &&
    plannedRr >= minPlannedRr;

  if (!allowed) {
    let reason = "microBaseReclaimLong:rules_not_met";

    if (!trendSupport) reason = "microBaseReclaimLong:trend_support_missing";
    else if (!Number.isFinite(baseRangeAtr) || baseRangeAtr < minBaseRangeAtr)
      reason = "microBaseReclaimLong:base_too_small";
    else if (baseRangeAtr > maxBaseRangeAtr)
      reason = "microBaseReclaimLong:base_too_wide";
    else if (!Number.isFinite(baseDriftAtr) || baseDriftAtr > maxBaseDriftAtr)
      reason = "microBaseReclaimLong:base_drift_too_large";
    else if (!Number.isFinite(baseLowVsEma20Atr) || baseLowVsEma20Atr < -maxBaseBelowEma20Atr)
      reason = "microBaseReclaimLong:base_too_far_below_ema20";
    else if (
      !Number.isFinite(distanceAboveEma20Atr) ||
      distanceAboveEma20Atr > maxDistanceAboveEma20Atr
    )
      reason = "microBaseReclaimLong:too_extended_above_ema20";
    else if (!reclaimNearBaseHigh)
      reason = "microBaseReclaimLong:not_reclaiming_base_high";
    else if (!bullishClose)
      reason = "microBaseReclaimLong:weak_signal_candle";
    else if (closeLocation < minCloseLocation)
      reason = "microBaseReclaimLong:close_location_too_low";
    else if (
      !Number.isFinite(signalVolRatio) ||
      signalVolRatio < minSignalVolRatio ||
      signalVolRatio > maxSignalVolRatio
    )
      reason = "microBaseReclaimLong:signal_volume_invalid";
    else if (rsi < minRsi || rsi > maxRsi)
      reason = "microBaseReclaimLong:rsi_out_of_band";
    else if (rsiRecovery < minRsiRecovery)
      reason = "microBaseReclaimLong:rsi_not_recovering";
    else if (adx < minAdx || adx > maxAdx)
      reason = adx < minAdx ? "microBaseReclaimLong:adx_too_low" : "microBaseReclaimLong:adx_too_high";
    else if (!validRiskShape)
      reason = "microBaseReclaimLong:invalid_risk_shape";
    else if (signalClass !== "EXECUTABLE")
      reason = "microBaseReclaimLong:not_executable";
    else if (!Number.isFinite(plannedRr) || plannedRr < minPlannedRr)
      reason = "microBaseReclaimLong:planned_rr_too_low";

    return {
      strategy: "microBaseReclaimLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason,
      meta: {
        trendSupport,
        baseHigh,
        baseLow,
        baseRangeAtr,
        baseDriftAtr,
        baseLowVsEma20Atr,
        distanceAboveEma20Atr,
        reclaimNearBaseHigh,
        breakoutAboveBase,
        closeLocation,
        signalVolRatio,
        rsiRecovery,
        plannedRr,
        validRiskShape,
      },
    };
  }

  if (
    tpCappedByResistance &&
    (!Number.isFinite(plannedRr) || plannedRr < minRrAfterCap)
  ) {
    return {
      strategy: "microBaseReclaimLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "microBaseReclaimLong:tp_capped_rr_too_low",
      meta: {
        baseHigh,
        baseLow,
        baseRangeAtr,
        baseDriftAtr,
        signalVolRatio,
        closeLocation,
        plannedRr,
        tpPctAfterCap,
      },
    };
  }

  if (
    tpCappedByResistance &&
    (!Number.isFinite(tpPctAfterCap) || tpPctAfterCap < minTpPctAfterCap)
  ) {
    return {
      strategy: "microBaseReclaimLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "microBaseReclaimLong:tp_after_cap_too_small",
      meta: {
        baseHigh,
        baseLow,
        baseRangeAtr,
        signalVolRatio,
        closeLocation,
        plannedRr,
        tpPctAfterCap,
      },
    };
  }

  return {
    strategy: "microBaseReclaimLong",
    direction: "LONG",
    allowed: true,
    score,
    signalClass,
    minScore,
    entry,
    sl,
    tp,
    rawTp,
    tpCappedByResistance,
    reason: "selected",
    meta: {
      trendSupport,
      baseHigh,
      baseLow,
      baseRangeAtr,
      baseDriftAtr,
      baseLowVsEma20Atr,
      distanceAboveEma20Atr,
      reclaimNearBaseHigh,
      breakoutAboveBase,
      closeLocation,
      signalVolRatio,
      rsiRecovery,
      plannedRr,
      validRiskShape,
    },
  };
}

module.exports = { evaluateMicroBaseReclaimLongStrategy };
