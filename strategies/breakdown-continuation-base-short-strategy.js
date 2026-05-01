const { clamp } = require("../indicators/market-indicators");

function highest(values) {
  if (!Array.isArray(values) || !values.length) return Number.NEGATIVE_INFINITY;
  return Math.max(...values.map((value) => Number(value)));
}

function lowest(values) {
  if (!Array.isArray(values) || !values.length) return Number.POSITIVE_INFINITY;
  return Math.min(...values.map((value) => Number(value)));
}

function avg(values) {
  if (!Array.isArray(values) || !values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function classifySignal(score, minExecutableScore = 68) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= Math.max(45, minExecutableScore - 18)) return "WATCH";
  return "IGNORE";
}

function evaluateBreakdownContinuationBaseShortStrategy(ctx) {
  const { cfg, indicators, candles, nearestSupport, helpers } = ctx;

  const baseCfg =
    cfg.BREAKDOWN_CONTINUATION_BASE_SHORT ||
    cfg.BREAKDOWN_CONTINUATION_BASE ||
    cfg.WEAK_BASE_BREAKDOWN_SHORT ||
    {};

  const enabled = baseCfg.enabled !== false;
  const minScore = Number(
    baseCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(62, helpers.paperMinScore)
  );
  const minAdx = Number(baseCfg.minAdx ?? 0);
  const maxAdx = Number(baseCfg.maxAdx ?? 80);
  const maxRsi = Number(baseCfg.maxRsi ?? 74);

  const baseBars = Number(baseCfg.baseBars ?? 4);
  const preImpulseBars = Number(baseCfg.preImpulseBars ?? 8);
  const minImpulseAtr = Number(baseCfg.minImpulseAtr ?? 0.5);
  const maxBaseRangeAtr = Number(baseCfg.maxBaseRangeAtr ?? 2.25);
  const maxBaseRecoveryFrac = Number(baseCfg.maxBaseRecoveryFrac ?? 0.58);
  const maxBaseCloseRecoveryFrac = Number(baseCfg.maxBaseCloseRecoveryFrac ?? 0.48);
  const maxBaseHighOverEma50Atr = Number(baseCfg.maxBaseHighOverEma50Atr ?? 0.45);
  const breakdownBufferAtr = Number(baseCfg.breakdownBufferAtr ?? 0.04);
  const minBodyAtr = Number(baseCfg.minBodyAtr ?? 0.12);
  const maxCloseLocation = Number(baseCfg.maxCloseLocation ?? 0.38);
  const minRelativeVol = Number(baseCfg.minRelativeVol ?? 0.9);
  const requireVolume = Boolean(baseCfg.requireVolume ?? false);
  const requireCompression = Boolean(baseCfg.requireCompression ?? false);
  const maxExtensionAtr = Number(baseCfg.maxExtensionAtr ?? 3.2);

  const slAtrBuffer = Number(baseCfg.slAtrBuffer ?? 0.20);
  const tpAtrMult = Number(baseCfg.tpAtrMult ?? 2.0);
  const minPlannedRr = Number(baseCfg.minPlannedRr ?? 0.8);
  const structureTpBaseMult = Number(baseCfg.structureTpBaseMult ?? 1.1);
  const tpSupportBufferAtr = Number(
    baseCfg.tpSupportBufferAtr ??
      cfg.BREAKDOWN_CONTINUATION_BASE_SHORT_TP_SUPPORT_BUFFER_ATR ??
      cfg.TP_SUPPORT_BUFFER_ATR ??
      0.12
  );
  const minRrAfterCap = Number(
    baseCfg.minRrAfterCap ??
      cfg.BREAKDOWN_CONTINUATION_BASE_SHORT_MIN_RR_AFTER_CAP ??
      cfg.MIN_RR_AFTER_CAP ??
      0.8
  );
  const minTpPctAfterCap = Number(
    baseCfg.minTpPctAfterCap ??
      cfg.BREAKDOWN_CONTINUATION_BASE_SHORT_MIN_TP_PCT_AFTER_CAP ??
      cfg.MIN_TP_PCT_AFTER_CAP ??
      0.0012
  );
  const minTpAtrAfterCap = Number(
    baseCfg.minTpAtrAfterCap ??
      cfg.BREAKDOWN_CONTINUATION_BASE_SHORT_MIN_TP_ATR_AFTER_CAP ??
      cfg.MIN_TP_ATR_AFTER_CAP ??
      0.55
  );

  if (!enabled || !Array.isArray(candles) || candles.length < baseBars + preImpulseBars + 3) {
    return {
      strategy: "breakdownContinuationBaseShort",
      direction: "SHORT",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "breakdownContinuationBaseShort:not_enough_context",
      meta: {},
    };
  }

  const atr = Number(indicators.atr || 0);
  const entry = Number(indicators.entry);
  const ema20 = Number(indicators.ema20 || 0);
  const ema50 = Number(indicators.ema50 || 0);
  const ema200 = Number(indicators.ema200 || 0);
  const adx = Number(indicators.adx || 0);
  const rsi = Number(indicators.rsi || 0);

  if (!(atr > 0) || !Number.isFinite(entry)) {
    return {
      strategy: "breakdownContinuationBaseShort",
      direction: "SHORT",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "breakdownContinuationBaseShort:indicator_context_missing",
      meta: {},
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const baseCandles = candles.slice(-(baseBars + 1), -1);
  const preCandles = candles.slice(-(baseBars + preImpulseBars + 1), -(baseBars + 1));

  if (baseCandles.length < baseBars || preCandles.length < preImpulseBars) {
    return {
      strategy: "breakdownContinuationBaseShort",
      direction: "SHORT",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "breakdownContinuationBaseShort:window_too_small",
      meta: {},
    };
  }

  const baseHigh = highest(baseCandles.map((c) => c.high));
  const baseLow = lowest(baseCandles.map((c) => c.low));
  const baseRange = baseHigh - baseLow;
  const baseRangeAtr = baseRange / atr;

  const preHigh = highest(preCandles.map((c) => c.high));
  const impulseAbs = preHigh - baseLow;
  const impulseAtr = impulseAbs / atr;

  const recoveryFrac = impulseAbs > 0 ? (baseHigh - baseLow) / impulseAbs : Number.POSITIVE_INFINITY;
  const avgBaseClose = avg(baseCandles.map((c) => c.close));
  const avgBaseCloseRecoveryFrac =
    impulseAbs > 0 ? (avgBaseClose - baseLow) / impulseAbs : Number.POSITIVE_INFINITY;

  const half = Math.max(2, Math.floor(baseCandles.length / 2));
  const firstHalf = baseCandles.slice(0, half);
  const secondHalf = baseCandles.slice(half);
  const firstHalfRange = highest(firstHalf.map((c) => c.high)) - lowest(firstHalf.map((c) => c.low));
  const secondHalfRange =
    secondHalf.length >= 2
      ? highest(secondHalf.map((c) => c.high)) - lowest(secondHalf.map((c) => c.low))
      : baseRange;
  const compressionOk = secondHalfRange <= firstHalfRange * 0.95;

  const breakdownLevel = baseLow - atr * breakdownBufferAtr;
  const bearishClose = Number(last.close) < Number(last.open);
  const breakdownClose =
    Number(last.close) < breakdownLevel &&
    Number(last.close) < Number(prev.close) &&
    Number(last.close) <= Number(prev.low);

  const bodyAtr = Math.abs(Number(last.close) - Number(last.open)) / atr;
  const candleRange = Math.max(Number(last.high) - Number(last.low), Number.EPSILON);
  const closeLocation = (Number(last.close) - Number(last.low)) / candleRange;
  const closeNearLow = closeLocation <= maxCloseLocation;

  const avgVol20 =
    candles.length > 21
      ? avg(candles.slice(-21, -1).map((c) => Number(c.volume || 0)))
      : 0;
  const relativeVol = avgVol20 > 0 ? Number(last.volume || 0) / avgVol20 : null;
  const volumeOk = Number.isFinite(relativeVol) && relativeVol >= minRelativeVol;

  const belowEma20 = entry < ema20;
  const belowEma50 = entry < ema50;
  const noBullishStack = !(ema20 > ema50 && ema50 > ema200);
  const notBullishRegime = indicators.bullish !== true && indicators.bullishFast !== true;
  const baseHighOverEma50Atr = (baseHigh - ema50) / atr;
  const baseTooHighOverEma50 = baseHighOverEma50Atr > maxBaseHighOverEma50Atr;
  const extensionAtr = (ema20 - entry) / atr;
  const notTooExtended = extensionAtr <= maxExtensionAtr;

  let score = 0;
  if (impulseAtr >= minImpulseAtr) score += 16;
  if (baseRangeAtr <= maxBaseRangeAtr) score += 12;
  if (recoveryFrac <= maxBaseRecoveryFrac) score += 12;
  if (avgBaseCloseRecoveryFrac <= maxBaseCloseRecoveryFrac) score += 10;
  if (compressionOk) score += 8;
  if (noBullishStack) score += 10;
  if (notBullishRegime) score += 10;
  if (belowEma20) score += 8;
  if (belowEma50) score += 6;
  if (!baseTooHighOverEma50) score += 8;
  if (breakdownClose) score += 18;
  if (bearishClose) score += 5;
  if (bodyAtr >= minBodyAtr) score += 8;
  if (closeNearLow) score += 5;
  if (volumeOk) score += 8;
  if (adx >= minAdx && adx <= maxAdx) score += 4;
  score = clamp(score, 0, 100);

  const signalClass = classifySignal(score, minScore);

  const sl = helpers.round(Math.max(baseHigh, Number(last.high)) + atr * slAtrBuffer, 6);
  const rawTpDistance = Math.max(atr * tpAtrMult, baseRange * structureTpBaseMult);
  const rawTp = helpers.round(entry - rawTpDistance, 6);

  let tp = rawTp;
  let tpCappedBySupport = false;

  if (
    nearestSupport &&
    Number.isFinite(Number(nearestSupport.price)) &&
    Number(nearestSupport.price) < entry &&
    atr > 0
  ) {
    const cappedTp = helpers.round(Number(nearestSupport.price) + atr * tpSupportBufferAtr, 6);
    if (cappedTp < entry && cappedTp > tp) {
      tp = cappedTp;
      tpCappedBySupport = true;
    }
  }

  const risk = Math.abs(sl - entry);
  const reward = Math.abs(entry - tp);
  const plannedRr = helpers.safeRatio(reward, risk);
  const tpPctAfterCap = entry > 0 ? reward / entry : null;
  const tpAtrAfterCap = atr > 0 ? reward / atr : null;

  const baseAllowed =
    enabled &&
    impulseAtr >= minImpulseAtr &&
    baseRangeAtr <= maxBaseRangeAtr &&
    recoveryFrac <= maxBaseRecoveryFrac &&
    avgBaseCloseRecoveryFrac <= maxBaseCloseRecoveryFrac &&
    (!requireCompression || compressionOk) &&
    noBullishStack &&
    notBullishRegime &&
    belowEma20 &&
    belowEma50 &&
    !baseTooHighOverEma50 &&
    notTooExtended &&
    breakdownClose &&
    bearishClose &&
    bodyAtr >= minBodyAtr &&
    closeNearLow &&
    rsi <= maxRsi &&
    adx >= minAdx &&
    adx <= maxAdx &&
    (!requireVolume || volumeOk) &&
    signalClass === "EXECUTABLE" &&
    Number.isFinite(plannedRr) &&
    plannedRr >= minPlannedRr;

  if (!baseAllowed) {
    let reason = "breakdownContinuationBaseShort:rules_not_met";

    if (impulseAtr < minImpulseAtr) {
      reason = "breakdownContinuationBaseShort:prior_impulse_too_small";
    } else if (baseRangeAtr > maxBaseRangeAtr) {
      reason = "breakdownContinuationBaseShort:base_too_wide";
    } else if (recoveryFrac > maxBaseRecoveryFrac) {
      reason = "breakdownContinuationBaseShort:base_recovered_too_much";
    } else if (avgBaseCloseRecoveryFrac > maxBaseCloseRecoveryFrac) {
      reason = "breakdownContinuationBaseShort:base_closed_too_high";
    } else if (requireCompression && !compressionOk) {
      reason = "breakdownContinuationBaseShort:no_compression";
    } else if (!noBullishStack) {
      reason = "breakdownContinuationBaseShort:bullish_stack_present";
    } else if (!notBullishRegime) {
      reason = "breakdownContinuationBaseShort:bullish_regime";
    } else if (!belowEma20) {
      reason = "breakdownContinuationBaseShort:above_ema20";
    } else if (!belowEma50) {
      reason = "breakdownContinuationBaseShort:above_ema50";
    } else if (baseTooHighOverEma50) {
      reason = "breakdownContinuationBaseShort:base_reclaim_too_high";
    } else if (!notTooExtended) {
      reason = "breakdownContinuationBaseShort:too_extended";
    } else if (!breakdownClose) {
      reason = "breakdownContinuationBaseShort:no_breakdown_close";
    } else if (!bearishClose) {
      reason = "breakdownContinuationBaseShort:not_bearish_close";
    } else if (bodyAtr < minBodyAtr) {
      reason = "breakdownContinuationBaseShort:body_too_small";
    } else if (!closeNearLow) {
      reason = "breakdownContinuationBaseShort:close_not_near_low";
    } else if (rsi > maxRsi) {
      reason = "breakdownContinuationBaseShort:rsi_too_high";
    } else if (adx < minAdx) {
      reason = "breakdownContinuationBaseShort:adx_too_low";
    } else if (adx > maxAdx) {
      reason = "breakdownContinuationBaseShort:adx_too_high";
    } else if (requireVolume && !volumeOk) {
      reason = "breakdownContinuationBaseShort:volume_too_low";
    } else if (signalClass !== "EXECUTABLE") {
      reason = "breakdownContinuationBaseShort:not_executable";
    } else if (!Number.isFinite(plannedRr) || plannedRr < minPlannedRr) {
      reason = "breakdownContinuationBaseShort:planned_rr_too_low";
    }

    return {
      strategy: "breakdownContinuationBaseShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason,
      meta: {
        impulseAtr,
        baseRangeAtr,
        recoveryFrac,
        avgBaseCloseRecoveryFrac,
        compressionOk,
        baseHighOverEma50Atr,
        extensionAtr,
        relativeVol,
        bodyAtr,
        closeLocation,
        plannedRr,
      },
    };
  }

  if (tpCappedBySupport && (!Number.isFinite(plannedRr) || plannedRr < minRrAfterCap)) {
    return {
      strategy: "breakdownContinuationBaseShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "breakdownContinuationBaseShort:tp_capped_rr_too_low",
      meta: {
        impulseAtr,
        baseRangeAtr,
        recoveryFrac,
        avgBaseCloseRecoveryFrac,
        relativeVol,
        bodyAtr,
        closeLocation,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  if (tpCappedBySupport && (!Number.isFinite(tpPctAfterCap) || tpPctAfterCap < minTpPctAfterCap)) {
    return {
      strategy: "breakdownContinuationBaseShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "breakdownContinuationBaseShort:tp_after_cap_too_small",
      meta: {
        impulseAtr,
        baseRangeAtr,
        recoveryFrac,
        avgBaseCloseRecoveryFrac,
        relativeVol,
        bodyAtr,
        closeLocation,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  if (tpCappedBySupport && (!Number.isFinite(tpAtrAfterCap) || tpAtrAfterCap < minTpAtrAfterCap)) {
    return {
      strategy: "breakdownContinuationBaseShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "breakdownContinuationBaseShort:tp_atr_too_small_after_cap",
      meta: {
        impulseAtr,
        baseRangeAtr,
        recoveryFrac,
        avgBaseCloseRecoveryFrac,
        relativeVol,
        bodyAtr,
        closeLocation,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  return {
    strategy: "breakdownContinuationBaseShort",
    direction: "SHORT",
    allowed: true,
    score,
    signalClass,
    minScore,
    entry,
    sl,
    tp,
    tpRawAtr: rawTp,
    tpCappedBySupport,
    reason: "selected",
    meta: {
      impulseAtr,
      baseRangeAtr,
      recoveryFrac,
      avgBaseCloseRecoveryFrac,
      compressionOk,
      baseHighOverEma50Atr,
      extensionAtr,
      relativeVol,
      bodyAtr,
      closeLocation,
      plannedRr,
      tpPctAfterCap,
      tpAtrAfterCap,
      tpMode: tpCappedBySupport ? "structure_capped" : "atr_or_base",
    },
  };
}

module.exports = { evaluateBreakdownContinuationBaseShortStrategy };
