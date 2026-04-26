const path = require("path");
const axios = require("axios");
const { readJsonSafe, writeJsonAtomic } = require("../runtime/file-utils");

const PROJECT_ROOT = path.join(__dirname, "..");
const RUNTIME_DIR = path.join(PROJECT_ROOT, "runtime");

const STATE_FILE =
  process.env.STATE_FILE_PATH || path.join(RUNTIME_DIR, "state.json");
const OUTPUT_JSON = path.join(__dirname, "candidate-labeled-setups.json");
const OUTPUT_CSV = path.join(__dirname, "candidate-labeled-setups.csv");
const OUTPUT_SUMMARY = path.join(__dirname, "candidate-labeled-summary.json");

const BINANCE_FUTURES_BASE =
  process.env.BINANCE_FUTURES_BASE || "https://fapi.binance.com";
const HORIZON_BARS = Number(process.env.CANDIDATE_LABEL_HORIZON_BARS || 12);
const FETCH_LIMIT = Number(process.env.CANDIDATE_FETCH_LIMIT || 1500);

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function normalizeDirection(value, fallback = "LONG") {
  const raw = String(value || fallback).toUpperCase();
  if (raw === "SELL") return "SHORT";
  if (raw === "BUY") return "LONG";
  if (raw === "SHORT") return "SHORT";
  return "LONG";
}

function tfToMs(tf) {
  const match = String(tf || "").trim().match(/^(\d+)(m|h|d|w)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  if (unit === "d") return amount * 24 * 60 * 60 * 1000;
  if (unit === "w") return amount * 7 * 24 * 60 * 60 * 1000;
  return null;
}

function toIso(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
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
  if (!Array.isArray(rows) || rows.length === 0) return "";

  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row?.[header])).join(",")),
  ].join("\n");
}

function flattenObject(prefix, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const flat = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === null || inner === undefined) continue;

    if (
      typeof inner === "object" &&
      !Array.isArray(inner) &&
      Object.keys(inner).length > 0
    ) {
      Object.assign(flat, flattenObject(`${prefix}${key}_`, inner));
      continue;
    }

    flat[`${prefix}${key}`] = inner;
  }

  return flat;
}

function buildCandidateKey(candidate) {
  if (candidate.executionOrderId) {
    return `exec|${candidate.executionOrderId}`;
  }

  const intervalMs = tfToMs(candidate.tf);
  const rawTs = Number(
    candidate.signalCandleCloseTime || candidate.signalTs || candidate.logTs || 0
  );
  const candleBucket =
    Number.isFinite(intervalMs) && intervalMs > 0 && Number.isFinite(rawTs) && rawTs > 0
      ? Math.floor(rawTs / intervalMs)
      : rawTs;

  return [
    candidate.symbol,
    candidate.tf,
    candidate.strategy,
    candidate.direction,
    candleBucket,
    candidate.entry,
    candidate.sl,
    candidate.tp,
  ].join("|");
}

function buildCandidateRow(logRow, candidate, index) {
  const signalCandleCloseTime = toNumber(
    logRow.signalCandleCloseTime ?? logRow.candleCloseTime ?? logRow.ts
  );

  const direction = normalizeDirection(candidate?.direction ?? logRow?.selectedDirection);
  const entry = toNumber(candidate?.entry);
  const sl = toNumber(candidate?.sl);
  const tp = toNumber(candidate?.tp);

  if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp)) {
    return null;
  }

  const riskAbs = Math.abs(entry - sl);
  const rewardAbs = Math.abs(tp - entry);
  const rrPlanned =
    riskAbs > 0 && Number.isFinite(rewardAbs) ? round(rewardAbs / riskAbs, 8) : null;

  return {
    sourceIndex: index,
    signalTs: toNumber(logRow.ts),
    signalIso: toIso(logRow.ts),
    signalCandleCloseTime,
    signalCandleCloseIso: toIso(signalCandleCloseTime),
    symbol: logRow.symbol,
    tf: logRow.tf,
    strategy: candidate.strategy,
    direction,
    selectedStrategy: logRow.selectedStrategy || null,
    selectedDirection: normalizeDirection(logRow.selectedDirection, direction),
    selectedCandidate: logRow.selectedStrategy === candidate.strategy,
    decisionReason: logRow.decisionReason || null,
    candidateReason: candidate.reason || null,
    executionAttempted: logRow.executionAttempted === true,
    executionApproved: logRow.executionApproved === true,
    executionReason: logRow.executionReason || null,
    executionOrderId: logRow.executionOrderId || null,
    allowed: candidate.allowed === true,
    score: toNumber(candidate.score ?? logRow.score),
    signalClass: candidate.signalClass || logRow.signalClass || null,
    minScore: toNumber(candidate.minScore),
    price: toNumber(logRow.price),
    entry,
    sl,
    tp,
    tpRawAtr: toNumber(candidate.tpRawAtr ?? candidate.rawTp),
    tpCappedByResistance: candidate.tpCappedByResistance === true,
    tpCappedBySupport: candidate.tpCappedBySupport === true,
    riskAbs: round(riskAbs, 8),
    rewardAbs: round(rewardAbs, 8),
    rrPlanned,
    rrPlannedFromLog: toNumber(logRow.rrPlanned),
    rsi: toNumber(logRow.rsi),
    prevRsi: toNumber(logRow.prevRsi),
    atr: toNumber(logRow.atr),
    atrPct: toNumber(logRow.atrPct),
    adx: toNumber(logRow.adx),
    ema20: toNumber(logRow.ema20),
    ema50: toNumber(logRow.ema50),
    ema200: toNumber(logRow.ema200),
    bullish: logRow.bullish === true,
    bullishFast: logRow.bullishFast === true,
    nearEma20: logRow.nearEma20 === true,
    nearEma50: logRow.nearEma50 === true,
    nearPullback: logRow.nearPullback === true,
    stackedEma: logRow.stackedEma === true,
    rsiInBand: logRow.rsiInBand === true,
    rsiRising: logRow.rsiRising === true,
    isTrend: logRow.isTrend === true,
    isRange: logRow.isRange === true,
    emaSeparationPct: toNumber(logRow.emaSeparationPct),
    emaSlopePct: toNumber(logRow.emaSlopePct),
    distToEma20: toNumber(logRow.distToEma20),
    distToEma50: toNumber(logRow.distToEma50),
    nearestSupport: toNumber(logRow.nearestSupport),
    nearestResistance: toNumber(logRow.nearestResistance),
    distanceToSupportAtr: toNumber(logRow.distanceToSupportAtr),
    distanceToResistanceAtr: toNumber(logRow.distanceToResistanceAtr),
    srPassed: logRow.srPassed === true,
    srReason: logRow.srReason || null,
    avgVol: toNumber(logRow.avgVol),
    ...flattenObject("candidateMeta_", candidate.meta),
  };
}

function buildSignalCandidateRow(signal, index, sourceType) {
  if (!signal?.symbol || !signal?.tf || !signal?.strategy) return null;

  const direction = normalizeDirection(signal.direction);
  const entry = toNumber(signal.entry);
  const sl = toNumber(signal.sl);
  const tp = toNumber(signal.tp);

  if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp)) {
    return null;
  }

  const riskAbs = Math.abs(entry - sl);
  const rewardAbs = Math.abs(tp - entry);

  return {
    sourceType,
    sourceIndex: index,
    signalTs: toNumber(signal.signalTs ?? signal.ts ?? signal.openedTs),
    signalIso: toIso(signal.signalTs ?? signal.ts ?? signal.openedTs),
    signalCandleCloseTime: toNumber(
      signal.signalCandleCloseTime ??
        signal.openedOnCandleCloseTime ??
        signal.lastTrackedCandleCloseTime ??
        signal.signalTs ??
        signal.ts
    ),
    signalCandleCloseIso: toIso(
      signal.signalCandleCloseTime ??
        signal.openedOnCandleCloseTime ??
        signal.lastTrackedCandleCloseTime ??
        signal.signalTs ??
        signal.ts
    ),
    symbol: signal.symbol,
    tf: signal.tf,
    strategy: signal.strategy,
    direction,
    selectedStrategy: signal.strategy,
    selectedDirection: direction,
    selectedCandidate: true,
    decisionReason: signal.executionReason || signal.outcome || null,
    candidateReason: signal.outcome || signal.executionReason || "selected",
    executionAttempted: signal.executionAttempted === true || Boolean(signal.executionOrderId),
    executionApproved:
      signal.executionApproved === true ||
      Boolean(signal.executionOrderId) ||
      sourceType === "closedSignal" ||
      sourceType === "openSignal",
    executionReason: signal.executionReason || null,
    executionOrderId: signal.executionOrderId || signal.executionId || null,
    allowed: true,
    score: toNumber(signal.score),
    signalClass: signal.signalClass || null,
    minScore: toNumber(signal.selectedMinScore ?? signal.minScore),
    price: toNumber(signal.price ?? signal.entry),
    entry,
    sl,
    tp,
    tpRawAtr: toNumber(signal.tpRawAtr ?? signal.rawTp),
    tpCappedByResistance: signal.tpCappedByResistance === true,
    tpCappedBySupport: signal.tpCappedBySupport === true,
    riskAbs: round(riskAbs, 8),
    rewardAbs: round(rewardAbs, 8),
    rrPlanned: riskAbs > 0 && Number.isFinite(rewardAbs) ? round(rewardAbs / riskAbs, 8) : null,
    rrPlannedFromLog: toNumber(signal.rrPlanned),
    rsi: toNumber(signal.rsi),
    prevRsi: toNumber(signal.prevRsi),
    atr: toNumber(signal.atr),
    atrPct: toNumber(signal.atrPct),
    adx: toNumber(signal.adx),
    ema20: toNumber(signal.ema20),
    ema50: toNumber(signal.ema50),
    ema200: toNumber(signal.ema200),
    bullish: signal.bullish === true,
    bullishFast: signal.bullishFast === true,
    nearEma20: signal.nearEma20 === true,
    nearEma50: signal.nearEma50 === true,
    nearPullback: signal.nearPullback === true,
    stackedEma: signal.stackedEma === true,
    rsiInBand: signal.rsiInBand === true,
    rsiRising: signal.rsiRising === true,
    isTrend: signal.isTrend === true,
    isRange: signal.isRange === true,
    emaSeparationPct: toNumber(signal.emaSeparationPct),
    emaSlopePct: toNumber(signal.emaSlopePct),
    distToEma20: toNumber(signal.distToEma20),
    distToEma50: toNumber(signal.distToEma50),
    nearestSupport: toNumber(signal.nearestSupport),
    nearestResistance: toNumber(signal.nearestResistance),
    distanceToSupportAtr: toNumber(signal.distanceToSupportAtr),
    distanceToResistanceAtr: toNumber(signal.distanceToResistanceAtr),
    srPassed: signal.srPassed === true,
    srReason: signal.srReason || null,
    avgVol: toNumber(signal.avgVol),
  };
}

function extractCandidateRowsFromSignalLog(signalLog = []) {
  const deduped = new Map();

  for (const [index, logRow] of (Array.isArray(signalLog) ? signalLog : []).entries()) {
    if (!logRow?.symbol || !logRow?.tf || !Array.isArray(logRow?.strategyCandidates)) {
      continue;
    }

    for (const candidate of logRow.strategyCandidates) {
      const row = buildCandidateRow(logRow, candidate, index);
      if (!row) continue;

      const key = buildCandidateKey(row);
      if (!deduped.has(key)) {
        deduped.set(key, row);
      }
    }
  }

  return Array.from(deduped.values()).sort(
    (a, b) => Number(a.signalCandleCloseTime || a.signalTs || 0) - Number(b.signalCandleCloseTime || b.signalTs || 0)
  );
}

function extractCandidateRows(stateOrSignalLog = []) {
  if (Array.isArray(stateOrSignalLog)) {
    return extractCandidateRowsFromSignalLog(stateOrSignalLog);
  }

  const deduped = new Map();
  const signalLogRows = extractCandidateRowsFromSignalLog(stateOrSignalLog?.signalLog || []);

  for (const row of signalLogRows) {
    deduped.set(buildCandidateKey(row), row);
  }

  for (const [sourceType, rows] of [
    ["closedSignal", stateOrSignalLog?.closedSignals || []],
    ["openSignal", stateOrSignalLog?.openSignals || []],
  ]) {
    for (const [index, signal] of rows.entries()) {
      const row = buildSignalCandidateRow(signal, index, sourceType);
      if (!row) continue;

      const key = buildCandidateKey(row);
      if (!deduped.has(key)) {
        deduped.set(key, row);
      }
    }
  }

  return Array.from(deduped.values()).sort(
    (a, b) =>
      Number(a.signalCandleCloseTime || a.signalTs || 0) -
      Number(b.signalCandleCloseTime || b.signalTs || 0)
  );
}

async function fetchFuturesKlinesRange(symbol, interval, { startTime, endTime }) {
  const rows = [];
  let cursor = Number(startTime);
  const limit = Math.min(Math.max(Number(FETCH_LIMIT) || 1500, 100), 1500);

  while (Number.isFinite(cursor) && cursor < endTime) {
    const { data } = await axios.get(`${BINANCE_FUTURES_BASE}/fapi/v1/klines`, {
      params: {
        symbol,
        interval,
        limit,
        startTime: cursor,
        endTime,
      },
      timeout: 20000,
    });

    if (!Array.isArray(data) || data.length === 0) break;

    for (const kline of data) {
      rows.push({
        openTime: Number(kline[0]),
        open: Number(kline[1]),
        high: Number(kline[2]),
        low: Number(kline[3]),
        close: Number(kline[4]),
        volume: Number(kline[5]),
        closeTime: Number(kline[6]),
      });
    }

    const last = data[data.length - 1];
    const nextCursor = Number(last?.[6]) + 1;
    if (!Number.isFinite(nextCursor) || nextCursor <= cursor) break;
    cursor = nextCursor;

    if (data.length < limit) break;
  }

  const deduped = new Map();
  for (const row of rows) {
    deduped.set(row.closeTime, row);
  }

  return Array.from(deduped.values()).sort((a, b) => a.closeTime - b.closeTime);
}

async function fetchCandlesForCandidateGroups(candidates, { horizonBars = HORIZON_BARS } = {}) {
  const grouped = new Map();

  for (const candidate of candidates) {
    const groupKey = `${candidate.symbol}__${candidate.tf}`;
    const intervalMs = tfToMs(candidate.tf);
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        symbol: candidate.symbol,
        tf: candidate.tf,
        intervalMs,
        minTs: candidate.signalCandleCloseTime || candidate.signalTs,
        maxTs: candidate.signalCandleCloseTime || candidate.signalTs,
      });
      continue;
    }

    const group = grouped.get(groupKey);
    const currentTs = Number(candidate.signalCandleCloseTime || candidate.signalTs || 0);
    group.minTs = Math.min(group.minTs, currentTs);
    group.maxTs = Math.max(group.maxTs, currentTs);
  }

  const result = new Map();

  for (const [groupKey, group] of grouped.entries()) {
    if (!Number.isFinite(group.intervalMs) || group.intervalMs <= 0) continue;

    const startTime = Math.max(0, group.minTs - group.intervalMs * 3);
    const endTime = group.maxTs + group.intervalMs * (horizonBars + 3);
    const candles = await fetchFuturesKlinesRange(group.symbol, group.tf, {
      startTime,
      endTime,
    });

    result.set(groupKey, candles);
  }

  return result;
}

function findReferenceCandleIndex(candles, targetTs) {
  if (!Array.isArray(candles) || candles.length === 0) return -1;
  const target = Number(targetTs);
  if (!Number.isFinite(target) || target <= 0) return -1;

  let idx = -1;
  for (let i = 0; i < candles.length; i += 1) {
    if (Number(candles[i].closeTime) <= target) {
      idx = i;
    } else {
      break;
    }
  }

  if (idx >= 0) return idx;

  return candles.findIndex((candle) => Number(candle.closeTime) >= target);
}

function calcDirectionalPnlPct(direction, entry, price) {
  const e = Number(entry);
  const x = Number(price);
  if (!Number.isFinite(e) || !Number.isFinite(x) || e <= 0) return null;

  if (normalizeDirection(direction) === "SHORT") {
    return ((e - x) / e) * 100;
  }

  return ((x - e) / e) * 100;
}

function labelCandidateWithCandles(candidate, candles, { horizonBars = HORIZON_BARS } = {}) {
  const direction = normalizeDirection(candidate.direction);
  const referenceIndex = findReferenceCandleIndex(
    candles,
    candidate.signalCandleCloseTime || candidate.signalTs
  );

  if (referenceIndex < 0) {
    return {
      labelOutcome: "NO_REFERENCE",
      labelBucket: "missing",
      barsObserved: 0,
    };
  }

  const futureCandles = candles.slice(referenceIndex + 1, referenceIndex + 1 + horizonBars);

  if (futureCandles.length === 0) {
    return {
      referenceCandleCloseTime: candles[referenceIndex]?.closeTime ?? null,
      labelOutcome: "NO_FUTURE",
      labelBucket: "missing",
      barsObserved: 0,
    };
  }

  const riskAbs = Math.abs(Number(candidate.entry) - Number(candidate.sl));
  let maxFavorableAbs = 0;
  let maxAdverseAbs = 0;
  let outcome = "TIMEOUT";
  let outcomePrice = Number(futureCandles[futureCandles.length - 1].close);
  let outcomeTs = Number(futureCandles[futureCandles.length - 1].closeTime);
  let barsToOutcome = futureCandles.length;
  let ambiguous = false;

  for (let index = 0; index < futureCandles.length; index += 1) {
    const candle = futureCandles[index];
    const favorableAbs =
      direction === "SHORT"
        ? Number(candidate.entry) - Number(candle.low)
        : Number(candle.high) - Number(candidate.entry);
    const adverseAbs =
      direction === "SHORT"
        ? Number(candle.high) - Number(candidate.entry)
        : Number(candidate.entry) - Number(candle.low);

    maxFavorableAbs = Math.max(maxFavorableAbs, favorableAbs);
    maxAdverseAbs = Math.max(maxAdverseAbs, adverseAbs);

    const slHit =
      direction === "SHORT"
        ? Number(candle.high) >= Number(candidate.sl)
        : Number(candle.low) <= Number(candidate.sl);
    const tpHit =
      direction === "SHORT"
        ? Number(candle.low) <= Number(candidate.tp)
        : Number(candle.high) >= Number(candidate.tp);

    if (slHit && tpHit) {
      outcome = "AMBIGUOUS";
      outcomePrice = Number(candle.close);
      outcomeTs = Number(candle.closeTime);
      barsToOutcome = index + 1;
      ambiguous = true;
      break;
    }

    if (tpHit) {
      outcome = "TP";
      outcomePrice = Number(candidate.tp);
      outcomeTs = Number(candle.closeTime);
      barsToOutcome = index + 1;
      break;
    }

    if (slHit) {
      outcome = "SL";
      outcomePrice = Number(candidate.sl);
      outcomeTs = Number(candle.closeTime);
      barsToOutcome = index + 1;
      break;
    }
  }

  const mfePct = calcDirectionalPnlPct(
    direction,
    candidate.entry,
    direction === "SHORT"
      ? Number(candidate.entry) - maxFavorableAbs
      : Number(candidate.entry) + maxFavorableAbs
  );
  const maePct = calcDirectionalPnlPct(
    direction,
    candidate.entry,
    direction === "SHORT"
      ? Number(candidate.entry) + maxAdverseAbs
      : Number(candidate.entry) - maxAdverseAbs
  );
  const timeoutPnlPct =
    outcome === "TIMEOUT" ? calcDirectionalPnlPct(direction, candidate.entry, outcomePrice) : null;
  const realizedPnlPct =
    outcome === "TP" || outcome === "SL"
      ? calcDirectionalPnlPct(direction, candidate.entry, outcomePrice)
      : timeoutPnlPct;

  return {
    referenceCandleCloseTime: candles[referenceIndex]?.closeTime ?? null,
    referenceCandleCloseIso: toIso(candles[referenceIndex]?.closeTime),
    labelOutcome: outcome,
    labelBucket:
      outcome === "TP"
        ? "win"
        : outcome === "SL"
        ? "loss"
        : outcome === "TIMEOUT"
        ? "timeout"
        : outcome === "AMBIGUOUS"
        ? "ambiguous"
        : "missing",
    labelTpHit: outcome === "TP" ? 1 : 0,
    labelSlHit: outcome === "SL" ? 1 : 0,
    labelTimeout: outcome === "TIMEOUT" ? 1 : 0,
    labelAmbiguous: ambiguous ? 1 : 0,
    barsObserved: futureCandles.length,
    barsToOutcome,
    labelOutcomeTs: outcomeTs,
    labelOutcomeIso: toIso(outcomeTs),
    labelOutcomePrice: round(outcomePrice, 8),
    labelRealizedPnlPct: round(realizedPnlPct, 8),
    labelTimeoutPnlPct: round(timeoutPnlPct, 8),
    labelMfePct: round(mfePct, 8),
    labelMaePct: round(maePct, 8),
    labelMfeR:
      Number.isFinite(riskAbs) && riskAbs > 0 ? round(maxFavorableAbs / riskAbs, 8) : null,
    labelMaeR:
      Number.isFinite(riskAbs) && riskAbs > 0 ? round(-maxAdverseAbs / riskAbs, 8) : null,
  };
}

function buildSummary(rows, { horizonBars = HORIZON_BARS } = {}) {
  const byOutcome = {};
  const byStrategy = {};

  for (const row of rows) {
    byOutcome[row.labelOutcome] = (byOutcome[row.labelOutcome] || 0) + 1;

    if (!byStrategy[row.strategy]) {
      byStrategy[row.strategy] = {
        total: 0,
        outcomes: {},
        avgRealizedPnlPct: 0,
      };
    }

    const strategyStats = byStrategy[row.strategy];
    strategyStats.total += 1;
    strategyStats.outcomes[row.labelOutcome] =
      (strategyStats.outcomes[row.labelOutcome] || 0) + 1;
    strategyStats.avgRealizedPnlPct += Number(row.labelRealizedPnlPct || 0);
  }

  for (const stats of Object.values(byStrategy)) {
    stats.avgRealizedPnlPct =
      stats.total > 0 ? round(stats.avgRealizedPnlPct / stats.total, 8) : null;
  }

  return {
    generatedAt: new Date().toISOString(),
    horizonBars,
    totalRows: rows.length,
    outcomes: byOutcome,
    strategies: byStrategy,
  };
}

async function buildCandidateLabeledDataset({ horizonBars = HORIZON_BARS } = {}) {
  const state = readJsonSafe(STATE_FILE, {});
  const candidates = extractCandidateRows(state);

  const candlesByGroup = await fetchCandlesForCandidateGroups(candidates, { horizonBars });

  const labeledRows = candidates.map((candidate) => {
    const groupKey = `${candidate.symbol}__${candidate.tf}`;
    const candles = candlesByGroup.get(groupKey) || [];
    return {
      ...candidate,
      ...labelCandidateWithCandles(candidate, candles, { horizonBars }),
    };
  });

  const summary = buildSummary(labeledRows, { horizonBars });

  writeJsonAtomic(OUTPUT_JSON, labeledRows);
  writeJsonAtomic(OUTPUT_SUMMARY, summary);
  writeJsonAtomic(OUTPUT_CSV, toCsv(labeledRows));

  return {
    rows: labeledRows,
    summary,
  };
}

async function main() {
  const { rows, summary } = await buildCandidateLabeledDataset({
    horizonBars: HORIZON_BARS,
  });

  console.log(
    `[CANDIDATE_DATASET] rows=${rows.length} horizonBars=${summary.horizonBars} ` +
      `outcomes=${JSON.stringify(summary.outcomes)}`
  );
  console.log(`[CANDIDATE_DATASET] json=${OUTPUT_JSON}`);
  console.log(`[CANDIDATE_DATASET] csv=${OUTPUT_CSV}`);
  console.log(`[CANDIDATE_DATASET] summary=${OUTPUT_SUMMARY}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[CANDIDATE_DATASET] failed:", err.response?.data || err.message || err);
    process.exit(1);
  });
}

module.exports = {
  tfToMs,
  toCsv,
  buildCandidateRow,
  buildSummary,
  extractCandidateRows,
  labelCandidateWithCandles,
  buildCandidateLabeledDataset,
  normalizeDirection,
};
