const {
  clamp,
  calcBollingerBands,
  calcMACDSeries,
} = require("../indicators/market-indicators");

function classifySignal(score, minExecutableScore = 70) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function avg(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function evaluateIgnitionContinuationLongStrategy(ctx) {
  const { cfg, indicators, candles, nearestResistance, helpers, marketStructure } = ctx;

  const ignitionCfg =
    cfg.IGNITION_CONTINUATION_LONG || cfg.EXPANSION_CONTINUATION_LONG || {};
  const enabled = ignitionCfg.enabled === true;

  const minScore = Number(
    ignitionCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(62, helpers.paperMinScore)
  );
  const minAdx = Number(ignitionCfg.minAdx ?? 8);
  const trendMode = String(ignitionCfg.trendMode ?? "soft");
  const ema200BufferPct = Number(ignitionCfg.ema200BufferPct ?? 0.0035);
  const impulseLookback = Number(ignitionCfg.impulseLookback ?? 6);
  const pauseBars = Number(ignitionCfg.pauseBars ?? 3);
  const minImpulseAtr = Number(ignitionCfg.minImpulseAtr ?? 0.95);
  const minImpulsePct = Number(ignitionCfg.minImpulsePct ?? 0.0035);
  const minImpulseVolRatio = Number(ignitionCfg.minImpulseVolRatio ?? 1.05);
  const maxPauseRangeAtr = Number(ignitionCfg.maxPauseRangeAtr ?? 0.95);
  const maxPauseRetraceFrac = Number(ignitionCfg.maxPauseRetraceFrac ?? 0.45);
  const maxPauseBelowEma20Atr = Number(ignitionCfg.maxPauseBelowEma20Atr ?? 0.2);
  const breakoutBufferAtr = Number(ignitionCfg.breakoutBufferAtr ?? 0.04);
  const maxExtensionAtr = Number(ignitionCfg.maxExtensionAtr ?? 2.6);
  const maxBreakoutAboveBbAtr = Number(ignitionCfg.maxBreakoutAboveBbAtr ?? 0.55);
  const minSignalVolRatio = Number(ignitionCfg.minSignalVolRatio ?? 0.95);
  const maxSignalVolRatio = Number(ignitionCfg.maxSignalVolRatio ?? 4.6);
  const minCloseLocation = Number(ignitionCfg.minCloseLocation ?? 0.55);
  const requireTrendRegime = ignitionCfg.requireTrendRegime === true;
  const requireHtfBullish = ignitionCfg.requireHtfBullish === true;
  const requireLtfBullishShift = ignitionCfg.requireLtfBullishShift === true;
  const minEmaSeparationPct = Number(ignitionCfg.minEmaSeparationPct ?? 0);
  const minAtrPct = Number(ignitionCfg.minAtrPct ?? 0);
  const slAtrMult = Number(ignitionCfg.slAtrMult ?? 0.85);
  const tpAtrMult = Number(ignitionCfg.tpAtrMult ?? 1.75);
  const minPlannedRr = Number(ignitionCfg.minPlannedRr ?? 0.65);
  const tpResistanceBufferAtr = Number(
    ignitionCfg.tpResistanceBufferAtr ??
      cfg.IGNITION_CONTINUATION_LONG_TP_RESISTANCE_BUFFER_ATR ??
      cfg.TP_RESISTANCE_BUFFER_ATR ??
      0.18
  );
  const minRrAfterCap = Number(
    ignitionCfg.minRrAfterCap ??
      cfg.IGNITION_CONTINUATION_LONG_MIN_RR_AFTER_CAP ??
      cfg.MIN_RR_AFTER_CAP ??
      0.75
  );
  const minTpPctAfterCap = Number(
    ignitionCfg.minTpPctAfterCap ??
      cfg.IGNITION_CONTINUATION_LONG_MIN_TP_PCT_AFTER_CAP ??
      cfg.MIN_TP_PCT_AFTER_CAP ??
      0.0012
  );

  if (!enabled || !Array.isArray(candles) || candles.length < 90) {
    return {
      strategy: "ignitionContinuationLong",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "ignitionContinuationLong:not_enough_context",
      meta: {},
    };
  }

  const neededBars = impulseLookback + pauseBars + 1;
  if (candles.length < neededBars + 40) {
    return {
      strategy: "ignitionContinuationLong",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "ignitionContinuationLong:not_enough_context",
      meta: {},
    };
  }

  const closes = candles.map((c) => Number(c.close));
  const bb = calcBollingerBands(closes, 20, 2);
  const macdSeries = calcMACDSeries(closes, 12, 26, 9);

  if (!bb || macdSeries.length < 3) {
    return {
      strategy: "ignitionContinuationLong",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "ignitionContinuationLong:indicator_context_missing",
      meta: {},
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const pauseWindow = candles.slice(-(pauseBars + 1), -1);
  const impulseWindow = candles.slice(
    -(pauseBars + impulseLookback + 1),
    -(pauseBars + 1)
  );
  const avgVol20 =
    candles.length > 21
      ? avg(candles.slice(-21, -1).map((c) => Number(c.volume || 0)))
      : 0;

  const macdNow = macdSeries[macdSeries.length - 1];
  const macdPrev = macdSeries[macdSeries.length - 2];
  const macdPrev2 = macdSeries[macdSeries.length - 3];

  if (!macdNow || !macdPrev || !macdPrev2) {
    return {
      strategy: "ignitionContinuationLong",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "ignitionContinuationLong:macd_context_missing",
      meta: {},
    };
  }

  const entry = Number(indicators.entry);
  const atr = Number(indicators.atr || 0);
  const ema20 = Number(indicators.ema20 || 0);
  const ema50 = Number(indicators.ema50 || 0);
  const ema200 = Number(indicators.ema200 || 0);
  const adx = Number(indicators.adx || 0);
  const isTrend = indicators?.isTrend === true;
  const emaSeparationPct = Number(indicators?.emaSeparationPct || 0);
  const atrPct = Number(indicators?.atrPct || 0);
  const htfBullish = marketStructure?.htf?.bullish === true;
  const ltfBullishShift = marketStructure?.ltf?.bullishShift === true;

  const ema20AboveEma50 = ema20 > ema50;
  const bullishStack = ema20 > ema50 && ema50 > ema200;
  const aboveEma20 = entry > ema20;
  const aboveEma50 = entry > ema50;
  const aboveEma200 = entry > ema200;
  const ema50AboveOrNearEma200 =
    ema200 > 0 ? ema50 >= ema200 * (1 - ema200BufferPct) : false;
  const bullishBias =
    trendMode === "strict"
      ? bullishStack && aboveEma20
      : ema20AboveEma50 &&
        aboveEma20 &&
        aboveEma50 &&
        (bullishStack || ema50AboveOrNearEma200 || aboveEma200);

  const pauseHigh = Math.max(...pauseWindow.map((c) => Number(c.high)));
  const pauseLow = Math.min(...pauseWindow.map((c) => Number(c.low)));
  const pauseRangeAtr = atr > 0 ? (pauseHigh - pauseLow) / atr : null;
  const pauseLowVsEma20Atr = atr > 0 ? (pauseLow - ema20) / atr : null;

  const impulseHigh = Math.max(...impulseWindow.map((c) => Number(c.high)));
  const impulseLow = Math.min(...impulseWindow.map((c) => Number(c.low)));
  const impulseMove = pauseHigh - impulseLow;
  const impulseMoveAtr = atr > 0 ? impulseMove / atr : null;
  const impulseMovePct = impulseLow > 0 ? impulseMove / impulseLow : null;
  const pauseRetraceFrac = impulseMove > 0 ? (pauseHigh - pauseLow) / impulseMove : null;
  const impulseAvgVol = avg(impulseWindow.map((c) => Number(c.volume || 0)));
  const impulseVolRatio = avgVol20 > 0 ? impulseAvgVol / avgVol20 : null;

  const extensionAtr = atr > 0 ? (entry - ema20) / atr : 999;
  const breakoutAbovePause =
    atr > 0 ? entry > pauseHigh + breakoutBufferAtr * atr : false;
  const closeLocation =
    Number(last.high) > Number(last.low)
      ? (Number(last.close) - Number(last.low)) /
        (Number(last.high) - Number(last.low))
      : 0;
  const bullishSignal =
    Number(last.close) > Number(last.open) &&
    Number(last.close) > Number(prev.close) &&
    closeLocation >= minCloseLocation;
  const bbBreakoutAtr = atr > 0 ? (entry - bb.upper) / atr : null;

  const signalVolRatio = avgVol20 > 0 ? Number(last.volume || 0) / avgVol20 : null;
  const signalVolOk =
    Number.isFinite(signalVolRatio) &&
    signalVolRatio >= minSignalVolRatio &&
    signalVolRatio <= maxSignalVolRatio;

  const macdSupportive =
    macdNow.macd >= macdNow.signal &&
    (macdNow.hist >= 0 || macdNow.hist > macdPrev.hist) &&
    macdNow.hist >= macdPrev2.hist;

  const regimeOk =
    (!requireTrendRegime || isTrend) &&
    (!requireHtfBullish || htfBullish) &&
    (!requireLtfBullishShift || ltfBullishShift) &&
    emaSeparationPct >= minEmaSeparationPct &&
    atrPct >= minAtrPct;

  let score = 0;
  if (regimeOk) score += 10;
  if (bullishBias) score += 15;
  if (bullishStack) score += 8;
  if (Number.isFinite(impulseMoveAtr) && impulseMoveAtr >= minImpulseAtr) score += 18;
  if (Number.isFinite(impulseMovePct) && impulseMovePct >= minImpulsePct) score += 7;
  if (
    Number.isFinite(impulseVolRatio) &&
    impulseVolRatio >= minImpulseVolRatio
  ) {
    score += 8;
  }
  if (Number.isFinite(pauseRangeAtr) && pauseRangeAtr <= maxPauseRangeAtr) score += 12;
  if (
    Number.isFinite(pauseRetraceFrac) &&
    pauseRetraceFrac <= maxPauseRetraceFrac
  ) {
    score += 8;
  }
  if (
    Number.isFinite(pauseLowVsEma20Atr) &&
    pauseLowVsEma20Atr >= -maxPauseBelowEma20Atr
  ) {
    score += 8;
  }
  if (breakoutAbovePause) score += 12;
  if (bullishSignal) score += 6;
  if (macdSupportive) score += 8;
  if (signalVolOk) score += 5;
  if (extensionAtr <= maxExtensionAtr) score += 3;
  score = clamp(score, 0, 100);

  const signalClass = classifySignal(score, minScore);

  const sl = helpers.round(
    pauseLow - slAtrMult * atr,
    6
  );
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

  const allowed =
    regimeOk &&
    bullishBias &&
    Number.isFinite(impulseMoveAtr) &&
    impulseMoveAtr >= minImpulseAtr &&
    Number.isFinite(impulseMovePct) &&
    impulseMovePct >= minImpulsePct &&
    Number.isFinite(impulseVolRatio) &&
    impulseVolRatio >= minImpulseVolRatio &&
    Number.isFinite(pauseRangeAtr) &&
    pauseRangeAtr <= maxPauseRangeAtr &&
    Number.isFinite(pauseRetraceFrac) &&
    pauseRetraceFrac <= maxPauseRetraceFrac &&
    Number.isFinite(pauseLowVsEma20Atr) &&
    pauseLowVsEma20Atr >= -maxPauseBelowEma20Atr &&
    breakoutAbovePause &&
    bullishSignal &&
    adx >= minAdx &&
    macdSupportive &&
    signalVolOk &&
    extensionAtr <= maxExtensionAtr &&
    (!Number.isFinite(bbBreakoutAtr) || bbBreakoutAtr <= maxBreakoutAboveBbAtr) &&
    signalClass === "EXECUTABLE" &&
    Number.isFinite(plannedRr) &&
    plannedRr >= minPlannedRr;

  if (!allowed) {
    let reason = "ignitionContinuationLong:rules_not_met";

    if (!bullishBias) reason = "ignitionContinuationLong:bullish_bias_missing";
    else if (!regimeOk) reason = "ignitionContinuationLong:regime_filter_failed";
    else if (!Number.isFinite(impulseMoveAtr) || impulseMoveAtr < minImpulseAtr) {
      reason = "ignitionContinuationLong:impulse_too_small";
    } else if (!Number.isFinite(impulseMovePct) || impulseMovePct < minImpulsePct) {
      reason = "ignitionContinuationLong:impulse_pct_too_small";
    } else if (
      !Number.isFinite(impulseVolRatio) ||
      impulseVolRatio < minImpulseVolRatio
    ) {
      reason = "ignitionContinuationLong:impulse_volume_too_low";
    } else if (!Number.isFinite(pauseRangeAtr) || pauseRangeAtr > maxPauseRangeAtr) {
      reason = "ignitionContinuationLong:pause_too_wide";
    } else if (
      !Number.isFinite(pauseRetraceFrac) ||
      pauseRetraceFrac > maxPauseRetraceFrac
    ) {
      reason = "ignitionContinuationLong:pause_pullback_too_deep";
    } else if (
      !Number.isFinite(pauseLowVsEma20Atr) ||
      pauseLowVsEma20Atr < -maxPauseBelowEma20Atr
    ) {
      reason = "ignitionContinuationLong:pause_below_ema20";
    } else if (!breakoutAbovePause) {
      reason = "ignitionContinuationLong:no_breakout_resume";
    } else if (!bullishSignal) {
      reason = "ignitionContinuationLong:weak_signal_candle";
    } else if (adx < minAdx) {
      reason = "ignitionContinuationLong:adx_too_low";
    } else if (!macdSupportive) {
      reason = "ignitionContinuationLong:macd_not_supportive";
    } else if (!signalVolOk) {
      reason = "ignitionContinuationLong:signal_volume_not_ok";
    } else if (extensionAtr > maxExtensionAtr) {
      reason = "ignitionContinuationLong:too_extended";
    } else if (Number.isFinite(bbBreakoutAtr) && bbBreakoutAtr > maxBreakoutAboveBbAtr) {
      reason = "ignitionContinuationLong:too_far_above_bb";
    } else if (signalClass !== "EXECUTABLE") {
      reason = "ignitionContinuationLong:not_executable";
    } else if (!Number.isFinite(plannedRr) || plannedRr < minPlannedRr) {
      reason = "ignitionContinuationLong:planned_rr_too_low";
    }

    return {
      strategy: "ignitionContinuationLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason,
      meta: {
        trendMode,
        requireTrendRegime,
        requireHtfBullish,
        requireLtfBullishShift,
        regimeOk,
        isTrend,
        htfBullish,
        ltfBullishShift,
        emaSeparationPct,
        atrPct,
        bullishBias,
        bullishStack,
        aboveEma20,
        aboveEma50,
        aboveEma200,
        ema50AboveOrNearEma200,
        impulseMoveAtr,
        impulseMovePct,
        impulseVolRatio,
        pauseRangeAtr,
        pauseRetraceFrac,
        pauseLowVsEma20Atr,
        pauseHigh,
        pauseLow,
        extensionAtr,
        breakoutAbovePause,
        closeLocation,
        macdHist: macdNow.hist,
        prevMacdHist: macdPrev.hist,
        signalVolRatio,
        bbUpper: bb.upper,
        bbBreakoutAtr,
        plannedRr,
      },
    };
  }

  if (
    tpCappedByResistance &&
    (!Number.isFinite(plannedRr) || plannedRr < minRrAfterCap)
  ) {
    return {
      strategy: "ignitionContinuationLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "ignitionContinuationLong:tp_capped_rr_too_low",
      meta: {
        regimeOk,
        impulseMoveAtr,
        pauseRangeAtr,
        pauseRetraceFrac,
        extensionAtr,
        signalVolRatio,
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
      strategy: "ignitionContinuationLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "ignitionContinuationLong:tp_after_cap_too_small",
      meta: {
        regimeOk,
        impulseMoveAtr,
        pauseRangeAtr,
        pauseRetraceFrac,
        extensionAtr,
        signalVolRatio,
        plannedRr,
        tpPctAfterCap,
      },
    };
  }

  return {
    strategy: "ignitionContinuationLong",
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
      trendMode,
      requireTrendRegime,
      requireHtfBullish,
      requireLtfBullishShift,
      regimeOk,
      isTrend,
      htfBullish,
      ltfBullishShift,
      emaSeparationPct,
      atrPct,
      bullishBias,
      bullishStack,
      aboveEma20,
      aboveEma50,
      aboveEma200,
      ema50AboveOrNearEma200,
      impulseMoveAtr,
      impulseMovePct,
      impulseVolRatio,
      pauseRangeAtr,
      pauseRetraceFrac,
      pauseLowVsEma20Atr,
      pauseHigh,
      pauseLow,
      extensionAtr,
      breakoutAbovePause,
      closeLocation,
      macdHist: macdNow.hist,
      prevMacdHist: macdPrev.hist,
      signalVolRatio,
      bbUpper: bb.upper,
      bbBreakoutAtr,
      plannedRr,
      tpPctAfterCap,
    },
  };
}

module.exports = { evaluateIgnitionContinuationLongStrategy };
