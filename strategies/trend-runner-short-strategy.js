const { clamp } = require("../indicators/market-indicators");

function classifySignal(score, minExecutableScore = 70) {
  if (score >= minExecutableScore) return "EXECUTABLE";
  if (score >= 45) return "WATCH";
  return "IGNORE";
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function max(arr) {
  return Math.max(...arr);
}

function min(arr) {
  return Math.min(...arr);
}

/**
 * Trend Runner (SHORT)
 * Mirror of LONG: strong downtrend continuation after tight base breakdown.
 */
function evaluateTrendRunnerShortStrategy(ctx) {
  const { cfg, indicators, srEval, nearestSupport, helpers } = ctx;
  const runnerCfg = cfg.TREND_RUNNER_SHORT || cfg.TREND_RUNNER || {};

  const candles = indicators?.candles || [];
  const atr = Number(indicators?.atr || 0);
  const price = Number(indicators?.price || 0);

  if (!candles.length || !atr || !price) {
    return { allowed: false, score: 0, reason: "missing_data" };
  }

  const last = candles[candles.length - 1];
  const lastClose = Number(last.close);
  const lastOpen = Number(last.open);
  const lastVol = Number(last.volume || 0);

  const ema20 = Number(indicators.ema20 || 0);
  const ema50 = Number(indicators.ema50 || 0);
  const ema200 = Number(indicators.ema200 || 0);
  const adx = Number(indicators.adx || 0);

  const baseLookback = Number(runnerCfg.baseLookback ?? 14);
  const minAdx = Number(runnerCfg.minAdx ?? cfg.MIN_ADX ?? 18);
  const minScore = Number(
    runnerCfg.minScore ?? cfg.MIN_SCORE ?? Math.max(62, helpers.paperMinScore)
  );

  const maxBaseRangePct = Number(runnerCfg.maxBaseRangePct ?? 0.9);
  const breakdownBufferPct = Number(runnerCfg.breakdownBufferPct ?? 0.05);
  const volMult = Number(runnerCfg.volMult ?? 1.4);
  const minBodyPct = Number(runnerCfg.minBodyPct ?? 0.08);
  const maxExtensionAtr = Number(runnerCfg.maxExtensionAtr ?? 1.0);

  const slAtr = Number(runnerCfg.slAtr ?? 1.8);
  const tpAtr = Number(runnerCfg.tpAtr ?? 2.2);
  const tpCapBufferAtr = Number(runnerCfg.tpCapBufferAtr ?? 0.25);

  const bearishStack = ema20 < ema50 && ema50 < ema200;
  const isBearishCandle = lastClose < lastOpen;
  const bodyPct = (Math.abs(lastClose - lastOpen) / Math.max(1e-9, price)) * 100;
  const extensionAtr = ema20 ? (ema20 - lastClose) / atr : 999;

  const reasons = [];
  if (!bearishStack) reasons.push("ema_not_stacked");
  if (adx < minAdx) reasons.push("adx_too_low");
  if (extensionAtr > maxExtensionAtr) reasons.push("too_extended_below_ema20");

  const lb = Math.min(baseLookback, candles.length - 2);
  const base = candles.slice(candles.length - 1 - lb, candles.length - 1);
  const baseHigh = max(base.map((c) => Number(c.high)));
  const baseLow = min(base.map((c) => Number(c.low)));
  const baseRangePct = ((baseHigh - baseLow) / Math.max(1e-9, price)) * 100;

  const baseOk = baseRangePct <= maxBaseRangePct;
  if (!baseOk) reasons.push("base_too_wide");

  const breakdownOk = lastClose < baseLow * (1 - breakdownBufferPct / 100);
  if (!breakdownOk) reasons.push("no_breakdown_close");

  const avgVol = avg(base.map((c) => Number(c.volume || 0))) || 0;
  const volOk = avgVol > 0 ? lastVol >= avgVol * volMult : false;
  if (!volOk) reasons.push("volume_not_expanded");

  const bodyOk = bodyPct >= minBodyPct;
  if (!bodyOk) reasons.push("weak_breakdown_candle");

  // SR safety: if support is very close, runner is pointless.
  let support = nearestSupport?.price ?? null;
  let supportDistanceAtr = null;
  if (support && atr > 0) {
    supportDistanceAtr = (lastClose - support) / atr;
    const minSupDistanceAtr = Number(runnerCfg.minSupportDistanceAtr ?? 0.6);
    if (supportDistanceAtr < minSupDistanceAtr) reasons.push("support_too_close");
  }

  let score = 0;
  if (bearishStack) score += 20;
  if (adx >= minAdx) score += 10;
  if (baseOk) score += 20;
  if (breakdownOk) score += 20;
  if (volOk) score += 15;
  if (bodyOk && isBearishCandle) score += 10;
  if (extensionAtr <= maxExtensionAtr) score += 5;
  score = clamp(score, 0, 100);

  const allowed = score >= minScore && reasons.length === 0;
  if (!allowed) {
    return { allowed: false, score, reason: reasons.join(" | ") || "rules_not_met" };
  }

  const entry = lastClose;
  const sl = Math.max(entry + slAtr * atr, baseHigh + 0.2 * atr);
  const tpRaw = entry - tpAtr * atr;

  let tp = tpRaw;
  let tpCappedBySupport = false;
  if (support) {
    const tpCap = support + tpCapBufferAtr * atr;
    if (tpCap < entry && tpCap > tp) {
      tp = tpCap;
      tpCappedBySupport = true;
    }
  }

  const minTpDistanceAtr = Number(runnerCfg.minTpDistanceAtr ?? 0.6);
  if ((entry - tp) / atr < minTpDistanceAtr) {
    return { allowed: false, score, reason: "tp_after_cap_too_small" };
  }

  return {
    allowed: true,
    score,
    class: classifySignal(score, minScore),
    direction: "SHORT",
    strategy: "trendRunnerShort",
    entry,
    sl,
    tp,
    meta: {
      baseLookback,
      baseRangePct,
      breakdownBufferPct,
      volMult,
      support,
      supportDistanceAtr,
      tpRaw,
      tpCappedBySupport,
      srEval,
      nearSup: nearestSupport || null,
    },
  };
}

module.exports = { evaluateTrendRunnerShortStrategy };
