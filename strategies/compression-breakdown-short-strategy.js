function highest(arr) {
  return Math.max(...arr);
}

function lowest(arr) {
  return Math.min(...arr);
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function classifyScore(score, minScore) {
  if (score >= minScore) return "EXECUTABLE";
  if (score >= Math.max(40, minScore - 15)) return "WATCH";
  return "IGNORE";
}

function evaluateCompressionBreakdownShortStrategy(ctx) {
  const ENABLED = String(process.env.COMPRESSION_SHORT_ENABLED || "1") === "1";
  if (!ENABLED) {
    return {
      strategy: "compressionBreakdownShort",
      allowed: false,
      score: 0,
      minScore: safeNum(process.env.COMPRESSION_SHORT_MIN_SCORE, 70),
      signalClass: "IGNORE",
      reason: "compression_short_disabled",
      direction: "SHORT",
    };
  }

  const candles = Array.isArray(ctx?.candles) ? ctx.candles : [];
  const atr = safeNum(ctx?.atr);
  const ema20 = safeNum(ctx?.ema20);
  const ema50 = safeNum(ctx?.ema50);

  const BASE_BARS = safeNum(process.env.COMPRESSION_SHORT_BASE_BARS, 12);
  const PRELOOKBACK = safeNum(process.env.COMPRESSION_SHORT_PRELOOKBACK_BARS, 18);

  const MIN_RALLY_PCT = safeNum(process.env.COMPRESSION_SHORT_MIN_RALLY_PCT, 0.008);
  const MAX_BASE_ATR_MULT = safeNum(process.env.COMPRESSION_SHORT_MAX_BASE_ATR_MULT, 3.2);
  const NEAR_LOW_ATR = safeNum(process.env.COMPRESSION_SHORT_NEAR_LOW_ATR, 0.25);

  const MIN_LOWER_HIGH_DELTA = safeNum(process.env.COMPRESSION_SHORT_MIN_LOWER_HIGH_DELTA, 0.0005);
  const MIN_VOL_RATIO = safeNum(process.env.COMPRESSION_SHORT_MIN_VOL_RATIO, 1.35);

  const BREAKDOWN_CLOSE_BUFFER_ATR = safeNum(process.env.COMPRESSION_SHORT_BREAKDOWN_CLOSE_BUFFER_ATR, 0.03);
  const SL_BUFFER_ATR = safeNum(process.env.COMPRESSION_SHORT_SL_BUFFER_ATR, 0.20);
  const TP_R_MULT = safeNum(process.env.COMPRESSION_SHORT_TP_R_MULT, 2.2);

  const MIN_SCORE = safeNum(process.env.COMPRESSION_SHORT_MIN_SCORE, 70);
  const STRUCTURE_TP_BASE_MULT = safeNum(process.env.COMPRESSION_SHORT_STRUCTURE_TP_BASE_MULT, 0.85);
  const STRUCTURE_TP_ATR_MULT = safeNum(process.env.COMPRESSION_SHORT_STRUCTURE_TP_ATR_MULT, 1.20);
  const MIN_TP_R = safeNum(process.env.COMPRESSION_SHORT_MIN_TP_R, 1.0);
  const MIN_TP_PCT_AFTER_CAP = safeNum(process.env.COMPRESSION_SHORT_MIN_TP_PCT_AFTER_CAP, 0.0015);
  const MIN_TP_ATR_AFTER_CAP = safeNum(process.env.COMPRESSION_SHORT_MIN_TP_ATR_AFTER_CAP, 0.60);

  if (!candles.length || candles.length < PRELOOKBACK + BASE_BARS + 5) {
    return {
      strategy: "compressionBreakdownShort",
      allowed: false,
      score: 0,
      minScore: MIN_SCORE,
      signalClass: "IGNORE",
      reason: "not_enough_candles",
      direction: "SHORT",
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const baseStart = candles.length - 1 - BASE_BARS;
  const baseCandles = candles.slice(baseStart, candles.length - 1);
  const preCandles = candles.slice(baseStart - PRELOOKBACK, baseStart);

  if (baseCandles.length < BASE_BARS || preCandles.length < PRELOOKBACK) {
    return {
      strategy: "compressionBreakdownShort",
      allowed: false,
      score: 0,
      minScore: MIN_SCORE,
      signalClass: "IGNORE",
      reason: "window_too_small",
      direction: "SHORT",
    };
  }

  const baseHigh = highest(baseCandles.map((c) => safeNum(c.high)));
  const baseLow = lowest(baseCandles.map((c) => safeNum(c.low)));
  const preLow = lowest(preCandles.map((c) => safeNum(c.low)));

  const baseRange = baseHigh - baseLow;
  const rallyPct = preLow > 0 ? (baseHigh - preLow) / preLow : 0;

  const thirds = Math.floor(baseCandles.length / 3);
  const firstThird = baseCandles.slice(0, thirds);
  const middleThird = baseCandles.slice(thirds, thirds * 2);
  const lastThird = baseCandles.slice(thirds * 2);

  const high1 = highest(firstThird.map((c) => safeNum(c.high)));
  const high2 = highest(middleThird.map((c) => safeNum(c.high)));
  const high3 = highest(lastThird.map((c) => safeNum(c.high)));

  const lowerHighs =
    high2 < high1 * (1 - MIN_LOWER_HIGH_DELTA) &&
    high3 < high2 * (1 - MIN_LOWER_HIGH_DELTA);

  const firstHalf = baseCandles.slice(0, Math.floor(baseCandles.length / 2));
  const secondHalf = baseCandles.slice(Math.floor(baseCandles.length / 2));

  const firstHalfRange =
    highest(firstHalf.map((c) => safeNum(c.high))) -
    lowest(firstHalf.map((c) => safeNum(c.low)));

  const secondHalfRange =
    highest(secondHalf.map((c) => safeNum(c.high))) -
    lowest(secondHalf.map((c) => safeNum(c.low)));

  const compressionOk = secondHalfRange < firstHalfRange * 0.85;
  const noFreshBreakout = high3 < baseHigh * 0.9998;

  const distToLow = last.close - baseLow;
  const nearLow = distToLow <= atr * NEAR_LOW_ATR;

  const volLookback = candles.slice(Math.max(0, candles.length - 21), candles.length - 1);
  const avgVol20 = avg(volLookback.map((c) => safeNum(c.volume)));
  const volRatio = avgVol20 > 0 ? safeNum(last.volume) / avgVol20 : 0;

  const breakdownCloseLevel = baseLow - atr * BREAKDOWN_CLOSE_BUFFER_ATR;
  const breakdown = safeNum(last.close) < breakdownCloseLevel && safeNum(last.close) < safeNum(prev.low);

  const emaAlignment = safeNum(last.close) < ema20 && ema20 < ema50;
  const bearishCandle = safeNum(last.close) < safeNum(last.open);
  const baseTightEnough = baseRange <= atr * MAX_BASE_ATR_MULT;

  let score = 0;
  if (rallyPct >= MIN_RALLY_PCT) score += 20;
  if (baseTightEnough) score += 10;
  if (lowerHighs) score += 15;
  if (compressionOk) score += 15;
  if (noFreshBreakout) score += 10;
  if (nearLow) score += 10;
  if (emaAlignment) score += 10;
  if (bearishCandle) score += 5;
  if (breakdown) score += 20;
  if (volRatio >= MIN_VOL_RATIO) score += 20;

  const reasons = [];
  if (rallyPct < MIN_RALLY_PCT) reasons.push("rally_too_small");
  if (!baseTightEnough) reasons.push("base_too_wide");
  if (!lowerHighs) reasons.push("no_lower_highs");
  if (!compressionOk) reasons.push("no_compression");
  if (!noFreshBreakout) reasons.push("fresh_breakout");
  if (!nearLow) reasons.push("not_near_range_low");
  if (!emaAlignment) reasons.push("ema_not_aligned");
  if (!bearishCandle) reasons.push("weak_breakdown_candle");
  if (!breakdown) reasons.push("no_breakdown_close");
  if (volRatio < MIN_VOL_RATIO) reasons.push("volume_not_expanded");

  const signalClass = classifyScore(score, MIN_SCORE);

  if (!(breakdown && volRatio >= MIN_VOL_RATIO && lowerHighs && compressionOk && score >= MIN_SCORE)) {
    return {
      strategy: "compressionBreakdownShort",
      allowed: false,
      score,
      minScore: MIN_SCORE,
      signalClass,
      reason: reasons.join(" | "),
      direction: "SHORT",
    };
  }

  const entry = safeNum(last.close);
  const sl = Math.max(high3, baseHigh) + atr * SL_BUFFER_ATR;
  const risk = sl - entry;

  if (!(risk > 0)) {
    return {
      strategy: "compressionBreakdownShort",
      allowed: false,
      score,
      minScore: MIN_SCORE,
      signalClass,
      reason: "invalid_risk",
      direction: "SHORT",
    };
  }

  const tpByR = entry - risk * TP_R_MULT;
  const structureMove = Math.max(baseRange * STRUCTURE_TP_BASE_MULT, atr * STRUCTURE_TP_ATR_MULT);
  const tpByStructure = baseLow - structureMove;
  const tp = Math.max(tpByR, tpByStructure);

  const tpDistance = entry - tp;
  const tpR = risk > 0 ? tpDistance / risk : 0;
  const tpPctAfterCap = entry > 0 ? tpDistance / entry : 0;
  const tpAtrAfterCap = atr > 0 ? tpDistance / atr : 0;

  if (!(tpDistance > 0)) {
    return {
      strategy: "compressionBreakdownShort",
      allowed: false,
      score,
      minScore: MIN_SCORE,
      signalClass,
      reason: "invalid_tp_distance",
      direction: "SHORT",
    };
  }

  if (tpR < MIN_TP_R) {
    return {
      strategy: "compressionBreakdownShort",
      allowed: false,
      score,
      minScore: MIN_SCORE,
      signalClass,
      reason: `tp_too_close_after_structure_cap:${tpR.toFixed(2)}R`,
      direction: "SHORT",
    };
  }

  if (tpPctAfterCap < MIN_TP_PCT_AFTER_CAP) {
    return {
      strategy: "compressionBreakdownShort",
      allowed: false,
      score,
      minScore: MIN_SCORE,
      signalClass,
      reason: `tp_pct_too_small_after_cap:${(tpPctAfterCap * 100).toFixed(2)}%`,
      direction: "SHORT",
    };
  }

  if (tpAtrAfterCap < MIN_TP_ATR_AFTER_CAP) {
    return {
      strategy: "compressionBreakdownShort",
      allowed: false,
      score,
      minScore: MIN_SCORE,
      signalClass,
      reason: `tp_atr_too_small_after_cap:${tpAtrAfterCap.toFixed(2)}ATR`,
      direction: "SHORT",
    };
  }

  return {
    strategy: "compressionBreakdownShort",
    allowed: true,
    score,
    minScore: MIN_SCORE,
    signalClass: "EXECUTABLE",
    reason: "selected",
    direction: "SHORT",
    entry,
    sl,
    tp,
    meta: {
      baseRange,
      baseHigh,
      baseLow,
      risk,
      tpByR,
      tpByStructure,
      tpR,
      tpPctAfterCap,
      tpAtrAfterCap,
      tpMode: tp === tpByR ? "risk_multiple" : "structure_capped",
    },
  };
}

module.exports = { evaluateCompressionBreakdownShortStrategy };
