const { clamp } = require("../indicators/market-indicators");

function classifySignal(score, minExecutableScore = 90) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function evaluateOversoldBounceStrategy(ctx) {
  const { cfg, indicators, candles, nearestResistance, helpers } = ctx;

  const bounceCfg = cfg.OVERSOLD_BOUNCE || {};
  const enabled = bounceCfg.enabled !== false;

  const minScore = Number(bounceCfg.minScore ?? cfg.MIN_SCORE ?? 60);
  const minAdx = Number(bounceCfg.minAdx ?? 0);
  const maxRsi = Number(bounceCfg.maxRsi ?? 38);
  const minRsiRecovery = Number(bounceCfg.minRsiRecovery ?? 1.5);
  const minDropAtr = Number(bounceCfg.minDropAtr ?? 1.8);
  const minBullRecoveryBodyAtr = Number(bounceCfg.minBullRecoveryBodyAtr ?? 0.15);
  const minRelativeVolume = Number(bounceCfg.minRelativeVolume ?? 1.05);
  const slAtrMult = Number(bounceCfg.slAtrMult ?? 1.2);
  const tpAtrMult = Number(bounceCfg.tpAtrMult ?? 1.8);
  const requireVolume = bounceCfg.requireVolume ?? true;

  const tpResistanceBufferAtr = Number(
    bounceCfg.tpResistanceBufferAtr ??
      cfg.OVERSOLD_BOUNCE_TP_RESISTANCE_BUFFER_ATR ??
      cfg.TP_RESISTANCE_BUFFER_ATR ??
      0.18
  );
  const minRrAfterCap = Number(
    bounceCfg.minRrAfterCap ??
      cfg.OVERSOLD_BOUNCE_MIN_RR_AFTER_CAP ??
      cfg.MIN_RR_AFTER_CAP ??
      0.75
  );
  const minTpPctAfterCap = Number(
    bounceCfg.minTpPctAfterCap ??
      cfg.OVERSOLD_BOUNCE_MIN_TP_PCT_AFTER_CAP ??
      cfg.MIN_TP_PCT_AFTER_CAP ??
      0.0012
  );
  const minTpAtrAfterCap = Number(
    bounceCfg.minTpAtrAfterCap ??
      cfg.OVERSOLD_BOUNCE_MIN_TP_ATR_AFTER_CAP ??
      cfg.MIN_TP_ATR_AFTER_CAP ??
      0.55
  );

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const lookback = candles.slice(-8);
  const recentHigh = Math.max(...lookback.map((c) => c.high));
  const recentLow = Math.min(...lookback.map((c) => c.low));

  const recentDropAtr = indicators.atr > 0 ? (recentHigh - indicators.entry) / indicators.atr : 0;
  const body = Math.abs(last.close - last.open);
  const bodyAtr = indicators.atr > 0 ? body / indicators.atr : 0;
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const lowerWickAtr = indicators.atr > 0 ? lowerWick / indicators.atr : 0;
  const rsiRecovery = indicators.rsi - indicators.prevRsi;
  const relativeVol = indicators.avgVol > 0 ? last.volume / indicators.avgVol : null;

  let score = 0;
  if (!indicators.bullish) score += 10;
  if (indicators.rsi <= maxRsi) score += 20;
  if (rsiRecovery >= minRsiRecovery) score += 20;
  if (recentDropAtr >= minDropAtr) score += 20;
  if (bodyAtr >= minBullRecoveryBodyAtr && last.close > prev.close) score += 15;
  if (lowerWickAtr >= 0.2) score += 10;
  if (Number.isFinite(relativeVol) && relativeVol >= minRelativeVolume) score += 10;

  score = clamp(score, 0, 100);
  const signalClass = classifySignal(score, minScore);

  const baseAllowed =
    enabled &&
    Number(indicators.adx || 0) >= minAdx &&
    indicators.rsi <= maxRsi &&
    rsiRecovery >= minRsiRecovery &&
    recentDropAtr >= minDropAtr &&
    bodyAtr >= minBullRecoveryBodyAtr &&
    last.close > prev.close &&
    (!requireVolume || (Number.isFinite(relativeVol) && relativeVol >= minRelativeVolume)) &&
    (signalClass === "EXECUTABLE" || (signalClass === "WATCH" && score >= Math.max(55, minScore - 5)));

  if (!baseAllowed) {
    return {
      strategy: "oversoldBounce",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "bounce:rules_not_met",
      meta: { relativeVol, recentDropAtr, bodyAtr, lowerWickAtr, rsiRecovery, recentLow },
    };
  }

  const sl = helpers.round(indicators.entry - slAtrMult * indicators.atr, 6);
  const rawTp = helpers.round(indicators.entry + tpAtrMult * indicators.atr, 6);

  const tpCandidates = [rawTp];

  if (
    Number.isFinite(Number(recentHigh)) &&
    Number(recentHigh) > Number(indicators.entry) &&
    Number.isFinite(Number(indicators.atr)) &&
    Number(indicators.atr) > 0
  ) {
    const recentHighCap = helpers.round(
      Number(recentHigh) - Number(indicators.atr) * tpResistanceBufferAtr,
      6
    );

    if (recentHighCap > Number(indicators.entry)) {
      tpCandidates.push(recentHighCap);
    }
  }

  if (
    nearestResistance &&
    Number.isFinite(Number(nearestResistance.price)) &&
    Number(nearestResistance.price) > Number(indicators.entry) &&
    Number.isFinite(Number(indicators.atr)) &&
    Number(indicators.atr) > 0
  ) {
    const resistanceCap = helpers.round(
      Number(nearestResistance.price) - Number(indicators.atr) * tpResistanceBufferAtr,
      6
    );

    if (resistanceCap > Number(indicators.entry)) {
      tpCandidates.push(resistanceCap);
    }
  }

  let tp = Math.min(...tpCandidates.filter((v) => Number.isFinite(Number(v)) && Number(v) > Number(indicators.entry)));
  if (!Number.isFinite(tp)) tp = rawTp;

  const tpCappedByResistance = Number(tp) < Number(rawTp);
  const risk = Math.abs(Number(indicators.entry) - Number(sl));
  const reward = Math.abs(Number(tp) - Number(indicators.entry));
  const plannedRr = helpers.safeRatio(reward, risk);
  const tpPctAfterCap = Number(indicators.entry) > 0 ? reward / Number(indicators.entry) : null;
  const tpAtrAfterCap = Number(indicators.atr) > 0 ? reward / Number(indicators.atr) : null;

  if (!Number.isFinite(risk) || !Number.isFinite(reward) || risk <= 0 || reward <= 0) {
    return {
      strategy: "oversoldBounce",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "bounce:invalid_rr",
      meta: { relativeVol, recentDropAtr, bodyAtr, lowerWickAtr, rsiRecovery, recentLow, plannedRr, tpPctAfterCap, tpAtrAfterCap },
    };
  }

  if (tpCappedByResistance && (!Number.isFinite(plannedRr) || plannedRr < minRrAfterCap)) {
    return {
      strategy: "oversoldBounce",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "bounce:tp_capped_rr_too_low",
      meta: { relativeVol, recentDropAtr, bodyAtr, lowerWickAtr, rsiRecovery, recentLow, plannedRr, tpPctAfterCap, tpAtrAfterCap },
    };
  }

  if (tpCappedByResistance && (!Number.isFinite(tpPctAfterCap) || tpPctAfterCap < minTpPctAfterCap)) {
    return {
      strategy: "oversoldBounce",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "bounce:tp_after_cap_too_small_pct",
      meta: { relativeVol, recentDropAtr, bodyAtr, lowerWickAtr, rsiRecovery, recentLow, plannedRr, tpPctAfterCap, tpAtrAfterCap },
    };
  }

  if (tpCappedByResistance && (!Number.isFinite(tpAtrAfterCap) || tpAtrAfterCap < minTpAtrAfterCap)) {
    return {
      strategy: "oversoldBounce",
      allowed: false,
      score,
      signalClass,
      minScore,
      reason: "bounce:tp_after_cap_too_small_atr",
      meta: { relativeVol, recentDropAtr, bodyAtr, lowerWickAtr, rsiRecovery, recentLow, plannedRr, tpPctAfterCap, tpAtrAfterCap },
    };
  }

  return {
    strategy: "oversoldBounce",
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
      relativeVol,
      recentDropAtr,
      bodyAtr,
      lowerWickAtr,
      rsiRecovery,
      recentLow,
      plannedRr,
      tpPctAfterCap,
      tpAtrAfterCap,
      tpMode: tpCappedByResistance ? "structure_capped" : "atr_raw",
    },
  };
}

module.exports = { evaluateOversoldBounceStrategy };
