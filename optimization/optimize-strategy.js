const fs = require("fs");

const STATE_FILE = "./state.json";

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pct(n) {
  return `${n.toFixed(2)}%`;
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

function runOptimization(trades) {
  const rsiMinValues = [35, 38, 40, 42];
  const rsiMaxValues = [45, 48, 50, 52];
  const slValues = [1.0, 1.2, 1.5, 1.8, 2.0, 2.5];
  const tpValues = [1.2, 1.5, 1.8, 2.0, 2.5, 3.0];
  const pullbackValues = [0.25, 0.3, 0.4, 0.5]; // Novas adições

  const results = [];

  for (const rsiMin of rsiMinValues) {
    for (const rsiMax of rsiMaxValues) {
      if (rsiMin >= rsiMax) continue;

      const filtered = trades.filter(
        (t) => typeof t.rsi === "number" && t.rsi >= rsiMin && t.rsi <= rsiMax
      );

      if (!filtered.length) continue;

      for (const slAtrMult of slValues) {
        for (const tpAtrMult of tpValues) {
          for (const pullback of pullbackValues) { // Iterando sobre pullback
            let tp = 0;
            let sl = 0;
            let ambiguous = 0;
            let unknown = 0;

            for (const trade of filtered) {
              const outcome = simulateTrade(trade, slAtrMult, tpAtrMult);

              if (outcome === "TP") tp++;
              else if (outcome === "SL") sl++;
              else if (outcome === "AMBIGUOUS") ambiguous++;
              else unknown++;
            }

            const resolved = tp + sl;
            if (resolved === 0) continue;

            const winRate = (tp / resolved) * 100;
            const expectancy = (tp * tpAtrMult - sl * slAtrMult) / resolved;

            results.push({
              rsiMin,
              rsiMax,
              slAtrMult,
              tpAtrMult,
              pullback,
              trades: filtered.length,
              resolved,
              tp,
              sl,
              ambiguous,
              unknown,
              winRate,
              expectancy,
            });
          }
        }
      }
    }
  }

  results.sort((a, b) => {
    if (b.expectancy !== a.expectancy) return b.expectancy - a.expectancy;
    return b.winRate - a.winRate;
  });

  return results;
}

function main() {
  const state = loadState();
  const trades = state.closedSignals || [];

  if (!trades.length) {
    console.log("Sem trades fechadas.");
    return;
  }

  const usableTrades = trades.filter(
    (t) =>
      t.maxHighDuringTrade != null &&
      t.minLowDuringTrade != null &&
      typeof t.rsi === "number" &&
      typeof t.atr === "number" &&
      typeof t.entry === "number"
  );

  console.log("Total closed trades:", trades.length);
  console.log("Usable for optimization:", usableTrades.length);

  if (!usableTrades.length) {
    console.log("Ainda não tens trades suficientes com maxHighDuringTrade/minLowDuringTrade.");
    return;
  }

  const results = runOptimization(usableTrades);

  if (!results.length) {
    console.log("Nenhuma combinação produziu resultados utilizáveis.");
    return;
  }

  console.log("\n===== TOP 10 COMBINAÇÕES =====\n");

  results.slice(0, 10).forEach((r, idx) => {
    console.log(
      `#${idx + 1} | RSI=[${r.rsiMin}, ${r.rsiMax}] | SLx=${r.slAtrMult} | TPx=${r.tpAtrMult} | Pullback=${r.pullback}`
    );
    console.log(
      ` trades=${r.trades} resolved=${r.resolved} TP=${r.tp} SL=${r.sl} ambiguous=${r.ambiguous} unknown=${r.unknown}`
    );
    console.log(
      ` winRate=${pct(r.winRate)} expectancy=${r.expectancy.toFixed(4)}`
    );
    console.log("");
  });
}

main();