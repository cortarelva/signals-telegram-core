const fs = require("fs");
const path = require("path");


const DATA_FILE = path.join(__dirname, "runtime", "state.json");

function loadTrades() {
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("O ficheiro JSON deve conter um array de trades.");
  }

  return data;
}

function isClosedTrade(trade) {
  return typeof trade.outcome === "string" && ["TP", "SL"].includes(trade.outcome.toUpperCase());
}

function normalizeOutcome(trade) {
  if (!trade || typeof trade.outcome !== "string") return "OPEN_OR_UNKNOWN";

  const outcome = trade.outcome.toUpperCase();

  if (outcome === "TP") return "TP";
  if (outcome === "SL") return "SL";
  if (outcome === "AMBIGUOUS") return "AMBIGUOUS";
  return "OPEN_OR_UNKNOWN";
}

function getRealizedRR(trade, params) {
  if (typeof trade.rrRealized === "number" && Number.isFinite(trade.rrRealized)) {
    if (normalizeOutcome(trade) === "TP") return Math.abs(trade.rrRealized);
    if (normalizeOutcome(trade) === "SL") return -Math.abs(trade.rrRealized);
  }

  if (normalizeOutcome(trade) === "TP") return params.tpAtrMult;
  if (normalizeOutcome(trade) === "SL") return -params.slAtrMult;

  return 0;
}

function passesFilters(trade, params) {
  if (!trade || typeof trade !== "object") return false;

  if (params.side && trade.side !== params.side) return false;
  if (params.symbol && trade.symbol !== params.symbol) return false;
  if (params.tf && trade.tf !== params.tf) return false;

  if (typeof trade.rsi !== "number") return false;
  if (trade.rsi < params.rsiMin || trade.rsi > params.rsiMax) return false;

  if (params.minScore != null) {
    if (typeof trade.score !== "number" || trade.score < params.minScore) return false;
  }

  if (params.minAdx != null) {
    if (typeof trade.adx !== "number" || trade.adx < params.minAdx) return false;
  }

  if (params.onlyExecutable && trade.signalClass !== "EXECUTABLE") return false;
  if (params.requireApproved && trade.executionApproved !== true) return false;
  if (params.requireTrend && trade.isTrend !== true) return false;
  if (params.requireNearPullback && trade.nearPullback !== true) return false;
  if (params.requireStackedEma && trade.stackedEma !== true) return false;
  if (params.requireRsiRising && trade.rsiRising !== true) return false;
  if (params.requireCooldownPassed && trade.cooldownPassed !== true) return false;
  if (params.closedOnly && !isClosedTrade(trade)) return false;

  return true;
}

function evaluateWindow(trades, params) {
  let tp = 0;
  let sl = 0;
  let ambiguous = 0;
  let openOrUnknown = 0;
  let rrSum = 0;

  const filtered = trades.filter((trade) => passesFilters(trade, params));

  for (const trade of filtered) {
    const outcome = normalizeOutcome(trade);

    if (outcome === "TP") {
      tp++;
      rrSum += getRealizedRR(trade, params);
    } else if (outcome === "SL") {
      sl++;
      rrSum += getRealizedRR(trade, params);
    } else if (outcome === "AMBIGUOUS") {
      ambiguous++;
    } else {
      openOrUnknown++;
    }
  }

  const resolved = tp + sl;
  const winrate = resolved > 0 ? (tp / resolved) * 100 : 0;
  const expectancy = resolved > 0 ? rrSum / resolved : 0;

  return {
    trades: filtered.length,
    resolved,
    tp,
    sl,
    ambiguous,
    openOrUnknown,
    winrate,
    expectancy,
    rrSum,
  };
}

function findBestParams(trainTrades) {
  const rsiMinValues = [35, 38, 40, 42];
  const rsiMaxValues = [45, 48, 50, 52, 55];
  const minScoreValues = [60, 65, 70, 75];
  const minAdxValues = [20, 25, 30, 35];
  const booleanOptions = [false, true];

  let best = null;

  for (const rsiMin of rsiMinValues) {
    for (const rsiMax of rsiMaxValues) {
      if (rsiMin >= rsiMax) continue;

      for (const minScore of minScoreValues) {
        for (const minAdx of minAdxValues) {
          for (const requireTrend of booleanOptions) {
            for (const requireNearPullback of booleanOptions) {
              for (const requireStackedEma of booleanOptions) {
                const params = {
                  side: "BUY",
                  tf: "1m",

                  rsiMin,
                  rsiMax,
                  minScore,
                  minAdx,

                  requireTrend,
                  requireNearPullback,
                  requireStackedEma,

                  onlyExecutable: true,
                  requireApproved: true,
                  requireRsiRising: false,
                  requireCooldownPassed: true,
                  closedOnly: true,

                  // fallback apenas se rrRealized não existir
                  slAtrMult: 1.0,
                  tpAtrMult: 1.6,
                };

                const stats = evaluateWindow(trainTrades, params);

                if (stats.resolved < 8) continue;

                const candidate = { ...params, ...stats };

                if (
                  !best ||
                  candidate.expectancy > best.expectancy ||
                  (candidate.expectancy === best.expectancy &&
                    candidate.winrate > best.winrate) ||
                  (candidate.expectancy === best.expectancy &&
                    candidate.winrate === best.winrate &&
                    candidate.resolved > best.resolved)
                ) {
                  best = candidate;
                }
              }
            }
          }
        }
      }
    }
  }

  return best;
}

function printStats(title, stats) {
  console.log(`\n=== ${title} ===`);
  console.log(`Trades filtradas: ${stats.trades}`);
  console.log(`Resolvidas:       ${stats.resolved}`);
  console.log(`TP:               ${stats.tp}`);
  console.log(`SL:               ${stats.sl}`);
  console.log(`Ambiguous:        ${stats.ambiguous}`);
  console.log(`Open/Unknown:     ${stats.openOrUnknown}`);
  console.log(`Winrate:          ${stats.winrate.toFixed(2)}%`);
  console.log(`Expectancy (R):   ${stats.expectancy.toFixed(4)}`);
  console.log(`RR total:         ${stats.rrSum.toFixed(4)}`);
}

function main() {
  const trades = loadTrades();

  if (trades.length < 30) {
    console.log("Too few trades for walk-forward test.");
    return;
  }

  const split = Math.floor(trades.length * 0.7);
  const train = trades.slice(0, split);
  const test = trades.slice(split);

  console.log("Total trades:", trades.length);
  console.log("Train trades:", train.length);
  console.log("Test trades:", test.length);

  const best = findBestParams(train);

  if (!best) {
    console.log("No robust parameters found on training window.");
    return;
  }

  console.log("\n=== BEST PARAMS ON TRAIN ===");
  console.log({
    side: best.side,
    tf: best.tf,
    rsiMin: best.rsiMin,
    rsiMax: best.rsiMax,
    minScore: best.minScore,
    minAdx: best.minAdx,
    requireTrend: best.requireTrend,
    requireNearPullback: best.requireNearPullback,
    requireStackedEma: best.requireStackedEma,
    onlyExecutable: best.onlyExecutable,
    requireApproved: best.requireApproved,
    requireCooldownPassed: best.requireCooldownPassed,
    closedOnly: best.closedOnly,
  });

  const trainStats = evaluateWindow(train, best);
  const testStats = evaluateWindow(test, best);

  printStats("TRAIN RESULT", trainStats);
  printStats("TEST RESULT", testStats);
}

main();