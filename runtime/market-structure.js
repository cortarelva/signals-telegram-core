function isPivotHigh(candles, index, lookback) {
  const current = Number(candles[index]?.high);
  if (!Number.isFinite(current)) return false;

  for (let i = index - lookback; i <= index + lookback; i += 1) {
    if (i === index) continue;
    if (i < 0 || i >= candles.length) return false;
    if (Number(candles[i].high) >= current) return false;
  }

  return true;
}

function isPivotLow(candles, index, lookback) {
  const current = Number(candles[index]?.low);
  if (!Number.isFinite(current)) return false;

  for (let i = index - lookback; i <= index + lookback; i += 1) {
    if (i === index) continue;
    if (i < 0 || i >= candles.length) return false;
    if (Number(candles[i].low) <= current) return false;
  }

  return true;
}

function collectSwings(candles, lookback = 2) {
  const highs = [];
  const lows = [];

  for (let i = lookback; i < candles.length - lookback; i += 1) {
    if (isPivotHigh(candles, i, lookback)) {
      highs.push({
        index: i,
        time: candles[i].closeTime ?? candles[i].openTime,
        price: Number(candles[i].high),
      });
    }

    if (isPivotLow(candles, i, lookback)) {
      lows.push({
        index: i,
        time: candles[i].closeTime ?? candles[i].openTime,
        price: Number(candles[i].low),
      });
    }
  }

  return { highs, lows };
}

function getLastN(items, n) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.slice(Math.max(0, items.length - n));
}

function classifyHtfTrend(swings, trendSwingCount = 2) {
  const highs = getLastN(swings.highs, trendSwingCount);
  const lows = getLastN(swings.lows, trendSwingCount);

  if (highs.length < trendSwingCount || lows.length < trendSwingCount) {
    return {
      bias: "NEUTRAL",
      bullish: false,
      bearish: false,
      reason: "insufficient_swings",
      highs,
      lows,
    };
  }

  const higherHighs = highs.every((s, i) => i === 0 || s.price > highs[i - 1].price);
  const higherLows = lows.every((s, i) => i === 0 || s.price > lows[i - 1].price);
  const lowerHighs = highs.every((s, i) => i === 0 || s.price < highs[i - 1].price);
  const lowerLows = lows.every((s, i) => i === 0 || s.price < lows[i - 1].price);

  if (higherHighs && higherLows) {
    return {
      bias: "BULLISH",
      bullish: true,
      bearish: false,
      reason: "hh_hl",
      highs,
      lows,
    };
  }

  if (lowerHighs && lowerLows) {
    return {
      bias: "BEARISH",
      bullish: false,
      bearish: true,
      reason: "lh_ll",
      highs,
      lows,
    };
  }

  return {
    bias: "NEUTRAL",
    bullish: false,
    bearish: false,
    reason: "mixed_structure",
    highs,
    lows,
  };
}

function detectLtfStructureShift(candles, lookback = 6) {
  const swings = collectSwings(candles, lookback);
  const lastHigh = swings.highs[swings.highs.length - 1] || null;
  const prevHigh = swings.highs[swings.highs.length - 2] || null;
  const lastLow = swings.lows[swings.lows.length - 1] || null;
  const prevLow = swings.lows[swings.lows.length - 2] || null;
  const lastClose = Number(candles[candles.length - 1]?.close);

  const bullishShift =
    Number.isFinite(lastClose) &&
    prevHigh &&
    prevLow &&
    lastHigh &&
    lastLow &&
    lastClose > prevHigh.price &&
    lastLow.price > prevLow.price;

  const bearishShift =
    Number.isFinite(lastClose) &&
    prevHigh &&
    prevLow &&
    lastHigh &&
    lastLow &&
    lastClose < prevLow.price &&
    lastHigh.price < prevHigh.price;

  return {
    bullishShift,
    bearishShift,
    lastHigh,
    prevHigh,
    lastLow,
    prevLow,
    swings,
  };
}

function calcPullbackDistancePct(lastClose, refPrice) {
  const close = Number(lastClose);
  const ref = Number(refPrice);
  if (!Number.isFinite(close) || !Number.isFinite(ref) || ref === 0) return null;
  return Math.abs(close - ref) / ref;
}

function evaluateMarketStructure({
  htfCandles,
  ltfCandles,
  htfLookback = 2,
  ltfLookback = 6,
  trendSwingCount = 2,
}) {
  const htfSwings = collectSwings(htfCandles, htfLookback);
  const htfTrend = classifyHtfTrend(htfSwings, trendSwingCount);
  const ltfShift = detectLtfStructureShift(ltfCandles, ltfLookback);

  const lastLtfClose = Number(ltfCandles[ltfCandles.length - 1]?.close);
  const lastHtfLow = htfTrend.lows[htfTrend.lows.length - 1]?.price;
  const lastHtfHigh = htfTrend.highs[htfTrend.highs.length - 1]?.price;

  return {
    htf: {
      ...htfTrend,
      lookback: htfLookback,
      trendSwingCount,
      lastSwingLow: lastHtfLow ?? null,
      lastSwingHigh: lastHtfHigh ?? null,
    },
    ltf: {
      ...ltfShift,
      lookback: ltfLookback,
      pullbackToLastHtfLowPct: calcPullbackDistancePct(lastLtfClose, lastHtfLow),
      pullbackToLastHtfHighPct: calcPullbackDistancePct(lastLtfClose, lastHtfHigh),
    },
  };
}

module.exports = {
  collectSwings,
  classifyHtfTrend,
  detectLtfStructureShift,
  evaluateMarketStructure,
};
