const fs = require("fs");
const path = require("path");

const RESEARCH_DIR = __dirname;
const DEFAULT_GLOB_PREFIX = "monte-carlo-";
const OUTPUT_JSON = path.join(RESEARCH_DIR, "promotion-gate-report.json");

function listDefaultMonteCarloFiles() {
  return fs
    .readdirSync(RESEARCH_DIR)
    .filter((file) => file.startsWith(DEFAULT_GLOB_PREFIX) && file.endsWith(".json"))
    .map((file) => path.join(RESEARCH_DIR, file))
    .sort();
}

function parseFileList(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return [];

  return [...new Set(
    rawValue
      .split(",")
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => (path.isAbsolute(value) ? value : path.join(process.cwd(), value)))
  )];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildCandidateRows(reportPath, data = {}) {
  const ranked = Array.isArray(data.ranked) ? data.ranked : [];

  return ranked.map((row) => ({
    source: reportPath,
    tf: data.tf || null,
    htfTf: data.htfTf || null,
    symbols: Array.isArray(data.symbols) ? data.symbols : [],
    strategy: row.strategy,
    direction: row.direction,
    trades: Number(row?.monteCarlo?.original?.trades || 0),
    avgNetPnlPct: Number(row?.monteCarlo?.original?.avgNetPnlPct || 0),
    profitFactorNet: Number(row?.monteCarlo?.original?.profitFactorNet || 0),
    maxDrawdownPct: Number(row?.monteCarlo?.original?.maxDrawdownPct || 0),
    lowerBoundAvgNetPnlPct: Number(row?.monteCarlo?.lowerBoundGate?.lowerBoundAvgNetPnlPct || 0),
    lowerBoundProfitFactorNet: Number(
      row?.monteCarlo?.lowerBoundGate?.lowerBoundProfitFactorNet || 0
    ),
    stressedMaxDrawdownPct: Number(row?.monteCarlo?.lowerBoundGate?.stressedMaxDrawdownPct || 0),
    recommendation: row?.monteCarlo?.recommendation || "unknown",
    promotionStatus: row?.monteCarlo?.promotionDecision?.status || "unknown",
    promotionReason: row?.monteCarlo?.promotionDecision?.reason || "unknown",
  }));
}

function summarizeCandidates(rows = []) {
  const summary = {
    core: [],
    exploratory: [],
    reject: [],
  };

  for (const row of rows) {
    const key = summary[row.promotionStatus] ? row.promotionStatus : "reject";
    summary[key].push(row);
  }

  for (const key of Object.keys(summary)) {
    summary[key].sort((a, b) => {
      if (b.avgNetPnlPct !== a.avgNetPnlPct) return b.avgNetPnlPct - a.avgNetPnlPct;
      if (b.profitFactorNet !== a.profitFactorNet) return b.profitFactorNet - a.profitFactorNet;
      return b.trades - a.trades;
    });
  }

  return summary;
}

function main() {
  const explicitFiles = parseFileList(process.env.PROMOTION_MONTE_FILES);
  const files = explicitFiles.length ? explicitFiles : listDefaultMonteCarloFiles();
  const rows = files.flatMap((filePath) => buildCandidateRows(filePath, readJson(filePath)));
  const summary = summarizeCandidates(rows);
  const output = {
    generatedAt: new Date().toISOString(),
    files,
    counts: {
      total: rows.length,
      core: summary.core.length,
      exploratory: summary.exploratory.length,
      reject: summary.reject.length,
    },
    rows,
    summary,
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), "utf8");

  console.log(`Saved promotion report: ${OUTPUT_JSON}`);
  for (const key of ["core", "exploratory", "reject"]) {
    console.log(`\n[${key.toUpperCase()}] ${summary[key].length}`);
    summary[key].slice(0, 10).forEach((row) => {
      console.log(
        `${row.strategy} ${row.symbols.join("+")} ${row.tf}/${row.htfTf} ` +
          `trades=${row.trades} avgNet=${row.avgNetPnlPct.toFixed(4)}% ` +
          `pf=${row.profitFactorNet.toFixed(3)} lowerAvg=${row.lowerBoundAvgNetPnlPct.toFixed(4)}% ` +
          `lowerPf=${row.lowerBoundProfitFactorNet.toFixed(3)} => ${row.promotionStatus}`
      );
    });
  }

  return output;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  listDefaultMonteCarloFiles,
  parseFileList,
  buildCandidateRows,
  summarizeCandidates,
};
