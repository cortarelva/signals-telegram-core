const http = require("http");
const fs = require("fs");
const path = require("path");
const { getAccountSnapshot } = require("./binance-account");

const PORT = process.env.DASHBOARD_PORT || 3000;

const STATE_FILE = path.join(__dirname, "state.json");
const BASE_CONFIG_FILE = path.join(__dirname, "strategy-config.json");
const GENERATED_CONFIG_FILE = path.join(__dirname, "strategy-config.generated.json");
const METRICS_FILE = path.join(__dirname, "execution-metrics.json");
const PERFORMANCE_BASELINE_FILE = path.join(__dirname, "performance-baseline.json");
const PUBLIC_DIR = path.join(__dirname, "..", "dashboard");

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
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
      const tradeUsd = Number(exec.tradeUsd || exec.positionUsd || 0);
      const pnlPct = Number(exec.pnlPct || 0);
      const pnlUsd = tradeUsd * (pnlPct / 100);

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

function getUsdcSnapshot(exchange) {
  const usdc =
    (exchange?.balances || []).find((b) => b.asset === "USDC") || {
      asset: "USDC",
      free: 0,
      locked: 0,
      total: 0,
    };

  return {
    free: Number(usdc.free || 0),
    locked: Number(usdc.locked || 0),
    total: Number(usdc.total || 0),
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
  const usdc = getUsdcSnapshot(exchange);
  const fallbackStart = Number(process.env.ACCOUNT_SIZE || 1000);

  const current = readJsonSafe(PERFORMANCE_BASELINE_FILE, null);

  if (
    current &&
    Number.isFinite(Number(current.startingBalance)) &&
    Number.isFinite(Number(current.peakBalance))
  ) {
    let changed = false;

    if (!Number.isFinite(Number(current.currentBalance))) {
      current.currentBalance = usdc.total;
      changed = true;
    }

    if (changed) {
      writeJsonSafe(PERFORMANCE_BASELINE_FILE, current);
    }

    return current;
  }

  const baseline = {
    createdAt: new Date().toISOString(),
    startingBalance: usdc.total > 0 ? usdc.total : fallbackStart,
    currentBalance: usdc.total > 0 ? usdc.total : fallbackStart,
    peakBalance: usdc.total > 0 ? usdc.total : fallbackStart,
  };

  writeJsonSafe(PERFORMANCE_BASELINE_FILE, baseline);
  return baseline;
}

function buildPerformanceFromExchange(state, exchange) {
  const usdc = getUsdcSnapshot(exchange);
  const baseline = getOrCreatePerformanceBaseline(exchange);

  const startingBalance = Number(baseline.startingBalance || 0);
  const previousPeak = Number(baseline.peakBalance || startingBalance);

  const effectiveCurrentBalance =
    usdc.total > 0 ? usdc.total : Number(baseline.currentBalance || startingBalance);

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
    currentBalance: effectiveCurrentBalance,
    peakBalance,
    updatedAt: new Date().toISOString(),
  };

  writeJsonSafe(PERFORMANCE_BASELINE_FILE, updatedBaseline);

  return {
    source: "binance_usdc_total",
    usdcFree: Number(usdc.free.toFixed(6)),
    usdcLocked: Number(usdc.locked.toFixed(6)),
    usdcTotal: Number(usdc.total.toFixed(6)),
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

function buildStats(state, mergedConfig, generatedConfig, metrics, exchange) {
  const openSignals = Array.isArray(state.openSignals) ? state.openSignals : [];
  const closedSignals = Array.isArray(state.closedSignals) ? state.closedSignals : [];
  const signalLog = Array.isArray(state.signalLog) ? state.signalLog : [];
  const executions = Array.isArray(state.executions) ? state.executions : [];

  const executionStats = getClosedExecutionStats(state);
  const openExecutions = executions.filter((e) => e.status === "OPEN");
  const closedExecutions = executions.filter((e) => e.status === "CLOSED");

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

    if (t.outcome === "TP") bySymbol[key].tp++;
    if (t.outcome === "SL") bySymbol[key].sl++;
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

  const recentClosed = [...closedSignals].slice(-100).reverse();
  const recentSignals = [...signalLog].slice(-200).reverse();
  const recentExecutions = [...executions].slice(-100).reverse();

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

const server = http.createServer(async (req, res) => {
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

      const payload = buildStats(
        state,
        mergedConfig,
        generatedConfig,
        metrics,
        exchange
      );

      payload.executionMode = process.env.EXECUTION_MODE || "paper";
      payload.exchange = exchange;

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });

      res.end(JSON.stringify(payload, null, 2));
      return;
    } catch (err) {
      res.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
      });

      res.end(
        JSON.stringify(
          {
            error: err.body || err.message || String(err),
          },
          null,
          2
        )
      );
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

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});