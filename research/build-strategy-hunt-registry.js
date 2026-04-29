require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const BASE_DIR = path.join(__dirname, "cache", "server-strategy-hunts");
const OUTPUT_JSON = path.join(BASE_DIR, "candidate-registry.json");
const OUTPUT_MD = path.join(BASE_DIR, "candidate-registry.md");
const DEFAULT_PROFILE_DIRS = ["narrow", "broad"];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseList(rawValue, fallback = []) {
  if (!rawValue || typeof rawValue !== "string") return [...fallback];
  const items = rawValue
    .split(",")
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : [...fallback];
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function scoreCandidate(candidate = {}) {
  const summary = candidate.summary || {};
  const status = candidate.classification?.status || "archive";
  const statusRank = { live: 3, observe: 2, archive: 1 };
  return (
    (statusRank[status] || 0) * 1_000_000 +
    toNumber(summary.avgNetPnlPct ?? summary.avgPnlPct, -999) * 10_000 +
    toNumber(summary.profitFactorNet ?? summary.profitFactor, 0) * 1_000 +
    toNumber(summary.trades, 0)
  );
}

function loadSummaryFile(filePath, profileName) {
  if (!fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    profile: String(raw.profile || profileName || "unknown"),
    generatedAt: raw.generatedAt || null,
    symbols: raw.symbols || [],
    timeframes: raw.timeframes || [],
    candidates: Array.isArray(raw.candidates) ? raw.candidates : [],
    summary: raw.summary || {},
    source: filePath,
  };
}

function loadReports() {
  const explicitDirs = parseList(process.env.STRATEGY_HUNT_REGISTRY_PROFILE_DIRS, []);
  const profileDirs = explicitDirs.length ? explicitDirs : DEFAULT_PROFILE_DIRS;
  const baseOutputDir = path.resolve(
    ROOT_DIR,
    process.env.STRATEGY_HUNT_REGISTRY_BASE_DIR || BASE_DIR
  );
  const reports = [];

  for (const dirName of profileDirs) {
    const dirPath = path.join(baseOutputDir, dirName);
    const filePath = path.join(dirPath, "crypto-strategy-hunt-summary.json");
    const report = loadSummaryFile(filePath, dirName);
    if (report) reports.push(report);
  }

  if (reports.length === 0) {
    const legacySummary = loadSummaryFile(
      path.join(baseOutputDir, "crypto-strategy-hunt-summary.json"),
      "legacy"
    );
    if (legacySummary) reports.push(legacySummary);
  }

  return reports;
}

function buildRegistry(reports = []) {
  const byKey = new Map();

  for (const report of reports) {
    for (const candidate of report.candidates || []) {
      const key = [
        candidate.symbol || "UNKNOWN",
        candidate.tf || "UNKNOWN",
        candidate.strategy || "UNKNOWN",
      ].join("::");

      const enriched = {
        ...candidate,
        profile: report.profile,
        generatedAt: report.generatedAt,
        source: report.source,
      };

      const current = byKey.get(key);
      if (!current || scoreCandidate(enriched) > scoreCandidate(current)) {
        byKey.set(key, enriched);
      }
    }
  }

  const candidates = [...byKey.values()].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const counts = { live: 0, observe: 0, archive: 0 };
  for (const row of candidates) {
    const status = row.classification?.status || "archive";
    counts[status] = (counts[status] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    profiles: reports.map((report) => ({
      profile: report.profile,
      generatedAt: report.generatedAt,
      source: report.source,
      candidateCount: Array.isArray(report.candidates) ? report.candidates.length : 0,
    })),
    counts,
    topCandidates: candidates.slice(0, 20),
    candidates,
  };
}

function renderMarkdown(registry = {}) {
  const lines = [];
  lines.push("# Strategy Hunt Candidate Registry");
  lines.push("");
  lines.push(`Generated: ${registry.generatedAt}`);
  lines.push("");
  lines.push("## Counts");
  lines.push("");
  lines.push(`- live: ${registry.counts?.live || 0}`);
  lines.push(`- observe: ${registry.counts?.observe || 0}`);
  lines.push(`- archive: ${registry.counts?.archive || 0}`);
  lines.push("");
  lines.push("## Profiles");
  lines.push("");
  for (const profile of registry.profiles || []) {
    lines.push(
      `- ${profile.profile}: ${profile.candidateCount} candidates (${profile.generatedAt || "unknown time"})`
    );
  }
  lines.push("");
  lines.push("## Top Candidates");
  lines.push("");
  for (const candidate of registry.topCandidates || []) {
    const summary = candidate.summary || {};
    lines.push(
      `- ${candidate.symbol} ${candidate.tf} ${candidate.strategy} [${candidate.profile}] -> ${candidate.classification?.status || "archive"} ` +
        `(trades=${summary.trades || 0}, avgNet=${toNumber(
          summary.avgNetPnlPct ?? summary.avgPnlPct
        ).toFixed(4)}%, pf=${toNumber(
          summary.profitFactorNet ?? summary.profitFactor
        ).toFixed(3)}, maxDD=${toNumber(summary.maxDrawdownPct).toFixed(4)}%)`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  ensureDir(BASE_DIR);
  const reports = loadReports();
  const registry = buildRegistry(reports);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(registry, null, 2), "utf8");
  fs.writeFileSync(OUTPUT_MD, renderMarkdown(registry), "utf8");
  console.log(`Saved: ${OUTPUT_JSON}`);
  console.log(`Saved: ${OUTPUT_MD}`);
  return registry;
}

if (require.main === module) {
  main();
}

module.exports = {
  parseList,
  buildRegistry,
  renderMarkdown,
};
