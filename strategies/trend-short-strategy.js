function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function classifySignal(score, minExecutableScore = 70) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function evaluateTrendShortStrategy(ctx) {
  const { indicators, marketStructure, helpers, cfg, srEvalShort } = ctx;

  const shortCfg = cfg.TREND_SHORT || {};
  const enabled = shortCfg.enabled !== false;
  const minScore = Number(shortCfg.minScore ?? cfg.MIN_SCORE ?? 70);
  const rsiMin = Number(shortCfg.rsiMin ?? 32);
  const rsiMax = Number(shortCfg.rsiMax ?? 55);
  const slAtrMult = Number(
    shortCfg.slAtrMult ?? cfg.SL_ATR_MULT ?? helpers.defaults.trendSlAtrMult ?? 1.4
  );
  const tpAtrMult = Number(
    shortCfg.tpAtrMult ?? cfg.TP_ATR_MULT ?? helpers.defaults.trendTpAtrMult ?? 2.4
  );
  const minAdx = Number(shortCfg.minAdx ?? cfg.MIN_ADX ?? helpers.defaults.trendMinAdx ?? 18);
  const maxPullbackPct = Number(
    shortCfg.maxPullbackPct ?? cfg.TREND_SHORT_MAX_PULLBACK_PCT ?? 0.04
  );
  const requireSr = Boolean(shortCfg.requireSr ?? cfg.REQUIRE_SR ?? false);
  const requireNearPullback = Boolean(
    shortCfg.requireNearPullback ?? cfg.REQUIRE_NEAR_PULLBACK ?? false
  );
  const requireRsiFalling = Boolean(shortCfg.requireRsiFalling ?? false);

  const htfBearish = Boolean(marketStructure?.htf?.bearish);
  const bearishShift = Boolean(marketStructure?.ltf?.bearishShift);
  const nearEma20 = Boolean(indicators.nearEma20);
  const nearEma50 = Boolean(indicators.nearEma50);
  const rsiOk = Number(indicators.rsi) >= rsiMin && Number(indicators.rsi) <= rsiMax;
  const adxOk = Number(indicators.adx || 0) >= minAdx;
  const rsiRising = Boolean(indicators.rsiRising);
  const pullbackPct = Number(
    marketStructure?.ltf?.pullbackToLastHtfHighPct ?? Number.POSITIVE_INFINITY
  );
  const pullbackOk = Number.isFinite(pullbackPct) && pullbackPct <= maxPullbackPct;
  const belowEma50 = Number(indicators.entry) <= Number(indicators.ema50);

  // More permissive LTF trigger:
  // - keep bearishShift as the strongest confirmation
  // - also allow a valid pullback while price is structurally below EMA50
  // - or price reacting near EMA20/EMA50 while still below EMA50
  const ltfBearishContext =
    bearishShift ||
    (pullbackOk && belowEma50) ||
    ((nearEma20 || nearEma50) && belowEma50);

  let score = 0;
  if (htfBearish) score += 35;
  if (bearishShift) score += 30;
  if (nearEma20 || nearEma50) score += 10;
  if (rsiOk) score += 10;
  if (adxOk) score += 10;
  if (pullbackOk) score += 5;
  score = clamp(score, 0, 100);

  const signalClass = classifySignal(score, minScore);

  if (!enabled) {
    return {
      strategy: "trendShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trendShort:disabled",
    };
  }

  if (!htfBearish) {
    return {
      strategy: "trendShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trendShort:htf_not_bearish",
    };
  }

  if (!ltfBearishContext) {
    return {
      strategy: "trendShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trendShort:ltf_context_not_confirmed",
    };
  }

  if (!belowEma50) {
    return {
      strategy: "trendShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trendShort:above_ema50",
    };
  }

  if (!rsiOk) {
    return {
      strategy: "trendShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trendShort:rsi_out_of_band",
    };
  }

  if (!adxOk) {
    return {
      strategy: "trendShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trendShort:adx_too_low",
    };
  }

  if (requireNearPullback && !(nearEma20 || nearEma50)) {
    return {
      strategy: "trendShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trendShort:pullback_required",
    };
  }

  if (requireRsiFalling && rsiRising) {
    return {
      strategy: "trendShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "trendShort:rsi_not_falling",
    };
  }

  if (requireSr && !srEvalShort?.passed) {
    return {
      strategy: "trendShort",
      direction: "SHORT",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: `trendShort:sr_${srEvalShort?.reason || "blocked"}`,
    };
  }

  const entry = Number(indicators.entry);
  const atr = Number(indicators.atr);
  const sl = helpers.round(entry + slAtrMult * atr, 6);
  const tp = helpers.round(entry - tpAtrMult * atr, 6);
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(entry - tp);
  const plannedRr = helpers.safeRatio(reward, risk);

  return {
    strategy: "trendShort",
    direction: "SHORT",
    allowed: signalClass === "EXECUTABLE" && Number.isFinite(plannedRr) && plannedRr > 1,
    score,
    signalClass,
    minScore,
    entry,
    sl,
    tp,
    rawTp: tp,
    tpCappedBySupport: false,
    reason: signalClass === "EXECUTABLE" ? "selected" : "trendShort:score_too_low",
    meta: {
      plannedRr,
      htfBias: marketStructure?.htf?.bias,
      bearishShift,
      ltfBearishContext,
      pullbackPct,
      rsiMin,
      rsiMax,
      rsiRising,
      useZoneFilter: requireSr,
      useObFilter: false,
      srReason: srEvalShort?.reason || null,
    },
  };
}

module.exports = { evaluateTrendShortStrategy };
