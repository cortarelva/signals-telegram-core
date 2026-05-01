/**
 * IMPULSE_BREAKOUT_SHORT
 *
 * Versão short do mesmo conceito:
 * - Base curta/apertada
 * - Candle de breakdown com corpo grande + volume acima da média
 * - SL/TP “normal” por ATR, com TP capado um pouco ANTES do suporte
 */

function sma(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function last(arr, n) {
  return arr.slice(Math.max(0, arr.length - n));
}

function baseStats(baseCandles) {
  let hi = -Infinity;
  let lo = Infinity;
  const vols = [];

  for (const c of baseCandles) {
    if (!c) continue;
    hi = Math.max(hi, Number(c.high));
    lo = Math.min(lo, Number(c.low));
    vols.push(Number(c.volume || 0));
  }

  return {
    baseHigh: hi,
    baseLow: lo,
    baseRange: hi - lo,
    avgVol: sma(vols),
  };
}

function getNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function evaluateImpulseBreakoutShortStrategy(ctx) {
  const candles = ctx?.candles || [];
  const atr = Number(ctx?.atr || 0);
  const price = Number(ctx?.price || 0);

  if (!candles.length || !atr || !price) {
    return {
      name: 'impulseBreakoutShort',
      allowed: false,
      score: 0,
      reason: 'missing_data',
      signalClass: 'BLOCKED',
    };
  }

  // --- parâmetros (env) ---
  const BASE_LOOKBACK = getNum(process.env.IMPULSE_BASE_LOOKBACK, 12);
  const BASE_MAX_RANGE_ATR = getNum(process.env.IMPULSE_BASE_MAX_RANGE_ATR, 1.2);
  const BREAKDOWN_BUFFER_ATR = getNum(process.env.IMPULSE_BREAKDOWN_BUFFER_ATR, 0.05);
  const MIN_IMPULSE_BODY_ATR = getNum(process.env.IMPULSE_MIN_IMPULSE_BODY_ATR, 1.2);
  const VOL_MULT = getNum(process.env.IMPULSE_VOL_MULT, 1.5);

  const SL_ATR_MULT = getNum(process.env.IMPULSE_SHORT_SL_ATR_MULT, 1.25);
  const TP_ATR_MULT = getNum(process.env.IMPULSE_SHORT_TP_ATR_MULT, 2.0);

  // cap “um pouco antes” do suporte
  const TP_SUP_BUFFER_ATR = getNum(process.env.IMPULSE_SHORT_TP_SUPPORT_BUFFER_ATR, 0.15);

  const MIN_ADX = getNum(process.env.IMPULSE_SHORT_MIN_ADX, 0);

  // --- dados recentes ---
  const baseCandles = last(candles, BASE_LOOKBACK + 1).slice(0, -1);
  const c = candles[candles.length - 1];

  const { baseHigh, baseLow, baseRange, avgVol } = baseStats(baseCandles);

  const body = Math.abs(Number(c.close) - Number(c.open));
  const bodyAtr = body / atr;

  const breakdownLevel = baseLow - BREAKDOWN_BUFFER_ATR * atr;
  const isBreakdownClose = Number(c.close) < breakdownLevel;

  const isBaseTight = baseRange <= BASE_MAX_RANGE_ATR * atr;
  const hasImpulseBody = bodyAtr >= MIN_IMPULSE_BODY_ATR;
  const hasVol = Number(c.volume || 0) >= avgVol * VOL_MULT;

  const bearish = ctx?.bearish === true || (Number(ctx?.ema50 || 0) < Number(ctx?.ema200 || 0));
  const adxOk = MIN_ADX <= 0 ? true : Number(ctx?.adx || 0) >= MIN_ADX;

  const reasons = [];
  if (!bearish) reasons.push('not_bearish');
  if (!adxOk) reasons.push('adx_too_low');
  if (!isBaseTight) reasons.push('base_too_wide');
  if (!hasImpulseBody) reasons.push('impulse_body_too_small');
  if (!isBreakdownClose) reasons.push('no_breakdown_close');
  if (!hasVol) reasons.push('volume_not_expanded');

  const allowed =
    bearish && adxOk && isBaseTight && hasImpulseBody && isBreakdownClose && hasVol;

  // --- score ---
  const baseTightness = Math.max(0, 1 - baseRange / (BASE_MAX_RANGE_ATR * atr));
  const volBoost = Math.min(1.5, (Number(c.volume || 0) / Math.max(1, avgVol)) / VOL_MULT);

  let score = 0;
  score += Math.min(50, bodyAtr * 20);
  score += baseTightness * 25;
  score += Math.min(25, volBoost * 15);
  score = Math.round(score);

  // --- SL/TP “normal” (ATR) + cap antes de suporte ---
  const entry = price;
  const sl = entry + SL_ATR_MULT * atr;

  let tpRaw = entry - TP_ATR_MULT * atr;
  let tp = tpRaw;

  const nearestSupport = Number(ctx?.nearestSupport || 0);
  if (nearestSupport > 0) {
    const capped = nearestSupport + TP_SUP_BUFFER_ATR * atr;
    tp = Math.max(tpRaw, capped);
  }

  return {
    name: 'impulseBreakoutShort',
    allowed,
    score,
    reason: reasons.length ? reasons.join(' | ') : 'selected',
    signalClass: allowed ? 'EXECUTABLE' : 'BLOCKED',

    side: 'SELL',
    direction: 'SHORT',
    entry,
    sl,
    tp,
    rawTp: tpRaw,
    capped: tp !== tpRaw,

    meta: {
      baseHigh,
      baseLow,
      baseRange,
      bodyAtr,
      vol: Number(c.volume || 0),
      avgVol,
    },
  };
}

module.exports = { evaluateImpulseBreakoutShortStrategy };
