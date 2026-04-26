const { clamp } = require("../indicators/market-indicators");

function classifySignal(score, minExecutableScore = 70) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function evaluateBullTrapStrategy(ctx) {
  const { cfg, indicators, candles, nearestSupport, helpers } = ctx;

  const trapCfg = cfg.BULL_TRAP || cfg.FAILED_BREAKOUT_SHORT || {};
  const enabled = trapCfg.enabled !== false;

  const minScore = Number(
    trapCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(64, helpers.paperMinScore)
  );
  const minAdx = Number(trapCfg.minAdx ?? 10);
  const maxAdx = Number(trapCfg.maxAdx ?? 55);

  const lookbackCandles = Number(trapCfg.lookbackCandles ?? 10);
  const minBreakAtr = Number(trapCfg.minBreakAtr ?? 0.10);
  const minRejectionBodyAtr = Number(trapCfg.minRejectionBodyAtr ?? 0.10);
  const minUpperWickAtr = Number(trapCfg.minUpperWickAtr ?? 0.15);
  const minRsiFade = Number(trapCfg.minRsiFade ?? 1.0);
  const maxRsiAfterReject = Number(trapCfg.maxRsiAfterReject ?? 62);

  const requireVolume = trapCfg.requireVolume ?? false;
  const minRelativeVolume = Number(trapCfg.minRelativeVolume ?? 1.05);

  const slAtrMult = Number(trapCfg.slAtrMult ?? 1.15);
  const tpAtrMult = Number(trapCfg.tpAtrMult ?? 2.0);
  const minPlannedRr = Number(trapCfg.minPlannedRr ?? 1.0);
  const tpSupportBufferAtr = Number(
    trapCfg.tpSupportBufferAtr ?? cfg.BULL_TRAP_TP_SUPPORT_BUFFER_ATR ?? cfg.TP_SUPPORT_BUFFER_ATR ?? 0.15
  );
  const minRrAfterCap = Number(
    trapCfg.minRrAfterCap ?? cfg.BULL_TRAP_MIN_RR_AFTER_CAP ?? cfg.MIN_RR_AFTER_CAP ?? 0.9
  );
  const minTpPctAfterCap = Number(
    trapCfg.minTpPctAfterCap ?? cfg.BULL_TRAP_MIN_TP_PCT_AFTER_CAP ?? cfg.MIN_TP_PCT_AFTER_CAP ?? 0.0015
  );

  if (!enabled || !Array.isArray(candles) || candles.length < lookbackCandles + 2) {
    return {
      strategy: "bullTrap",
      direction: "SHORT",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "bullTrap:not_enough_context",
      meta: {},
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const refCandles = candles.slice(-(lookbackCandles + 1), -1);

  const previousRangeHigh = Math.max(...refCandles.map((c) => Number(c.high)));
  const previousRangeLow = Math.min(...refCandles.map((c) => Number(c.low)));

  const breakHeightAtr =
    indicators.atr > 0 ? (Number(last.high) - previousRangeHigh) / indicators.atr : 0;

  const rejectedBreakout = Number(last.close) < previousRangeHigh;
  const closeBelowPrevClose = Number(last.close) < Number(prev.close);
  const body = Math.abs(Number(last.close) - Number(last.open));
  const bodyAtr = indicators.atr > 0 ? body / indicators.atr : 0;

  const upperWick =
    Number(last.high) - Math.max(Number(last.open), Number(last.close));
  const upperWickAtr = indicators.atr > 0 ? upperWick / indicators.atr : 0;

  const relativeVol =
    indicators.avgVol > 0 ? Number(last.volume || 0) / indicators.avgVol : null;

  const rsiFade = Number(indicators.prevRsi) - Number(indicators.rsi);
  const notTooOversold = Number(indicators.rsi) <= maxRsiAfterReject;

  let score = 0;

  if (breakHeightAtr >= minBreakAtr) score += 25;
  if (rejectedBreakout) score += 20;
  if (closeBelowPrevClose) score += 10;
  if (bodyAtr >= minRejectionBodyAtr) score += 10;
  if (upperWickAtr >= minUpperWickAtr) score += 10;
  if (rsiFade >= minRsiFade) score += 10;
  if (Number(indicators.adx || 0) >= minAdx) score += 5;
  if (Number(indicators.adx || 0) <= maxAdx) score += 5;
  if (Number.isFinite(relativeVol) && relativeVol >= minRelativeVolume) score += 10;

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
    breakHeightAtr >= minBreakAtr &&
    rejectedBreakout &&
    closeBelowPrevClose &&
    bodyAtr >= minRejectionBodyAtr &&
    upperWickAtr >= minUpperWickAtr &&
    rsiFade >= minRsiFade &&
    notTooOversold &&
    Number(indicators.adx || 0) >= minAdx &&
    Number(indicators.adx || 0) <= maxAdx &&
    (!requireVolume ||
      (Number.isFinite(relativeVol) && relativeVol >= minRelativeVolume)) &&
    signalClass === "EXECUTABLE" &&
    Number.isFinite(plannedRr) &&
    plannedRr >= minPlannedRr;

  if (!baseAllowed) {
    let reason = "bullTrap:rules_not_met";

    if (breakHeightAtr < minBreakAtr) reason = "bullTrap:no_real_breakout";
    else if (!rejectedBreakout) reason = "bullTrap:not_rejected";
    else if (!closeBelowPrevClose) reason = "bullTrap:no_close_weakness";
    else if (bodyAtr < minRejectionBodyAtr) reason = "bullTrap:body_too_small";
    else if (upperWickAtr < minUpperWickAtr) reason = "bullTrap:wick_too_small";
    else if (rsiFade < minRsiFade) reason = "bullTrap:rsi_not_fading";
    else if (!notTooOversold) reason = "bullTrap:too_extended_down";
    else if (Number(indicators.adx || 0) < minAdx) reason = "bullTrap:adx_too_low";
    else if (Number(indicators.adx || 0) > maxAdx) reason = "bullTrap:adx_too_high";
    else if (
      requireVolume &&
      (!Number.isFinite(relativeVol) || relativeVol < minRelativeVolume)
    ) {
      reason = "bullTrap:volume_too_low";
    } else if (!Number.isFinite(plannedRr) || plannedRr < minPlannedRr) {
      reason = "bullTrap:planned_rr_too_low";
    } else if (signalClass !== "EXECUTABLE") {
      reason = "bullTrap:not_executable";
    }

    return {
      strategy: "bullTrap",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason,
      meta: {
        previousRangeHigh,
        previousRangeLow,
        breakHeightAtr,
        bodyAtr,
        upperWickAtr,
        rsiFade,
        relativeVol,
        plannedRr,
      },
    };
  }

  if (tpCappedBySupport && (!Number.isFinite(plannedRr) || plannedRr < minRrAfterCap)) {
    return {
      strategy: "bullTrap",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "bullTrap:tp_capped_rr_too_low",
      meta: {
        previousRangeHigh,
        previousRangeLow,
        breakHeightAtr,
        bodyAtr,
        upperWickAtr,
        rsiFade,
        relativeVol,
        plannedRr,
        tpPctAfterCap,
      },
    };
  }

  if (tpCappedBySupport && (!Number.isFinite(tpPctAfterCap) || tpPctAfterCap < minTpPctAfterCap)) {
    return {
      strategy: "bullTrap",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "bullTrap:tp_after_cap_too_small",
      meta: {
        previousRangeHigh,
        previousRangeLow,
        breakHeightAtr,
        bodyAtr,
        upperWickAtr,
        rsiFade,
        relativeVol,
        plannedRr,
        tpPctAfterCap,
      },
    };
  }

  return {
    strategy: "bullTrap",
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
      previousRangeHigh,
      previousRangeLow,
      breakHeightAtr,
      bodyAtr,
      upperWickAtr,
      rsiFade,
      relativeVol,
      plannedRr,
      tpPctAfterCap,
      tpMode: tpCappedBySupport ? "structure_capped" : "atr_raw",
    },
  };
}

module.exports = { evaluateBullTrapStrategy };