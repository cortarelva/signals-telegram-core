require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  fetchAvailableFuturesSymbols,
  fetchKlines,
  round,
} = require("./backtest-candidate-strategies");
const { buildBtcRegimeSnapshot } = require("../runtime/btc-regime-context");

const BTC_SYMBOL = String(process.env.BTC_FACTOR_BTC_SYMBOL || "BTCUSDC").trim().toUpperCase();
const DEFAULT_ALT_SYMBOLS = ["ADAUSDC", "LINKUSDC", "XRPUSDC", "1000SHIBUSDC", "1000PEPEUSDC"];
const TF = process.env.BTC_FACTOR_TF || "5m";
const LIMIT = Number(process.env.BTC_FACTOR_LIMIT || 1800);
const LOOKAHEAD_BARS = Number(process.env.BTC_FACTOR_LOOKAHEAD_BARS || 6);
const WARMUP_BARS = Number(process.env.BTC_FACTOR_WARMUP_BARS || 96);

const OUTPUT_JSON = path.join(__dirname, "btc-factor-context-analysis.json");
const OUTPUT_CSV = path.join(__dirname, "btc-factor-context-analysis.csv");
const OUTPUT_TRANSITION_JSON = path.join(__dirname, "btc-factor-context-transitions.json");
const OUTPUT_TRANSITION_CSV = path.join(__dirname, "btc-factor-context-transitions.csv");
const OUTPUT_SUMMARY = path.join(__dirname, "btc-factor-context-summary.json");

function parseSymbolsOverride(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return null;

  const symbols = [...new Set(
    rawValue
      .split(",")
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  )];

  return symbols.length ? symbols : null;
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mean(values) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => safeNumber(value))
    .filter((value) => Number.isFinite(value));

  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
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

function pctChange(fromValue, toValue) {
  const from = safeNumber(fromValue);
  const to = safeNumber(toValue);

  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
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

function inferExpectedDirection(snapshot) {
  const state = snapshot?.state;
  const btcDirection = snapshot?.btc?.direction;

  if (state === "risk_off_selloff") return "SHORT";
  if (state === "alt_follow_rally") return "LONG";
  if (btcDirection === "down") return "SHORT";
  if (btcDirection === "up") return "LONG";
  return null;
}

function buildIndexByCloseTime(candles = []) {
  const map = new Map();

  candles.forEach((candle, index) => {
    const closeTime = Number(candle?.closeTime);
    if (Number.isFinite(closeTime)) {
      map.set(closeTime, index);
    }
  });

  return map;
}

function buildFollowThroughRow({
  symbol,
  candle,
  futureCandles,
  snapshot,
  expectedDirection,
  btcFutureReturnPct,
}) {
  const entryClose = safeNumber(candle?.close);
  const futureClose = safeNumber(futureCandles?.at(-1)?.close);

  if (!Number.isFinite(entryClose) || !Number.isFinite(futureClose) || !Array.isArray(futureCandles) || !futureCandles.length) {
    return null;
  }

  const highs = futureCandles.map((row) => safeNumber(row?.high)).filter((value) => Number.isFinite(value));
  const lows = futureCandles.map((row) => safeNumber(row?.low)).filter((value) => Number.isFinite(value));
  const futureReturnPct = pctChange(entryClose, futureClose);
  const maxHigh = highs.length ? Math.max(...highs) : futureClose;
  const minLow = lows.length ? Math.min(...lows) : futureClose;
  const longMfePct = pctChange(entryClose, maxHigh);
  const longMaePct =
    Number.isFinite(minLow) && entryClose !== 0 ? ((entryClose - minLow) / entryClose) * 100 : null;
  const shortMfePct =
    Number.isFinite(minLow) && entryClose !== 0 ? ((entryClose - minLow) / entryClose) * 100 : null;
  const shortMaePct = pctChange(entryClose, maxHigh);
  const alignedReturnPct =
    expectedDirection === "LONG"
      ? futureReturnPct
      : expectedDirection === "SHORT" && Number.isFinite(futureReturnPct)
        ? -futureReturnPct
        : null;
  const favorableMovePct =
    expectedDirection === "LONG"
      ? longMfePct
      : expectedDirection === "SHORT"
        ? shortMfePct
        : null;
  const adverseMovePct =
    expectedDirection === "LONG"
      ? longMaePct
      : expectedDirection === "SHORT" && Number.isFinite(shortMaePct)
        ? Math.max(0, shortMaePct)
        : null;

  return {
    signalTs: Number(candle.closeTime),
    signalIso: new Date(Number(candle.closeTime)).toISOString(),
    timeframe: TF,
    symbol,
    regimeState: snapshot.state,
    regimeLabel: snapshot.label,
    regimeSummary: snapshot.summary,
    btcDirection: snapshot?.btc?.direction || "unknown",
    expectedDirection,
    entryClose: round(entryClose, 8),
    futureClose: round(futureClose, 8),
    futureReturnPct: round(futureReturnPct, 6),
    alignedReturnPct: round(alignedReturnPct, 6),
    favorableMovePct: round(favorableMovePct, 6),
    adverseMovePct: round(adverseMovePct, 6),
    success:
      Number.isFinite(alignedReturnPct) ? alignedReturnPct > 0 : null,
    btcReturn1hPct: round(snapshot?.btc?.return1hPct, 6),
    btcReturn4hPct: round(snapshot?.btc?.return4hPct, 6),
    btcFutureReturnPct: round(btcFutureReturnPct, 6),
    altFollowRate: round(Number(snapshot?.alts?.followRate || 0), 6),
    positiveBreadth: round(Number(snapshot?.alts?.positiveBreadth || 0), 6),
    negativeBreadth: round(Number(snapshot?.alts?.negativeBreadth || 0), 6),
    strongestFollowerSymbol: snapshot?.alts?.strongestFollower?.symbol || null,
    strongestFollowerReturn1hPct: round(snapshot?.alts?.strongestFollower?.return1hPct, 6),
  };
}

function collectRegimeRows({
  candlesBySymbol,
  btcSymbol = BTC_SYMBOL,
  symbols,
  lookaheadBars = LOOKAHEAD_BARS,
  warmupBars = WARMUP_BARS,
}) {
  const btcCandles = candlesBySymbol?.[btcSymbol];
  if (!Array.isArray(btcCandles) || !btcCandles.length) return [];

  const allSymbols = [btcSymbol, ...symbols];
  const indexesBySymbol = Object.fromEntries(
    allSymbols.map((symbol) => [symbol, buildIndexByCloseTime(candlesBySymbol[symbol] || [])])
  );
  const rows = [];

  for (let btcIndex = warmupBars; btcIndex + lookaheadBars < btcCandles.length; btcIndex += 1) {
    const btcCandle = btcCandles[btcIndex];
    const closeTime = Number(btcCandle?.closeTime);
    if (!Number.isFinite(closeTime)) continue;

    const alignedIndexes = {};
    let missingAlignment = false;

    for (const symbol of allSymbols) {
      const symbolIndex = indexesBySymbol[symbol]?.get(closeTime);
      if (!Number.isFinite(symbolIndex) || symbolIndex < warmupBars || symbolIndex + lookaheadBars >= (candlesBySymbol[symbol] || []).length) {
        missingAlignment = true;
        break;
      }
      alignedIndexes[symbol] = symbolIndex;
    }

    if (missingAlignment) continue;

    const snapshot = buildBtcRegimeSnapshot({
      candlesBySymbol: Object.fromEntries(
        allSymbols.map((symbol) => [
          symbol,
          (candlesBySymbol[symbol] || []).slice(0, alignedIndexes[symbol] + 1),
        ])
      ),
      btcSymbol,
      timeframe: TF,
      asOf: new Date(closeTime).toISOString(),
    });

    if (!snapshot || snapshot.state === "unavailable") continue;

    const expectedDirection = inferExpectedDirection(snapshot);
    const btcFutureCandles = btcCandles.slice(btcIndex + 1, btcIndex + 1 + lookaheadBars);
    const btcFutureReturnPct = pctChange(btcCandle.close, btcFutureCandles.at(-1)?.close);

    for (const symbol of symbols) {
      const symbolIndex = alignedIndexes[symbol];
      const symbolCandles = candlesBySymbol[symbol];
      const candle = symbolCandles[symbolIndex];
      const futureCandles = symbolCandles.slice(symbolIndex + 1, symbolIndex + 1 + lookaheadBars);
      const row = buildFollowThroughRow({
        symbol,
        candle,
        futureCandles,
        snapshot,
        expectedDirection,
        btcFutureReturnPct,
      });

      if (row) {
        rows.push(row);
      }
    }
  }

  return rows;
}

function buildSummary(rows, { symbols, unavailableSymbols, btcSymbol = BTC_SYMBOL } = {}) {
  const summary = {
    generatedAt: new Date().toISOString(),
    timeframe: TF,
    btcSymbol,
    lookaheadBars: LOOKAHEAD_BARS,
    warmupBars: WARMUP_BARS,
    totalRows: rows.length,
    symbols,
    unavailableSymbols,
    byState: {},
  };

  for (const row of rows) {
    if (!summary.byState[row.regimeState]) {
      summary.byState[row.regimeState] = {
        total: 0,
        successCount: 0,
        successRate: null,
        avgFutureReturnPct: null,
        avgAlignedReturnPct: null,
        medianAlignedReturnPct: null,
        avgFavorableMovePct: null,
        avgAdverseMovePct: null,
        avgBtcFutureReturnPct: null,
        bySymbol: {},
      };
    }

    const stateStats = summary.byState[row.regimeState];
    if (!stateStats.bySymbol[row.symbol]) {
      stateStats.bySymbol[row.symbol] = {
        total: 0,
        successCount: 0,
        successRate: null,
        avgFutureReturnPct: null,
        avgAlignedReturnPct: null,
        medianAlignedReturnPct: null,
        avgFavorableMovePct: null,
        avgAdverseMovePct: null,
        avgBtcFutureReturnPct: null,
      };
    }

    stateStats.total += 1;
    if (row.success === true) stateStats.successCount += 1;
    stateStats.bySymbol[row.symbol].total += 1;
    if (row.success === true) stateStats.bySymbol[row.symbol].successCount += 1;
  }

  for (const [state, stateStats] of Object.entries(summary.byState)) {
    const stateRows = rows.filter((row) => row.regimeState === state);
    stateStats.successRate = stateStats.total
      ? round(stateStats.successCount / stateStats.total, 6)
      : null;
    stateStats.avgFutureReturnPct = round(mean(stateRows.map((row) => row.futureReturnPct)), 6);
    stateStats.avgAlignedReturnPct = round(mean(stateRows.map((row) => row.alignedReturnPct)), 6);
    stateStats.medianAlignedReturnPct = round(median(stateRows.map((row) => row.alignedReturnPct)), 6);
    stateStats.avgFavorableMovePct = round(mean(stateRows.map((row) => row.favorableMovePct)), 6);
    stateStats.avgAdverseMovePct = round(mean(stateRows.map((row) => row.adverseMovePct)), 6);
    stateStats.avgBtcFutureReturnPct = round(mean(stateRows.map((row) => row.btcFutureReturnPct)), 6);

    for (const [symbol, symbolStats] of Object.entries(stateStats.bySymbol)) {
      const symbolRows = stateRows.filter((row) => row.symbol === symbol);
      symbolStats.successRate = symbolStats.total
        ? round(symbolStats.successCount / symbolStats.total, 6)
        : null;
      symbolStats.avgFutureReturnPct = round(mean(symbolRows.map((row) => row.futureReturnPct)), 6);
      symbolStats.avgAlignedReturnPct = round(mean(symbolRows.map((row) => row.alignedReturnPct)), 6);
      symbolStats.medianAlignedReturnPct = round(median(symbolRows.map((row) => row.alignedReturnPct)), 6);
      symbolStats.avgFavorableMovePct = round(mean(symbolRows.map((row) => row.favorableMovePct)), 6);
      symbolStats.avgAdverseMovePct = round(mean(symbolRows.map((row) => row.adverseMovePct)), 6);
      symbolStats.avgBtcFutureReturnPct = round(mean(symbolRows.map((row) => row.btcFutureReturnPct)), 6);
    }

    stateStats.symbolRanking = Object.entries(stateStats.bySymbol)
      .map(([symbol, symbolStats]) => ({
        symbol,
        total: symbolStats.total,
        successRate: symbolStats.successRate,
        avgAlignedReturnPct: symbolStats.avgAlignedReturnPct,
        medianAlignedReturnPct: symbolStats.medianAlignedReturnPct,
      }))
      .sort((a, b) => {
        const aScore = Number(a.avgAlignedReturnPct || -999);
        const bScore = Number(b.avgAlignedReturnPct || -999);
        if (bScore !== aScore) return bScore - aScore;
        return Number(b.successRate || 0) - Number(a.successRate || 0);
      });
  }

  return summary;
}

function filterTransitionRows(rows) {
  const ordered = Array.isArray(rows)
    ? rows.slice().sort((a, b) => Number(a.signalTs || 0) - Number(b.signalTs || 0))
    : [];
  const transitionTimestamps = new Set();
  let lastTimestamp = null;
  let lastState = null;

  for (const row of ordered) {
    const ts = Number(row?.signalTs);
    const state = row?.regimeState;
    if (!Number.isFinite(ts) || !state) continue;

    if (ts === lastTimestamp) continue;

    if (lastState === null || state !== lastState) {
      transitionTimestamps.add(ts);
    }

    lastTimestamp = ts;
    lastState = state;
  }

  return ordered.filter((row) => transitionTimestamps.has(Number(row?.signalTs)));
}

async function main() {
  const requestedSymbols = parseSymbolsOverride(process.env.BTC_FACTOR_SYMBOLS) || DEFAULT_ALT_SYMBOLS;
  const availableSymbols = await fetchAvailableFuturesSymbols();
  const filteredSymbols = requestedSymbols.filter((symbol) => availableSymbols.has(symbol));
  const unavailableSymbols = requestedSymbols.filter((symbol) => !availableSymbols.has(symbol));
  const allSymbols = [BTC_SYMBOL, ...filteredSymbols];
  const candlesBySymbol = {};

  for (const symbol of allSymbols) {
    console.log(`[BTC FACTOR] ${symbol} ${TF}`);
    candlesBySymbol[symbol] = await fetchKlines(symbol, TF, LIMIT);
  }

  const rows = collectRegimeRows({
    candlesBySymbol,
    btcSymbol: BTC_SYMBOL,
    symbols: filteredSymbols,
  });
  const transitionRows = filterTransitionRows(rows);

  const summary = buildSummary(rows, {
    symbols: filteredSymbols,
    unavailableSymbols,
    btcSymbol: BTC_SYMBOL,
  });
  summary.transitionOnly = buildSummary(transitionRows, {
    symbols: filteredSymbols,
    unavailableSymbols,
    btcSymbol: BTC_SYMBOL,
  });

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(rows, null, 2), "utf8");
  fs.writeFileSync(OUTPUT_CSV, toCsv(rows), "utf8");
  fs.writeFileSync(OUTPUT_TRANSITION_JSON, JSON.stringify(transitionRows, null, 2), "utf8");
  fs.writeFileSync(OUTPUT_TRANSITION_CSV, toCsv(transitionRows), "utf8");
  fs.writeFileSync(OUTPUT_SUMMARY, JSON.stringify(summary, null, 2), "utf8");

  console.log(`BTC factor rows: ${rows.length}`);
  console.log(`BTC factor transitions: ${transitionRows.length}`);
  console.log(`Saved JSON: ${OUTPUT_JSON}`);
  console.log(`Saved CSV: ${OUTPUT_CSV}`);
  console.log(`Saved transition JSON: ${OUTPUT_TRANSITION_JSON}`);
  console.log(`Saved transition CSV: ${OUTPUT_TRANSITION_CSV}`);
  console.log(`Saved summary: ${OUTPUT_SUMMARY}`);

  for (const [state, stats] of Object.entries(summary.byState)) {
    console.log(
      `${state}: rows=${stats.total} success=${((stats.successRate || 0) * 100).toFixed(1)}% ` +
        `avgAligned=${Number(stats.avgAlignedReturnPct || 0).toFixed(4)}% ` +
        `btcNext=${Number(stats.avgBtcFutureReturnPct || 0).toFixed(4)}%`
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  parseSymbolsOverride,
  inferExpectedDirection,
  buildFollowThroughRow,
  collectRegimeRows,
  buildSummary,
  filterTransitionRows,
  toCsv,
};
