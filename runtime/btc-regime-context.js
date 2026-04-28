function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ema(values, period) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => safeNumber(value))
    .filter((value) => Number.isFinite(value));

  if (!nums.length) return null;

  const alpha = 2 / (period + 1);
  let result = nums[0];

  for (let i = 1; i < nums.length; i += 1) {
    result = nums[i] * alpha + result * (1 - alpha);
  }

  return result;
}

function pctChange(fromValue, toValue) {
  const from = safeNumber(fromValue);
  const to = safeNumber(toValue);

  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

function avg(values) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => safeNumber(value))
    .filter((value) => Number.isFinite(value));

  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function summarizeCandles(candles, options = {}) {
  const rows = Array.isArray(candles) ? candles : [];
  const lookback1hBars = Number(options.lookback1hBars || 12);
  const lookback4hBars = Number(options.lookback4hBars || 48);
  const volumeLookbackBars = Number(options.volumeLookbackBars || 20);
  const minBars = Math.max(lookback4hBars + 1, volumeLookbackBars + 1, 25);

  if (rows.length < minBars) return null;

  const closes = rows.map((row) => safeNumber(row.close));
  const highs = rows.map((row) => safeNumber(row.high));
  const lows = rows.map((row) => safeNumber(row.low));
  const volumes = rows.map((row) => safeNumber(row.volume));

  const lastClose = closes.at(-1);
  const prev1hClose = closes.at(-(lookback1hBars + 1));
  const prev4hClose = closes.at(-(lookback4hBars + 1));
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const avgVolume = avg(volumes.slice(-(volumeLookbackBars + 1), -1));
  const rangeHigh = Math.max(...highs.slice(-lookback1hBars).filter((v) => Number.isFinite(v)));
  const rangeLow = Math.min(...lows.slice(-lookback1hBars).filter((v) => Number.isFinite(v)));
  const return1hPct = pctChange(prev1hClose, lastClose);
  const return4hPct = pctChange(prev4hClose, lastClose);
  const range1hPct =
    Number.isFinite(rangeHigh) && Number.isFinite(rangeLow) && Number.isFinite(lastClose) && lastClose !== 0
      ? ((rangeHigh - rangeLow) / lastClose) * 100
      : null;
  const volumeRatio =
    Number.isFinite(avgVolume) && avgVolume > 0 && Number.isFinite(volumes.at(-1))
      ? volumes.at(-1) / avgVolume
      : null;

  return {
    lastClose,
    ema20,
    ema50,
    return1hPct,
    return4hPct,
    range1hPct,
    volumeRatio,
    aboveEma20: Number.isFinite(lastClose) && Number.isFinite(ema20) ? lastClose > ema20 : null,
    aboveEma50: Number.isFinite(lastClose) && Number.isFinite(ema50) ? lastClose > ema50 : null,
  };
}

function classifyDirection(returnPct, thresholdPct = 0.2) {
  const value = safeNumber(returnPct);
  if (!Number.isFinite(value)) return "unknown";
  if (value >= thresholdPct) return "up";
  if (value <= -thresholdPct) return "down";
  return "flat";
}

function median(values) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => safeNumber(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function buildBtcRegimeSnapshot({
  candlesBySymbol,
  btcSymbol = "BTCUSDC",
  timeframe = "5m",
  asOf = new Date().toISOString(),
} = {}) {
  const rows = candlesBySymbol || {};
  const btc = summarizeCandles(rows[btcSymbol]);

  if (!btc) {
    return {
      state: "unavailable",
      label: "BTC context unavailable",
      summary: "Sem candles suficientes de BTC para calcular o regime.",
      timeframe,
      btcSymbol,
      asOf,
      btc: null,
      alts: {
        symbols: [],
        followCount: 0,
        followRate: 0,
        positiveBreadth: 0,
        negativeBreadth: 0,
        medianReturn1hPct: null,
        avgReturn1hPct: null,
      },
    };
  }

  const btcDirection = classifyDirection(btc.return1hPct);
  const altSymbols = Object.keys(rows).filter((symbol) => symbol !== btcSymbol);
  const altSummaries = altSymbols
    .map((symbol) => ({
      symbol,
      metrics: summarizeCandles(rows[symbol]),
    }))
    .filter((row) => row.metrics && Number.isFinite(row.metrics.return1hPct));

  const altDirections = altSummaries.map((row) => ({
    symbol: row.symbol,
    return1hPct: row.metrics.return1hPct,
    direction: classifyDirection(row.metrics.return1hPct),
  }));

  const followRows = altDirections.filter(
    (row) => btcDirection !== "flat" && row.direction === btcDirection
  );
  const positiveRows = altDirections.filter((row) => row.direction === "up");
  const negativeRows = altDirections.filter((row) => row.direction === "down");
  const followRate = altDirections.length ? followRows.length / altDirections.length : 0;
  const positiveBreadth = altDirections.length ? positiveRows.length / altDirections.length : 0;
  const negativeBreadth = altDirections.length ? negativeRows.length / altDirections.length : 0;
  const avgAltReturn1hPct = avg(altDirections.map((row) => row.return1hPct));
  const medianAltReturn1hPct = median(altDirections.map((row) => row.return1hPct));
  const strongestFollower = followRows
    .slice()
    .sort((a, b) => Math.abs(b.return1hPct) - Math.abs(a.return1hPct))[0] || null;

  let state = "mixed";
  let label = "Mixed tape";

  if (
    btcDirection === "down" &&
    followRate >= 0.6 &&
    negativeBreadth >= 0.6 &&
    btc.aboveEma20 === false
  ) {
    state = "risk_off_selloff";
    label = "BTC-led selloff";
  } else if (
    btcDirection === "up" &&
    followRate >= 0.6 &&
    positiveBreadth >= 0.6 &&
    btc.aboveEma20 === true
  ) {
    state = "alt_follow_rally";
    label = "Alt follow rally";
  } else if (btcDirection === "flat" && followRate >= 0.6) {
    state = "coiled_follow";
    label = "Coiled follow mode";
  } else if (followRate < 0.4 && Math.abs(Number(btc.return1hPct || 0)) >= 0.4) {
    state = "divergent_rotation";
    label = "Divergent rotation";
  }

  const summaryParts = [
    `${btcSymbol} ${btcDirection} ${Number.isFinite(btc.return1hPct) ? btc.return1hPct.toFixed(2) : "-"}% em 1h`,
    `${followRows.length}/${altDirections.length || 0} alts a seguir`,
  ];

  if (negativeBreadth >= positiveBreadth) {
    summaryParts.push(`${(negativeBreadth * 100).toFixed(0)}% breadth negativo`);
  } else {
    summaryParts.push(`${(positiveBreadth * 100).toFixed(0)}% breadth positivo`);
  }

  if (strongestFollower) {
    summaryParts.push(
      `${strongestFollower.symbol} ${strongestFollower.return1hPct.toFixed(2)}%`
    );
  }

  return {
    state,
    label,
    summary: summaryParts.join(" | "),
    timeframe,
    btcSymbol,
    asOf,
    btc: {
      direction: btcDirection,
      lastClose: btc.lastClose,
      return1hPct: btc.return1hPct,
      return4hPct: btc.return4hPct,
      range1hPct: btc.range1hPct,
      volumeRatio: btc.volumeRatio,
      aboveEma20: btc.aboveEma20,
      aboveEma50: btc.aboveEma50,
    },
    alts: {
      symbols: altDirections.map((row) => row.symbol),
      followCount: followRows.length,
      followRate,
      positiveBreadth,
      negativeBreadth,
      avgReturn1hPct: avgAltReturn1hPct,
      medianReturn1hPct: medianAltReturn1hPct,
      strongestFollower,
    },
  };
}

module.exports = {
  summarizeCandles,
  classifyDirection,
  buildBtcRegimeSnapshot,
};
