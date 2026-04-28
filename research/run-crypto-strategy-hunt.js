require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.join(__dirname, "..");
const BACKTEST_SCRIPT = path.join(__dirname, "backtest-candidate-strategies.js");
const DEFAULT_OUTPUT_DIR = path.join(
  __dirname,
  "cache",
  "server-strategy-hunts"
);
const DEFAULT_SYMBOLS = [
  "SOLUSDC",
  "BNBUSDC",
  "DOGEUSDC",
  "1000PEPEUSDC",
  "XRPUSDC",
];
const DEFAULT_TFS = ["15m", "1h"];
const DEFAULT_HTF_TF = "1d";
const DEFAULT_FEE_RATE = "0.0004";
const DEFAULT_SLIPPAGE_PCT = "0.00025";

function parseList(rawValue, fallback = []) {
  if (!rawValue || typeof rawValue !== "string") return [...fallback];
  const items = rawValue
    .split(",")
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : [...fallback];
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function classifyCandidate(summary = {}) {
  const trades = Number(summary.trades || 0);
  const avgNetPnlPct = Number(summary.avgNetPnlPct ?? summary.avgPnlPct ?? 0);
  const profitFactorNet = Number(
    summary.profitFactorNet ?? summary.profitFactor ?? 0
  );
  const maxDrawdownPct = Number(summary.maxDrawdownPct || 0);

  if (
    trades >= 18 &&
    avgNetPnlPct > 0 &&
    profitFactorNet >= 1.2 &&
    maxDrawdownPct <= 8
  ) {
    return {
      status: "live",
      reason: "meets_live_gate",
    };
  }

  if (
    trades >= 8 &&
    avgNetPnlPct > 0 &&
    profitFactorNet >= 1.05 &&
    maxDrawdownPct <= 15
  ) {
    return {
      status: "observe",
      reason: "positive_but_not_live_grade",
    };
  }

  if (
    trades >= 3 &&
    avgNetPnlPct > 0 &&
    profitFactorNet >= 1
  ) {
    return {
      status: "observe",
      reason: "positive_but_sample_short",
    };
  }

  return {
    status: "archive",
    reason: trades < 3 ? "sample_too_short" : "fails_profitability_gate",
  };
}

function flattenRankedOutput(output, tf, htfTf) {
  const candidates = [];

  for (const rankedRow of output?.ranked || []) {
    const strategy = rankedRow?.strategy || null;
    const direction = rankedRow?.direction || null;
    const bySymbol = rankedRow?.bySymbol || {};

    for (const [symbol, payload] of Object.entries(bySymbol)) {
      const summary = payload?.summary || {};
      const classification = classifyCandidate(summary);

      candidates.push({
        symbol,
        tf,
        htfTf,
        strategy,
        direction,
        summary,
        sampleTrades: payload?.sampleTrades || [],
        classification,
      });
    }
  }

  return candidates;
}

function buildSummary(candidates) {
  const counts = {
    live: 0,
    observe: 0,
    archive: 0,
  };

  for (const candidate of candidates) {
    const status = candidate?.classification?.status || "archive";
    counts[status] = (counts[status] || 0) + 1;
  }

  const statusRank = { live: 0, observe: 1, archive: 2 };
  const rankedCandidates = [...candidates].sort((a, b) => {
    const statusDelta =
      (statusRank[a.classification.status] ?? 99) -
      (statusRank[b.classification.status] ?? 99);
    if (statusDelta !== 0) return statusDelta;

    const aAvg = Number(a.summary.avgNetPnlPct ?? a.summary.avgPnlPct ?? -Infinity);
    const bAvg = Number(b.summary.avgNetPnlPct ?? b.summary.avgPnlPct ?? -Infinity);
    if (bAvg !== aAvg) return bAvg - aAvg;

    const aPf = Number(a.summary.profitFactorNet ?? a.summary.profitFactor ?? -Infinity);
    const bPf = Number(b.summary.profitFactorNet ?? b.summary.profitFactor ?? -Infinity);
    if (bPf !== aPf) return bPf - aPf;

    return Number(b.summary.trades || 0) - Number(a.summary.trades || 0);
  });

  return {
    counts,
    topCandidates: rankedCandidates.slice(0, 12),
  };
}

function runBacktestBatch({
  symbols,
  tf,
  htfTf,
  outputDir,
  strategies,
}) {
  ensureDir(outputDir);
  const outputFile = path.join(
    outputDir,
    `hunt-${String(tf).replace(/[^a-z0-9_-]+/gi, "_")}.json`
  );

  const env = {
    ...process.env,
    TF: tf,
    HTF_TF: htfTf,
    BACKTEST_SYMBOLS: symbols.join(","),
    BACKTEST_OUTPUT_FILE: outputFile,
    BACKTEST_INCLUDE_TRADES: process.env.BACKTEST_INCLUDE_TRADES || "0",
    BACKTEST_FEE_RATE: process.env.BACKTEST_FEE_RATE || DEFAULT_FEE_RATE,
    BACKTEST_SLIPPAGE_PCT:
      process.env.BACKTEST_SLIPPAGE_PCT || DEFAULT_SLIPPAGE_PCT,
  };

  if (strategies.length) {
    env.BACKTEST_STRATEGIES = strategies.join(",");
  } else {
    delete env.BACKTEST_STRATEGIES;
  }

  execFileSync("node", [BACKTEST_SCRIPT], {
    cwd: ROOT_DIR,
    env,
    stdio: "pipe",
  });

  return JSON.parse(fs.readFileSync(outputFile, "utf8"));
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push("# Crypto Strategy Hunt");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push(`Symbols: ${report.symbols.join(", ")}`);
  lines.push(`TFs: ${report.timeframes.join(", ")}`);
  lines.push("");
  lines.push("## Counts");
  lines.push("");
  lines.push(`- live: ${report.summary.counts.live}`);
  lines.push(`- observe: ${report.summary.counts.observe}`);
  lines.push(`- archive: ${report.summary.counts.archive}`);
  lines.push("");
  lines.push("## Top Candidates");
  lines.push("");

  for (const candidate of report.summary.topCandidates || []) {
    const summary = candidate.summary || {};
    lines.push(
      `- ${candidate.symbol} ${candidate.tf} ${candidate.strategy}: ${candidate.classification.status} ` +
        `(trades=${summary.trades || 0}, avgNet=${Number(
          summary.avgNetPnlPct ?? summary.avgPnlPct ?? 0
        ).toFixed(4)}%, pf=${Number(
          summary.profitFactorNet ?? summary.profitFactor ?? 0
        ).toFixed(3)}, maxDD=${Number(summary.maxDrawdownPct || 0).toFixed(4)}%, reason=${candidate.classification.reason})`
    );
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const symbols = parseList(
    process.env.STRATEGY_HUNT_SYMBOLS,
    DEFAULT_SYMBOLS
  ).map((symbol) => String(symbol).trim().toUpperCase());
  const timeframes = parseList(
    process.env.STRATEGY_HUNT_TFS,
    DEFAULT_TFS
  );
  const strategies = parseList(process.env.STRATEGY_HUNT_STRATEGIES, []);
  const htfTf = String(process.env.STRATEGY_HUNT_HTF_TF || DEFAULT_HTF_TF)
    .trim();
  const outputDir = path.resolve(
    process.cwd(),
    process.env.STRATEGY_HUNT_OUTPUT_DIR || DEFAULT_OUTPUT_DIR
  );

  const batchOutputs = [];
  let allCandidates = [];

  for (const tf of timeframes) {
    const output = runBacktestBatch({
      symbols,
      tf,
      htfTf,
      outputDir,
      strategies,
    });

    batchOutputs.push({
      tf,
      outputFile: path.join(
        outputDir,
        `hunt-${String(tf).replace(/[^a-z0-9_-]+/gi, "_")}.json`
      ),
      rankedCount: Array.isArray(output?.ranked) ? output.ranked.length : 0,
    });
    allCandidates = allCandidates.concat(flattenRankedOutput(output, tf, htfTf));
  }

  const summary = buildSummary(allCandidates);
  const report = {
    generatedAt: new Date().toISOString(),
    symbols,
    timeframes,
    htfTf,
    strategies: strategies.length ? strategies : "all_existing",
    executionCosts: {
      feeRate: Number(process.env.BACKTEST_FEE_RATE || DEFAULT_FEE_RATE),
      slippagePct: Number(
        process.env.BACKTEST_SLIPPAGE_PCT || DEFAULT_SLIPPAGE_PCT
      ),
    },
    batchOutputs,
    candidates: allCandidates,
    summary,
  };

  ensureDir(outputDir);
  const summaryJson = path.join(outputDir, "crypto-strategy-hunt-summary.json");
  const summaryMd = path.join(outputDir, "crypto-strategy-hunt-summary.md");
  fs.writeFileSync(summaryJson, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(summaryMd, renderMarkdownReport(report), "utf8");

  console.log(`Saved: ${summaryJson}`);
  console.log(`Saved: ${summaryMd}`);
  for (const candidate of summary.topCandidates) {
    const metrics = candidate.summary || {};
    console.log(
      `${candidate.symbol} ${candidate.tf} ${candidate.strategy} -> ${candidate.classification.status} ` +
        `trades=${metrics.trades || 0} avgNet=${Number(
          metrics.avgNetPnlPct ?? metrics.avgPnlPct ?? 0
        ).toFixed(4)}% pf=${Number(
          metrics.profitFactorNet ?? metrics.profitFactor ?? 0
        ).toFixed(3)} maxDD=${Number(metrics.maxDrawdownPct || 0).toFixed(4)}`
    );
  }

  return report;
}

if (require.main === module) {
  main();
}

module.exports = {
  parseList,
  classifyCandidate,
  flattenRankedOutput,
  buildSummary,
};
