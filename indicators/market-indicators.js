function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calcEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcEMASeries(values, period) {
  if (!Array.isArray(values) || values.length < period) return [];

  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = new Array(period - 1).fill(null);
  out.push(ema);

  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }

  return out;
}

function calcStdDev(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;

  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;

  return Math.sqrt(variance);
}

function calcBollingerBands(values, period = 20, stdMult = 2) {
  if (!Array.isArray(values) || values.length < period) return null;

  const basis = values.slice(-period).reduce((a, b) => a + b, 0) / period;
  const stdDev = calcStdDev(values, period);

  if (!Number.isFinite(basis) || !Number.isFinite(stdDev)) return null;

  return {
    basis,
    upper: basis + stdMult * stdDev,
    lower: basis - stdMult * stdDev,
    stdDev,
  };
}

function calcMACDSeries(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (
    !Array.isArray(values) ||
    values.length < slowPeriod + signalPeriod
  ) {
    return [];
  }

  const fastSeries = calcEMASeries(values, fastPeriod);
  const slowSeries = calcEMASeries(values, slowPeriod);
  const macdLine = values.map((_, index) => {
    const fast = fastSeries[index];
    const slow = slowSeries[index];
    if (!Number.isFinite(fast) || !Number.isFinite(slow)) return null;
    return fast - slow;
  });

  const validMacd = macdLine.filter((value) => Number.isFinite(value));
  if (validMacd.length < signalPeriod) return [];

  const signalValidSeries = calcEMASeries(validMacd, signalPeriod);
  const signalLine = [];
  let validIndex = 0;

  for (const value of macdLine) {
    if (!Number.isFinite(value)) {
      signalLine.push(null);
      continue;
    }

    signalLine.push(signalValidSeries[validIndex] ?? null);
    validIndex += 1;
  }

  return macdLine.map((macd, index) => {
    const signal = signalLine[index];
    if (!Number.isFinite(macd) || !Number.isFinite(signal)) return null;

    return {
      macd,
      signal,
      hist: macd - signal,
    };
  });
}

function calcRSISeries(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) return [];
  const rsis = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsis.push(100 - 100 / (1 + rs));

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsis.push(100 - 100 / (1 + rs));
  }

  return rsis;
}

function calcATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const trs = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  if (trs.length < period) return null;

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calcADX(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 2) return null;

  const trs = [];
  const plusDMs = [];
  const minusDMs = [];

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];

    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;

    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trs.push(tr);
  }

  if (trs.length < period) return null;

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let plusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let minusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  let plusDI = atr === 0 ? 0 : (100 * plusDM) / atr;
  let minusDI = atr === 0 ? 0 : (100 * minusDM) / atr;
  let dx =
    plusDI + minusDI === 0
      ? 0
      : (100 * Math.abs(plusDI - minusDI)) / (plusDI + minusDI);

  const dxs = [dx];

  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    plusDM = (plusDM * (period - 1) + plusDMs[i]) / period;
    minusDM = (minusDM * (period - 1) + minusDMs[i]) / period;

    plusDI = atr === 0 ? 0 : (100 * plusDM) / atr;
    minusDI = atr === 0 ? 0 : (100 * minusDM) / atr;
    dx =
      plusDI + minusDI === 0
        ? 0
        : (100 * Math.abs(plusDI - minusDI)) / (plusDI + minusDI);

    dxs.push(dx);
  }

  return dxs.length ? dxs[dxs.length - 1] : null;
}

function detectMarketRegime({
  lastClose,
  ema20,
  ema50,
  ema200,
  prevEma50,
  atr,
  adx,
  regimeMinEmaSeparationPct,
  regimeMinAtrPct,
  adxMinTrend,
  rangeMaxAtrPct,
}) {
  const bullish = ema50 > ema200;
  const bullishFast = ema20 > ema50;
  const stackedEma = ema20 > ema50 && ema50 > ema200;

  const emaSeparationPct =
    lastClose > 0 ? Math.abs(ema50 - ema200) / lastClose : 0;

  const emaSlopePct =
    prevEma50 && prevEma50 !== 0
      ? Math.abs(ema50 - prevEma50) / prevEma50
      : 0;

  const atrPct = lastClose > 0 ? atr / lastClose : 0;

  const isTrend =
    Number(adx || 0) >= adxMinTrend &&
    bullish &&
    bullishFast &&
    emaSeparationPct >= regimeMinEmaSeparationPct &&
    atrPct >= regimeMinAtrPct;

  const isRange =
    Number(adx || 0) < 25 &&
    emaSeparationPct < regimeMinEmaSeparationPct * 1.5 &&
    atrPct < rangeMaxAtrPct;

  return {
    bullish,
    bullishFast,
    stackedEma,
    isTrend,
    isRange,
    emaSeparationPct,
    emaSlopePct,
    atrPct,
  };
}

module.exports = {
  clamp,
  calcEMA,
  calcEMASeries,
  calcRSISeries,
  calcATR,
  calcADX,
  calcBollingerBands,
  calcMACDSeries,
  detectMarketRegime,
};
