require("dotenv").config();

const fs = require("fs");
const path = require("path");

const THIRTY_MIN_FILE = path.join(__dirname, "tradfi-twelve-equities-30m-reversal.json");
const ONE_HOUR_FILE = path.join(__dirname, "tradfi-twelve-equities-1h-reversal.json");
const PRESET_FILE = path.join(__dirname, "tradfi-twelve-equities-preset.json");
const RECOMMENDATIONS_FILE = path.join(
  __dirname,
  "tradfi-twelve-equities-recommendations.json"
);

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function round(value, decimals = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(decimals));
}

function findStrategyResult(backtest, strategyName) {
  return (backtest?.ranked || []).find((row) => row.strategy === strategyName) || null;
}

function pickSymbolSummary(backtest, strategyName, symbol) {
  const strategy = findStrategyResult(backtest, strategyName);
  return strategy?.bySymbol?.[symbol]?.summary || null;
}

function buildStrategyEntry({ backtest, strategyName, strategyKey, symbol, label, enabled = true }) {
  const summary = pickSymbolSummary(backtest, strategyName, symbol);
  if (!summary || Number(summary.trades || 0) <= 0) return null;

  return {
    label,
    strategyKey,
    sourceStrategy: strategyName,
    enabled,
    tf: backtest.tf,
    htfTf: backtest.htfTf,
    trades: Number(summary.trades || 0),
    avgPnlPct: round(summary.avgPnlPct),
    profitFactor: round(summary.profitFactor),
    winrate: round(summary.winrate, 4),
    maxDrawdownPct: round(summary.maxDrawdownPct),
  };
}

function uniqueProfiles(entries) {
  const seen = new Set();
  const profiles = [];

  for (const entry of entries) {
    const key = `${entry.tf}|${entry.htfTf}`;
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push({ tf: entry.tf, htfTf: entry.htfTf });
  }

  return profiles;
}

function buildPresetSymbol(enabledEntries) {
  const profiles = uniqueProfiles(enabledEntries);
  const singleProfile = profiles.length === 1;

  return {
    tf: singleProfile ? profiles[0].tf : null,
    htfTf: singleProfile ? profiles[0].htfTf : null,
    profileMode: singleProfile ? "single" : "per-strategy",
    profiles,
    defaultTf: singleProfile ? null : enabledEntries[0]?.tf || null,
    defaultHtfTf: singleProfile ? null : enabledEntries[0]?.htfTf || null,
    strategies: Object.fromEntries(
      enabledEntries.map((entry) => [
        entry.strategyKey,
        {
          enabled: true,
          sourceStrategy: entry.sourceStrategy,
          tf: entry.tf,
          htfTf: entry.htfTf,
          trades: entry.trades,
          avgPnlPct: entry.avgPnlPct,
          profitFactor: entry.profitFactor,
          winrate: entry.winrate,
          maxDrawdownPct: entry.maxDrawdownPct,
        },
      ])
    ),
  };
}

function buildArtifacts({ thirtyMinuteBacktest, oneHourBacktest }) {
  const enabledBySymbol = {
    AAPLUSDT: [
      buildStrategyEntry({
        backtest: oneHourBacktest,
        strategyName: "oversoldBounce",
        strategyKey: "OVERSOLD_BOUNCE",
        symbol: "AAPLUSDT",
        label: "primary",
      }),
    ].filter(Boolean),
    QQQUSDT: [
      buildStrategyEntry({
        backtest: oneHourBacktest,
        strategyName: "oversoldBounce",
        strategyKey: "OVERSOLD_BOUNCE",
        symbol: "QQQUSDT",
        label: "primary",
      }),
      buildStrategyEntry({
        backtest: thirtyMinuteBacktest,
        strategyName: "breakdownRetestShort",
        strategyKey: "BREAKDOWN_RETEST_SHORT",
        symbol: "QQQUSDT",
        label: "secondary",
      }),
    ].filter(Boolean),
    SPYUSDT: [
      buildStrategyEntry({
        backtest: oneHourBacktest,
        strategyName: "oversoldBounce",
        strategyKey: "OVERSOLD_BOUNCE",
        symbol: "SPYUSDT",
        label: "primary",
      }),
    ].filter(Boolean),
  };

  const observeBySymbol = {
    AAPLUSDT: [
      buildStrategyEntry({
        backtest: oneHourBacktest,
        strategyName: "failedBreakdown",
        strategyKey: "FAILED_BREAKDOWN",
        symbol: "AAPLUSDT",
        label: "observe",
        enabled: false,
      }),
    ].filter(Boolean),
    QQQUSDT: [],
    SPYUSDT: [],
  };

  const preset = {
    generatedAt: new Date().toISOString(),
    source: "Twelve Data equities research preset",
    sourceRuns: [
      path.basename(THIRTY_MIN_FILE),
      path.basename(ONE_HOUR_FILE),
    ],
    symbols: Object.fromEntries(
      Object.entries(enabledBySymbol).map(([symbol, entries]) => [symbol, buildPresetSymbol(entries)])
    ),
  };

  const recommendations = {
    generatedAt: preset.generatedAt,
    source: preset.source,
    sourceRuns: preset.sourceRuns,
    symbols: Object.fromEntries(
      Object.keys(enabledBySymbol).map((symbol) => [
        symbol,
        {
          enabled: enabledBySymbol[symbol],
          observe: observeBySymbol[symbol],
        },
      ])
    ),
  };

  return { preset, recommendations };
}

function writeArtifacts({ preset, recommendations }) {
  fs.writeFileSync(PRESET_FILE, JSON.stringify(preset, null, 2), "utf8");
  fs.writeFileSync(RECOMMENDATIONS_FILE, JSON.stringify(recommendations, null, 2), "utf8");
}

function main() {
  const thirtyMinuteBacktest = loadJson(THIRTY_MIN_FILE);
  const oneHourBacktest = loadJson(ONE_HOUR_FILE);
  const artifacts = buildArtifacts({ thirtyMinuteBacktest, oneHourBacktest });
  writeArtifacts(artifacts);

  console.log(`Saved: ${PRESET_FILE}`);
  console.log(`Saved: ${RECOMMENDATIONS_FILE}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  round,
  findStrategyResult,
  pickSymbolSummary,
  buildStrategyEntry,
  uniqueProfiles,
  buildPresetSymbol,
  buildArtifacts,
};
