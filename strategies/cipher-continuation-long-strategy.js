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

function hasValidLongRiskShape(entry, sl, tp) {
  return (
    Number.isFinite(entry) &&
    Number.isFinite(sl) &&
    Number.isFinite(tp) &&
    sl < entry &&
    tp > entry
  );
}

function evaluateCipherContinuationLongStrategy(ctx) {
  const { cfg, indicators, candles, nearestResistance, helpers } = ctx;

  const cipherCfg = cfg.CIPHER_CONTINUATION_LONG || cfg.CIPHER_CONTINUATION || {};
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
  const emaTouchAtr = Number(cipherCfg.emaTouchAtr ?? 0.8);
  const maxPullbackBelowEma50Atr = Number(
    cipherCfg.maxPullbackBelowEma50Atr ?? 0.6
  );
  const bbStdDev = Number(cipherCfg.bbStdDev ?? 2);
  const minPlannedRr = Number(cipherCfg.minPlannedRr ?? 0.55);
  const slAtrMult = Number(cipherCfg.slAtrMult ?? 1.0);
  const tpAtrMult = Number(cipherCfg.tpAtrMult ?? 1.8);
  const tpResistanceBufferAtr = Number(
    cipherCfg.tpResistanceBufferAtr ??
      cfg.CIPHER_CONTINUATION_LONG_TP_RESISTANCE_BUFFER_ATR ??
      cfg.TP_RESISTANCE_BUFFER_ATR ??
      0.18
  );
  const minRrAfterCap = Number(
    cipherCfg.minRrAfterCap ??
      cfg.CIPHER_CONTINUATION_LONG_MIN_RR_AFTER_CAP ??
      cfg.MIN_RR_AFTER_CAP ??
      0.8
  );
  const minTpPctAfterCap = Number(
    cipherCfg.minTpPctAfterCap ??
      cfg.CIPHER_CONTINUATION_LONG_MIN_TP_PCT_AFTER_CAP ??
      cfg.MIN_TP_PCT_AFTER_CAP ??
      0.0012
  );
  const minTpPct = Number(
    cipherCfg.minTpPct ??
      cfg.CIPHER_CONTINUATION_LONG_MIN_TP_PCT ??
      0
  );
  const preMacdStructureOverrideCfg =
    cipherCfg.preMacdStructureOverride || {};
  const preMacdStructureOverrideEnabled =
    preMacdStructureOverrideCfg.enabled === true;
  const preMacdStructureOverrideMinRr = Number(
    preMacdStructureOverrideCfg.minRr ?? Math.max(minPlannedRr, 0.8)
  );
  const preMacdStructureOverrideMinAdx = Number(
    preMacdStructureOverrideCfg.minAdx ?? minAdx
  );
  const preMacdStructureOverrideMinRsi = Number(
    preMacdStructureOverrideCfg.minRsi ?? 0
  );
  const preMacdStructureOverrideMaxExtensionAtr = Number(
    preMacdStructureOverrideCfg.maxExtensionAtr ??
      Math.min(maxExtensionAtr, 0.25)
  );
  const preMacdStructureOverrideMaxSignalVolRatio = Number(
    preMacdStructureOverrideCfg.maxSignalVolRatio ?? maxSignalVolRatio
  );
  const preMacdStructureOverrideRequireBullishStack =
    preMacdStructureOverrideCfg.requireBullishStack === true;
  const preMacdStructureOverrideRequirePullbackTouchesEma20 =
    preMacdStructureOverrideCfg.requirePullbackTouchesEma20 === true;
  const preMacdStructureOverrideRequirePullbackNearBbBasis =
    preMacdStructureOverrideCfg.requirePullbackNearBbBasis === true;
  const preMacdStructureOverrideRequirePullbackStaysAboveEma50 =
    preMacdStructureOverrideCfg.requirePullbackStaysAboveEma50 !== false;

  if (!enabled || !Array.isArray(candles) || candles.length < 60) {
    return {
      strategy: "cipherContinuationLong",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "cipherContinuationLong:not_enough_context",
      meta: {},
    };
  }

  const closes = candles.map((c) => Number(c.close));
  const bb = calcBollingerBands(closes, 20, bbStdDev);
  const macdSeries = calcMACDSeries(closes, 12, 26, 9);

  if (!bb || macdSeries.length < 3) {
    return {
      strategy: "cipherContinuationLong",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "cipherContinuationLong:indicator_context_missing",
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
      strategy: "cipherContinuationLong",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "cipherContinuationLong:macd_context_missing",
      meta: {},
    };
  }

  const entry = Number(indicators.entry);
  const atr = Number(indicators.atr || 0);
  const ema20 = Number(indicators.ema20 || 0);
  const ema50 = Number(indicators.ema50 || 0);
  const ema200 = Number(indicators.ema200 || 0);
  const adx = Number(indicators.adx || 0);
  const rsi = Number(indicators.rsi || 0);
  const ema20AboveEma50 = ema20 > ema50;
  const bullishStack = ema20 > ema50 && ema50 > ema200;
  const aboveEma50 = entry > ema50;
  const aboveEma200 = entry > ema200;
  const ema50AboveOrNearEma200 =
    ema200 > 0 ? ema50 >= ema200 * (1 - ema200BufferPct) : false;
  const bullishBias =
    trendMode === "strict"
      ? bullishStack
      : ema20AboveEma50 &&
        aboveEma50 &&
        (bullishStack || ema50AboveOrNearEma200 || aboveEma200);
  const extensionAtr = atr > 0 ? (entry - ema20) / atr : 999;
  const notTooExtended = extensionAtr <= maxExtensionAtr;

  const pullbackLow = Math.min(...pullbackWindow.map((c) => Number(c.low)));
  const pullbackTouchesEma20 =
    atr > 0 && Math.abs(pullbackLow - ema20) / atr <= emaTouchAtr;
  const pullbackNearBbBasis =
    atr > 0 && Math.abs(pullbackLow - bb.basis) / atr <= emaTouchAtr;
  const pullbackStaysAboveEma50 =
    atr > 0 ? pullbackLow >= ema50 - atr * maxPullbackBelowEma50Atr : false;

  const macdReaccelerating =
    macdNow.hist > macdPrev.hist &&
    macdPrev.hist <= macdPrev2.hist &&
    (macdNow.macd >= macdNow.signal || macdNow.hist >= 0);

  const bullishSignal =
    Number(last.close) > Number(last.open) &&
    Number(last.close) > Number(prev.close);

  const lastVol = Number(last.volume || 0);
  const signalVolRatio = avgVol20 > 0 ? lastVol / avgVol20 : null;
  const signalVolOk =
    Number.isFinite(signalVolRatio) &&
    signalVolRatio >= minSignalVolRatio &&
    signalVolRatio <= maxSignalVolRatio;

  const bbReclaim =
    Number(last.low) <= bb.basis && Number(last.close) >= bb.basis;

  let score = 0;
  if (bullishBias) score += 12;
  if (bullishStack) score += 8;
  if (aboveEma50) score += 10;
  if (notTooExtended) score += 10;
  if (pullbackTouchesEma20 || pullbackNearBbBasis) score += 15;
  if (pullbackStaysAboveEma50) score += 10;
  if (macdReaccelerating) score += 20;
  if (bullishSignal) score += 10;
  if (bbReclaim) score += 5;
  if (adx >= minAdx) score += 5;
  if (signalVolOk) score += 10;
  score = clamp(score, 0, 100);

  const signalClass = classifySignal(score, minScore);

  const sl = helpers.round(
    Math.min(Number(last.low), pullbackLow) - slAtrMult * atr,
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
  const validRiskShape = hasValidLongRiskShape(entry, sl, tp);
  const preMacdStructureOverridePullbackZoneOk =
    pullbackTouchesEma20 || pullbackNearBbBasis;
  const preMacdStructureOverrideSignalVolRatioOk =
    Number.isFinite(signalVolRatio) &&
    signalVolRatio <= preMacdStructureOverrideMaxSignalVolRatio;
  const preMacdStructureOverrideExtensionOk =
    Number.isFinite(extensionAtr) &&
    extensionAtr <= preMacdStructureOverrideMaxExtensionAtr;
  const preMacdStructureOverrideRsiOk =
    Number.isFinite(rsi) && rsi >= preMacdStructureOverrideMinRsi;
  const preMacdStructureOverrideBullishStackOk =
    !preMacdStructureOverrideRequireBullishStack || bullishStack;
  const preMacdStructureOverrideTouchesEma20Ok =
    !preMacdStructureOverrideRequirePullbackTouchesEma20 ||
    pullbackTouchesEma20;
  const preMacdStructureOverrideNearBbBasisOk =
    !preMacdStructureOverrideRequirePullbackNearBbBasis ||
    pullbackNearBbBasis;
  const preMacdStructureOverridePullbackDepthOk =
    !preMacdStructureOverrideRequirePullbackStaysAboveEma50 ||
    pullbackStaysAboveEma50;
  const preMacdStructureOverrideAllowed =
    preMacdStructureOverrideEnabled &&
    !macdReaccelerating &&
    bullishBias &&
    aboveEma50 &&
    notTooExtended &&
    bullishSignal &&
    adx >= preMacdStructureOverrideMinAdx &&
    validRiskShape &&
    signalClass === "EXECUTABLE" &&
    Number.isFinite(plannedRr) &&
    plannedRr >= preMacdStructureOverrideMinRr &&
    preMacdStructureOverridePullbackZoneOk &&
    preMacdStructureOverrideSignalVolRatioOk &&
    preMacdStructureOverrideExtensionOk &&
    preMacdStructureOverrideRsiOk &&
    preMacdStructureOverrideBullishStackOk &&
    preMacdStructureOverrideTouchesEma20Ok &&
    preMacdStructureOverrideNearBbBasisOk &&
    preMacdStructureOverridePullbackDepthOk;

  const allowed =
    bullishBias &&
    aboveEma50 &&
    notTooExtended &&
    (pullbackTouchesEma20 || pullbackNearBbBasis) &&
    pullbackStaysAboveEma50 &&
    macdReaccelerating &&
    bullishSignal &&
    adx >= minAdx &&
    validRiskShape &&
    signalClass === "EXECUTABLE" &&
    Number.isFinite(plannedRr) &&
    plannedRr >= minPlannedRr;
  const finalAllowed = allowed || preMacdStructureOverrideAllowed;

  if (!finalAllowed) {
    let reason = "cipherContinuationLong:rules_not_met";

    if (!bullishBias) reason = "cipherContinuationLong:bullish_bias_missing";
    else if (!aboveEma50) reason = "cipherContinuationLong:below_ema50";
    else if (!notTooExtended) reason = "cipherContinuationLong:too_extended";
    else if (!(pullbackTouchesEma20 || pullbackNearBbBasis)) {
      reason = "cipherContinuationLong:pullback_not_in_zone";
    } else if (!pullbackStaysAboveEma50) {
      reason = "cipherContinuationLong:pullback_too_deep";
    } else if (!macdReaccelerating) {
      reason = "cipherContinuationLong:macd_not_reaccelerating";
    } else if (!bullishSignal) {
      reason = "cipherContinuationLong:no_bullish_signal_candle";
    } else if (adx < minAdx) {
      reason = "cipherContinuationLong:adx_too_low";
    } else if (!validRiskShape) {
      reason = "cipherContinuationLong:invalid_risk_shape";
    } else if (signalClass !== "EXECUTABLE") {
      reason = "cipherContinuationLong:not_executable";
    } else if (!Number.isFinite(plannedRr) || plannedRr < minPlannedRr) {
      reason = "cipherContinuationLong:planned_rr_too_low";
    }

    return {
      strategy: "cipherContinuationLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason,
      meta: {
        trendMode,
        bullishBias,
        ema20AboveEma50,
        bullishStack,
        aboveEma200,
        ema50AboveOrNearEma200,
        aboveEma50,
        extensionAtr,
        pullbackLow,
        pullbackTouchesEma20,
        pullbackNearBbBasis,
        pullbackStaysAboveEma50,
        macdHist: macdNow.hist,
        prevMacdHist: macdPrev.hist,
        rsi,
        macdReaccelerating,
        bbBasis: bb.basis,
        bbLower: bb.lower,
        signalVolRatio,
        plannedRr,
        validRiskShape,
        preMacdStructureOverrideEnabled,
        preMacdStructureOverrideAllowed,
        preMacdStructureOverrideMinRr,
        preMacdStructureOverrideMinAdx,
        preMacdStructureOverrideMinRsi,
        preMacdStructureOverrideMaxExtensionAtr,
        preMacdStructureOverrideMaxSignalVolRatio,
        preMacdStructureOverridePullbackZoneOk,
        preMacdStructureOverrideSignalVolRatioOk,
        preMacdStructureOverrideExtensionOk,
        preMacdStructureOverrideRsiOk,
        preMacdStructureOverrideBullishStackOk,
        preMacdStructureOverrideTouchesEma20Ok,
        preMacdStructureOverrideNearBbBasisOk,
        preMacdStructureOverridePullbackDepthOk,
      },
    };
  }

  if (
    tpCappedByResistance &&
    (!Number.isFinite(plannedRr) || plannedRr < minRrAfterCap)
  ) {
    return {
      strategy: "cipherContinuationLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "cipherContinuationLong:tp_capped_rr_too_low",
      meta: {
        trendMode,
        bullishBias,
        ema20AboveEma50,
        bullishStack,
        aboveEma200,
        ema50AboveOrNearEma200,
        aboveEma50,
        extensionAtr,
        pullbackLow,
        pullbackTouchesEma20,
        pullbackNearBbBasis,
        pullbackStaysAboveEma50,
        macdHist: macdNow.hist,
        prevMacdHist: macdPrev.hist,
        rsi,
        macdReaccelerating,
        bbBasis: bb.basis,
        bbLower: bb.lower,
        signalVolRatio,
        plannedRr,
        tpPctAfterCap,
        validRiskShape,
        preMacdStructureOverrideEnabled,
        preMacdStructureOverrideAllowed,
      },
    };
  }

  if (
    tpCappedByResistance &&
    (!Number.isFinite(tpPctAfterCap) || tpPctAfterCap < minTpPctAfterCap)
  ) {
    return {
      strategy: "cipherContinuationLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "cipherContinuationLong:tp_after_cap_too_small",
      meta: {
        trendMode,
        bullishBias,
        ema20AboveEma50,
        bullishStack,
        aboveEma200,
        ema50AboveOrNearEma200,
        aboveEma50,
        extensionAtr,
        pullbackLow,
        pullbackTouchesEma20,
        pullbackNearBbBasis,
        pullbackStaysAboveEma50,
        macdHist: macdNow.hist,
        prevMacdHist: macdPrev.hist,
        rsi,
        macdReaccelerating,
        bbBasis: bb.basis,
        bbLower: bb.lower,
        signalVolRatio,
        plannedRr,
        tpPctAfterCap,
        validRiskShape,
        preMacdStructureOverrideEnabled,
        preMacdStructureOverrideAllowed,
      },
    };
  }

  if (
    Number.isFinite(minTpPct) &&
    minTpPct > 0 &&
    (!Number.isFinite(tpPctAfterCap) || tpPctAfterCap < minTpPct)
  ) {
    return {
      strategy: "cipherContinuationLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "cipherContinuationLong:tp_pct_too_small",
      meta: {
        trendMode,
        bullishBias,
        ema20AboveEma50,
        bullishStack,
        aboveEma200,
        ema50AboveOrNearEma200,
        aboveEma50,
        extensionAtr,
        pullbackLow,
        pullbackTouchesEma20,
        pullbackNearBbBasis,
        pullbackStaysAboveEma50,
        macdHist: macdNow.hist,
        prevMacdHist: macdPrev.hist,
        rsi,
        macdReaccelerating,
        bbBasis: bb.basis,
        bbLower: bb.lower,
        signalVolRatio,
        plannedRr,
        tpPctAfterCap,
        minTpPct,
        validRiskShape,
        preMacdStructureOverrideEnabled,
        preMacdStructureOverrideAllowed,
      },
    };
  }

  return {
    strategy: "cipherContinuationLong",
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
    reason: preMacdStructureOverrideAllowed
      ? "selected_premacd_structure"
      : "selected",
    meta: {
      trendMode,
      bullishBias,
      ema20AboveEma50,
      bullishStack,
      aboveEma200,
      ema50AboveOrNearEma200,
      aboveEma50,
      extensionAtr,
      pullbackLow,
      pullbackTouchesEma20,
      pullbackNearBbBasis,
      pullbackStaysAboveEma50,
      macdHist: macdNow.hist,
      prevMacdHist: macdPrev.hist,
      rsi,
      macdReaccelerating,
      bbBasis: bb.basis,
      bbLower: bb.lower,
      signalVolRatio,
      plannedRr,
      tpPctAfterCap,
      minTpPct,
      validRiskShape,
      preMacdStructureOverrideEnabled,
      preMacdStructureOverrideAllowed,
      preMacdStructureOverrideMinRr,
      preMacdStructureOverrideMinAdx,
      preMacdStructureOverrideMinRsi,
      preMacdStructureOverrideMaxExtensionAtr,
      preMacdStructureOverrideMaxSignalVolRatio,
      preMacdStructureOverridePullbackZoneOk,
      preMacdStructureOverrideSignalVolRatioOk,
      preMacdStructureOverrideExtensionOk,
      preMacdStructureOverrideRsiOk,
      preMacdStructureOverrideBullishStackOk,
      preMacdStructureOverrideTouchesEma20Ok,
      preMacdStructureOverrideNearBbBasisOk,
      preMacdStructureOverridePullbackDepthOk,
    },
  };
}

module.exports = { evaluateCipherContinuationLongStrategy };
