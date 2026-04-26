/**
 * IMPULSE_BREAKOUT_LONG
 *
 * Objetivo: apanhar aqueles movimentos explosivos depois de uma base apertada.
 * - Detecta uma base curta (range pequeno vs ATR)
 * - Exige candle de breakout com corpo grande (vs ATR) e volume acima da média
 * - SL/TP “normal” por ATR, com TP capado um pouco ANTES da resistência
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

function evaluateImpulseBreakoutLongStrategy(ctx) {
  const candles = ctx?.candles || [];
  const atr = Number(ctx?.atr || 0);
  const price = Number(ctx?.price || 0);

  if (!candles.length || !atr || !price) {
    return {
      name: 'impulseBreakoutLong',
      allowed: false,
      score: 0,
      reason: 'missing_data',
      signalClass: 'BLOCKED',
    };
  }

  // --- parâmetros (env) ---
  const BASE_LOOKBACK = getNum(process.env.IMPULSE_BASE_LOOKBACK, 12);
  const BASE_MAX_RANGE_ATR = getNum(process.env.IMPULSE_BASE_MAX_RANGE_ATR, 1.2);
  const BREAKOUT_BUFFER_ATR = getNum(process.env.IMPULSE_BREAKOUT_BUFFER_ATR, 0.05);
  const MIN_IMPULSE_BODY_ATR = getNum(process.env.IMPULSE_MIN_IMPULSE_BODY_ATR, 1.2);
  const VOL_MULT = getNum(process.env.IMPULSE_VOL_MULT, 1.5);

  const SL_ATR_MULT = getNum(process.env.IMPULSE_SL_ATR_MULT, 1.25);
  const TP_ATR_MULT = getNum(process.env.IMPULSE_TP_ATR_MULT, 2.0);

  // cap “um pouco antes” da resistência
  const TP_RES_BUFFER_ATR = getNum(process.env.IMPULSE_TP_RESISTANCE_BUFFER_ATR, 0.15);

  const MIN_ADX = getNum(process.env.IMPULSE_MIN_ADX, 0); // 0 = não filtra

  // --- dados recentes ---
  const baseCandles = last(candles, BASE_LOOKBACK + 1).slice(0, -1);
  const c = candles[candles.length - 1];

  const { baseHigh, baseLow, baseRange, avgVol } = baseStats(baseCandles);

  const body = Math.abs(Number(c.close) - Number(c.open));
  const bodyAtr = body / atr;

  const breakoutLevel = baseHigh + BREAKOUT_BUFFER_ATR * atr;
  const isBreakoutClose = Number(c.close) > breakoutLevel;

  const isBaseTight = baseRange <= BASE_MAX_RANGE_ATR * atr;
  const hasImpulseBody = bodyAtr >= MIN_IMPULSE_BODY_ATR;
  const hasVol = Number(c.volume || 0) >= avgVol * VOL_MULT;

  const bullish = ctx?.bullish === true || (Number(ctx?.ema50 || 0) > Number(ctx?.ema200 || 0));
  const adxOk = MIN_ADX <= 0 ? true : Number(ctx?.adx || 0) >= MIN_ADX;

  const reasons = [];
  if (!bullish) reasons.push('not_bullish');
  if (!adxOk) reasons.push('adx_too_low');
  if (!isBaseTight) reasons.push('base_too_wide');
  if (!hasImpulseBody) reasons.push('impulse_body_too_small');
  if (!isBreakoutClose) reasons.push('no_breakout_close');
  if (!hasVol) reasons.push('volume_not_expanded');

  const allowed =
    bullish && adxOk && isBaseTight && hasImpulseBody && isBreakoutClose && hasVol;

  // --- score ---
  // mais corpo + mais volume + base mais apertada => score maior
  const baseTightness = Math.max(0, 1 - baseRange / (BASE_MAX_RANGE_ATR * atr)); // 0..1
  const volBoost = Math.min(1.5, (Number(c.volume || 0) / Math.max(1, avgVol)) / VOL_MULT);

  let score = 0;
  score += Math.min(50, bodyAtr * 20);
  score += baseTightness * 25;
  score += Math.min(25, volBoost * 15);
  score = Math.round(score);

  // --- SL/TP “normal” (ATR) + cap antes de SR ---
  const entry = price;
  const sl = entry - SL_ATR_MULT * atr;

  let tpRaw = entry + TP_ATR_MULT * atr;
  let tp = tpRaw;

  const nearestResistance = Number(ctx?.nearestResistance || 0);
  if (nearestResistance > 0) {
    const capped = nearestResistance - TP_RES_BUFFER_ATR * atr;
    tp = Math.min(tpRaw, capped);
  }

  return {
    name: 'impulseBreakoutLong',
    allowed,
    score,
    reason: reasons.length ? reasons.join(' | ') : 'selected',
    signalClass: allowed ? 'EXECUTABLE' : 'BLOCKED',

    // para o executor
    side: 'BUY',
    direction: 'LONG',
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

module.exports = { evaluateImpulseBreakoutLongStrategy };
