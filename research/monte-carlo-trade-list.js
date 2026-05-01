require("dotenv").config();

const fs = require("fs");
const path = require("path");

process.env.TF = process.env.MONTE_TF || process.env.TF || "15m";
process.env.HTF_TF = process.env.MONTE_HTF_TF || process.env.HTF_TF || "1d";

if (process.env.MONTE_LTF_LIMIT && !process.env.BACKTEST_LTF_LIMIT) {
  process.env.BACKTEST_LTF_LIMIT = process.env.MONTE_LTF_LIMIT;
}

if (process.env.MONTE_HTF_LIMIT && !process.env.BACKTEST_HTF_LIMIT) {
  process.env.BACKTEST_HTF_LIMIT = process.env.MONTE_HTF_LIMIT;
}

const {
  runCandidateStrategyBacktest,
  round,
} = require("./backtest-candidate-strategies");

const ITERATIONS = Number(process.env.MONTE_ITERATIONS || 2000);
const SEED = String(process.env.MONTE_SEED || "torus-monte-carlo");
const TF = process.env.MONTE_TF || process.env.TF || "15m";
const HTF_TF = process.env.MONTE_HTF_TF || process.env.HTF_TF || "1d";

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseSymbols(rawValue) {
  return [...new Set(
    String(rawValue || "")
      .split(",")
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  )];
}

function parseStrategies(rawValue) {
  return [...new Set(
    String(rawValue || "")
      .split(",")
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function parseConfigOverrides(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return {};

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function seedFromString(input) {
  let hash = 2166136261;
  const raw = String(input || "");

  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;

  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildRandom(seedSuffix = "") {
  return mulberry32(seedFromString(`${SEED}:${seedSuffix}`));
}

function extractTradeReturn(trade) {
  const net = safeNumber(trade?.netPnlPct);
  if (Number.isFinite(net)) return net;
  const raw = safeNumber(trade?.pnlPct);
  return Number.isFinite(raw) ? raw : 0;
}

function extractTradeRows(resultRow) {
  if (!resultRow || typeof resultRow !== "object") return [];
  const rows = [];

  for (const [symbol, symbolRow] of Object.entries(resultRow.bySymbol || {})) {
    const trades = Array.isArray(symbolRow?.trades) ? symbolRow.trades : [];
    for (const trade of trades) {
      rows.push({
        symbol,
        strategy: resultRow.strategy,
        direction: resultRow.direction,
        ...trade,
      });
    }
  }

  return rows;
}

function summarizeTradeReturns(returns = []) {
  const rows = (Array.isArray(returns) ? returns : [])
    .map((value) => safeNumber(value))
    .filter((value) => Number.isFinite(value));
  const wins = rows.filter((value) => value > 0);
  const losses = rows.filter((value) => value < 0);
  const netPnl = rows.reduce((sum, value) => sum + value, 0);
  const avgNetPnlPct = rows.length ? netPnl / rows.length : 0;
  const netProfit = wins.reduce((sum, value) => sum + value, 0);
  const netLossAbs = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const profitFactorNet = netLossAbs > 0 ? netProfit / netLossAbs : netProfit > 0 ? 999 : 0;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let lossStreak = 0;
  let maxLossStreak = 0;

  for (const value of rows) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);

    if (value < 0) {
      lossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
    } else {
      lossStreak = 0;
    }
  }

  return {
    trades: rows.length,
    winrate: rows.length ? (wins.length / rows.length) * 100 : 0,
    avgNetPnlPct,
    netPnl,
    profitFactorNet,
    maxDrawdownPct: Math.abs(maxDrawdown),
    maxLossStreak,
  };
}

function percentile(values = [], q = 0.5) {
  const rows = (Array.isArray(values) ? values : [])
    .map((value) => safeNumber(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!rows.length) return 0;
  if (rows.length === 1) return rows[0];

  const clampedQ = Math.max(0, Math.min(1, Number(q) || 0));
  const index = (rows.length - 1) * clampedQ;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return rows[lower];
  const weight = index - lower;
  return rows[lower] + (rows[upper] - rows[lower]) * weight;
}

function bootstrapReturns(returns, rng) {
  const rows = Array.isArray(returns) ? returns : [];
  return rows.map(() => rows[Math.floor(rng() * rows.length)]);
}

function shuffleReturns(returns, rng) {
  const rows = [...(Array.isArray(returns) ? returns : [])];

  for (let i = rows.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  return rows;
}

function summarizeSimulationMetrics(metrics = []) {
  const summaries = {
    avgNetPnlPct: [],
    netPnl: [],
    profitFactorNet: [],
    maxDrawdownPct: [],
    maxLossStreak: [],
    winrate: [],
  };

  for (const metric of metrics) {
    Object.keys(summaries).forEach((key) => {
      summaries[key].push(Number(metric?.[key] || 0));
    });
  }

  return {
    p05: {
      avgNetPnlPct: round(percentile(summaries.avgNetPnlPct, 0.05), 6),
      netPnl: round(percentile(summaries.netPnl, 0.05), 6),
      profitFactorNet: round(percentile(summaries.profitFactorNet, 0.05), 6),
      maxDrawdownPct: round(percentile(summaries.maxDrawdownPct, 0.05), 6),
      maxLossStreak: round(percentile(summaries.maxLossStreak, 0.05), 6),
      winrate: round(percentile(summaries.winrate, 0.05), 6),
    },
    median: {
      avgNetPnlPct: round(percentile(summaries.avgNetPnlPct, 0.5), 6),
      netPnl: round(percentile(summaries.netPnl, 0.5), 6),
      profitFactorNet: round(percentile(summaries.profitFactorNet, 0.5), 6),
      maxDrawdownPct: round(percentile(summaries.maxDrawdownPct, 0.5), 6),
      maxLossStreak: round(percentile(summaries.maxLossStreak, 0.5), 6),
      winrate: round(percentile(summaries.winrate, 0.5), 6),
    },
    p95: {
      avgNetPnlPct: round(percentile(summaries.avgNetPnlPct, 0.95), 6),
      netPnl: round(percentile(summaries.netPnl, 0.95), 6),
      profitFactorNet: round(percentile(summaries.profitFactorNet, 0.95), 6),
      maxDrawdownPct: round(percentile(summaries.maxDrawdownPct, 0.95), 6),
      maxLossStreak: round(percentile(summaries.maxLossStreak, 0.95), 6),
      winrate: round(percentile(summaries.winrate, 0.95), 6),
    },
    positiveNetRate: round(
      metrics.length ? metrics.filter((metric) => Number(metric?.netPnl || 0) > 0).length / metrics.length : 0,
      6
    ),
    avgNetPositiveRate: round(
      metrics.length
        ? metrics.filter((metric) => Number(metric?.avgNetPnlPct || 0) > 0).length / metrics.length
        : 0,
      6
    ),
    profitFactorAboveOneRate: round(
      metrics.length
        ? metrics.filter((metric) => Number(metric?.profitFactorNet || 0) > 1).length / metrics.length
        : 0,
      6
    ),
  };
}

function classifyMonteCarloResult(original, bootstrapSummary, shuffleSummary) {
  if (Number(original?.trades || 0) < 8) return "insufficient_sample";

  const lowerAvg = Number(bootstrapSummary?.p05?.avgNetPnlPct || 0);
  const lowerPf = Number(bootstrapSummary?.p05?.profitFactorNet || 0);
  const positiveNetRate = Number(bootstrapSummary?.positiveNetRate || 0);
  const pfAboveOneRate = Number(bootstrapSummary?.profitFactorAboveOneRate || 0);
  const drawdownStress = Number(shuffleSummary?.p95?.maxDrawdownPct || 0);
  const originalDrawdown = Number(original?.maxDrawdownPct || 0);

  if (
    lowerAvg > 0 &&
    lowerPf > 1 &&
    positiveNetRate >= 0.75 &&
    pfAboveOneRate >= 0.7 &&
    drawdownStress <= Math.max(originalDrawdown * 1.5, originalDrawdown + 1)
  ) {
    return "promising";
  }

  if (
    Number(original?.avgNetPnlPct || 0) > 0 &&
    Number(original?.profitFactorNet || 0) > 1 &&
    positiveNetRate >= 0.55 &&
    pfAboveOneRate >= 0.5
  ) {
    return "exploratory";
  }

  return "fragile";
}

function deriveLowerBoundGate(monteCarlo = {}) {
  const original = monteCarlo.original || {};
  const bootstrapP05 = monteCarlo.bootstrap?.p05 || {};
  const shuffledP95 = monteCarlo.shuffledOrder?.p95 || {};
  const originalDrawdown = Number(original.maxDrawdownPct || 0);
  const shuffledDrawdown = Number(shuffledP95.maxDrawdownPct || 0);

  return {
    minTradesPassed: Number(original.trades || 0) >= 12,
    avgNetPositive: Number(original.avgNetPnlPct || 0) > 0,
    profitFactorAboveOne: Number(original.profitFactorNet || 0) > 1,
    lowerBoundAvgPositive: Number(bootstrapP05.avgNetPnlPct || 0) > 0,
    lowerBoundPfAboveOne: Number(bootstrapP05.profitFactorNet || 0) > 1,
    drawdownStressOk:
      shuffledDrawdown <= Math.max(originalDrawdown * 1.5, originalDrawdown + 1),
    lowerBoundAvgNetPnlPct: round(Number(bootstrapP05.avgNetPnlPct || 0), 6),
    lowerBoundProfitFactorNet: round(Number(bootstrapP05.profitFactorNet || 0), 6),
    stressedMaxDrawdownPct: round(shuffledDrawdown, 6),
    originalMaxDrawdownPct: round(originalDrawdown, 6),
  };
}

function derivePromotionDecision(monteCarlo = {}) {
  const recommendation = String(monteCarlo?.recommendation || "no_trades");
  const gate = deriveLowerBoundGate(monteCarlo);
  const original = monteCarlo.original || {};

  if (
    gate.minTradesPassed &&
    gate.avgNetPositive &&
    gate.profitFactorAboveOne &&
    gate.lowerBoundAvgPositive &&
    gate.lowerBoundPfAboveOne &&
    gate.drawdownStressOk
  ) {
    return {
      status: "core",
      reason: "lower_bound_passed",
    };
  }

  if (recommendation === "exploratory") {
    return {
      status: "exploratory",
      reason: "point_estimate_positive_but_lower_bound_weak",
    };
  }

  if (
    recommendation === "insufficient_sample" &&
    Number(original.avgNetPnlPct || 0) > 0 &&
    Number(original.profitFactorNet || 0) > 1
  ) {
    return {
      status: "exploratory",
      reason: "sample_small_but_positive",
    };
  }

  return {
    status: "reject",
    reason:
      recommendation === "no_trades"
        ? "no_trades"
        : recommendation === "fragile"
        ? "fragile_under_lower_bound"
        : "insufficient_edge",
  };
}

function runMonteCarloOnTrades(trades, options = {}) {
  const rows = Array.isArray(trades) ? trades : [];
  const returns = rows.map(extractTradeReturn).filter((value) => Number.isFinite(value));
  const iterations = Math.max(100, Math.floor(Number(options.iterations || ITERATIONS)));
  const original = summarizeTradeReturns(returns);

  if (!returns.length) {
    return {
      original,
      bootstrap: summarizeSimulationMetrics([]),
      shuffledOrder: summarizeSimulationMetrics([]),
      recommendation: "no_trades",
    };
  }

  const bootstrapMetrics = [];
  const shuffleMetrics = [];

  for (let i = 0; i < iterations; i += 1) {
    const bootstrapRng = buildRandom(`bootstrap:${options.seed || SEED}:${i}`);
    const shuffleRng = buildRandom(`shuffle:${options.seed || SEED}:${i}`);
    bootstrapMetrics.push(summarizeTradeReturns(bootstrapReturns(returns, bootstrapRng)));
    shuffleMetrics.push(summarizeTradeReturns(shuffleReturns(returns, shuffleRng)));
  }

  const bootstrap = summarizeSimulationMetrics(bootstrapMetrics);
  const shuffledOrder = summarizeSimulationMetrics(shuffleMetrics);

  return {
    original: {
      trades: original.trades,
      winrate: round(original.winrate, 6),
      avgNetPnlPct: round(original.avgNetPnlPct, 6),
      netPnl: round(original.netPnl, 6),
      profitFactorNet: round(original.profitFactorNet, 6),
      maxDrawdownPct: round(original.maxDrawdownPct, 6),
      maxLossStreak: original.maxLossStreak,
    },
    bootstrap,
    shuffledOrder,
    recommendation: classifyMonteCarloResult(original, bootstrap, shuffledOrder),
    lowerBoundGate: deriveLowerBoundGate({
      original: {
        trades: original.trades,
        winrate: round(original.winrate, 6),
        avgNetPnlPct: round(original.avgNetPnlPct, 6),
        netPnl: round(original.netPnl, 6),
        profitFactorNet: round(original.profitFactorNet, 6),
        maxDrawdownPct: round(original.maxDrawdownPct, 6),
        maxLossStreak: original.maxLossStreak,
      },
      bootstrap,
      shuffledOrder,
    }),
    promotionDecision: derivePromotionDecision({
      original: {
        trades: original.trades,
        winrate: round(original.winrate, 6),
        avgNetPnlPct: round(original.avgNetPnlPct, 6),
        netPnl: round(original.netPnl, 6),
        profitFactorNet: round(original.profitFactorNet, 6),
        maxDrawdownPct: round(original.maxDrawdownPct, 6),
        maxLossStreak: original.maxLossStreak,
      },
      bootstrap,
      shuffledOrder,
      recommendation: classifyMonteCarloResult(original, bootstrap, shuffledOrder),
    }),
  };
}

function buildDefaultOutputPath(symbols, strategies) {
  const symbolTag = symbols.length ? symbols.map((symbol) => safeSlug(symbol)).join("-") : "default";
  const strategyTag = strategies.length
    ? strategies.map((strategy) => safeSlug(strategy)).join("-")
    : "all";

  return path.join(
    __dirname,
    `monte-carlo-${symbolTag}-${strategyTag}-${safeSlug(TF)}.json`
  );
}

async function main() {
  const symbols = parseSymbols(process.env.MONTE_SYMBOLS);
  const strategies = parseStrategies(process.env.MONTE_STRATEGIES);
  const outputFile = process.env.MONTE_OUTPUT_FILE
    ? path.resolve(process.cwd(), process.env.MONTE_OUTPUT_FILE)
    : buildDefaultOutputPath(symbols, strategies);
  const configOverrides = parseConfigOverrides(process.env.MONTE_CONFIG_OVERRIDES);

  const backtestOutput = await runCandidateStrategyBacktest({
    symbols: symbols.length ? symbols : undefined,
    strategies: strategies.length ? strategies : undefined,
    includeTrades: true,
    configOverrides,
    outputFile: process.env.MONTE_BACKTEST_OUTPUT_FILE
      ? path.resolve(process.cwd(), process.env.MONTE_BACKTEST_OUTPUT_FILE)
      : path.join(__dirname, ".tmp-monte-carlo-backtest.json"),
  });

  const analysis = {
    generatedAt: new Date().toISOString(),
    tf: backtestOutput.tf,
    htfTf: backtestOutput.htfTf,
    symbols: backtestOutput.symbols,
    strategies: backtestOutput.strategiesBacktested,
    iterations: ITERATIONS,
    seed: SEED,
    executionCosts: backtestOutput.executionCosts,
    tradeManagement: backtestOutput.tradeManagement,
    ranked: backtestOutput.ranked
      .map((row) => {
        const aggregateTrades = extractTradeRows(row);
        const bySymbol = {};

        for (const [symbol, symbolRow] of Object.entries(row.bySymbol || {})) {
          const symbolTrades = Array.isArray(symbolRow?.trades) ? symbolRow.trades : [];
          bySymbol[symbol] = runMonteCarloOnTrades(symbolTrades, {
            iterations: ITERATIONS,
            seed: `${row.strategy}:${symbol}`,
          });
        }

        return {
          strategy: row.strategy,
          direction: row.direction,
          monteCarlo: runMonteCarloOnTrades(aggregateTrades, {
            iterations: ITERATIONS,
            seed: `${row.strategy}:aggregate`,
          }),
          bySymbol,
        };
      })
      .filter((row) => Number(row?.monteCarlo?.original?.trades || 0) > 0),
  };

  fs.writeFileSync(outputFile, JSON.stringify(analysis, null, 2), "utf8");

  console.log(`Saved Monte Carlo: ${outputFile}`);
  analysis.ranked.forEach((row, index) => {
    const monte = row.monteCarlo;
    console.log(
      `#${index + 1} ${row.strategy} ` +
        `trades=${monte.original.trades} ` +
        `avgNet=${monte.original.avgNetPnlPct.toFixed(4)}% ` +
        `pfNet=${monte.original.profitFactorNet.toFixed(3)} ` +
        `lowerAvgP05=${Number(monte.bootstrap.p05.avgNetPnlPct || 0).toFixed(4)}% ` +
        `pfP05=${Number(monte.bootstrap.p05.profitFactorNet || 0).toFixed(3)} ` +
        `ddP95=${Number(monte.shuffledOrder.p95.maxDrawdownPct || 0).toFixed(4)} ` +
        `=> ${monte.recommendation}`
    );
  });

  return analysis;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  parseSymbols,
  parseStrategies,
  parseConfigOverrides,
  seedFromString,
  mulberry32,
  extractTradeRows,
  summarizeTradeReturns,
  percentile,
  bootstrapReturns,
  shuffleReturns,
  summarizeSimulationMetrics,
  classifyMonteCarloResult,
  deriveLowerBoundGate,
  derivePromotionDecision,
  runMonteCarloOnTrades,
  buildDefaultOutputPath,
};
