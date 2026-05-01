const { clamp } = require("../indicators/market-indicators");

function classifySignal(score, minExecutableScore = 70) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function envNum(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return Number(fallback);
  const num = Number(raw);
  return Number.isFinite(num) ? num : Number(fallback);
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return !!fallback;
  const val = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(val)) return true;
  if (["0", "false", "no", "off"].includes(val)) return false;
  return !!fallback;
}

function evaluateMomentumBreakoutLongStrategy(ctx) {
  const { cfg, indicators, candles, nearestResistance, helpers } = ctx;

  const breakoutCfg =
    cfg.MOMENTUM_BREAKOUT_LONG ||
    cfg.MOMENTUM_BREAKOUT ||
    cfg.BREAKOUT_LONG ||
    {};

  const enabled = envBool(
    "MOMENTUM_BREAKOUT_LONG_ENABLED",
    breakoutCfg.enabled === true
  );

  const minScore = envNum(
    "MOMENTUM_BREAKOUT_MIN_SCORE",
    breakoutCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(65, helpers.paperMinScore)
  );

  const lookbackCandles = envNum(
    "MOMENTUM_BREAKOUT_LOOKBACK_CANDLES",
    breakoutCfg.lookbackCandles ??
      cfg.MOMENTUM_BREAKOUT_LOOKBACK_CANDLES ??
      12
  );

  const minAdx = envNum(
    "MOMENTUM_BREAKOUT_MIN_ADX",
    breakoutCfg.minAdx ?? cfg.MOMENTUM_BREAKOUT_MIN_ADX ?? 8
  );

  const maxAdx = envNum(
    "MOMENTUM_BREAKOUT_MAX_ADX",
    breakoutCfg.maxAdx ?? cfg.MOMENTUM_BREAKOUT_MAX_ADX ?? 42
  );

  const minBodyAtr = envNum(
    "MOMENTUM_BREAKOUT_MIN_BODY_ATR",
    breakoutCfg.minBodyAtr ?? cfg.MOMENTUM_BREAKOUT_MIN_BODY_ATR ?? 0.22
  );

  const minBreakoutCloseAtr = envNum(
    "MOMENTUM_BREAKOUT_MIN_BREAKOUT_CLOSE_ATR",
    breakoutCfg.minBreakoutCloseAtr ??
      cfg.MOMENTUM_BREAKOUT_MIN_BREAKOUT_CLOSE_ATR ??
      0.08
  );

  const minBaseTightnessAtr = envNum(
    "MOMENTUM_BREAKOUT_MIN_BASE_TIGHTNESS_ATR",
    breakoutCfg.minBaseTightnessAtr ??
      cfg.MOMENTUM_BREAKOUT_MIN_BASE_TIGHTNESS_ATR ??
      0.60
  );

  const maxBaseRangeAtr = envNum(
    "MOMENTUM_BREAKOUT_MAX_BASE_RANGE_ATR",
    breakoutCfg.maxBaseRangeAtr ??
      cfg.MOMENTUM_BREAKOUT_MAX_BASE_RANGE_ATR ??
      2.40
  );

  const maxBaseDriftAtr = envNum(
    "MOMENTUM_BREAKOUT_MAX_BASE_DRIFT_ATR",
    breakoutCfg.maxBaseDriftAtr ??
      cfg.MOMENTUM_BREAKOUT_MAX_BASE_DRIFT_ATR ??
      1.10
  );

  const maxDistanceAboveEma20Atr = envNum(
    "MOMENTUM_BREAKOUT_MAX_DIST_EMA20_ATR",
    breakoutCfg.maxDistanceAboveEma20Atr ??
      cfg.MOMENTUM_BREAKOUT_MAX_DIST_EMA20_ATR ??
      1.20
  );

  const minRelativeVolume = envNum(
    "MOMENTUM_BREAKOUT_MIN_RELATIVE_VOLUME",
    breakoutCfg.minRelativeVolume ??
      cfg.MOMENTUM_BREAKOUT_MIN_RELATIVE_VOLUME ??
      1.20
  );

  const minRsi = envNum(
    "MOMENTUM_BREAKOUT_MIN_RSI",
    breakoutCfg.minRsi ?? cfg.MOMENTUM_BREAKOUT_MIN_RSI ?? 52
  );

  const maxRsi = envNum(
    "MOMENTUM_BREAKOUT_MAX_RSI",
    breakoutCfg.maxRsi ?? cfg.MOMENTUM_BREAKOUT_MAX_RSI ?? 72
  );

  const minRsiRecovery = envNum(
    "MOMENTUM_BREAKOUT_MIN_RSI_RECOVERY",
    breakoutCfg.minRsiRecovery ??
      cfg.MOMENTUM_BREAKOUT_MIN_RSI_RECOVERY ??
      0.40
  );

  const requireAboveEma20 = envBool(
    "MOMENTUM_BREAKOUT_REQUIRE_ABOVE_EMA20",
    breakoutCfg.requireAboveEma20 ?? true
  );

  const requireAboveEma50 = envBool(
    "MOMENTUM_BREAKOUT_REQUIRE_ABOVE_EMA50",
    breakoutCfg.requireAboveEma50 ?? false
  );

  const requireBullishFast = envBool(
    "MOMENTUM_BREAKOUT_REQUIRE_BULLISH_FAST",
    breakoutCfg.requireBullishFast ?? false
  );

  const slAtrBuffer = envNum(
    "MOMENTUM_BREAKOUT_SL_ATR_BUFFER",
    breakoutCfg.slAtrBuffer ??
      cfg.MOMENTUM_BREAKOUT_SL_ATR_BUFFER ??
      0.22
  );

  const tpAtrMult = envNum(
    "MOMENTUM_BREAKOUT_TP_ATR_MULT",
    breakoutCfg.tpAtrMult ??
      cfg.MOMENTUM_BREAKOUT_TP_ATR_MULT ??
      1.55
  );

  const minPlannedRr = envNum(
    "MOMENTUM_BREAKOUT_MIN_PLANNED_RR",
    breakoutCfg.minPlannedRr ??
      cfg.MOMENTUM_BREAKOUT_MIN_PLANNED_RR ??
      1.00
  );

  const tpResistanceBufferAtr = envNum(
    "MOMENTUM_BREAKOUT_TP_RESISTANCE_BUFFER_ATR",
    breakoutCfg.tpResistanceBufferAtr ??
      cfg.MOMENTUM_BREAKOUT_TP_RESISTANCE_BUFFER_ATR ??
      cfg.TP_RESISTANCE_BUFFER_ATR ??
      0.16
  );

  const minRrAfterCap = envNum(
    "MOMENTUM_BREAKOUT_MIN_RR_AFTER_CAP",
    breakoutCfg.minRrAfterCap ??
      cfg.MOMENTUM_BREAKOUT_MIN_RR_AFTER_CAP ??
      cfg.MIN_RR_AFTER_CAP ??
      0.90
  );

  const minTpPctAfterCap = envNum(
    "MOMENTUM_BREAKOUT_MIN_TP_PCT_AFTER_CAP",
    breakoutCfg.minTpPctAfterCap ??
      cfg.MOMENTUM_BREAKOUT_MIN_TP_PCT_AFTER_CAP ??
      cfg.MIN_TP_PCT_AFTER_CAP ??
      0.0018
  );

  const minTpAtrAfterCap = envNum(
    "MOMENTUM_BREAKOUT_MIN_TP_ATR_AFTER_CAP",
    breakoutCfg.minTpAtrAfterCap ??
      cfg.MOMENTUM_BREAKOUT_MIN_TP_ATR_AFTER_CAP ??
      cfg.MIN_TP_ATR_AFTER_CAP ??
      0.65
  );

  if (!enabled || !Array.isArray(candles) || candles.length < lookbackCandles + 2) {
    return {
      strategy: "momentumBreakoutLong",
      direction: "LONG",
      allowed: false,
      score: 0,
      signalClass: "IGNORE",
      minScore,
      reason: "momentumBreakout:not_enough_context",
      meta: {},
    };
  }

  const breakout = candles[candles.length - 1];
  const baseCandles = candles.slice(-(lookbackCandles + 1), -1);

  const baseHigh = Math.max(...baseCandles.map((c) => Number(c.high)));
  const baseLow = Math.min(...baseCandles.map((c) => Number(c.low)));
  const baseRange = baseHigh - baseLow;
  const baseRangeAtr =
    Number(indicators.atr) > 0 ? baseRange / Number(indicators.atr) : null;

  const firstBaseClose = Number(baseCandles[0].close);
  const lastBaseClose = Number(baseCandles[baseCandles.length - 1].close);
  const baseDriftAtr =
    Number(indicators.atr) > 0
      ? Math.abs(lastBaseClose - firstBaseClose) / Number(indicators.atr)
      : null;

  const breakoutBody = Math.abs(Number(breakout.close) - Number(breakout.open));
  const breakoutBodyAtr =
    Number(indicators.atr) > 0 ? breakoutBody / Number(indicators.atr) : null;

  const breakoutCloseDistanceAtr =
    Number(indicators.atr) > 0
      ? (Number(breakout.close) - baseHigh) / Number(indicators.atr)
      : null;

  const relativeVol =
    Number(indicators.avgVol) > 0
      ? Number(breakout.volume || 0) / Number(indicators.avgVol)
      : null;

  const distanceAboveEma20Atr =
    Number(indicators.atr) > 0
      ? (Number(indicators.entry) - Number(indicators.ema20)) / Number(indicators.atr)
      : null;

  const breakoutAboveBase = Number(breakout.close) > baseHigh;
  const breakoutAboveOpen = Number(breakout.close) > Number(breakout.open);
  const breakoutNearHigh =
    Number(breakout.high) > 0
      ? (Number(breakout.high) - Number(breakout.close)) / Number(breakout.high) < 0.0015
      : false;

  const rsiRecovery = Number(indicators.rsi) - Number(indicators.prevRsi);
  const rsiOk = Number(indicators.rsi) >= minRsi && Number(indicators.rsi) <= maxRsi;
  const adxOk = Number(indicators.adx || 0) >= minAdx && Number(indicators.adx || 0) <= maxAdx;

  let score = 0;
  if (Number.isFinite(baseRangeAtr) && baseRangeAtr >= minBaseTightnessAtr && baseRangeAtr <= maxBaseRangeAtr) score += 15;
  if (Number.isFinite(baseDriftAtr) && baseDriftAtr <= maxBaseDriftAtr) score += 10;
  if (breakoutAboveBase) score += 20;
  if (breakoutAboveOpen) score += 10;
  if (breakoutNearHigh) score += 5;
  if (Number.isFinite(breakoutCloseDistanceAtr) && breakoutCloseDistanceAtr >= minBreakoutCloseAtr) score += 10;
  if (Number.isFinite(breakoutBodyAtr) && breakoutBodyAtr >= minBodyAtr) score += 15;
  if (Number.isFinite(relativeVol) && relativeVol >= minRelativeVolume) score += 10;
  if (rsiOk) score += 5;
  if (rsiRecovery >= minRsiRecovery) score += 5;
  if (!requireAboveEma20 || Number(indicators.entry) > Number(indicators.ema20)) score += 5;
  if (!requireAboveEma50 || Number(indicators.entry) > Number(indicators.ema50)) score += 5;
  if (!requireBullishFast || indicators.bullishFast) score += 5;
  if (adxOk) score += 5;

  score = clamp(score, 0, 100);
  const signalClass = classifySignal(score, minScore);

  const sl = helpers.round(
    Math.min(Number(breakout.low), baseLow) - Number(indicators.atr) * slAtrBuffer,
    6
  );
  const rawTp = helpers.round(
    Number(indicators.entry) + Number(indicators.atr) * tpAtrMult,
    6
  );

  const resistancePrice = Number(nearestResistance?.price ?? NaN);
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
    adxOk &&
    Number.isFinite(baseRangeAtr) &&
    baseRangeAtr >= minBaseTightnessAtr &&
    baseRangeAtr <= maxBaseRangeAtr &&
    Number.isFinite(baseDriftAtr) &&
    baseDriftAtr <= maxBaseDriftAtr &&
    breakoutAboveBase &&
    breakoutAboveOpen &&
    Number.isFinite(breakoutCloseDistanceAtr) &&
    breakoutCloseDistanceAtr >= minBreakoutCloseAtr &&
    Number.isFinite(breakoutBodyAtr) &&
    breakoutBodyAtr >= minBodyAtr &&
    Number.isFinite(distanceAboveEma20Atr) &&
    distanceAboveEma20Atr <= maxDistanceAboveEma20Atr &&
    (!requireAboveEma20 || Number(indicators.entry) > Number(indicators.ema20)) &&
    (!requireAboveEma50 || Number(indicators.entry) > Number(indicators.ema50)) &&
    (!requireBullishFast || indicators.bullishFast) &&
    rsiOk &&
    rsiRecovery >= minRsiRecovery &&
    Number.isFinite(relativeVol) &&
    relativeVol >= minRelativeVolume &&
    signalClass === "EXECUTABLE" &&
    Number.isFinite(plannedRr) &&
    plannedRr >= minPlannedRr;

  if (!baseAllowed) {
    let reason = "momentumBreakout:rules_not_met";

    if (!adxOk) reason = Number(indicators.adx || 0) > maxAdx ? "momentumBreakout:adx_too_high" : "momentumBreakout:adx_too_low";
    else if (!Number.isFinite(baseRangeAtr) || baseRangeAtr < minBaseTightnessAtr)
      reason = "momentumBreakout:base_too_tight";
    else if (baseRangeAtr > maxBaseRangeAtr)
      reason = "momentumBreakout:base_too_wide";
    else if (!Number.isFinite(baseDriftAtr) || baseDriftAtr > maxBaseDriftAtr)
      reason = "momentumBreakout:base_drift_too_large";
    else if (!breakoutAboveBase)
      reason = "momentumBreakout:no_breakout_close";
    else if (!breakoutAboveOpen)
      reason = "momentumBreakout:close_not_green";
    else if (!Number.isFinite(breakoutCloseDistanceAtr) || breakoutCloseDistanceAtr < minBreakoutCloseAtr)
      reason = "momentumBreakout:breakout_too_small";
    else if (!Number.isFinite(breakoutBodyAtr) || breakoutBodyAtr < minBodyAtr)
      reason = "momentumBreakout:body_too_small";
    else if (!Number.isFinite(distanceAboveEma20Atr) || distanceAboveEma20Atr > maxDistanceAboveEma20Atr)
      reason = "momentumBreakout:too_extended_above_ema20";
    else if (requireAboveEma20 && Number(indicators.entry) <= Number(indicators.ema20))
      reason = "momentumBreakout:below_ema20";
    else if (requireAboveEma50 && Number(indicators.entry) <= Number(indicators.ema50))
      reason = "momentumBreakout:below_ema50";
    else if (requireBullishFast && !indicators.bullishFast)
      reason = "momentumBreakout:not_bullish_fast";
    else if (!rsiOk)
      reason = Number(indicators.rsi) < minRsi ? "momentumBreakout:rsi_too_low" : "momentumBreakout:rsi_too_high";
    else if (rsiRecovery < minRsiRecovery)
      reason = "momentumBreakout:rsi_not_rising";
    else if (!Number.isFinite(relativeVol) || relativeVol < minRelativeVolume)
      reason = "momentumBreakout:volume_too_low";
    else if (!Number.isFinite(plannedRr) || plannedRr < minPlannedRr)
      reason = "momentumBreakout:planned_rr_too_low";
    else if (signalClass !== "EXECUTABLE")
      reason = "momentumBreakout:not_executable";

    return {
      strategy: "momentumBreakoutLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason,
      meta: {
        baseHigh,
        baseLow,
        baseRangeAtr,
        baseDriftAtr,
        breakoutBodyAtr,
        breakoutCloseDistanceAtr,
        relativeVol,
        distanceAboveEma20Atr,
        rsiRecovery,
        plannedRr,
      },
    };
  }

  if (tpCappedByResistance && (!Number.isFinite(plannedRr) || plannedRr < minRrAfterCap)) {
    return {
      strategy: "momentumBreakoutLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "momentumBreakout:tp_capped_rr_too_low",
      meta: {
        baseHigh,
        baseLow,
        baseRangeAtr,
        baseDriftAtr,
        breakoutBodyAtr,
        breakoutCloseDistanceAtr,
        relativeVol,
        distanceAboveEma20Atr,
        rsiRecovery,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  if (tpCappedByResistance && (!Number.isFinite(tpPctAfterCap) || tpPctAfterCap < minTpPctAfterCap)) {
    return {
      strategy: "momentumBreakoutLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "momentumBreakout:tp_after_cap_too_small_pct",
      meta: {
        baseHigh,
        baseLow,
        baseRangeAtr,
        baseDriftAtr,
        breakoutBodyAtr,
        breakoutCloseDistanceAtr,
        relativeVol,
        distanceAboveEma20Atr,
        rsiRecovery,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  if (tpCappedByResistance && (!Number.isFinite(tpAtrAfterCap) || tpAtrAfterCap < minTpAtrAfterCap)) {
    return {
      strategy: "momentumBreakoutLong",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "momentumBreakout:tp_after_cap_too_small_atr",
      meta: {
        baseHigh,
        baseLow,
        baseRangeAtr,
        baseDriftAtr,
        breakoutBodyAtr,
        breakoutCloseDistanceAtr,
        relativeVol,
        distanceAboveEma20Atr,
        rsiRecovery,
        plannedRr,
        tpPctAfterCap,
        tpAtrAfterCap,
      },
    };
  }

  return {
    strategy: "momentumBreakoutLong",
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
      baseHigh,
      baseLow,
      baseRangeAtr,
      baseDriftAtr,
      breakoutBodyAtr,
      breakoutCloseDistanceAtr,
      relativeVol,
      distanceAboveEma20Atr,
      rsiRecovery,
      plannedRr,
      tpPctAfterCap,
      tpAtrAfterCap,
      tpMode: tpCappedByResistance ? "structure_capped" : "atr_raw",
    },
  };
}

module.exports = { evaluateMomentumBreakoutLongStrategy };
