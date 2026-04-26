const { clamp } = require("../indicators/market-indicators");

function classifySignal(score, minExecutableScore = 70) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function evaluateLiquiditySweepReclaimLongStrategy(ctx) {
  const { cfg, indicators, candles, nearestSupport, nearestResistance, helpers } = ctx;

  const sweepCfg =
    cfg.LIQUIDITY_SWEEP_RECLAIM_LONG ||
    cfg.LIQUIDITY_SWEEP ||
    cfg.SWEEP_RECLAIM_LONG ||
    {};

  const enabled = sweepCfg.enabled !== false;
  const minScore = Number(
    sweepCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(65, helpers.paperMinScore)
  );
  const minAdx = Number(sweepCfg.minAdx ?? 0);
  const maxAdx = Number(sweepCfg.maxAdx ?? 38);

  const lookbackCandles = Number(sweepCfg.lookbackCandles ?? 12);
  const maxDistanceFromSupportAtr = Number(
    sweepCfg.maxDistanceFromSupportAtr ??
      cfg.LIQUIDITY_SWEEP_MAX_DIST_SUPPORT_ATR ??
      0.8
  );
  const minSweepDepthAtr = Number(
    sweepCfg.minSweepDepthAtr ??
      cfg.LIQUIDITY_SWEEP_MIN_SWEEP_DEPTH_ATR ??
      0.08
  );
  const maxSweepDepthAtr = Number(
    sweepCfg.maxSweepDepthAtr ??
      cfg.LIQUIDITY_SWEEP_MAX_SWEEP_DEPTH_ATR ??
      0.60
  );
  const minReclaimCloseAtr = Number(
    sweepCfg.minReclaimCloseAtr ??
      cfg.LIQUIDITY_SWEEP_MIN_RECLAIM_CLOSE_ATR ??
      0.04
  );
  const minConfirmBodyAtr = Number(
    sweepCfg.minConfirmBodyAtr ??
      cfg.LIQUIDITY_SWEEP_MIN_CONFIRM_BODY_ATR ??
      0.08
  );
  const minLowerWickAtr = Number(
    sweepCfg.minLowerWickAtr ??
      cfg.LIQUIDITY_SWEEP_MIN_LOWER_WICK_ATR ??
      0.12
  );
  const minRsiRecovery = Number(
    sweepCfg.minRsiRecovery ??
      cfg.LIQUIDITY_SWEEP_MIN_RSI_RECOVERY ??
      0.5
  );
  const maxRsi = Number(sweepCfg.maxRsi ?? cfg.LIQUIDITY_SWEEP_MAX_RSI ?? 62);

  const requireVolume = sweepCfg.requireVolume ?? true;
  const minRelativeVolume = Number(
    sweepCfg.minRelativeVolume ??
      cfg.LIQUIDITY_SWEEP_MIN_RELATIVE_VOLUME ??
      1.10
  );
  const requireConfirmBreak = sweepCfg.requireConfirmBreak ?? true;
  const requireCloseAboveEma20 = sweepCfg.requireCloseAboveEma20 ?? true;

  const slAtrBuffer = Number(sweepCfg.slAtrBuffer ?? 0.20);
  const tpAtrMult = Number(sweepCfg.tpAtrMult ?? 1.40);
  const minPlannedRr = Number(sweepCfg.minPlannedRr ?? 1.0);

  const tpResistanceBufferAtr = Number(
    sweepCfg.tpResistanceBufferAtr ??
      cfg.LIQUIDITY_SWEEP_TP_RESISTANCE_BUFFER_ATR ??
      cfg.TP_RESISTANCE_BUFFER_ATR ??
      0.16
  );
  const minRrAfterCap = Number(
    sweepCfg.minRrAfterCap ??
      cfg.LIQUIDITY_SWEEP_MIN_RR_AFTER_CAP ??
      cfg.MIN_RR_AFTER_CAP ??
      0.85
  );
  const minTpPctAfterCap = Number(
    sweepCfg.minTpPctAfterCap ??
      cfg.LIQUIDITY_SWEEP_MIN_TP_PCT_AFTER_CAP ??
      cfg.MIN_TP_PCT_AFTER_CAP ??
      0.0014
  );
  const minTpAtrAfterCap = Number(
    sweepCfg.minTpAtrAfterCap ??
      cfg.LIQUIDITY_SWEEP_MIN_TP_ATR_AFTER_CAP ??
      cfg.MIN_TP_ATR_AFTER_CAP ??
      0.55
  );

  if (!enabled || !Array.isArray(candles) || candles.length < lookbackCandles + 3) {
    return {
      strategy: "liquiditySweepReclaimLong",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "liquiditySweep:not_enough_context",
      meta: {},
    };
  }

  const confirm = candles[candles.length - 1];
  const reclaim = candles[candles.length - 2];
  const refCandles = candles.slice(-(lookbackCandles + 2), -2);

  const fallbackSupport = Math.min(...refCandles.map((c) => Number(c.low)));
  const fallbackResistance = Math.max(...refCandles.map((c) => Number(c.high)));

  const supportPrice = Number(
    nearestSupport?.price ?? fallbackSupport
  );
  const resistancePrice = Number(
    nearestResistance?.price ?? fallbackResistance
  );

  const supportDistanceAtr =
    Number(indicators.atr) > 0
      ? (Number(indicators.entry) - supportPrice) / Number(indicators.atr)
      : null;

  const sweepLow = Math.min(Number(reclaim.low), Number(confirm.low));
  const sweepDepthAtr =
    Number(indicators.atr) > 0
      ? (supportPrice - sweepLow) / Number(indicators.atr)
      : null;

  const reclaimCloseAtr =
    Number(indicators.atr) > 0
      ? (Number(reclaim.close) - supportPrice) / Number(indicators.atr)
      : null;

  const reclaimCloseAboveSupport = Number(reclaim.close) > supportPrice;
  const confirmCloseAboveReclaimHigh = Number(confirm.close) > Number(reclaim.high);
  const confirmCloseAboveReclaimBody = Number(confirm.close) > Math.max(Number(reclaim.open), Number(reclaim.close));
  const confirmAboveEma20 = Number(confirm.close) > Number(indicators.ema20);
  const notTooExtended =
    Number(confirm.close) < resistancePrice &&
    Number(indicators.rsi) <= maxRsi;

  const confirmBodyAtr =
    Number(indicators.atr) > 0
      ? Math.abs(Number(confirm.close) - Number(confirm.open)) / Number(indicators.atr)
      : null;

  const reclaimLowerWickAtr =
    Number(indicators.atr) > 0
      ? (Math.min(Number(reclaim.open), Number(reclaim.close)) - Number(reclaim.low)) /
        Number(indicators.atr)
      : null;

  const relativeVol =
    Number(indicators.avgVol) > 0
      ? Math.max(Number(reclaim.volume || 0), Number(confirm.volume || 0)) /
        Number(indicators.avgVol)
      : null;

  const rsiRecovery = Number(indicators.rsi) - Number(indicators.prevRsi);

  let score = 0;
  if (Number.isFinite(supportDistanceAtr) && supportDistanceAtr <= maxDistanceFromSupportAtr) score += 15;
  if (Number.isFinite(sweepDepthAtr) && sweepDepthAtr >= minSweepDepthAtr) score += 20;
  if (
    Number.isFinite(sweepDepthAtr) &&
    sweepDepthAtr >= minSweepDepthAtr &&
    sweepDepthAtr <= maxSweepDepthAtr
  ) score += 10;
  if (reclaimCloseAboveSupport) score += 15;
  if (Number.isFinite(reclaimCloseAtr) && reclaimCloseAtr >= minReclaimCloseAtr) score += 10;
  if (confirmCloseAboveReclaimBody) score += 10;
  if (confirmCloseAboveReclaimHigh) score += 10;
  if (confirmAboveEma20) score += 5;
  if (Number.isFinite(confirmBodyAtr) && confirmBodyAtr >= minConfirmBodyAtr) score += 10;
  if (Number.isFinite(reclaimLowerWickAtr) && reclaimLowerWickAtr >= minLowerWickAtr) score += 10;
  if (rsiRecovery >= minRsiRecovery) score += 10;
  if (Number.isFinite(relativeVol) && relativeVol >= minRelativeVolume) score += 10;
  if (Number(indicators.adx || 0) <= maxAdx) score += 5;

  score = clamp(score, 0, 100);
  const signalClass = classifySignal(score, minScore);

  const sl = helpers.round(Number(sweepLow) - Number(indicators.atr) * slAtrBuffer, 6);
  const rawTp = helpers.round(Number(indicators.entry) + Number(indicators.atr) * tpAtrMult, 6);

  const tpCandidates = [rawTp];

  if (
    Number.isFinite(resistancePrice) &&
    resistancePrice > Number(indicators.entry) &&
    Number.isFinite(Number(indicators.atr)) &&
    Number(indicators.atr) > 0
  ) {
    const resistanceCap = helpers.round(
      resistancePrice - Number(indicators.atr) * tpResistanceBufferAtr,
      6
    );

    if (resistanceCap > Number(indicators.entry)) {
      tpCandidates.push(resistanceCap);
    }
  }

  let tp = Math.min(
    ...tpCandidates.filter(
      (v) => Number.isFinite(Number(v)) && Number(v) > Number(indicators.entry)
    )
  );
  if (!Number.isFinite(tp)) tp = rawTp;

  const tpCappedByResistance = Number(tp) < Number(rawTp);
  const risk = Math.abs(Number(indicators.entry) - Number(sl));
  const reward = Math.abs(Number(tp) - Number(indicators.entry));
  const plannedRr = helpers.safeRatio(reward, risk);
  const tpPctAfterCap =
    Number(indicators.entry) > 0 ? reward / Number(indicators.entry) : null;
  const tpAtrAfterCap =
    Number(indicators.atr) > 0 ? reward / Number(indicators.atr) : null;

  const baseAllowed =
    enabled &&
    Number(indicators.adx || 0) >= minAdx &&
    Number(indicators.adx || 0) <= maxAdx &&
    Number.isFinite(supportDistanceAtr) &&
    supportDistanceAtr <= maxDistanceFromSupportAtr &&
    Number.isFinite(sweepDepthAtr) &&
    sweepDepthAtr >= minSweepDepthAtr &&
    sweepDepthAtr <= maxSweepDepthAtr &&
    reclaimCloseAboveSupport &&
    Number.isFinite(reclaimCloseAtr) &&
    reclaimCloseAtr >= minReclaimCloseAtr &&
    (!requireConfirmBreak || confirmCloseAboveReclaimBody || confirmCloseAboveReclaimHigh) &&
    (!requireCloseAboveEma20 || confirmAboveEma20) &&
    Number.isFinite(confirmBodyAtr) &&
    confirmBodyAtr >= minConfirmBodyAtr &&
    Number.isFinite(reclaimLowerWickAtr) &&
    reclaimLowerWickAtr >= minLowerWickAtr &&
    rsiRecovery >= minRsiRecovery &&
    notTooExtended &&
    (!requireVolume ||
      (Number.isFinite(relativeVol) && relativeVol >= minRelativeVolume)) &&
    signalClass === "EXECUTABLE" &&
    Number.isFinite(plannedRr) &&
    plannedRr >= minPlannedRr;

  if (!baseAllowed) {
    let reason = "liquiditySweep:rules_not_met";

    if (!Number.isFinite(supportDistanceAtr) || supportDistanceAtr > maxDistanceFromSupportAtr)
      reason = "liquiditySweep:too_far_from_support";
    else if (!Number.isFinite(sweepDepthAtr) || sweepDepthAtr < minSweepDepthAtr)
      reason = "liquiditySweep:no_real_sweep";
    else if (sweepDepthAtr > maxSweepDepthAtr)
      reason = "liquiditySweep:sweep_too_deep";
    else if (!reclaimCloseAboveSupport)
      reason = "liquiditySweep:not_reclaimed";
    else if (!Number.isFinite(reclaimCloseAtr) || reclaimCloseAtr < minReclaimCloseAtr)
      reason = "liquiditySweep:weak_reclaim";
    else if (requireConfirmBreak && !confirmCloseAboveReclaimBody && !confirmCloseAboveReclaimHigh)
      reason = "liquiditySweep:no_confirm_break";
    else if (requireCloseAboveEma20 && !confirmAboveEma20)
      reason = "liquiditySweep:below_ema20";
    else if (!Number.isFinite(confirmBodyAtr) || confirmBodyAtr < minConfirmBodyAtr)
      reason = "liquiditySweep:confirm_body_too_small";
    else if (!Number.isFinite(reclaimLowerWickAtr) || reclaimLowerWickAtr < minLowerWickAtr)
      reason = "liquiditySweep:wick_too_small";
    else if (rsiRecovery < minRsiRecovery)
      reason = "liquiditySweep:rsi_not_recovering";
    else if (!notTooExtended)
      reason = "liquiditySweep:too_extended";
    else if (Number(indicators.adx || 0) > maxAdx)
      reason = "liquiditySweep:adx_too_high";
    else if (
      requireVolume &&
      (!Number.isFinite(relativeVol) || relativeVol < minRelativeVolume)
    )
      reason = "liquiditySweep:volume_too_low";
    else if (!Number.isFinite(plannedRr) || plannedRr < minPlannedRr)
      reason = "liquiditySweep:planned_rr_too_low";
    else if (signalClass !== "EXECUTABLE")
      reason = "liquiditySweep:not_executable";

    return {
      strategy: "liquiditySweepReclaimLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason,
      meta: {
        supportPrice,
        resistancePrice,
        supportDistanceAtr,
        sweepDepthAtr,
        reclaimCloseAtr,
        confirmBodyAtr,
        reclaimLowerWickAtr,
        relativeVol,
        rsiRecovery,
        plannedRr,
      },
    };
  }

  if (tpCappedByResistance && (!Number.isFinite(plannedRr) || plannedRr < minRrAfterCap)) {
    return {
      strategy: "liquiditySweepReclaimLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "liquiditySweep:tp_capped_rr_too_low",
      meta: {
        supportPrice,
        resistancePrice,
        supportDistanceAtr,
        sweepDepthAtr,
        reclaimCloseAtr,
        confirmBodyAtr,
        reclaimLowerWickAtr,
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
      strategy: "liquiditySweepReclaimLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "liquiditySweep:tp_after_cap_too_small_pct",
      meta: {
        supportPrice,
        resistancePrice,
        supportDistanceAtr,
        sweepDepthAtr,
        reclaimCloseAtr,
        confirmBodyAtr,
        reclaimLowerWickAtr,
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
      strategy: "liquiditySweepReclaimLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "liquiditySweep:tp_after_cap_too_small_atr",
      meta: {
        supportPrice,
        resistancePrice,
        supportDistanceAtr,
        sweepDepthAtr,
        reclaimCloseAtr,
        confirmBodyAtr,
        reclaimLowerWickAtr,
        relativeVol,
        rsiRecovery,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  return {
    strategy: "liquiditySweepReclaimLong",
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
      supportPrice,
      resistancePrice,
      supportDistanceAtr,
      sweepDepthAtr,
      reclaimCloseAtr,
      confirmBodyAtr,
      reclaimLowerWickAtr,
      relativeVol,
      rsiRecovery,
      plannedRr,
      tpPctAfterCap,
      tpAtrAfterCap,
      tpMode: tpCappedByResistance ? "structure_capped" : "atr_raw",
    },
  };
}

module.exports = { evaluateLiquiditySweepReclaimLongStrategy };
