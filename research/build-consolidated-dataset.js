const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "..", "runtime", "state.json");
const EXEC_METRICS_FILE = path.join(__dirname, "..", "runtime", "execution-metrics.json");
const ORDERS_LOG_FILE = path.join(__dirname, "..", "runtime", "orders-log.json");

const OUT_JSON = path.join(__dirname, "consolidated-trades.json");
const OUT_CSV = path.join(__dirname, "consolidated-trades.csv");

const MAX_EXEC_MATCH_DIFF_MS = 10 * 1000; // 10s

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Ficheiro não encontrado: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeNum(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function absDiff(a, b) {
  return Math.abs((a || 0) - (b || 0));
}

function normalizeOutcome(v) {
  if (!v || typeof v !== "string") return null;
  const x = v.toUpperCase();

  if (x.includes("TP")) return "TP";
  if (x.includes("SL")) return "SL";
  if (x.includes("STOP")) return "SL";
  return x;
}

function getExecutionRows(ordersLog) {
  return ordersLog.filter(
    (row) =>
      row &&
      typeof row === "object" &&
      row.id &&
      row.side === "BUY" &&
      row.entry != null
  );
}

function getCloseRows(ordersLog) {
  return ordersLog.filter(
    (row) =>
      row &&
      typeof row === "object" &&
      (
        row.type === "real_sell_close" ||
        row.linkedExecutionId ||
        row.closeReason ||
        row.exitPrice != null
      )
  );
}

function indexBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const key = keyFn(item);
    if (key != null) map.set(key, item);
  }
  return map;
}

function findNearestExecMetric(metrics, symbol, ts) {
  let best = null;
  let bestDiff = Infinity;

  for (const m of metrics) {
    if (m.symbol !== symbol) continue;
    const diff = absDiff(m.ts, ts);
    if (diff <= MAX_EXEC_MATCH_DIFF_MS && diff < bestDiff) {
      best = m;
      bestDiff = diff;
    }
  }

  return { metric: best, diffMs: best ? bestDiff : null };
}

function calcRealizedR(trade) {
  const entry = safeNum(trade.entryFill ?? trade.entry);
  const sl = safeNum(trade.sl);
  const exit = safeNum(trade.exitPrice);

  if (entry == null || sl == null || exit == null) return null;

  const risk = Math.abs(entry - sl);
  if (risk === 0) return null;

  if ((trade.side || "BUY") === "BUY") {
    return (exit - entry) / risk;
  }

  return (entry - exit) / risk;
}

function csvEscape(value) {
  if (value == null) return "";
  const s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows) {
  if (!rows.length) return "";

  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set())
  );

  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }

  return lines.join("\n");
}

function main() {
  const state = loadJson(STATE_FILE);
  const executionMetrics = loadJson(EXEC_METRICS_FILE);
  const ordersLog = loadJson(ORDERS_LOG_FILE);

  if (!Array.isArray(state.closedSignals)) {
    throw new Error("state.json não tem state.closedSignals");
  }
  if (!Array.isArray(executionMetrics)) {
    throw new Error("execution-metrics.json deve ser array");
  }
  if (!Array.isArray(ordersLog)) {
    throw new Error("orders-log.json deve ser array");
  }

  const closedSignals = state.closedSignals;
  const openExecutionRows = getExecutionRows(ordersLog);
  const closeRows = getCloseRows(ordersLog);

  const openByExecutionId = indexBy(openExecutionRows, (r) => r.id);
  const closeByExecutionId = indexBy(closeRows, (r) => r.linkedExecutionId);

  const consolidated = closedSignals.map((signal) => {
    const executionId = signal.executionOrderId || null;

    const openOrder = executionId ? openByExecutionId.get(executionId) || null : null;
    const closeEvent = executionId ? closeByExecutionId.get(executionId) || null : null;

    const execMetricMatch = findNearestExecMetric(
      executionMetrics,
      signal.symbol,
      openOrder?.ts || signal.closedTs || signal.ts
    );

    const entrySignal = safeNum(execMetricMatch.metric?.entrySignal ?? signal.entry);
    const entryFill = safeNum(execMetricMatch.metric?.entryFill ?? openOrder?.entry ?? signal.entry);
    const exitPrice = safeNum(
      closeEvent?.exitPrice ??
      signal.exitRef ??
      openOrder?.exitPrice ??
      null
    );

    const outcome = normalizeOutcome(
      closeEvent?.closeReason ??
      signal.outcome ??
      openOrder?.outcome ??
      openOrder?.closeReason
    );

    const closedTs =
      closeEvent?.ts ??
      closeEvent?.closedTs ??
      signal.closedTs ??
      openOrder?.closedTs ??
      null;

    const row = {
      executionId,
      symbol: signal.symbol || openOrder?.symbol || null,
      tf: signal.tf || openOrder?.tf || null,
      side: signal.side || openOrder?.side || "BUY",

      signalTs: signal.signalTs ?? signal.ts ?? openOrder?.signalTs ?? null,
      openTs: openOrder?.ts ?? null,
      closedTs,

      statusAtOpen: openOrder?.status ?? null,
      mode: openOrder?.mode ?? null,
      source: openOrder?.source ?? null,

      entrySignal,
      entryFill,
      entry: safeNum(openOrder?.entry ?? signal.entry),
      rawEntry: safeNum(signal.rawEntry ?? openOrder?.rawEntry),
      projectedEntry: safeNum(signal.projectedEntry ?? openOrder?.projectedEntry),
      entryProjectionAtrMult: safeNum(
        signal.entryProjectionAtrMult ?? openOrder?.entryProjectionAtrMult
      ),

      sl: safeNum(signal.sl ?? openOrder?.sl),
      tp: safeNum(signal.tp ?? openOrder?.tp),
      tpRawAtr: safeNum(signal.tpRawAtr ?? openOrder?.tpRawAtr),
      tpCappedByResistance:
        signal.tpCappedByResistance ??
        openOrder?.tpCappedByResistance ??
        null,
      tpDistancePct: safeNum(signal.tpDistancePct ?? openOrder?.tpDistancePct),
      tpDistanceAtr: safeNum(signal.tpDistanceAtr ?? openOrder?.tpDistanceAtr),

      exitPrice,

      quantity: safeNum(openOrder?.quantity),
      grossQuantity: safeNum(openOrder?.grossQuantity),
      positionUsd: safeNum(openOrder?.positionUsd),
      tradeUsd: safeNum(openOrder?.tradeUsd),
      freeQuote: safeNum(openOrder?.freeQuote),

      score: safeNum(signal.score ?? openOrder?.score),
      signalClass: signal.signalClass ?? openOrder?.signalClass ?? null,

      rsi: safeNum(signal.rsi),
      prevRsi: safeNum(signal.prevRsi),
      atr: safeNum(signal.atr ?? openOrder?.atr),
      atrPct: safeNum(signal.atrPct),
      adx: safeNum(signal.adx ?? openOrder?.adx),

      ema20: safeNum(signal.ema20),
      ema50: safeNum(signal.ema50),
      ema200: safeNum(signal.ema200),

      bullish: signal.bullish ?? null,
      bullishFast: signal.bullishFast ?? null,
      nearEma20: signal.nearEma20 ?? null,
      nearEma50: signal.nearEma50 ?? null,
      nearPullback: signal.nearPullback ?? null,
      stackedEma: signal.stackedEma ?? null,
      rsiInBand: signal.rsiInBand ?? null,
      rsiRising: signal.rsiRising ?? null,
      isTrend: signal.isTrend ?? openOrder?.isTrend ?? null,
      isRange: signal.isRange ?? openOrder?.isRange ?? null,
      cooldownPassed: signal.cooldownPassed ?? null,

      emaSeparationPct: safeNum(signal.emaSeparationPct),
      emaSlopePct: safeNum(signal.emaSlopePct),
      distToEma20: safeNum(signal.distToEma20),
      distToEma50: safeNum(signal.distToEma50),
      entryDiffPctFromLast: safeNum(signal.entryDiffPctFromLast),

      nearestSupport: safeNum(signal.nearestSupport),
      nearestSupportStrength: signal.nearestSupportStrength ?? null,
      nearestSupportTouches: safeNum(signal.nearestSupportTouches),
      nearestResistance: safeNum(signal.nearestResistance),
      nearestResistanceStrength: signal.nearestResistanceStrength ?? null,
      nearestResistanceTouches: safeNum(signal.nearestResistanceTouches),
      srPassed: signal.srPassed ?? null,
      srReason: signal.srReason ?? null,
      distanceToSupportAtr: safeNum(signal.distanceToSupportAtr),
      distanceToResistanceAtr: safeNum(signal.distanceToResistanceAtr),

      maxHighDuringTrade: safeNum(signal.maxHighDuringTrade),
      minLowDuringTrade: safeNum(signal.minLowDuringTrade),
      barsOpen: safeNum(signal.barsOpen),

      executionAttempted: signal.executionAttempted ?? null,
      executionApproved: signal.executionApproved ?? null,
      executionReason: signal.executionReason ?? null,

      rrPlanned: safeNum(signal.rrPlanned ?? openOrder?.rrPlanned),
      rrRealizedLogged: safeNum(signal.rrRealized),
      outcome,
      closeReason: closeEvent?.closeReason ?? openOrder?.closeReason ?? signal.outcome ?? null,
      pnlPct: safeNum(closeEvent?.pnlPct ?? signal.pnlPct ?? openOrder?.pnlPct),

      commissionRate: safeNum(openOrder?.commissionRate),
      entryOrderId: openOrder?.exchange?.entryOrderId ?? null,
      entryClientOrderId: openOrder?.exchange?.entryClientOrderId ?? null,
      entryTransactTime: openOrder?.exchange?.entryTransactTime ?? null,
      entryStatus: openOrder?.exchange?.entryStatus ?? null,
      entryExecutedQty: openOrder?.exchange?.entryExecutedQty ?? null,
      entryQuoteQty: openOrder?.exchange?.entryQuoteQty ?? null,

      exitOrderId: closeEvent?.exchange?.exitOrderId ?? null,
      exitClientOrderId: closeEvent?.exchange?.exitClientOrderId ?? null,
      exitTransactTime: closeEvent?.exchange?.exitTransactTime ?? null,
      exitStatus: closeEvent?.exchange?.exitStatus ?? null,
      exitExecutedQty: closeEvent?.exchange?.exitExecutedQty ?? null,
      exitQuoteQty: closeEvent?.exchange?.exitQuoteQty ?? null,

      slippagePct: safeNum(execMetricMatch.metric?.slippagePct),
      latencyInternal: safeNum(execMetricMatch.metric?.latencyInternal),
      latencyExchange: safeNum(execMetricMatch.metric?.latencyExchange),
      latencyTotal: safeNum(execMetricMatch.metric?.latencyTotal),
      execMetricTs: execMetricMatch.metric?.ts ?? null,
      execMetricMatchDiffMs: execMetricMatch.diffMs,
    };

    row.rrRealized = calcRealizedR(row);

    return row;
  });

  const csv = toCsv(consolidated);

  fs.writeFileSync(OUT_JSON, JSON.stringify(consolidated, null, 2), "utf8");
  fs.writeFileSync(OUT_CSV, csv, "utf8");

  console.log("Closed signals:", closedSignals.length);
  console.log("Open execution rows:", openExecutionRows.length);
  console.log("Close rows:", closeRows.length);
  console.log("Consolidated trades:", consolidated.length);
  console.log("Saved JSON:", OUT_JSON);
  console.log("Saved CSV:", OUT_CSV);

  const withR = consolidated.filter((r) => typeof r.rrRealized === "number");
  const withSlippage = consolidated.filter((r) => typeof r.slippagePct === "number");
  const withSr = consolidated.filter(
    (r) =>
      typeof r.distanceToSupportAtr === "number" ||
      typeof r.distanceToResistanceAtr === "number"
  );
  const withTpCap = consolidated.filter((r) => r.tpCappedByResistance === true);
  const withProjectedEntry = consolidated.filter(
    (r) => typeof r.projectedEntry === "number"
  );
  const withTpDistance = consolidated.filter(
    (r) =>
      typeof r.tpDistancePct === "number" ||
      typeof r.tpDistanceAtr === "number"
  );

  console.log("With rrRealized:", withR.length);
  console.log("With slippage:", withSlippage.length);
  console.log("With SR fields:", withSr.length);
  console.log("With tpCappedByResistance:", withTpCap.length);
  console.log("With projectedEntry:", withProjectedEntry.length);
  console.log("With TP distance fields:", withTpDistance.length);

  if (withR.length) {
    const avgR =
      withR.reduce((sum, r) => sum + r.rrRealized, 0) / withR.length;
    console.log("Avg rrRealized:", avgR.toFixed(4));
  }
}

main();