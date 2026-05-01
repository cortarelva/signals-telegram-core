require("dotenv").config();

process.env.TF = process.env.FIB_COMPARE_TF || process.env.TF || "1h";
process.env.HTF_TF = process.env.FIB_COMPARE_HTF_TF || process.env.HTF_TF || "1d";

const fs = require("fs");
const path = require("path");

const { collectSwings } = require("../runtime/market-structure");
const {
  fetchAvailableFuturesSymbols,
  fetchKlines,
  buildBaseContext,
  buildRequestedConfig,
  resolveRequestedStrategies,
  normalizeResult,
  applyTradeManagementToResult,
  closeTradeIfNeeded,
  buildTradeFeatureSnapshot,
  resolveTradeManagement,
  round,
} = require("./backtest-candidate-strategies");

const DEFAULT_SYMBOLS = ["BTCUSDC", "ETHUSDC"];
const DEFAULT_STRATEGIES = ["breakdownRetestShort", "cipherContinuationShort"];
const TF = process.env.FIB_COMPARE_TF || "1h";
const HTF_TF = process.env.FIB_COMPARE_HTF_TF || "1d";
const LTF_LIMIT = Number(process.env.FIB_COMPARE_LTF_LIMIT || 1800);
const HTF_LIMIT = Number(process.env.FIB_COMPARE_HTF_LIMIT || 320);
const INCLUDE_TRADES = String(process.env.FIB_COMPARE_INCLUDE_TRADES || "0") === "1";

const DEFAULT_VARIANTS = [
  {
    name: "baseline",
    label: "Baseline",
    gated: false,
  },
  {
    name: "fibPullback38to62",
    label: "Fib pullback 0.382-0.618",
    gated: true,
    pivotLookback: 2,
    minRetrace: 0.382,
    maxRetrace: 0.618,
    maxImpulseAgeBars: 24,
  },
  {
    name: "fibPullback50to79",
    label: "Fib pullback 0.500-0.786",
    gated: true,
    pivotLookback: 2,
    minRetrace: 0.5,
    maxRetrace: 0.786,
    maxImpulseAgeBars: 24,
  },
];

function parseList(rawValue, fallback = []) {
  if (!rawValue || typeof rawValue !== "string") return [...fallback];
  const items = rawValue
    .split(",")
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : [...fallback];
}

function parseSymbolsOverride(rawValue) {
  return parseList(rawValue, DEFAULT_SYMBOLS).map((symbol) =>
    String(symbol).trim().toUpperCase()
  );
}

function parseStrategiesOverride(rawValue) {
  return parseList(rawValue, DEFAULT_STRATEGIES);
}

function safeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildOutputPaths(symbols, strategies) {
  const symbolTag = symbols.map((symbol) => safeSlug(symbol)).join("-");
  const strategyTag = strategies.map((strategy) => safeSlug(strategy)).join("-");
  const suffix = safeSlug(`${symbolTag}-${strategyTag}-${TF}`);

  return {
    outputJson: path.join(__dirname, `fibonacci-filter-comparison-${suffix}.json`),
    outputMd: path.join(__dirname, `fibonacci-filter-comparison-${suffix}.md`),
  };
}

function average(values) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
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

function rankRows(rows) {
  return [...rows].sort((a, b) => {
    const aTrades = Number(a?.summary?.trades || 0);
    const bTrades = Number(b?.summary?.trades || 0);
    const aQualified = aTrades >= 3 ? 1 : 0;
    const bQualified = bTrades >= 3 ? 1 : 0;
    if (bQualified !== aQualified) return bQualified - aQualified;

    const avgDelta =
      Number(b?.summary?.avgNetPnlPct || 0) - Number(a?.summary?.avgNetPnlPct || 0);
    if (avgDelta !== 0) return avgDelta;

    const pfDelta =
      Number(b?.summary?.profitFactorNet || 0) - Number(a?.summary?.profitFactorNet || 0);
    if (pfDelta !== 0) return pfDelta;

    return bTrades - aTrades;
  });
}

function findDirectionalImpulse(swings, direction) {
  if (!swings || !Array.isArray(swings.highs) || !Array.isArray(swings.lows)) {
    return null;
  }

  if (direction === "SHORT") {
    const low = swings.lows[swings.lows.length - 1] || null;
    if (!low) return null;
    const high = [...swings.highs].reverse().find((row) => row.index < low.index) || null;
    if (!high) return null;
    return { anchorA: high, anchorB: low };
  }

  const high = swings.highs[swings.highs.length - 1] || null;
  if (!high) return null;
  const low = [...swings.lows].reverse().find((row) => row.index < high.index) || null;
  if (!low) return null;
  return { anchorA: low, anchorB: high };
}

function buildFibPullbackContext({
  candles,
  candleIndex,
  direction,
  pivotLookback = 2,
  maxImpulseAgeBars = 24,
  maxPullbackAgeBars = 8,
}) {
  if (!Array.isArray(candles) || !candles.length) {
    return { valid: false, reason: "fib_gate:no_candles" };
  }

  const current = candles[candleIndex];
  const currentClose = Number(current?.close);
  if (!Number.isFinite(currentClose)) {
    return { valid: false, reason: "fib_gate:invalid_close" };
  }

  const slice = candles.slice(0, candleIndex + 1);
  const swings = collectSwings(slice, pivotLookback);
  const side = String(direction || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const impulse = findDirectionalImpulse(swings, side);

  if (!impulse) {
    return { valid: false, reason: "fib_gate:insufficient_swings" };
  }

  const start = impulse.anchorA;
  const end = impulse.anchorB;
  const impulseSize = Math.abs(Number(end.price) - Number(start.price));
  if (!Number.isFinite(impulseSize) || impulseSize <= 0) {
    return { valid: false, reason: "fib_gate:invalid_impulse" };
  }

  const impulseAgeBars = candleIndex - end.index;
  if (!Number.isFinite(impulseAgeBars) || impulseAgeBars < 0) {
    return { valid: false, reason: "fib_gate:invalid_impulse_age" };
  }

  if (impulseAgeBars > Number(maxImpulseAgeBars || 24)) {
    return {
      valid: false,
      reason: "fib_gate:stale_impulse",
      impulseAgeBars,
    };
  }

  let retracementFrac;
  let pullbackExtreme;
  let pullbackExtremeIndex;
  if (side === "SHORT") {
    let highestHigh = Number.NEGATIVE_INFINITY;
    let highestHighIndex = null;
    for (let i = end.index + 1; i <= candleIndex; i += 1) {
      const high = Number(slice[i]?.high);
      if (Number.isFinite(high) && high > highestHigh) {
        highestHigh = high;
        highestHighIndex = i;
      }
    }

    pullbackExtreme = highestHigh;
    pullbackExtremeIndex = highestHighIndex;
    retracementFrac = (highestHigh - end.price) / impulseSize;
  } else {
    let lowestLow = Number.POSITIVE_INFINITY;
    let lowestLowIndex = null;
    for (let i = end.index + 1; i <= candleIndex; i += 1) {
      const low = Number(slice[i]?.low);
      if (Number.isFinite(low) && low < lowestLow) {
        lowestLow = low;
        lowestLowIndex = i;
      }
    }

    pullbackExtreme = lowestLow;
    pullbackExtremeIndex = lowestLowIndex;
    retracementFrac = (end.price - lowestLow) / impulseSize;
  }

  const pullbackAgeBars =
    Number.isFinite(pullbackExtremeIndex) ? candleIndex - pullbackExtremeIndex : null;
  if (
    !Number.isFinite(pullbackExtreme) ||
    !Number.isFinite(pullbackAgeBars) ||
    pullbackAgeBars < 0
  ) {
    return {
      valid: false,
      reason: "fib_gate:missing_pullback_extreme",
    };
  }

  if (pullbackAgeBars > Number(maxPullbackAgeBars || 8)) {
    return {
      valid: false,
      reason: "fib_gate:stale_pullback",
      impulseAgeBars,
      pullbackAgeBars,
      pullbackExtreme,
      pullbackExtremeIndex,
    };
  }

  return {
    valid: true,
    direction: side,
    reason: "fib_gate:context_ready",
    currentClose,
    impulseAgeBars,
    impulseStart: start.price,
    impulseEnd: end.price,
    impulseStartIndex: start.index,
    impulseEndIndex: end.index,
    impulseSize,
    retracementFrac,
    pullbackExtreme,
    pullbackExtremeIndex,
    pullbackAgeBars,
    fib382:
      side === "SHORT"
        ? end.price + impulseSize * 0.382
        : end.price - impulseSize * 0.382,
    fib500:
      side === "SHORT"
        ? end.price + impulseSize * 0.5
        : end.price - impulseSize * 0.5,
    fib618:
      side === "SHORT"
        ? end.price + impulseSize * 0.618
        : end.price - impulseSize * 0.618,
    fib786:
      side === "SHORT"
        ? end.price + impulseSize * 0.786
        : end.price - impulseSize * 0.786,
  };
}

function passesFibGate({ candles, candleIndex, direction, variant }) {
  if (!variant?.gated) {
    return {
      allowed: true,
      reason: "fib_gate:not_enabled",
      meta: {},
    };
  }

  const fib = buildFibPullbackContext({
    candles,
    candleIndex,
    direction,
    pivotLookback: Number(variant.pivotLookback || 2),
    maxImpulseAgeBars: Number(variant.maxImpulseAgeBars || 24),
    maxPullbackAgeBars: Number(variant.maxPullbackAgeBars || 8),
  });

  if (!fib.valid) {
    return {
      allowed: false,
      reason: fib.reason,
      meta: fib,
    };
  }

  const retracementFrac = Number(fib.retracementFrac);
  const minRetrace = Number(variant.minRetrace || 0);
  const maxRetrace = Number(variant.maxRetrace || 1);

  if (!Number.isFinite(retracementFrac) || retracementFrac < 0) {
    return {
      allowed: false,
      reason: "fib_gate:retracement_too_shallow",
      meta: fib,
    };
  }

  if (retracementFrac < minRetrace) {
    return {
      allowed: false,
      reason: "fib_gate:retracement_too_shallow",
      meta: fib,
    };
  }

  if (retracementFrac > maxRetrace) {
    return {
      allowed: false,
      reason: "fib_gate:retracement_too_deep",
      meta: fib,
    };
  }

  return {
    allowed: true,
    reason: "fib_gate:passed",
    meta: fib,
  };
}

function initGateStats() {
  return {
    passed: 0,
    blocked: 0,
    reasons: {},
  };
}

function bumpGateReason(stats, reason) {
  stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
}

function buildTradeRecord({ symbol, ctx, result, currentClosed, gateMeta, tradeManagement }) {
  return {
    symbol,
    strategy: result.strategy,
    direction: result.direction,
    openTime: currentClosed.closeTime,
    entry: result.entry,
    sl: result.sl,
    tp: result.tp,
    initialSl: result.sl,
    initialTp: result.tp,
    score: result.score,
    signalClass: result.signalClass,
    minScore: result.minScore,
    reason: result.reason,
    barsHeld: 0,
    breakEvenApplied: false,
    breakEvenAtR: null,
    prevSl: null,
    initialRiskAbs: Math.abs(Number(result.entry) - Number(result.sl)),
    management: resolveTradeManagement(tradeManagement),
    ...buildTradeFeatureSnapshot({
      symbol,
      ctx,
      result: {
        ...result,
        meta: {
          ...(result.meta || {}),
          fibGateReason: gateMeta?.reason || null,
          fibGateRetracementFrac: Number.isFinite(Number(gateMeta?.meta?.retracementFrac))
            ? Number(gateMeta.meta.retracementFrac)
            : null,
          fibGateImpulseAgeBars: Number.isFinite(Number(gateMeta?.meta?.impulseAgeBars))
            ? Number(gateMeta.meta.impulseAgeBars)
            : null,
          fibGatePullbackAgeBars: Number.isFinite(Number(gateMeta?.meta?.pullbackAgeBars))
            ? Number(gateMeta.meta.pullbackAgeBars)
            : null,
          fibGateImpulseStart: Number.isFinite(Number(gateMeta?.meta?.impulseStart))
            ? Number(gateMeta.meta.impulseStart)
            : null,
          fibGateImpulseEnd: Number.isFinite(Number(gateMeta?.meta?.impulseEnd))
            ? Number(gateMeta.meta.impulseEnd)
            : null,
        },
      },
      currentClosed,
    }),
  };
}

async function backtestVariant({
  variant,
  strategyDefs,
  symbols,
  runtimeConfig,
  symbolData,
  tradeManagement,
}) {
  const strategyRows = [];
  const allTrades = [];

  for (const strategyDef of strategyDefs) {
    const bySymbol = {};
    const strategyTrades = [];

    for (const symbol of symbols) {
      const cfg = runtimeConfig[symbol];
      const { ltfCandles, htfCandles } = symbolData[symbol];
      const closedTrades = [];
      const gateStats = initGateStats();
      let openTrade = null;

      for (let i = 220; i < ltfCandles.length - 1; i += 1) {
        const closedLtf = ltfCandles.slice(0, i + 1);
        const currentClosed = closedLtf[closedLtf.length - 1];
        const usableHtf = htfCandles.filter(
          (candle) => Number(candle.closeTime) <= Number(currentClosed.closeTime)
        );
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
            closedTrades.push(closed);
            openTrade = null;
          } else {
            openTrade.barsHeld += 1;
          }
        }

        if (openTrade) continue;

        let rawResult;
        try {
          rawResult = strategyDef.evaluate(ctx);
        } catch {
          rawResult = null;
        }

        const result = normalizeResult(
          rawResult,
          strategyDef.name,
          strategyDef.direction,
          ctx.indicators.entry
        );
        if (!result) continue;

        const managedResult = applyTradeManagementToResult(result, tradeManagement);
        const gate = passesFibGate({
          candles: ltfCandles,
          candleIndex: i,
          direction: managedResult.direction,
          variant,
        });

        if (variant.gated) {
          if (gate.allowed) {
            gateStats.passed += 1;
          } else {
            gateStats.blocked += 1;
            bumpGateReason(gateStats, gate.reason);
            continue;
          }
        }

        openTrade = buildTradeRecord({
          symbol,
          ctx,
          result: managedResult,
          currentClosed,
          gateMeta: gate,
          tradeManagement,
        });
      }

      const symbolSummary = summarizeTrades(closedTrades);
      bySymbol[symbol] = {
        summary: symbolSummary,
        sampleTrades: closedTrades.slice(-3),
        gateStats,
        ...(INCLUDE_TRADES ? { trades: closedTrades } : {}),
      };

      strategyTrades.push(...closedTrades);
      allTrades.push(...closedTrades);
    }

    strategyRows.push({
      strategy: strategyDef.name,
      direction: strategyDef.direction,
      summary: summarizeTrades(strategyTrades),
      bySymbol,
    });
  }

  return {
    variant: {
      ...variant,
    },
    summary: summarizeTrades(allTrades),
    strategies: rankRows(strategyRows),
  };
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push("# Fibonacci Filter Comparison");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Symbols: ${report.symbols.join(", ")}`);
  lines.push(`Strategies: ${report.strategies.join(", ")}`);
  lines.push(`TF: ${report.tf} | HTF: ${report.htfTf}`);
  lines.push("");

  for (const result of report.results || []) {
    lines.push(`## ${result.variant.label}`);
    lines.push("");
    lines.push(`- trades: ${result.summary.trades}`);
    lines.push(`- avgNet: ${Number(result.summary.avgNetPnlPct || 0).toFixed(4)}%`);
    lines.push(`- profitFactor: ${Number(result.summary.profitFactorNet || 0).toFixed(3)}`);
    lines.push(`- maxDD: ${Number(result.summary.maxDrawdownPct || 0).toFixed(4)}%`);
    lines.push("");

    for (const row of result.strategies || []) {
      lines.push(
        `- ${row.strategy}: trades=${row.summary.trades}, avgNet=${Number(
          row.summary.avgNetPnlPct || 0
        ).toFixed(4)}%, pf=${Number(row.summary.profitFactorNet || 0).toFixed(3)}, maxDD=${Number(
          row.summary.maxDrawdownPct || 0
        ).toFixed(4)}%`
      );
    }

    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const symbols = parseSymbolsOverride(process.env.FIB_COMPARE_SYMBOLS);
  const strategyNames = parseStrategiesOverride(process.env.FIB_COMPARE_STRATEGIES);
  const strategyDefs = resolveRequestedStrategies(strategyNames);
  const tradeManagement = resolveTradeManagement();
  const outputPaths = buildOutputPaths(symbols, strategyNames);
  const runtimeConfig = buildRequestedConfig(symbols);
  const availableSymbols = await fetchAvailableFuturesSymbols();
  const unavailableSymbols = symbols.filter((symbol) => !availableSymbols.has(symbol));

  if (unavailableSymbols.length) {
    throw new Error(
      `Símbolos não disponíveis em Binance Futures: ${unavailableSymbols.join(", ")}`
    );
  }

  const symbolData = {};
  for (const symbol of symbols) {
    console.log(`[FETCH] ${symbol} ${TF}/${HTF_TF}`);
    const [ltfCandles, htfCandles] = await Promise.all([
      fetchKlines(symbol, TF, LTF_LIMIT),
      fetchKlines(symbol, HTF_TF, HTF_LIMIT),
    ]);

    symbolData[symbol] = {
      ltfCandles,
      htfCandles,
    };
  }

  const variants = DEFAULT_VARIANTS.map((variant) => ({
    ...variant,
  }));

  const results = [];
  for (const variant of variants) {
    console.log(`\n[COMPARE] ${variant.label}`);
    results.push(
      await backtestVariant({
        variant,
        strategyDefs,
        symbols,
        runtimeConfig,
        symbolData,
        tradeManagement,
      })
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    tf: TF,
    htfTf: HTF_TF,
    symbols,
    strategies: strategyNames,
    includeTrades: INCLUDE_TRADES,
    tradeManagement,
    variants,
    results,
  };

  fs.writeFileSync(outputPaths.outputJson, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(outputPaths.outputMd, renderMarkdownReport(report), "utf8");

  console.log(`Saved: ${outputPaths.outputJson}`);
  console.log(`Saved: ${outputPaths.outputMd}`);

  for (const result of results) {
    console.log(
      `# ${result.variant.name} trades=${result.summary.trades} avgNet=${result.summary.avgNetPnlPct.toFixed(
        4
      )}% pf=${result.summary.profitFactorNet.toFixed(3)} maxDD=${result.summary.maxDrawdownPct.toFixed(4)}`
    );
  }

  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  parseSymbolsOverride,
  parseStrategiesOverride,
  buildOutputPaths,
  summarizeTrades,
  buildFibPullbackContext,
  passesFibGate,
};
