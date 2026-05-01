function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function classifySignal(score, minExecutableScore = 70) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function evaluateTrendStrategy(ctx) {
  const { indicators, marketStructure, helpers, cfg, srEvalLong } = ctx;

  const trendCfg = cfg.TREND || {};
  const enabled = trendCfg.enabled !== false;
  const allow15m = trendCfg.allow15m === true;
  const minScore = Number(trendCfg.minScore ?? cfg.MIN_SCORE ?? 70);
  const rsiMin = Number(
    trendCfg.rsiMin ?? cfg.RSI_MIN ?? helpers.defaults.trendRsiMin ?? 45
  );
  const rsiMax = Number(
    trendCfg.rsiMax ?? cfg.RSI_MAX ?? helpers.defaults.trendRsiMax ?? 68
  );
  const slAtrMult = Number(
    trendCfg.slAtrMult ?? cfg.SL_ATR_MULT ?? helpers.defaults.trendSlAtrMult ?? 1.4
  );
  const tpAtrMult = Number(
    trendCfg.tpAtrMult ?? cfg.TP_ATR_MULT ?? helpers.defaults.trendTpAtrMult ?? 2.4
  );
  const minAdx = Number(trendCfg.minAdx ?? cfg.MIN_ADX ?? helpers.defaults.trendMinAdx ?? 18);
  const maxPullbackPct = Number(
    trendCfg.maxPullbackPct ?? cfg.TREND_MAX_PULLBACK_PCT ?? 0.04
  );
  const requireSr = Boolean(trendCfg.requireSr ?? cfg.REQUIRE_SR ?? false);
  const requireNearPullback = Boolean(
    trendCfg.requireNearPullback ?? cfg.REQUIRE_NEAR_PULLBACK ?? false
  );
  const requireRsiRising = Boolean(
    trendCfg.requireRsiRising ?? cfg.REQUIRE_RSI_RISING ?? false
  );
  const requireRsiFalling = Boolean(
    trendCfg.requireRsiFalling ?? cfg.REQUIRE_RSI_FALLING ?? false
  );

  const htfBullish = Boolean(marketStructure?.htf?.bullish);
  const bullishShift = Boolean(marketStructure?.ltf?.bullishShift);
  const nearEma20 = Boolean(indicators.nearEma20);
  const nearEma50 = Boolean(indicators.nearEma50);
  const rsiOk = Number(indicators.rsi) >= rsiMin && Number(indicators.rsi) <= rsiMax;
  const adxOk = Number(indicators.adx || 0) >= minAdx;
  const rsiRising = Boolean(indicators.rsiRising);
  const pullbackPct = Number(
    marketStructure?.ltf?.pullbackToLastHtfLowPct ?? Number.POSITIVE_INFINITY
  );
  const pullbackOk = Number.isFinite(pullbackPct) && pullbackPct <= maxPullbackPct;
  const aboveEma50 = Number(indicators.entry) >= Number(indicators.ema50);

  // More permissive LTF trigger:
  // - keep bullishShift as the strongest confirmation
  // - also allow a valid pullback while price is structurally above EMA50
  // - or price reacting near EMA20/EMA50 while still above EMA50
  const ltfBullishContext =
    bullishShift ||
    (pullbackOk && aboveEma50) ||
    ((nearEma20 || nearEma50) && aboveEma50);

  let score = 0;
  if (htfBullish) score += 35;
  if (bullishShift) score += 30;
  if (nearEma20 || nearEma50) score += 10;
  if (rsiOk) score += 10;
  if (adxOk) score += 10;
  if (pullbackOk) score += 5;
  score = clamp(score, 0, 100);

  const signalClass = classifySignal(score, minScore);
  const timeframe = String(helpers?.tf || "").toLowerCase();

  if (!enabled) {
    return {
      strategy: "trend",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trend:disabled",
    };
  }

  if (timeframe === "15m" && !allow15m) {
    return {
      strategy: "trend",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trend:disabled_on_15m",
    };
  }

  if (!htfBullish) {
    return {
      strategy: "trend",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trend:htf_not_bullish",
    };
  }

  if (!ltfBullishContext) {
    return {
      strategy: "trend",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trend:ltf_context_not_confirmed",
    };
  }

  if (!aboveEma50) {
    return {
      strategy: "trend",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trend:below_ema50",
    };
  }

  if (!rsiOk) {
    return {
      strategy: "trend",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trend:rsi_out_of_band",
    };
  }

  if (!adxOk) {
    return {
      strategy: "trend",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trend:adx_too_low",
    };
  }

  if (requireNearPullback && !(nearEma20 || nearEma50)) {
    return {
      strategy: "trend",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trend:pullback_required",
    };
  }

  if (requireRsiRising && !rsiRising) {
    return {
      strategy: "trend",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trend:rsi_not_rising",
    };
  }

  if (requireRsiFalling && rsiRising) {
    return {
      strategy: "trend",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trend:rsi_not_falling",
    };
  }

  if (requireSr && !srEvalLong?.passed) {
    return {
      strategy: "trend",
      direction: "LONG",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: `trend:sr_${srEvalLong?.reason || "blocked"}`,
    };
  }

  const entry = Number(indicators.entry);
  const atr = Number(indicators.atr);
  const sl = helpers.round(entry - slAtrMult * atr, 6);
  const tp = helpers.round(entry + tpAtrMult * atr, 6);
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const plannedRr = helpers.safeRatio(reward, risk);

  return {
    strategy: "trend",
    direction: "LONG",
    allowed: signalClass === "EXECUTABLE" && Number.isFinite(plannedRr) && plannedRr > 1,
    score,
    signalClass,
    minScore,
    entry,
    sl,
    tp,
    rawTp: tp,
    tpCappedByResistance: false,
    reason: signalClass === "EXECUTABLE" ? "selected" : "trend:score_too_low",
    meta: {
      plannedRr,
      htfBias: marketStructure?.htf?.bias,
      bullishShift,
      ltfBullishContext,
      pullbackPct,
      rsiMin,
      rsiMax,
      rsiRising,
      requireRsiFalling,
      useZoneFilter: requireSr,
      useObFilter: false,
      srReason: srEvalLong?.reason || null,
    },
  };
}

module.exports = { evaluateTrendStrategy };
