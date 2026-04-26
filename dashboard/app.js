let dashboardData = null;
let charts = {};
let tvWidgetSymbol = "BINANCE:BTCUSDC";
const HISTORY_TABLE_LIMIT = 25;

if (window.Chart) {
  window.Chart.defaults.color = "#c9d4e2";
  window.Chart.defaults.borderColor = "rgba(136, 167, 196, 0.12)";
  window.Chart.defaults.font.family = '"Manrope", "Avenir Next", "Segoe UI", sans-serif';
}

function fmt(n, digits = 2) {
  if (typeof n !== "number" || Number.isNaN(n)) return "-";
  return n.toFixed(digits);
}

function pct(value, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value.toFixed(digits)}%`;
}

function pct01(value, digits = 3) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function normalizeEpoch(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function executionTimestamp(e) {
  return (
    normalizeEpoch(e?.closedTs) ||
    normalizeEpoch(e?.openedTs) ||
    normalizeEpoch(e?.ts) ||
    normalizeEpoch(e?.exchange?.closeTransactTime) ||
    normalizeEpoch(e?.exchange?.openTransactTime) ||
    null
  );
}

function fmtDateTime(ts) {
  const value = normalizeEpoch(ts);
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

function executionOutcome(e) {
  if (e?.status === "OPEN") return "OPEN";
  return e?.outcome || e?.closeReason || "-";
}

function clsPill(cls) {
  const c = String(cls || "IGNORE").toLowerCase();
  if (c === "executable") return `<span class="pill exec">EXECUTABLE</span>`;
  if (c === "watch") return `<span class="pill watch">WATCH</span>`;
  if (c === "blocked") return `<span class="pill blocked">BLOCKED</span>`;
  return `<span class="pill ignore">IGNORE</span>`;
}

function outcomePill(outcome) {
  if (outcome === "TP") return `<span class="pill tp">TP</span>`;
  if (outcome === "BE") return `<span class="pill be">BE</span>`;
  if (outcome === "PROTECTED_SL") return `<span class="pill protected">PROTECTED</span>`;
  if (outcome === "SL") return `<span class="pill sl">SL</span>`;
  return `<span class="pill ignore">${outcome || "-"}</span>`;
}

function regimePill(item) {
  if (item?.isTrend === true) return `<span class="pill trend">TREND</span>`;
  if (item?.isRange === true) return `<span class="pill range">RANGE</span>`;
  return `<span class="pill neutral">NEUTRAL</span>`;
}

function statusPill(status) {
  if (status === "OPEN") return `<span class="pill open">OPEN</span>`;
  if (status === "CLOSED") return `<span class="pill closed">CLOSED</span>`;
  return `<span class="pill ignore">${status || "-"}</span>`;
}

function modePill(mode) {
  const m = String(mode || "unknown").toLowerCase();

  if (m === "paper") return `<span class="pill mode-paper">PAPER</span>`;
  if (m === "binance_test") return `<span class="pill mode-test">BINANCE_TEST</span>`;
  if (m === "binance_real") return `<span class="pill mode-real">BINANCE_REAL</span>`;
  return `<span class="pill ignore">${mode || "-"}</span>`;
}

function metaModelPill(item) {
  if (item?.metaModelApplied !== true) {
    return `<span class="pill ignore">ML N/A</span>`;
  }

  if (item?.metaModelPassed === true) {
    const prob =
      typeof item?.metaModelProbability === "number"
        ? ` ${item.metaModelProbability.toFixed(2)}`
        : "";
    return `<span class="pill trend">ML PASS${prob}</span>`;
  }

  return `<span class="pill sl">ML BLOCK</span>`;
}

function directionPill(item) {
  const direction = String(item?.direction || item?.side || "-").toUpperCase();

  if (direction === "LONG" || direction === "BUY") {
    return `<span class="pill long">${direction}</span>`;
  }

  if (direction === "SHORT" || direction === "SELL") {
    return `<span class="pill short">${direction}</span>`;
  }

  return `<span class="pill ignore">${direction}</span>`;
}

function displayDirection(item) {
  return String(item?.direction || item?.side || "-").toUpperCase();
}

function boolTag(v) {
  return v ? "YES" : "NO";
}

function getRegime(item) {
  if (item?.isTrend === true) return "TREND";
  if (item?.isRange === true) return "RANGE";
  return "NEUTRAL";
}

function getConfigForSymbol(symbol) {
  return dashboardData?.config?.merged?.[symbol] || {};
}

function formatSymbolRules(symbol) {
  const cfg = getConfigForSymbol(symbol);
  const adxMin = cfg.ADX_MIN_TREND ?? "-";
  const bullishFast = boolTag(Boolean(cfg.REQUIRE_BULLISH_FAST));
  const stacked = boolTag(Boolean(cfg.REQUIRE_STACKED_EMA));

  return `ADX_MIN=${adxMin} | bullishFast=${bullishFast} | stackedEMA=${stacked}`;
}

function getFilters() {
  return {
    symbol: document.getElementById("symbolFilter").value,
    tf: document.getElementById("tfFilter").value,
    signalClass: document.getElementById("classFilter").value,
    regime: document.getElementById("regimeFilter").value,
    lookback: Number(document.getElementById("lookbackFilter").value),
  };
}

function filterItems(items, filters) {
  return items.filter((item) => {
    if (filters.symbol !== "ALL" && item.symbol !== filters.symbol) return false;
    if (filters.tf !== "ALL" && item.tf !== filters.tf) return false;

    if (filters.signalClass !== "ALL") {
      const cls = String(item.signalClass || "").toUpperCase();
      if (cls !== filters.signalClass) return false;
    }

    if (filters.regime !== "ALL") {
      if (getRegime(item) !== filters.regime) return false;
    }

    return true;
  });
}

function getLastN(items, n) {
  if (!Array.isArray(items)) return [];
  if (!Number.isFinite(n) || n >= items.length) return [...items];
  return items.slice(-n);
}

function safeAvg(arr) {
  const nums = (Array.isArray(arr) ? arr : []).filter(
    (n) => typeof n === "number" && !Number.isNaN(n)
  );
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function extractRootReason(reason) {
  const text = String(reason || "").trim();
  if (!text) return "Sem motivo";
  return text.split(" | ")[0].trim();
}

function countBy(items, getKey) {
  const counts = {};
  for (const item of items || []) {
    const key = getKey(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function topEntries(counts, limit = 5) {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function latestSignalTime(signals) {
  const last = Array.isArray(signals) && signals.length ? signals[signals.length - 1] : null;
  return normalizeEpoch(last?.ts || last?.signalTs || last?.signalCandleCloseTime);
}

function metricTone(label) {
  const text = String(label || "").toLowerCase();

  if (
    text.includes("loss") ||
    text.includes("drawdown") ||
    text.includes("slippage") ||
    text.includes("latency")
  ) {
    return "warn";
  }

  if (
    text.includes("win") ||
    text.includes("pnl") ||
    text.includes("balance") ||
    text.includes("profit") ||
    text.includes("current") ||
    text.includes("peak") ||
    text.includes("wallet") ||
    text.includes("available")
  ) {
    return "good";
  }

  if (
    text.includes("open") ||
    text.includes("trade") ||
    text.includes("signal") ||
    text.includes("position") ||
    text.includes("order") ||
    text.includes("metrics count") ||
    text.includes("assets")
  ) {
    return "info";
  }

  return "neutral";
}

function renderMetricCards(targetId, cards) {
  const container = document.getElementById(targetId);
  if (!container) return;

  container.innerHTML = cards
    .map(([label, value, explicitTone]) => {
      const tone = explicitTone || metricTone(label);
      const rich = typeof value === "string" && value.includes("<");

      return `
        <article class="metric-card tone-${tone}">
          <div class="metric-label">${label}</div>
          <div class="metric-value${rich ? " rich" : ""}">${value}</div>
        </article>
      `;
    })
    .join("");
}

function tableWrap(inner) {
  return `<div class="table-wrap">${inner}</div>`;
}

function populateSelect(selectId, values, includeAll = true) {
  const el = document.getElementById(selectId);
  const current = el.value;

  const options = [];
  if (includeAll) options.push(`<option value="ALL">Todos</option>`);
  for (const value of values) {
    options.push(`<option value="${value}">${value}</option>`);
  }

  el.innerHTML = options.join("");

  if ([...el.options].some((o) => o.value === current)) {
    el.value = current;
  }
}

function populateTvSymbols(symbols) {
  const el = document.getElementById("tvSymbol");
  const current = el.value || "BINANCE:BTCUSDC";

  const options = symbols.map((s) => {
    const tv = `BINANCE:${s}`;
    return `<option value="${tv}">${tv}</option>`;
  });

  el.innerHTML = options.join("");

  if ([...el.options].some((o) => o.value === current)) {
    el.value = current;
  } else if ([...el.options].length) {
    el.selectedIndex = 0;
  }
}

function renderPerformance(perf) {
  if (!perf) return;

  const cards = [
    ["Starting Balance", `$${fmt(perf.startingBalance)}`],
    ["Current Balance", `$${fmt(perf.currentBalance)}`],
    ["Peak Balance", `$${fmt(perf.peakBalance)}`],
    ["Realized PnL $", `$${fmt(perf.realizedPnlUsd)}`],
    ["Realized PnL %", pct(perf.realizedPnlPct)],
    ["Max Drawdown", pct(perf.maxDrawdownPct), "bad"],
    ["Closed Trades", perf.closedCount, "info"],
    ["Wins", perf.winCount],
    ["Losses", perf.lossCount, "bad"],
    ["Winrate", pct(perf.winRate)]
  ];

  renderMetricCards("performanceCards", cards);
}

function renderExecutionMetrics(metrics) {
  if (!metrics) return;

  const cards = [
    ["Metrics Count", metrics.count ?? 0, "info"],
    ["Avg Slippage", pct01(metrics.avgSlippagePct || 0), "warn"],
    ["P95 Slippage", pct01(metrics.p95SlippagePct || 0), "warn"],
    ["Max Slippage", pct01(metrics.maxSlippagePct || 0), "bad"],
    ["Avg Internal", `${fmt(metrics.avgLatencyInternalMs || 0, 0)}ms`, "warn"],
    ["Avg Exchange", `${fmt(metrics.avgLatencyExchangeMs || 0, 0)}ms`, "warn"],
    ["Avg Total", `${fmt(metrics.avgLatencyTotalMs || 0, 0)}ms`, "warn"],
    ["P95 Total", `${fmt(metrics.p95LatencyTotalMs || 0, 0)}ms`, "warn"],
    ["Max Total", `${fmt(metrics.maxLatencyTotalMs || 0, 0)}ms`, "bad"],
  ];

  renderMetricCards("executionMetricsCards", cards);
}

function renderExecutionModes(breakdown) {
  const container = document.getElementById("executionModesCards");
  if (!container || !breakdown) return;

  const rows = [
    ["Paper", breakdown.paper],
    ["Binance Test", breakdown.binance_test],
    ["Binance Real", breakdown.binance_real],
    ["Unknown", breakdown.unknown],
  ];

  container.innerHTML = rows.map(([label, item]) => `
    <article class="metric-card tone-info">
      <div class="metric-label">${label}</div>
      <div class="metric-value rich">
        <div><strong>Total:</strong> ${item?.total ?? 0}</div>
        <div><strong>Open:</strong> ${item?.open ?? 0}</div>
        <div><strong>Closed:</strong> ${item?.closed ?? 0}</div>
        <div><strong>Wins:</strong> ${item?.wins ?? 0}</div>
        <div><strong>Losses:</strong> ${item?.losses ?? 0}</div>
        <div><strong>PnL $:</strong> ${fmt(item?.pnlUsd ?? 0)}</div>
        <div><strong>Avg PnL %:</strong> ${fmt(item?.pnlPctAvg ?? 0)}%</div>
      </div>
    </article>
  `).join("");
}

function renderCards(filteredSignals, filteredClosed, filteredExecutions, filteredOpenSignals) {
  const exchange = dashboardData?.exchange || {};
  const performance = dashboardData?.performance || {};
  const selectedCount = filteredSignals.filter((item) => item.selectedStrategy).length;
  const blockedCount = filteredSignals.length - selectedCount;
  const mlApplied = filteredSignals.filter((item) => item.metaModelApplied === true).length;
  const mlBlocked = filteredSignals.filter(
    (item) => item.metaModelApplied === true && item.metaModelPassed === false
  ).length;
  const closedExec = filteredExecutions.filter((item) => item.status === "CLOSED");
  const openPositions = Array.isArray(exchange.positions) ? exchange.positions.length : 0;
  const openOrders = Array.isArray(exchange.openOrders) ? exchange.openOrders.length : 0;

  const cards = [
    ["Open Signals", filteredOpenSignals.length, "info"],
    ["Open Positions", openPositions, "info"],
    ["Open Orders", openOrders, "info"],
    ["Signals Selected", selectedCount, selectedCount > 0 ? "good" : "neutral"],
    ["Signals Blocked", blockedCount, blockedCount > 0 ? "warn" : "neutral"],
    ["ML Applied", mlApplied, "info"],
    ["ML Blocked", mlBlocked, mlBlocked > 0 ? "warn" : "neutral"],
    ["Closed Winrate", `${fmt(closedExec.length ? (closedExec.filter((x) => Number(x.pnlPct || 0) > 0).length / closedExec.length) * 100 : 0)}%`],
    ["Avg Exec PnL", `${fmt(safeAvg(closedExec.map((x) => Number(x.pnlPct || 0))))}%`],
    ["Wallet Balance", fmt(Number(performance.walletBalance || performance.totalBalance || 0), 4)],
    ["Unrealized PnL", fmt(Number(performance.unrealizedPnl || 0), 4), Number(performance.unrealizedPnl || 0) >= 0 ? "good" : "bad"],
    ["Latest Decision", latestSignalTime(filteredSignals) ? fmtDateTime(latestSignalTime(filteredSignals)) : "-", "info"],
  ];

  renderMetricCards("cards", cards.map((item) => [item[0], item[1], item[2]]));
}

function renderExchangeReality(exchange, executionMode) {
  const container = document.getElementById("exchangeCards");
  if (!container) return;

  const metrics = dashboardData?.executionMetrics || {};
  const breakdown = dashboardData?.executionBreakdown || {};
  const perf = dashboardData?.performance || {};

  if (!exchange || exchange.error) {
    renderMetricCards("exchangeCards", [
      ["Execution Mode", executionMode || "-", "info"],
      ["Exchange", `<strong>Erro</strong><div class="muted" style="margin-top:8px;">${exchange?.error || "Sem resposta"}</div>`, "bad"],
      ["Avg Slippage", pct01(metrics.avgSlippagePct || 0), "warn"],
      ["Avg Latency", `${fmt(metrics.avgLatencyTotalMs || 0, 0)}ms`, "warn"],
    ]);
    return;
  }

  const isFutures =
    exchange?.snapshotType === "futures" ||
    perf?.snapshotType === "futures" ||
    Array.isArray(exchange?.positions);

  let cards;

  if (isFutures) {
    cards = [
      ["Execution Mode", `<span class="big compact">${executionMode || "-"}</span>`],
      ["Snapshot", "FUTURES"],
      ["Available Balance", fmt(Number(perf.availableBalance || exchange.availableBalance || 0), 6)],
      ["Wallet Balance", fmt(Number(perf.walletBalance || exchange.totalWalletBalance || 0), 6)],
      ["Margin Balance", fmt(Number(perf.marginBalance || exchange.totalMarginBalance || 0), 6)],
      ["Unrealized PnL", fmt(Number(perf.unrealizedPnl || exchange.totalUnrealizedProfit || 0), 6)],
      ["Positions", Number(perf.positionsCount || (exchange.positions || []).length || 0)],
      ["Open Orders", (exchange.openOrders || []).length],
      ["Perf Start", `$${fmt(Number(perf.startingBalance || 0), 2)}`],
      ["Perf Current", `$${fmt(Number(perf.currentBalance || 0), 2)}`],
      ["Avg Slippage", pct01(metrics.avgSlippagePct || 0)],
      ["P95 Slippage", pct01(metrics.p95SlippagePct || 0)],
      ["Avg Latency", `${fmt(metrics.avgLatencyTotalMs || 0, 0)}ms`],
      ["Real Exec", breakdown.binance_real?.total ?? 0],
    ];
  } else {
    const quoteAsset = perf.asset || "USDC";
    cards = [
      ["Execution Mode", `<span class="big compact">${executionMode || "-"}</span>`],
      ["Snapshot", "SPOT"],
      [`${quoteAsset} Free`, fmt(Number(perf.availableBalance || 0), 6)],
      [`${quoteAsset} Locked`, fmt(Number(perf.lockedBalance || 0), 6)],
      [`${quoteAsset} Total`, fmt(Number(perf.totalBalance || 0), 6)],
      ["Perf Start", `$${fmt(Number(perf.startingBalance || 0), 2)}`],
      ["Perf Current", `$${fmt(Number(perf.currentBalance || 0), 2)}`],
      ["Open Orders", (exchange.openOrders || []).length],
      ["Assets", (exchange.balances || []).length],
      ["Avg Slippage", pct01(metrics.avgSlippagePct || 0)],
      ["P95 Slippage", pct01(metrics.p95SlippagePct || 0)],
      ["Avg Latency", `${fmt(metrics.avgLatencyTotalMs || 0, 0)}ms`],
      ["Real Exec", breakdown.binance_real?.total ?? 0],
      ["Test Exec", breakdown.binance_test?.total ?? 0],
    ];
  }

  renderMetricCards("exchangeCards", cards);
}

function renderExchangeBalances(exchange) {
  const container = document.getElementById("exchangeBalances");
  if (!container) return;

  if (!exchange || exchange.error) {
    container.innerHTML = `<div class="muted">${exchange?.error || "Sem dados."}</div>`;
    return;
  }

  const isFutures =
    exchange?.snapshotType === "futures" ||
    Array.isArray(exchange?.positions);

  if (isFutures && Array.isArray(exchange.positions) && exchange.positions.length) {
    const rows = exchange.positions
      .slice(0, 25)
      .map((p) => `
        <tr>
          <td>${p.symbol || "-"}</td>
          <td>${directionPill({ direction: Number(p.positionAmt || 0) >= 0 ? "LONG" : "SHORT" })}</td>
          <td>${fmt(Number(Math.abs(Number(p.positionAmt || 0))), 6)}</td>
          <td>${fmt(Number(p.entryPrice || 0), 6)}</td>
          <td>${fmt(Number(p.markPrice || 0), 6)}</td>
          <td>${fmt(Number(p.unRealizedProfit || p.unrealizedProfit || 0), 4)}</td>
          <td>${p.leverage || "-"}</td>
        </tr>
      `).join("");

    container.innerHTML = tableWrap(`
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Direction</th>
            <th>Size</th>
            <th>Entry</th>
            <th>Mark</th>
            <th>Unrealized PnL</th>
            <th>Lev</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="7">Sem posições.</td></tr>`}</tbody>
      </table>
    `);
    return;
  }

  const rows = (exchange.balances || [])
    .slice(0, 25)
    .map((b) => `
      <tr>
        <td>${b.asset}</td>
        <td>${fmt(Number(b.free || 0), 8)}</td>
        <td>${fmt(Number(b.locked || 0), 8)}</td>
        <td>${fmt(Number(b.total || 0), 8)}</td>
      </tr>
    `).join("");

  container.innerHTML = tableWrap(`
    <table>
      <thead>
        <tr>
          <th>Asset</th>
          <th>Free</th>
          <th>Locked</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4">Sem dados.</td></tr>`}</tbody>
    </table>
  `);
}

function renderExchangeOpenOrders(exchange) {
  const container = document.getElementById("exchangeOpenOrders");
  if (!container) return;

  if (!exchange || exchange.error) {
    container.innerHTML = `<div class="muted">${exchange?.error || "Sem dados."}</div>`;
    return;
  }

  const rows = (exchange.openOrders || [])
    .slice(0, 25)
    .map((o) => `
      <tr>
        <td>${o.symbol || "-"}</td>
        <td>${o.side || o.positionSide || "-"}</td>
        <td>${o.type || "-"}</td>
        <td>${fmt(Number(o.price || 0), 8)}</td>
        <td>${fmt(Number(o.origQty || o.quantity || 0), 8)}</td>
        <td>${fmt(Number(o.executedQty || 0), 8)}</td>
        <td>${o.status || "-"}</td>
      </tr>
    `).join("");

  container.innerHTML = tableWrap(`
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Direction</th>
          <th>Type</th>
          <th>Price</th>
          <th>Orig Qty</th>
          <th>Exec Qty</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="7">Sem ordens abertas.</td></tr>`}</tbody>
    </table>
  `);
}

function renderBotControls(status) {
  const badge = document.getElementById("botStatusBadge");
  const startBtn = document.getElementById("botStartBtn");
  const stopBtn = document.getElementById("botStopBtn");
  const resetBtn = document.getElementById("botResetBtn");

  if (!badge || !startBtn || !stopBtn || !resetBtn) return;

  const running = Boolean(status?.running);
  const runningCount = Number(status?.runningCount || 0);
  const processCount = Number(status?.processCount || 0);

  badge.textContent = running
    ? `BOT: RUNNING (${runningCount}/${processCount})`
    : "BOT: STOPPED";

  badge.className = `status-chip ${running ? "running" : "stopped"}`;

  startBtn.disabled = running;
  stopBtn.disabled = !running;
  resetBtn.disabled = running;
}

function renderFilterSummary(filteredSignals, filteredClosed, filteredExecutions) {
  const classes = {
    EXECUTABLE: 0,
    WATCH: 0,
    BLOCKED: 0,
    IGNORE: 0,
  };

  const regimes = {
    TREND: 0,
    RANGE: 0,
    NEUTRAL: 0,
  };

  for (const s of filteredSignals) {
    const cls = String(s.signalClass || "IGNORE").toUpperCase();
    if (classes[cls] !== undefined) classes[cls]++;
    regimes[getRegime(s)]++;
  }

  const closedExec = filteredExecutions.filter((x) => x.status === "CLOSED");
  const wins = closedExec.filter((x) => Number(x.pnlPct || 0) > 0).length;
  const losses = closedExec.filter((x) => Number(x.pnlPct || 0) < 0).length;
  const totalClosed = closedExec.length;
  const winrate = totalClosed ? (wins / totalClosed) * 100 : 0;

  const avgScore = safeAvg(filteredSignals.map((x) => Number(x.score)));
  const avgAtrPct = safeAvg(filteredSignals.map((x) => Number(x.atrPct || 0))) * 100;
  const avgSepPct = safeAvg(filteredSignals.map((x) => Number(x.emaSeparationPct || 0))) * 100;
  const avgSlopePct = safeAvg(filteredSignals.map((x) => Number(x.emaSlopePct || 0))) * 100;
  const avgAdx = safeAvg(filteredSignals.map((x) => Number(x.adx || 0)));
  const avgPnl = safeAvg(filteredClosed.map((x) => Number(x.pnlPct)));
  const avgExecPnl = safeAvg(closedExec.map((x) => Number(x.pnlPct || 0)));
  const avgRR = safeAvg(filteredClosed.map((x) => Number(x.rrRealized)));
  const openExec = filteredExecutions.filter((x) => x.status === "OPEN").length;

  const modeCounts = {
    paper: filteredExecutions.filter((x) => x.mode === "paper").length,
    binance_test: filteredExecutions.filter((x) => x.mode === "binance_test").length,
    binance_real: filteredExecutions.filter((x) => x.mode === "binance_real").length,
  };

  const symbolsInView = Array.from(new Set(filteredSignals.map((x) => x.symbol).filter(Boolean)));
  const rulesHtml = symbolsInView.length
    ? symbolsInView.map((symbol) => `
        <div class="stat-box">
          <div class="label">${symbol} rules</div>
          <div class="value" style="font-size:14px;">${formatSymbolRules(symbol)}</div>
        </div>
      `).join("")
    : "";

  const metrics = dashboardData?.executionMetrics || {};

  document.getElementById("filterSummary").innerHTML = `
    <div class="stats-list">
      <div class="stat-box"><div class="label">Signals filtrados</div><div class="value">${filteredSignals.length}</div></div>
      <div class="stat-box"><div class="label">Closed filtrados</div><div class="value">${filteredClosed.length}</div></div>
      <div class="stat-box"><div class="label">Executions OPEN</div><div class="value">${openExec}</div></div>
      <div class="stat-box"><div class="label">Closed Exec</div><div class="value">${totalClosed}</div></div>
      <div class="stat-box"><div class="label">Winrate</div><div class="value">${fmt(winrate)}%</div></div>
      <div class="stat-box"><div class="label">Avg Score</div><div class="value">${fmt(avgScore)}</div></div>
      <div class="stat-box"><div class="label">Avg Closed PnL %</div><div class="value">${fmt(avgPnl)}%</div></div>
      <div class="stat-box"><div class="label">Avg Exec PnL %</div><div class="value">${fmt(avgExecPnl)}%</div></div>
      <div class="stat-box"><div class="label">Avg RR</div><div class="value">${fmt(avgRR)}</div></div>
      <div class="stat-box"><div class="label">Avg ATR %</div><div class="value">${fmt(avgAtrPct)}%</div></div>
      <div class="stat-box"><div class="label">Avg EMA Sep %</div><div class="value">${fmt(avgSepPct)}%</div></div>
      <div class="stat-box"><div class="label">Avg EMA Slope %</div><div class="value">${fmt(avgSlopePct)}%</div></div>
      <div class="stat-box"><div class="label">Avg ADX</div><div class="value">${fmt(avgAdx)}</div></div>
      <div class="stat-box"><div class="label">EXEC / WATCH / BLOCKED / IGNORE</div><div class="value">${classes.EXECUTABLE} / ${classes.WATCH} / ${classes.BLOCKED} / ${classes.IGNORE}</div></div>
      <div class="stat-box"><div class="label">TREND / RANGE / NEUTRAL</div><div class="value">${regimes.TREND} / ${regimes.RANGE} / ${regimes.NEUTRAL}</div></div>
      <div class="stat-box"><div class="label">Paper / Test / Real</div><div class="value">${modeCounts.paper} / ${modeCounts.binance_test} / ${modeCounts.binance_real}</div></div>
      <div class="stat-box"><div class="label">Avg Slippage</div><div class="value">${pct01(metrics.avgSlippagePct || 0)}</div></div>
      <div class="stat-box"><div class="label">P95 Slippage</div><div class="value">${pct01(metrics.p95SlippagePct || 0)}</div></div>
      <div class="stat-box"><div class="label">Avg Latency</div><div class="value">${fmt(metrics.avgLatencyTotalMs || 0, 0)}ms</div></div>
      <div class="stat-box"><div class="label">P95 Latency</div><div class="value">${fmt(metrics.p95LatencyTotalMs || 0, 0)}ms</div></div>
      ${rulesHtml}
    </div>
  `;
}

function renderDecisionBoard(filteredSignals, filteredClosed, filteredExecutions) {
  const container = document.getElementById("decisionBoard");
  if (!container) return;

  const latest = filteredSignals.slice(-6).reverse();
  const selectedSignals = filteredSignals.filter((item) => item.selectedStrategy);
  const blockedSignals = filteredSignals.filter((item) => !item.selectedStrategy);
  const mlApplied = filteredSignals.filter((item) => item.metaModelApplied === true);
  const mlRejected = mlApplied.filter((item) => item.metaModelPassed === false);
  const topReasons = topEntries(countBy(blockedSignals, (item) => extractRootReason(item.decisionReason)), 6);
  const topStrategies = topEntries(
    countBy(selectedSignals, (item) => item.selectedStrategy || item.strategy || null),
    5
  );
  const recentClosed = filteredClosed.slice(-12);
  const recentClosedWinrate = recentClosed.length
    ? (recentClosed.filter((item) => Number(item.pnlPct || 0) > 0).length / recentClosed.length) * 100
    : 0;
  const recentExecLatency = safeAvg(
    (dashboardData?.executionMetrics?.recent || []).map((item) => Number(item.latencyTotal))
  );

  container.innerHTML = `
    <div class="decision-board">
      <div class="decision-grid">
        <article class="decision-card focus">
          <div class="eyebrow">Flow</div>
          <h3>Funil recente</h3>
          <p class="decision-copy">
            ${selectedSignals.length} setups escolhidos, ${blockedSignals.length} bloqueados e
            ${mlRejected.length} recusados pela camada de ML no recorte atual.
          </p>
          <div class="chip-row">
            <span class="reason-chip"><strong>${selectedSignals.length}</strong> selecionados</span>
            <span class="reason-chip"><strong>${blockedSignals.length}</strong> bloqueados</span>
            <span class="reason-chip"><strong>${mlApplied.length}</strong> com ML</span>
            <span class="reason-chip"><strong>${mlRejected.length}</strong> ML block</span>
          </div>
        </article>

        <article class="decision-card ${recentClosedWinrate >= 50 ? "good" : "warn"}">
          <div class="eyebrow">Pulse</div>
          <h3>Qualidade operacional</h3>
          <p class="decision-copy">
            Últimos ${recentClosed.length || 0} fechados com winrate de ${fmt(recentClosedWinrate)}%
            e latência média recente de ${fmt(recentExecLatency || 0, 0)}ms.
          </p>
          <div class="chip-row">
            <span class="reason-chip"><strong>${fmt(safeAvg(recentClosed.map((item) => Number(item.pnlPct || 0))))}%</strong> avg pnl</span>
            <span class="reason-chip"><strong>${fmt(safeAvg(recentClosed.map((item) => Number(item.rrRealized || 0))))}</strong> avg rr</span>
          </div>
        </article>
      </div>

      <div class="decision-grid">
        <article class="decision-card">
          <div class="eyebrow">Latest Decisions</div>
          <h3>Últimos sinais avaliados</h3>
          <div class="decision-list">
            ${
              latest.length
                ? latest
                    .map(
                      (item) => `
                        <div class="decision-item">
                          <div class="decision-item-top">
                            <div class="decision-item-title">${item.symbol || "-"} ${item.tf || "-"}</div>
                            <div>${clsPill(item.signalClass)} ${regimePill(item)} ${metaModelPill(item)}</div>
                          </div>
                          <div class="decision-item-bottom">
                            <div class="decision-reason">
                              <strong>${item.selectedStrategy || "Sem seleção"}</strong>
                              ${item.selectedDirection ? `· ${item.selectedDirection}` : ""}
                              ${typeof item.score === "number" ? `· score ${fmt(Number(item.score || 0), 0)}` : ""}
                            </div>
                            <div class="decision-reason">${fmtDateTime(item.ts || item.signalTs)}</div>
                          </div>
                          <div class="decision-reason">${item.decisionReason || "-"}</div>
                        </div>
                      `
                    )
                    .join("")
                : `<div class="empty-state">Sem sinais recentes.</div>`
            }
          </div>
        </article>

        <article class="decision-card">
          <div class="eyebrow">Dominant Patterns</div>
          <h3>Razões e estratégias</h3>
          <p class="decision-copy">
            O lado esquerdo mostra o que mais bloqueia o motor. O lado direito mostra o que mais
            está a conseguir passar o funil.
          </p>
          <div class="chip-row">
            ${
              topReasons.length
                ? topReasons
                    .map(
                      ([reason, count]) =>
                        `<span class="reason-chip"><strong>${count}</strong> ${reason}</span>`
                    )
                    .join("")
                : `<span class="reason-chip"><strong>0</strong> Sem bloqueios no recorte</span>`
            }
          </div>
          <div class="chip-row">
            ${
              topStrategies.length
                ? topStrategies
                    .map(
                      ([strategy, count]) =>
                        `<span class="reason-chip"><strong>${count}</strong> ${strategy}</span>`
                    )
                    .join("")
                : `<span class="reason-chip"><strong>0</strong> Sem estratégias selecionadas</span>`
            }
          </div>
        </article>
      </div>
    </div>
  `;
}

function renderLiveFocus(filteredOpenSignals, filteredExecutions) {
  const container = document.getElementById("liveFocus");
  if (!container) return;

  const openSignal = filteredOpenSignals[0] || dashboardData?.raw?.openSignals?.[0] || null;
  const openExecution =
    filteredExecutions.find((item) => item.status === "OPEN") ||
    (dashboardData?.raw?.executions || []).find((item) => item.status === "OPEN") ||
    null;
  const livePosition = Array.isArray(dashboardData?.exchange?.positions)
    ? dashboardData.exchange.positions[0] || null
    : null;
  const liveOrderCount = Array.isArray(dashboardData?.exchange?.openOrders)
    ? dashboardData.exchange.openOrders.length
    : 0;

  if (!openSignal && !openExecution && !livePosition) {
    container.innerHTML = `<div class="empty-state">Sem exposição aberta neste momento.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="focus-stack">
      <article class="focus-panel">
        <div class="eyebrow">Signal</div>
        <h3>${openSignal?.symbol || openExecution?.symbol || livePosition?.symbol || "-"}</h3>
        <div class="focus-grid">
          <div class="focus-stat">
            <div class="label">Estratégia</div>
            <div class="value">${openSignal?.strategy || openExecution?.strategy || "-"}</div>
          </div>
          <div class="focus-stat">
            <div class="label">Direção</div>
            <div class="value">${directionPill(openSignal || openExecution || { direction: Number(livePosition?.positionAmt || 0) >= 0 ? "LONG" : "SHORT" })}</div>
          </div>
          <div class="focus-stat">
            <div class="label">Entry / SL / TP</div>
            <div class="value">${fmt(Number(openSignal?.entry ?? openExecution?.entry), 6)} / ${fmt(Number(openSignal?.sl ?? openExecution?.sl), 6)} / ${fmt(Number(openSignal?.tp ?? openExecution?.tp), 6)}</div>
          </div>
          <div class="focus-stat">
            <div class="label">Score / Class</div>
            <div class="value">${fmt(Number(openSignal?.score || openExecution?.score || 0), 0)} · ${openSignal?.signalClass || "-"}</div>
          </div>
        </div>
      </article>

      <article class="focus-panel">
        <div class="eyebrow">Exchange</div>
        <h3>Realidade de mercado</h3>
        <div class="focus-grid">
          <div class="focus-stat">
            <div class="label">Mark / Unrealized</div>
            <div class="value">${fmt(Number(livePosition?.markPrice || 0), 6)} / ${fmt(Number(livePosition?.unRealizedProfit || livePosition?.unrealizedProfit || 0), 4)}</div>
          </div>
          <div class="focus-stat">
            <div class="label">Size / Lev</div>
            <div class="value">${fmt(Math.abs(Number(livePosition?.positionAmt || openExecution?.quantity || 0)), 6)} / ${livePosition?.leverage || openExecution?.leverage || "-"}</div>
          </div>
          <div class="focus-stat">
            <div class="label">Open Orders</div>
            <div class="value">${liveOrderCount}</div>
          </div>
          <div class="focus-stat">
            <div class="label">ML Gate</div>
            <div class="value">${metaModelPill(openSignal || openExecution || {})}</div>
          </div>
        </div>
      </article>
    </div>
  `;
}

function renderBySymbol(closedSignals) {
  const bySymbol = {};

  for (const t of closedSignals) {
    const key = `${t.symbol || "UNKNOWN"}_${t.tf || "?"}`;
    if (!bySymbol[key]) {
      bySymbol[key] = { trades: 0, tp: 0, sl: 0, pnl: 0 };
    }
    bySymbol[key].trades++;
    if (t.outcome === "TP") bySymbol[key].tp++;
    if (t.outcome === "SL") bySymbol[key].sl++;
    bySymbol[key].pnl += Number(t.pnlPct || 0);
  }

  const rows = Object.entries(bySymbol).map(([key, val]) => {
    const wr = val.trades ? (val.tp / val.trades) * 100 : 0;
    const avgPnl = val.trades ? val.pnl / val.trades : 0;
    const symbol = key.split("_")[0];

    return `
      <tr>
        <td>${key}</td>
        <td>${val.trades}</td>
        <td>${val.tp}</td>
        <td>${val.sl}</td>
        <td>${fmt(wr)}%</td>
        <td>${fmt(avgPnl)}%</td>
        <td class="mono">${formatSymbolRules(symbol)}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("bySymbol").innerHTML = tableWrap(`
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Trades</th>
          <th>TP</th>
          <th>SL</th>
          <th>Winrate</th>
          <th>Avg PnL %</th>
          <th>Rules</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="7">Sem dados.</td></tr>`}</tbody>
    </table>
  `);
}

function renderByScore(signals) {
  const topReasons = topEntries(
    countBy(signals.filter((item) => !item.selectedStrategy), (item) =>
      extractRootReason(item.decisionReason)
    ),
    12
  );

  const rows = topReasons
    .map(
      ([reason, count]) => `
        <tr>
          <td>${reason}</td>
          <td>${count}</td>
          <td>${fmt(
            safeAvg(
              signals
                .filter((item) => extractRootReason(item.decisionReason) === reason)
                .map((item) => Number(item.adx || 0))
            ),
            2
          )}</td>
          <td>${fmt(
            safeAvg(
              signals
                .filter((item) => extractRootReason(item.decisionReason) === reason)
                .map((item) => Number(item.score || 0))
            ),
            0
          )}</td>
        </tr>
      `
    )
    .join("");

  document.getElementById("byScore").innerHTML = tableWrap(`
    <table>
      <thead>
        <tr>
          <th>Razão</th>
          <th>Ocorrências</th>
          <th>ADX Médio</th>
          <th>Score Médio</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4">Sem bloqueios no recorte atual.</td></tr>`}</tbody>
    </table>
  `);
}

function renderOpenSignals(openSignals) {
  const rows = openSignals.map((s) => `
    <tr>
      <td>${s.symbol || "-"}</td>
      <td>${s.tf || "-"}</td>
      <td>${s.strategy || "-"}</td>
      <td>${directionPill(s)}</td>
      <td>${fmt(s.entry)}</td>
      <td>${fmt(s.sl)}</td>
      <td>${fmt(s.tp)}</td>
      <td>${fmt(Number(s.score || 0), 0)}</td>
      <td>${fmt(Number(s.adx || 0), 2)}</td>
      <td>${regimePill(s)}</td>
      <td>${clsPill(s.signalClass)}</td>
      <td>${metaModelPill(s)}</td>
      <td class="mono">${formatSymbolRules(s.symbol)}</td>
    </tr>
  `).join("");

  document.getElementById("openSignals").innerHTML = tableWrap(`
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>TF</th>
          <th>Strategy</th>
          <th>Direction</th>
          <th>Entry</th>
          <th>SL</th>
          <th>TP</th>
          <th>Score</th>
          <th>ADX</th>
          <th>Regime</th>
          <th>Class</th>
          <th>ML</th>
          <th>Rules</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="13">Sem open signals.</td></tr>`}</tbody>
    </table>
  `);
}

function renderRecentExecutions(recentExecutions) {
  const cards = recentExecutions.map((e) => {
    const actionBtn =
      e.status === "OPEN"
        ? `<button class="sell-btn" onclick="marketCloseNow('${String(e.id || "")}', '${String(e.symbol || "")}', '${displayDirection(e)}')">Close Now</button>`
        : `<span class="muted">-</span>`;

    const ts = executionTimestamp(e);
    const notional = Number(e.tradeUsd || e.positionUsd || 0);
    const exitPrice = Number(e.exitPrice);
    const pnlPct = Number.isFinite(Number(e.pnlPct))
      ? `${fmt(Number(e.pnlPct))}%`
      : "-";

    return `
      <div class="execution-card">

        <div class="execution-row execution-row-top">
          <div class="exec-item exec-item-symbol">
            <span class="exec-label">Symbol</span>
            <span class="exec-value">${e.symbol || "-"}</span>
          </div>

          <div class="exec-item exec-item-small">
            <span class="exec-label">TF</span>
            <span class="exec-value">${e.tf || "-"}</span>
          </div>

          <div class="exec-item">
            <span class="exec-label">Mode</span>
            <span class="exec-value">${modePill(e.mode)}</span>
          </div>

          <div class="exec-item">
            <span class="exec-label">Side</span>
            <span class="exec-value">${directionPill(e)}</span>
          </div>

          <div class="exec-item">
            <span class="exec-label">Status</span>
            <span class="exec-value">${statusPill(e.status)}</span>
          </div>

          <div class="exec-item">
            <span class="exec-label">Fecho</span>
            <span class="exec-value">${outcomePill(executionOutcome(e))}</span>
          </div>

          <div class="exec-item exec-item-action">
            <span class="exec-label">Action</span>
            <span class="exec-value">${actionBtn}</span>
          </div>
        </div>

        <div class="execution-row execution-row-mid">
          <div class="exec-item">
            <span class="exec-label">Entry</span>
            <span class="exec-value">${fmt(e.entry)}</span>
          </div>

          <div class="exec-item">
            <span class="exec-label">SL</span>
            <span class="exec-value">${fmt(e.sl)}</span>
          </div>

          <div class="exec-item">
            <span class="exec-label">TP</span>
            <span class="exec-value">${fmt(e.tp)}</span>
          </div>

          <div class="exec-item">
            <span class="exec-label">Qty</span>
            <span class="exec-value">${fmt(Number(e.quantity), 6)}</span>
          </div>

          <div class="exec-item">
            <span class="exec-label">Notional</span>
            <span class="exec-value">${fmt(notional, 2)}</span>
          </div>

          <div class="exec-item">
            <span class="exec-label">Score</span>
            <span class="exec-value">${fmt(Number(e.score || 0), 0)}</span>
          </div>

          <div class="exec-item">
            <span class="exec-label">PnL %</span>
            <span class="exec-value">${pnlPct}</span>
          </div>
        </div>

        <div class="execution-row execution-row-bottom">
          <div class="exec-item exec-item-time">
            <span class="exec-label">Time</span>
            <span class="exec-value">${fmtDateTime(ts)}</span>
          </div>

          <div class="exec-item">
            <span class="exec-label">Exit</span>
            <span class="exec-value">${
              Number.isFinite(exitPrice) && exitPrice > 0
                ? fmt(exitPrice, 6)
                : "-"
            }</span>
          </div>
        </div>

      </div>
    `;
  }).join("");

  document.getElementById("recentExecutions").innerHTML = `
    <div class="executions-list">
      ${cards || `<div class="empty-state">Sem executions.</div>`}
    </div>
  `;
}

async function marketCloseNow(executionId, symbol, direction = "-") {
  const ok = window.confirm(
    `Fechar ${symbol || "posição"} ${direction && direction !== "-" ? `(${direction})` : ""} ao mercado agora?`
  );

  if (!ok) return;

  try {
    const res = await fetch("/api/market-close", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ executionId }),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
      alert(`Erro ao fechar posição: ${data.error || data.reason || "unknown_error"}`);
      return;
    }

    alert(
      `Posição fechada.
` +
      `Símbolo: ${data.symbol || symbol || "-"}
` +
      `Direção: ${data.direction || direction || "-"}
` +
      `Exit: ${fmt(Number(data.exitPrice || 0), 6)}
` +
      `PnL: ${fmt(Number(data.pnlPct || 0), 2)}%`
    );

    await load();
  } catch (err) {
    alert(`Erro ao fechar posição: ${err.message}`);
  }
}

async function botAction(action) {
  let endpoint = null;
  let confirmText = null;

  if (action === "start") {
    endpoint = "/api/bot/start";
  } else if (action === "stop") {
    endpoint = "/api/bot/stop";
    confirmText = "Parar o bot agora?";
  } else if (action === "reset") {
    endpoint = "/api/history/reset";
    confirmText =
      "Isto vai limpar state.json, execution-metrics.json, orders-log.json, adaptive-history.json e os ficheiros consolidados. Continuar?";
  }

  if (!endpoint) return;

  if (confirmText && !window.confirm(confirmText)) {
    return;
  }

  try {
    const res = await fetch(endpoint, { method: "POST" });
    const data = await res.json();

    if (!res.ok || data.ok === false) {
      alert(data.error || "Erro na operação.");
      return;
    }

    if (action === "start") {
      alert(data.alreadyRunning ? "O bot já estava a correr." : "Bot arrancado.");
    } else if (action === "stop") {
      alert("Bot parado.");
    } else if (action === "reset") {
      alert("Histórico limpo.");
    }

    await load();
  } catch (err) {
    alert(`Erro: ${err.message}`);
  }
}

function renderRecentClosed(recentClosed) {
  const rows = recentClosed.map((t) => `
    <tr>
      <td>${t.symbol || "-"}</td>
      <td>${t.tf || "-"}</td>
      <td>${fmt(t.entry)}</td>
      <td>${fmt(Number(t.exitRef || 0), 6)}</td>
      <td>${outcomePill(t.outcome)}</td>
      <td>${fmt(Number(t.rsi))}</td>
      <td>${fmt(Number(t.atr))}</td>
      <td>${fmt(Number(t.adx || 0), 2)}</td>
      <td>${fmt(Number(t.barsOpen), 0)}</td>
      <td>${fmt(Number(t.pnlPct))}</td>
      <td>${fmt(Number(t.rrRealized))}</td>
      <td>${regimePill(t)}</td>
    </tr>
  `).join("");

  document.getElementById("recentClosed").innerHTML = tableWrap(`
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>TF</th>
          <th>Entry</th>
          <th>Exit Ref</th>
          <th>Outcome</th>
          <th>RSI</th>
          <th>ATR</th>
          <th>ADX</th>
          <th>Bars</th>
          <th>PnL %</th>
          <th>RR</th>
          <th>Regime</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="12">Sem closed signals.</td></tr>`}</tbody>
    </table>
  `);
}

function renderRecentSignals(recentSignals) {
  const rows = recentSignals.map((s) => `
    <tr>
      <td>${new Date(s.ts).toLocaleString()}</td>
      <td>${s.symbol || "-"}</td>
      <td>${s.tf || "-"}</td>
      <td>${s.selectedStrategy || "-"}</td>
      <td>${directionPill({ direction: s.selectedDirection || s.direction || "-" })}</td>
      <td>${fmt(Number(s.price))}</td>
      <td>${fmt(Number(s.score || 0), 0)}</td>
      <td>${clsPill(s.signalClass)}</td>
      <td>${regimePill(s)}</td>
      <td>${metaModelPill(s)}</td>
      <td class="mono">${s.decisionReason || "-"}</td>
      <td class="mono">
        bullish=${s.bullish} |
        bullishFast=${s.bullishFast} |
        stackedEma=${s.stackedEma} |
        nearEma20=${s.nearEma20} |
        nearEma50=${s.nearEma50} |
        nearPullback=${s.nearPullback} |
        rsiInBand=${s.rsiInBand} |
        rsiRising=${s.rsiRising} |
        isTrend=${s.isTrend} |
        isRange=${s.isRange} |
        adx=${fmt(Number(s.adx || 0), 2)} |
        emaSep=${pct01(Number(s.emaSeparationPct || 0))} |
        emaSlope=${pct01(Number(s.emaSlopePct || 0))} |
        atrPct=${pct01(Number(s.atrPct || 0))}
      </td>
      <td class="mono">${formatSymbolRules(s.symbol)}</td>
    </tr>
  `).join("");

  document.getElementById("recentSignals").innerHTML = tableWrap(`
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Symbol</th>
          <th>TF</th>
          <th>Strategy</th>
          <th>Direction</th>
          <th>Price</th>
          <th>Score</th>
          <th>Class</th>
          <th>Regime</th>
          <th>ML</th>
          <th>Decision</th>
          <th>Flags</th>
          <th>Rules</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="12">Sem signal log.</td></tr>`}</tbody>
    </table>
  `);
}

function destroyChart(name) {
  if (charts[name]) {
    charts[name].destroy();
    delete charts[name];
  }
}

function renderCharts(filteredSignals, filteredClosed) {
  const classCounts = { EXECUTABLE: 0, WATCH: 0, IGNORE: 0 };
  const regimeCounts = { TREND: 0, RANGE: 0, NEUTRAL: 0 };

  for (const s of filteredSignals) {
    const cls = String(s.signalClass || "IGNORE").toUpperCase();
    if (classCounts[cls] !== undefined) classCounts[cls]++;
    regimeCounts[getRegime(s)]++;
  }

  const scoreBuckets = { "0-24": 0, "25-49": 0, "50-74": 0, "75-100": 0 };
  for (const s of filteredSignals) {
    const score = Number(s.score || 0);
    if (score >= 75) scoreBuckets["75-100"]++;
    else if (score >= 50) scoreBuckets["50-74"]++;
    else if (score >= 25) scoreBuckets["25-49"]++;
    else scoreBuckets["0-24"]++;
  }

  const pnlBySymbol = {};
  for (const c of filteredClosed) {
    const key = c.symbol || "UNKNOWN";
    if (!pnlBySymbol[key]) pnlBySymbol[key] = [];
    pnlBySymbol[key].push(Number(c.pnlPct || 0));
  }

  const pnlLabels = Object.keys(pnlBySymbol);
  const pnlValues = pnlLabels.map((k) => safeAvg(pnlBySymbol[k]));

  destroyChart("classChart");
  charts.classChart = new Chart(document.getElementById("classChart"), {
    type: "bar",
    data: {
      labels: Object.keys(classCounts),
      datasets: [{
        label: "Signals",
        data: Object.values(classCounts),
        backgroundColor: ["#4fb6ff", "#ffb86c", "#5b6b7c"],
        borderRadius: 10,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });

  destroyChart("regimeChart");
  charts.regimeChart = new Chart(document.getElementById("regimeChart"), {
    type: "doughnut",
    data: {
      labels: Object.keys(regimeCounts),
      datasets: [{
        data: Object.values(regimeCounts),
        backgroundColor: ["#6ae2a1", "#ffb86c", "#4f6175"],
        borderWidth: 0,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  destroyChart("scoreChart");
  charts.scoreChart = new Chart(document.getElementById("scoreChart"), {
    type: "bar",
    data: {
      labels: Object.keys(scoreBuckets),
      datasets: [{
        label: "Signals",
        data: Object.values(scoreBuckets),
        backgroundColor: "#4fb6ff",
        borderRadius: 10,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });

  destroyChart("symbolPnlChart");
  charts.symbolPnlChart = new Chart(document.getElementById("symbolPnlChart"), {
    type: "bar",
    data: {
      labels: pnlLabels.length ? pnlLabels : ["Sem dados"],
      datasets: [{
        label: "Avg PnL %",
        data: pnlLabels.length ? pnlValues : [0],
        backgroundColor: pnlLabels.length
          ? pnlValues.map((v) => (v >= 0 ? "#6ae2a1" : "#ff7e7e"))
          : ["#4f6175"],
        borderRadius: 10,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
}

function renderTradingView(symbol) {
  const container = document.getElementById("tvChart");
  container.innerHTML = `<div id="tvWidgetInner" style="height:420px;"></div>`;

  if (!window.TradingView || !symbol) return;

  new window.TradingView.widget({
    autosize: true,
    symbol,
    interval: "1",
    timezone: "Europe/Lisbon",
    theme: "dark",
    style: "1",
    locale: "pt_PT",
    enable_publishing: false,
    hide_top_toolbar: false,
    hide_legend: false,
    allow_symbol_change: true,
    container_id: "tvWidgetInner",
  });
}

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.tab;

      buttons.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");

      const panel = document.getElementById(targetId);
      if (panel) {
        panel.classList.add("active");
      }
    });
  });
}

function applyFiltersAndRender() {
  if (!dashboardData) return;

  const filters = getFilters();

  const signalLog = getLastN(dashboardData.raw.signalLog, filters.lookback);
  const closedSignals = getLastN(dashboardData.raw.closedSignals, filters.lookback);
  const executions = getLastN(dashboardData.raw.executions, filters.lookback);
  const openSignals = dashboardData.raw.openSignals || [];

  const filteredSignals = filterItems(signalLog, filters);
  const filteredClosed = filterItems(closedSignals, filters);
  const filteredExecutions = filterItems(executions, filters);
  const filteredOpenSignals = filterItems(openSignals, filters);

  renderCards(filteredSignals, filteredClosed, filteredExecutions, filteredOpenSignals);
  renderDecisionBoard(filteredSignals, filteredClosed, filteredExecutions);
  renderLiveFocus(filteredOpenSignals, filteredExecutions);
  renderPerformance(dashboardData.performance);
  renderExecutionMetrics(dashboardData.executionMetrics);
  renderExecutionModes(dashboardData.executionBreakdown);
  renderExchangeReality(dashboardData.exchange, dashboardData.executionMode);
  renderExchangeBalances(dashboardData.exchange);
  renderExchangeOpenOrders(dashboardData.exchange);
  renderBotControls(dashboardData.botStatus);
  renderFilterSummary(filteredSignals, filteredClosed, filteredExecutions);
  renderBySymbol(filteredClosed);
  renderByScore(filteredSignals);
  renderOpenSignals(filteredOpenSignals);
  renderRecentExecutions(filteredExecutions.slice(-HISTORY_TABLE_LIMIT).reverse());
  renderRecentClosed(filteredClosed.slice(-HISTORY_TABLE_LIMIT).reverse());
  renderRecentSignals(filteredSignals.slice(-HISTORY_TABLE_LIMIT).reverse());
  renderCharts(filteredSignals, filteredClosed);
}

async function load() {
  const res = await fetch("/api/state");
  dashboardData = await res.json();

  document.getElementById("meta").textContent =
    `Updated: ${new Date(dashboardData.generatedAt).toLocaleString()} | Mode: ${dashboardData.executionMode || "-"}`;

  populateSelect("symbolFilter", dashboardData.allSymbols || []);
  populateSelect("tfFilter", dashboardData.allTimeframes || []);
  populateTvSymbols(dashboardData.allSymbols || ["BTCUSDC"]);

  if (!document.getElementById("tvSymbol").dataset.bound) {
    document.getElementById("tvSymbol").addEventListener("change", (e) => {
      tvWidgetSymbol = e.target.value;
      renderTradingView(tvWidgetSymbol);
    });
    document.getElementById("tvSymbol").dataset.bound = "1";
  }

  applyFiltersAndRender();
  renderTradingView(document.getElementById("tvSymbol").value || tvWidgetSymbol);
}

function bindEvents() {
  ["symbolFilter", "tfFilter", "classFilter", "regimeFilter", "lookbackFilter"].forEach((id) => {
    document.getElementById(id).addEventListener("change", applyFiltersAndRender);
  });

  document.getElementById("refreshBtn").addEventListener("click", load);

  const startBtn = document.getElementById("botStartBtn");
  const stopBtn = document.getElementById("botStopBtn");
  const resetBtn = document.getElementById("botResetBtn");

  if (startBtn) startBtn.addEventListener("click", () => botAction("start"));
  if (stopBtn) stopBtn.addEventListener("click", () => botAction("stop"));
  if (resetBtn) resetBtn.addEventListener("click", () => botAction("reset"));
}

bindEvents();
initTabs();
load();
setInterval(load, 5000);
