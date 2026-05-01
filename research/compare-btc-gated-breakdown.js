require("dotenv").config();

process.env.TF = process.env.BTC_GATED_TF || process.env.TF || "15m";
process.env.HTF_TF = process.env.BTC_GATED_HTF_TF || process.env.HTF_TF || "1d";

const fs = require("fs");
const path = require("path");

const {
  fetchAvailableFuturesSymbols,
  fetchKlines,
  buildBaseContext,
  buildRequestedConfig,
  normalizeResult,
  applyTradeManagementToResult,
  closeTradeIfNeeded,
  buildTradeFeatureSnapshot,
  applyExecutionCostsToTrade,
  resolveTradeManagement,
  round,
} = require("./backtest-candidate-strategies");
const {
  evaluateBreakdownContinuationBaseShortStrategy,
} = require("../strategies/breakdown-continuation-base-short-strategy");
const { buildBtcRegimeSnapshot } = require("../runtime/btc-regime-context");

const BTC_SYMBOL = String(process.env.BTC_GATED_BTC_SYMBOL || "BTCUSDC").trim().toUpperCase();
const DEFAULT_SYMBOLS = ["ADAUSDC", "LINKUSDC", "XRPUSDC", "1000SHIBUSDC", "1000PEPEUSDC"];
const TF = process.env.BTC_GATED_TF || "15m";
const HTF_TF = process.env.BTC_GATED_HTF_TF || "1d";
const LTF_LIMIT = Number(process.env.BTC_GATED_LTF_LIMIT || 2200);
const HTF_LIMIT = Number(process.env.BTC_GATED_HTF_LIMIT || 400);
const GATE_STATES = String(process.env.BTC_GATED_STATES || "risk_off_selloff")
  .split(",")
  .map((value) => String(value || "").trim())
  .filter(Boolean);
const MIN_NEGATIVE_BREADTH = Number(process.env.BTC_GATED_MIN_NEGATIVE_BREADTH || 0.6);
const MIN_FOLLOW_RATE = Number(process.env.BTC_GATED_MIN_FOLLOW_RATE || 0.6);
const INCLUDE_TRADES = String(process.env.BTC_GATED_INCLUDE_TRADES || "0") === "1";

function parseSymbolsOverride(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return DEFAULT_SYMBOLS;

  const symbols = [...new Set(
    rawValue
      .split(",")
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  )];

  return symbols.length ? symbols : DEFAULT_SYMBOLS;
}

function safeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildOutputPaths(symbols) {
  const explicitTag = String(process.env.BTC_GATED_OUTPUT_TAG || "").trim();
  const tag = explicitTag || symbols.map((symbol) => safeSlug(symbol)).join("-");
  const suffix = safeSlug(`${tag}-${TF}`);

  return {
    outputJson: path.join(__dirname, `btc-gated-breakdown-comparison-${suffix}.json`),
    outputSummary: path.join(__dirname, `btc-gated-breakdown-comparison-summary-${suffix}.json`),
  };
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => safeNumber(value))
    .filter((value) => Number.isFinite(value));

  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function getHtfCandlesForTime(htfCandles, closeTime) {
  const rows = Array.isArray(htfCandles) ? htfCandles : [];
  let endIndex = 0;

  while (endIndex < rows.length && Number(rows[endIndex]?.closeTime) <= Number(closeTime)) {
    endIndex += 1;
  }

  return rows.slice(0, endIndex);
}

function buildIndexByCloseTime(candles = []) {
  const map = new Map();

  candles.forEach((candle, index) => {
    const closeTime = Number(candle?.closeTime);
    if (Number.isFinite(closeTime)) {
      map.set(closeTime, index);
    }
  });

  return map;
}

function summarizeTrades(trades) {
  const rows = Array.isArray(trades) ? trades : [];
  const wins = rows.filter((trade) => Number(trade.netPnlPct || 0) > 0);
  const losses = rows.filter((trade) => Number(trade.netPnlPct || 0) < 0);

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const trade of rows) {
    equity += Number(trade.netPnlPct || 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }

  const netProfit = wins.reduce((sum, trade) => sum + Number(trade.netPnlPct || 0), 0);
  const netLossAbs = Math.abs(
    losses.reduce((sum, trade) => sum + Number(trade.netPnlPct || 0), 0)
  );

  return {
    trades: rows.length,
    winrate: rows.length ? round((wins.length / rows.length) * 100, 4) : 0,
    avgNetPnlPct: rows.length ? round(average(rows.map((trade) => trade.netPnlPct)), 6) : 0,
    profitFactorNet: round(netLossAbs > 0 ? netProfit / netLossAbs : netProfit > 0 ? 999 : 0, 6),
    maxDrawdownPct: round(Math.abs(maxDrawdown), 6),
    netPnl: round(rows.reduce((sum, trade) => sum + Number(trade.netPnlPct || 0), 0), 6),
  };
}

function passesBtcGate(snapshot, options = {}) {
  const gateStates = Array.isArray(options.gateStates) ? options.gateStates : GATE_STATES;
  const minNegativeBreadth = Number.isFinite(Number(options.minNegativeBreadth))
    ? Number(options.minNegativeBreadth)
    : MIN_NEGATIVE_BREADTH;
  const minFollowRate = Number.isFinite(Number(options.minFollowRate))
    ? Number(options.minFollowRate)
    : MIN_FOLLOW_RATE;

  if (!snapshot || !gateStates.includes(snapshot.state)) {
    return {
      allowed: false,
      reason: `btc_gate:state_${snapshot?.state || "missing"}`,
    };
  }

  if (snapshot?.btc?.direction !== "down") {
    return {
      allowed: false,
      reason: `btc_gate:btc_direction_${snapshot?.btc?.direction || "unknown"}`,
    };
  }

  if (Number(snapshot?.alts?.negativeBreadth || 0) < minNegativeBreadth) {
    return {
      allowed: false,
      reason: "btc_gate:negative_breadth_too_low",
    };
  }

  if (Number(snapshot?.alts?.followRate || 0) < minFollowRate) {
    return {
      allowed: false,
      reason: "btc_gate:follow_rate_too_low",
    };
  }

  return {
    allowed: true,
    reason: "btc_gate:passed",
  };
}

function buildSnapshotForTime({ candlesBySymbol, indexesBySymbol, closeTime, symbols }) {
  const relevantSymbols = [BTC_SYMBOL, ...symbols];
  const symbolSlices = {};

  for (const symbol of relevantSymbols) {
    const index = indexesBySymbol[symbol]?.get(closeTime);
    if (!Number.isFinite(index) || index < 30) {
      return null;
    }
    symbolSlices[symbol] = (candlesBySymbol[symbol] || []).slice(0, index + 1);
  }

  return buildBtcRegimeSnapshot({
    candlesBySymbol: symbolSlices,
    btcSymbol: BTC_SYMBOL,
    timeframe: TF,
    asOf: new Date(Number(closeTime)).toISOString(),
  });
}

function enableResearchBreakdownProfile(cfg = {}) {
  const base = cfg?.BREAKDOWN_CONTINUATION_BASE_SHORT || cfg?.BREAKDOWN_CONTINUATION_BASE || {};

  return {
    ...cfg,
    BREAKDOWN_CONTINUATION_BASE_SHORT: {
      ...base,
      enabled: true,
    },
  };
}

async function backtestVariant({
  variantName,
  gated,
  symbols,
  runtimeConfig,
  candlesBySymbol,
  htfBySymbol,
  indexesBySymbol,
  tradeManagement,
}) {
  const bySymbol = {};
  const allTrades = [];
  const gateStats = {};

  for (const symbol of symbols) {
    const cfg = enableResearchBreakdownProfile(runtimeConfig[symbol]);
    const ltfCandles = candlesBySymbol[symbol] || [];
    const htfCandles = htfBySymbol[symbol] || [];
    const closedTrades = [];
    let openTrade = null;
    gateStats[symbol] = {
      passed: 0,
      blocked: 0,
      reasons: {},
    };

    for (let i = 220; i < ltfCandles.length - 1; i += 1) {
      const closedLtf = ltfCandles.slice(0, i + 1);
      const currentClosed = closedLtf[closedLtf.length - 1];
      const usableHtf = getHtfCandlesForTime(htfCandles, currentClosed.closeTime);
      const ctx = buildBaseContext({
        symbol,
        cfg,
        candles: closedLtf,
        htfCandles: usableHtf,
      });

      if (!ctx) continue;

      if (openTrade) {
        const closed = closeTradeIfNeeded(openTrade, currentClosed, tradeManagement);
        if (closed) {
          closedTrades.push(applyExecutionCostsToTrade(closed));
          openTrade = null;
        } else {
          openTrade.barsHeld += 1;
        }
      }

      if (openTrade) continue;

      const rawResult = evaluateBreakdownContinuationBaseShortStrategy(ctx);
      const normalized = normalizeResult(
        rawResult,
        "breakdownContinuationBaseShort",
        "SHORT",
        ctx.indicators.entry
      );

      if (!normalized) continue;

      const managedResult = applyTradeManagementToResult(normalized, tradeManagement);

      if (gated) {
        const snapshot = buildSnapshotForTime({
          candlesBySymbol,
          indexesBySymbol,
          closeTime: currentClosed.closeTime,
          symbols,
        });
        const gateDecision = passesBtcGate(snapshot);

        if (!gateDecision.allowed) {
          gateStats[symbol].blocked += 1;
          gateStats[symbol].reasons[gateDecision.reason] =
            (gateStats[symbol].reasons[gateDecision.reason] || 0) + 1;
          continue;
        }

        gateStats[symbol].passed += 1;
      }

      openTrade = {
        symbol,
        strategy: managedResult.strategy,
        direction: managedResult.direction,
        openTime: currentClosed.closeTime,
        entry: managedResult.entry,
        sl: managedResult.sl,
        tp: managedResult.tp,
        initialSl: managedResult.sl,
        initialTp: managedResult.tp,
        score: managedResult.score,
        signalClass: managedResult.signalClass,
        minScore: managedResult.minScore,
        reason: gated ? `${managedResult.reason}|btc_gate` : managedResult.reason,
        barsHeld: 0,
        breakEvenApplied: false,
        breakEvenAtR: null,
        prevSl: null,
        initialRiskAbs: Math.abs(Number(managedResult.entry) - Number(managedResult.sl)),
        management: resolveTradeManagement(tradeManagement),
        ...buildTradeFeatureSnapshot({
          symbol,
          ctx,
          result: managedResult,
          currentClosed,
        }),
      };
    }

    bySymbol[symbol] = {
      summary: summarizeTrades(closedTrades),
      gateStats: gateStats[symbol],
      ...(INCLUDE_TRADES ? { trades: closedTrades } : {}),
    };
    allTrades.push(...closedTrades);
  }

  return {
    variant: variantName,
    gated,
    gateStates: GATE_STATES,
    summary: summarizeTrades(allTrades),
    bySymbol,
    ...(INCLUDE_TRADES ? { trades: allTrades } : {}),
  };
}

async function main() {
  const symbols = parseSymbolsOverride(process.env.BTC_GATED_SYMBOLS);
  const { outputJson, outputSummary } = buildOutputPaths(symbols);
  const availableSymbols = await fetchAvailableFuturesSymbols();
  const unavailableSymbols = symbols.filter((symbol) => !availableSymbols.has(symbol));

  if (!availableSymbols.has(BTC_SYMBOL)) {
    throw new Error(`BTC context symbol not available on Binance Futures: ${BTC_SYMBOL}`);
  }

  if (unavailableSymbols.length) {
    throw new Error(`Unavailable symbols: ${unavailableSymbols.join(", ")}`);
  }

  const runtimeConfig = buildRequestedConfig(symbols);
  const candlesBySymbol = {};
  const htfBySymbol = {};
  const indexesBySymbol = {};

  for (const symbol of [BTC_SYMBOL, ...symbols]) {
    console.log(`[BTC GATED] ${symbol} ${TF}/${HTF_TF}`);
    const [ltfCandles, htfCandles] = await Promise.all([
      fetchKlines(symbol, TF, LTF_LIMIT),
      fetchKlines(symbol, HTF_TF, HTF_LIMIT),
    ]);
    candlesBySymbol[symbol] = ltfCandles;
    indexesBySymbol[symbol] = buildIndexByCloseTime(ltfCandles);
    if (symbol !== BTC_SYMBOL) {
      htfBySymbol[symbol] = htfCandles;
    }
  }

  const variants = [];
  variants.push(
    await backtestVariant({
      variantName: "ungated",
      gated: false,
      symbols,
      runtimeConfig,
      candlesBySymbol,
      htfBySymbol,
      indexesBySymbol,
      tradeManagement: null,
    })
  );
  variants.push(
    await backtestVariant({
      variantName: "btc_gated",
      gated: true,
      symbols,
      runtimeConfig,
      candlesBySymbol,
      htfBySymbol,
      indexesBySymbol,
      tradeManagement: null,
    })
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    btcSymbol: BTC_SYMBOL,
    timeframe: TF,
    htfTf: HTF_TF,
    symbols,
    gateStates: GATE_STATES,
    minNegativeBreadth: MIN_NEGATIVE_BREADTH,
    minFollowRate: MIN_FOLLOW_RATE,
    variants,
  };

  fs.writeFileSync(outputJson, JSON.stringify(variants, null, 2), "utf8");
  fs.writeFileSync(outputSummary, JSON.stringify(summary, null, 2), "utf8");

  console.log(`Saved variants: ${outputJson}`);
  console.log(`Saved summary: ${outputSummary}`);
  variants.forEach((variant) => {
    console.log(
      `${variant.variant}: trades=${variant.summary.trades} ` +
        `winrate=${Number(variant.summary.winrate || 0).toFixed(2)}% ` +
        `avgNet=${Number(variant.summary.avgNetPnlPct || 0).toFixed(4)}% ` +
        `pfNet=${Number(variant.summary.profitFactorNet || 0).toFixed(3)} ` +
        `maxDD=${Number(variant.summary.maxDrawdownPct || 0).toFixed(4)}`
    );
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  parseSymbolsOverride,
  buildOutputPaths,
  passesBtcGate,
  summarizeTrades,
  buildSnapshotForTime,
};
