#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_STATE_FILE = path.join(ROOT, "runtime", "state.json");
const OUTPUT_DIR = path.join(__dirname);
const DEFAULT_TIMEZONE = "Europe/Lisbon";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function round(value, decimals = 6) {
  const num = Number(value);
  return Number.isFinite(num) ? Number(num.toFixed(decimals)) : null;
}

function avg(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function fmtPct(value, digits = 3) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "n/a";
  return `${num >= 0 ? "+" : ""}${num.toFixed(digits)}%`;
}

function dayKey(ts, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(ts));
}

function dateTime(ts, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date(ts));
}

function isRealExecution(trade) {
  return String(trade?.executionOrderId || "").startsWith("futures_real_");
}

function laneKey(trade) {
  return `${trade.symbol}|${trade.tf}|${trade.strategy}`;
}

function favorableProgress(trade) {
  const entry = Number(trade.entryPrice ?? trade.entry);
  const tp = Number(trade.tp);
  if (!Number.isFinite(entry) || !Number.isFinite(tp) || entry === tp) return null;
  if (trade.direction === "LONG") {
    const maxHigh = Number(trade.maxHighDuringTrade);
    const span = tp - entry;
    if (!Number.isFinite(maxHigh) || !(span > 0)) return null;
    return (maxHigh - entry) / span;
  }
  const minLow = Number(trade.minLowDuringTrade);
  const span = entry - tp;
  if (!Number.isFinite(minLow) || !(span > 0)) return null;
  return (entry - minLow) / span;
}

function touchedTp(trade) {
  const entry = Number(trade.entryPrice ?? trade.entry);
  const tp = Number(trade.tp);
  if (!Number.isFinite(entry) || !Number.isFinite(tp)) return false;
  if (trade.direction === "LONG") {
    const maxHigh = Number(trade.maxHighDuringTrade);
    return Number.isFinite(maxHigh) && maxHigh >= tp;
  }
  const minLow = Number(trade.minLowDuringTrade);
  return Number.isFinite(minLow) && minLow <= tp;
}

function computeBreakEvenTriggerPrice(trade) {
  const entry = Number(trade.entryPrice ?? trade.entry);
  const sl = Number(trade.initialSl ?? trade.sl);
  const triggerR = Number(trade.managementBreakEvenTriggerR);
  if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(triggerR)) {
    return null;
  }
  const risk = Math.abs(sl - entry);
  if (!(risk > 0)) return null;
  if (trade.direction === "LONG") {
    return entry + risk * triggerR;
  }
  return entry - risk * triggerR;
}

function computeBreakEvenLockPrice(trade) {
  const entry = Number(trade.entryPrice ?? trade.entry);
  const sl = Number(trade.initialSl ?? trade.sl);
  const lockR = Number(trade.managementBreakEvenLockR);
  if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(lockR)) {
    return null;
  }
  const risk = Math.abs(sl - entry);
  if (!(risk > 0)) return null;
  if (trade.direction === "LONG") {
    return entry + risk * lockR;
  }
  return entry - risk * lockR;
}

function summarizeLaneTrades(trades) {
  const rows = trades.map((trade) => {
    const progress = favorableProgress(trade);
    return {
      symbol: trade.symbol,
      tf: trade.tf,
      strategy: trade.strategy,
      direction: trade.direction,
      outcome: trade.outcome,
      pnlPct: Number(trade.pnlPct || 0),
      progress,
      touchedTp: touchedTp(trade),
      breakEvenApplied: !!trade.breakEvenApplied,
      closedTs: trade.closedTs || trade.ts,
      entry: Number(trade.entryPrice ?? trade.entry),
      tp: Number(trade.tp),
      sl: Number(trade.sl),
      exitRef: Number(trade.exitRef),
      maxHighDuringTrade: Number(trade.maxHighDuringTrade),
      minLowDuringTrade: Number(trade.minLowDuringTrade),
      barsOpen: Number(trade.barsOpen),
    };
  });

  const nonTp = rows.filter((row) => row.outcome !== "TP");
  const near70 = nonTp.filter((row) => Number(row.progress) >= 0.7);
  const near80 = nonTp.filter((row) => Number(row.progress) >= 0.8);
  const near90 = nonTp.filter((row) => Number(row.progress) >= 0.9);
  const touchedButNonTp = nonTp.filter((row) => row.touchedTp);

  return {
    trades: rows.length,
    tpCount: rows.filter((row) => row.outcome === "TP").length,
    nonTpCount: nonTp.length,
    avgPnlPct: round(avg(rows.map((row) => row.pnlPct)), 6),
    avgNonTpPnlPct: round(avg(nonTp.map((row) => row.pnlPct)), 6),
    avgProgressNonTp: round(avg(nonTp.map((row) => row.progress)), 6),
    near70Count: near70.length,
    near80Count: near80.length,
    near90Count: near90.length,
    touchedTpButNonTpCount: touchedButNonTp.length,
    breakEvenAppliedCount: rows.filter((row) => row.breakEvenApplied).length,
    examples: {
      touchedTpButNonTp: touchedButNonTp
        .sort((a, b) => (b.progress || 0) - (a.progress || 0))
        .slice(0, 5),
      near90NonTp: near90
        .sort((a, b) => (b.progress || 0) - (a.progress || 0))
        .slice(0, 5),
    },
  };
}

function buildReport(state, timeZone, requestedLanes) {
  const closed = (state.closedSignals || []).filter(isRealExecution);
  const open = (state.openSignals || []).filter(isRealExecution);

  const availableLaneMap = new Map();
  for (const trade of closed) {
    const key = laneKey(trade);
    if (!availableLaneMap.has(key)) availableLaneMap.set(key, []);
    availableLaneMap.get(key).push(trade);
  }

  const laneKeys = requestedLanes?.length
    ? requestedLanes
    : [...availableLaneMap.keys()].sort();

  const lanes = laneKeys.map((key) => {
    const trades = availableLaneMap.get(key) || [];
    const summary = summarizeLaneTrades(trades);
    return {
      key,
      symbol: trades[0]?.symbol || key.split("|")[0],
      tf: trades[0]?.tf || key.split("|")[1],
      strategy: trades[0]?.strategy || key.split("|")[2],
      direction: trades[0]?.direction || null,
      summary,
    };
  });

  const openSummaries = open.map((trade) => ({
    key: laneKey(trade),
    symbol: trade.symbol,
    tf: trade.tf,
    strategy: trade.strategy,
    direction: trade.direction,
    entry: Number(trade.entryPrice ?? trade.entry),
    sl: Number(trade.initialSl ?? trade.sl),
    tp: Number(trade.tp),
    barsOpen: Number(trade.barsOpen),
    breakEvenApplied: !!trade.breakEvenApplied,
    managementBreakEvenTriggerR: Number(trade.managementBreakEvenTriggerR),
    managementBreakEvenLockR: Number(trade.managementBreakEvenLockR),
    breakEvenTriggerPrice: round(computeBreakEvenTriggerPrice(trade), 6),
    breakEvenLockPrice: round(computeBreakEvenLockPrice(trade), 6),
    minLowDuringTrade: Number(trade.minLowDuringTrade),
    maxHighDuringTrade: Number(trade.maxHighDuringTrade),
    signalTimeLisbon: dateTime(trade.signalCandleCloseTime || trade.ts, timeZone),
  }));

  return {
    generatedAt: new Date().toISOString(),
    stateCounts: {
      realClosed: closed.length,
      realOpen: open.length,
    },
    lanes,
    openSummaries,
  };
}

function toMarkdown(report, timeZone) {
  const lines = [];
  lines.push("# Live Management Audit");
  lines.push("");
  lines.push(`- Generated at: \`${dateTime(Date.now(), timeZone)}\` (${timeZone})`);
  lines.push(`- Real closed trades analysed: \`${report.stateCounts.realClosed}\``);
  lines.push(`- Real open trades analysed: \`${report.stateCounts.realOpen}\``);
  lines.push("");

  lines.push("## Lane Summary");
  lines.push("");
  for (const lane of report.lanes) {
    const s = lane.summary;
    lines.push(`### ${lane.key}`);
    lines.push("");
    lines.push(`- trades: \`${s.trades}\``);
    lines.push(`- TP: \`${s.tpCount}\``);
    lines.push(`- non-TP: \`${s.nonTpCount}\``);
    lines.push(`- avgPnlPct: \`${fmtPct(s.avgPnlPct)}\``);
    lines.push(`- avgNonTpPnlPct: \`${fmtPct(s.avgNonTpPnlPct)}\``);
    lines.push(`- avgProgressNonTp: \`${s.avgProgressNonTp == null ? "n/a" : s.avgProgressNonTp.toFixed(3)}x TP path\``);
    lines.push(`- near70 non-TP: \`${s.near70Count}\``);
    lines.push(`- near80 non-TP: \`${s.near80Count}\``);
    lines.push(`- near90 non-TP: \`${s.near90Count}\``);
    lines.push(`- touched TP but non-TP: \`${s.touchedTpButNonTpCount}\``);
    lines.push(`- breakEvenApplied count: \`${s.breakEvenAppliedCount}\``);
    if (s.examples.touchedTpButNonTp.length) {
      lines.push("");
      lines.push("- touched-TP-but-non-TP examples:");
      for (const row of s.examples.touchedTpButNonTp) {
        lines.push(
          `  - \`${dateTime(row.closedTs, timeZone)}\` outcome=\`${row.outcome}\` pnl=\`${fmtPct(row.pnlPct)}\` progress=\`${row.progress.toFixed(3)}\``
        );
      }
    }
    if (s.examples.near90NonTp.length) {
      lines.push("");
      lines.push("- near90 non-TP examples:");
      for (const row of s.examples.near90NonTp) {
        lines.push(
          `  - \`${dateTime(row.closedTs, timeZone)}\` outcome=\`${row.outcome}\` pnl=\`${fmtPct(row.pnlPct)}\` progress=\`${row.progress.toFixed(3)}\` touchedTp=\`${row.touchedTp}\``
        );
      }
    }
    lines.push("");
  }

  if (report.openSummaries.length) {
    lines.push("## Open Real Trades");
    lines.push("");
    for (const trade of report.openSummaries) {
      lines.push(`- \`${trade.key}\` ${trade.direction} | entry \`${trade.entry}\` | barsOpen \`${trade.barsOpen}\` | BE trigger \`${trade.managementBreakEvenTriggerR}\` at \`${trade.breakEvenTriggerPrice ?? "n/a"}\` | lock \`${trade.managementBreakEvenLockR}\` at \`${trade.breakEvenLockPrice ?? "n/a"}\``);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const stateFile = path.resolve(args["state-file"] || DEFAULT_STATE_FILE);
  const timeZone = args.timezone || DEFAULT_TIMEZONE;
  const laneArg = String(args.lanes || "").trim();
  const requestedLanes = laneArg
    ? laneArg.split(",").map((value) => value.trim()).filter(Boolean)
    : null;
  const outputPrefix =
    args.outputPrefix ||
    path.join(OUTPUT_DIR, `live-management-audit-${dayKey(Date.now(), timeZone)}`);

  const state = readJson(stateFile);
  const report = buildReport(state, timeZone, requestedLanes);

  const jsonFile = `${outputPrefix}.json`;
  const mdFile = `${outputPrefix}.md`;
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdFile, toMarkdown(report, timeZone));

  console.log(JSON.stringify({ jsonFile, mdFile }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  favorableProgress,
  touchedTp,
  computeBreakEvenTriggerPrice,
  computeBreakEvenLockPrice,
  summarizeLaneTrades,
  buildReport,
};
