require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  fetchAvailableFuturesSymbols,
  fetchKlines,
  buildBaseContext,
  buildRequestedConfig,
  resolveRequestedSymbols,
  round,
  formatIso,
} = require("./backtest-candidate-strategies");

const OUTPUT_JSON = path.join(__dirname, "opportunity-events.json");
const OUTPUT_CSV = path.join(__dirname, "opportunity-events.csv");
const OUTPUT_SUMMARY = path.join(__dirname, "opportunity-events-summary.json");

const TF = process.env.OPPORTUNITY_TF || process.env.TF || "5m";
const HTF_TF = process.env.OPPORTUNITY_HTF_TF || process.env.HTF_TF || "1d";
const LTF_LIMIT = Number(process.env.OPPORTUNITY_LTF_LIMIT || 12000);
const HTF_LIMIT = Number(process.env.OPPORTUNITY_HTF_LIMIT || 500);
const LOOKAHEAD_BARS = Number(process.env.OPPORTUNITY_LOOKAHEAD_BARS || 8);
const MIN_TARGET_MOVE_ATR = Number(process.env.OPPORTUNITY_MIN_TARGET_MOVE_ATR || 1.8);
const MAX_MAE_ATR = Number(process.env.OPPORTUNITY_MAX_MAE_ATR || 0.8);
const MIN_CLOSE_PROGRESS = Number(process.env.OPPORTUNITY_MIN_CLOSE_PROGRESS || 0.45);
const MAX_EVENT_OVERLAP_BARS = Number(
  process.env.OPPORTUNITY_MAX_EVENT_OVERLAP_BARS || Math.max(1, Math.floor(LOOKAHEAD_BARS / 2))
);

function tfToMs(tf) {
  const match = String(tf || "").trim().match(/^(\d+)([mhd])$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  if (unit === "d") return amount * 24 * 60 * 60 * 1000;
  return null;
}

function normalizeDirection(value) {
  const direction = String(value || "").toUpperCase();
  if (direction === "SHORT" || direction === "SELL") return "SHORT";
  return "LONG";
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toCsv(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((key) => escape(row[key])).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

function advanceHtfCursor(htfCandles, ltfCloseTime, startIndex = 0) {
  let endIndexExclusive = startIndex;

  while (
    endIndexExclusive < htfCandles.length &&
    Number(htfCandles[endIndexExclusive]?.closeTime) <= Number(ltfCloseTime)
  ) {
    endIndexExclusive += 1;
  }

  return endIndexExclusive;
}

function classifyArchetype({
  indicators,
  moveAtr,
  maeAtr,
  closeProgress,
  relativeVol,
}) {
  const nearPullback = indicators?.nearPullback === true;
  const stackedEma = indicators?.stackedEma === true;
  const isTrend = indicators?.isTrend === true;
  const isRange = indicators?.isRange === true;
  const rsi = Number(indicators?.rsi || 0);

  if (isTrend && nearPullback && stackedEma && relativeVol >= 0.9) {
    return "trend_continuation_pullback";
  }

  if (isRange && moveAtr >= 2 && closeProgress >= 0.55) {
    return "range_expansion_breakout";
  }

  if (maeAtr <= 0.4 && relativeVol >= 1.1) {
    return "clean_impulse_expansion";
  }

  if (rsi >= 62 && closeProgress >= 0.5) {
    return "late_momentum_extension";
  }

  return "generic_expansion";
}

function buildEventRow({
  symbol,
  candleIndex,
  candle,
  lookaheadCandles,
  ctx,
  direction,
}) {
  const entry = toNumber(candle.close);
  const atr = toNumber(ctx?.indicators?.atr);

  if (!Number.isFinite(entry) || !Number.isFinite(atr) || atr <= 0) {
    return null;
  }

  const highs = lookaheadCandles.map((row) => toNumber(row.high)).filter(Number.isFinite);
  const lows = lookaheadCandles.map((row) => toNumber(row.low)).filter(Number.isFinite);

  if (!highs.length || !lows.length) return null;

  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const finalClose = toNumber(lookaheadCandles[lookaheadCandles.length - 1]?.close);

  const longMove = maxHigh - entry;
  const longMae = entry - minLow;
  const shortMove = entry - minLow;
  const shortMae = maxHigh - entry;

  const moveAbs = direction === "SHORT" ? shortMove : longMove;
  const maeAbs = direction === "SHORT" ? shortMae : longMae;
  const closeMoveAbs =
    direction === "SHORT" ? entry - Number(finalClose || entry) : Number(finalClose || entry) - entry;

  const moveAtr = moveAbs / atr;
  const maeAtr = maeAbs / atr;
  const closeProgress = moveAbs > 0 ? closeMoveAbs / moveAbs : 0;
  const relativeVol =
    Number(ctx?.indicators?.avgVol) > 0
      ? Number(candle.volume || 0) / Number(ctx.indicators.avgVol)
      : null;

  const qualifies =
    moveAtr >= MIN_TARGET_MOVE_ATR &&
    maeAtr <= MAX_MAE_ATR &&
    closeProgress >= MIN_CLOSE_PROGRESS;

  if (!qualifies) return null;

  return {
    symbol,
    tf: TF,
    htfTf: HTF_TF,
    direction,
    archetype: classifyArchetype({
      indicators: ctx?.indicators,
      moveAtr,
      maeAtr,
      closeProgress,
      relativeVol: Number.isFinite(relativeVol) ? relativeVol : 0,
    }),
    candleIndex,
    signalTs: candle.closeTime,
    signalIso: formatIso(candle.closeTime),
    lookaheadBars: LOOKAHEAD_BARS,
    entry,
    finalClose: toNumber(finalClose),
    maxHigh: round(maxHigh, 8),
    minLow: round(minLow, 8),
    moveAbs: round(moveAbs, 8),
    maeAbs: round(maeAbs, 8),
    moveAtr: round(moveAtr, 6),
    maeAtr: round(maeAtr, 6),
    closeProgress: round(closeProgress, 6),
    relativeVol: Number.isFinite(relativeVol) ? round(relativeVol, 6) : null,
    rsi: toNumber(ctx?.indicators?.rsi),
    prevRsi: toNumber(ctx?.indicators?.prevRsi),
    atr: round(atr, 8),
    atrPct: toNumber(ctx?.indicators?.atrPct),
    adx: toNumber(ctx?.indicators?.adx),
    ema20: toNumber(ctx?.indicators?.ema20),
    ema50: toNumber(ctx?.indicators?.ema50),
    ema200: toNumber(ctx?.indicators?.ema200),
    bullish: ctx?.indicators?.bullish === true,
    bullishFast: ctx?.indicators?.bullishFast === true,
    nearEma20: ctx?.indicators?.nearEma20 === true,
    nearEma50: ctx?.indicators?.nearEma50 === true,
    nearPullback: ctx?.indicators?.nearPullback === true,
    stackedEma: ctx?.indicators?.stackedEma === true,
    isTrend: ctx?.indicators?.isTrend === true,
    isRange: ctx?.indicators?.isRange === true,
    emaSeparationPct: toNumber(ctx?.indicators?.emaSeparationPct),
    emaSlopePct: toNumber(ctx?.indicators?.emaSlopePct),
    distToEma20: toNumber(ctx?.indicators?.distToEma20),
    distToEma50: toNumber(ctx?.indicators?.distToEma50),
    nearestSupport: toNumber(ctx?.nearestSupport?.price),
    nearestResistance: toNumber(ctx?.nearestResistance?.price),
  };
}

function mineOpportunityEventsForSymbol(symbol, symbolData) {
  const { cfg, ltfCandles, htfCandles } = symbolData;
  const rows = [];
  const nextAllowedByDirection = { LONG: -1, SHORT: -1 };
  let htfEndIndex = 0;

  for (let i = 0; i < ltfCandles.length - LOOKAHEAD_BARS; i += 1) {
    const candle = ltfCandles[i];
    const ltfSlice = ltfCandles.slice(0, i + 1);
    htfEndIndex = advanceHtfCursor(htfCandles, candle.closeTime, htfEndIndex);
    const htfSlice = htfCandles.slice(0, htfEndIndex);

    const ctx = buildBaseContext({
      symbol,
      cfg,
      candles: ltfSlice,
      htfCandles: htfSlice,
    });

    if (!ctx || !ctx.indicators) continue;

    const lookaheadCandles = ltfCandles.slice(i + 1, i + 1 + LOOKAHEAD_BARS);

    for (const direction of ["LONG", "SHORT"]) {
      if (i < nextAllowedByDirection[direction]) continue;

      const eventRow = buildEventRow({
        symbol,
        candleIndex: i,
        candle,
        lookaheadCandles,
        ctx,
        direction,
      });

      if (!eventRow) continue;

      rows.push(eventRow);
      nextAllowedByDirection[direction] = i + MAX_EVENT_OVERLAP_BARS;
    }
  }

  return rows;
}

function buildSummary(rows, symbols, unavailableSymbols) {
  const bySymbol = {};
  const byArchetype = {};
  const byDirection = { LONG: 0, SHORT: 0 };

  for (const row of rows) {
    byDirection[row.direction] = (byDirection[row.direction] || 0) + 1;

    if (!bySymbol[row.symbol]) {
      bySymbol[row.symbol] = {
        total: 0,
        avgMoveAtr: 0,
        avgMaeAtr: 0,
        avgCloseProgress: 0,
        byArchetype: {},
      };
    }

    if (!byArchetype[row.archetype]) {
      byArchetype[row.archetype] = {
        total: 0,
        avgMoveAtr: 0,
        avgMaeAtr: 0,
        avgCloseProgress: 0,
      };
    }

    const symbolStats = bySymbol[row.symbol];
    symbolStats.total += 1;
    symbolStats.avgMoveAtr += Number(row.moveAtr || 0);
    symbolStats.avgMaeAtr += Number(row.maeAtr || 0);
    symbolStats.avgCloseProgress += Number(row.closeProgress || 0);
    symbolStats.byArchetype[row.archetype] =
      (symbolStats.byArchetype[row.archetype] || 0) + 1;

    const archetypeStats = byArchetype[row.archetype];
    archetypeStats.total += 1;
    archetypeStats.avgMoveAtr += Number(row.moveAtr || 0);
    archetypeStats.avgMaeAtr += Number(row.maeAtr || 0);
    archetypeStats.avgCloseProgress += Number(row.closeProgress || 0);
  }

  for (const stats of Object.values(bySymbol)) {
    stats.avgMoveAtr = stats.total ? round(stats.avgMoveAtr / stats.total, 6) : null;
    stats.avgMaeAtr = stats.total ? round(stats.avgMaeAtr / stats.total, 6) : null;
    stats.avgCloseProgress = stats.total
      ? round(stats.avgCloseProgress / stats.total, 6)
      : null;
  }

  for (const stats of Object.values(byArchetype)) {
    stats.avgMoveAtr = stats.total ? round(stats.avgMoveAtr / stats.total, 6) : null;
    stats.avgMaeAtr = stats.total ? round(stats.avgMaeAtr / stats.total, 6) : null;
    stats.avgCloseProgress = stats.total
      ? round(stats.avgCloseProgress / stats.total, 6)
      : null;
  }

  return {
    generatedAt: new Date().toISOString(),
    tf: TF,
    htfTf: HTF_TF,
    ltfLimit: LTF_LIMIT,
    htfLimit: HTF_LIMIT,
    lookaheadBars: LOOKAHEAD_BARS,
    minTargetMoveAtr: MIN_TARGET_MOVE_ATR,
    maxMaeAtr: MAX_MAE_ATR,
    minCloseProgress: MIN_CLOSE_PROGRESS,
    maxEventOverlapBars: MAX_EVENT_OVERLAP_BARS,
    total: rows.length,
    symbols,
    unavailableSymbols,
    byDirection,
    bySymbol,
    byArchetype,
  };
}

async function main() {
  const symbols = resolveRequestedSymbols();
  const config = buildRequestedConfig(symbols);
  const availableSymbols = await fetchAvailableFuturesSymbols();
  const filteredSymbols = symbols.filter((symbol) => availableSymbols.has(symbol));
  const unavailableSymbols = symbols.filter((symbol) => !availableSymbols.has(symbol));
  const rows = [];

  for (const symbol of filteredSymbols) {
    console.log(`[OPPORTUNITY] ${symbol} ${TF}/${HTF_TF}`);
    const symbolData = {
      cfg: config[symbol],
      ltfCandles: await fetchKlines(symbol, TF, LTF_LIMIT),
      htfCandles: await fetchKlines(symbol, HTF_TF, HTF_LIMIT),
    };

    rows.push(...mineOpportunityEventsForSymbol(symbol, symbolData));
  }

  rows.sort((a, b) => Number(a.signalTs || 0) - Number(b.signalTs || 0));

  const summary = buildSummary(rows, filteredSymbols, unavailableSymbols);

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(rows, null, 2), "utf8");
  fs.writeFileSync(OUTPUT_CSV, toCsv(rows), "utf8");
  fs.writeFileSync(OUTPUT_SUMMARY, JSON.stringify(summary, null, 2), "utf8");

  console.log(`Opportunity events: ${rows.length}`);
  console.log(`Saved JSON: ${OUTPUT_JSON}`);
  console.log(`Saved CSV: ${OUTPUT_CSV}`);
  console.log(`Saved summary: ${OUTPUT_SUMMARY}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  tfToMs,
  buildEventRow,
  mineOpportunityEventsForSymbol,
  buildSummary,
};
