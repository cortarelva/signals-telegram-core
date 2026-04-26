require("dotenv").config();

const path = require("path");

const replayTf = process.env.REPLAY_TF || process.env.TF;
const replayHtfTf = process.env.REPLAY_HTF_TF || process.env.HTF_TF;

if (replayTf) process.env.TF = replayTf;
if (replayHtfTf) process.env.HTF_TF = replayHtfTf;

const { evaluateAllStrategies } = require("../strategies");
const { writeJsonAtomic } = require("../runtime/file-utils");
const {
  fetchAvailableFuturesSymbols,
  fetchKlines,
  buildBaseContext,
  buildRequestedConfig,
  resolveRequestedSymbols,
  round,
  formatIso,
} = require("./backtest-candidate-strategies");
const {
  buildCandidateRow,
  buildSummary,
  labelCandidateWithCandles,
  normalizeDirection,
  toCsv,
} = require("./build-candidate-labeled-dataset");

const OUTPUT_JSON = path.join(__dirname, "historical-replay-candidates.json");
const OUTPUT_CSV = path.join(__dirname, "historical-replay-candidates.csv");
const OUTPUT_SUMMARY = path.join(__dirname, "historical-replay-summary.json");

const TF = process.env.REPLAY_TF || process.env.TF || "5m";
const HTF_TF = process.env.REPLAY_HTF_TF || process.env.HTF_TF || "1d";
const LTF_LIMIT = Number(process.env.REPLAY_LTF_LIMIT || 5000);
const HTF_LIMIT = Number(process.env.REPLAY_HTF_LIMIT || 500);
const HORIZON_BARS = Number(process.env.REPLAY_HORIZON_BARS || 12);
const INCLUDE_ALL_ALLOWED = String(process.env.REPLAY_INCLUDE_ALL_ALLOWED || "1") !== "0";
const INCLUDE_BLOCKED_GEOMETRY =
  String(process.env.REPLAY_INCLUDE_BLOCKED_GEOMETRY || "1") !== "0";

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isGeometryCandidate(candidate) {
  return (
    candidate &&
    Number.isFinite(Number(candidate.entry)) &&
    Number.isFinite(Number(candidate.sl)) &&
    Number.isFinite(Number(candidate.tp))
  );
}

function selectReplayCandidates(
  decision,
  {
    includeAllAllowed = INCLUDE_ALL_ALLOWED,
    includeBlockedGeometry = INCLUDE_BLOCKED_GEOMETRY,
  } = {}
) {
  if (!decision) return [];

  if (includeAllAllowed) {
    return (decision.all || []).filter(
      (candidate) =>
        isGeometryCandidate(candidate) &&
        (candidate.allowed === true || includeBlockedGeometry)
    );
  }

  if (decision.selected && isGeometryCandidate(decision.selected)) {
    return [decision.selected];
  }

  if (includeBlockedGeometry) {
    return (decision.all || []).filter(isGeometryCandidate).slice(0, 1);
  }

  return [];
}

function buildBaseLogRow(symbol, candle, ctx, decision, candidate) {
  const direction = normalizeDirection(candidate?.direction);
  const srEval =
    direction === "SHORT" ? ctx.srEvalShort || ctx.srEval : ctx.srEvalLong || ctx.srEval;

  return {
    ts: candle.closeTime,
    signalCandleCloseTime: candle.closeTime,
    symbol,
    tf: TF,
    selectedStrategy: decision?.selected?.strategy || null,
    selectedDirection: normalizeDirection(decision?.selected?.direction, direction),
    decisionReason: decision?.blockedReason || null,
    executionAttempted: false,
    executionApproved: false,
    executionReason: null,
    executionOrderId: null,
    score: toNumber(candidate?.score, toNumber(decision?.visibleScore)),
    signalClass: candidate?.signalClass || decision?.visibleSignalClass || null,
    price: toNumber(ctx.indicators?.price ?? ctx.price),
    rrPlanned: toNumber(candidate?.meta?.plannedRr),
    rsi: toNumber(ctx.indicators?.rsi),
    prevRsi: toNumber(ctx.indicators?.prevRsi),
    atr: toNumber(ctx.indicators?.atr),
    atrPct: toNumber(ctx.indicators?.atrPct),
    adx: toNumber(ctx.indicators?.adx),
    ema20: toNumber(ctx.indicators?.ema20),
    ema50: toNumber(ctx.indicators?.ema50),
    ema200: toNumber(ctx.indicators?.ema200),
    bullish: ctx.indicators?.bullish === true,
    bullishFast: ctx.indicators?.bullishFast === true,
    nearEma20: ctx.indicators?.nearEma20 === true,
    nearEma50: ctx.indicators?.nearEma50 === true,
    nearPullback: ctx.indicators?.nearPullback === true,
    stackedEma: ctx.indicators?.stackedEma === true,
    rsiInBand: ctx.indicators?.rsiInBand === true,
    rsiRising: ctx.indicators?.rsiRising === true,
    isTrend: ctx.indicators?.isTrend === true,
    isRange: ctx.indicators?.isRange === true,
    emaSeparationPct: toNumber(ctx.indicators?.emaSeparationPct),
    emaSlopePct: toNumber(ctx.indicators?.emaSlopePct),
    distToEma20: toNumber(ctx.indicators?.distToEma20),
    distToEma50: toNumber(ctx.indicators?.distToEma50),
    nearestSupport: toNumber(ctx.nearestSupport?.price),
    nearestResistance: toNumber(ctx.nearestResistance?.price),
    distanceToSupportAtr: toNumber(srEval?.distanceToSupportAtr),
    distanceToResistanceAtr: toNumber(srEval?.distanceToResistanceAtr),
    srPassed: srEval?.passed === true,
    srReason: srEval?.reason || null,
    avgVol: toNumber(ctx.indicators?.avgVol),
  };
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

async function loadReplayData({ symbols, config }) {
  const availableSymbols = await fetchAvailableFuturesSymbols();
  const filteredSymbols = symbols.filter((symbol) => availableSymbols.has(symbol));
  const unavailableSymbols = symbols.filter((symbol) => !availableSymbols.has(symbol));
  const bySymbol = {};

  for (const symbol of filteredSymbols) {
    bySymbol[symbol] = {
      cfg: config[symbol],
      ltfCandles: await fetchKlines(symbol, TF, LTF_LIMIT),
      htfCandles: await fetchKlines(symbol, HTF_TF, HTF_LIMIT),
    };
  }

  return {
    filteredSymbols,
    unavailableSymbols,
    bySymbol,
  };
}

function replaySymbol(symbol, symbolData) {
  const { cfg, ltfCandles, htfCandles } = symbolData;
  const rows = [];
  let sourceIndex = 0;
  let htfEndIndex = 0;

  for (let i = 0; i < ltfCandles.length - HORIZON_BARS; i += 1) {
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

    if (!ctx) continue;

    const decision = evaluateAllStrategies(ctx);
    const candidates = selectReplayCandidates(decision);

    for (const candidate of candidates) {
      const logRow = buildBaseLogRow(symbol, candle, ctx, decision, candidate);
      const baseRow = buildCandidateRow(logRow, candidate, sourceIndex);
      sourceIndex += 1;

      if (!baseRow) continue;

      const labeled = labelCandidateWithCandles(baseRow, ltfCandles, {
        horizonBars: HORIZON_BARS,
      });

      rows.push({
        ...baseRow,
        sourceType: "historicalReplay",
        replaySymbol: symbol,
        replayTf: TF,
        replayHtfTf: HTF_TF,
        replayIncludeAllAllowed: INCLUDE_ALL_ALLOWED,
        replayIncludeBlockedGeometry: INCLUDE_BLOCKED_GEOMETRY,
        replayCandleIndex: i,
        replayWindowStart: ltfSlice[0]?.openTime || null,
        replayWindowEnd: candle.closeTime,
        replayWindowEndIso: candle.closeTime ? new Date(candle.closeTime).toISOString() : null,
        ...labeled,
      });
    }
  }

  return rows;
}

function buildReplaySummary(rows, symbols, unavailableSymbols) {
  const baseSummary = buildSummary(rows, { horizonBars: HORIZON_BARS });
  const bySymbol = {};

  for (const row of rows) {
    if (!bySymbol[row.symbol]) {
      bySymbol[row.symbol] = {
        total: 0,
        outcomes: {},
        strategies: {},
        avgRealizedPnlPct: 0,
      };
    }

    const stats = bySymbol[row.symbol];
    stats.total += 1;
    stats.outcomes[row.labelOutcome] = (stats.outcomes[row.labelOutcome] || 0) + 1;
    stats.avgRealizedPnlPct += Number(row.labelRealizedPnlPct || 0);
    stats.strategies[row.strategy] = (stats.strategies[row.strategy] || 0) + 1;
  }

  for (const stats of Object.values(bySymbol)) {
    stats.avgRealizedPnlPct =
      stats.total > 0 ? round(stats.avgRealizedPnlPct / stats.total, 8) : null;
  }

  return {
    ...baseSummary,
    tf: TF,
    htfTf: HTF_TF,
    ltfLimit: LTF_LIMIT,
    htfLimit: HTF_LIMIT,
    includeAllAllowed: INCLUDE_ALL_ALLOWED,
    includeBlockedGeometry: INCLUDE_BLOCKED_GEOMETRY,
    symbols,
    unavailableSymbols,
    bySymbol,
  };
}

async function buildHistoricalReplayDataset() {
  const requestedSymbols = resolveRequestedSymbols(
    String(process.env.REPLAY_SYMBOLS || "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );
  const config = buildRequestedConfig(requestedSymbols, {});
  const { filteredSymbols, unavailableSymbols, bySymbol } = await loadReplayData({
    symbols: requestedSymbols,
    config,
  });

  const rows = filteredSymbols.flatMap((symbol) => replaySymbol(symbol, bySymbol[symbol]));
  const summary = buildReplaySummary(rows, filteredSymbols, unavailableSymbols);

  writeJsonAtomic(OUTPUT_JSON, rows);
  writeJsonAtomic(OUTPUT_CSV, toCsv(rows));
  writeJsonAtomic(OUTPUT_SUMMARY, summary);

  return {
    rows,
    summary,
  };
}

async function main() {
  const { rows, summary } = await buildHistoricalReplayDataset();
  const firstSymbol = summary.symbols[0];
  const lastSymbol = summary.symbols[summary.symbols.length - 1];

  console.log(
    `[REPLAY_DATASET] rows=${rows.length} symbols=${summary.symbols.length} ` +
      `tf=${TF} htfTf=${HTF_TF} horizonBars=${HORIZON_BARS}`
  );
  if (firstSymbol) {
    console.log(
      `[REPLAY_DATASET] symbols=${firstSymbol}` +
        (lastSymbol && lastSymbol !== firstSymbol ? `...${lastSymbol}` : "")
    );
  }
  console.log(`[REPLAY_DATASET] json=${OUTPUT_JSON}`);
  console.log(`[REPLAY_DATASET] csv=${OUTPUT_CSV}`);
  console.log(`[REPLAY_DATASET] summary=${OUTPUT_SUMMARY}`);
  if (rows.length) {
    const minTs = Math.min(...rows.map((row) => Number(row.signalCandleCloseTime || 0)));
    const maxTs = Math.max(...rows.map((row) => Number(row.signalCandleCloseTime || 0)));
    console.log(
      `[REPLAY_DATASET] window=${formatIso(minTs)} -> ${formatIso(maxTs)} ` +
        `outcomes=${JSON.stringify(summary.outcomes)}`
    );
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("[REPLAY_DATASET] failed:", err.response?.data || err.message || err);
      process.exit(1);
    });
}

module.exports = {
  advanceHtfCursor,
  selectReplayCandidates,
  buildBaseLogRow,
  buildReplaySummary,
  buildHistoricalReplayDataset,
};
