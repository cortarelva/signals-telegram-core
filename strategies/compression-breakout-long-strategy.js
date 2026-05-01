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

function evaluateCompressionBreakoutLong({
  candles,
  atr,
  ema20,
  ema50,
  scoreBase = 0,
}) {
  const ENABLED = String(process.env.COMPRESSION_LONG_ENABLED || "1") === "1";
  if (!ENABLED) {
    return { ok: false, score: 0, reason: "compression_disabled" };
  }

  const BASE_BARS = Number(process.env.COMPRESSION_BASE_BARS || 12);
  const PRELOOKBACK = Number(process.env.COMPRESSION_PRELOOKBACK_BARS || 18);

  const MIN_DROP_PCT = Number(process.env.COMPRESSION_MIN_DROP_PCT || 0.008);
  const MAX_BASE_ATR_MULT = Number(process.env.COMPRESSION_MAX_BASE_ATR_MULT || 3.2);
  const NEAR_HIGH_ATR = Number(process.env.COMPRESSION_NEAR_HIGH_ATR || 0.25);
  const MIN_HIGHER_LOW_DELTA = Number(process.env.COMPRESSION_MIN_HIGHER_LOW_DELTA || 0.0005);
  const MIN_VOL_RATIO = Number(process.env.COMPRESSION_MIN_VOL_RATIO || 1.35);
  const BREAKOUT_CLOSE_BUFFER_ATR = Number(process.env.COMPRESSION_BREAKOUT_CLOSE_BUFFER_ATR || 0.03);
  const SL_BUFFER_ATR = Number(process.env.COMPRESSION_SL_BUFFER_ATR || 0.20);
  const TP_R_MULT = Number(process.env.COMPRESSION_TP_R_MULT || 2.2);
  const MIN_SCORE = Number(process.env.COMPRESSION_MIN_SCORE || 70);

  const STRUCTURE_TP_BASE_MULT = Number(process.env.COMPRESSION_STRUCTURE_TP_BASE_MULT || 0.85);
  const STRUCTURE_TP_ATR_MULT = Number(process.env.COMPRESSION_STRUCTURE_TP_ATR_MULT || 1.20);
  const MIN_TP_R = Number(process.env.COMPRESSION_MIN_TP_R || 1.0);
  const MIN_TP_PCT_AFTER_CAP = Number(process.env.COMPRESSION_MIN_TP_PCT_AFTER_CAP || 0.0015);
  const MIN_TP_ATR_AFTER_CAP = Number(process.env.COMPRESSION_MIN_TP_ATR_AFTER_CAP || 0.60);

  if (!candles || candles.length < PRELOOKBACK + BASE_BARS + 5) {
    return { ok: false, score: 0, reason: "not_enough_candles" };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const baseStart = candles.length - 1 - BASE_BARS;
  const baseCandles = candles.slice(baseStart, candles.length - 1);
  const preCandles = candles.slice(baseStart - PRELOOKBACK, baseStart);

  if (baseCandles.length < BASE_BARS || preCandles.length < PRELOOKBACK) {
    return { ok: false, score: 0, reason: "window_too_small" };
  }

  const baseHigh = highest(baseCandles.map((c) => safeNum(c.high)));
  const baseLow = lowest(baseCandles.map((c) => safeNum(c.low)));
  const preHigh = highest(preCandles.map((c) => safeNum(c.high)));

  const baseRange = baseHigh - baseLow;
  const dropPct = preHigh > 0 ? (preHigh - baseLow) / preHigh : 0;

  const thirds = Math.floor(baseCandles.length / 3);
  const firstThird = baseCandles.slice(0, thirds);
  const middleThird = baseCandles.slice(thirds, thirds * 2);
  const lastThird = baseCandles.slice(thirds * 2);

  const low1 = lowest(firstThird.map((c) => safeNum(c.low)));
  const low2 = lowest(middleThird.map((c) => safeNum(c.low)));
  const low3 = lowest(lastThird.map((c) => safeNum(c.low)));

  const higherLows =
    low2 > low1 * (1 + MIN_HIGHER_LOW_DELTA) &&
    low3 > low2 * (1 + MIN_HIGHER_LOW_DELTA);

  const firstHalf = baseCandles.slice(0, Math.floor(baseCandles.length / 2));
  const secondHalf = baseCandles.slice(Math.floor(baseCandles.length / 2));

  const firstHalfRange =
    highest(firstHalf.map((c) => safeNum(c.high))) -
    lowest(firstHalf.map((c) => safeNum(c.low)));

  const secondHalfRange =
    highest(secondHalf.map((c) => safeNum(c.high))) -
    lowest(secondHalf.map((c) => safeNum(c.low)));

  const compressionOk = secondHalfRange < firstHalfRange * 0.85;
  const noFreshBreakdown = low3 > baseLow * 1.0002;

  const distToHigh = baseHigh - safeNum(last.close);
  const nearHigh = distToHigh <= atr * NEAR_HIGH_ATR;

  const volLookback = candles.slice(Math.max(0, candles.length - 21), candles.length - 1);
  const avgVol20 = avg(volLookback.map((c) => safeNum(c.volume)));
  const volRatio = avgVol20 > 0 ? safeNum(last.volume) / avgVol20 : 0;

  const breakoutCloseLevel = baseHigh + atr * BREAKOUT_CLOSE_BUFFER_ATR;
  const breakout =
    safeNum(last.close) > breakoutCloseLevel && safeNum(last.close) > safeNum(prev.high);

  const emaAlignment = safeNum(last.close) > ema20 && ema20 > ema50;
  const bullishCandle = safeNum(last.close) > safeNum(last.open);
  const baseTightEnough = baseRange <= atr * MAX_BASE_ATR_MULT;

  let score = scoreBase;
  if (dropPct >= MIN_DROP_PCT) score += 20;
  if (baseTightEnough) score += 10;
  if (higherLows) score += 15;
  if (compressionOk) score += 15;
  if (noFreshBreakdown) score += 10;
  if (nearHigh) score += 10;
  if (emaAlignment) score += 10;
  if (bullishCandle) score += 5;
  if (breakout) score += 20;
  if (volRatio >= MIN_VOL_RATIO) score += 20;

  const reasons = [];
  if (dropPct < MIN_DROP_PCT) reasons.push("drop_too_small");
  if (!baseTightEnough) reasons.push("base_too_wide");
  if (!higherLows) reasons.push("no_higher_lows");
  if (!compressionOk) reasons.push("no_compression");
  if (!noFreshBreakdown) reasons.push("fresh_breakdown");
  if (!nearHigh) reasons.push("not_near_range_high");
  if (!emaAlignment) reasons.push("ema_not_aligned");
  if (!bullishCandle) reasons.push("weak_breakout_candle");
  if (!breakout) reasons.push("no_breakout_close");
  if (volRatio < MIN_VOL_RATIO) reasons.push("volume_not_expanded");

  if (!(breakout && volRatio >= MIN_VOL_RATIO && higherLows && compressionOk && score >= MIN_SCORE)) {
    return {
      ok: false,
      score,
      reason: reasons.join(" | "),
      meta: { dropPct, volRatio, baseRange, baseHigh, baseLow, low1, low2, low3 },
    };
  }

  const entry = safeNum(last.close);
  const stop = Math.min(low3, baseLow) - atr * SL_BUFFER_ATR;
  const risk = entry - stop;

  if (!(risk > 0)) {
    return { ok: false, score, reason: "invalid_risk" };
  }

  const tpByR = entry + risk * TP_R_MULT;
  const structureMove = Math.max(baseRange * STRUCTURE_TP_BASE_MULT, atr * STRUCTURE_TP_ATR_MULT);
  const tpByStructure = baseHigh + structureMove;
  const tp = Math.min(tpByR, tpByStructure);

  const tpDistance = tp - entry;
  const tpR = risk > 0 ? tpDistance / risk : 0;
  const tpPctAfterCap = entry > 0 ? tpDistance / entry : 0;
  const tpAtrAfterCap = atr > 0 ? tpDistance / atr : 0;

  if (!(tpDistance > 0)) {
    return { ok: false, score, reason: "invalid_tp_distance" };
  }

  if (tpR < MIN_TP_R) {
    return {
      ok: false,
      score,
      reason: `tp_too_close_after_structure_cap:${tpR.toFixed(2)}R`,
      meta: { tpByR, tpByStructure, tpR, tpPctAfterCap, tpAtrAfterCap },
    };
  }

  if (tpPctAfterCap < MIN_TP_PCT_AFTER_CAP) {
    return {
      ok: false,
      score,
      reason: `tp_pct_too_small_after_cap:${(tpPctAfterCap * 100).toFixed(2)}%`,
      meta: { tpByR, tpByStructure, tpR, tpPctAfterCap, tpAtrAfterCap },
    };
  }

  if (tpAtrAfterCap < MIN_TP_ATR_AFTER_CAP) {
    return {
      ok: false,
      score,
      reason: `tp_atr_too_small_after_cap:${tpAtrAfterCap.toFixed(2)}ATR`,
      meta: { tpByR, tpByStructure, tpR, tpPctAfterCap, tpAtrAfterCap },
    };
  }

  return {
    ok: true,
    score,
    strategy: "compressionBreakoutLong",
    entry,
    sl: stop,
    tp,
    reason: "selected",
    meta: {
      dropPct,
      volRatio,
      baseRange,
      baseHigh,
      baseLow,
      low1,
      low2,
      low3,
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

function evaluateCompressionBreakoutLongStrategy(ctx) {
  const minScore = safeNum(process.env.COMPRESSION_MIN_SCORE, 70);

  const res = evaluateCompressionBreakoutLong({
    candles: Array.isArray(ctx?.candles) ? ctx.candles : [],
    atr: safeNum(ctx?.atr),
    ema20: safeNum(ctx?.ema20),
    ema50: safeNum(ctx?.ema50),
    scoreBase: 0,
  });

  if (!res.ok) {
    return {
      strategy: "compressionBreakoutLong",
      allowed: false,
      score: safeNum(res.score),
      minScore,
      signalClass: classifyScore(safeNum(res.score), minScore),
      reason: res.reason || "not_selected",
      direction: "LONG",
    };
  }

  return {
    strategy: "compressionBreakoutLong",
    allowed: true,
    score: safeNum(res.score),
    minScore,
    signalClass: "EXECUTABLE",
    reason: res.reason || "selected",
    direction: "LONG",
    entry: res.entry,
    sl: res.sl,
    tp: res.tp,
    meta: res.meta,
  };
}

module.exports = { evaluateCompressionBreakoutLongStrategy };
