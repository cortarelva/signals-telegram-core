require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("../runtime/file-utils");

const SOURCE_FILE = process.env.TRADFI_META_SOURCE_FILE
  ? path.resolve(process.cwd(), process.env.TRADFI_META_SOURCE_FILE)
  : path.join(
      __dirname,
      "cache",
      "tradfi-twelve-equities-backtests",
      "equities_reversal_1h_1d_core.full.json"
    );
const STRATEGY = String(process.env.TRADFI_META_STRATEGY || "oversoldBounce").trim();
const OUTPUT_DIR = process.env.TRADFI_META_OUTPUT_DIR
  ? path.resolve(process.cwd(), process.env.TRADFI_META_OUTPUT_DIR)
  : path.join(__dirname, "meta-models-tradfi", "equities-reversal-1h-1d-core");
const REQUESTED_SYMBOLS = String(process.env.TRADFI_META_SYMBOLS || "")
  .split(",")
  .map((value) => String(value || "").trim().toUpperCase())
  .filter(Boolean);

function formatIso(ts) {
  return Number.isFinite(Number(ts)) ? new Date(Number(ts)).toISOString() : null;
}

function sanitizeFileName(value) {
  return String(value || "dataset")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function toCsv(rows) {
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  return lines.join("\n");
}

function extractBacktestTradeRows(
  backtest,
  strategyName = STRATEGY,
  requestedSymbols = REQUESTED_SYMBOLS
) {
  const rankedRows = Array.isArray(backtest?.ranked) ? backtest.ranked : [];
  const targetRows = rankedRows.filter((row) => row?.strategy === strategyName);
  const datasetRows = [];
  const requestedSet = new Set(requestedSymbols || []);

  for (const row of targetRows) {
    for (const [symbol, symbolBlock] of Object.entries(row.bySymbol || {})) {
      if (requestedSet.size && !requestedSet.has(String(symbol).toUpperCase())) {
        continue;
      }
      const trades = Array.isArray(symbolBlock?.trades) ? symbolBlock.trades : [];
      for (const trade of trades) {
        datasetRows.push(
          buildTradfiDatasetRow(trade, {
            symbol,
            tf: backtest.tf,
            htfTf: backtest.htfTf,
            strategy: row.strategy,
            direction: row.direction,
          })
        );
      }
    }
  }

  return datasetRows.sort(
    (a, b) => Number(a.signalCandleCloseTime || a.signalTs || 0) - Number(b.signalCandleCloseTime || b.signalTs || 0)
  );
}

function buildTradfiDatasetRow(trade, context = {}) {
  const signalTime = Number(
    trade.signalCandleCloseTime || trade.signalTs || trade.openTime || 0
  );
  const outcomeTime = Number(trade.labelOutcomeTs || trade.closeTime || 0);

  return {
    sourceType: "tradfiBacktest",
    sourceProfileLabel: context.profileLabel || null,
    sourceFile: context.sourceFile || null,
    signalTs: signalTime || null,
    signalIso: formatIso(signalTime),
    signalCandleCloseTime: signalTime || null,
    signalCandleCloseIso: formatIso(signalTime),
    symbol: context.symbol || trade.symbol || null,
    tf: context.tf || trade.tf || null,
    htfTf: context.htfTf || trade.htfTf || null,
    strategy: context.strategy || trade.strategy || null,
    direction: context.direction || trade.direction || null,
    selectedStrategy: context.strategy || trade.strategy || null,
    selectedDirection: context.direction || trade.direction || null,
    decisionReason: trade.reason || "selected",
    candidateReason: trade.reason || "selected",
    executionAttempted: true,
    executionApproved: true,
    executionReason: "backtest_selected",
    allowed: true,
    score: trade.score ?? null,
    signalClass: trade.signalClass ?? null,
    minScore: trade.minScore ?? null,
    price: trade.price ?? trade.entry ?? null,
    entry: trade.entry ?? null,
    sl: trade.sl ?? null,
    tp: trade.tp ?? null,
    tpRawAtr: trade.tpRawAtr ?? null,
    tpCappedByResistance: trade.tpCappedByResistance ?? null,
    tpCappedBySupport: trade.tpCappedBySupport ?? null,
    riskAbs: trade.riskAbs ?? null,
    rewardAbs: trade.rewardAbs ?? null,
    rrPlanned: trade.rrPlanned ?? null,
    rsi: trade.rsi ?? null,
    prevRsi: trade.prevRsi ?? null,
    atr: trade.atr ?? null,
    atrPct: trade.atrPct ?? null,
    adx: trade.adx ?? null,
    ema20: trade.ema20 ?? null,
    ema50: trade.ema50 ?? null,
    ema200: trade.ema200 ?? null,
    bullish: trade.bullish ?? null,
    bullishFast: trade.bullishFast ?? null,
    nearEma20: trade.nearEma20 ?? null,
    nearEma50: trade.nearEma50 ?? null,
    nearPullback: trade.nearPullback ?? null,
    stackedEma: trade.stackedEma ?? null,
    rsiRising: trade.rsiRising ?? null,
    isTrend: trade.isTrend ?? null,
    isRange: trade.isRange ?? null,
    emaSeparationPct: trade.emaSeparationPct ?? null,
    emaSlopePct: trade.emaSlopePct ?? null,
    distToEma20: trade.distToEma20 ?? null,
    distToEma50: trade.distToEma50 ?? null,
    nearestSupport: trade.nearestSupport ?? null,
    nearestResistance: trade.nearestResistance ?? null,
    distanceToSupportAtr: trade.distanceToSupportAtr ?? null,
    distanceToResistanceAtr: trade.distanceToResistanceAtr ?? null,
    srPassed: trade.srPassed ?? null,
    srReason: trade.srReason ?? null,
    avgVol: trade.avgVol ?? null,
    referenceCandleCloseTime:
      trade.referenceCandleCloseTime ?? signalTime ?? null,
    referenceCandleCloseIso:
      trade.referenceCandleCloseIso ||
      formatIso(trade.referenceCandleCloseTime ?? signalTime),
    labelOutcome: trade.outcome ?? null,
    labelBucket: trade.outcome ?? null,
    labelTpHit: trade.outcome === "TP",
    labelSlHit: trade.outcome === "SL",
    labelTimeout: false,
    labelAmbiguous: false,
    barsObserved: trade.barsHeld ?? null,
    barsToOutcome: trade.barsHeld ?? null,
    labelOutcomeTs: outcomeTime || null,
    labelOutcomeIso: formatIso(outcomeTime),
    labelOutcomePrice: trade.exitPrice ?? null,
    labelRealizedPnlPct: trade.pnlPct ?? null,
    labelTimeoutPnlPct: null,
    labelMfePct: null,
    labelMaePct: null,
    labelMfeR: null,
    labelMaeR: null,
    openTime: trade.openTime ?? signalTime ?? null,
    closeTime: trade.closeTime ?? outcomeTime ?? null,
    barsHeld: trade.barsHeld ?? null,
    outcome: trade.outcome ?? null,
    exitPrice: trade.exitPrice ?? null,
    pnlPct: trade.pnlPct ?? null,
    rr: trade.rr ?? null,
    ...Object.fromEntries(
      Object.entries(trade || {}).filter(([key]) => key.startsWith("candidateMeta_"))
    ),
  };
}

function summarizeTradfiDataset(rows, context = {}) {
  const outcomes = rows.reduce((acc, row) => {
    const key = row.labelOutcome || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const bySymbol = rows.reduce((acc, row) => {
    const symbol = row.symbol || "UNKNOWN";
    if (!acc[symbol]) {
      acc[symbol] = {
        rows: 0,
        avgPnlPct: 0,
        tp: 0,
        sl: 0,
      };
    }

    acc[symbol].rows += 1;
    acc[symbol].avgPnlPct += Number(row.labelRealizedPnlPct || 0);
    if (row.labelOutcome === "TP") acc[symbol].tp += 1;
    if (row.labelOutcome === "SL") acc[symbol].sl += 1;
    return acc;
  }, {});

  for (const item of Object.values(bySymbol)) {
    item.avgPnlPct = item.rows ? item.avgPnlPct / item.rows : 0;
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceFile: context.sourceFile || null,
    strategy: context.strategy || STRATEGY,
    tf: context.tf || null,
    htfTf: context.htfTf || null,
    symbols: context.symbols || [],
    totalRows: rows.length,
    outcomes,
    bySymbol,
  };
}

function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`Backtest source not found: ${SOURCE_FILE}`);
  }

  const backtest = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
  const rows = extractBacktestTradeRows(backtest, STRATEGY, REQUESTED_SYMBOLS);

  if (!rows.length) {
    throw new Error(
      `No trade rows found for strategy=${STRATEGY}. Re-run the TradFi backtest with BACKTEST_INCLUDE_TRADES=1.`
    );
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const baseName = sanitizeFileName(`${STRATEGY}-${backtest.tf}-${backtest.htfTf}`);
  const jsonFile = path.join(OUTPUT_DIR, `${baseName}-dataset.json`);
  const csvFile = path.join(OUTPUT_DIR, `${baseName}-dataset.csv`);
  const summaryFile = path.join(OUTPUT_DIR, `${baseName}-summary.json`);

  const summary = summarizeTradfiDataset(rows, {
    sourceFile: SOURCE_FILE,
    strategy: STRATEGY,
    tf: backtest.tf,
    htfTf: backtest.htfTf,
    symbols: REQUESTED_SYMBOLS,
  });

  writeJsonAtomic(jsonFile, rows);
  fs.writeFileSync(csvFile, `${toCsv(rows)}\n`, "utf8");
  writeJsonAtomic(summaryFile, summary);

  console.log(
    `[TRADFI_META_DATASET] rows=${rows.length} strategy=${STRATEGY} json=${jsonFile} csv=${csvFile} summary=${summaryFile}`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  extractBacktestTradeRows,
  buildTradfiDatasetRow,
  summarizeTradfiDataset,
  sanitizeFileName,
};
