const fs = require("fs");
const path = require("path");
const {
  readJsonSafe: readRuntimeJsonSafe,
  writeJsonAtomic,
} = require("../runtime/file-utils");

const PROJECT_ROOT = path.join(__dirname, "..");
const RUNTIME_DIR = path.join(PROJECT_ROOT, "runtime");

const STATE_FILE =
  process.env.STATE_FILE_PATH || path.join(RUNTIME_DIR, "state.json");
const METRICS_FILE =
  process.env.EXECUTION_METRICS_FILE_PATH ||
  path.join(RUNTIME_DIR, "execution-metrics.json");
const ORDERS_LOG_FILE =
  process.env.ORDERS_LOG_FILE_PATH || path.join(RUNTIME_DIR, "orders-log.json");

const OUTPUT_JSON = path.join(__dirname, "consolidated-trades.json");
const OUTPUT_CSV = path.join(__dirname, "consolidated-trades.csv");


const IGNORE_EXECUTION_IDS = new Set([
  "futures_real_1775640186301_XRPUSDC_LONG",
]);

function shouldIgnoreExecution(exec) {
  if (!exec || !exec.id) return false;
  return IGNORE_EXECUTION_IDS.has(exec.id);
}

function readJsonSafe(filePath, fallback) {
  return readRuntimeJsonSafe(filePath, fallback);
}

function writeJsonSafe(filePath, value) {
  writeJsonAtomic(filePath, value);
}

function safeNum(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function hasValue(v) {
  return v !== null && v !== undefined && !(typeof v === "number" && !Number.isFinite(v));
}

function avg(arr) {
  const nums = (Array.isArray(arr) ? arr : [])
    .filter((n) => Number.isFinite(Number(n)))
    .map(Number);
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function highest(arr) {
  const nums = (Array.isArray(arr) ? arr : [])
    .filter((n) => Number.isFinite(Number(n)))
    .map(Number);
  if (!nums.length) return null;
  return Math.max(...nums);
}

function lowest(arr) {
  const nums = (Array.isArray(arr) ? arr : [])
    .filter((n) => Number.isFinite(Number(n)))
    .map(Number);
  if (!nums.length) return null;
  return Math.min(...nums);
}

function round(v, digits = 8) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function toIso(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return new Date(n).toISOString();
  } catch {
    return null;
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
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

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ];

  return lines.join("\n");
}

function latestBy(arr, keyGetter) {
  const map = new Map();
  for (const item of arr || []) {
    const key = keyGetter(item);
    if (!key) continue;
    map.set(key, item);
  }
  return map;
}

function groupBy(arr, keyGetter) {
  const map = new Map();
  for (const item of arr || []) {
    const key = keyGetter(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function calcTpDistancePct(entry, tp) {
  const e = safeNum(entry);
  const t = safeNum(tp);
  if (!Number.isFinite(e) || !Number.isFinite(t) || e <= 0) return null;
  return round(Math.abs(t - e) / e, 8);
}

function calcTpDistanceAtr(entry, tp, atr) {
  const e = safeNum(entry);
  const t = safeNum(tp);
  const a = safeNum(atr);
  if (!Number.isFinite(e) || !Number.isFinite(t) || !Number.isFinite(a) || a <= 0) return null;
  return round(Math.abs(t - e) / a, 8);
}

function calcRrPlanned(entry, sl, tp) {
  const e = safeNum(entry);
  const s = safeNum(sl);
  const t = safeNum(tp);
  if (!Number.isFinite(e) || !Number.isFinite(s) || !Number.isFinite(t)) return null;
  const risk = Math.abs(e - s);
  if (!(risk > 0)) return null;
  return round(Math.abs(t - e) / risk, 8);
}

function calcRrRealized(direction, entry, sl, exitPrice) {
  const e = safeNum(entry);
  const s = safeNum(sl);
  const x = safeNum(exitPrice);
  if (!Number.isFinite(e) || !Number.isFinite(s) || !Number.isFinite(x)) return null;

  const risk = Math.abs(e - s);
  if (!(risk > 0)) return null;

  let reward = null;
  if (direction === "SHORT") reward = e - x;
  else if (direction === "LONG") reward = x - e;

  if (!Number.isFinite(reward)) return null;
  return round(reward / risk, 8);
}

function calcPnlPct(direction, entry, exitPrice) {
  const e = safeNum(entry);
  const x = safeNum(exitPrice);
  if (!Number.isFinite(e) || !Number.isFinite(x) || e <= 0) return null;
  if (direction === "LONG") return round(((x - e) / e) * 100, 8);
  if (direction === "SHORT") return round(((e - x) / e) * 100, 8);
  return null;
}

function quoteAssetFromSymbol(symbol) {
  if (String(symbol || "").toUpperCase().endsWith("USDC")) return "USDC";
  if (String(symbol || "").toUpperCase().endsWith("USDT")) return "USDT";
  return "USDT";
}

function baseAssetFromSymbol(symbol) {
  const value = String(symbol || "").toUpperCase();
  if (value.endsWith("USDC") || value.endsWith("USDT")) return value.slice(0, -4);
  return value;
}

function estimateFeeQuoteEquivalent(symbol, fill = {}) {
  const commission = safeNum(fill?.commission, null);
  if (!Number.isFinite(commission) || commission <= 0) return null;

  const quoteAsset = quoteAssetFromSymbol(symbol);
  const baseAsset = baseAssetFromSymbol(symbol);
  const asset = String(fill?.commissionAsset || quoteAsset).toUpperCase();
  const price = safeNum(fill?.price, null);

  if (asset === quoteAsset) return commission;
  if (
    (asset === "USDT" && quoteAsset === "USDC") ||
    (asset === "USDC" && quoteAsset === "USDT") ||
    asset === "BNFCR"
  ) {
    return commission;
  }

  if (asset === baseAsset && Number.isFinite(price) && price > 0) {
    return commission * price;
  }

  return null;
}

function sumRealizedPnlFromFills(fills = []) {
  const rows = Array.isArray(fills) ? fills : [];
  const values = rows
    .map((fill) => safeNum(fill?.realizedPnl, null))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0), 12);
}

function sumFeesFromFills(symbol, fills = []) {
  const rows = Array.isArray(fills) ? fills : [];
  if (!rows.length) return null;

  let total = 0;
  let found = false;

  for (const fill of rows) {
    const fee = estimateFeeQuoteEquivalent(symbol, fill);
    if (!Number.isFinite(fee)) continue;
    total += fee;
    found = true;
  }

  return found ? round(total, 12) : null;
}

function inferOutcome(exec, signal) {
  const explicit =
    signal?.outcome ||
    exec?.closeReasonInternal ||
    exec?.closeReasonExchange ||
    exec?.closeReason ||
    null;

  if (
    explicit === "TP" ||
    explicit === "SL" ||
    explicit === "MANUAL_MARKET_CLOSE" ||
    explicit === "MANUAL_CLOSE"
  ) {
    return explicit;
  }

  const exitPrice = safeNum(exec?.exitPrice);
  const tp = safeNum(exec?.tp);
  const sl = safeNum(exec?.sl);

  if (
    Number.isFinite(exitPrice) &&
    Number.isFinite(tp) &&
    Math.abs(exitPrice - tp) / Math.max(tp, 1e-9) < 0.0005
  ) {
    return "TP";
  }

  if (
    Number.isFinite(exitPrice) &&
    Number.isFinite(sl) &&
    Math.abs(exitPrice - sl) / Math.max(sl, 1e-9) < 0.0005
  ) {
    return "SL";
  }

  const pnlPct = safeNum(exec?.pnlPct);
  if (Number.isFinite(pnlPct)) {
    if (pnlPct > 0) return "WIN";
    if (pnlPct < 0) return "LOSS";
    return "BE";
  }

  return null;
}

function buildOrderLogIndex(orderRows) {
  const rows = Array.isArray(orderRows) ? orderRows : [];
  const byExecutionId = groupBy(rows, (r) => r?.linkedExecutionId || null);
  const latestByExecutionId = new Map();

  for (const [execId, arr] of byExecutionId.entries()) {
    const sorted = [...arr].sort((a, b) => Number(a?.ts || 0) - Number(b?.ts || 0));
    latestByExecutionId.set(execId, sorted[sorted.length - 1]);
  }

  return { byExecutionId, latestByExecutionId };
}

function makeSignalIndexes(state) {
  const closedSignals = Array.isArray(state.closedSignals) ? state.closedSignals : [];
  const signalLog = Array.isArray(state.signalLog) ? state.signalLog : [];

  const allSignalRows = [...closedSignals, ...signalLog].filter(Boolean);

  const byExecutionId = latestBy(
    allSignalRows,
    (s) => s.executionOrderId || s.executionId || null
  );

  const bySymbolTf = groupBy(allSignalRows, (s) => {
    if (!s?.symbol || !s?.tf) return null;
    return `${s.symbol}__${s.tf}`;
  });

  return { closedSignals, signalLog, byExecutionId, bySymbolTf };
}

function pickBestSignalForExecution(exec, signalIndexes) {
  if (!exec) return null;

  const direct = signalIndexes.byExecutionId.get(exec.id) || null;
  if (direct) return direct;

  const key = exec.symbol && exec.tf ? `${exec.symbol}__${exec.tf}` : null;
  if (!key) return null;

  const candidates = signalIndexes.bySymbolTf.get(key) || [];
  if (!candidates.length) return null;

  const openTs = Number(exec.openedTs || 0);
  const closeTs = Number(exec.closedTs || 0);

  let best = null;
  let bestScore = Infinity;

  for (const s of candidates) {
    const sTs = Number(s.ts || s.signalTs || 0);
    if (!Number.isFinite(sTs) || sTs <= 0) continue;

    let score = Infinity;

    if (openTs > 0) {
      score = Math.abs(sTs - openTs);
      if (sTs > openTs + 10 * 60 * 1000) score += 1e9;
    } else if (closeTs > 0) {
      score = Math.abs(sTs - closeTs);
    }

    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }

  return best;
}

function buildMetricsIndex(metricsRows) {
  const rows = Array.isArray(metricsRows) ? metricsRows : [];
  return latestBy(rows, (m) => m.executionId || m.linkedExecutionId || null);
}

function buildRow(exec, signal, metric, orderRowsForExec) {
  const direction = exec.direction || signal?.direction || null;
  const openFills = Array.isArray(exec.exchange?.openFills) ? exec.exchange.openFills : [];
  const closeFills = Array.isArray(exec.exchange?.closeFills) ? exec.exchange.closeFills : [];

  const entryPlanned = safeNum(exec.entryPlanned ?? signal?.entry ?? signal?.entrySignal ?? exec.entry);
  const entryFill = safeNum(exec.entryFill ?? exec.entryPrice ?? exec.entry);
  const entrySignal = safeNum(signal?.entry ?? signal?.entrySignal ?? exec.entryPlanned ?? exec.entry);
  const rawEntry = safeNum(signal?.rawEntry ?? signal?.entry);
  const projectedEntry = safeNum(signal?.projectedEntry);
  const entryProjectionAtrMult = safeNum(signal?.entryProjectionAtrMult);

  const sl = safeNum(exec.sl ?? signal?.sl);
  const tp = safeNum(exec.tp ?? signal?.tp);
  const atr = safeNum(signal?.atr);
  const exitPlanned = safeNum(exec.exitPlanned ?? signal?.exitPlanned ?? signal?.exitRef);
  const exitFill = safeNum(exec.exitFill ?? exec.exitPrice);
  const exitPrice = exitFill;

  const fallbackSlippage =
    Number.isFinite(entrySignal) &&
    Number.isFinite(entryFill) &&
    entrySignal > 0
      ? round(Math.abs(entryFill - entrySignal) / entrySignal, 8)
      : null;

  const latestOrderLog =
    Array.isArray(orderRowsForExec) && orderRowsForExec.length
      ? [...orderRowsForExec].sort((a, b) => Number(a?.ts || 0) - Number(b?.ts || 0)).at(-1)
      : null;

  const outcome = inferOutcome(exec, signal);
  const pnlPct = safeNum(exec.pnlPct ?? signal?.pnlPct ?? calcPnlPct(direction, entryFill, exitPrice));
  const pnlTheoretical = safeNum(
    exec.pnlTheoretical ??
      signal?.pnlTheoretical ??
      (Number.isFinite(entryPlanned) && Number.isFinite(exitPlanned)
        ? (Math.abs(exec.quantity || 0) > 0
            ? ((direction === "SHORT" ? entryPlanned - exitPlanned : exitPlanned - entryPlanned) *
              Number(exec.quantity || 0))
            : null)
        : null)
  );
  const pnlRealizedGross = safeNum(
    exec.pnlRealizedGross ??
      signal?.pnlRealizedGross ??
      sumRealizedPnlFromFills(closeFills) ??
      (Number.isFinite(entryFill) &&
      Number.isFinite(exitPrice) &&
      Number.isFinite(Number(exec.quantity || 0))
        ? ((direction === "SHORT" ? entryFill - exitPrice : exitPrice - entryFill) *
          Number(exec.quantity || 0))
        : null)
  );
  const fees = safeNum(
    exec.fees ??
      signal?.fees ??
      ((sumFeesFromFills(exec.symbol, openFills) || 0) +
        (sumFeesFromFills(exec.symbol, closeFills) || 0))
  );
  const pnlRealizedNet = safeNum(
    exec.pnlRealizedNet ??
      signal?.pnlRealizedNet ??
      (Number.isFinite(pnlRealizedGross)
        ? pnlRealizedGross - (Number.isFinite(fees) ? fees : 0)
        : exec.pnlUsd)
  );
  const closeReasonExchange =
    exec.closeReasonExchange ??
    signal?.closeReasonExchange ??
    (exec.exchange?.closeOrderId
      ? exec.exchange?.slOrderId && exec.exchange.closeOrderId === exec.exchange.slOrderId
        ? "stop_market_filled"
        : exec.exchange?.tpOrderId && exec.exchange.closeOrderId === exec.exchange.tpOrderId
        ? "take_profit_market_filled"
        : "market_close_order"
      : null);
  const pnlSource =
    exec.pnlSource ??
    signal?.pnlSource ??
    (closeFills.length ? "binance_fill" : exec.exchange?.closeOrderId ? "order_status" : null);

  return {
    executionId: exec.id,
    symbol: exec.symbol ?? null,
    tf: exec.tf ?? null,
    side: direction ?? null,
    strategy: exec.strategy ?? signal?.strategy ?? null,

    signalTs: signal?.ts ?? signal?.signalTs ?? null,
    signalIso: toIso(signal?.ts ?? signal?.signalTs ?? null),
    openTs: exec.openedTs ?? null,
    openIso: toIso(exec.openedTs),
    closedTs: exec.closedTs ?? null,
    closedIso: toIso(exec.closedTs),

    statusAtOpen: exec.openedTs ? "OPEN" : null,
    mode: exec.mode ?? null,
    source: exec.mode === "binance_real" ? "execution" : "paper_execution",

    entrySignal,
    entryPlanned,
    entryFill,
    entry: entryFill,
    rawEntry,
    projectedEntry,
    entryProjectionAtrMult,

    sl,
    tp,
    tpRawAtr: safeNum(signal?.tpRawAtr),
    tpCappedByResistance: hasValue(signal?.tpCappedByResistance) ? signal.tpCappedByResistance : null,
    tpDistancePct: calcTpDistancePct(entryFill, tp),
    tpDistanceAtr: calcTpDistanceAtr(entryFill, tp, atr),

    exitPlanned,
    exitFill,
    exitPrice,
    quantity: safeNum(exec.quantity),
    grossQuantity: safeNum(exec.exchange?.openExecutedQty ?? exec.quantity),
    positionUsd: safeNum(exec.positionNotional ?? exec.tradeUsd),
    tradeUsd: safeNum(exec.tradeUsd),
    freeQuote: safeNum(signal?.freeQuote),

    score: safeNum(exec.score ?? signal?.score),
    signalClass: exec.signalClass ?? signal?.signalClass ?? null,

    rsi: safeNum(signal?.rsi),
    prevRsi: safeNum(signal?.prevRsi),
    atr,
    atrPct: safeNum(signal?.atrPct),
    adx: safeNum(signal?.adx),
    ema20: safeNum(signal?.ema20),
    ema50: safeNum(signal?.ema50),
    ema200: safeNum(signal?.ema200),

    bullish: hasValue(signal?.bullish) ? signal.bullish : null,
    bullishFast: hasValue(signal?.bullishFast) ? signal.bullishFast : null,
    nearEma20: hasValue(signal?.nearEma20) ? signal.nearEma20 : null,
    nearEma50: hasValue(signal?.nearEma50) ? signal.nearEma50 : null,
    nearPullback: hasValue(signal?.nearPullback) ? signal.nearPullback : null,
    stackedEma: hasValue(signal?.stackedEma) ? signal.stackedEma : null,
    rsiInBand: hasValue(signal?.rsiInBand) ? signal.rsiInBand : null,
    rsiRising: hasValue(signal?.rsiRising) ? signal.rsiRising : null,
    isTrend: hasValue(signal?.isTrend) ? signal.isTrend : null,
    isRange: hasValue(signal?.isRange) ? signal.isRange : null,
    cooldownPassed: hasValue(signal?.cooldownPassed) ? signal.cooldownPassed : null,
    emaSeparationPct: safeNum(signal?.emaSeparationPct),
    emaSlopePct: safeNum(signal?.emaSlopePct),
    distToEma20: safeNum(signal?.distToEma20),
    distToEma50: safeNum(signal?.distToEma50),
    entryDiffPctFromLast: safeNum(signal?.entryDiffPctFromLast),

    nearestSupport: safeNum(signal?.nearestSupport),
    nearestSupportStrength: safeNum(signal?.nearestSupportStrength),
    nearestSupportTouches: safeNum(signal?.nearestSupportTouches),
    nearestResistance: safeNum(signal?.nearestResistance),
    nearestResistanceStrength: safeNum(signal?.nearestResistanceStrength),
    nearestResistanceTouches: safeNum(signal?.nearestResistanceTouches),
    srPassed: hasValue(signal?.srPassed) ? signal.srPassed : null,
    srReason: signal?.srReason ?? null,
    distanceToSupportAtr: safeNum(signal?.distanceToSupportAtr),
    distanceToResistanceAtr: safeNum(signal?.distanceToResistanceAtr),

    maxHighDuringTrade: safeNum(signal?.maxHighDuringTrade),
    minLowDuringTrade: safeNum(signal?.minLowDuringTrade),
    barsOpen: safeNum(signal?.barsOpen),

    executionAttempted: true,
    executionApproved: true,
    executionReason: exec.closeReason ?? null,

    rrPlanned: calcRrPlanned(entryFill, sl, tp),
    rrRealizedLogged: safeNum(signal?.rrRealized),
    rrRealized: calcRrRealized(direction, entryFill, sl, exitPrice),
    outcome,
    closeReason: exec.closeReason ?? signal?.closeReason ?? null,
    closeReasonInternal:
      exec.closeReasonInternal ?? signal?.closeReasonInternal ?? exec.closeReason ?? null,
    closeReasonExchange,
    pnlSource,
    pnlPct,
    pnlUsd: safeNum(exec.pnlUsd),
    pnlTheoretical,
    pnlRealizedGross,
    fees,
    pnlRealizedNet,

    commissionRate: safeNum(signal?.commissionRate),

    entryOrderId: exec.exchange?.openOrderId ?? null,
    entryClientOrderId: exec.exchange?.openClientOrderId ?? null,
    entryTransactTime: exec.exchange?.openTransactTime ?? null,
    entryTransactIso: toIso(exec.exchange?.openTransactTime ?? null),
    entryStatus: exec.exchange?.openStatus ?? null,
    entryExecutedQty: safeNum(exec.exchange?.openExecutedQty),
    entryQuoteQty: safeNum(exec.exchange?.openQuoteQty),

    exitOrderId: exec.exchange?.closeOrderId ?? null,
    exitClientOrderId: exec.exchange?.closeClientOrderId ?? null,
    exitTransactTime: exec.exchange?.closeTransactTime ?? null,
    exitTransactIso: toIso(exec.exchange?.closeTransactTime ?? null),
    exitStatus: exec.exchange?.closeStatus ?? null,
    exitExecutedQty: safeNum(exec.exchange?.closeExecutedQty),
    exitQuoteQty: safeNum(exec.exchange?.closeQuoteQty),

    tpAlgoId: exec.exchange?.tpAlgoId ?? null,
    tpClientAlgoId: exec.exchange?.tpClientAlgoId ?? null,
    tpOrderId: exec.exchange?.tpOrderId ?? null,
    tpStopPrice: safeNum(exec.exchange?.tpStopPrice),
    tpOrderMode: exec.exchange?.tpOrderMode ?? null,
    slAlgoId: exec.exchange?.slAlgoId ?? null,
    slClientAlgoId: exec.exchange?.slClientAlgoId ?? null,
    slOrderId: exec.exchange?.slOrderId ?? null,
    slStopPrice: safeNum(exec.exchange?.slStopPrice),
    slOrderMode: exec.exchange?.slOrderMode ?? null,
    attachedExitsPlaced: hasValue(exec.exchange?.attachedExitsPlaced)
      ? exec.exchange.attachedExitsPlaced
      : null,
    protectionStatus: exec.exchange?.protectionStatus ?? null,
    attachError: exec.exchange?.attachError ?? null,
    openFees: safeNum(exec.openFees ?? exec.exchange?.openFees),
    closeFees: safeNum(exec.closeFees ?? exec.exchange?.closeFees),
    feesConvertible:
      hasValue(exec.feesConvertible) ? exec.feesConvertible : null,

    slippagePct: safeNum(metric?.slippagePct ?? fallbackSlippage),
    latencyInternal: safeNum(metric?.latencyInternal),
    latencyExchange: safeNum(metric?.latencyExchange),
    latencyTotal: safeNum(metric?.latencyTotal),
    execMetricTs: metric?.ts ?? metric?.createdAt ?? null,
    execMetricIso: toIso(metric?.ts ?? metric?.createdAt ?? null),
    execMetricMatchDiffMs: safeNum(metric?.matchDiffMs),

    latestOrderLogType: latestOrderLog?.type ?? null,
    latestOrderLogTs: latestOrderLog?.ts ?? null,
    latestOrderLogIso: toIso(latestOrderLog?.ts ?? null),
  };
}

function main() {
  const state = readJsonSafe(STATE_FILE, {});
  const executionMetrics = readJsonSafe(METRICS_FILE, []);
  const ordersLog = readJsonSafe(ORDERS_LOG_FILE, []);

  const executions = Array.isArray(state.executions)
    ? state.executions.filter((e) => e && e.status === "CLOSED")
    : [];

  const signalIndexes = makeSignalIndexes(state);
  const metricsByExecutionId = buildMetricsIndex(executionMetrics);
  const orderIndex = buildOrderLogIndex(ordersLog);

  const rows = executions.map((exec) => {
    const signal = pickBestSignalForExecution(exec, signalIndexes);
    const metric = metricsByExecutionId.get(exec.id) || null;
    const orderRowsForExec = orderIndex.byExecutionId.get(exec.id) || [];
    return buildRow(exec, signal, metric, orderRowsForExec);
  });

  rows.sort((a, b) => {
    const ta = Number(a.openTs || a.signalTs || 0);
    const tb = Number(b.openTs || b.signalTs || 0);
    return ta - tb;
  });

  writeJsonSafe(OUTPUT_JSON, rows);
  writeJsonAtomic(OUTPUT_CSV, toCsv(rows));

  const rrRows = rows.filter((r) => Number.isFinite(Number(r.rrRealized)));
  const avgRrRealized = rrRows.length ? avg(rrRows.map((r) => Number(r.rrRealized))) : 0;

  const countWith = (field) => rows.filter((r) => hasValue(r[field])).length;

  console.log(`Closed signals: ${Array.isArray(state.closedSignals) ? state.closedSignals.length : 0}`);
  console.log(
    `Open execution rows: ${
      Array.isArray(state.executions)
        ? state.executions.filter((e) => e && e.status === "OPEN").length
        : 0
    }`
  );
  console.log(
    `Close rows: ${
      Array.isArray(ordersLog)
        ? ordersLog.filter((r) => String(r?.type || "").includes("close")).length
        : 0
    }`
  );
  console.log(`Consolidated trades: ${rows.length}`);
  console.log(`Saved JSON: ${OUTPUT_JSON}`);
  console.log(`Saved CSV: ${OUTPUT_CSV}`);
  console.log(`With rrRealized: ${countWith("rrRealized")}`);
  console.log(`With slippage: ${countWith("slippagePct")}`);
  console.log(
    `With SR fields: ${
      rows.filter((r) => hasValue(r.nearestSupport) || hasValue(r.nearestResistance) || hasValue(r.srPassed)).length
    }`
  );
  console.log(`With tpCappedByResistance: ${countWith("tpCappedByResistance")}`);
  console.log(`With projectedEntry: ${countWith("projectedEntry")}`);
  console.log(
    `With TP distance fields: ${
      rows.filter((r) => hasValue(r.tpDistancePct) || hasValue(r.tpDistanceAtr)).length
    }`
  );
  console.log(`With strategy: ${countWith("strategy")}`);
  console.log(`Avg rrRealized: ${avgRrRealized.toFixed(4)}`);
}

main();
