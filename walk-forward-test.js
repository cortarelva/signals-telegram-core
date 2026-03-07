const fs = require("fs");

const DATA_FILE = "./backtest-dataset.json";

function loadTrades() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function simulateTrade(trade, slAtrMult, tpAtrMult) {
  if (
    trade.maxHighDuringTrade == null ||
    trade.minLowDuringTrade == null ||
    trade.atr == null ||
    trade.entry == null
  ) {
    return "UNKNOWN";
  }

  const newSl = trade.entry - slAtrMult * trade.atr;
  const newTp = trade.entry + tpAtrMult * trade.atr;

  const hitTp = trade.maxHighDuringTrade >= newTp;
  const hitSl = trade.minLowDuringTrade <= newSl;

  if (hitTp && hitSl) return "AMBIGUOUS";
  if (hitTp) return "TP";
  if (hitSl) return "SL";
  return "OPEN_OR_UNKNOWN";
}

function evaluateWindow(trades, params) {
  let tp = 0;
  let sl = 0;

  const filtered = trades.filter(
    (t) =>
      typeof t.rsi === "number" &&
      t.rsi >= params.rsiMin &&
      t.rsi <= params.rsiMax
  );

  for (const t of filtered) {
    const outcome = simulateTrade(t, params.slAtrMult, params.tpAtrMult);
    if (outcome === "TP") tp++;
    else if (outcome === "SL") sl++;
  }

  const resolved = tp + sl;
  const winrate = resolved ? (tp / resolved) * 100 : 0;
  const expectancy = resolved
    ? (tp * params.tpAtrMult - sl * params.slAtrMult) / resolved
    : 0;

  return {
    trades: filtered.length,
    resolved,
    tp,
    sl,
    winrate,
    expectancy,
  };
}

function findBestParams(trainTrades) {
  const rsiMinValues = [35, 38, 40, 42];
  const rsiMaxValues = [45, 48, 50, 52];
  const slValues = [1.0, 1.2, 1.5, 1.8, 2.0, 2.5];
  const tpValues = [1.2, 1.5, 1.8, 2.0, 2.5, 3.0];

  let best = null;

  for (const rsiMin of rsiMinValues) {
    for (const rsiMax of rsiMaxValues) {
      if (rsiMin >= rsiMax) continue;

      for (const slAtrMult of slValues) {
        for (const tpAtrMult of tpValues) {
          const params = { rsiMin, rsiMax, slAtrMult, tpAtrMult };
          const stats = evaluateWindow(trainTrades, params);

          if (stats.resolved < 5) continue;

          const candidate = { ...params, ...stats };

          if (
            !best ||
            candidate.expectancy > best.expectancy ||
            (candidate.expectancy === best.expectancy &&
              candidate.winrate > best.winrate)
          ) {
            best = candidate;
          }
        }
      }
    }
  }

  return best;
}

function main() {
  const trades = loadTrades();

  if (trades.length < 100) {
    console.log("Too few trades for walk-forward test.");
    return;
  }

  const split = Math.floor(trades.length * 0.7);
  const train = trades.slice(0, split);
  const test = trades.slice(split);

  console.log("Train trades:", train.length);
  console.log("Test trades:", test.length);

  const best = findBestParams(train);

  if (!best) {
    console.log("No robust parameters found on training window.");
    return;
  }

  console.log("\n=== BEST ON TRAIN ===");
  console.log(best);

  const testStats = evaluateWindow(test, best);

  console.log("\n=== TEST RESULT ===");
  console.log(testStats);
}

main();