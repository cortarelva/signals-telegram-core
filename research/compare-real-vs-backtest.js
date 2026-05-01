require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { runCandidateStrategyBacktest } = require("./backtest-candidate-strategies");

const WINDOW_HOURS = Number(process.env.COMPARE_WINDOW_HOURS || 48);
const OUTPUT_FILE = process.env.COMPARE_OUTPUT_FILE
  ? path.resolve(process.cwd(), process.env.COMPARE_OUTPUT_FILE)
  : path.join(__dirname, "compare-real-vs-backtest.json");
const CONSOLIDATED_FILE = path.join(__dirname, "consolidated-trades.json");
const BACKTEST_CACHE_FILE = path.join(__dirname, "compare-real-vs-backtest.backtest.json");

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function round(value, decimals = 6) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(decimals)) : 0;
}

function sum(rows, getter) {
  return (Array.isArray(rows) ? rows : []).reduce((acc, row) => acc + Number(getter(row) || 0), 0);
}

function avg(rows, getter) {
  const items = (Array.isArray(rows) ? rows : []).map((row) => Number(getter(row)));
  const valid = items.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((acc, value) => acc + value, 0) / valid.length;
}

function groupBy(rows, keyFn) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = keyFn(row);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
}

function realizedGrossPct(row) {
  const tradeUsd = Number(row?.tradeUsd || row?.positionUsd || 0);
  const gross = Number(row?.pnlRealizedGross);
  if (Number.isFinite(tradeUsd) && tradeUsd > 0 && Number.isFinite(gross)) {
    return (gross / tradeUsd) * 100;
  }
  return Number(row?.pnlPct || 0);
}

function summarizeRealRows(rows) {
  return {
    trades: rows.length,
    grossReal: round(sum(rows, (row) => row?.pnlRealizedGross ?? row?.pnlUsd ?? 0), 8),
    feesReal: round(sum(rows, (row) => row?.fees ?? 0), 8),
    netReal: round(sum(rows, (row) => row?.pnlRealizedNet ?? row?.pnlUsd ?? 0), 8),
    avgGrossRealPct: round(avg(rows, (row) => realizedGrossPct(row)), 6),
    avgNetRealPct: round(avg(rows, (row) => row?.pnlPct ?? 0), 6),
  };
}

function weightedExpectation(rows, backtestLookup, selector) {
  let weighted = 0;
  let weight = 0;

  for (const row of rows) {
    const value = selector(row, backtestLookup);
    if (!Number.isFinite(Number(value))) continue;
    weighted += Number(value);
    weight += 1;
  }

  return weight > 0 ? weighted / weight : null;
}

function buildBacktestLookup(backtestOutput) {
  const bySymbolStrategy = new Map();

  for (const strategyRow of backtestOutput?.ranked || []) {
    for (const [symbol, symbolRow] of Object.entries(strategyRow.bySymbol || {})) {
      bySymbolStrategy.set(`${symbol}__${strategyRow.strategy}`, {
        strategy: strategyRow.strategy,
        symbol,
        summary: symbolRow.summary || {},
      });
    }
  }

  return {
    bySymbolStrategy,
  };
}

function recommend(realSummary, expectedAvgNetPct) {
  if (realSummary.trades < 3) return "observe";
  if (!Number.isFinite(Number(expectedAvgNetPct))) return "observe";
  if (Number(expectedAvgNetPct) <= 0) return "desligar";
  if (realSummary.netReal > 0) return "manter";
  return "paper-only";
}

async function main() {
  const consolidated = readJsonSafe(CONSOLIDATED_FILE, []);
  const windowMs = Math.max(1, WINDOW_HOURS) * 60 * 60 * 1000;
  const cutoffTs = Date.now() - windowMs;
  const realRows = consolidated.filter(
    (row) =>
      row &&
      row.mode === "binance_real" &&
      Number(row.closedTs || 0) >= cutoffTs
  );

  const symbols = [...new Set(realRows.map((row) => row.symbol).filter(Boolean))];
  const strategies = [...new Set(realRows.map((row) => row.strategy).filter(Boolean))];

  let backtestOutput = {
    ranked: [],
    tf: null,
    htfTf: null,
  };

  if (symbols.length && strategies.length) {
    backtestOutput = await runCandidateStrategyBacktest({
      symbols,
      strategies,
      outputFile: BACKTEST_CACHE_FILE,
      includeTrades: false,
    });
  }

  const backtestLookup = buildBacktestLookup(backtestOutput);
  const bySymbolStrategy = groupBy(realRows, (row) => `${row.symbol}__${row.strategy}`);
  const bySymbol = groupBy(realRows, (row) => row.symbol);
  const byStrategy = groupBy(realRows, (row) => row.strategy);

  const symbolStrategyTable = [...bySymbolStrategy.entries()].map(([key, rows]) => {
    const [symbol, strategy] = key.split("__");
    const realSummary = summarizeRealRows(rows);
    const expected = backtestLookup.bySymbolStrategy.get(key)?.summary || {};
    const expectedAvgNetPct = Number(expected.avgNetPnlPct);

    return {
      symbol,
      strategy,
      trades: realSummary.trades,
      grossReal: realSummary.grossReal,
      feesReal: realSummary.feesReal,
      netReal: realSummary.netReal,
      avgNetRealPct: realSummary.avgNetRealPct,
      backtestAvgNetPct: Number.isFinite(expectedAvgNetPct) ? round(expectedAvgNetPct, 6) : null,
      realVsExpectedPctDiff: Number.isFinite(expectedAvgNetPct)
        ? round(realSummary.avgNetRealPct - expectedAvgNetPct, 6)
        : null,
      recommendation: recommend(realSummary, expectedAvgNetPct),
    };
  });

  const symbolTable = [...bySymbol.entries()].map(([symbol, rows]) => {
    const realSummary = summarizeRealRows(rows);
    const expectedAvgNetPct = weightedExpectation(rows, backtestLookup, (row, lookup) => {
      const expected = lookup.bySymbolStrategy.get(`${row.symbol}__${row.strategy}`)?.summary || {};
      return expected.avgNetPnlPct;
    });

    return {
      symbol,
      trades: realSummary.trades,
      grossReal: realSummary.grossReal,
      feesReal: realSummary.feesReal,
      netReal: realSummary.netReal,
      avgNetRealPct: realSummary.avgNetRealPct,
      backtestAvgNetPct:
        Number.isFinite(Number(expectedAvgNetPct)) ? round(expectedAvgNetPct, 6) : null,
      realVsExpectedPctDiff:
        Number.isFinite(Number(expectedAvgNetPct))
          ? round(realSummary.avgNetRealPct - Number(expectedAvgNetPct), 6)
          : null,
      recommendation: recommend(realSummary, expectedAvgNetPct),
    };
  });

  const strategyTable = [...byStrategy.entries()].map(([strategy, rows]) => {
    const realSummary = summarizeRealRows(rows);
    const expectedAvgNetPct = weightedExpectation(rows, backtestLookup, (row, lookup) => {
      const expected = lookup.bySymbolStrategy.get(`${row.symbol}__${row.strategy}`)?.summary || {};
      return expected.avgNetPnlPct;
    });

    return {
      strategy,
      trades: realSummary.trades,
      grossReal: realSummary.grossReal,
      feesReal: realSummary.feesReal,
      netReal: realSummary.netReal,
      avgNetRealPct: realSummary.avgNetRealPct,
      backtestAvgNetPct:
        Number.isFinite(Number(expectedAvgNetPct)) ? round(expectedAvgNetPct, 6) : null,
      realVsExpectedPctDiff:
        Number.isFinite(Number(expectedAvgNetPct))
          ? round(realSummary.avgNetRealPct - Number(expectedAvgNetPct), 6)
          : null,
      recommendation: recommend(realSummary, expectedAvgNetPct),
    };
  });

  const mismatches = realRows
    .filter((row) => {
      const theoretical = Number(row?.pnlTheoretical);
      const realized = Number(row?.pnlRealizedGross ?? row?.pnlRealizedNet ?? row?.pnlUsd);
      return (
        row?.pnlSource === "theoretical_fallback" ||
        (Number.isFinite(theoretical) &&
          Number.isFinite(realized) &&
          Math.abs(theoretical - realized) > 1e-8)
      );
    })
    .map((row) => ({
      executionId: row.executionId,
      symbol: row.symbol,
      strategy: row.strategy,
      closedIso: row.closedIso,
      pnlSource: row.pnlSource,
      pnlTheoretical: row.pnlTheoretical,
      pnlRealizedGross: row.pnlRealizedGross,
      fees: row.fees,
      pnlRealizedNet: row.pnlRealizedNet,
      closeReasonInternal: row.closeReasonInternal,
      closeReasonExchange: row.closeReasonExchange,
    }));

  const summary = {
    generatedAt: new Date().toISOString(),
    windowHours: WINDOW_HOURS,
    realTrades: realRows.length,
    symbols,
    strategies,
    backtestExecutionCosts: backtestOutput?.executionCosts || null,
    realSummary: summarizeRealRows(realRows),
    symbolTable,
    strategyTable,
    symbolStrategyTable,
    mismatches,
  };

  writeJsonSafe(OUTPUT_FILE, summary);

  console.log(`Window: last ${WINDOW_HOURS}h`);
  console.log(`Saved: ${OUTPUT_FILE}`);
  console.log(`Real trades: ${realRows.length}`);

  if (symbolTable.length) {
    console.log("\nBy symbol");
    console.table(symbolTable);
  }

  if (strategyTable.length) {
    console.log("\nBy strategy");
    console.table(strategyTable);
  }

  if (mismatches.length) {
    console.log("\nMismatches");
    console.table(mismatches.slice(0, 20));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
