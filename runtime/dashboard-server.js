const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const {
  readJsonSafe: readJsonFileSafe,
  writeJsonAtomic,
} = require("./file-utils");
const { resolveTradeOutcome } = require("./trade-outcome");

let getAccountSnapshot = async () => ({
  snapshotType: "unknown",
  balances: [],
  openOrders: [],
  positions: [],
});

try {
  const futuresAccount = require("./binance-futures-account");
  getAccountSnapshot =
    futuresAccount.getFuturesAccountSnapshot ||
    futuresAccount.getAccountSnapshot ||
    getAccountSnapshot;
} catch {}

try {
  if (getAccountSnapshot.toString().includes('snapshotType: "unknown"')) {
    const spotAccount = require("./binance-account");
    getAccountSnapshot = spotAccount.getAccountSnapshot || getAccountSnapshot;
  }
} catch {}

const { forceCloseExecutionById } = require("./futures-executor");

const PORT = process.env.DASHBOARD_PORT || 3002;
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || "127.0.0.1";
const PROJECT_ROOT = path.join(__dirname, "..");
const STATE_FILE =
  process.env.STATE_FILE_PATH || path.join(__dirname, "state.json");
const BASE_CONFIG_FILE = path.join(__dirname, "strategy-config.json");
const GENERATED_CONFIG_FILE = path.join(__dirname, "strategy-config.generated.json");
const METRICS_FILE =
  process.env.EXECUTION_METRICS_FILE_PATH ||
  path.join(__dirname, "execution-metrics.json");
const ORDERS_LOG_FILE =
  process.env.ORDERS_LOG_FILE_PATH || path.join(__dirname, "orders-log.json");
const PERFORMANCE_BASELINE_FILE = path.join(__dirname, "performance-baseline.json");
const ADAPTIVE_HISTORY_FILE = path.join(__dirname, "adaptive-history.json");
const PID_FILE = path.join(__dirname, ".bot-pids.json");

const RESEARCH_JSON_FILE = path.join(__dirname, "..", "research", "consolidated-trades.json");
const RESEARCH_CSV_FILE = path.join(__dirname, "..", "research", "consolidated-trades.csv");

const PUBLIC_DIR = path.join(__dirname, "..", "dashboard");

function readJsonSafe(filePath, fallback) {
  return readJsonFileSafe(filePath, fallback);
}

function writeJsonSafe(filePath, value) {
  writeJsonAtomic(filePath, value);
}

function deleteIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

function buildMergedConfig(baseConfig, generatedConfig) {
  const merged = { ...baseConfig };

  for (const symbol of Object.keys(generatedConfig || {})) {
    merged[symbol] = {
      ...(baseConfig[symbol] || {}),
      ...generatedConfig[symbol],
    };
  }

  return merged;
}

function safeAvg(values) {
  const nums = (Array.isArray(values) ? values : []).filter(
    (v) => typeof v === "number" && Number.isFinite(v)
  );
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function percentile(values, p) {
  const nums = (Array.isArray(values) ? values : [])
    .filter((v) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);

  if (!nums.length) return 0;

  const idx = Math.min(
    nums.length - 1,
    Math.max(0, Math.floor(nums.length * p))
  );

  return nums[idx];
}

function buildExecutionMetricsSummary(metrics) {
  const rows = Array.isArray(metrics) ? metrics : [];

  const slippages = rows
    .map((m) => Number(m.slippagePct))
    .filter((v) => Number.isFinite(v));

  const latencyInternal = rows
    .map((m) => Number(m.latencyInternal))
    .filter((v) => Number.isFinite(v));

  const latencyExchange = rows
    .map((m) => Number(m.latencyExchange))
    .filter((v) => Number.isFinite(v));

  const latencyTotal = rows
    .map((m) => Number(m.latencyTotal))
    .filter((v) => Number.isFinite(v));

  return {
    count: rows.length,

    avgSlippagePct: safeAvg(slippages),
    p95SlippagePct: percentile(slippages, 0.95),
    maxSlippagePct: slippages.length ? Math.max(...slippages) : 0,

    avgLatencyInternalMs: safeAvg(latencyInternal),
    avgLatencyExchangeMs: safeAvg(latencyExchange),
    avgLatencyTotalMs: safeAvg(latencyTotal),

    p95LatencyInternalMs: percentile(latencyInternal, 0.95),
    p95LatencyExchangeMs: percentile(latencyExchange, 0.95),
    p95LatencyTotalMs: percentile(latencyTotal, 0.95),

    maxLatencyTotalMs: latencyTotal.length ? Math.max(...latencyTotal) : 0,

    recent: rows.slice(-100).reverse(),
  };
}

function buildExecutionBreakdown(executions) {
  const rows = Array.isArray(executions) ? executions : [];

  const byMode = {
    paper: { total: 0, open: 0, closed: 0, pnlUsd: 0, pnlPctAvg: 0, wins: 0, losses: 0 },
    binance_test: { total: 0, open: 0, closed: 0, pnlUsd: 0, pnlPctAvg: 0, wins: 0, losses: 0 },
    binance_real: { total: 0, open: 0, closed: 0, pnlUsd: 0, pnlPctAvg: 0, wins: 0, losses: 0 },
    unknown: { total: 0, open: 0, closed: 0, pnlUsd: 0, pnlPctAvg: 0, wins: 0, losses: 0 },
  };

  for (const exec of rows) {
    const mode = byMode[exec.mode] ? exec.mode : "unknown";
    const bucket = byMode[mode];

    bucket.total++;

    if (exec.status === "OPEN") bucket.open++;
    if (exec.status === "CLOSED") bucket.closed++;

    if (exec.status === "CLOSED") {
      const pnlPct = Number(exec.pnlPct || 0);
      const pnlUsd = Number(
        exec.pnlRealizedNet ??
          exec.pnlUsd ??
          exec.pnlRealizedGross ??
          0
      );

      bucket.pnlUsd += pnlUsd;

      if (pnlPct > 0) bucket.wins++;
      else if (pnlPct < 0) bucket.losses++;
    }
  }

  for (const mode of Object.keys(byMode)) {
    const closed = rows.filter((e) => (e.mode || "unknown") === mode && e.status === "CLOSED");
    const avgPct = safeAvg(closed.map((e) => Number(e.pnlPct || 0)));
    byMode[mode].pnlUsd = Number(byMode[mode].pnlUsd.toFixed(2));
    byMode[mode].pnlPctAvg = Number(avgPct.toFixed(4));
  }

  return byMode;
}

function isFuturesSnapshot(exchange) {
  return (
    exchange?.snapshotType === "futures" ||
    Number.isFinite(Number(exchange?.totalWalletBalance)) ||
    Number.isFinite(Number(exchange?.availableBalance)) ||
    Array.isArray(exchange?.positions)
  );
}

function getBalanceSnapshot(exchange) {
  if (isFuturesSnapshot(exchange)) {
    const availableBalance = Number(exchange?.availableBalance || 0);
    const walletBalance = Number(exchange?.totalWalletBalance || 0);
    const marginBalance = Number(
      exchange?.totalMarginBalance || walletBalance || availableBalance || 0
    );
    const unrealizedPnl = Number(exchange?.totalUnrealizedProfit || 0);
    const lockedBalance = Math.max(0, marginBalance - availableBalance);

    return {
      snapshotType: "futures",
      asset: String(exchange?.quoteAsset || process.env.FUTURES_QUOTE_ASSET || "USDT"),
      free: availableBalance,
      locked: lockedBalance,
      total: marginBalance,
      availableBalance,
      walletBalance,
      marginBalance,
      unrealizedPnl,
      positions: Array.isArray(exchange?.positions) ? exchange.positions : [],
      openOrders: Array.isArray(exchange?.openOrders) ? exchange.openOrders : [],
    };
  }

  const quoteAsset = String(process.env.DASHBOARD_QUOTE_ASSET || "USDC");
  const quote =
    (exchange?.balances || []).find((b) => b.asset === quoteAsset) || {
      asset: quoteAsset,
      free: 0,
      locked: 0,
      total: 0,
    };

  return {
    snapshotType: "spot",
    asset: quoteAsset,
    free: Number(quote.free || 0),
    locked: Number(quote.locked || 0),
    total: Number(quote.total || 0),
    availableBalance: Number(quote.free || 0),
    walletBalance: Number(quote.total || 0),
    marginBalance: Number(quote.total || 0),
    unrealizedPnl: 0,
    positions: [],
    openOrders: Array.isArray(exchange?.openOrders) ? exchange.openOrders : [],
  };
}

function getClosedExecutionStats(state) {
  const executions = Array.isArray(state?.executions) ? state.executions : [];
  const closedExecutions = executions.filter((e) => e.status === "CLOSED");

  let winCount = 0;
  let lossCount = 0;

  for (const exec of closedExecutions) {
    const pnlPct = Number(exec.pnlPct || 0);
    if (pnlPct > 0) winCount++;
    else if (pnlPct < 0) lossCount++;
  }

  return {
    closedCount: closedExecutions.length,
    winCount,
    lossCount,
    winRate:
      closedExecutions.length > 0
        ? (winCount / closedExecutions.length) * 100
        : 0,
  };
}

function getOrCreatePerformanceBaseline(exchange) {
  const snap = getBalanceSnapshot(exchange);
  const fallbackStart = Number(process.env.ACCOUNT_SIZE || 1000);
  const current = readJsonSafe(PERFORMANCE_BASELINE_FILE, null);

  const currentBalance =
    snap.snapshotType === "futures"
      ? Number(snap.marginBalance || snap.walletBalance || snap.total || 0)
      : Number(snap.total || 0);

  if (
    current &&
    Number.isFinite(Number(current.startingBalance)) &&
    Number.isFinite(Number(current.peakBalance))
  ) {
    if (current.snapshotType && current.snapshotType !== snap.snapshotType) {
      const resetBaseline = {
        createdAt: new Date().toISOString(),
        snapshotType: snap.snapshotType,
        asset: snap.asset,
        startingBalance: currentBalance > 0 ? currentBalance : fallbackStart,
        currentBalance: currentBalance > 0 ? currentBalance : fallbackStart,
        peakBalance: currentBalance > 0 ? currentBalance : fallbackStart,
        resetReason: `snapshot_type_changed:${current.snapshotType}->${snap.snapshotType}`,
      };

      writeJsonSafe(PERFORMANCE_BASELINE_FILE, resetBaseline);
      return resetBaseline;
    }

    let changed = false;

    if (!Number.isFinite(Number(current.currentBalance))) {
      current.currentBalance = currentBalance > 0 ? currentBalance : Number(current.startingBalance || fallbackStart);
      changed = true;
    }

    if (!current.snapshotType || current.asset !== snap.asset) {
      current.snapshotType = snap.snapshotType;
      current.asset = snap.asset;
      changed = true;
    }

    if (changed) {
      writeJsonSafe(PERFORMANCE_BASELINE_FILE, current);
    }

    return current;
  }

  const baselineValue = currentBalance > 0 ? currentBalance : fallbackStart;

  const baseline = {
    createdAt: new Date().toISOString(),
    snapshotType: snap.snapshotType,
    asset: snap.asset,
    startingBalance: baselineValue,
    currentBalance: baselineValue,
    peakBalance: baselineValue,
  };

  writeJsonSafe(PERFORMANCE_BASELINE_FILE, baseline);
  return baseline;
}

function buildPerformanceFromExchange(state, exchange) {
  const snap = getBalanceSnapshot(exchange);
  const baseline = getOrCreatePerformanceBaseline(exchange);

  const startingBalance = Number(baseline.startingBalance || 0);
  const previousPeak = Number(baseline.peakBalance || startingBalance);

  const effectiveCurrentBalance =
    snap.snapshotType === "futures"
      ? Number(snap.marginBalance || snap.walletBalance || snap.total || 0)
      : Number(snap.total || Number(baseline.currentBalance || startingBalance));

  const peakBalance = Math.max(previousPeak, effectiveCurrentBalance);

  const realizedPnlUsd = effectiveCurrentBalance - startingBalance;
  const realizedPnlPct =
    startingBalance > 0 ? (realizedPnlUsd / startingBalance) * 100 : 0;

  const maxDrawdownPct =
    peakBalance > 0
      ? ((peakBalance - effectiveCurrentBalance) / peakBalance) * 100
      : 0;

  const closedStats = getClosedExecutionStats(state);

  const updatedBaseline = {
    ...baseline,
    snapshotType: snap.snapshotType,
    asset: snap.asset,
    currentBalance: effectiveCurrentBalance,
    peakBalance,
    updatedAt: new Date().toISOString(),
  };

  writeJsonSafe(PERFORMANCE_BASELINE_FILE, updatedBaseline);

  return {
    source:
      snap.snapshotType === "futures"
        ? "binance_futures_margin_balance"
        : "binance_spot_quote_total",
    snapshotType: snap.snapshotType,
    asset: snap.asset,
    availableBalance: Number(snap.availableBalance.toFixed(6)),
    lockedBalance: Number(snap.locked.toFixed(6)),
    totalBalance: Number(snap.total.toFixed(6)),
    walletBalance: Number(Number(snap.walletBalance || 0).toFixed(6)),
    marginBalance: Number(Number(snap.marginBalance || 0).toFixed(6)),
    unrealizedPnl: Number(Number(snap.unrealizedPnl || 0).toFixed(6)),
    positionsCount: Array.isArray(snap.positions) ? snap.positions.length : 0,
    startingBalance: Number(startingBalance.toFixed(2)),
    currentBalance: Number(effectiveCurrentBalance.toFixed(2)),
    peakBalance: Number(peakBalance.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    realizedPnlUsd: Number(realizedPnlUsd.toFixed(2)),
    realizedPnlPct: Number(realizedPnlPct.toFixed(2)),
    closedCount: closedStats.closedCount,
    winCount: closedStats.winCount,
    lossCount: closedStats.lossCount,
    winRate: Number(closedStats.winRate.toFixed(2)),
  };
}


function getExecutionDirection(execution) {
  return String(execution?.direction || execution?.side || "").toUpperCase();
}

function hasMatchingOpenPosition(exchange, execution) {
  const positions = Array.isArray(exchange?.positions) ? exchange.positions : [];
  const wantedSymbol = String(execution?.symbol || "").toUpperCase();
  const wantedDirection = getExecutionDirection(execution);

  return positions.some((p) => {
    const symbolOk = String(p?.symbol || "").toUpperCase() === wantedSymbol;
    const amt = Number(p?.positionAmt || 0);
    if (!symbolOk || !Number.isFinite(amt) || Math.abs(amt) <= 1e-12) return false;

    if (wantedDirection === "LONG" || wantedDirection === "BUY") return amt > 0;
    if (wantedDirection === "SHORT" || wantedDirection === "SELL") return amt < 0;
    return false;
  });
}

function inferExchangeClose(execution) {
  const outcomeInfo = resolveTradeOutcome(execution);
  if (outcomeInfo.outcome === "TP") {
    return { outcome: "TP", closeReason: execution.closeReason, exitPrice: Number(execution.tp) || null };
  }
  if (
    outcomeInfo.outcome === "SL" ||
    outcomeInfo.outcome === "BE" ||
    outcomeInfo.outcome === "PROTECTED_SL"
  ) {
    return {
      outcome: outcomeInfo.outcome,
      closeReason: execution.closeReason,
      exitPrice: Number(execution.sl) || null,
    };
  }

  return {
    outcome: execution?.outcome || "EXCHANGE",
    closeReason: execution?.closeReason || "EXCHANGE_SYNC_CLOSE",
    exitPrice: Number.isFinite(Number(execution?.exitPrice)) && Number(execution.exitPrice) > 0
      ? Number(execution.exitPrice)
      : null,
  };
}

function reconcileExecutionsWithExchange(state, exchange) {
  if (!state || !Array.isArray(state.executions) || !isFuturesSnapshot(exchange)) {
    return { state, changed: false };
  }

  let changed = false;

  for (const execution of state.executions) {
    if (!execution || execution.status !== "OPEN" || execution.mode !== "binance_real") continue;

    if (!Number.isFinite(Number(execution.openedTs)) || Number(execution.openedTs) <= 0) {
      const fallbackOpenTs = Number(execution?.exchange?.openTransactTime) || Date.now();
      execution.openedTs = fallbackOpenTs;
      changed = true;
    }

    if (hasMatchingOpenPosition(exchange, execution)) continue;

    execution.exchange = execution.exchange || {};
    if (!execution.exchange.reconcileWarning) {
      execution.exchange.reconcileWarning = "position_missing_pending_executor_reconcile";
      changed = true;
    }
  }

  return { state, changed };
}

function annotateTradeOutcome(record) {
  const outcomeInfo = resolveTradeOutcome(record);
  return {
    ...record,
    outcome: outcomeInfo.outcome,
    outcomeTitle: outcomeInfo.title,
    outcomeBucket: outcomeInfo.bucket,
  };
}

function buildStats(state, mergedConfig, generatedConfig, metrics, exchange) {
  const openSignalsRaw = Array.isArray(state.openSignals) ? state.openSignals : [];
  const closedSignals = Array.isArray(state.closedSignals) ? state.closedSignals : [];
  const signalLog = Array.isArray(state.signalLog) ? state.signalLog : [];
  const executions = Array.isArray(state.executions) ? state.executions : [];

  const executionStats = getClosedExecutionStats(state);
  const openExecutions = executions.filter((e) => e.status === "OPEN");
  const closedExecutions = executions.filter((e) => e.status === "CLOSED");

  // If there is an OPEN execution for the same symbol+tf, prefer the *real* entry/sl/tp
  // (Binance fill/position entry) over the signal's projected entry.
  const openExecByKey = new Map();
  for (const e of openExecutions) {
    const key = `${e.symbol || ""}::${e.tf || ""}`;
    if (!openExecByKey.has(key)) openExecByKey.set(key, e);
  }

  const openSignals = openSignalsRaw.map((s) => {
    const key = `${s.symbol || ""}::${s.tf || ""}`;
    const e = openExecByKey.get(key);
    if (!e) return s;

    return {
      ...s,
      // preserve projected values for debugging
      projectedEntry: Number.isFinite(Number(s.entry)) ? Number(s.entry) : s.projectedEntry,
      projectedSL: Number.isFinite(Number(s.sl)) ? Number(s.sl) : s.projectedSL,
      projectedTP: Number.isFinite(Number(s.tp)) ? Number(s.tp) : s.projectedTP,

      // overwrite with real execution values (what Binance shows)
      entry: Number.isFinite(Number(e.entry)) ? Number(e.entry) : s.entry,
      sl: Number.isFinite(Number(e.sl)) ? Number(e.sl) : s.sl,
      tp: Number.isFinite(Number(e.tp)) ? Number(e.tp) : s.tp,

      // extra clarity
      entrySource: e.exchange?.entryPriceSource || "execution",
      executionId: e.executionId || e.id || s.executionId,
      mode: e.mode || s.mode,
      status: "OPEN",
    };
  });

  let trendSignals = 0;
  let rangeSignals = 0;
  let neutralSignals = 0;

  for (const s of signalLog) {
    if (s.isTrend === true) trendSignals++;
    else if (s.isRange === true) rangeSignals++;
    else neutralSignals++;
  }

  const bySymbol = {};

  for (const t of closedSignals) {
    const key = `${t.symbol || "UNKNOWN"}_${t.tf || "?"}`;

    if (!bySymbol[key]) {
      bySymbol[key] = {
        trades: 0,
        tp: 0,
        sl: 0,
        pnlSum: 0,
      };
    }

    bySymbol[key].trades++;
    bySymbol[key].pnlSum += Number(t.pnlPct || 0);

    const outcomeInfo = resolveTradeOutcome(t);
    if (outcomeInfo.outcome === "TP" || outcomeInfo.outcome === "PROTECTED_SL") {
      bySymbol[key].tp++;
    }
    if (outcomeInfo.outcome === "SL") bySymbol[key].sl++;
  }

  const byScoreBucket = {
    "0-24": { count: 0, executable: 0, watch: 0, ignore: 0 },
    "25-49": { count: 0, executable: 0, watch: 0, ignore: 0 },
    "50-74": { count: 0, executable: 0, watch: 0, ignore: 0 },
    "75-100": { count: 0, executable: 0, watch: 0, ignore: 0 },
  };

  for (const s of signalLog) {
    const score = Number(s.score ?? 0);

    let bucket = "0-24";
    if (score >= 75) bucket = "75-100";
    else if (score >= 50) bucket = "50-74";
    else if (score >= 25) bucket = "25-49";

    byScoreBucket[bucket].count++;

    const cls = String(s.signalClass || "IGNORE").toLowerCase();

    if (cls === "executable") byScoreBucket[bucket].executable++;
    else if (cls === "watch") byScoreBucket[bucket].watch++;
    else byScoreBucket[bucket].ignore++;
  }

  const recentClosed = [...closedSignals].slice(-100).reverse().map(annotateTradeOutcome);
  const recentSignals = [...signalLog].slice(-200).reverse();
  const recentExecutions = [...executions].slice(-100).reverse().map(annotateTradeOutcome);

  const allSymbols = Array.from(
    new Set(
      [...openSignals, ...closedSignals, ...signalLog, ...executions]
        .map((x) => x?.symbol)
        .filter(Boolean)
    )
  ).sort();

  const allTimeframes = Array.from(
    new Set(
      [...openSignals, ...closedSignals, ...signalLog, ...executions]
        .map((x) => x?.tf)
        .filter(Boolean)
    )
  ).sort();

  const performance = buildPerformanceFromExchange(state, exchange);
  const executionMetrics = buildExecutionMetricsSummary(metrics);
  const executionBreakdown = buildExecutionBreakdown(executions);

  return {
    generatedAt: new Date().toISOString(),

    totals: {
      openSignals: openSignals.length,
      closedSignals: executionStats.closedCount,
      signalLog: signalLog.length,
      executions: executions.length,
      openExecutions: openExecutions.length,
      closedExecutions: closedExecutions.length,
      wins: executionStats.winCount,
      losses: executionStats.lossCount,
      winrate: executionStats.winRate,
      trendSignals,
      rangeSignals,
      neutralSignals,
    },

    performance,
    executionMetrics,
    executionBreakdown,

    bySymbol,
    byScoreBucket,
    allSymbols,
    allTimeframes,

    recentClosed,
    recentSignals,
    recentExecutions,

    config: {
      merged: mergedConfig,
      generated: generatedConfig,
    },

    raw: {
      openSignals,
      closedSignals,
      signalLog,
      executions,
      metrics: Array.isArray(metrics) ? metrics : [],
    },
  };
}

function getContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function parseBotStatusOutput(stdout) {
  const text = String(stdout || "").trim();

  if (!text) {
    return {
      running: false,
      processCount: 0,
      runningCount: 0,
      processes: [],
      raw: text,
    };
  }

  if (text.includes("Bot não está registado como ativo.")) {
    return {
      running: false,
      processCount: 0,
      runningCount: 0,
      processes: [],
      raw: text,
    };
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const processes = lines
    .map((line) => {
      const m = line.match(/^- (.+?) \(pid (\d+)\): (RUNNING|STOPPED)$/);
      if (!m) return null;

      return {
        name: m[1],
        pid: Number(m[2]),
        running: m[3] === "RUNNING",
      };
    })
    .filter(Boolean);

  return {
    running: processes.some((p) => p.running),
    processCount: processes.length,
    runningCount: processes.filter((p) => p.running).length,
    processes,
    raw: text,
  };
}

function runNodeScript(scriptName) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(PROJECT_ROOT, scriptName)],
      { cwd: PROJECT_ROOT },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message || "").trim()));
          return;
        }

        resolve({
          ok: true,
          stdout: String(stdout || "").trim(),
          stderr: String(stderr || "").trim(),
        });
      }
    );
  });
}

async function buildBotStatus() {
  const result = await runNodeScript("botstatus.js");
  return parseBotStatusOutput(result.stdout);
}

async function startBotProcesses() {
  const result = await runNodeScript("botstart.js");
  const status = await buildBotStatus();

  return {
    ok: true,
    stdout: result.stdout,
    ...status,
  };
}

async function stopBotProcesses() {
  const result = await runNodeScript("botstop.js");
  const status = await buildBotStatus();

  return {
    ok: true,
    stdout: result.stdout,
    ...status,
  };
}

async function resetHistoryFiles() {
  const bot = await buildBotStatus();

  if (bot.running) {
    return {
      ok: false,
      error: "Stop the bot before resetting history.",
      bot,
    };
  }

  writeJsonSafe(STATE_FILE, {
    lastSignal: {},
    openSignals: [],
    closedSignals: [],
    executions: [],
    signalLog: [],
  });

  writeJsonSafe(METRICS_FILE, []);
  writeJsonSafe(ORDERS_LOG_FILE, []);
  writeJsonSafe(ADAPTIVE_HISTORY_FILE, []);

  deleteIfExists(PERFORMANCE_BASELINE_FILE);
  deleteIfExists(RESEARCH_JSON_FILE);
  deleteIfExists(RESEARCH_CSV_FILE);

  return {
    ok: true,
    message: "History cleared successfully.",
    cleared: [
      path.basename(STATE_FILE),
      path.basename(METRICS_FILE),
      path.basename(ORDERS_LOG_FILE),
      path.basename(ADAPTIVE_HISTORY_FILE),
      path.basename(PERFORMANCE_BASELINE_FILE),
      path.basename(RESEARCH_JSON_FILE),
      path.basename(RESEARCH_CSV_FILE),
    ],
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/bot/status") {
  try {
    const status = await buildBotStatus();
    sendJson(res, 200, status);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
  return;
}

  if (req.method === "POST" && req.url === "/api/bot/start") {
  try {
    const result = await startBotProcesses();
    sendJson(res, 200, result);
    return;
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
    return;
  }
}

  if (req.method === "POST" && req.url === "/api/bot/stop") {
  try {
    const result = await stopBotProcesses();
    sendJson(res, 200, result);
    return;
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
    return;
  }
}

  if (req.method === "POST" && req.url === "/api/history/reset") {
    try {
      const result = await resetHistoryFiles();
      sendJson(res, result.ok ? 200 : 409, result);
      return;
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || String(err) });
      return;
    }
  }

  if (req.url === "/api/state") {
    try {
      const state = readJsonSafe(STATE_FILE, {
        openSignals: [],
        closedSignals: [],
        signalLog: [],
        executions: [],
        lastSignal: {},
      });

      const metrics = readJsonSafe(METRICS_FILE, []);
      const baseConfig = readJsonSafe(BASE_CONFIG_FILE, {});
      const generatedConfig = readJsonSafe(GENERATED_CONFIG_FILE, {});
      const mergedConfig = buildMergedConfig(baseConfig, generatedConfig);

      let exchange;
      try {
        exchange = await getAccountSnapshot();
      } catch (err) {
        exchange = {
          error: err.body || err.message || String(err),
          balances: [],
          openOrders: [],
        };
      }

      const reconciled = reconcileExecutionsWithExchange(state, exchange);
      if (reconciled.changed) {
        writeJsonSafe(STATE_FILE, reconciled.state);
      }

      const payload = buildStats(
        reconciled.state,
        mergedConfig,
        generatedConfig,
        metrics,
        exchange
      );

      payload.executionMode = process.env.EXECUTION_MODE || "paper";
      payload.exchange = exchange;
      payload.botStatus = await buildBotStatus();
      
      sendJson(res, 200, payload);
      return;
    } catch (err) {
      sendJson(res, 500, {
        error: err.body || err.message || String(err),
      });
      return;
    }
  }

  if (
    req.method === "POST" &&
    (req.url === "/api/market-close" || req.url === "/api/market-sell")
  ) {
    try {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", async () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const executionId = parsed.executionId;

          if (!executionId) {
            sendJson(res, 400, { ok: false, error: "executionId missing" });
            return;
          }

          const state = readJsonSafe(STATE_FILE, {
            openSignals: [],
            closedSignals: [],
            signalLog: [],
            executions: [],
            lastSignal: {},
          });

          const result = await forceCloseExecutionById(state, executionId);
          writeJsonSafe(STATE_FILE, state);

          sendJson(res, result.ok ? 200 : 409, result);
        } catch (err) {
          sendJson(res, 500, {
            ok: false,
            error: err.body || err.message || String(err),
          });
        }
      });

      return;
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: err.body || err.message || String(err),
      });
      return;
    }
  }

  const requested = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(PUBLIC_DIR, requested);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": getContentType(filePath),
    });

    res.end(data);
  });
});

server.listen(PORT, DASHBOARD_HOST, () => {
  console.log(`Dashboard running at http://${DASHBOARD_HOST}:${PORT}`);
});
