let dashboardData = null;
let charts = {};
let tvWidgetSymbol = "BINANCE:BTCUSDC";
const HISTORY_TABLE_LIMIT = 25;

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

function clsPill(cls) {
  const c = String(cls || "IGNORE").toLowerCase();
  if (c === "executable") return `<span class="pill exec">EXECUTABLE</span>`;
  if (c === "watch") return `<span class="pill watch">WATCH</span>`;
  return `<span class="pill ignore">IGNORE</span>`;
}

function outcomePill(outcome) {
  if (outcome === "TP") return `<span class="pill tp">TP</span>`;
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
  const container = document.getElementById("performanceCards");
  if (!container || !perf) return;

  const cards = [
    ["Starting Balance", `$${fmt(perf.startingBalance)}`],
    ["Current Balance", `$${fmt(perf.currentBalance)}`],
    ["Peak Balance", `$${fmt(perf.peakBalance)}`],
    ["Realized PnL $", `$${fmt(perf.realizedPnlUsd)}`],
    ["Realized PnL %", pct(perf.realizedPnlPct)],
    ["Max Drawdown", pct(perf.maxDrawdownPct)],
    ["Closed Trades", perf.closedCount],
    ["Wins", perf.winCount],
    ["Losses", perf.lossCount],
    ["Winrate", pct(perf.winRate)]
  ];

  container.innerHTML = cards.map(([label, value]) => `
    <div class="card">
      <div class="muted">${label}</div>
      <div class="big">${value}</div>
    </div>
  `).join("");
}

function renderExecutionMetrics(metrics) {
  const container = document.getElementById("executionMetricsCards");
  if (!container || !metrics) return;

  const cards = [
    ["Metrics Count", metrics.count ?? 0],
    ["Avg Slippage", pct01(metrics.avgSlippagePct || 0)],
    ["P95 Slippage", pct01(metrics.p95SlippagePct || 0)],
    ["Max Slippage", pct01(metrics.maxSlippagePct || 0)],
    ["Avg Internal", `${fmt(metrics.avgLatencyInternalMs || 0, 0)}ms`],
    ["Avg Exchange", `${fmt(metrics.avgLatencyExchangeMs || 0, 0)}ms`],
    ["Avg Total", `${fmt(metrics.avgLatencyTotalMs || 0, 0)}ms`],
    ["P95 Total", `${fmt(metrics.p95LatencyTotalMs || 0, 0)}ms`],
    ["Max Total", `${fmt(metrics.maxLatencyTotalMs || 0, 0)}ms`],
  ];

  container.innerHTML = cards.map(([label, value]) => `
    <div class="card">
      <div class="muted">${label}</div>
      <div class="big">${value}</div>
    </div>
  `).join("");
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
    <div class="card">
      <div class="muted">${label}</div>
      <div style="display:grid; gap:8px;">
        <div><strong>Total:</strong> ${item?.total ?? 0}</div>
        <div><strong>Open:</strong> ${item?.open ?? 0}</div>
        <div><strong>Closed:</strong> ${item?.closed ?? 0}</div>
        <div><strong>Wins:</strong> ${item?.wins ?? 0}</div>
        <div><strong>Losses:</strong> ${item?.losses ?? 0}</div>
        <div><strong>PnL $:</strong> ${fmt(item?.pnlUsd ?? 0)}</div>
        <div><strong>Avg PnL %:</strong> ${fmt(item?.pnlPctAvg ?? 0)}%</div>
      </div>
    </div>
  `).join("");
}

function renderCards(stats) {
  const breakdown = dashboardData?.executionBreakdown || {};

  const cards = [
    ["Open Signals", stats.openSignals],
    ["Closed Trades", stats.closedSignals],
    ["Signal Log", stats.signalLog],
    ["Executions", stats.executions],
    ["Open Exec", stats.openExecutions],
    ["Closed Exec", stats.closedExecutions],
    ["Wins", stats.wins],
    ["Losses", stats.losses],
    ["Winrate", `${fmt(stats.winrate)}%`],
    ["Trend Signals", stats.trendSignals],
    ["Range Signals", stats.rangeSignals],
    ["Neutral Signals", stats.neutralSignals],
    ["Paper Exec", breakdown.paper?.total ?? 0],
    ["Test Exec", breakdown.binance_test?.total ?? 0],
    ["Real Exec", breakdown.binance_real?.total ?? 0],
  ];

  document.getElementById("cards").innerHTML = cards.map(([label, value]) => `
    <div class="card">
      <div class="muted">${label}</div>
      <div class="big">${value}</div>
    </div>
  `).join("");
}

function renderExchangeReality(exchange, executionMode) {
  const container = document.getElementById("exchangeCards");
  if (!container) return;

  const metrics = dashboardData?.executionMetrics || {};
  const breakdown = dashboardData?.executionBreakdown || {};
  const perf = dashboardData?.performance || {};

  if (!exchange || exchange.error) {
    container.innerHTML = `
      <div class="card">
        <div class="muted">Execution Mode</div>
        <div class="big compact">${executionMode || "-"}</div>
      </div>
      <div class="card">
        <div class="muted">Exchange</div>
        <div class="big">Erro</div>
        <div class="muted">${exchange?.error || "Sem resposta"}</div>
      </div>
      <div class="card">
        <div class="muted">Avg Slippage</div>
        <div class="big">${pct01(metrics.avgSlippagePct || 0)}</div>
      </div>
      <div class="card">
        <div class="muted">Avg Latency</div>
        <div class="big">${fmt(metrics.avgLatencyTotalMs || 0, 0)}ms</div>
      </div>
    `;
    return;
  }

  const usdc =
    (exchange.balances || []).find((b) => b.asset === "USDC") || {
      asset: "USDC",
      free: 0,
      locked: 0,
      total: 0,
    };

  const cards = [
    ["Execution Mode", `<span class="big compact">${executionMode || "-"}</span>`],
    ["USDC Free", fmt(Number(usdc.free || 0), 6)],
    ["USDC Locked", fmt(Number(usdc.locked || 0), 6)],
    ["USDC Total", fmt(Number(usdc.total || 0), 6)],
    ["Perf Start", `$${fmt(Number(perf.startingBalance || 0), 2)}`],
    ["Perf Current", `$${fmt(Number(perf.currentBalance || 0), 2)}`],
    ["Open Orders Reais", (exchange.openOrders || []).length],
    ["Assets Reais", (exchange.balances || []).length],
    ["Avg Slippage", pct01(metrics.avgSlippagePct || 0)],
    ["P95 Slippage", pct01(metrics.p95SlippagePct || 0)],
    ["Avg Latency", `${fmt(metrics.avgLatencyTotalMs || 0, 0)}ms`],
    ["P95 Latency", `${fmt(metrics.p95LatencyTotalMs || 0, 0)}ms`],
    ["Real Exec", breakdown.binance_real?.total ?? 0],
    ["Test Exec", breakdown.binance_test?.total ?? 0],
  ];

  container.innerHTML = cards.map(([label, value]) => `
    <div class="card">
      <div class="muted">${label}</div>
      <div class="${String(value).includes("<span") ? "" : "big"}">${value}</div>
    </div>
  `).join("");
}

function renderExchangeBalances(exchange) {
  const container = document.getElementById("exchangeBalances");
  if (!container) return;

  if (!exchange || exchange.error) {
    container.innerHTML = `<div class="muted">${exchange?.error || "Sem dados."}</div>`;
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

  container.innerHTML = `
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
  `;
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
        <td>${o.side || "-"}</td>
        <td>${o.type || "-"}</td>
        <td>${fmt(Number(o.price || 0), 8)}</td>
        <td>${fmt(Number(o.origQty || 0), 8)}</td>
        <td>${fmt(Number(o.executedQty || 0), 8)}</td>
        <td>${o.status || "-"}</td>
      </tr>
    `).join("");

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Side</th>
          <th>Type</th>
          <th>Price</th>
          <th>Orig Qty</th>
          <th>Exec Qty</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="7">Sem open orders.</td></tr>`}</tbody>
    </table>
  `;
}

function renderFilterSummary(filteredSignals, filteredClosed, filteredExecutions) {
  const classes = {
    EXECUTABLE: 0,
    WATCH: 0,
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
      <div class="stat-box"><div class="label">EXECUTABLE / WATCH / IGNORE</div><div class="value">${classes.EXECUTABLE} / ${classes.WATCH} / ${classes.IGNORE}</div></div>
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

  document.getElementById("bySymbol").innerHTML = `
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
  `;
}

function renderByScore(signals) {
  const buckets = {
    "0-24": { count: 0, executable: 0, watch: 0, ignore: 0 },
    "25-49": { count: 0, executable: 0, watch: 0, ignore: 0 },
    "50-74": { count: 0, executable: 0, watch: 0, ignore: 0 },
    "75-100": { count: 0, executable: 0, watch: 0, ignore: 0 },
  };

  for (const s of signals) {
    const score = Number(s.score || 0);
    const bucket =
      score >= 75 ? "75-100" :
      score >= 50 ? "50-74" :
      score >= 25 ? "25-49" :
      "0-24";

    buckets[bucket].count++;

    const cls = String(s.signalClass || "IGNORE").toLowerCase();
    if (cls === "executable") buckets[bucket].executable++;
    else if (cls === "watch") buckets[bucket].watch++;
    else buckets[bucket].ignore++;
  }

  const rows = Object.entries(buckets).map(([bucket, val]) => `
    <tr>
      <td>${bucket}</td>
      <td>${val.count}</td>
      <td>${val.executable}</td>
      <td>${val.watch}</td>
      <td>${val.ignore}</td>
    </tr>
  `).join("");

  document.getElementById("byScore").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Score</th>
          <th>Total</th>
          <th>Executable</th>
          <th>Watch</th>
          <th>Ignore</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5">Sem dados.</td></tr>`}</tbody>
    </table>
  `;

  return buckets;
}

function renderOpenSignals(openSignals) {
  const rows = openSignals.map((s) => `
    <tr>
      <td>${s.symbol || "-"}</td>
      <td>${s.tf || "-"}</td>
      <td>${s.side || "-"}</td>
      <td>${fmt(s.entry)}</td>
      <td>${fmt(s.sl)}</td>
      <td>${fmt(s.tp)}</td>
      <td>${fmt(Number(s.score || 0), 0)}</td>
      <td>${fmt(Number(s.adx || 0), 2)}</td>
      <td>${regimePill(s)}</td>
      <td>${clsPill(s.signalClass)}</td>
      <td class="mono">${formatSymbolRules(s.symbol)}</td>
    </tr>
  `).join("");

  document.getElementById("openSignals").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>TF</th>
          <th>Side</th>
          <th>Entry</th>
          <th>SL</th>
          <th>TP</th>
          <th>Score</th>
          <th>ADX</th>
          <th>Regime</th>
          <th>Class</th>
          <th>Rules</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="11">Sem open signals.</td></tr>`}</tbody>
    </table>
  `;
}

function renderRecentExecutions(recentExecutions) {
  const rows = recentExecutions.map((e) => `
    <tr>
      <td>${new Date(e.ts).toLocaleString()}</td>
      <td>${e.symbol || "-"}</td>
      <td>${e.tf || "-"}</td>
      <td>${modePill(e.mode)}</td>
      <td>${e.side || "-"}</td>
      <td>${fmt(e.entry)}</td>
      <td>${fmt(e.sl)}</td>
      <td>${fmt(e.tp)}</td>
      <td>${fmt(Number(e.score || 0), 0)}</td>
      <td>${statusPill(e.status)}</td>
      <td>${fmt(Number(e.quantity), 6)}</td>
      <td>${fmt(Number(e.tradeUsd || e.positionUsd || 0), 2)}</td>
      <td>${outcomePill(e.outcome)}</td>
      <td>${fmt(Number(e.pnlPct))}</td>
      <td>${fmt(Number(e.exitPrice || 0), 6)}</td>
    </tr>
  `).join("");

  document.getElementById("recentExecutions").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Symbol</th>
          <th>TF</th>
          <th>Mode</th>
          <th>Side</th>
          <th>Entry</th>
          <th>SL</th>
          <th>TP</th>
          <th>Score</th>
          <th>Status</th>
          <th>Qty</th>
          <th>Notional</th>
          <th>Outcome</th>
          <th>PnL %</th>
          <th>Exit</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="15">Sem executions.</td></tr>`}</tbody>
    </table>
  `;
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

  document.getElementById("recentClosed").innerHTML = `
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
  `;
}

function renderRecentSignals(recentSignals) {
  const rows = recentSignals.map((s) => `
    <tr>
      <td>${new Date(s.ts).toLocaleString()}</td>
      <td>${s.symbol || "-"}</td>
      <td>${s.tf || "-"}</td>
      <td>${fmt(Number(s.price))}</td>
      <td>${fmt(Number(s.score || 0), 0)}</td>
      <td>${clsPill(s.signalClass)}</td>
      <td>${regimePill(s)}</td>
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

  document.getElementById("recentSignals").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Symbol</th>
          <th>TF</th>
          <th>Price</th>
          <th>Score</th>
          <th>Class</th>
          <th>Regime</th>
          <th>Flags</th>
          <th>Rules</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="9">Sem signal log.</td></tr>`}</tbody>
    </table>
  `;
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
      datasets: [{ label: "Signals", data: Object.values(classCounts) }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  destroyChart("regimeChart");
  charts.regimeChart = new Chart(document.getElementById("regimeChart"), {
    type: "doughnut",
    data: {
      labels: Object.keys(regimeCounts),
      datasets: [{ data: Object.values(regimeCounts) }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  destroyChart("scoreChart");
  charts.scoreChart = new Chart(document.getElementById("scoreChart"), {
    type: "bar",
    data: {
      labels: Object.keys(scoreBuckets),
      datasets: [{ label: "Signals", data: Object.values(scoreBuckets) }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  destroyChart("symbolPnlChart");
  charts.symbolPnlChart = new Chart(document.getElementById("symbolPnlChart"), {
    type: "bar",
    data: {
      labels: pnlLabels.length ? pnlLabels : ["Sem dados"],
      datasets: [{ label: "Avg PnL %", data: pnlLabels.length ? pnlValues : [0] }],
    },
    options: { responsive: true, maintainAspectRatio: false },
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

  renderCards(dashboardData.totals);
  renderPerformance(dashboardData.performance);
  renderExecutionMetrics(dashboardData.executionMetrics);
  renderExecutionModes(dashboardData.executionBreakdown);
  renderExchangeReality(dashboardData.exchange, dashboardData.executionMode);
  renderExchangeBalances(dashboardData.exchange);
  renderExchangeOpenOrders(dashboardData.exchange);
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
}

bindEvents();
initTabs();
load();
setInterval(load, 5000);