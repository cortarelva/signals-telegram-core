const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "consolidated-trades.json");

function loadTrades() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Ficheiro não encontrado: ${DATA_FILE}`);
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  if (!Array.isArray(data)) {
    throw new Error("consolidated-trades.json deve ser um array.");
  }

  return data;
}

function isResolvedTrade(trade) {
  return trade && (trade.outcome === "TP" || trade.outcome === "SL");
}

function toNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function summarize(trades) {
  const resolved = trades.filter(isResolvedTrade);

  const tp = resolved.filter((t) => t.outcome === "TP").length;
  const sl = resolved.filter((t) => t.outcome === "SL").length;

  const rrValues = resolved
    .map((t) => toNumber(t.rrRealized))
    .filter((v) => v != null);

  const pnlValues = resolved
    .map((t) => toNumber(t.pnlPct))
    .filter((v) => v != null);

  const slippageValues = resolved
    .map((t) => toNumber(t.slippagePct))
    .filter((v) => v != null);

  const latencyValues = resolved
    .map((t) => toNumber(t.latencyTotal))
    .filter((v) => v != null);

  const winrate = resolved.length ? (tp / resolved.length) * 100 : 0;
  const avgR = rrValues.length
    ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length
    : 0;
  const avgPnlPct = pnlValues.length
    ? pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length
    : 0;
  const avgSlippagePct = slippageValues.length
    ? slippageValues.reduce((a, b) => a + b, 0) / slippageValues.length
    : 0;
  const avgLatency = latencyValues.length
    ? latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length
    : 0;

  return {
    trades: trades.length,
    resolved: resolved.length,
    tp,
    sl,
    winrate,
    avgR,
    avgPnlPct,
    avgSlippagePct,
    avgLatency,
  };
}

function printSummary(title, stats) {
  console.log(`\n=== ${title} ===`);
  console.log(`Trades:            ${stats.trades}`);
  console.log(`Resolved:          ${stats.resolved}`);
  console.log(`TP:                ${stats.tp}`);
  console.log(`SL:                ${stats.sl}`);
  console.log(`Winrate:           ${stats.winrate.toFixed(2)}%`);
  console.log(`Avg R:             ${stats.avgR.toFixed(4)}`);
  console.log(`Avg pnlPct:        ${stats.avgPnlPct.toFixed(4)}`);
  console.log(`Avg slippagePct:   ${(stats.avgSlippagePct * 100).toFixed(5)}%`);
  console.log(`Avg latencyTotal:  ${stats.avgLatency.toFixed(2)} ms`);
}

function groupBy(trades, keyFn) {
  const map = new Map();

  for (const trade of trades) {
    const key = keyFn(trade);
    if (key == null) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(trade);
  }

  return map;
}

function printGroupedReport(title, groupedMap, minTrades = 1) {
  console.log(`\n############################`);
  console.log(`# ${title}`);
  console.log(`############################`);

  const rows = [];

  for (const [key, trades] of groupedMap.entries()) {
    const stats = summarize(trades);
    if (stats.resolved < minTrades) continue;

    rows.push({
      key,
      ...stats,
    });
  }

  rows.sort((a, b) => {
    if (b.avgR !== a.avgR) return b.avgR - a.avgR;
    if (b.winrate !== a.winrate) return b.winrate - a.winrate;
    return b.resolved - a.resolved;
  });

  for (const row of rows) {
    console.log(
      `${String(row.key).padEnd(18)} | trades=${String(row.trades).padStart(3)} | resolved=${String(row.resolved).padStart(3)} | winrate=${row.winrate.toFixed(2).padStart(6)}% | avgR=${row.avgR.toFixed(4).padStart(8)} | avgPnl=${row.avgPnlPct.toFixed(4).padStart(8)}`
    );
  }

  if (!rows.length) {
    console.log("Sem grupos com amostra mínima.");
  }
}

function bucketNumber(value, buckets) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  for (let i = 0; i < buckets.length - 1; i++) {
    const min = buckets[i];
    const max = buckets[i + 1];
    if (value >= min && value < max) {
      return `${min}-${max}`;
    }
  }

  return `${buckets[buckets.length - 1]}+`;
}

function main() {
  const trades = loadTrades();
  const resolvedTrades = trades.filter(isResolvedTrade);

  printSummary("GLOBAL", summarize(resolvedTrades));

  // 1) por símbolo
  printGroupedReport(
    "POR SÍMBOLO",
    groupBy(resolvedTrades, (t) => t.symbol),
    3
  );

  // 2) por threshold de score
  const scoreThresholds = [55, 60, 65, 70, 75];

  const scoreMap = new Map();
  for (const threshold of scoreThresholds) {
    scoreMap.set(
      `score>=${threshold}`,
      resolvedTrades.filter((t) => typeof t.score === "number" && t.score >= threshold)
    );
  }

  printGroupedReport("POR SCORE", scoreMap, 3);

  // 3) flags booleanas
  const booleanFields = [
    "isTrend",
    "isRange",
    "nearPullback",
    "stackedEma",
    "nearEma20",
    "rsiRising",
    "rsiInBand",
    "bullish",
    "bullishFast",
  ];

  for (const field of booleanFields) {
    const map = new Map();
    map.set(`${field}=true`, resolvedTrades.filter((t) => t[field] === true));
    map.set(`${field}=false`, resolvedTrades.filter((t) => t[field] === false));
    printGroupedReport(`FLAG ${field}`, map, 3);
  }

  // 4) RSI buckets
  const rsiBuckets = [0, 35, 40, 45, 50, 55, 60, 100];
  printGroupedReport(
    "POR RSI BUCKET",
    groupBy(resolvedTrades, (t) => bucketNumber(t.rsi, rsiBuckets)),
    3
  );

  // 5) ADX buckets
  const adxBuckets = [0, 10, 15, 20, 25, 30, 40, 100];
  printGroupedReport(
    "POR ADX BUCKET",
    groupBy(resolvedTrades, (t) => bucketNumber(t.adx, adxBuckets)),
    3
  );
}

main();