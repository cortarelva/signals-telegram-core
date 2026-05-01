const { clamp } = require("../indicators/market-indicators");

function classifySignal(score, minExecutableScore = 100) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function evaluateBreakdownRetestShortStrategy(ctx) {
  const { cfg, indicators, candles, nearestSupport, helpers } = ctx;

  const bdCfg = cfg.BREAKDOWN_RETEST_SHORT || cfg.BREAKDOWN_SHORT || {};
  const enabled = bdCfg.enabled !== false;

  const minScore = Number(
    bdCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(63, helpers.paperMinScore)
  );
  const minAdx = Number(bdCfg.minAdx ?? 12);
  const maxAdx = Number(bdCfg.maxAdx ?? 65);

  const lookbackCandles = Number(bdCfg.lookbackCandles ?? 12);
  const minBreakAtr = Number(bdCfg.minBreakAtr ?? 0.15);
  const maxRetestDistAtr = Number(bdCfg.maxRetestDistAtr ?? 0.35);
  const minRejectBodyAtr = Number(bdCfg.minRejectBodyAtr ?? 0.10);
  const requireRsiFalling = bdCfg.requireRsiFalling ?? true;
  const maxRsi = Number(bdCfg.maxRsi ?? 58);

  const requireVolume = bdCfg.requireVolume ?? false;
  const minRelativeVolume = Number(bdCfg.minRelativeVolume ?? 1.00);

  const slAtrMult = Number(bdCfg.slAtrMult ?? 1.25);
  const tpAtrMult = Number(bdCfg.tpAtrMult ?? 2.1);
  const minPlannedRr = Number(bdCfg.minPlannedRr ?? 1.0);
  const tpSupportBufferAtr = Number(
    bdCfg.tpSupportBufferAtr ?? cfg.BREAKDOWN_RETEST_SHORT_TP_SUPPORT_BUFFER_ATR ?? cfg.TP_SUPPORT_BUFFER_ATR ?? 0.15
  );
  const minRrAfterCap = Number(
    bdCfg.minRrAfterCap ?? cfg.BREAKDOWN_RETEST_SHORT_MIN_RR_AFTER_CAP ?? cfg.MIN_RR_AFTER_CAP ?? 0.9
  );
  const minTpPctAfterCap = Number(
    bdCfg.minTpPctAfterCap ?? cfg.BREAKDOWN_RETEST_SHORT_MIN_TP_PCT_AFTER_CAP ?? cfg.MIN_TP_PCT_AFTER_CAP ?? 0.0015
  );

  if (!enabled || !Array.isArray(candles) || candles.length < lookbackCandles + 3) {
    return {
      strategy: "breakdownRetestShort",
      direction: "SHORT",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "breakdownRetestShort:not_enough_context",
      meta: {},
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const refCandles = candles.slice(-(lookbackCandles + 2), -2);

  const previousRangeLow = Math.min(...refCandles.map((c) => Number(c.low)));
  const breakDepthAtr =
    indicators.atr > 0 ? (previousRangeLow - Math.min(Number(prev.close), Number(last.close))) / indicators.atr : 0;

  const retestDistAtr =
    indicators.atr > 0 ? Math.abs(Number(last.high) - previousRangeLow) / indicators.atr : null;

  const closeBackBelowBrokenSupport = Number(last.close) < previousRangeLow;
  const weakRetest = Number.isFinite(retestDistAtr) && retestDistAtr <= maxRetestDistAtr;
  const bearishClose = Number(last.close) < Number(last.open);
  const closeBelowPrevClose = Number(last.close) < Number(prev.close);

  const body = Math.abs(Number(last.close) - Number(last.open));
  const bodyAtr = indicators.atr > 0 ? body / indicators.atr : 0;

  const relativeVol =
    indicators.avgVol > 0 ? Number(last.volume || 0) / indicators.avgVol : null;

  const rsiFalling = Number(indicators.rsi) < Number(indicators.prevRsi);
  const rsiOk = Number(indicators.rsi) <= maxRsi;

  let score = 0;

  if (breakDepthAtr >= minBreakAtr) score += 25;
  if (weakRetest) score += 20;
  if (closeBackBelowBrokenSupport) score += 15;
  if (bearishClose) score += 10;
  if (closeBelowPrevClose) score += 10;
  if (bodyAtr >= minRejectBodyAtr) score += 10;
  if (rsiFalling) score += 5;
  if (rsiOk) score += 5;
  if (Number(indicators.adx || 0) >= minAdx) score += 5;
  if (Number.isFinite(relativeVol) && relativeVol >= minRelativeVolume) score += 5;

  score = clamp(score, 0, 100);
  const signalClass = classifySignal(score, minScore);

  const sl = helpers.round(
    Math.max(Number(last.high), indicators.entry + slAtrMult * indicators.atr),
    6
  );
  const rawTp = helpers.round(indicators.entry - tpAtrMult * indicators.atr, 6);

  let tp = rawTp;
  let tpCappedBySupport = false;

  if (
    nearestSupport &&
    Number.isFinite(Number(nearestSupport.price)) &&
    Number(nearestSupport.price) < Number(indicators.entry) &&
    Number.isFinite(Number(indicators.atr)) &&
    Number(indicators.atr) > 0
  ) {
    const cappedTp = helpers.round(
      Number(nearestSupport.price) + Number(indicators.atr) * tpSupportBufferAtr,
      6
    );

    if (cappedTp < Number(indicators.entry) && cappedTp > tp) {
      tp = cappedTp;
      tpCappedBySupport = true;
    }
  }

  const risk = Math.abs(sl - indicators.entry);
  const reward = Math.abs(indicators.entry - tp);
  const plannedRr = helpers.safeRatio(reward, risk);
  const tpPctAfterCap = Number(indicators.entry) > 0 ? reward / Number(indicators.entry) : null;

  const baseAllowed =
    enabled &&
    breakDepthAtr >= minBreakAtr &&
    weakRetest &&
    closeBackBelowBrokenSupport &&
    bearishClose &&
    closeBelowPrevClose &&
    bodyAtr >= minRejectBodyAtr &&
    (!requireRsiFalling || rsiFalling) &&
    rsiOk &&
    Number(indicators.adx || 0) >= minAdx &&
    Number(indicators.adx || 0) <= maxAdx &&
    (!requireVolume ||
      (Number.isFinite(relativeVol) && relativeVol >= minRelativeVolume)) &&
    signalClass === "EXECUTABLE" &&
    Number.isFinite(plannedRr) &&
    plannedRr >= minPlannedRr;

  if (!baseAllowed) {
    let reason = "breakdownRetestShort:rules_not_met";

    if (breakDepthAtr < minBreakAtr) reason = "breakdownRetestShort:no_real_breakdown";
    else if (!weakRetest) reason = "breakdownRetestShort:no_clean_retest";
    else if (!closeBackBelowBrokenSupport) reason = "breakdownRetestShort:reclaimed_support";
    else if (!bearishClose) reason = "breakdownRetestShort:not_bearish_close";
    else if (!closeBelowPrevClose) reason = "breakdownRetestShort:no_followthrough";
    else if (bodyAtr < minRejectBodyAtr) reason = "breakdownRetestShort:body_too_small";
    else if (requireRsiFalling && !rsiFalling) reason = "breakdownRetestShort:rsi_not_falling";
    else if (!rsiOk) reason = "breakdownRetestShort:rsi_too_high";
    else if (Number(indicators.adx || 0) < minAdx) reason = "breakdownRetestShort:adx_too_low";
    else if (Number(indicators.adx || 0) > maxAdx) reason = "breakdownRetestShort:adx_too_high";
    else if (
      requireVolume &&
      (!Number.isFinite(relativeVol) || relativeVol < minRelativeVolume)
    ) {
      reason = "breakdownRetestShort:volume_too_low";
    } else if (!Number.isFinite(plannedRr) || plannedRr < minPlannedRr) {
      reason = "breakdownRetestShort:planned_rr_too_low";
    } else if (signalClass !== "EXECUTABLE") {
      reason = "breakdownRetestShort:not_executable";
    }

    return {
      strategy: "breakdownRetestShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason,
      meta: {
        previousRangeLow,
        breakDepthAtr,
        retestDistAtr,
        bodyAtr,
        relativeVol,
        plannedRr,
      },
    };
  }

  if (tpCappedBySupport && (!Number.isFinite(plannedRr) || plannedRr < minRrAfterCap)) {
    return {
      strategy: "breakdownRetestShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "breakdownRetestShort:tp_capped_rr_too_low",
      meta: {
        previousRangeLow,
        breakDepthAtr,
        retestDistAtr,
        bodyAtr,
        relativeVol,
        plannedRr,
        tpPctAfterCap,
      },
    };
  }

  if (tpCappedBySupport && (!Number.isFinite(tpPctAfterCap) || tpPctAfterCap < minTpPctAfterCap)) {
    return {
      strategy: "breakdownRetestShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "breakdownRetestShort:tp_after_cap_too_small",
      meta: {
        previousRangeLow,
        breakDepthAtr,
        retestDistAtr,
        bodyAtr,
        relativeVol,
        plannedRr,
        tpPctAfterCap,
      },
    };
  }

  return {
    strategy: "breakdownRetestShort",
    direction: "SHORT",
    allowed: true,
    score,
    signalClass,
    minScore,
    sl,
    tp,
    tpRawAtr: rawTp,
    tpCappedByResistance: tpCappedBySupport,
    reason: "selected",
    meta: {
      previousRangeLow,
      breakDepthAtr,
      retestDistAtr,
      bodyAtr,
      relativeVol,
      plannedRr,
      tpPctAfterCap,
      tpMode: tpCappedBySupport ? "structure_capped" : "atr_raw",
    },
  };
}

module.exports = { evaluateBreakdownRetestShortStrategy };
