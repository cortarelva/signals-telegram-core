const { clamp } = require("../indicators/market-indicators");

function classifySignal(score, minExecutableScore = 70) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function calculateRangeSignalScore({
  isRange,
  nearPullback,
  nearEma20,
  nearEma50,
  rsiInBand,
  rsiRising,
  adx,
}) {
  let score = 0;

  if (isRange) score += 25;
  if (nearPullback) score += 25;
  if (nearEma20 || nearEma50) score += 20;
  if (rsiInBand) score += 15;
  if (rsiRising) score += 10;
  if (Number(adx || 0) < 20) score += 5;

  return clamp(score, 0, 100);
}

function evaluateRangeStrategy(ctx) {
  const { cfg, indicators, srEval, nearestResistance, helpers } = ctx;

  const rangeCfg = cfg.RANGE || {};
  const rangeRsiMin = Number(
    rangeCfg.rsiMin ?? cfg.RSI_MIN ?? helpers.defaults.rangeRsiMin
  );
  const rangeRsiMax = Number(
    rangeCfg.rsiMax ?? cfg.RSI_MAX ?? helpers.defaults.rangeRsiMax
  );

  const rangeMinScore = Number(
    rangeCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(65, helpers.paperMinScore)
  );

  const rangeMinAdx = Number(rangeCfg.minAdx ?? cfg.MIN_ADX ?? 0);
  const rangeMaxAdx = Number(rangeCfg.maxAdx ?? cfg.RANGE_MAX_ADX ?? 30);

  const rangeRequireTrend = rangeCfg.requireTrend ?? false;
  const rangeRequireRange = rangeCfg.requireRange ?? true;
  const rangeRequireNearPullback = rangeCfg.requireNearPullback ?? true;
  const rangeRequireStackedEma = rangeCfg.requireStackedEma ?? false;
  const rangeRequireNearEma20 = rangeCfg.requireNearEma20 ?? false;
  const rangeRequireRsiRising = rangeCfg.requireRsiRising ?? true;
  const rangeRequireSr = rangeCfg.requireSr ?? cfg.REQUIRE_SR ?? true;

  const rangeTpResistanceBufferAtr = Number(
    rangeCfg.tpResistanceBufferAtr ?? cfg.TP_RESISTANCE_BUFFER_ATR ?? 0.15
  );
  const rangeSlAtrMult = Number(
    rangeCfg.slAtrMult ?? cfg.SL_ATR_MULT ?? helpers.defaults.rangeSlAtrMult
  );
  const rangeTpAtrMult = Number(
    rangeCfg.tpAtrMult ?? cfg.TP_ATR_MULT ?? helpers.defaults.rangeTpAtrMult
  );

  const rangeMinRrAfterCap = Number(
    rangeCfg.minRrAfterCap ?? cfg.MIN_RR_AFTER_CAP ?? 0.8
  );
  const rangeMinTpPctAfterCap = Number(
    rangeCfg.minTpPctAfterCap ?? cfg.MIN_TP_PCT_AFTER_CAP ?? 0.0015
  );
  const rangeMinTpAtrAfterCap = Number(
    rangeCfg.minTpAtrAfterCap ?? cfg.MIN_TP_ATR_AFTER_CAP ?? 0.55
  );

  const rangeRsiInBand =
    indicators.rsi >= rangeRsiMin && indicators.rsi <= rangeRsiMax;
  const rangeRsiRising = indicators.rsi > indicators.prevRsi;

  let score = calculateRangeSignalScore({
    isRange: indicators.isRange,
    nearPullback: indicators.nearPullback,
    nearEma20: indicators.nearEma20,
    nearEma50: indicators.nearEma50,
    rsiInBand: rangeRsiInBand,
    rsiRising: rangeRsiRising,
    adx: indicators.adx,
  });

  const rangeSrSoftPassed =
    srEval.passed ||
    (srEval.reason === "resistance_too_close" &&
      nearestResistance &&
      Number.isFinite(nearestResistance.price) &&
      nearestResistance.price > indicators.entry);

  if (!indicators.isRange) score -= 25;

  if (srEval.passed) score += 10;
  else if (!rangeSrSoftPassed) score -= 25;
  else score -= 10;

  score = clamp(score, 0, 100);
  const signalClass = classifySignal(score, rangeMinScore);
  const executableEnough = signalClass === "EXECUTABLE";

  const allowed =
    rangeCfg.enabled !== false &&
    (!rangeRequireTrend || indicators.isTrend) &&
    (!rangeRequireRange || indicators.isRange) &&
    (!rangeRequireNearPullback || indicators.nearPullback) &&
    (!rangeRequireStackedEma || indicators.stackedEma) &&
    (!rangeRequireNearEma20 || indicators.nearEma20) &&
    (!rangeRequireRsiRising || rangeRsiRising) &&
    (!rangeRequireSr || rangeSrSoftPassed) &&
    Number(indicators.adx || 0) >= rangeMinAdx &&
    Number(indicators.adx || 0) <= rangeMaxAdx &&
    executableEnough;

  if (!allowed) {
    let reason = "range:rules_not_met";

    if (rangeRequireRange && !indicators.isRange) {
      reason = "range:not_range";
    } else if (rangeRequireNearPullback && !indicators.nearPullback) {
      reason = "range:not_pullback";
    } else if (rangeRequireRsiRising && !rangeRsiRising) {
      reason = "range:rsi_not_rising";
    } else if (Number(indicators.adx || 0) > rangeMaxAdx) {
      reason = "range:adx_too_high";
    } else if (rangeRequireSr && !rangeSrSoftPassed) {
      reason = `range:${srEval.reason}`;
    } else if (!executableEnough) {
      reason = "range:not_executable";
    }

    return {
      strategy: "range",
      allowed: false,
      score,
      signalClass,
      minScore: rangeMinScore,
      reason,
      meta: {
        rangeRsiInBand,
        rangeRsiRising,
        rangeSrSoftPassed,
      },
    };
  }

  const sl = helpers.round(indicators.entry - rangeSlAtrMult * indicators.atr, 6);
  const rawTp = helpers.round(indicators.entry + rangeTpAtrMult * indicators.atr, 6);

  let tp = rawTp;
  let tpCappedByResistance = false;

  if (
    nearestResistance &&
    Number.isFinite(nearestResistance.price) &&
    nearestResistance.price > indicators.entry &&
    Number.isFinite(indicators.atr) &&
    indicators.atr > 0
  ) {
    const cappedTp = helpers.round(
      nearestResistance.price - indicators.atr * rangeTpResistanceBufferAtr,
      6
    );

    if (cappedTp > indicators.entry && cappedTp < tp) {
      tp = cappedTp;
      tpCappedByResistance = true;
    }
  }

  const risk = Math.abs(indicators.entry - sl);
  const reward = Math.abs(tp - indicators.entry);
  const plannedRr = helpers.safeRatio(reward, risk);
  const tpPctAfterCap = indicators.entry > 0 ? reward / indicators.entry : null;
  const tpAtrAfterCap = indicators.atr > 0 ? reward / indicators.atr : null;

  if (
    !Number.isFinite(risk) ||
    !Number.isFinite(reward) ||
    risk <= 0 ||
    reward <= 0
  ) {
    return {
      strategy: "range",
      allowed: false,
      score,
      signalClass,
      minScore: rangeMinScore,
      reason: "range:invalid_rr",
      meta: {
        rangeRsiInBand,
        rangeRsiRising,
        rangeSrSoftPassed,
        tpCappedByResistance,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  if (
    tpCappedByResistance &&
    (!Number.isFinite(plannedRr) || plannedRr < rangeMinRrAfterCap)
  ) {
    return {
      strategy: "range",
      allowed: false,
      score,
      signalClass,
      minScore: rangeMinScore,
      reason: "range:tp_capped_rr_too_low",
      meta: {
        rangeRsiInBand,
        rangeRsiRising,
        rangeSrSoftPassed,
        tpCappedByResistance,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  if (
    tpCappedByResistance &&
    (!Number.isFinite(tpPctAfterCap) || tpPctAfterCap < rangeMinTpPctAfterCap)
  ) {
    return {
      strategy: "range",
      allowed: false,
      score,
      signalClass,
      minScore: rangeMinScore,
      reason: "range:tp_after_cap_too_small",
      meta: {
        rangeRsiInBand,
        rangeRsiRising,
        rangeSrSoftPassed,
        tpCappedByResistance,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  if (
    tpCappedByResistance &&
    (!Number.isFinite(tpAtrAfterCap) || tpAtrAfterCap < rangeMinTpAtrAfterCap)
  ) {
    return {
      strategy: "range",
      allowed: false,
      score,
      signalClass,
      minScore: rangeMinScore,
      reason: "range:tp_atr_after_cap_too_small",
      meta: {
        rangeRsiInBand,
        rangeRsiRising,
        rangeSrSoftPassed,
        tpCappedByResistance,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  return {
    strategy: "range",
    allowed: true,
    score,
    signalClass,
    minScore: rangeMinScore,
    sl,
    tp,
    tpRawAtr: rawTp,
    tpCappedByResistance,
    reason: "selected",
    meta: {
      rangeRsiInBand,
      rangeRsiRising,
      rangeSrSoftPassed,
      plannedRr,
      tpPctAfterCap,
      tpAtrAfterCap,
    },
  };
}

module.exports = { evaluateRangeStrategy };
