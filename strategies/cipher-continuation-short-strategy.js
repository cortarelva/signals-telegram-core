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
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function hasValidShortRiskShape(entry, sl, tp) {
  return (
    Number.isFinite(entry) &&
    Number.isFinite(sl) &&
    Number.isFinite(tp) &&
    sl > entry &&
    tp < entry
  );
}

function evaluateCipherContinuationShortStrategy(ctx) {
  const { cfg, indicators, candles, nearestSupport, helpers } = ctx;

  const cipherCfg = cfg.CIPHER_CONTINUATION_SHORT || cfg.CIPHER_CONTINUATION || {};
  const enabled = cipherCfg.enabled !== false;

  const minScore = Number(
    cipherCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(64, helpers.paperMinScore)
  );
  const minAdx = Number(cipherCfg.minAdx ?? 8);
  const minSignalVolRatio = Number(cipherCfg.minSignalVolRatio ?? 1.0);
  const maxSignalVolRatio = Number(cipherCfg.maxSignalVolRatio ?? 3.5);
  const pullbackBars = Number(cipherCfg.pullbackBars ?? 5);
  const trendMode = String(cipherCfg.trendMode ?? "soft");
  const ema200BufferPct = Number(cipherCfg.ema200BufferPct ?? 0.0035);
  const maxExtensionAtr = Number(cipherCfg.maxExtensionAtr ?? 1.8);
  const emaTouchAtr = Number(cipherCfg.emaTouchAtr ?? 0.65);
  const maxPullbackAboveEma50Atr = Number(
    cipherCfg.maxPullbackAboveEma50Atr ?? 0.6
  );
  const bbStdDev = Number(cipherCfg.bbStdDev ?? 2);
  const minPlannedRr = Number(cipherCfg.minPlannedRr ?? 0.65);
  const slAtrMult = Number(cipherCfg.slAtrMult ?? 1.0);
  const tpAtrMult = Number(cipherCfg.tpAtrMult ?? 1.8);
  const tpSupportBufferAtr = Number(
    cipherCfg.tpSupportBufferAtr ??
      cfg.CIPHER_CONTINUATION_SHORT_TP_SUPPORT_BUFFER_ATR ??
      cfg.TP_SUPPORT_BUFFER_ATR ??
      0.18
  );
  const minRrAfterCap = Number(
    cipherCfg.minRrAfterCap ??
      cfg.CIPHER_CONTINUATION_SHORT_MIN_RR_AFTER_CAP ??
      cfg.MIN_RR_AFTER_CAP ??
      0.8
  );
  const minTpPctAfterCap = Number(
    cipherCfg.minTpPctAfterCap ??
      cfg.CIPHER_CONTINUATION_SHORT_MIN_TP_PCT_AFTER_CAP ??
      cfg.MIN_TP_PCT_AFTER_CAP ??
      0.0012
  );

  if (!enabled || !Array.isArray(candles) || candles.length < 60) {
    return {
      strategy: "cipherContinuationShort",
      direction: "SHORT",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "cipherContinuationShort:not_enough_context",
      meta: {},
    };
  }

  const closes = candles.map((c) => Number(c.close));
  const bb = calcBollingerBands(closes, 20, bbStdDev);
  const macdSeries = calcMACDSeries(closes, 12, 26, 9);

  if (!bb || macdSeries.length < 3) {
    return {
      strategy: "cipherContinuationShort",
      direction: "SHORT",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "cipherContinuationShort:indicator_context_missing",
      meta: {},
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const pullbackWindow = candles.slice(-(pullbackBars + 1), -1);
  const avgVol20 =
    candles.length > 21
      ? avg(candles.slice(-21, -1).map((c) => Number(c.volume || 0)))
      : 0;

  const macdNow = macdSeries[macdSeries.length - 1];
  const macdPrev = macdSeries[macdSeries.length - 2];
  const macdPrev2 = macdSeries[macdSeries.length - 3];

  if (!macdNow || !macdPrev || !macdPrev2) {
    return {
      strategy: "cipherContinuationShort",
      direction: "SHORT",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "cipherContinuationShort:macd_context_missing",
      meta: {},
    };
  }

  const entry = Number(indicators.entry);
  const atr = Number(indicators.atr || 0);
  const ema20 = Number(indicators.ema20 || 0);
  const ema50 = Number(indicators.ema50 || 0);
  const ema200 = Number(indicators.ema200 || 0);
  const adx = Number(indicators.adx || 0);
  const ema20BelowEma50 = ema20 < ema50;
  const bearishStack = ema20 < ema50 && ema50 < ema200;
  const belowEma50 = entry < ema50;
  const belowEma200 = entry < ema200;
  const ema50BelowOrNearEma200 =
    ema200 > 0 ? ema50 <= ema200 * (1 + ema200BufferPct) : false;
  const bearishBias =
    trendMode === "strict"
      ? bearishStack
      : ema20BelowEma50 &&
        belowEma50 &&
        (bearishStack || ema50BelowOrNearEma200 || belowEma200);
  const extensionAtr = atr > 0 ? (ema20 - entry) / atr : 999;
  const notTooExtended = extensionAtr <= maxExtensionAtr;

  const pullbackHigh = Math.max(...pullbackWindow.map((c) => Number(c.high)));
  const pullbackTouchesEma20 =
    atr > 0 && Math.abs(pullbackHigh - ema20) / atr <= emaTouchAtr;
  const pullbackNearBbBasis =
    atr > 0 && Math.abs(pullbackHigh - bb.basis) / atr <= emaTouchAtr;
  const pullbackStaysBelowEma50 =
    atr > 0 ? pullbackHigh <= ema50 + atr * maxPullbackAboveEma50Atr : false;

  const macdRollingOver =
    macdNow.hist < macdPrev.hist &&
    macdPrev.hist >= macdPrev2.hist &&
    (macdNow.macd <= macdNow.signal || macdNow.hist <= 0);

  const bearishSignal =
    Number(last.close) < Number(last.open) &&
    Number(last.close) < Number(prev.close);

  const lastVol = Number(last.volume || 0);
  const signalVolRatio = avgVol20 > 0 ? lastVol / avgVol20 : null;
  const signalVolOk =
    Number.isFinite(signalVolRatio) &&
    signalVolRatio >= minSignalVolRatio &&
    signalVolRatio <= maxSignalVolRatio;

  const bbReject =
    Number(last.high) >= bb.basis && Number(last.close) <= bb.basis;

  let score = 0;
  if (bearishBias) score += 12;
  if (bearishStack) score += 8;
  if (belowEma50) score += 10;
  if (notTooExtended) score += 10;
  if (pullbackTouchesEma20 || pullbackNearBbBasis) score += 15;
  if (pullbackStaysBelowEma50) score += 10;
  if (macdRollingOver) score += 20;
  if (bearishSignal) score += 10;
  if (bbReject) score += 5;
  if (adx >= minAdx) score += 5;
  if (signalVolOk) score += 10;
  score = clamp(score, 0, 100);

  const signalClass = classifySignal(score, minScore);

  const sl = helpers.round(
    Math.max(Number(last.high), pullbackHigh) + slAtrMult * atr,
    6
  );
  const rawTp = helpers.round(entry - tpAtrMult * atr, 6);

  let tp = rawTp;
  let tpCappedBySupport = false;

  if (
    nearestSupport &&
    Number.isFinite(Number(nearestSupport.price)) &&
    Number(nearestSupport.price) < entry &&
    atr > 0
  ) {
    const cappedTp = helpers.round(
      Number(nearestSupport.price) + atr * tpSupportBufferAtr,
      6
    );

    if (cappedTp < entry && cappedTp > tp) {
      tp = cappedTp;
      tpCappedBySupport = true;
    }
  }

  const risk = Math.abs(sl - entry);
  const reward = Math.abs(entry - tp);
  const plannedRr = helpers.safeRatio(reward, risk);
  const tpPctAfterCap = entry > 0 ? reward / entry : null;
  const validRiskShape = hasValidShortRiskShape(entry, sl, tp);

  const allowed =
    bearishBias &&
    belowEma50 &&
    notTooExtended &&
    (pullbackTouchesEma20 || pullbackNearBbBasis) &&
    pullbackStaysBelowEma50 &&
    macdRollingOver &&
    bearishSignal &&
    adx >= minAdx &&
    validRiskShape &&
    signalClass === "EXECUTABLE" &&
    Number.isFinite(plannedRr) &&
    plannedRr >= minPlannedRr;

  if (!allowed) {
    let reason = "cipherContinuationShort:rules_not_met";

    if (!bearishBias) reason = "cipherContinuationShort:bearish_bias_missing";
    else if (!belowEma50) reason = "cipherContinuationShort:above_ema50";
    else if (!notTooExtended) reason = "cipherContinuationShort:too_extended";
    else if (!(pullbackTouchesEma20 || pullbackNearBbBasis)) {
      reason = "cipherContinuationShort:pullback_not_in_zone";
    } else if (!pullbackStaysBelowEma50) {
      reason = "cipherContinuationShort:pullback_too_deep";
    } else if (!macdRollingOver) {
      reason = "cipherContinuationShort:macd_not_rolling_over";
    } else if (!bearishSignal) {
      reason = "cipherContinuationShort:no_bearish_signal_candle";
    } else if (adx < minAdx) {
      reason = "cipherContinuationShort:adx_too_low";
    } else if (!validRiskShape) {
      reason = "cipherContinuationShort:invalid_risk_shape";
    } else if (signalClass !== "EXECUTABLE") {
      reason = "cipherContinuationShort:not_executable";
    } else if (!Number.isFinite(plannedRr) || plannedRr < minPlannedRr) {
      reason = "cipherContinuationShort:planned_rr_too_low";
    }

    return {
      strategy: "cipherContinuationShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason,
      meta: {
        trendMode,
        bearishBias,
        ema20BelowEma50,
        bearishStack,
        belowEma200,
        ema50BelowOrNearEma200,
        belowEma50,
        extensionAtr,
        pullbackHigh,
        pullbackTouchesEma20,
        pullbackNearBbBasis,
        pullbackStaysBelowEma50,
        macdHist: macdNow.hist,
        prevMacdHist: macdPrev.hist,
        macdRollingOver,
        bbBasis: bb.basis,
        bbUpper: bb.upper,
        signalVolRatio,
        plannedRr,
        validRiskShape,
      },
    };
  }

  if (tpCappedBySupport && (!Number.isFinite(plannedRr) || plannedRr < minRrAfterCap)) {
    return {
      strategy: "cipherContinuationShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "cipherContinuationShort:tp_capped_rr_too_low",
      meta: {
        trendMode,
        bearishBias,
        ema20BelowEma50,
        bearishStack,
        belowEma200,
        ema50BelowOrNearEma200,
        belowEma50,
        extensionAtr,
        pullbackHigh,
        pullbackTouchesEma20,
        pullbackNearBbBasis,
        pullbackStaysBelowEma50,
        macdHist: macdNow.hist,
        prevMacdHist: macdPrev.hist,
        macdRollingOver,
        bbBasis: bb.basis,
        bbUpper: bb.upper,
        signalVolRatio,
        plannedRr,
        tpPctAfterCap,
        validRiskShape,
      },
    };
  }

  if (tpCappedBySupport && (!Number.isFinite(tpPctAfterCap) || tpPctAfterCap < minTpPctAfterCap)) {
    return {
      strategy: "cipherContinuationShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "cipherContinuationShort:tp_after_cap_too_small",
      meta: {
        bearishStack,
        belowEma50,
        extensionAtr,
        pullbackHigh,
        pullbackTouchesEma20,
        pullbackNearBbBasis,
        pullbackStaysBelowEma50,
        macdHist: macdNow.hist,
        prevMacdHist: macdPrev.hist,
        macdRollingOver,
        bbBasis: bb.basis,
        bbUpper: bb.upper,
        signalVolRatio,
        plannedRr,
        tpPctAfterCap,
        validRiskShape,
      },
    };
  }

  return {
    strategy: "cipherContinuationShort",
    direction: "SHORT",
    allowed: true,
    score,
    signalClass,
    minScore,
    entry,
    sl,
    tp,
    rawTp,
    tpCappedBySupport,
    reason: "selected",
    meta: {
      trendMode,
      bearishBias,
      ema20BelowEma50,
      bearishStack,
      belowEma200,
      ema50BelowOrNearEma200,
      belowEma50,
      extensionAtr,
      pullbackHigh,
      pullbackTouchesEma20,
      pullbackNearBbBasis,
      pullbackStaysBelowEma50,
      macdHist: macdNow.hist,
      prevMacdHist: macdPrev.hist,
      macdRollingOver,
      bbBasis: bb.basis,
      bbUpper: bb.upper,
      signalVolRatio,
      plannedRr,
      tpPctAfterCap,
      validRiskShape,
    },
  };
}

module.exports = { evaluateCipherContinuationShortStrategy };
