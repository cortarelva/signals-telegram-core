require("dotenv").config();

process.env.TF = process.env.VORTEX_COMPARE_TF || process.env.TF || "1h";
process.env.HTF_TF = process.env.VORTEX_COMPARE_HTF_TF || process.env.HTF_TF || "1d";

const fs = require("fs");
const path = require("path");

const { calcVortexSeries } = require("../indicators/market-indicators");
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
const DEFAULT_STRATEGIES = [
  "breakdownRetestShort",
  "cipherContinuationLong",
  "cipherContinuationShort",
];
const TF = process.env.VORTEX_COMPARE_TF || "1h";
const HTF_TF = process.env.VORTEX_COMPARE_HTF_TF || "1d";
const LTF_LIMIT = Number(process.env.VORTEX_COMPARE_LTF_LIMIT || 1800);
const HTF_LIMIT = Number(process.env.VORTEX_COMPARE_HTF_LIMIT || 320);
const INCLUDE_TRADES = String(process.env.VORTEX_COMPARE_INCLUDE_TRADES || "0") === "1";

const DEFAULT_VARIANTS = [
  {
    name: "baseline",
    label: "Baseline",
    gated: false,
  },
  {
    name: "vortexAligned14",
    label: "Vortex aligned (14, spread>=0.03)",
    gated: true,
    period: 14,
    minSpread: 0.03,
    requireFreshCross: false,
  },
  {
    name: "vortexFreshCross14",
    label: "Vortex fresh cross (14, <=4 bars)",
    gated: true,
    period: 14,
    minSpread: 0.01,
    requireFreshCross: true,
    maxCrossLookbackBars: 4,
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
    outputJson: path.join(__dirname, `vortex-filter-comparison-${suffix}.json`),
    outputMd: path.join(__dirname, `vortex-filter-comparison-${suffix}.md`),
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

function findDirectionStreakLength(series, index, direction) {
  let streak = 0;

  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const row = series[cursor];
    if (!row || row.direction !== direction) break;
    streak += 1;
  }

  return streak;
}

function passesVortexGate({ series, candleIndex, direction, variant }) {
  if (!variant?.gated) {
    return {
      allowed: true,
      reason: "vortex_gate:not_enabled",
      meta: {},
    };
  }

  const row = Array.isArray(series) ? series[candleIndex] : null;
  if (!row) {
    return {
      allowed: false,
      reason: "vortex_gate:insufficient_context",
      meta: {},
    };
  }

  const desiredDirection = String(direction || "LONG").toUpperCase() === "SHORT" ? "down" : "up";
  if (row.direction !== desiredDirection) {
    return {
      allowed: false,
      reason: `vortex_gate:direction_${row.direction || "flat"}`,
      meta: {
        viPlus: row.viPlus,
        viMinus: row.viMinus,
        spread: row.spread,
      },
    };
  }

  const minSpread = Number(variant.minSpread || 0);
  if (Number(row.spread || 0) < minSpread) {
    return {
      allowed: false,
      reason: "vortex_gate:spread_too_small",
      meta: {
        viPlus: row.viPlus,
        viMinus: row.viMinus,
        spread: row.spread,
      },
    };
  }

  if (variant.requireFreshCross) {
    const streak = findDirectionStreakLength(series, candleIndex, desiredDirection);
    const maxCrossLookbackBars = Number(variant.maxCrossLookbackBars || 4);
    if (!Number.isFinite(streak) || streak > maxCrossLookbackBars) {
      return {
        allowed: false,
        reason: "vortex_gate:cross_stale",
        meta: {
          viPlus: row.viPlus,
          viMinus: row.viMinus,
          spread: row.spread,
          streak,
        },
      };
    }
  }

  return {
    allowed: true,
    reason: "vortex_gate:passed",
    meta: {
      viPlus: row.viPlus,
      viMinus: row.viMinus,
      spread: row.spread,
      streak: findDirectionStreakLength(series, candleIndex, desiredDirection),
    },
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
          vortexGateReason: gateMeta?.reason || null,
          vortexGateViPlus: Number.isFinite(Number(gateMeta?.meta?.viPlus))
            ? Number(gateMeta.meta.viPlus)
            : null,
          vortexGateViMinus: Number.isFinite(Number(gateMeta?.meta?.viMinus))
            ? Number(gateMeta.meta.viMinus)
            : null,
          vortexGateSpread: Number.isFinite(Number(gateMeta?.meta?.spread))
            ? Number(gateMeta.meta.spread)
            : null,
          vortexGateStreak: Number.isFinite(Number(gateMeta?.meta?.streak))
            ? Number(gateMeta.meta.streak)
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
      const { ltfCandles, htfCandles, vortexSeries } = symbolData[symbol];
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
        const gate = passesVortexGate({
          series: vortexSeries,
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
  lines.push("# Vortex Filter Comparison");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Symbols: ${report.symbols.join(", ")}`);
  lines.push(`Strategies: ${report.strategies.join(", ")}`);
  lines.push(`TF: ${report.tf} | HTF: ${report.htfTf}`);
  lines.push("");

  for (const result of report.results || []) {
    lines.push(`## ${result.variant.label}`);
    lines.push("");
    lines.push(
      `- trades: ${result.summary.trades}`
    );
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
  const symbols = parseSymbolsOverride(process.env.VORTEX_COMPARE_SYMBOLS);
  const strategyNames = parseStrategiesOverride(process.env.VORTEX_COMPARE_STRATEGIES);
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
      vortexSeries: calcVortexSeries(ltfCandles, 14),
    };
  }

  const variants = DEFAULT_VARIANTS.map((variant) => ({
    ...variant,
    period: Number(variant.period || 14),
  }));

  for (const symbol of symbols) {
    const ltfCandles = symbolData[symbol].ltfCandles;
    for (const variant of variants) {
      if (!variant.gated) continue;
      symbolData[symbol][`vortexSeries_${variant.period}`] =
        variant.period === 14
          ? symbolData[symbol].vortexSeries
          : calcVortexSeries(ltfCandles, variant.period);
    }
  }

  const resolvedVariants = variants.map((variant) => ({
    ...variant,
    seriesKey: variant.gated ? `vortexSeries_${variant.period}` : "vortexSeries",
  }));

  const results = [];
  for (const variant of resolvedVariants) {
    const variantSymbolData = {};
    for (const symbol of symbols) {
      variantSymbolData[symbol] = {
        ...symbolData[symbol],
        vortexSeries: symbolData[symbol][variant.seriesKey] || [],
      };
    }

    console.log(`\n[COMPARE] ${variant.label}`);
    results.push(
      await backtestVariant({
        variant,
        strategyDefs,
        symbols,
        runtimeConfig,
        symbolData: variantSymbolData,
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
    variants: resolvedVariants,
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
  passesVortexGate,
  findDirectionStreakLength,
};
