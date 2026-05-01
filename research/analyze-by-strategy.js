const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.join(__dirname, "consolidated-trades.json");
const OUTPUT_FILE = path.join(__dirname, "strategy-analysis.json");

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Ficheiro não encontrado: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeNum(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function avg(arr) {
  const nums = (arr || []).filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function sum(arr) {
  const nums = (arr || []).filter((v) => typeof v === "number" && Number.isFinite(v));
  return nums.reduce((a, b) => a + b, 0);
}

function median(arr) {
  const nums = (arr || [])
    .filter((v) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);

  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0
    ? (nums[mid - 1] + nums[mid]) / 2
    : nums[mid];
}

function percentile(arr, p) {
  const nums = (arr || [])
    .filter((v) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);

  if (!nums.length) return 0;
  const idx = Math.max(0, Math.min(nums.length - 1, Math.floor(nums.length * p)));
  return nums[idx];
}

function normalizeOutcome(v) {
  const s = String(v || "").toUpperCase();
  if (s.includes("TP")) return "TP";
  if (s.includes("SL")) return "SL";
  return s || "UNKNOWN";
}

function isResolvedTrade(t) {
  const outcome = normalizeOutcome(t.outcome);
  return outcome === "TP" || outcome === "SL";
}

function getBucket(value, buckets) {
  if (!Number.isFinite(value)) return "unknown";
  for (let i = 0; i < buckets.length - 1; i++) {
    const min = buckets[i];
    const max = buckets[i + 1];
    if (value >= min && value < max) return `${min}-${max}`;
  }
  return `${buckets[buckets.length - 1]}+`;
}

function summarizeTrades(trades) {
  const resolved = trades.filter(isResolvedTrade);

  const tp = resolved.filter((t) => normalizeOutcome(t.outcome) === "TP").length;
  const sl = resolved.filter((t) => normalizeOutcome(t.outcome) === "SL").length;

  const rr = resolved.map((t) => safeNum(t.rrRealized)).filter((v) => v != null);
  const pnl = resolved.map((t) => safeNum(t.pnlPct)).filter((v) => v != null);
  const adx = resolved.map((t) => safeNum(t.adx)).filter((v) => v != null);
  const rsi = resolved.map((t) => safeNum(t.rsi)).filter((v) => v != null);
  const atrPct = resolved.map((t) => safeNum(t.atrPct)).filter((v) => v != null);
  const bars = resolved.map((t) => safeNum(t.barsOpen)).filter((v) => v != null);

  return {
    trades: trades.length,
    resolved: resolved.length,
    tp,
    sl,
    winrate: resolved.length ? (tp / resolved.length) * 100 : 0,
    avgR: avg(rr),
    medianR: median(rr),
    avgPnlPct: avg(pnl),
    totalPnlPct: sum(pnl),
    avgAdx: avg(adx),
    avgRsi: avg(rsi),
    avgAtrPct: avg(atrPct),
    avgBarsOpen: avg(bars),
    p25R: percentile(rr, 0.25),
    p75R: percentile(rr, 0.75),
  };
}

function groupBy(rows, keyFn) {
  const out = {};
  for (const row of rows) {
    const key = keyFn(row);
    if (!out[key]) out[key] = [];
    out[key].push(row);
  }
  return out;
}

function summarizeGrouped(groups) {
  const result = {};
  for (const [key, rows] of Object.entries(groups)) {
    result[key] = summarizeTrades(rows);
  }
  return result;
}

function main() {
  const rows = loadJson(INPUT_FILE);

  if (!Array.isArray(rows)) {
    throw new Error("consolidated-trades.json deve ser um array.");
  }

  const resolved = rows.filter(isResolvedTrade);
  const withStrategy = resolved.filter((t) => t.strategy === "range" || t.strategy === "trend");

  const byStrategy = summarizeGrouped(
    groupBy(withStrategy, (t) => t.strategy || "unknown")
  );

  const bySymbolStrategy = summarizeGrouped(
    groupBy(withStrategy, (t) => `${t.symbol || "UNKNOWN"}__${t.strategy || "unknown"}`)
  );

  const bySymbol = summarizeGrouped(
    groupBy(withStrategy, (t) => t.symbol || "UNKNOWN")
  );

  const byTfStrategy = summarizeGrouped(
    groupBy(withStrategy, (t) => `${t.tf || "?"}__${t.strategy || "unknown"}`)
  );

  const byRegimeStrategy = summarizeGrouped(
    groupBy(withStrategy, (t) => {
      const regime = t.isTrend === true ? "TREND" : t.isRange === true ? "RANGE" : "NEUTRAL";
      return `${regime}__${t.strategy || "unknown"}`;
    })
  );

  const byRsiBucketStrategy = summarizeGrouped(
    groupBy(withStrategy, (t) => {
      const bucket = getBucket(Number(t.rsi), [0, 35, 40, 45, 50, 55, 60, 70, 100]);
      return `${bucket}__${t.strategy || "unknown"}`;
    })
  );

  const byAdxBucketStrategy = summarizeGrouped(
    groupBy(withStrategy, (t) => {
      const bucket = getBucket(Number(t.adx), [0, 10, 15, 20, 25, 30, 40, 100]);
      return `${bucket}__${t.strategy || "unknown"}`;
    })
  );

  const byAtrPctBucketStrategy = summarizeGrouped(
    groupBy(withStrategy, (t) => {
      const atrPct = Number(t.atrPct) * 100;
      const bucket = getBucket(atrPct, [0, 0.05, 0.10, 0.15, 0.20, 0.30, 1]);
      return `${bucket}__${t.strategy || "unknown"}`;
    })
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    inputFile: INPUT_FILE,
    totalRows: rows.length,
    resolvedRows: resolved.length,
    resolvedWithStrategy: withStrategy.length,
    byStrategy,
    bySymbol,
    bySymbolStrategy,
    byTfStrategy,
    byRegimeStrategy,
    byRsiBucketStrategy,
    byAdxBucketStrategy,
    byAtrPctBucketStrategy,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log("===== STRATEGY ANALYSIS =====");
  console.log(`Input rows: ${rows.length}`);
  console.log(`Resolved rows: ${resolved.length}`);
  console.log(`Resolved with strategy: ${withStrategy.length}`);
  console.log("");

  for (const strategy of ["range", "trend"]) {
    const s = byStrategy[strategy];
    if (!s) continue;

    console.log(`--- ${strategy.toUpperCase()} ---`);
    console.log(`Trades: ${s.trades}`);
    console.log(`Resolved: ${s.resolved}`);
    console.log(`TP: ${s.tp}`);
    console.log(`SL: ${s.sl}`);
    console.log(`Winrate: ${s.winrate.toFixed(2)}%`);
    console.log(`Avg R: ${s.avgR.toFixed(4)}`);
    console.log(`Median R: ${s.medianR.toFixed(4)}`);
    console.log(`Avg PnL %: ${s.avgPnlPct.toFixed(4)}`);
    console.log(`Total PnL %: ${s.totalPnlPct.toFixed(4)}`);
    console.log(`Avg ADX: ${s.avgAdx.toFixed(2)}`);
    console.log(`Avg RSI: ${s.avgRsi.toFixed(2)}`);
    console.log(`Avg ATR %: ${s.avgAtrPct.toFixed(6)}`);
    console.log(`Avg Bars Open: ${s.avgBarsOpen.toFixed(2)}`);
    console.log("");
  }

  console.log(`Saved analysis: ${OUTPUT_FILE}`);
}

main();