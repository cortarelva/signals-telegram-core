const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.join(__dirname, "consolidated-trades.json");
const OUTPUT_FILE = path.join(__dirname, "current-strategy-optimization.json");

const STRATEGIES = ["trend", "trendShort"];

function loadTrades() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Ficheiro não encontrado: ${INPUT_FILE}`);
  }

  const rows = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
  if (!Array.isArray(rows)) {
    throw new Error("consolidated-trades.json deve ser um array.");
  }
  return rows;
}

function isResolvedTrade(trade) {
  return trade && (trade.outcome === "TP" || trade.outcome === "SL");
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function avg(values) {
  const nums = values.map(toNumber).filter((v) => v != null);
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function summarize(trades) {
  const resolved = trades.filter(isResolvedTrade);
  const tp = resolved.filter((t) => t.outcome === "TP").length;
  const sl = resolved.filter((t) => t.outcome === "SL").length;
  const avgR = avg(resolved.map((t) => t.rrRealized));
  const avgPnlPct = avg(resolved.map((t) => t.pnlPct));
  const winrate = resolved.length ? (tp / resolved.length) * 100 : 0;

  return {
    trades: resolved.length,
    tp,
    sl,
    winrate,
    avgR,
    avgPnlPct,
  };
}

function passesBand(value, min, max) {
  const n = toNumber(value);
  if (n == null) return false;
  return n >= min && n <= max;
}

function strategyFilterSets(strategy) {
  if (strategy === "trendShort") {
    return {
      minScores: [60, 65, 70, 75, 80],
      minAdx: [12, 15, 18, 20, 25],
      rsiBands: [
        [35, 55],
        [38, 54],
        [40, 52],
        [42, 52],
      ],
      requireNearPullback: [false, true],
      requireNearEma20: [false, true],
      requireStackedEma: [false],
      requireSr: [false, true],
      requireRsiFalling: [false, true],
    };
  }

  return {
    minScores: [55, 60, 65, 70, 75],
    minAdx: [12, 15, 18, 20, 25, 30],
    rsiBands: [
      [40, 60],
      [45, 60],
      [45, 58],
      [50, 60],
      [50, 55],
    ],
    requireNearPullback: [false, true],
    requireNearEma20: [false, true],
    requireStackedEma: [false, true],
    requireSr: [false, true],
    requireRsiFalling: [false],
  };
}

function comboToLabel(combo) {
  return [
    `score>=${combo.minScore}`,
    `adx>=${combo.minAdx}`,
    `rsi=${combo.rsiMin}-${combo.rsiMax}`,
    combo.requireNearPullback ? "pullback" : "no-pullback-filter",
    combo.requireNearEma20 ? "nearEma20" : "no-nearEma20-filter",
    combo.requireStackedEma ? "stackedEma" : "no-stackedEma-filter",
    combo.requireSr ? "sr" : "no-sr-filter",
    combo.requireRsiFalling ? "rsiFalling" : "no-rsiFalling-filter",
  ].join(" | ");
}

function filterTrades(trades, combo) {
  return trades.filter((trade) => {
    const score = toNumber(trade.score);
    const adx = toNumber(trade.adx);

    if (score == null || score < combo.minScore) return false;
    if (adx == null || adx < combo.minAdx) return false;
    if (!passesBand(trade.rsi, combo.rsiMin, combo.rsiMax)) return false;
    if (combo.requireNearPullback && trade.nearPullback !== true) return false;
    if (combo.requireNearEma20 && trade.nearEma20 !== true) return false;
    if (combo.requireStackedEma && trade.stackedEma !== true) return false;
    if (combo.requireSr && trade.srPassed !== true) return false;
    if (combo.requireRsiFalling && trade.rsiRising !== false) return false;

    return true;
  });
}

function searchBestCombos(trades, strategy, minTrades = 8) {
  const filters = strategyFilterSets(strategy);
  const baseline = summarize(trades);
  const candidates = [];

  for (const minScore of filters.minScores) {
    for (const minAdx of filters.minAdx) {
      for (const [rsiMin, rsiMax] of filters.rsiBands) {
        for (const requireNearPullback of filters.requireNearPullback) {
          for (const requireNearEma20 of filters.requireNearEma20) {
            for (const requireStackedEma of filters.requireStackedEma) {
              for (const requireSr of filters.requireSr) {
                for (const requireRsiFalling of filters.requireRsiFalling) {
                  const combo = {
                    minScore,
                    minAdx,
                    rsiMin,
                    rsiMax,
                    requireNearPullback,
                    requireNearEma20,
                    requireStackedEma,
                    requireSr,
                    requireRsiFalling,
                  };

                  const filtered = filterTrades(trades, combo);
                  const stats = summarize(filtered);

                  if (stats.trades < minTrades) continue;

                  candidates.push({
                    combo,
                    label: comboToLabel(combo),
                    stats,
                    deltaAvgR: stats.avgR - baseline.avgR,
                    deltaAvgPnlPct: stats.avgPnlPct - baseline.avgPnlPct,
                    deltaWinrate: stats.winrate - baseline.winrate,
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  candidates.sort((a, b) => {
    if (b.stats.avgPnlPct !== a.stats.avgPnlPct) return b.stats.avgPnlPct - a.stats.avgPnlPct;
    if (b.stats.avgR !== a.stats.avgR) return b.stats.avgR - a.stats.avgR;
    if (b.stats.winrate !== a.stats.winrate) return b.stats.winrate - a.stats.winrate;
    return b.stats.trades - a.stats.trades;
  });

  return {
    baseline,
    top: candidates.slice(0, 10),
  };
}

function groupBy(rows, keyFn) {
  const out = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
}

function printBlock(title, result) {
  console.log(`\n=== ${title} ===`);
  console.log(
    `baseline: trades=${result.baseline.trades} winrate=${result.baseline.winrate.toFixed(
      2
    )}% avgR=${result.baseline.avgR.toFixed(4)} avgPnl=${result.baseline.avgPnlPct.toFixed(4)}`
  );

  if (!result.top.length) {
    console.log("sem candidatos com amostra mínima");
    return;
  }

  result.top.slice(0, 5).forEach((row, idx) => {
    console.log(
      `#${idx + 1} trades=${String(row.stats.trades).padStart(3)} ` +
        `winrate=${row.stats.winrate.toFixed(2).padStart(6)}% ` +
        `avgR=${row.stats.avgR.toFixed(4).padStart(8)} ` +
        `avgPnl=${row.stats.avgPnlPct.toFixed(4).padStart(8)} ` +
        `dPnl=${row.deltaAvgPnlPct.toFixed(4).padStart(8)} ` +
        `dR=${row.deltaAvgR.toFixed(4).padStart(8)} ` +
        `${row.label}`
    );
  });
}

function main() {
  const rows = loadTrades().filter(isResolvedTrade);
  const strategyRows = rows.filter((row) => STRATEGIES.includes(row.strategy));
  const output = {
    generatedAt: new Date().toISOString(),
    inputFile: INPUT_FILE,
    global: {},
    bySymbol: {},
  };

  for (const strategy of STRATEGIES) {
    const trades = strategyRows.filter((row) => row.strategy === strategy);
    const globalResult = searchBestCombos(
      trades,
      strategy,
      strategy === "trendShort" ? 5 : 12
    );
    output.global[strategy] = globalResult;
    printBlock(`GLOBAL ${strategy}`, globalResult);

    const bySymbol = groupBy(trades, (row) => row.symbol);
    output.bySymbol[strategy] = {};

    for (const [symbol, symbolTrades] of bySymbol.entries()) {
      const symbolResult = searchBestCombos(
        symbolTrades,
        strategy,
        strategy === "trendShort" ? 3 : 5
      );
      output.bySymbol[strategy][symbol] = symbolResult;
      printBlock(`${strategy} ${symbol}`, symbolResult);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf8");
  console.log(`\nSaved optimization report: ${OUTPUT_FILE}`);
}

main();
